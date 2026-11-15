"""Who owns each cell of the window, and where two owners meet (docs/research/M8-join-interfaces.md §3, `align` 2 and 3).

Each cell goes to the part deepest inside its own frame, which keeps seams off the panoramic edges. A frame wholly inside
another can never be deeper than it, so a redundant fore or aft frame ends up owning nothing and is left out.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

import cv2
import numpy
import numpy.typing

from hcm_pipeline.geo import FloatArray, Grid
from hcm_pipeline.images import UInt8Array, as_uint8

# A part owning less of what the parts cover than this adds nothing worth its weight (a share of the covered cells, not of the
# window: two archive sheets of the centre cover about 1 % of the city's window each and must still be joined).
MIN_OWNED_SHARE: Final = 0.01
MIN_SEAM_M: Final = 1000.0
SAMPLES_PER_SEAM: Final = 24
MIN_SAMPLE_SPACING_M: Final = 250.0
MAX_SAMPLE_SPACING_M: Final = 1000.0
# The seam's line keeps a point about this often: a distance to it is only read where the taper is flat that close.
LINE_SPACING_M: Final = 100.0
OWNER_SHIFT: Final = 256


def depth(alpha: UInt8Array) -> FloatArray:
    """How many cells each cell lies inside the part's own frame (0 outside it)."""
    return numpy.asarray(cv2.distanceTransform(as_uint8(alpha > 0), cv2.DIST_L2, cv2.DIST_MASK_PRECISE), numpy.float64)


def owners(alphas: Sequence[UInt8Array]) -> UInt8Array:
    """For each cell, 1 + the index of the part deepest inside its frame, 0 where no part covers it; a tie goes to the first."""
    best = numpy.zeros(alphas[0].shape, numpy.float64)
    owner = numpy.zeros(alphas[0].shape, numpy.uint8)
    for index, alpha in enumerate(alphas):
        found = depth(alpha)
        deeper = found > best
        owner[deeper] = index + 1
        best[deeper] = found[deeper]
    return owner


@dataclass(frozen=True)
class Ownership:
    """`owner` numbers the `kept` parts (1 + the position in `kept`); `omitted` lists the rest, by their index in the input."""

    owner: UInt8Array
    kept: tuple[int, ...]
    omitted: tuple[int, ...]


def assign(alphas: Sequence[UInt8Array]) -> Ownership:
    """The owners, with every part owning under `MIN_OWNED_SHARE` of the covered cells left out and its cells given to the others."""
    owner = owners(alphas)
    counts = numpy.bincount(owner.ravel(), minlength=len(alphas) + 1)[1:]
    shares = counts / max(int(counts.sum()), 1)
    kept = numpy.flatnonzero(shares >= MIN_OWNED_SHARE).tolist()
    omitted = numpy.flatnonzero(shares < MIN_OWNED_SHARE).tolist()
    return Ownership(_among(alphas, kept) if omitted and kept else owner, tuple(kept), tuple(omitted))


def _among(alphas: Sequence[UInt8Array], kept: Sequence[int]) -> UInt8Array:
    return owners([alphas[index] for index in kept])


@dataclass(frozen=True)
class Sample:
    """A place on a seam: `u` kilometres along its axis, `x` and `y` in EPSG:3857 metres."""

    u: float
    x: float
    y: float


@dataclass(frozen=True)
class Seam:
    """Where the kept parts `a` and `b` meet: its line, its principal axis and its length on the ground."""

    a: int
    b: int
    line: FloatArray
    origin: tuple[float, float]
    axis: tuple[float, float]
    length_m: float
    samples: tuple[Sample, ...]
    ground: float


def _edges(owner: UInt8Array, grid: Grid) -> tuple[FloatArray, FloatArray, FloatArray]:
    """Every edge between two different owners: the pair's key and the edge's middle in EPSG:3857 metres."""
    left, right = owner[:, :-1].astype(numpy.int64), owner[:, 1:].astype(numpy.int64)
    above, below = owner[:-1, :].astype(numpy.int64), owner[1:, :].astype(numpy.int64)
    ys, xs = numpy.nonzero((left != right) & (left > 0) & (right > 0))
    rows, columns = numpy.nonzero((above != below) & (above > 0) & (below > 0))
    keys = numpy.concatenate((_keys(left[ys, xs], right[ys, xs]), _keys(above[rows, columns], below[rows, columns])))
    u = numpy.concatenate((xs + 1.0, columns + 0.5))
    v = numpy.concatenate((ys + 0.5, rows + 1.0))
    x, y = grid.to_mercator(u, v)
    return numpy.asarray(keys, numpy.float64), x, y


def _keys(first: numpy.typing.NDArray[numpy.int64], second: numpy.typing.NDArray[numpy.int64]) -> FloatArray:
    return numpy.asarray(numpy.minimum(first, second) * OWNER_SHIFT + numpy.maximum(first, second), numpy.float64)


def principal_axis(points: FloatArray) -> tuple[float, float]:
    """The direction along which the points spread most, signed the same way every time."""
    spread = numpy.cov(points, rowvar=False) if len(points) > 1 else numpy.eye(2)
    _, vectors = numpy.linalg.eigh(spread)
    axis = vectors[:, -1]
    sign = 1.0 if axis[int(numpy.argmax(numpy.abs(axis)))] > 0 else -1.0
    return float(axis[0] * sign), float(axis[1] * sign)


def along(origin: tuple[float, float], axis: tuple[float, float], x: FloatArray, y: FloatArray, ground: float) -> FloatArray:
    """Kilometres along a seam's axis, on the ground."""
    return numpy.asarray(((x - origin[0]) * axis[0] + (y - origin[1]) * axis[1]) * ground / 1000.0, numpy.float64)


def sample_spacing_m(length_m: float) -> float:
    return float(numpy.clip(length_m / SAMPLES_PER_SEAM, MIN_SAMPLE_SPACING_M, MAX_SAMPLE_SPACING_M))


def _samples(u: FloatArray, x: FloatArray, y: FloatArray, spacing_km: float) -> tuple[Sample, ...]:
    """One boundary point per stretch of `spacing_km` that holds any (the middle one of those in it); `u` is sorted."""
    stretches = numpy.floor((u - u[0]) / spacing_km).astype(numpy.int64)
    _, starts, counts = numpy.unique(stretches, return_index=True, return_counts=True)
    middles = starts + counts // 2
    return tuple(Sample(float(u[index]), float(x[index]), float(y[index])) for index in middles.tolist())


def _seam(pair: tuple[int, int], x: FloatArray, y: FloatArray, ground: float) -> Seam | None:
    """The seam of those boundary points, or None when it is too short to be one."""
    points = numpy.column_stack((x, y))
    origin = (float(x.mean()), float(y.mean()))
    axis = principal_axis(points)
    u = along(origin, axis, x, y, ground)
    order = numpy.argsort(u, kind="stable")
    u, x, y = u[order], x[order], y[order]
    length_m = float(u[-1] - u[0]) * 1000.0
    if length_m < MIN_SEAM_M:
        return None
    stride = max(1, round(len(u) * LINE_SPACING_M / length_m))
    samples = _samples(u, x, y, sample_spacing_m(length_m) / 1000.0)
    return Seam(pair[0], pair[1], numpy.column_stack((x[::stride], y[::stride])), origin, axis, length_m, samples, ground)


def find_seams(owner: UInt8Array, grid: Grid, ground: float) -> tuple[Seam, ...]:
    """Every owner boundary at least `MIN_SEAM_M` long, by the kept parts' positions."""
    keys, x, y = _edges(owner, grid)
    found = []
    for key in numpy.unique(keys).tolist():
        chosen = keys == key
        pair = int(key) // OWNER_SHIFT - 1, int(key) % OWNER_SHIFT - 1
        found.append(_seam(pair, x[chosen], y[chosen], ground))
    return tuple(seam for seam in found if seam is not None)


def pair_boundary(owner: UInt8Array, a: int, b: int, reach: int = 1) -> numpy.typing.NDArray[numpy.bool_]:
    """The cells of parts `a` and `b` within `reach` cells of the other's."""
    kernel = numpy.ones((2 * reach + 1, 2 * reach + 1), numpy.uint8)
    first, second = as_uint8(owner == a + 1), as_uint8(owner == b + 1)
    near_second = (cv2.dilate(second, kernel) > 0) & (first > 0)
    near_first = (cv2.dilate(first, kernel) > 0) & (second > 0)
    return numpy.asarray(near_second | near_first, numpy.bool_)
