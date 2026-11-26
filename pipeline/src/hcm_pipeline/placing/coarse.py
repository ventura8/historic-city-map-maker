"""Coarse placement of a drawn map on its reference (docs/research/M20-import-local.md §3 c step 4): chamfer over similarities.

The map's street skeleton (points in its working pixels) is drawn, for each scale and rotation tried, as a template in the reference's
pixels; correlating it with the reference's closeness image (OpenCV's template matching, by FFT) scores every shift at once, as the mean
closeness of the map's lines to the reference's less what the same area of the reference would give anywhere (zero-mean correlation:
lesson 528). A plain mean favours wherever the reference is densest, and a dense town wins over the true place. The scale comes from
the map's printed scale when it is known (a narrow band around it), else from a wide band of sizes against the city; the rotation is
north up, give or take a few degrees, in each of the four quarter turns.
The best placements are kept, each more than `RIVAL_SHARE` of the map's size from the others (M9's rival search): `CANDIDATES` of
them. A street grid scores almost as well one block over, so the chamfer score alone can neither choose nor refuse: the fine fit runs on
each, the one whose junctions agree with the most pairs wins, and it holds only when the runner-up agrees with far fewer (`single`).
"""

import math
from collections.abc import Iterable
from dataclasses import dataclass, replace
from typing import Final

import cv2
import numpy

from hcm_pipeline.placing.geometry import FloatArray, apply
from hcm_pipeline.placing.reference import Reference, closeness_of

TILTS_DEG: Final = (-3.0, 0.0, 3.0)
# The first search is scored on a closeness twice as wide as the fine one's: its scale steps are 12 % apart.
LOOSE_PX: Final = 4.0
QUARTER_TURNS: Final = (0.0, 90.0, 180.0, 270.0)
SCALE_STEP: Final = 1.12
KNOWN_SCALE_BAND: Final = 1.25
MIN_TEMPLATE_PX: Final = 16
MAX_POINTS: Final = 40_000
RIVAL_SHARE: Final = 0.25
CANDIDATES: Final = 3
MIN_SCORE: Final = 0.05
# The refinement around a placement: scale steps of 2 % over +-6 %, rotation steps of 1 degree over +-3.
REFINE_SCALE_STEP: Final = 0.02
REFINE_SCALES: Final = 3
REFINE_TURN_STEP: Final = 1.0
REFINE_TURNS: Final = 3


@dataclass(frozen=True)
class Hypothesis:
    """One placement tried: Mercator metres per working pixel and the rotation in degrees (counter-clockwise on the map)."""

    metres_per_px: float
    rotation_deg: float


@dataclass(frozen=True)
class Coarse:
    """The best placement (a 2x3 from working pixels to Mercator metres), its score, and the next best placements far from it."""

    matrix: FloatArray
    score: float
    others: tuple[FloatArray, ...] = ()

    @property
    def holds(self) -> bool:
        return self.score >= MIN_SCORE


def loosened(reference: Reference) -> Reference:
    """The reference scored with the first search's wider closeness."""
    return replace(reference, closeness=closeness_of(reference.skeleton, LOOSE_PX))


def scales(known: float | None, low: float, high: float) -> list[float]:
    """Mercator metres per working pixel to try: a narrow band around a known scale, else `low` to `high`."""
    if known is not None:
        low, high = known / KNOWN_SCALE_BAND, known * KNOWN_SCALE_BAND
    count = max(1, math.ceil(math.log(high / low) / math.log(SCALE_STEP)) + 1)
    return [low * SCALE_STEP**step for step in range(count)]


def hypotheses(metres: Iterable[float], turns: Iterable[float] = QUARTER_TURNS) -> list[Hypothesis]:
    return [Hypothesis(scale, turn + tilt) for scale in metres for turn in turns for tilt in TILTS_DEG]


def _linear(hypothesis: Hypothesis, resolution: float) -> FloatArray:
    """Working pixels to reference pixels (y down on both): scale and rotation."""
    k = hypothesis.metres_per_px / resolution
    angle = math.radians(hypothesis.rotation_deg)
    return numpy.array([[k * math.cos(angle), k * math.sin(angle)], [-k * math.sin(angle), k * math.cos(angle)]])


def _template(points: FloatArray, linear: FloatArray) -> tuple[numpy.ndarray, FloatArray] | None:
    moved = points @ linear.T
    origin = moved.min(axis=0)
    cells = numpy.floor(moved - origin).astype(numpy.int64)
    width, height = int(cells[:, 0].max()) + 1, int(cells[:, 1].max()) + 1
    if min(width, height) < MIN_TEMPLATE_PX:
        return None
    template = numpy.zeros((height, width), numpy.float32)
    template[cells[:, 1], cells[:, 0]] = 1.0
    return template, origin


@dataclass(frozen=True)
class _Peak:
    score: float
    place: FloatArray
    matrix: FloatArray


def _peaks(reference: Reference, points: FloatArray, hypothesis: Hypothesis) -> list[_Peak]:
    """The best shift of one hypothesis, and the best shift far from it."""
    linear = _linear(hypothesis, reference.grid.resolution)
    made = _template(points, linear)
    if made is None or made[0].shape[0] >= reference.closeness.shape[0] or made[0].shape[1] >= reference.closeness.shape[1]:
        return []
    template, origin = made
    scores = cv2.matchTemplate(reference.closeness, template, cv2.TM_CCOEFF) / max(1.0, float(template.sum()))
    first = _peak_at(scores, reference, linear, origin)
    reach = RIVAL_SHARE * max(template.shape)
    row, col = numpy.ogrid[: scores.shape[0], : scores.shape[1]]
    far = (row - first.place[1]) ** 2 + (col - first.place[0]) ** 2 > reach**2
    return [first, _peak_at(numpy.where(far, scores, -1.0), reference, linear, origin)]


def _peak_at(scores: numpy.ndarray, reference: Reference, linear: FloatArray, origin: FloatArray) -> _Peak:
    _, best, _, (col, row) = cv2.minMaxLoc(scores)
    shift = numpy.array([col, row], numpy.float64) - origin
    grid = reference.grid
    to_mercator = numpy.array([[grid.resolution, 0.0], [0.0, -grid.resolution]])
    matrix = numpy.column_stack((to_mercator @ linear, to_mercator @ shift + [grid.left, grid.top]))
    return _Peak(float(best), numpy.array([col, row], numpy.float64), matrix)


def thinned(points: FloatArray) -> FloatArray:
    """At most `MAX_POINTS` of the skeleton's points, evenly picked."""
    step = max(1, math.ceil(len(points) / MAX_POINTS))
    return points[::step]


def _distinct(peaks: list[_Peak], best: _Peak, reach_m: float, centre: FloatArray) -> list[_Peak]:
    """The peaks that put the map's centre further than `reach_m` from where the best one puts it."""
    here = apply(best.matrix, centre)
    return [peak for peak in peaks if float(numpy.hypot(*(apply(peak.matrix, centre) - here)[0])) > reach_m]


def _apart(peaks: list[_Peak], size_px: float, centre: FloatArray) -> list[_Peak]:
    """The best peaks, best first, each further than `RIVAL_SHARE` of the map's size from those kept before it: `CANDIDATES` at most."""
    kept: list[_Peak] = []
    for peak in sorted(peaks, key=lambda peak: -peak.score):
        reach_m = RIVAL_SHARE * size_px * math.sqrt(abs(numpy.linalg.det(peak.matrix[:, :2])))
        if len(kept) < CANDIDATES and all(_distinct([peak], other, reach_m, centre) for other in kept):
            kept.append(peak)
    return kept


def _all_peaks(reference: Reference, points: FloatArray, tried: Iterable[Hypothesis]) -> list[_Peak]:
    """Every hypothesis's peaks; none for a map with too few street pixels to make a template."""
    if len(points) < MIN_TEMPLATE_PX:
        return []
    return [peak for hypothesis in tried for peak in _peaks(reference, thinned(points), hypothesis)]


def search(reference: Reference, points: FloatArray, tried: Iterable[Hypothesis], size_px: float) -> Coarse | None:
    """The best placements of the skeleton `points` over every hypothesis; None when the map shows no streets or no hypothesis fits the
    window."""
    peaks = _all_peaks(reference, points, tried)
    if not peaks:
        return None
    best, *others = _apart(peaks, size_px, points.mean(axis=0).reshape(1, 2))
    return Coarse(best.matrix, best.score, tuple(other.matrix for other in others))


def hypothesis_of(matrix: FloatArray) -> Hypothesis:
    """The scale and rotation of a placement (working pixels to Mercator metres, y flipped)."""
    flipped = matrix[:, :2] * numpy.array([[1.0, 1.0], [-1.0, -1.0]])
    return Hypothesis(
        math.sqrt(abs(float(numpy.linalg.det(flipped)))), math.degrees(math.atan2(-float(flipped[1, 0]), float(flipped[0, 0])))
    )


def around(start: Hypothesis) -> list[Hypothesis]:
    """Fine steps of scale and rotation around a placement."""
    factors = [1.0 + REFINE_SCALE_STEP * step for step in range(-REFINE_SCALES, REFINE_SCALES + 1)]
    turns = [start.rotation_deg + REFINE_TURN_STEP * step for step in range(-REFINE_TURNS, REFINE_TURNS + 1)]
    return [Hypothesis(start.metres_per_px * factor, turn) for factor in factors for turn in turns]


def refine(reference: Reference, points: FloatArray, start: Coarse, size_px: float) -> Coarse:
    """The placement searched again in fine steps around `start` on a finer reference."""
    found = search(reference, points, around(hypothesis_of(start.matrix)), size_px)
    return start if found is None else Coarse(found.matrix, found.score)
