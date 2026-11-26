"""The fine fit of a placed map (docs/research/M20-import-local.md §3 c steps 5 and 6): junction pairs, RANSAC, checks held out.

The map's junctions are cut into the 5 x 5 blocks of `checks.held_out` first: those in held-out blocks never help a fit. Each training
junction, put on the ground by the coarse placement, is paired with every reference junction within reach (up to three); a seeded RANSAC
similarity picks the pairs that agree, an affine is fitted on them, and the pairing runs again tighter from it. With at least 30 agreeing
pairs spread over at least 60 % of the map, a thin-plate spline through them absorbs the drawing's own distortion (the point for old maps).
Each held-out junction is then measured against its nearest reference junction (only when that one is clearly the nearest), and
`checks.checked` gives the figure: the error of the agreeing checks, the dropped (gross) ones and their span on the map's own extent.
"""

import math
from dataclasses import dataclass
from typing import Final

import numpy

from hcm_pipeline.geo import to_lnglat_arrays
from hcm_pipeline.georef.transforms import Gcp, Transform, fit_transform
from hcm_pipeline.placing.checks import Checked, checked, held_out, span_pct
from hcm_pipeline.placing.geometry import BoolArray, FloatArray, affine, apply, ransac_similarity

MIN_INLIERS: Final = 20
# The agreeing pairs must be at least this share of the training junctions: a wrong placement agrees with a few by chance.
MIN_SHARE: Final = 0.2
MIN_CHECKS: Final = 5
TPS_MIN_INLIERS: Final = 30
TPS_MIN_SPAN_PCT: Final = 60.0
CANDIDATES: Final = 3
CHECK_RATIO: Final = 0.7
MAX_DRIFT: Final = 2.0
MIN_REACH_M: Final = 30.0
TIGHTEN: Final = 3.0
CHUNK: Final = 512


@dataclass(frozen=True)
class Problem:
    """A map to fit: its junctions (working pixels), its extent, the reference junctions (Mercator), the ground scale, the gross limit."""

    points: FloatArray
    extent: tuple[float, float, float, float]
    places: FloatArray
    ground: float
    gross_m: float
    names: tuple[str, ...] = ()
    # A rigid fit stays affine (a mosaic of sheets on a surveyed grid), never a thin-plate spline.
    rigid: bool = False

    def name_of(self, index: int) -> str:
        """The part a junction belongs to: its own name when each junction has one, else the one name given (or `map`)."""
        return self.names[min(index, len(self.names) - 1)] if self.names else "map"


@dataclass(frozen=True)
class Fine:
    """A fit: the transform (working pixels to Mercator), the pairs it went through and what the held-out checks measured."""

    transform: Transform
    source: FloatArray
    target: FloatArray
    checked: Checked
    candidates: int

    @property
    def holds(self) -> bool:
        """Enough agreeing pairs, a fair share of the junctions, enough checks and none of them gross."""
        enough = len(self.source) >= max(MIN_INLIERS, MIN_SHARE * self.candidates)
        return enough and self.checked.count >= MIN_CHECKS and self.checked.dropped == 0


def nearest(projected: FloatArray, places: FloatArray, count: int) -> tuple[numpy.ndarray, FloatArray]:
    """For each projected point, the indices of its `count` nearest places and their distances (chunked: never n x m at once)."""
    indices, distances = [], []
    for start in range(0, len(projected), CHUNK):
        part = projected[start : start + CHUNK]
        gaps = numpy.hypot(part[:, None, 0] - places[None, :, 0], part[:, None, 1] - places[None, :, 1])
        order = numpy.argsort(gaps, axis=1)[:, :count]
        indices.append(order)
        distances.append(numpy.take_along_axis(gaps, order, axis=1))
    return numpy.vstack(indices), numpy.vstack(distances)


def candidates(points: FloatArray, places: FloatArray, matrix: FloatArray, reach: float) -> tuple[FloatArray, FloatArray]:
    """Every (map junction, reference junction) pair within `reach` (Mercator metres) of where `matrix` puts the junction."""
    if len(points) == 0 or len(places) < CANDIDATES:
        return numpy.zeros((0, 2)), numpy.zeros((0, 2))
    index, gap = nearest(apply(matrix, points), places, CANDIDATES)
    rows, cols = numpy.nonzero(gap <= reach)
    return points[rows], places[index[rows, cols]]


def _refit(source: FloatArray, target: FloatArray, tolerance: float, start: FloatArray) -> tuple[FloatArray, BoolArray] | None:
    consensus = ransac_similarity(source, target, tolerance, start=start)
    if consensus is None or consensus.count < MIN_INLIERS:
        return None
    matrix = affine(source[consensus.inliers], target[consensus.inliers])
    return (consensus.matrix, consensus.inliers) if matrix is None else (matrix, consensus.inliers)


def one_to_one(source: FloatArray, target: FloatArray, matrix: FloatArray) -> tuple[FloatArray, FloatArray]:
    """Each map junction and each reference junction in one pair at most: the closest under `matrix` wins."""
    order = numpy.argsort(numpy.hypot(*(apply(matrix, source) - target).T))
    _, first_source = numpy.unique(source[order], axis=0, return_index=True)
    kept = order[numpy.sort(first_source)]
    _, first_target = numpy.unique(target[kept], axis=0, return_index=True)
    kept = kept[numpy.sort(first_target)]
    return source[kept], target[kept]


def _round(points: FloatArray, places: FloatArray, matrix: FloatArray, reach: float) -> tuple[FloatArray, FloatArray, FloatArray] | None:
    source, target = candidates(points, places, matrix, reach)
    fitted = _refit(source, target, reach / TIGHTEN, matrix) if len(source) else None
    if fitted is None:
        return None
    kept_source, kept_target = one_to_one(source[fitted[1]], target[fitted[1]], fitted[0])
    return (fitted[0], kept_source, kept_target) if len(kept_source) >= MIN_INLIERS else None


def _gcps(source: FloatArray, target: FloatArray) -> list[Gcp]:
    lng, lat = to_lnglat_arrays(target[:, 0], target[:, 1])
    rows = zip(source[:, 0], source[:, 1], lng, lat, strict=True)
    return [Gcp(f"p{index}", float(x), float(y), float(la), float(ln)) for index, (x, y, ln, la) in enumerate(rows)]


def _transform(source: FloatArray, target: FloatArray, problem: Problem) -> Transform | None:
    """A thin-plate spline when the pairs are many and spread (and the fit is not rigid), else an affine."""
    spline = not problem.rigid and len(source) >= TPS_MIN_INLIERS and span_pct(source, problem.extent) >= TPS_MIN_SPAN_PCT
    return fit_transform("tps" if spline else "affine", _gcps(source, target))


def check_errors(problem: Problem, transform: Transform, held: BoolArray) -> tuple[FloatArray, FloatArray, list[str]]:
    """Each held-out junction's ground error against its clearly nearest reference junction, its place and its part."""
    points = problem.points[held]
    if len(points) == 0 or len(problem.places) < CANDIDATES:
        return numpy.zeros(0), numpy.zeros((0, 2)), []
    projected = numpy.column_stack(transform.to_mercator(points[:, 0], points[:, 1]))
    _, gap = nearest(projected, problem.places, 2)
    clear = (gap[:, 0] <= problem.gross_m * 2 / problem.ground) & (gap[:, 0] < CHECK_RATIO * gap[:, 1])
    names = [problem.name_of(int(index)) for index in numpy.flatnonzero(held)[clear]]
    return gap[clear, 0] * problem.ground, points[clear], names


def drift(transform: Transform, start: FloatArray, extent: tuple[float, float, float, float]) -> float:
    """How far (Mercator metres) the fit moves the map's corners from where the placement it started from put them."""
    left, top, right, bottom = extent
    corners = numpy.array([[left, top], [right, top], [right, bottom], [left, bottom]])
    fx, fy = transform.to_mercator(corners[:, 0], corners[:, 1])
    return float(numpy.hypot(fx - apply(start, corners)[:, 0], fy - apply(start, corners)[:, 1]).max())


def fit(problem: Problem, start: FloatArray, reach: float) -> Fine | None:
    """The fine fit from a placement good to about `reach` (Mercator metres), or None when too few pairs agree or the fit drifts
    from the placement by more than `MAX_DRIFT` reaches (a repeated street pattern can agree with itself one block over)."""
    held = held_out(problem.points, problem.extent)
    training = problem.points[~held]
    first = _round(training, problem.places, start, reach)
    if first is None:
        return None
    second = _round(training, problem.places, first[0], max(MIN_REACH_M / problem.ground, reach / TIGHTEN))
    _matrix, source, target = second or first
    transform = _transform(source, target, problem)
    if transform is None or drift(transform, start, problem.extent) > MAX_DRIFT * reach:
        return None
    errors, places, names = check_errors(problem, transform, held)
    return Fine(transform, source, target, checked(errors, places, names, problem.extent, problem.gross_m), len(training))


def suggestion_pairs(
    points: FloatArray, places: FloatArray, matrix: FloatArray, reach: float
) -> tuple[FloatArray, FloatArray, list[float]]:
    """A placement that did not hold: its closest pairs as suggestions, each scored by how close (1 on the spot, 0 at `reach`)."""
    if len(points) == 0 or len(places) < CANDIDATES:
        return numpy.zeros((0, 2)), numpy.zeros((0, 2)), []
    index, gap = nearest(apply(matrix, points), places, 1)
    close = gap[:, 0] <= reach
    scores = [round(1.0 - float(value) / reach, 3) for value in gap[close, 0]]
    return points[close], places[index[close, 0]], scores


def ground_of(latitude: float) -> float:
    return math.cos(math.radians(latitude))
