"""The reference services: the STAC search and its choice, Overpass and the line drawing, with their retries."""

import json
from collections.abc import Iterator

import httpx
import numpy
import pytest
from hcm_pipeline.geo import Bounds, Grid, MercatorBox, to_mercator
from hcm_pipeline.osm import OverpassClient, draw, query, to_geojson
from hcm_pipeline.stac import SEARCH_LIMIT, Post, ReferenceUnavailableError, StacClient, StacItem, choose, item_of, post_with_retries

from tests.fakes.http import FakeHttpServer, Reply, Request
from tests.fakes.world import dig

WINDOW = Bounds(26.05, 44.40, 26.15, 44.46)


@pytest.fixture
def server() -> Iterator[FakeHttpServer]:
    with FakeHttpServer() as fake:
        yield fake


def feature(item_id: str, date: str, cloud: float, bbox: list[float]) -> dict[str, object]:
    return {
        "id": item_id,
        "bbox": bbox,
        "properties": {"datetime": f"{date}T09:00:00Z", "eo:cloud_cover": cloud},
        "assets": {"visual": {"href": f"https://x/{item_id}.tif"}},
    }


def test_happy_path_the_search_asks_for_three_years_of_clear_sentinel2_and_sorts_by_cloud(server: FakeHttpServer) -> None:
    seen: list[Request] = []

    def answer(request: Request) -> Reply:
        seen.append(request)
        features = [feature("b", "2025-08-03", 9.0, [25, 44, 27, 45]), feature("a", "2024-07-01", 2.0, [25, 44, 27, 45]), {"id": "broken"}]
        return Reply.json(json.dumps({"features": features}))

    server.route("POST", "/v1/search", answer)
    with httpx.Client() as client:
        items = StacClient(client, server.url("/v1/"), lambda _seconds: None).search(WINDOW, 1792000000)

    body = json.loads(seen[0].body)
    assert [item.id for item in items] == ["a", "b"]
    assert body["collections"] == ["sentinel-2-l2a"]
    assert body["datetime"] == "2023-10-15T00:00:00Z/2026-10-14T23:59:59Z"
    assert body["query"] == {"eo:cloud_cover": {"lt": 20}}
    assert body["limit"] == SEARCH_LIMIT
    assert SEARCH_LIMIT >= 100
    assert body["bbox"] == [26.05, 44.40, 26.15, 44.46]


def test_bad_path_a_failing_search_is_tried_three_times_then_unavailable(server: FakeHttpServer) -> None:
    for _ in range(3):
        server.enqueue("/v1/search", Reply(503))
    waits: list[float] = []
    with httpx.Client() as client, pytest.raises(ReferenceUnavailableError, match=r"failed 3 times \(HTTP 503\)"):
        StacClient(client, server.url("/v1"), waits.append).search(WINDOW, 1792000000)

    assert waits == [2.0, 4.0, 8.0]


def test_bad_path_an_unreachable_service_and_a_refusal_are_unavailable(server: FakeHttpServer) -> None:
    server.route("POST", "/v1/search", lambda _request: Reply(400, b"bad"))
    with httpx.Client() as client:
        with pytest.raises(ReferenceUnavailableError, match=r"TransportError|ConnectError"):
            post_with_retries(client, Post("http://127.0.0.1:9/search?key=x"), lambda _seconds: None)
        with pytest.raises(ReferenceUnavailableError, match="HTTP 400"):
            StacClient(client, server.url("/v1"), lambda _seconds: None).search(WINDOW, 1792000000)


def test_happy_path_the_first_covering_item_wins_else_one_dates_mosaic() -> None:
    covering = StacItem("c", "2025-01-01", 5, "h", (25, 44, 27, 45))
    west = StacItem("w", "2025-02-02", 1, "h", (25, 44, 26.1, 45))
    east = StacItem("e", "2025-02-02", 2, "h", (26.1, 44, 27, 45))
    other = StacItem("o", "2025-03-03", 3, "h", (26.1, 44, 27, 45))

    assert choose([west, covering], WINDOW) == [covering]
    assert choose([west, east, other], WINDOW) == [west, east]
    assert choose([], WINDOW) == []
    assert item_of({"id": "x", "bbox": [1, 2, 3], "properties": {"datetime": "2025"}, "assets": {"visual": {"href": "h"}}}) is None
    assert item_of(feature("n", "2025-01-01", 0, [1, 2, 3, 4])) == StacItem("n", "2025-01-01", 0.0, "https://x/n.tif", (1, 2, 3, 4))


def test_happy_path_a_date_with_a_hole_gives_way_to_a_later_date_that_covers_the_window() -> None:
    """Scenarios: S-P01-HAPPY-MOSAIC-COVERING-DATE"""
    lone = StacItem("lone", "2025-01-01", 1, "h", (25, 44, 26.1, 45))
    west = StacItem("w", "2025-02-02", 2, "h", (25, 44, 26.1, 45))
    east = StacItem("e", "2025-02-02", 3, "h", (26.1, 44, 27, 45))

    assert choose([lone, west, east], WINDOW) == [west, east]


def test_happy_path_four_boxes_around_a_corner_cover_the_window_together() -> None:
    """Scenarios: S-P01-HAPPY-MOSAIC-COVERING-DATE"""
    quarters = [
        StacItem("nw", "2025-01-01", 1, "h", (26, 44.43, 26.1, 45)),
        StacItem("ne", "2025-01-01", 2, "h", (26.1, 44.43, 27, 45)),
        StacItem("sw", "2025-01-01", 3, "h", (26, 44, 26.1, 44.43)),
        StacItem("se", "2025-01-01", 4, "h", (26.1, 44, 27, 44.43)),
    ]

    assert choose(quarters, WINDOW) == quarters


@pytest.mark.parametrize(
    "boxes",
    [
        [(25, 44, 26.1, 45)],
        [(25, 44, 26.08, 45), (26.12, 44, 27, 45)],
        [(26, 44.43, 26.1, 45), (26.1, 44.43, 27, 45), (26, 44, 26.1, 44.43)],
    ],
)
def test_bad_path_no_date_that_covers_the_window_gives_no_mosaic(boxes: list[tuple[float, float, float, float]]) -> None:
    """Scenarios: S-P01-BAD-MOSAIC-NOT-COVERED"""
    items = [StacItem(f"i{index}", "2025-01-01", index, "h", box) for index, box in enumerate(boxes)]

    assert choose(items, WINDOW) == []


def test_bad_path_only_four_items_of_a_date_count() -> None:
    """Scenarios: S-P01-BAD-MOSAIC-NOT-COVERED"""
    strips = [StacItem(f"s{index}", "2025-01-01", index, "h", (26.05 + index * 0.02, 44, 26.07 + index * 0.02, 45)) for index in range(5)]

    assert choose(strips, WINDOW) == []


SLANTED = (((26.0, 44.0), (26.09, 44.0), (26.09, 44.5), (26.0, 44.5)),)


def test_bad_path_a_tile_with_a_whole_box_and_a_slanted_footprint_does_not_cover_the_window() -> None:
    """Scenarios: S-P01-BAD-FOOTPRINT-HOLE"""
    # Earth Search's S2A_34NFL_20240101 at latitude 5: its box holds the window, 27 % of the window lies outside its footprint.
    cut = StacItem("cut", "2025-01-01", 1, "h", (26.0, 44.0, 26.2, 44.5), SLANTED)

    assert not cut.covers(WINDOW)
    assert choose([cut], WINDOW) == []
    assert StacItem("whole", "2025-01-01", 1, "h", (26.0, 44.0, 26.2, 44.5)).covers(WINDOW)


def test_happy_path_a_window_across_two_orbits_is_mosaicked_from_two_dates() -> None:
    """Scenarios: S-P01-HAPPY-TWO-DATES"""
    west = StacItem("west", "2025-01-01", 2, "h", (26.0, 44.0, 26.2, 44.5), SLANTED)
    east_ring = (((26.08, 44.0), (26.2, 44.0), (26.2, 44.5), (26.08, 44.5)),)
    east = StacItem("east", "2025-01-06", 3, "h", (26.0, 44.0, 26.2, 44.5), east_ring)
    useless = StacItem("away", "2025-02-01", 1, "h", (28.0, 44.0, 28.2, 44.5))

    assert choose([useless, west, east], WINDOW) == [east, west]


def test_bad_path_several_dates_with_a_hole_between_them_are_no_reference() -> None:
    """Scenarios: S-P01-BAD-MOSAIC-NOT-COVERED"""
    west = StacItem("w", "2025-01-01", 2, "h", (26.0, 44.0, 26.09, 44.5))
    east = StacItem("e", "2025-01-06", 3, "h", (26.11, 44.0, 26.2, 44.5))

    assert choose([west, east], WINDOW) == []


def test_happy_path_a_search_result_gives_its_footprints_rings() -> None:
    """Scenarios: S-P01-BAD-FOOTPRINT-HOLE"""
    polygon = {"type": "Polygon", "coordinates": [[[1, 2], [3, 2], [3, 4], [1, 2]]]}
    many = {"type": "MultiPolygon", "coordinates": [[[[1, 2], [3, 2], [3, 4]]], [[[5, 6], [7, 6], [7, 8]]]]}

    plain = feature("n", "2025-01-01", 0, [1, 2, 3, 4])

    def rings_of(geometry: object) -> tuple[object, ...]:
        found = item_of({**plain, "geometry": geometry})
        assert found is not None
        return found.rings

    assert rings_of(polygon) == (((1.0, 2.0), (3.0, 2.0), (3.0, 4.0), (1.0, 2.0)),)
    assert len(rings_of(many)) == 2
    assert rings_of({"type": "Point", "coordinates": [1, 2]}) == ()
    assert rings_of({"type": "Polygon", "coordinates": [["x"]]}) == ()


def test_happy_path_overpass_returns_the_windows_lines_as_geojson(server: FakeHttpServer) -> None:
    elements = [
        {"type": "way", "tags": {"highway": "primary"}, "geometry": [{"lat": 44.41, "lon": 26.06}, {"lat": 44.45, "lon": 26.14}]},
        {
            "type": "way",
            "tags": {"leisure": "park"},
            "geometry": [{"lat": 44.42, "lon": 26.07}, {"lat": 44.43, "lon": 26.08}, {"lat": "x"}],
        },
        {"type": "way", "tags": {"waterway": "river"}, "geometry": [{"lat": 44.42, "lon": 26.07}]},
        {"type": "node", "lat": 44.4},
    ]
    seen: list[Request] = []

    def answer(request: Request) -> Reply:
        seen.append(request)
        return Reply.json(json.dumps({"elements": elements}))

    server.route("POST", "/api/interpreter", answer)
    with httpx.Client() as client:
        features = OverpassClient(client, server.url("/api/interpreter"), lambda _seconds: None).features(WINDOW)

    found = features["features"]
    assert isinstance(found, list)
    assert [dig(feature, "properties") for feature in found] == [
        {"kind": "highway", "class": "primary"},
        {"kind": "other", "class": ""},
    ]
    assert b"out+geom" in seen[0].body
    assert to_geojson("nothing") == {"type": "FeatureCollection", "features": []}


def test_bad_path_overpass_refusing_the_query_is_unavailable(server: FakeHttpServer) -> None:
    server.route("POST", "/api/interpreter", lambda _request: Reply(400, b"syntax"))
    with httpx.Client() as client, pytest.raises(ReferenceUnavailableError, match="HTTP 400"):
        OverpassClient(client, server.url("/api/interpreter"), lambda _seconds: None).features(WINDOW)


def test_happy_path_the_query_and_the_drawing_cover_the_window() -> None:
    text = query(WINDOW)
    west, south = to_mercator(26.05, 44.40)
    grid = Grid.over(MercatorBox(west, south, west + 1000, south + 1000), 10)
    line = {
        "type": "Feature",
        "properties": {"class": "primary"},
        "geometry": {"type": "LineString", "coordinates": [[26.05, 44.4005], [26.06, 44.4005]]},
    }

    image = draw({"features": [line, "junk"]}, grid)

    assert "(44.400000,26.050000,44.460000,26.150000)" in text
    assert image.shape == (100, 100)
    assert int(numpy.count_nonzero(image)) > 100
