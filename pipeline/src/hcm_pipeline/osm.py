"""OpenStreetMap features from Overpass: the line reference (docs/research/M3-interfaces.md §5.5).

One Overpass query (`HCM_OVERPASS_URL`, default the main instance, **UNVERIFIED** policy limits) for the window's
highways down to residential, railways, waterways and water areas, kept as GeoJSON (the reference cache), drawn
as lines on the window's 10 m grid: the georeferencer's OSM image (`reference-osm.png`). Attribution:
"© OpenStreetMap contributors (ODbL)".
"""

from collections.abc import Callable
from typing import Final

import cv2
import httpx
import numpy
from numpy.typing import NDArray

from hcm_pipeline.geo import Bounds, Grid, to_mercator_arrays
from hcm_pipeline.images import UInt8Array
from hcm_pipeline.stac import Post, ReferenceUnavailableError, post_with_retries

ATTRIBUTION: Final = "© OpenStreetMap contributors (ODbL)"
HIGHWAYS: Final = "motorway|trunk|primary|secondary|tertiary|unclassified|residential"
RAILWAYS: Final = "rail|light_rail|tram|subway"
WATERWAYS: Final = "river|canal|stream"
# Line widths in pixels of the 10 m grid, by the feature's class.
WIDTHS: Final = {"motorway": 4, "trunk": 4, "primary": 3, "secondary": 3, "tertiary": 2, "river": 4, "canal": 3}
DEFAULT_WIDTH: Final = 1
SUBPIXEL_BITS: Final = 2
MIN_LINE_POINTS: Final = 2
Feature = dict[str, object]


def query(bounds: Bounds) -> str:
    """The Overpass QL query of the window's lines and water."""
    box = f"({bounds.south:.6f},{bounds.west:.6f},{bounds.north:.6f},{bounds.east:.6f})"
    parts = (
        f'way["highway"~"^({HIGHWAYS})$"]{box};',
        f'way["railway"~"^({RAILWAYS})$"]{box};',
        f'way["waterway"~"^({WATERWAYS})$"]{box};',
        f'way["natural"="water"]{box};',
    )
    return f"[out:json][timeout:90];({''.join(parts)});out geom;"


def _kind(tags: dict[str, object]) -> tuple[str, str]:
    for key in ("highway", "railway", "waterway", "natural"):
        if isinstance(tags.get(key), str):
            return key, str(tags[key])
    return "other", ""


def _lonlat(point: object) -> list[float] | None:
    lon, lat = (point.get("lon"), point.get("lat")) if isinstance(point, dict) else (None, None)
    return [float(lon), float(lat)] if isinstance(lon, int | float) and isinstance(lat, int | float) else None


def _coordinates(geometry: object) -> list[list[float]]:
    points = geometry if isinstance(geometry, list) else []
    return [place for place in map(_lonlat, points) if place is not None]


def _feature(element: object) -> Feature | None:
    if not isinstance(element, dict) or element.get("type") != "way":
        return None
    coordinates = _coordinates(element.get("geometry"))
    tags = element.get("tags")
    key, value = _kind(tags if isinstance(tags, dict) else {})
    geometry = {"type": "LineString", "coordinates": coordinates}
    return (
        {"type": "Feature", "properties": {"kind": key, "class": value}, "geometry": geometry}
        if len(coordinates) >= MIN_LINE_POINTS
        else None
    )


def to_geojson(answer: object) -> dict[str, object]:
    """The Overpass `out geom` answer as a GeoJSON FeatureCollection of LineStrings."""
    elements = answer.get("elements") if isinstance(answer, dict) else None
    features = [feature for feature in map(_feature, elements if isinstance(elements, list) else []) if feature is not None]
    return {"type": "FeatureCollection", "features": features}


class OverpassClient:
    """The Overpass API's interpreter endpoint."""

    def __init__(self, http: httpx.Client, url: str, sleep: Callable[[float], None]) -> None:
        self._http = http
        self._url = url
        self._sleep = sleep

    def features(self, bounds: Bounds) -> dict[str, object]:
        """The window's features as GeoJSON; ReferenceUnavailableError when Overpass fails three times."""
        response = post_with_retries(self._http, Post(self._url, form={"data": query(bounds)}), self._sleep)
        if not response.is_success:
            raise ReferenceUnavailableError(f"Overpass answered HTTP {response.status_code}")
        return to_geojson(response.json())


def _line_pixels(coordinates: object, grid: Grid) -> NDArray[numpy.int32]:
    lng, lat = numpy.array(coordinates, numpy.float64).reshape(-1, 2).T
    u, v = grid.to_pixel(*to_mercator_arrays(lng, lat))
    return numpy.round(numpy.column_stack((u - 0.5, v - 0.5)) * (1 << SUBPIXEL_BITS)).astype(numpy.int32)


def _line_of(feature: object) -> tuple[list[object], int] | None:
    """A feature's coordinates and line width, or None for one that is not a line."""
    coordinates = _member(feature, "geometry", "coordinates")
    if not isinstance(coordinates, list) or len(coordinates) < MIN_LINE_POINTS:
        return None
    return coordinates, WIDTHS.get(str(_member(feature, "properties", "class")), DEFAULT_WIDTH)


def draw(features: dict[str, object], grid: Grid) -> UInt8Array:
    """The features drawn as white lines (by class width) on a black `grid`-sized image."""
    image = numpy.zeros((grid.height, grid.width), numpy.uint8)
    found = features.get("features")
    for line in map(_line_of, found if isinstance(found, list) else []):
        if line is not None:
            cv2.polylines(image, [_line_pixels(line[0], grid)], False, 255, line[1], cv2.LINE_AA, SUBPIXEL_BITS)
    return image


def _member(record: object, outer: str, inner: str) -> object:
    level = record.get(outer) if isinstance(record, dict) else None
    return level.get(inner) if isinstance(level, dict) else None
