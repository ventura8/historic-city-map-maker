"""Measure: every tile of the Sentinel-2 window against the film through a rough map (docs/research/M9-calibration.md §4).

The film under the map is read averaged at about 5 ground metres a pixel, warped onto the reference's own grid (a whole factor
coarser where 10 m Mercator is under about 5 m ground, so 60 degrees and the equator see the same ground) and each 900 m tile searched
for over 600 m, halving; a tile counts with a clear peak; RANSAC refits, three times. No landmark, no pair of any human: F007 and F006
gave 697 and 414 inliers from a vote's proposal in 21 to 25 s on 4 cores.
"""

import math
from collections.abc import Callable
from dataclasses import dataclass
from typing import Final, Protocol

import cv2
import numpy

from hcm_pipeline.calibrate.poly import Image, Mask, PlaceMap, Poly, PolyMap, pixel_ground_m, robust_fit
from hcm_pipeline.geo import FloatArray, Grid, MercatorBox, ground_scale
from hcm_pipeline.georef.corners import MIN_CROP_PX
from hcm_pipeline.images import UInt8Array

PROOF_READ_GROUND_M: Final = 5.0
PROOF_TILE_GROUND_M: Final = 900.0
PROOF_SEARCH_GROUND_M: Final = 600.0
PROOF_MIN_SEARCH_CELLS: Final = 10
PROOF_ITERATIONS: Final = 3
PROOF_MIN_PEAK: Final = 0.2
PROOF_MIN_MARGIN: Final = 0.03
PROOF_RANSAC_M: Final = 25.0
# The second best is the best place at least this many cells from the peak.
SECOND_PEAK_CELLS: Final = 8
TILE_MIN_VALID: Final = 0.98
REFERENCE_MIN_GROUND_M: Final = 5.0
# The maps are computed on a coarse grid and enlarged: a polynomial is smooth, and 32 million evaluations are not.
MAP_STEP_CELLS: Final = 16
GRADIENT_BLUR_CELLS: Final = 1.2
WIDE_BLUR_CELLS: Final = 15.0
# A row: film x, film y, EPSG:3857 x, y, peak, margin.
ROW_COLUMNS: Final = 6
# A peak flatter than this has no sub-cell place.
FLAT_CURVE: Final = 1e-6
# `cv2.remap` asserts every side of its source and its result under 32 767 pixels (matcher.REMAP_MAX_PX twin).
REMAP_MAX_PX: Final = 32_766
Box = tuple[int, int, int, int]


class FilmReader(Protocol):
    """The film (a frame's segments, or a scan), read by windows, averaged `factor` times."""

    def read(self, box: Box, factor: int) -> UInt8Array: ...


def film_filter(image: Image, valid: Image) -> Image:
    """The tile's filter: the log of the gradient's size, less its wide blur, zero where there is no data."""
    magnitude = numpy.asarray(cv2.magnitude(cv2.Sobel(image, cv2.CV_32F, 1, 0), cv2.Sobel(image, cv2.CV_32F, 0, 1)), numpy.float32)
    logged = numpy.log1p(numpy.asarray(cv2.GaussianBlur(magnitude, (0, 0), GRADIENT_BLUR_CELLS), numpy.float32))
    filtered = logged - numpy.asarray(cv2.GaussianBlur(logged, (0, 0), WIDE_BLUR_CELLS), numpy.float32)
    filtered[valid == 0] = 0
    return numpy.asarray(filtered, numpy.float32)


@dataclass(frozen=True)
class DenseGrid:
    """The reference on its measuring grid, with its filter; the tile, step and first search in cells."""

    grid: Grid
    valid: Image
    filtered: Image
    tile: int
    step: int
    search: int

    @property
    def ground(self) -> float:
        return ground_scale(self.grid.box().bounds().middle_lat)


def dense_grid(reference: UInt8Array, grid: Grid, search_ground_m: float = PROOF_SEARCH_GROUND_M) -> DenseGrid:
    """The reference (10 m Mercator) as measured: coarser by a whole factor where a cell is under about 5 ground metres."""
    ground = ground_scale(grid.box().bounds().middle_lat)
    factor = max(1, round(REFERENCE_MIN_GROUND_M / (grid.resolution * ground)))
    size = (max(1, grid.width // factor), max(1, grid.height // factor))
    image = numpy.asarray(cv2.resize(reference.astype(numpy.float32), size, interpolation=cv2.INTER_AREA), numpy.float32)
    valid = numpy.asarray(image > 0, numpy.float32)
    measuring = grid.scaled(factor)
    cell = measuring.resolution * ground
    tile = max(16, round(PROOF_TILE_GROUND_M / cell))
    return DenseGrid(measuring, valid, film_filter(image, valid), tile, tile // 2, round(search_ground_m / cell))


@dataclass(frozen=True)
class FilmWindow:
    """The film read for a proof: its pixels and where in the film they lie."""

    pixels: UInt8Array
    left: int
    top: int
    factor: int
    limits: tuple[int, int, int]

    def to_read(self, film: FloatArray) -> FloatArray:
        """Film pixels to this read's cell indices (a cell's centre is its index)."""
        return (film - [self.left, self.top]) / self.factor - 0.5

    def to_film(self, read: FloatArray) -> FloatArray:
        return (read + 0.5) * self.factor + [self.left, self.top]

    @property
    def box(self) -> tuple[float, float, float, float]:
        height, width = self.pixels.shape
        return (float(self.left), float(self.top), float(self.left + width * self.factor), float(self.top + height * self.factor))


def film_box(mapping: PlaceMap, box: MercatorBox, limits: tuple[int, int, int]) -> Box | None:
    """The film pixels `box` maps onto (a grid of it, not its corners: a polynomial bends), clipped to the film; None when it misses."""
    u, v = numpy.meshgrid(numpy.linspace(box.left, box.right, 9), numpy.linspace(box.bottom, box.top, 9))
    film = mapping.to_film(numpy.column_stack((u.ravel(), v.ravel())))
    left, top = max(limits[2], math.floor(film[:, 0].min())), max(0, math.floor(film[:, 1].min()))
    right, bottom = min(limits[0], math.ceil(film[:, 0].max())), min(limits[1], math.ceil(film[:, 1].max()))
    return (left, top, right, bottom) if min(right - left, bottom - top) >= MIN_CROP_PX else None


def _read_factor(mapping: PlaceMap, box: Box) -> int:
    centre = numpy.array([[(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]])
    return max(1, round(PROOF_READ_GROUND_M / max(pixel_ground_m(mapping, centre), 1e-6)))


def read_film(
    mapping: PlaceMap, window: MercatorBox, reader: FilmReader, limits: tuple[int, int, int], reach_m: float
) -> FilmWindow | None:
    """The film under `window` plus the search's reach, at about 5 ground metres a pixel."""
    wide = MercatorBox(window.left - reach_m, window.bottom - reach_m, window.right + reach_m, window.top + reach_m)
    box = film_box(mapping, wide, limits)
    if box is None:
        return None
    factor = _read_factor(mapping, box)
    return FilmWindow(reader.read(box, factor), box[0], box[1], factor, limits)


def _enlarged(coarse: FloatArray, size: tuple[int, int]) -> Image:
    """Nodes every `MAP_STEP_CELLS` to every cell (width, height), linearly: one axis, then the other."""

    def along(values: FloatArray, count: int, axis: int) -> FloatArray:
        low = numpy.arange(count) // MAP_STEP_CELLS
        part = (numpy.arange(count) % MAP_STEP_CELLS) / MAP_STEP_CELLS
        share = part.reshape((-1, 1) if axis == 0 else (1, -1))
        return numpy.asarray(numpy.take(values, low, axis) * (1 - share) + numpy.take(values, low + 1, axis) * share, numpy.float64)

    return numpy.asarray(along(along(coarse, size[0], 1), size[1], 0), numpy.float32)


def _coarse_maps(mapping: PlaceMap, film: FilmWindow, grid: Grid) -> tuple[Image, Image]:
    """For each cell of `grid`, the read cell that shows its place: computed every `MAP_STEP_CELLS`, enlarged."""
    columns = numpy.arange(0, grid.width + 2 * MAP_STEP_CELLS, MAP_STEP_CELLS, dtype=numpy.float64)
    rows = numpy.arange(0, grid.height + 2 * MAP_STEP_CELLS, MAP_STEP_CELLS, dtype=numpy.float64)
    u, v = numpy.meshgrid(columns, rows)
    mx, my = grid.to_mercator(u + 0.5, v + 0.5)
    read = film.to_read(mapping.to_film(numpy.column_stack((mx.ravel(), my.ravel()))))
    size = (grid.width, grid.height)
    return _enlarged(read[:, 0].reshape(u.shape), size), _enlarged(read[:, 1].reshape(u.shape), size)


@dataclass(frozen=True)
class WarpedFilm:
    """The film on the reference's grid: its filter, where it lies, and the maps back to the read."""

    filtered: Image
    valid: Image
    map_x: Image
    map_y: Image


def _remap_bounded(source: Image, map_x: Image, map_y: Image) -> Image:
    """`cv2.remap` of `source` through `map_x`/`map_y`, shrinking the source when a side is more than remap takes.

    A full Corona film crop after the owner's corner points can be about one hundred thousand pixels wide; OpenCV refuses that.
    The returned maps stay in the original source's coordinates (callers keep them for film ties); only the sample is downscaled.
    """
    height, width = source.shape[:2]
    applied = max(1.0, max(width, height) / REMAP_MAX_PX)
    if applied > 1.0:
        size = (max(1, round(width / applied)), max(1, round(height / applied)))
        scale_x, scale_y = width / size[0], height / size[1]
        source = numpy.asarray(cv2.resize(source, size, interpolation=cv2.INTER_AREA), numpy.float32)
        map_x = (map_x + 0.5) / scale_x - 0.5
        map_y = (map_y + 0.5) / scale_y - 0.5
    return numpy.asarray(
        cv2.remap(source, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0),
        numpy.float32,
    )


def warp_film(film: FilmWindow, mapping: PlaceMap, grid: Grid) -> WarpedFilm:
    """The read film warped onto `grid` through `mapping`."""
    map_x, map_y = _coarse_maps(mapping, film, grid)
    # Plus 1: a warped 0 is no film, whatever the film's darkest grey.
    image = _remap_bounded(film.pixels.astype(numpy.float32) + 1, map_x, map_y)
    valid = numpy.asarray(image > 0, numpy.float32)
    return WarpedFilm(film_filter(image, valid), valid, map_x, map_y)


def _sub_cell(left: float, peak: float, right: float) -> float:
    curve = left - 2 * peak + right
    return 0.0 if abs(curve) < FLAT_CURVE else 0.5 * (left - right) / curve


def _peak_of(scores: Image) -> tuple[float, float, float, float] | None:
    """The peak's offset within `scores`, with sub-cell steps, its value and its margin over the best place far from it; None on the
    search's edge: a tile that wants to go further is not measured."""
    _, peak, _, at = cv2.minMaxLoc(scores)
    x, y = at
    if not (0 < x < scores.shape[1] - 1 and 0 < y < scores.shape[0] - 1):
        return None
    far = scores.copy()
    far[max(y - SECOND_PEAK_CELLS, 0) : y + SECOND_PEAK_CELLS + 1, max(x - SECOND_PEAK_CELLS, 0) : x + SECOND_PEAK_CELLS + 1] = -1
    dx = x + _sub_cell(float(scores[y, x - 1]), peak, float(scores[y, x + 1]))
    dy = y + _sub_cell(float(scores[y - 1, x]), peak, float(scores[y + 1, x]))
    return dx, dy, peak, peak - float(far.max())


TileRow = tuple[float, float, float, float, float, float]


def _tile_row(warped: WarpedFilm, reference: DenseGrid, place: tuple[int, int], search: int) -> TileRow | None:
    """A tile with a whole search area on film: its centre, where it shows in the warp, peak and margin; None without."""
    v, u = place
    tile = reference.tile
    top, bottom, left, right = v - search, v + tile + search, u - search, u + tile + search
    if warped.valid[top:bottom, left:right].mean() < TILE_MIN_VALID or reference.valid[v : v + tile, u : u + tile].mean() < TILE_MIN_VALID:
        return None
    scores = cv2.matchTemplate(
        warped.filtered[top:bottom, left:right], reference.filtered[v : v + tile, u : u + tile], cv2.TM_CCOEFF_NORMED
    )
    found = _peak_of(numpy.asarray(scores, numpy.float32))
    if found is None:
        return None
    half = tile / 2
    return u + half, v + half, u + half + found[0] - search, v + half + found[1] - search, found[2], found[3]


def _tile_rows(warped: WarpedFilm, reference: DenseGrid, search: int, tick: Callable[[], None]) -> list[TileRow]:
    """Every tile's row, a checkpoint between the grid's lines."""
    rows: list[TileRow] = []
    height, width = warped.valid.shape
    for v in range(search, height - reference.tile - search, reference.step):
        tick()
        found = (_tile_row(warped, reference, (v, u), search) for u in range(search, width - reference.tile - search, reference.step))
        rows += [row for row in found if row is not None]
    return rows


def _measured_rows(found: list[TileRow], warped: WarpedFilm, film: FilmWindow, grid: Grid) -> FloatArray:
    """The tiles as rows: where they lie on the film and on the ground."""
    if not found:
        return numpy.empty((0, ROW_COLUMNS))
    cells = numpy.array(found, numpy.float64)
    # The maps are indexed by cell centres, the tile's place counts from corners: half a cell.
    x, y = (cells[:, 2] - 0.5).astype(numpy.float32).reshape(-1, 1), (cells[:, 3] - 0.5).astype(numpy.float32).reshape(-1, 1)
    read_x = numpy.asarray(cv2.remap(warped.map_x, x, y, cv2.INTER_LINEAR), numpy.float64).ravel()
    read_y = numpy.asarray(cv2.remap(warped.map_y, x, y, cv2.INTER_LINEAR), numpy.float64).ravel()
    place_x, place_y = grid.to_mercator(cells[:, 0], cells[:, 1])
    return numpy.column_stack((film.to_film(numpy.column_stack((read_x, read_y))), place_x, place_y, cells[:, 4], cells[:, 5]))


def good_rows(rows: FloatArray) -> FloatArray:
    return rows[(rows[:, 4] >= PROOF_MIN_PEAK) & (rows[:, 5] >= PROOF_MIN_MARGIN)]


EMPTY_ROWS: Final[FloatArray] = numpy.empty((0, ROW_COLUMNS))


@dataclass(frozen=True)
class Measured:
    """What the tiles say of a map: `rows`, the tiles that count; the polynomial they hold (None: too few) and its inliers."""

    rows: FloatArray
    forward: Poly | None
    inliers: Mask
    covered: float
    mapping: PlaceMap | None
    film: FilmWindow | None


def _better(rows: FloatArray, orders: tuple[int, ...], seed: int) -> tuple[Poly, Mask] | None:
    """The order most tiles hold, a higher one only for a clear gain: a polynomial bends to noise too."""
    best = None
    for order in orders:
        found = robust_fit(rows[:, :2], rows[:, 2:4], order, PROOF_RANSAC_M, seed)
        if found is not None and (best is None or numpy.count_nonzero(found[1]) > numpy.count_nonzero(best[1]) * 1.1):
            best = found
    return best


NO_INLIERS: Final[Mask] = numpy.zeros(0, numpy.bool_)


def nothing_measured() -> Measured:
    """What a proposal measures whose film does not reach the window."""
    return Measured(EMPTY_ROWS, None, NO_INLIERS, 0.0, None, None)


def measure(start: PlaceMap, reference: DenseGrid, film: FilmWindow, seed: int, tick: Callable[[], None]) -> Measured:
    """Three rounds of tiles and refits from `start`; each narrows the search and bends the map closer."""
    mapping, search, measured = start, reference.search, Measured(EMPTY_ROWS, None, NO_INLIERS, 0.0, None, film)
    for iteration in range(PROOF_ITERATIONS):
        warped = warp_film(film, mapping, reference.grid)
        covered = float((warped.valid * reference.valid).mean())
        rows = good_rows(_measured_rows(_tile_rows(warped, reference, search, tick), warped, film, reference.grid))
        found = _better(rows, (1, 2) if iteration == 0 else (2,), seed)
        if found is None:
            return Measured(rows, measured.forward, NO_INLIERS, covered, measured.mapping, film)
        mapping = PolyMap.over(found[0], film.box)
        measured = Measured(rows, found[0], found[1], covered, mapping, film)
        search = max(search // 2, PROOF_MIN_SEARCH_CELLS)
    return measured
