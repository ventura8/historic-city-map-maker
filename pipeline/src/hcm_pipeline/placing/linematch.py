"""A georeferenced file's drawn lines matched against OpenStreetMap's, tile by tile (the embedded placer's ruler).

A file's own georeference can be coarse: the Planuri Directoare de Tragere scans carry their sheet-index corners, 160 to 250 m east
of the truth on every sheet (finding of 2026-11-24, docs/LESSONS.md 801). Junctions found on such a sheet are too noisy to agree on
a shift, so the ruler matches lines instead: the file's street centre lines (`streets`), and its dark ink where those are not found,
in tiles of `TILE_M`, each slid over OpenStreetMap's blurred lines within `REACH_M`; a tile counts when its best place stands out
(`PEAK_RATIO` over the best one `PEAK_GAP_M` away). The clear tiles' offsets give a robust affine correction (started from their
shared offset, outliers dropped over `ROUNDS`), kept only when at least `MIN_TILES` tiles and `MIN_KEPT_SHARE` of them agree: then
its median offset is the file's disagreement and the affine the correction offered as georeferencer suggestions.
"""

from dataclasses import dataclass
from typing import Final

import cv2
import numpy

from hcm_pipeline.geo import Grid

FloatArray = numpy.ndarray
TILE_M: Final = 2400.0
# At least this many tiles across the shorter side, so a small file still has enough of them.
TILES_ACROSS: Final = 4
REACH_M: Final = 400.0
PEAK_GAP_M: Final = 50.0
PEAK_RATIO: Final = 1.15
MIN_TILES: Final = 8
MIN_KEPT_SHARE: Final = 0.35
ROUNDS: Final = 4
KEEP_FACTOR: Final = 3.0
KEEP_FLOOR_M: Final = 15.0
# Tiles further than this from the fit never agree with it, however scattered the others.
KEEP_LIMIT_M: Final = 80.0
MIN_INK: Final = 1.0
BACKGROUND_M: Final = 150.0
INK_CAP: Final = 80.0


@dataclass(frozen=True)
class Correction:
    """The affine (Mercator to Mercator, 2 x 3) the clear tiles agree on and their median offset before it (Mercator metres)."""

    matrix: FloatArray
    offset_m: float
    tiles: int

    def apply(self, points: FloatArray) -> FloatArray:
        return numpy.asarray(numpy.column_stack((points, numpy.ones(len(points)))) @ self.matrix.T, numpy.float64)


def ink_of(grey: numpy.ndarray, resolution: float) -> numpy.ndarray:
    """A drawing's dark lines: how much darker each pixel is than its surroundings, capped and lightly blurred (a sheet whose street
    network is not found, as the PDT sheets' hatched blocks)."""
    size = max(3, int(BACKGROUND_M / resolution) | 1)
    image = grey.astype(numpy.float32)
    background = cv2.blur(image, (size, size))
    return numpy.asarray(cv2.GaussianBlur(numpy.clip(background - image, 0.0, INK_CAP), (0, 0), 1.5), numpy.float32)


def best_of(found: list[Correction | None]) -> Correction | None:
    """The correction more tiles agree on, of those found."""
    return max((each for each in found if each is not None), key=lambda each: each.tiles, default=None)


def lines_of(skeleton: numpy.ndarray) -> numpy.ndarray:
    """Centre lines (the file's street network or OpenStreetMap's) thickened and blurred, so a tile scores by how near they run."""
    thick = cv2.dilate((skeleton > 0).astype(numpy.uint8), numpy.ones((3, 3), numpy.uint8))
    return numpy.asarray(cv2.GaussianBlur(thick.astype(numpy.float32), (0, 0), 2.0), numpy.float32)


def _tile_offset(ink: numpy.ndarray, lines: numpy.ndarray, gap_px: int) -> tuple[int, int] | None:
    """Where the tile's lines sit best on the reference (pixels from the middle), or None when no place stands out."""
    if float(ink.sum()) < MIN_INK or float(ink.std()) == 0.0:
        return None
    scores = cv2.matchTemplate(lines, ink, cv2.TM_CCOEFF_NORMED)
    _low, best, _at_low, at = cv2.minMaxLoc(scores)
    others = scores.copy()
    cv2.circle(others, at, gap_px, -1.0, -1)
    if best <= 0 or best < PEAK_RATIO * max(float(others.max()), 1e-6):
        return None
    return at[0], at[1]


def offsets(grid: Grid, ink: numpy.ndarray, lines: numpy.ndarray) -> FloatArray:
    """The clear tiles as rows (tile centre x, y, where it belongs x, y) in Mercator metres."""
    tile = max(16, min(int(TILE_M / grid.resolution), min(grid.width, grid.height) // TILES_ACROSS))
    reach = max(2, int(REACH_M / grid.resolution))
    gap = max(2, int(PEAK_GAP_M / grid.resolution))
    rows: list[tuple[float, float, float, float]] = []
    for top in range(reach, grid.height - tile - reach + 1, tile // 2):
        for left in range(reach, grid.width - tile - reach + 1, tile // 2):
            window = lines[top - reach : top + tile + reach, left - reach : left + tile + reach]
            found = _tile_offset(ink[top : top + tile, left : left + tile], window, gap)
            if found is not None:
                rows.append(_row(grid, left + tile / 2, top + tile / 2, found[0] - reach, found[1] - reach))
    return numpy.array(rows, numpy.float64).reshape(-1, 4)


def _row(grid: Grid, x: float, y: float, dx: int, dy: int) -> tuple[float, float, float, float]:
    cx, cy = grid.left + x * grid.resolution, grid.top - y * grid.resolution
    return cx, cy, cx + dx * grid.resolution, cy - dy * grid.resolution


def _fit(rows: FloatArray, keep: numpy.ndarray) -> tuple[FloatArray, FloatArray]:
    design = numpy.column_stack((rows[:, :2], numpy.ones(len(rows))))
    solution, *_ = numpy.linalg.lstsq(design[keep], rows[keep, 2:4], rcond=None)
    return solution.T, numpy.hypot(*(design @ solution - rows[:, 2:4]).T)


def correction(rows: FloatArray) -> Correction | None:
    """The affine the clear tiles agree on, or None when too few tiles are clear or too few of them agree."""
    if len(rows) < MIN_TILES:
        return None
    moves = rows[:, 2:4] - rows[:, :2]
    # Start from the offset most tiles share, so scattered tiles never pull the first fit.
    keep = numpy.hypot(*(moves - numpy.median(moves, axis=0)).T) < KEEP_LIMIT_M
    for _ in range(ROUNDS):
        if keep.sum() < MIN_TILES:
            return None
        matrix, residual = _fit(rows, keep)
        keep = residual < min(max(KEEP_FACTOR * float(numpy.median(residual[keep])), KEEP_FLOOR_M), KEEP_LIMIT_M)
    if keep.sum() < max(MIN_TILES, MIN_KEPT_SHARE * len(rows)):
        return None
    moved = numpy.hypot(*moves[keep].T)
    return Correction(numpy.asarray(matrix, numpy.float64), float(numpy.median(moved)), int(keep.sum()))
