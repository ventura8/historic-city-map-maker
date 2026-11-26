"""Plane transforms between point sets (docs/research/M20-import-local.md §3 b, c): least squares and a seeded RANSAC.

A transform is a 2x3 matrix taking (x, y, 1) to (x', y'). The similarity has no reflection of its own (a map is never mirrored by its
scan: a mirrored fit is a wrong one); `flipped` is the one reflection every placement has, scan pixels (y down) to Mercator metres (y up).
RANSAC is deterministic for a seed, so a re-run of a series gives the same placement.
"""

import math
from dataclasses import dataclass
from typing import Final

import numpy
from numpy.typing import NDArray

FloatArray = NDArray[numpy.float64]
BoolArray = NDArray[numpy.bool_]
MIN_SIMILARITY: Final = 2
MIN_AFFINE: Final = 3
RANSAC_ROUNDS: Final = 400
_DEGENERATE: Final = 1e-12


def as_points(values: object) -> FloatArray:
    """Any (n, 2) sequence as float64 points."""
    return numpy.asarray(values, numpy.float64).reshape(-1, 2)


def apply(matrix: FloatArray, points: FloatArray) -> FloatArray:
    """`points` through the 2x3 `matrix`."""
    return points @ matrix[:, :2].T + matrix[:, 2]


FLIP: Final = numpy.array([[1.0, 0.0, 0.0], [0.0, -1.0, 0.0]])


def similarity(source: FloatArray, target: FloatArray, flipped: bool = False) -> FloatArray | None:
    """The least-squares rotation, uniform scale and shift from `source` to `target` (Umeyama), after flipping y when `flipped`;
    None when degenerate."""
    if flipped:
        found = similarity(apply(FLIP, source), target)
        return None if found is None else compose(found, FLIP)
    if len(source) < MIN_SIMILARITY:
        return None
    mean_s, mean_t = source.mean(axis=0), target.mean(axis=0)
    centred_s, centred_t = source - mean_s, target - mean_t
    variance = float((centred_s**2).sum())
    if variance < _DEGENERATE:
        return None
    a = float((centred_s[:, 0] * centred_t[:, 0] + centred_s[:, 1] * centred_t[:, 1]).sum()) / variance
    b = float((centred_s[:, 0] * centred_t[:, 1] - centred_s[:, 1] * centred_t[:, 0]).sum()) / variance
    rotation = numpy.array([[a, -b], [b, a]])
    return numpy.column_stack((rotation, mean_t - rotation @ mean_s))


def affine(source: FloatArray, target: FloatArray) -> FloatArray | None:
    """The least-squares affine from `source` to `target`; None when the points lie in a line."""
    if len(source) < MIN_AFFINE:
        return None
    design = numpy.column_stack((source, numpy.ones(len(source))))
    if numpy.linalg.matrix_rank(design) < MIN_AFFINE:
        return None
    solution, *_ = numpy.linalg.lstsq(design, target, rcond=None)
    return numpy.asarray(solution.T, numpy.float64)


def is_flipped(matrix: FloatArray) -> bool:
    """True when the transform reverses handedness (a negative determinant)."""
    return float(numpy.linalg.det(matrix[:, :2])) < 0


def scale_of(matrix: FloatArray) -> float:
    """The mean scale of a 2x3 transform's linear part."""
    return math.sqrt(abs(float(numpy.linalg.det(matrix[:, :2]))))


def rotation_deg(matrix: FloatArray) -> float:
    return math.degrees(math.atan2(float(matrix[1, 0]), float(matrix[0, 0])))


def compose(outer: FloatArray, inner: FloatArray) -> FloatArray:
    """`outer` after `inner`, both 2x3."""
    full = numpy.vstack((inner, [0.0, 0.0, 1.0]))
    return numpy.asarray(outer @ full, numpy.float64)


def invert(matrix: FloatArray) -> FloatArray:
    full = numpy.linalg.inv(numpy.vstack((matrix, [0.0, 0.0, 1.0])))
    return numpy.asarray(full[:2], numpy.float64)


@dataclass(frozen=True)
class Consensus:
    """A RANSAC similarity: the model refitted on its inliers, and which pairs those are."""

    matrix: FloatArray
    inliers: BoolArray

    @property
    def count(self) -> int:
        return int(self.inliers.sum())


def _inliers(matrix: FloatArray | None, source: FloatArray, target: FloatArray, tolerance: float) -> BoolArray:
    if matrix is None:
        return numpy.zeros(len(source), numpy.bool_)
    return numpy.asarray(numpy.hypot(*(apply(matrix, source) - target).T) <= tolerance, numpy.bool_)


def _best_round(source: FloatArray, target: FloatArray, tolerance: float, seed: int, start: FloatArray | None) -> BoolArray:
    generator = numpy.random.default_rng(seed)
    best = _inliers(start, source, target, tolerance)
    flipped = start is not None and is_flipped(start)
    for _ in range(RANSAC_ROUNDS):
        pick = generator.choice(len(source), MIN_SIMILARITY, replace=False)
        found = _inliers(similarity(source[pick], target[pick], flipped), source, target, tolerance)
        best = found if found.sum() > best.sum() else best
    return best


def ransac_similarity(
    source: FloatArray, target: FloatArray, tolerance: float, seed: int = 20, start: FloatArray | None = None
) -> Consensus | None:
    """The similarity most pairs agree with (within `tolerance` in target units), refitted on them; None with too few pairs. A `start`
    transform (a placement already found) competes as one more round: its pairs win unless a sample finds more; the fit keeps its
    handedness (pixels to Mercator metres are flipped)."""
    if len(source) < MIN_SIMILARITY + 1:
        return None
    best = _best_round(source, target, tolerance, seed, start)
    flipped = start is not None and is_flipped(start)
    matrix = similarity(source[best], target[best], flipped) if best.sum() >= MIN_SIMILARITY else None
    if matrix is None:
        return None
    return Consensus(matrix, _inliers(matrix, source, target, tolerance))
