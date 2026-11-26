"""Propose: where a frame's film may lie, by tiles of the reference voting for a shift (docs/research/M9-calibration.md §2).

The frame goes once per hypothesis (an orientation, a scale) onto a coarse grid around the window. Each tile of the reference asks
where it matches best, on a filter that keeps gradients and flattens tone; a similarity over the tiles' answers is the proposal. A
tile tolerates a few percent of scale and a degree of rotation, so one warp per orientation does what a grid of 48 warps did
(`vote2.py`, 5 minutes on 14 processes; this: 52 s on one core, 0.48 GB). A place the frame covers partly cannot win: unmasked, every
tile peaked on the frame's edge, a confident false consensus. The budget is a count of matches, not seconds: the result is the same
on every machine. A proposal is only a proposal: the proof decides (`proof.py`).
"""

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from typing import Final

import cv2
import numpy
from numpy.typing import NDArray

from hcm_pipeline.calibrate.poly import Image, Mask
from hcm_pipeline.geo import FloatArray, Grid, ground_scale
from hcm_pipeline.georef.corners import Assignment, Frame, apply
from hcm_pipeline.images import UInt8Array

VOTE_CELL_GROUND_M: Final = 43.0
VOTE_TILE_CELLS: Final = 64
VOTE_SIDE_MAX_PX: Final = 2400
# A small town's window holds few tiles at 43 m: a finer cell, down to what the preview holds, over this many cells a side.
VOTE_CELL_MIN_GROUND_M: Final = 30.0
VOTE_WINDOW_MIN_CELLS: Final = 200
# And smaller tiles: at least this many fit a window's short side, each at least `VOTE_TILE_MIN_CELLS`. A city's are all 64.
VOTE_WINDOW_TILES: Final = 5
VOTE_TILE_MIN_CELLS: Final = 24
VOTE_TILE_BUDGET: Final = 720
# What a warp may not get less of, however many warps share the budget: the real frames' true warps agree on 7 to 11 % of the tiles asked
# (13 to 22 of 196), so `VOTE_MIN_AGREE` is out of reach under about 100, and 60 tiles a warp found no real frame at all. A sensor with
# more than four warps spends more: it is the only way a frame of it reaches the proof.
VOTE_WARP_MIN_TILES: Final = 180
VOTE_PLACE_COVERAGE: Final = 0.9
VOTE_MIN_PEAK: Final = 0.12
VOTE_RANSAC_CELLS: Final = 3.0
VOTE_MIN_AGREE: Final = 8
VOTE_MIN_HULL: Final = 0.05
VOTE_SCALE_TOLERANCE: Final = 0.12
VOTE_ROTATION_DEG: Final = 3.0
VOTE_MERGE_GROUND_M: Final = 1000.0
VOTE_STOP_AGREE: Final = 16
# A tile whose reference is mostly no data, or flat, is not asked.
TILE_MIN_VALID: Final = 0.95
FLAT_SPREAD: Final = 1e-3
GRADIENT_BLUR_CELLS: Final = 1.0
# The filter's wide blur, as a share of the tile's side (`vote3.py`'s 64 / 10.5).
WIDE_BLUR_SHARE: Final = 1 / 10.5
MIN_CONSENSUS_VOTES: Final = 4
RANSAC_ITERATIONS: Final = 2000
RANSAC_CONFIDENCE: Final = 0.999
RANSAC_REFINES: Final = 5


def gradient_filter(image: Image, valid: NDArray[numpy.generic], tile_cells: int) -> Image:
    """The log of the gradient's size, less its wide blur, zero where there is no data."""
    smooth = numpy.asarray(cv2.magnitude(cv2.Sobel(image, cv2.CV_32F, 1, 0), cv2.Sobel(image, cv2.CV_32F, 0, 1)), numpy.float32)
    logged = numpy.log1p(numpy.asarray(cv2.GaussianBlur(smooth, (0, 0), GRADIENT_BLUR_CELLS), numpy.float32))
    filtered = logged - numpy.asarray(cv2.GaussianBlur(logged, (0, 0), tile_cells * WIDE_BLUR_SHARE), numpy.float32)
    filtered[valid == 0] = 0
    return numpy.asarray(filtered, numpy.float32)


@dataclass(frozen=True)
class VoteGrid:
    """The reference on the votes' coarse grid (its filter and the places a tile may be asked from)."""

    grid: Grid
    filtered: Image
    valid: UInt8Array
    ground_scale: float
    tile_cells: int = VOTE_TILE_CELLS

    def tile(self, place: tuple[int, int]) -> Image:
        v, u = place
        return self.filtered[v : v + self.tile_cells, u : u + self.tile_cells]


def _cell_size(grid: Grid, margin_ground_m: float, ground: float) -> float:
    """A cell's EPSG:3857 metres: 43 ground metres (finer for a small window), coarser when the search image's side would be over
    `VOTE_SIDE_MAX_PX`."""
    window = max(grid.width, grid.height) * grid.resolution
    side = window + 2 * margin_ground_m / ground
    wanted = min(VOTE_CELL_GROUND_M / ground, max(VOTE_CELL_MIN_GROUND_M / ground, window / VOTE_WINDOW_MIN_CELLS))
    return max(wanted, side / VOTE_SIDE_MAX_PX)


def tile_places(valid: UInt8Array, count: int, tile: int = VOTE_TILE_CELLS) -> list[tuple[int, int]]:
    """About `count` tiles' top-left cells on a regular grid, half a tile apart at the finest, where the reference has data."""
    height, width = valid.shape
    room = max(height - tile, 1) * max(width - tile, 1)
    step = max(tile // 2, int(math.sqrt(room / max(count, 1))))
    places = [(v, u) for v in range(0, height - tile + 1, step) for u in range(0, width - tile + 1, step)]
    return [place for place in places if valid[place[0] : place[0] + tile, place[1] : place[1] + tile].mean() > TILE_MIN_VALID]


def vote_grid(reference: UInt8Array, grid: Grid, margin_ground_m: float) -> VoteGrid:
    """The reference (on `grid`) shrunk onto the votes' grid."""
    ground = ground_scale(grid.box().bounds().middle_lat)
    cell = _cell_size(grid, margin_ground_m, ground)
    width, height = max(1, round(grid.width * grid.resolution / cell)), max(1, round(grid.height * grid.resolution / cell))
    small = numpy.asarray(cv2.resize(reference.astype(numpy.float32), (width, height), interpolation=cv2.INTER_AREA), numpy.float32)
    valid = numpy.asarray(small > 0, numpy.uint8)
    tile = max(VOTE_TILE_MIN_CELLS, min(VOTE_TILE_CELLS, min(width, height) // VOTE_WINDOW_TILES))
    return VoteGrid(Grid(grid.left, grid.top, cell, width, height), gradient_filter(small, valid, tile), valid, ground, tile)


@dataclass(frozen=True)
class Hypothesis:
    """A warp: an orientation's first guess at a scale and a shear; `margin_m`, how far (EPSG:3857) the search goes around the window."""

    assignment: Assignment
    scale: float
    margin_m: float
    from_pass: bool = False
    shear_deg: float = 0.0


def scaled_about(matrix: FloatArray, centre: tuple[float, float], scale: float) -> FloatArray:
    """`matrix` with every place drawn towards `centre` by `scale`."""
    similarity = numpy.array([[scale, 0.0, centre[0] * (1 - scale)], [0.0, scale, centre[1] * (1 - scale)], [0.0, 0.0, 1.0]])
    return numpy.asarray(similarity @ matrix, numpy.float64)


def _long_side(matrix: FloatArray, frame: Frame) -> FloatArray:
    """The film's long side on the ground, a unit vector pointing north: the same for all of a frame's orientations."""
    x0, y0 = frame.width / 2, frame.height / 2
    x1, y1 = (x0 + 1, y0) if frame.width >= frame.height else (x0, y0 + 1)
    x, y = apply(matrix, numpy.array([x0, x1]), numpy.array([y0, y1]))
    along = numpy.array([x[1] - x[0], y[1] - y[0]])
    along = along / numpy.linalg.norm(along)
    return numpy.asarray(along if along[1] >= 0 else -along, numpy.float64)


def sheared_about(matrix: FloatArray, frame: Frame, centre: tuple[float, float], shear_deg: float) -> FloatArray:
    """`matrix` with the film's short side turned `shear_deg` towards the long side's north end, the long side staying where it runs:
    a strip's corners give a rectangle where its film lies as a parallelogram (`SearchRange.shears_deg`)."""
    along = _long_side(matrix, frame)
    linear = numpy.eye(2) + math.tan(math.radians(shear_deg)) * numpy.outer(along, [along[1], -along[0]])
    shear = numpy.eye(3)
    shear[:2, :2] = linear
    shear[:2, 2] = numpy.array(centre) - linear @ numpy.array(centre)
    return numpy.asarray(shear @ matrix, numpy.float64)


def _grid_matrix(grid: Grid) -> FloatArray:
    """Grid cells (corner convention) to EPSG:3857."""
    return numpy.array([[grid.resolution, 0.0, grid.left], [0.0, -grid.resolution, grid.top], [0.0, 0.0, 1.0]])


@dataclass(frozen=True)
class WarpedFrame:
    """The frame on the search image (cells from `origin`, in the window's cells): its filter, and where a whole tile lies on film."""

    filtered: Image
    placeable: Image
    origin: tuple[int, int]

    @property
    def any_place(self) -> bool:
        """A warp with no place for a whole tile is not worth a match."""
        return bool((self.placeable >= VOTE_PLACE_COVERAGE).any())


def _film_pixels(frame: Frame) -> Image:
    """The frame's pixels plus 1 as floats, 0 off its exposure: a warped 0 is no film, whatever the film's darkest grey."""
    pixels = frame.pixels.astype(numpy.float32) + 1
    start, end = frame.ground
    pixels[:, : max(0, round(start / frame.factor))] = 0
    pixels[:, round(end / frame.factor) :] = 0
    return pixels


def _search_box(frame: Frame, matrix: FloatArray, cells: Grid, margin: int) -> tuple[int, int, int, int]:
    """The search image in the window's cells: the window with its margin, only as far as the film's exposure reaches: a match costs
    its image's area, and a small frame in a wide margin is mostly nothing."""
    start, end = frame.ground
    x = numpy.array([start, end, end, start], numpy.float64)
    y = numpy.array([0.0, 0.0, frame.height, frame.height])
    u, v = cells.to_pixel(*apply(matrix, x, y))
    left, top = max(-margin, math.floor(u.min())), max(-margin, math.floor(v.min()))
    right, bottom = min(cells.width + margin, math.ceil(u.max())), min(cells.height + margin, math.ceil(v.max()))
    return left, top, max(right, left + 1), max(bottom, top + 1)


def warp_frame(frame: Frame, matrix: FloatArray, grid: VoteGrid, margin_m: float) -> WarpedFrame:
    """The frame through `matrix` onto the search image, its filter and where a whole tile lies on film."""
    cells, tile = grid.grid, grid.tile_cells
    left, top, right, bottom = _search_box(frame, matrix, cells, round(margin_m / cells.resolution))
    if right - left < tile or bottom - top < tile:
        return WarpedFrame(numpy.zeros((1, 1), numpy.float32), numpy.zeros((1, 1), numpy.float32), (left, top))
    to_cells = numpy.array([[1.0, 0.0, left], [0.0, 1.0, top], [0.0, 0.0, 1.0]])
    to_preview = numpy.diag([1 / frame.factor, 1 / frame.factor, 1.0])
    inverse = to_preview @ numpy.linalg.inv(matrix) @ _grid_matrix(cells) @ to_cells
    size = (right - left, bottom - top)
    warped = cv2.warpPerspective(_film_pixels(frame), inverse, size, flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderValue=0)
    image = numpy.asarray(warped, numpy.float32)
    valid = numpy.asarray(image > 0, numpy.float32)
    half = tile // 2
    cover = numpy.asarray(cv2.blur(valid, (tile, tile), borderType=cv2.BORDER_CONSTANT), numpy.float32)
    placeable = cover[half : half + size[1] - tile + 1, half : half + size[0] - tile + 1]
    return WarpedFrame(gradient_filter(image, valid, tile), placeable, (left, top))


def tile_vote(tile: Image, warped: WarpedFrame, place: tuple[int, int]) -> tuple[float, float, float, float, float] | None:
    """The tile's vote: its centre, where it fits best (in the window's cells) and the peak; None under the least peak."""
    if float(tile.std()) < FLAT_SPREAD:
        return None
    scores = numpy.asarray(cv2.matchTemplate(warped.filtered, tile, cv2.TM_CCOEFF_NORMED), numpy.float32)
    scores[warped.placeable < VOTE_PLACE_COVERAGE] = -1
    _, peak, _, at = cv2.minMaxLoc(scores)
    if peak <= VOTE_MIN_PEAK:
        return None
    half = tile.shape[0] / 2
    return place[1] + half, place[0] + half, at[0] + warped.origin[0] + half, at[1] + warped.origin[1] + half, peak


@dataclass(frozen=True)
class VoteProposal:
    """A hypothesis the tiles agree on: `matrix` from film pixels to EPSG:3857, what the consensus measured, and its votes."""

    hypothesis: Hypothesis
    matrix: FloatArray
    agreed: int
    tiles: int
    hull: float
    scale: float
    rotation_deg: float
    shift: tuple[float, float]

    @property
    def strong(self) -> bool:
        return self.agreed >= VOTE_STOP_AGREE


def _similarity(votes: FloatArray) -> tuple[FloatArray, Mask] | None:
    """The consensus similarity (window cell to search cell) and its inlier mask; None when there is none."""
    if len(votes) < MIN_CONSENSUS_VOTES:
        return None
    source, target = votes[:, :2].astype(numpy.float32), votes[:, 2:4].astype(numpy.float32)
    matrix, mask = cv2.estimateAffinePartial2D(
        source,
        target,
        method=cv2.RANSAC,
        ransacReprojThreshold=VOTE_RANSAC_CELLS,
        maxIters=RANSAC_ITERATIONS,
        confidence=RANSAC_CONFIDENCE,
        refineIters=RANSAC_REFINES,
    )
    return None if matrix is None else (numpy.asarray(matrix, numpy.float64), numpy.asarray(mask, bool).ravel())


def _hull_share(points: FloatArray, grid: Grid) -> float:
    hull = cv2.convexHull(points.astype(numpy.float32))
    return float(cv2.contourArea(hull)) / (grid.width * grid.height)


def _believable(agreed: int, hull: float, scale: float, rotation: float) -> bool:
    enough = agreed >= VOTE_MIN_AGREE and hull >= VOTE_MIN_HULL
    return enough and abs(scale - 1) <= VOTE_SCALE_TOLERANCE and abs(rotation) <= VOTE_ROTATION_DEG


def consensus(votes: FloatArray, hypothesis: Hypothesis, matrix: FloatArray, grid: Grid) -> VoteProposal | None:
    """The proposal the votes make of `matrix`, when enough of them agree on a believable similarity over enough of the window."""
    found = _similarity(votes)
    if found is None:
        return None
    similarity, mask = found
    scale, rotation = math.hypot(similarity[0, 0], similarity[1, 0]), math.degrees(math.atan2(similarity[1, 0], similarity[0, 0]))
    hull = _hull_share(votes[mask, :2], grid)
    agreed = int(numpy.count_nonzero(mask))
    if not _believable(agreed, hull, scale, rotation):
        return None
    cells = _grid_matrix(grid)
    # The window's cell r shows what the search cell A r shows: a film pixel f lies at r = A^-1 inv(cells) matrix f.
    moved = cells @ numpy.linalg.inv(numpy.vstack((similarity, [0.0, 0.0, 1.0]))) @ numpy.linalg.inv(cells) @ matrix
    centre = numpy.array([grid.width / 2, grid.height / 2, 1.0])
    shift = (similarity @ centre - centre[:2]) * grid.resolution
    return VoteProposal(hypothesis, moved, agreed, len(votes), hull, scale, rotation, (float(shift[0]), float(-shift[1])))


def tiles_per_warp(warps: int) -> int:
    """The tiles each of `warps` asks: its share of the budget, never under what a true warp needs to reach `VOTE_MIN_AGREE`."""
    return max(VOTE_TILE_BUDGET // max(warps, 1), VOTE_WARP_MIN_TILES)


def warp_votes(frame: Frame, hypothesis: Hypothesis, grid: VoteGrid, tiles: int, tick: Callable[[], None]) -> VoteProposal | None:
    """The proposal of one warp, from at most `tiles` matches."""
    centre_box = grid.grid.box()
    centre = ((centre_box.left + centre_box.right) / 2, (centre_box.top + centre_box.bottom) / 2)
    matrix = scaled_about(sheared_about(hypothesis.assignment.matrix, frame, centre, hypothesis.shear_deg), centre, hypothesis.scale)
    warped = warp_frame(frame, matrix, grid, hypothesis.margin_m)
    if not warped.any_place:
        return None
    rows = []
    for place in tile_places(grid.valid, tiles, grid.tile_cells):
        tick()
        vote = tile_vote(grid.tile(place), warped, place)
        if vote is not None:
            rows.append(vote)
    return consensus(numpy.array(rows, numpy.float64).reshape(-1, 5), hypothesis, matrix, grid.grid)


def _same_place(first: VoteProposal, other: VoteProposal, ground: float) -> bool:
    a, b = first.hypothesis.assignment, other.hypothesis.assignment
    apart = math.hypot(first.shift[0] - other.shift[0], first.shift[1] - other.shift[1]) * ground
    return (a.rotation, a.mirrored) == (b.rotation, b.mirrored) and apart <= VOTE_MERGE_GROUND_M


def merged(proposals: Sequence[VoteProposal], ground: float) -> list[VoteProposal]:
    """Proposals of one orientation at one place become one, its votes added, most votes first: weak consistent clusters reach the
    proof, which decides."""
    kept: list[VoteProposal] = []
    for proposal in sorted(proposals, key=lambda each: -each.agreed):
        index = next((at for at, each in enumerate(kept) if _same_place(each, proposal, ground)), None)
        if index is None:
            kept.append(proposal)
        else:
            kept[index] = replace(kept[index], agreed=kept[index].agreed + proposal.agreed)
    return sorted(kept, key=lambda each: -each.agreed)
