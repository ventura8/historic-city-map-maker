"""How a series' tiles are encoded and how deep they go (docs/research/M20-import-local.md §6).

`lineart` (1-bit or two-tone scans): lossless WebP with a palette, nearest at the deepest zoom, the paper made transparent; `grey`: lossy
WebP as today; `colour`: lossy WebP in RGB. The maximum zoom follows the scan's ground resolution, `gsd = 25.4 mm / dpi x scale`, then
`zRes = floor(log2(156543.03 x cos(lat) / gsd))`, lowered until the estimated tiles fit `ARCHIVE_SERIES_MAX_BYTES`, and never past 21.
"""

import math
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from hcm_pipeline.archive.model import ARCHIVE_SERIES_MAX_BYTES, Probe

EQUATOR_M_PER_PX: Final = 156_543.03
INCH_M: Final = 0.0254
MAX_ZOOM: Final = 21
MIN_ZOOM: Final = 10
TILE_PX: Final = 256
# Bytes per 256 px tile, measured on lossless palette line art, WebP q80 grey and q82 colour (the scan's own sample replaces them).
TILE_BYTES: Final = {"lineart": 9_000, "grey": 22_000, "colour": 30_000}
# A pyramid holds about a third more tiles than its deepest zoom.
PYRAMID: Final = 4 / 3
# About one second a sheet to prepare on a home computer, and a thousand tiles a minute to encode (UNVERIFIED until §10 I).
SECONDS_PER_SHEET: Final = 1.0
TILES_PER_MINUTE: Final = 1_000
_RGB: Final = 3


def kind_of(probe: Probe) -> str:
    """Two-tone is line art, three bands or a palette colour, the rest grey."""
    if probe.bits == 1:
        return "lineart"
    return "colour" if probe.bands >= _RGB or probe.colour == "palette" else "grey"


def encoding_of(probes: Sequence[Probe]) -> str:
    """The series' encoding, by the most common kind of its scans (grey for none)."""
    kinds = Counter(map(kind_of, probes)).most_common(1)
    return kinds[0][0] if kinds else "grey"


def ground_m_per_px(dpi: float | None, scale: int | None) -> float | None:
    """Metres on the ground a scan pixel covers, when both the scan's dpi and the map's scale are known."""
    if not dpi or not scale:
        return None
    return INCH_M / dpi * scale


def resolution_zoom(gsd: float, latitude: float) -> int:
    """The deepest zoom whose pixel is no smaller than the scan's own, at most 21."""
    return min(MAX_ZOOM, max(MIN_ZOOM, math.floor(math.log2(EQUATOR_M_PER_PX * math.cos(math.radians(latitude)) / gsd))))


@dataclass(frozen=True)
class Estimate:
    """What the report shows of a series: its zoom, its tiles' bytes and the minutes on a home computer."""

    maxzoom: int
    tiles_bytes: int
    minutes: float


def tiles_at(area_m2: float, zoom: int, latitude: float) -> float:
    """About how many tiles cover `area_m2` at `zoom` (and the zooms above it)."""
    tile_m = EQUATOR_M_PER_PX * math.cos(math.radians(latitude)) * TILE_PX / math.ldexp(1.0, zoom)
    return area_m2 / tile_m**2 * PYRAMID


def estimate(area_m2: float, zoom: int, encoding: str, sheets: int, latitude: float) -> Estimate:
    """The deepest zoom at or under `zoom` whose tiles fit the series' byte budget, its bytes and its minutes."""
    per_tile = TILE_BYTES.get(encoding, TILE_BYTES["grey"])
    while zoom > MIN_ZOOM and tiles_at(area_m2, zoom, latitude) * per_tile > ARCHIVE_SERIES_MAX_BYTES:
        zoom -= 1
    tiles = tiles_at(area_m2, zoom, latitude)
    minutes = sheets * SECONDS_PER_SHEET / 60 + tiles / TILES_PER_MINUTE
    return Estimate(zoom, round(tiles * per_tile), round(minutes, 1))
