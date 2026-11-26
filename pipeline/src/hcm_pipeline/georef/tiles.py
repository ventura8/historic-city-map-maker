"""Tile matching (docs/research/M4-interfaces.md §2.1 steps 2 and 4): the `osm` channel, and the `s2` fallback.

The `osm` channel matches the scan's lines against OpenStreetMap's: the scan side is the white and black top-hat of
the CLAHE'd pre-warped scan (its thin bright and dark lines; Canny's edges were tried first and followed the ground's
texture as much as the roads, 155 m off on the synthetic world against 13 m), the reference side the lines drawn at
10 m (`osm.draw`), carried to the level's grid, then `cv2.distanceTransform` turned into a proximity field normalized
to 0-255 (255 on a line, 0 from `FALLOFF_M` away), so a road drawn a little off its centre line still counts. The
`s2` channel uses the same tiles on its CLAHE'd grey image where a cell has no feature match. A tile is the cell's box
(at most `AUTO_GCP_TILE_PX` at 10 m a side), found in the reference within the level's search window by normalized
cross-correlation; its pair is its centre, and its margin is the correlation peak minus the next peak (a local
maximum) outside the peak's 3 x 3 neighbourhood, so a tile along one straight road, which slides along it, scores
almost nothing.
"""

from dataclasses import dataclass
from typing import Final

import cv2
import numpy
from numpy.typing import NDArray

from hcm_pipeline.georef.autogcp import AUTO_GCP_TILE_PX
from hcm_pipeline.georef.features import BoolArray, cell_box
from hcm_pipeline.images import UInt8Array, as_uint8, resize

FloatImage = NDArray[numpy.float32]

REFERENCE_RESOLUTION_M: Final = 10.0
FALLOFF_M: Final = 60.0
LINE_MAX_M: Final = 150.0
LINE_GAIN: Final = 2.0
# A tile is tried only where the scan covers this share of it, and kept only from this correlation peak.
MIN_COVERAGE: Final = 0.9
MIN_PEAK: Final = {"s2": 0.6, "osm": 0.3}
PEAK_NEIGHBOURHOOD: Final = 1
MIN_TILE_PX: Final = 4


def proximity(lines: UInt8Array, resolution_m: float) -> UInt8Array:
    """The lines (non-zero pixels) as a proximity field: 255 on a line, falling to 0 at `FALLOFF_M`."""
    away = cv2.distanceTransform(numpy.where(lines > 0, 0, 255).astype(numpy.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    falloff_px = max(FALLOFF_M / resolution_m, 1.0)
    return as_uint8(numpy.clip(255.0 * (1.0 - away / falloff_px), 0, 255))


def lines_at(lines: UInt8Array, size: tuple[int, int]) -> UInt8Array:
    """The 10 m line drawing on a coarser level's grid: a pixel any line crosses is a line pixel."""
    shrunk = resize(lines, size)
    return as_uint8(numpy.where(shrunk > 0, 255, 0))


def lines(image: UInt8Array, resolution_m: float) -> UInt8Array:
    """The thin bright and dark lines of a CLAHE'd image (roads, rails, banks): its white and black top-hat, the stronger.

    A top-hat keeps what is narrower than its disc (`LINE_MAX_M` across), so the ground's texture fades and lines stand out.
    """
    side = max(3, round(LINE_MAX_M / resolution_m)) | 1
    disc = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (side, side))
    white = cv2.morphologyEx(image, cv2.MORPH_TOPHAT, disc)
    black = cv2.morphologyEx(image, cv2.MORPH_BLACKHAT, disc)
    return as_uint8(numpy.clip(numpy.maximum(white, black).astype(numpy.float32) * LINE_GAIN, 0, 255))


@dataclass(frozen=True)
class TileMatch:
    """A tile's centre in the scan and in the reference, and its margin."""

    cell: int
    scan: tuple[float, float]
    reference: tuple[float, float]
    margin: float


@dataclass(frozen=True)
class _Box:
    x0: int
    y0: int
    x1: int
    y1: int


def tile_box(cell: int, size: tuple[int, int], resolution_m: float) -> _Box:
    """The cell's tile: the cell's box, at most `AUTO_GCP_TILE_PX` at 10 m a side, around the cell's centre."""
    cx, cy, half_w, half_h = cell_box(cell, *size)
    cap = AUTO_GCP_TILE_PX * REFERENCE_RESOLUTION_M / resolution_m / 2
    half_w, half_h = min(half_w, cap), min(half_h, cap)
    return _Box(round(cx - half_w), round(cy - half_h), round(cx + half_w), round(cy + half_h))


def peak_margin(response: FloatImage) -> tuple[float, tuple[int, int]]:
    """The correlation peak's margin over the next peak (a local maximum) outside its 3 x 3 neighbourhood, and its place."""
    _, peak, _, (x, y) = cv2.minMaxLoc(response)
    size = 2 * PEAK_NEIGHBOURHOOD + 1
    local = response >= cv2.dilate(response, numpy.ones((size, size), numpy.uint8))
    local[max(0, y - PEAK_NEIGHBOURHOOD) : y + PEAK_NEIGHBOURHOOD + 1, max(0, x - PEAK_NEIGHBOURHOOD) : x + PEAK_NEIGHBOURHOOD + 1] = False
    second = float(response[local].max()) if local.any() else 0.0
    return float(min(1.0, max(0.0, peak - max(second, 0.0)))), (int(x), int(y))


@dataclass(frozen=True)
class TileMatcher:
    """One channel's tiles on one level: the scan image, the reference image and the scan's coverage mask."""

    channel: str
    scan: UInt8Array
    reference: UInt8Array
    inside: BoolArray
    search_px: float
    resolution_m: float

    def tried(self, cell: int) -> bool:
        """The tile is big enough and the scan covers it."""
        box = tile_box(cell, (self.scan.shape[1], self.scan.shape[0]), self.resolution_m)
        if min(box.x1 - box.x0, box.y1 - box.y0) < MIN_TILE_PX:
            return False
        return float(self.inside[box.y0 : box.y1, box.x0 : box.x1].mean()) >= MIN_COVERAGE

    def match(self, cell: int) -> TileMatch | None:
        """The tile found in the reference, or None (a blank tile or reference, or a weak peak)."""
        height, width = self.scan.shape
        box = tile_box(cell, (width, height), self.resolution_m)
        tile = self.scan[box.y0 : box.y1, box.x0 : box.x1]
        reach = int(self.search_px)
        left, top = max(0, box.x0 - reach), max(0, box.y0 - reach)
        area = self.reference[top : min(height, box.y1 + reach), left : min(width, box.x1 + reach)]
        if float(tile.std()) == 0.0 or float(area.std()) == 0.0:
            return None
        response = numpy.asarray(cv2.matchTemplate(area, tile, cv2.TM_CCOEFF_NORMED), numpy.float32)
        peak = float(response.max())
        if peak < MIN_PEAK[self.channel]:
            return None
        margin, (x, y) = peak_margin(response)
        centre = ((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2)
        return TileMatch(cell, centre, (centre[0] + left + x - box.x0, centre[1] + top + y - box.y0), margin)
