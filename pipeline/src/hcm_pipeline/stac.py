"""Sentinel-2 L2A from a public STAC API: the georeferencing reference (docs/research/M3-interfaces.md §5.5).

`POST {HCM_STAC_URL}/search` (default Element 84's Earth Search) for `sentinel-2-l2a` over the window's bbox, the
last three years, under 20 % clouds, least cloudy first; the first item that covers the window, else the least cloudy
date whose items (up to four, mosaicked by the warp) cover it together, else up to four items of any dates: a window across
the seam of two orbit tracks has no single date (tracks 280 km apart and swaths of 290 km leave 10 km of overlap at the
equator, and adjacent tracks fly on different days). None when nothing does, which the caller fails with
`apiError.imagery.referenceUnavailable`: a reference with a hole matches nothing there, and `locate` would call it the wrong
city. "Covers" reads the item's **footprint**, not its box: a tile cut by a slanted swath edge has a whole box and 27 % of a
window missing from it. Its `visual` asset (an 8-bit true-colour COG) is read through GDAL's
`/vsicurl/` for the window only, after the address guard (`urlguard.py`). `choose` makes one candidate; the reference guard
(`agreement.py`) makes up to five and keeps the least cloudy that agrees with the others. Never Mapbox Satellite, a Mapbox raster
tileset or a resource of the old site's account: `config.py` refuses a Mapbox host as the STAC root, and the guard
refuses one as an asset.
"""

from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from http import HTTPStatus
from itertools import pairwise, product
from typing import Final

import httpx

from hcm_pipeline.geo import Bounds

COLLECTION: Final = "sentinel-2-l2a"
VISUAL_ASSET: Final = "visual"
MAX_CLOUD_PERCENT: Final = 20
SEARCH_DAYS: Final = 3 * 365
# 50 sorted by cloud left out a date's other tiles over Bucharest itself: a date whose mosaic covers the window was never seen whole.
SEARCH_LIMIT: Final = 100
MOSAIC_ITEMS: Final = 4
# Points a side where a footprint is asked about a window, besides the boxes' own edges.
COVER_SAMPLES: Final = 21
ATTEMPTS: Final = 3
RETRY_SECONDS: Final = 2.0
BBOX_VALUES: Final = 4
_RETRIED: Final = frozenset(
    {HTTPStatus.TOO_MANY_REQUESTS, HTTPStatus.BAD_GATEWAY, HTTPStatus.SERVICE_UNAVAILABLE, HTTPStatus.GATEWAY_TIMEOUT}
)


class ReferenceUnavailableError(RuntimeError):
    """The reference service did not answer, or has nothing over the window."""


@dataclass(frozen=True)
class Post:
    """One POST: a JSON body or form fields."""

    url: str
    json: object = None
    form: Mapping[str, str] | None = None


def _attempt(http: httpx.Client, post: Post) -> httpx.Response | str:
    """The answer, or why it must be tried again."""
    try:
        response = http.post(post.url, json=post.json, data=post.form)
    except httpx.TransportError as error:
        return type(error).__name__
    return f"HTTP {response.status_code}" if response.status_code in _RETRIED else response


def post_with_retries(http: httpx.Client, post: Post, sleep: Callable[[float], None]) -> httpx.Response:
    """A POST tried `ATTEMPTS` times (transport errors, 429 and gateway errors back off); ReferenceUnavailableError after."""
    problem = "no answer"
    for attempt in range(ATTEMPTS):
        answer = _attempt(http, post)
        if isinstance(answer, httpx.Response):
            return answer
        problem = answer
        sleep(RETRY_SECONDS * 2**attempt)
    raise ReferenceUnavailableError(f"{post.url.split('?', 1)[0]} failed {ATTEMPTS} times ({problem})")


Ring = tuple[tuple[float, float], ...]


def _in_ring(x: float, y: float, ring: Ring) -> bool:
    """A point in a ring of `(lng, lat)`: an odd count of edges crossed going east."""
    crossed = False
    for (x0, y0), (x1, y1) in pairwise((*ring, ring[0])):
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) / (y1 - y0) * (x1 - x0):
            crossed = not crossed
    return crossed


@dataclass(frozen=True)
class StacItem:
    """A Sentinel-2 item: its id, date, cloud cover, `visual` asset address, footprint bbox (WGS84) and, when the search gave them, the
    footprint's outer rings."""

    id: str
    date: str
    cloud: float
    href: str
    bbox: tuple[float, float, float, float]
    rings: tuple[Ring, ...] = ()

    def holds(self, x: float, y: float) -> bool:
        west, south, east, north = self.bbox
        inside = west <= x <= east and south <= y <= north
        return inside and (not self.rings or any(_in_ring(x, y, ring) for ring in self.rings))

    def covers(self, bounds: Bounds) -> bool:
        return _together_cover([self], bounds)


def _field(record: object, *keys: str) -> object:
    """`record[keys[0]][keys[1]]...`, None as soon as a level is not a record."""
    value = record
    for key in keys:
        value = value.get(key) if isinstance(value, dict) else None
    return value


def _bbox(value: object) -> tuple[float, float, float, float] | None:
    numbers = [float(item) for item in value if isinstance(item, int | float)] if isinstance(value, list) else []
    return (numbers[0], numbers[1], numbers[2], numbers[3]) if len(numbers) == BBOX_VALUES else None


def _ring_of(positions: object) -> Ring:
    """A GeoJSON ring's `(lng, lat)`, empty unless every position holds two numbers."""
    pairs = positions if isinstance(positions, list) else []
    return tuple((float(place[0]), float(place[1])) for place in pairs if isinstance(place, list) and _numbers(place[:2]))


def _numbers(values: list[object]) -> bool:
    return len(values) == len("xy") and all(isinstance(value, int | float) for value in values)


def _rings(geometry: object) -> tuple[Ring, ...]:
    """A Polygon's or MultiPolygon's outer rings (a footprint has no holes that matter); none for anything else."""
    outer = (_outer_ring(polygon) for polygon in _polygons(geometry))
    return tuple(ring for ring in outer if ring)


def _outer_ring(polygon: object) -> Ring:
    return _ring_of(polygon[0]) if isinstance(polygon, list) and polygon else ()


def _polygons(geometry: object) -> list[object]:
    coordinates = _field(geometry, "coordinates")
    if not isinstance(coordinates, list):
        return []
    kind = _field(geometry, "type")
    return [coordinates] if kind == "Polygon" else coordinates if kind == "MultiPolygon" else []


def item_of(feature: object) -> StacItem | None:
    """The item of a search result feature, or None when it lacks the `visual` asset, a date or a bbox."""
    href, when, bbox = (
        _field(feature, "assets", VISUAL_ASSET, "href"),
        _field(feature, "properties", "datetime"),
        _bbox(_field(feature, "bbox")),
    )
    cloud = _field(feature, "properties", "eo:cloud_cover")
    if not isinstance(href, str) or not isinstance(when, str) or bbox is None:
        return None
    clouds = float(cloud) if isinstance(cloud, int | float) else 100.0
    return StacItem(str(_field(feature, "id")), when[:10], clouds, href, bbox, _rings(_field(feature, "geometry")))


def choose(items: Sequence[StacItem], bounds: Bounds) -> list[StacItem]:
    """The least cloudy item that covers the window, else the least cloudy date's items that cover it together, else items of several
    dates that do, else none."""
    covering = [item for item in items if item.covers(bounds)]
    return covering[:1] or _covering_mosaic(items, bounds) or _across_dates(items, bounds)


def _covering_mosaic(items: Sequence[StacItem], bounds: Bounds) -> list[StacItem]:
    return next((mosaic for mosaic in _mosaics(items) if _together_cover(mosaic, bounds)), [])


def _across_dates(items: Sequence[StacItem], bounds: Bounds) -> list[StacItem]:
    """Up to `MOSAIC_ITEMS` items of any dates, each the one (least cloudy of equals) that adds most of the window; none when they leave a
    hole. A reference is matched by its gradients, so the seam between two dates costs little, and a hole costs the city."""
    left = list(product(_middles(bounds.west, bounds.east, ()), _middles(bounds.south, bounds.north, ())))
    chosen: list[StacItem] = []
    for _ in range(MOSAIC_ITEMS if items else 0):
        best = _adding_most(items, left)
        chosen.append(best)
        left = [(x, y) for x, y in left if not best.holds(x, y)]
    return _needed(chosen, bounds)


def _adding_most(items: Sequence[StacItem], left: Sequence[tuple[float, float]]) -> StacItem:
    return max(items, key=lambda item: sum(item.holds(x, y) for x, y in left))


def _needed(chosen: Sequence[StacItem], bounds: Bounds) -> list[StacItem]:
    """The items that cover the window, without those that added nothing; none when they leave a hole."""
    kept = list(dict.fromkeys(chosen))
    while kept and _together_cover(kept[:-1], bounds):
        kept.pop()
    return kept if kept and _together_cover(kept, bounds) else []


def _mosaics(items: Sequence[StacItem]) -> Iterator[list[StacItem]]:
    """Up to four items of each date, the date of the least cloudy item first."""
    for date in dict.fromkeys(item.date for item in items):
        yield [item for item in items if item.date == date][:MOSAIC_ITEMS]


def _edges(mosaic: Sequence[StacItem], *sides: int) -> Iterator[float]:
    return (item.bbox[side] for item in mosaic for side in sides)


def _middles(low: float, high: float, edges: Iterable[float]) -> list[float]:
    """`low` to `high` cut evenly and at every edge between them: the middle of each piece."""
    even = (low + (high - low) * step / COVER_SAMPLES for step in range(COVER_SAMPLES + 1))
    cuts = sorted({*even, *(edge for edge in edges if low < edge < high)})
    return [(start + end) / 2 for start, end in pairwise(cuts)]


def _inside_one(mosaic: Sequence[StacItem], x: float, y: float) -> bool:
    return any(item.holds(x, y) for item in mosaic)


def _together_cover(mosaic: Sequence[StacItem], bounds: Bounds) -> bool:
    """True when the items leave no part of the window out: their boxes' edges and an even grid cut it into cells, each asked at its
    middle (of boxes, each wholly in or out)."""
    columns = _middles(bounds.west, bounds.east, _edges(mosaic, 0, 2))
    rows = _middles(bounds.south, bounds.north, _edges(mosaic, 1, 3))
    return all(_inside_one(mosaic, x, y) for x, y in product(columns, rows))


class StacClient:
    """`POST /search` of a STAC API."""

    def __init__(self, http: httpx.Client, base_url: str, sleep: Callable[[float], None]) -> None:
        self._http = http
        self._url = f"{base_url.rstrip('/')}/search"
        self._sleep = sleep

    def search(self, bounds: Bounds, now: float) -> list[StacItem]:
        """Items over `bounds` from the last three years under 20 % clouds, least cloudy first."""
        end = datetime.fromtimestamp(now, UTC)
        start = end - timedelta(days=SEARCH_DAYS)
        body = {
            "collections": [COLLECTION],
            "bbox": [bounds.west, bounds.south, bounds.east, bounds.north],
            "datetime": f"{start:%Y-%m-%dT00:00:00Z}/{end:%Y-%m-%dT23:59:59Z}",
            "query": {"eo:cloud_cover": {"lt": MAX_CLOUD_PERCENT}},
            "sortby": [{"field": "properties.eo:cloud_cover", "direction": "asc"}],
            "limit": SEARCH_LIMIT,
        }
        response = post_with_retries(self._http, Post(self._url, json=body), self._sleep)
        if not response.is_success:
            raise ReferenceUnavailableError(f"the STAC search answered HTTP {response.status_code}")
        features = _field(response.json(), "features")
        items = [item for item in map(item_of, features if isinstance(features, list) else []) if item is not None]
        return sorted(items, key=lambda item: (item.cloud, item.date))
