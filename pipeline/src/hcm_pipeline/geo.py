"""Spherical Web Mercator (EPSG:3857) arithmetic shared by every georeferencing step.

Conventions of docs/research/M3-interfaces.md §6.1: places are WGS84 `{lat, lng}`, fits and rasters run in
EPSG:3857 metres (R = 6,378,137 m), and distances on the ground are Mercator distances times the cosine of the
latitude. A raster grid is a north-up box in Mercator metres with a square pixel size; pixel coordinates are
GDAL's (the top-left corner of the top-left pixel is (0, 0)).
"""

import math
from dataclasses import dataclass
from typing import Final

import numpy
from numpy.typing import NDArray

EARTH_RADIUS_M: Final = 6_378_137.0
# The width of a 256 px tile at zoom 0, divided by 256: metres per pixel at zoom 0 (`156543.03392804097 / 2^z`).
ZOOM0_RESOLUTION_M: Final = 2 * math.pi * EARTH_RADIUS_M / 256
WINDOW_MARGIN: Final = 0.10
# Longitude 180 in EPSG:3857 metres: a city's window stops here, and a place is never written past it (`lngSchema`).
WORLD_HALF_M: Final = math.pi * EARTH_RADIUS_M
FULL_TURN_DEG: Final = 360.0
HALF_TURN_DEG: Final = 180.0

FloatArray = NDArray[numpy.float64]


def to_mercator(lng: float, lat: float) -> tuple[float, float]:
    """WGS84 degrees to EPSG:3857 metres."""
    return EARTH_RADIUS_M * math.radians(lng), EARTH_RADIUS_M * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def to_lnglat(x: float, y: float) -> tuple[float, float]:
    """EPSG:3857 metres to WGS84 degrees `(lng, lat)`."""
    return math.degrees(x / EARTH_RADIUS_M), math.degrees(2 * math.atan(math.exp(y / EARTH_RADIUS_M)) - math.pi / 2)


def to_mercator_arrays(lng: FloatArray, lat: FloatArray) -> tuple[FloatArray, FloatArray]:
    """`to_mercator` over arrays."""
    return EARTH_RADIUS_M * numpy.radians(lng), EARTH_RADIUS_M * numpy.log(numpy.tan(numpy.pi / 4 + numpy.radians(lat) / 2))


def to_lnglat_arrays(x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray]:
    """`to_lnglat` over arrays."""
    return numpy.degrees(x / EARTH_RADIUS_M), numpy.degrees(2 * numpy.arctan(numpy.exp(y / EARTH_RADIUS_M)) - numpy.pi / 2)


def near_lng(lng: float, middle: float) -> float:
    """`lng` a whole number of turns from where it was, on the side of `middle`: a frame over longitude 180 is one piece around a city."""
    return lng + FULL_TURN_DEG * round((middle - lng) / FULL_TURN_DEG)


def _required_number(record: dict[object, object], key: str) -> float:
    value = record.get(key)
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError(f"{key} must be a number")
    return float(value)


def numbers_of(record: object, keys: tuple[str, ...]) -> list[float]:
    """The numbers a document record holds under `keys`, in order; ValueError when one is missing or not a number."""
    if not isinstance(record, dict):
        raise ValueError(f"expected a record of {', '.join(keys)}")
    return [_required_number(record, key) for key in keys]


def ground_scale(lat: float) -> float:
    """Ground metres per Mercator metre at `lat`."""
    return math.cos(math.radians(lat))


def zoom_resolution(zoom: int) -> float:
    """Mercator metres per pixel of the tile grid at `zoom`."""
    return ZOOM0_RESOLUTION_M / (1 << zoom)


@dataclass(frozen=True)
class Bounds:
    """A WGS84 box `{west, south, east, north}` (the `boundsRecordSchema` of `@hcm/shared`)."""

    west: float
    south: float
    east: float
    north: float

    @classmethod
    def of(cls, record: object) -> Bounds:
        """The bounds of a document's `{west, south, east, north}` record; ValueError when it is not one."""
        west, south, east, north = numbers_of(record, ("west", "south", "east", "north"))
        if not (west < east and south < north):
            raise ValueError("bounds must have west < east and south < north")
        return cls(west, south, east, north)

    def as_record(self, digits: int = 6) -> dict[str, float]:
        return {key: round(value, digits) for key, value in zip(("west", "south", "east", "north"), self.values(), strict=True)}

    def values(self) -> tuple[float, float, float, float]:
        return self.west, self.south, self.east, self.north

    def mercator(self) -> MercatorBox:
        left, bottom = to_mercator(self.west, self.south)
        right, top = to_mercator(self.east, self.north)
        return MercatorBox(left, bottom, right, top)

    @property
    def middle_lat(self) -> float:
        return (self.south + self.north) / 2


@dataclass(frozen=True)
class MercatorBox:
    """A north-up box in EPSG:3857 metres."""

    left: float
    bottom: float
    right: float
    top: float

    @property
    def width(self) -> float:
        return self.right - self.left

    @property
    def height(self) -> float:
        return self.top - self.bottom

    def expanded(self, margin: float = WINDOW_MARGIN) -> MercatorBox:
        """The box grown by `margin` of its width and height on every side (the city window: bounds ± 10 %), stopping at longitude 180:
        `bboxSchema` holds no box across it, and what a window asks of Sentinel-2 and Overpass stays a plain box."""
        dx, dy = self.width * margin, self.height * margin
        return MercatorBox(max(self.left - dx, -WORLD_HALF_M), self.bottom - dy, min(self.right + dx, WORLD_HALF_M), self.top + dy)

    def bounds(self) -> Bounds:
        west, south = to_lnglat(self.left, self.bottom)
        east, north = to_lnglat(self.right, self.top)
        return Bounds(max(west, -HALF_TURN_DEG), south, min(east, HALF_TURN_DEG), north)

    @property
    def middle_lng(self) -> float:
        return to_lnglat((self.left + self.right) / 2, 0.0)[0]

    def key(self) -> str:
        """A stable text of the box (metre precision): the reference cache's window key."""
        return ",".join(f"{value:.0f}" for value in (self.left, self.bottom, self.right, self.top))


@dataclass(frozen=True)
class Grid:
    """A north-up raster grid over a Mercator box: `size` pixels of `resolution` metres from (`left`, `top`)."""

    left: float
    top: float
    resolution: float
    width: int
    height: int

    @classmethod
    def over(cls, box: MercatorBox, resolution: float) -> Grid:
        width = max(1, math.ceil(box.width / resolution))
        height = max(1, math.ceil(box.height / resolution))
        return cls(box.left, box.top, resolution, width, height)

    def geotransform(self) -> tuple[float, float, float, float, float, float]:
        return (self.left, self.resolution, 0.0, self.top, 0.0, -self.resolution)

    def box(self) -> MercatorBox:
        return MercatorBox(self.left, self.top - self.height * self.resolution, self.left + self.width * self.resolution, self.top)

    def scaled(self, factor: int) -> Grid:
        """The same box with pixels `factor` times larger (a pyramid level)."""
        return Grid(self.left, self.top, self.resolution * factor, max(1, self.width // factor), max(1, self.height // factor))

    def to_mercator(self, u: FloatArray, v: FloatArray) -> tuple[FloatArray, FloatArray]:
        """Grid pixel coordinates (corner convention) to Mercator metres."""
        return self.left + u * self.resolution, self.top - v * self.resolution

    def to_pixel(self, x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray]:
        """Mercator metres to grid pixel coordinates (corner convention)."""
        return (x - self.left) / self.resolution, (self.top - y) / self.resolution

    def centres(self) -> tuple[FloatArray, FloatArray]:
        """The Mercator coordinates of every pixel centre, as two (height, width) arrays."""
        u, v = numpy.meshgrid(numpy.arange(self.width) + 0.5, numpy.arange(self.height) + 0.5)
        return self.to_mercator(u.astype(numpy.float64), v.astype(numpy.float64))


def fnv1a(text: str) -> str:
    """The 64-bit FNV-1a hash of `text` as 16 hex digits (the reference cache's key)."""
    value = 0xCBF29CE484222325
    for byte in text.encode("utf-8"):
        value = ((value ^ byte) * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return f"{value:016x}"
