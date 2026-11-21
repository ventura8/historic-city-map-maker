"""Lost streets from open data: parsing, merging, thinning, enrichment, the feature format and the command line."""

import json
from collections.abc import Mapping
from pathlib import Path

import httpx
import pytest
from hcm_pipeline import lost_streets as ls
from hcm_pipeline.geo import Bounds

BOUNDS = Bounds(25.93, 44.33, 26.25, 44.55)


def way(ident: int, name: str, nodes: list[tuple[float, float]], **tags: str) -> dict[str, object]:
    all_tags = {"name": name, **tags} if name else dict(tags)
    return {"type": "way", "id": ident, "tags": all_tags, "geometry": [{"lon": lng, "lat": lat} for lng, lat in nodes]}


def no_sleep(_: float) -> None:
    return None


def test_year_of_reads_a_leading_year_in_range() -> None:
    assert ls.year_of("1983-05-01") == 1983
    assert ls.year_of("~1900") == 1900
    assert ls.year_of("1700") is None
    assert ls.year_of("unknown") is None
    assert ls.year_of(1983) is None


def test_years_of_drops_an_end_before_the_start() -> None:
    assert ls.years_of("1900", "1983") == (1900, 1983)
    assert ls.years_of("1990", "1983") == (1990, None)
    assert ls.years_of(None, "1983") == (None, 1983)


def test_queries_name_the_bounds() -> None:
    assert "44.33,25.93,44.55,26.25" in ls.osm_query(BOUNDS)
    assert 'way["razed:highway"]' in ls.osm_query(BOUNDS)
    assert '["end_date"]' in ls.ohm_query(BOUNDS)
    assert "Point(25.93 44.33)" in ls.wikidata_query(BOUNDS)


def test_street_of_keeps_named_lines_and_drops_service_roads() -> None:
    ohm = ls.street_of(
        ls.OHM, way(7, "Strada Uranus", [(26.0, 44.4), (26.01, 44.41)], start_date="1900", end_date="1983", alt_name="Uranus;Strada Uranus")
    )
    assert ohm is not None
    assert (ohm.year_start, ohm.year_end, ohm.other_names) == (1900, 1983, ("Uranus",))
    assert ohm.links == (("https://www.openhistoricalmap.org/way/7", "OpenHistoricalMap"),)
    service = way(8, "Aisle", [(26.0, 44.4), (26.01, 44.41)], **{"razed:highway": "parking_aisle"})
    assert ls.street_of(ls.OSM, service) is None
    named_by_prefix = way(9, "", [(26.0, 44.4), (26.01, 44.41)], **{"demolished:highway": "residential", "demolished:name": "Strada Veche"})
    osm = ls.street_of(ls.OSM, named_by_prefix)
    assert osm is not None
    assert osm.name == "Strada Veche"
    assert osm.links[0][0].startswith("https://www.openstreetmap.org/way/9")
    assert ls.street_of(ls.OHM, way(10, "", [(26.0, 44.4), (26.01, 44.41)])) is None
    assert ls.street_of(ls.OHM, {"id": 11, "tags": {"name": "X"}, "geometry": None}) is None
    assert ls.street_of(ls.OSM, {"id": 12, "tags": "bad", "geometry": []}) is None
    historic = way(13, "Ulița", [(26.0, 44.4), (26.01, 44.41)], historic="street")
    assert ls.street_of(ls.OSM, historic) is not None


def test_merge_joins_touching_pieces_and_keeps_apart_the_rest() -> None:
    a = ls.street_of(ls.OHM, way(2, "S", [(1.0, 1.0), (2.0, 2.0)], alt_name="T"))
    b = ls.street_of(ls.OHM, way(1, "S", [(3.0, 3.0), (2.0, 2.0)]))
    c = ls.street_of(ls.OHM, way(3, "s", [(9.0, 9.0), (8.0, 8.0)]))
    d = ls.street_of(ls.OHM, way(4, "Other", [(9.0, 9.0), (8.0, 8.0)]))
    assert a is not None
    assert b is not None
    assert c is not None
    assert d is not None
    merged = ls.merge_streets([a, b, c, d])
    by_id = {street.ident: street for street in merged}
    assert set(by_id) == {"1", "1-2", "4"}
    assert by_id["1"].line == ((3.0, 3.0), (2.0, 2.0), (1.0, 1.0))
    assert by_id["1"].other_names == ("T",)
    assert len(by_id["1"].links) == 3


def test_merge_orders_non_numeric_ids_first() -> None:
    street = ls.Street(ls.WIKIDATA, "Qx", "N", ((0.0, 0.0), (1.0, 1.0)))
    assert ls.merge_streets([street]) == [street]


def test_douglas_peucker_and_clean_line_thin_to_the_limit() -> None:
    assert ls.douglas_peucker([(0.0, 0.0), (1.0, 0.0)], 0.1) == [(0.0, 0.0), (1.0, 0.0)]
    assert ls.douglas_peucker([(0.0, 0.0), (0.5, 0.01), (1.0, 0.0)], 0.1) == [(0.0, 0.0), (1.0, 0.0)]
    assert ls.douglas_peucker([(0.0, 0.0), (0.5, 1.0), (1.0, 0.0)], 0.1) == [(0.0, 0.0), (0.5, 1.0), (1.0, 0.0)]
    assert ls._distance((1.0, 1.0), (0.0, 0.0), (0.0, 0.0)) == pytest.approx(2**0.5)
    zigzag = [(26.0 + i * 1e-4, 44.4 + (i % 2) * 1e-3) for i in range(1200)]
    cleaned = ls.clean_line([*zigzag, zigzag[-1], (40.0, 44.4)], BOUNDS)
    assert 2 <= len(cleaned) <= ls.MAX_POSITIONS
    assert all(round(value, 6) == value for position in cleaned for value in position)


def test_enrich_adds_links_and_years_or_counts_points() -> None:
    street = ls.Street(ls.OHM, "1", "Strada  Uranus", ((26.0, 44.4), (26.1, 44.4)), year_start=1990)
    counts = ls.Counts()
    items = [ls.Item("Q1", "strada uranus", 1850, 1983), ls.Item("Q2", "Nowhere", None, None)]
    [enriched] = ls.enrich([street], items, counts)
    assert enriched.links[-1] == ("https://www.wikidata.org/wiki/Q1", "Wikidata")
    assert (enriched.year_start, enriched.year_end) == (1990, None)
    assert (counts.enriched, counts.point_only) == (1, 1)
    bare = ls.enrich([ls.Street(ls.OHM, "2", "A", ((0.0, 0.0), (1.0, 1.0)))], [ls.Item("Q3", "A", 1850, 1983)], ls.Counts())
    assert (bare[0].year_start, bare[0].year_end) == (1850, 1983)


def test_feature_of_matches_the_import_format() -> None:
    street = ls.Street(ls.OHM, "7", "Strada Uranus", ((26.0, 44.4), (26.1, 44.41)), 1900, 1983, ("Uranus",), (("u", "l"),))
    feature = ls.feature_of(street, BOUNDS)
    assert feature is not None
    properties = feature["properties"]
    assert isinstance(properties, dict)
    assert feature["id"] == "ls-ohm-7"
    assert properties["description"] == {
        "ro": "Alte nume: Uranus. Sursa: OpenHistoricalMap contributors (CC0).",
        "en": "Other names: Uranus. Source: OpenHistoricalMap contributors (CC0).",
    }
    assert (properties["yearStart"], properties["yearEnd"], properties["published"]) == (1900, 1983, True)
    plain = ls.feature_of(ls.Street(ls.OSM, "8", "X", ((26.0, 44.4), (26.1, 44.4))), BOUNDS)
    assert plain is not None
    assert "yearStart" not in json.dumps(plain)
    assert ls.feature_of(ls.Street(ls.OSM, "9", "X", ((60.0, 44.4), (61.0, 44.4))), BOUNDS) is None


def overpass(elements: list[dict[str, object]]) -> httpx.Response:
    return httpx.Response(200, json={"elements": [*elements, {"type": "node", "id": 1}, "junk"]})


def test_fetchers_read_overpass_and_wikidata() -> None:
    seen: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.host == "query.wikidata.org":
            rows = [
                {"item": {"value": "http://www.wikidata.org/entity/Q5"}, "label": {"value": "A"}, "end": {"value": "1983-01-01T00:00:00Z"}},
                {"item": {"value": "http://www.wikidata.org/entity/Q5"}, "label": {"value": "A"}},
                {"item": {"value": "x"}, "label": {"value": ""}},
                "junk",
            ]
            return httpx.Response(200, json={"results": {"bindings": rows}})
        return overpass([way(1, "A", [(26.0, 44.4), (26.1, 44.4)])])

    with httpx.Client(transport=httpx.MockTransport(answer)) as http:
        fetchers = ls.http_fetchers(http, no_sleep)
        assert len(fetchers.ohm(BOUNDS)) == 1
        assert len(fetchers.osm(BOUNDS)) == 1
        assert fetchers.wikidata(BOUNDS) == [ls.Item("Q5", "A", None, None)]
    assert {request.url.host for request in seen} == {"overpass-api.openhistoricalmap.org", "overpass-api.de", "query.wikidata.org"}


def test_odd_bodies_read_as_empty() -> None:
    def answer(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[1] if request.url.host == "query.wikidata.org" else {"elements": "no"})

    with httpx.Client(transport=httpx.MockTransport(answer)) as http:
        fetchers = ls.http_fetchers(http, no_sleep)
        assert fetchers.ohm(BOUNDS) == []
        assert fetchers.wikidata(BOUNDS) == []
    assert ls.item_of({"item": "bad"}) is None


def fake(ohm: list[dict[str, object]], items: list[ls.Item]) -> ls.Fetchers:
    return ls.Fetchers(
        osm=lambda _: [way(5, "Aisle", [(26.0, 44.4), (26.1, 44.4)], **{"razed:highway": "service"})],
        ohm=lambda _: [*ohm],
        wikidata=lambda _: items,
    )


def test_main_writes_the_collection(tmp_path: Path) -> None:
    out = tmp_path / "out.geojson"
    ohm = [way(1, "A", [(26.0, 44.4), (26.1, 44.4)], start_date="1900", end_date="1983"), way(2, "B", [(80.0, 0.0), (81.0, 0.0)])]
    assert ls.main(["--bounds", "25.93,44.33,26.25,44.55", "--out", str(out)], fake(ohm, [ls.Item("Q9", "Z", None, None)])) == 0
    collection = json.loads(out.read_text(encoding="utf-8"))
    assert [feature["id"] for feature in collection["features"]] == ["ls-ohm-1"]
    assert [(source["name"], source["fetched"], source["kept"], source["features"]) for source in collection["sources"]] == [
        ("OpenHistoricalMap", 2, 2, 1),
        ("OpenStreetMap", 1, 0, 0),
        ("Wikidata", 1, 0, 0),
    ]


def test_main_refuses_bad_bounds_and_failed_sources(tmp_path: Path) -> None:
    out = tmp_path / "out.geojson"
    assert ls.main(["--bounds", "1,2,3", "--out", str(out)], fake([], [])) == 2
    assert ls.main(["--bounds", "3,2,1,4", "--out", str(out)], fake([], [])) == 2

    def broken(_: Bounds) -> list[Mapping[str, object]]:
        raise httpx.ConnectError("down")

    fetchers = ls.Fetchers(osm=broken, ohm=broken, wikidata=lambda _: [])
    assert ls.main(["--bounds", "25.93,44.33,26.25,44.55", "--out", str(out)], fetchers) == 1
    assert not out.exists()


def test_main_without_fetchers_uses_the_network_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def offline(http: httpx.Client, _: object) -> ls.Fetchers:
        assert http.headers["User-Agent"] == ls.USER_AGENT
        return fake([], [])

    monkeypatch.setattr(ls, "http_fetchers", offline)
    assert ls.main(["--bounds", "25.93,44.33,26.25,44.55", "--out", str(tmp_path / "o.geojson")]) == 0
