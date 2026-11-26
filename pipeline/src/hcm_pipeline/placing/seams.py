"""The seam between two neighbouring sheets (docs/research/M20-import-local.md §19.3): where the second lies from the first, and how
well they continue each other.

Both sheets are on the series' cell (`sheetwork.on_cell`). Only bounded edge strips are compared: `STRIP_SHARE` of the side, never the
whole sheet. Line art is compared through its distance transform (how far each pixel is from ink, clipped at `DISTANCE_CLIP`): a thin
line one pixel off still correlates, and repeated hatching is smoothed into the shape of the lines around it.

- **Overlap**: the first sheet's outermost columns (each width of `TEMPLATE_SHARES`) are searched for in the second's first strip by
  normalised cross-correlation, at a sub-pixel peak. A reading's score is the normalised correlation of the two sheets' grey pixels over
  the whole overlap after alignment (the best scoring width wins), and its `rms` how far the aligned overlaps still disagree: their
  phase correlation (`cv2.phaseCorrelate`, Hanning window) beyond the sub-pixel part.
- **Abutting** (overlap 0: atlas pages cut on a printed grid): the sheets' frame-cropped edges continue each other's lines: the ink
  profiles along the edges, shifted up to `SLACK_SHARE`, correlated.

The better of the two is the seam: `strong` from `STRONG_SCORE`, `weak` from `WEAK_SCORE`, else `missing` (it says nothing). A seam
below is a right seam of the sheets transposed.
"""

from dataclasses import dataclass, replace
from typing import Final

import cv2
import numpy

from hcm_pipeline.placing.frame import PAPER_PERCENTILE
from hcm_pipeline.placing.geometry import FloatArray
from hcm_pipeline.placing.streets import UInt8Array

STRIP_SHARE: Final = 0.25
# The first sheet's outermost columns searched for, as shares of its width: the widest whose match scores best on the whole overlap wins
# (a narrow one finds a small overlap, a wide one is sure in a plain area).
TEMPLATE_SHARES: Final = (0.02, 0.05, 0.1)
INK_LEVELS: Final = 40
LINEART_INK: Final = 0.3
TEMPLATE_MIN_PX: Final = 6
SLACK_SHARE: Final = 0.08
DISTANCE_CLIP: Final = 12.0
EDGE_PX: Final = 3
MIN_COMMON_PX: Final = 8
STRONG_SCORE: Final = 0.6
WEAK_SCORE: Final = 0.3
# An overlap is preferred to an abutting reading that scores at most this much more (the overlap's alignment is measured, not assumed).
ABUT_MARGIN: Final = 0.05
ABUT_RMS_PX: Final = 1.0
MIN_SPREAD: Final = 1e-6


@dataclass(frozen=True)
class Seam:
    """Sheet `b` on sheet `a`'s `side`: `b`'s top left from `a`'s (cell pixels), the score, the residual, and the state."""

    a: int
    b: int
    side: str
    dx: float
    dy: float
    score: float
    rms: float
    state: str


def state_of(score: float) -> str:
    if score >= STRONG_SCORE:
        return "strong"
    return "weak" if score >= WEAK_SCORE else "missing"


def prepared(image: UInt8Array) -> numpy.ndarray:
    """What the strips are matched on (float32): for line art (less than `LINEART_INK` of it ink) how far each pixel is from ink,
    clipped, so a thin line one pixel off still correlates; for filled blocks and colour the grey itself, lightly smoothed."""
    paper = float(numpy.percentile(image, PAPER_PERCENTILE))
    ink = image < paper - INK_LEVELS
    if float(ink.mean()) >= LINEART_INK:
        return numpy.asarray(cv2.GaussianBlur(image.astype(numpy.float32), (0, 0), 1.0), numpy.float32)
    distance = cv2.distanceTransform(numpy.where(ink, 0, 255).astype(numpy.uint8), cv2.DIST_L2, 3)
    return numpy.minimum(distance, DISTANCE_CLIP).astype(numpy.float32)


def subpixel(values: numpy.ndarray, at: int) -> float:
    """The peak's position refined by a parabola through it and its neighbours."""
    if at <= 0 or at >= len(values) - 1:
        return float(at)
    left, middle, right = (float(value) for value in values[at - 1 : at + 2])
    bend = left - 2 * middle + right
    return float(at) if abs(bend) < MIN_SPREAD else at + 0.5 * (left - right) / bend


def _peak(result: numpy.ndarray) -> tuple[float, float, float]:
    """The correlation map's best value and its (x, y) to a fraction of a pixel."""
    _low, best, _low_at, (x, y) = cv2.minMaxLoc(result)
    return float(best), subpixel(result[y, :], x), subpixel(result[:, x], y)


def ncc(first: numpy.ndarray, second: numpy.ndarray) -> float:
    one, two = first.astype(numpy.float64).ravel(), second.astype(numpy.float64).ravel()
    one, two = one - one.mean(), two - two.mean()
    norm = float(numpy.linalg.norm(one) * numpy.linalg.norm(two))
    return float(one @ two) / norm if norm > MIN_SPREAD else 0.0


@dataclass(frozen=True)
class Geometry:
    """The strips' sizes on a cell of `width` x `height`."""

    width: int
    height: int
    share: float = TEMPLATE_SHARES[0]

    @property
    def strip(self) -> int:
        return max(2 * self.template, round(STRIP_SHARE * self.width))

    @property
    def template(self) -> int:
        return max(TEMPLATE_MIN_PX, round(self.share * self.width))

    @property
    def slack(self) -> int:
        return max(2, round(SLACK_SHARE * self.height))


def _match(search: numpy.ndarray, template: numpy.ndarray) -> tuple[float, float, float]:
    if float(template.std()) < MIN_SPREAD or float(search.std()) < MIN_SPREAD:
        return 0.0, 0.0, 0.0
    return _peak(cv2.matchTemplate(search, template, cv2.TM_CCOEFF_NORMED))


def common(a: UInt8Array, b: UInt8Array, dx: int, dy: int) -> tuple[UInt8Array, UInt8Array] | None:
    """The two sheets' pixels over their common area when `b` lies at (`dx`, `dy`) from `a`, or None when it is too thin."""
    height, width = a.shape
    left, top, bottom = max(0, dx), max(0, dy), min(height, dy + b.shape[0])
    if width - left < MIN_COMMON_PX or bottom - top < MIN_COMMON_PX:
        return None
    return a[top:bottom, left:width], b[top - dy : bottom - dy, left - dx : width - dx]


def _residual(first: UInt8Array, second: UInt8Array, fraction: tuple[float, float]) -> float:
    """How far the aligned common areas still disagree (pixels): their phase correlation's shift (Hanning window) beyond the sub-pixel
    `fraction` the integer crop left out."""
    one, two = prepared(first), prepared(second)
    window = cv2.createHanningWindow((one.shape[1], one.shape[0]), cv2.CV_32F)
    (sx, sy), _response = cv2.phaseCorrelate(one, two, window)
    return float(min(numpy.hypot(sx - fraction[0], sy - fraction[1]), numpy.hypot(sx + fraction[0], sy + fraction[1])))


def _aligned(a: UInt8Array, b: UInt8Array, dx: float, dy: float) -> tuple[float, float]:
    """The overlap's score (the grey pixels' correlation over the common area) and its residual; (0, 0) when there is none."""
    found = common(a, b, round(dx), round(dy))
    if found is None:
        return 0.0, 0.0
    return ncc(*found), _residual(*found, (dx - round(dx), dy - round(dy)))


def _overlap_reading(a: UInt8Array, b: UInt8Array, geometry: Geometry) -> tuple[float, float, float, float]:
    """One template width's reading: (`b`'s offset dx, dy, its score on the whole overlap, its residual); score 0 when the template
    is not found."""
    template = prepared(a[geometry.slack : a.shape[0] - geometry.slack, a.shape[1] - geometry.template :])
    search = prepared(b[:, : geometry.strip])
    best, x, y = _match(search, template)
    if best < WEAK_SCORE:
        return float(a.shape[1]), 0.0, 0.0, 0.0
    dx, dy = (a.shape[1] - geometry.template) - x, geometry.slack - y
    return (dx, dy, *_aligned(a, b, dx, dy))


def overlapping(a: UInt8Array, b: UInt8Array, ia: int, ib: int) -> Seam:
    """`b` to the right of `a`, overlapping: found by `a`'s outermost columns (each width of `TEMPLATE_SHARES`), scored on the whole
    overlap; the best scoring reading is the seam."""
    readings = [_overlap_reading(a, b, Geometry(a.shape[1], a.shape[0], share)) for share in TEMPLATE_SHARES]
    dx, dy, score, rms = max(readings, key=lambda reading: reading[2])
    return Seam(ia, ib, "right", dx, dy, score, rms, state_of(score))


def _profile(strip: UInt8Array) -> FloatArray:
    ink = 255.0 - strip.astype(numpy.float64).mean(axis=1)
    return numpy.asarray(ink - ink.mean(), numpy.float64)


def abutting(a: UInt8Array, b: UInt8Array, ia: int, ib: int) -> Seam:
    """`b` against `a`'s right edge with no overlap: its vertical shift where the edges' ink profiles continue best."""
    geometry = Geometry(a.shape[1], a.shape[0])
    left, right = _profile(a[:, -EDGE_PX:]), _profile(b[:, :EDGE_PX])
    shifts = range(-geometry.slack, geometry.slack + 1)
    scores = [_shifted(left, right, shift) for shift in shifts]
    best = int(numpy.argmax(scores))
    score = float(scores[best])
    return Seam(ia, ib, "right", float(a.shape[1]), float(shifts[best]), score, ABUT_RMS_PX, state_of(score))


def _shifted(left: FloatArray, right: FloatArray, shift: int) -> float:
    """The two profiles' correlation with `right` moved down by `shift` rows."""
    if shift >= 0:
        return ncc(left[shift:], right[: len(right) - shift])
    return ncc(left[: len(left) + shift], right[-shift:])


def right_seam(a: UInt8Array, b: UInt8Array, ia: int, ib: int) -> Seam:
    """The seam with `b` on `a`'s right: the overlap's reading, unless the abutting one scores clearly better."""
    found = overlapping(a, b, ia, ib)
    edge = abutting(a, b, ia, ib)
    return edge if edge.score > found.score + ABUT_MARGIN else found


def seam_of(a: UInt8Array, b: UInt8Array, ia: int, ib: int, side: str) -> Seam:
    """The seam with `b` on `a`'s `side` (`right` or `below`; a seam below is measured on the sheets transposed)."""
    if side == "right":
        return right_seam(a, b, ia, ib)
    found = right_seam(numpy.ascontiguousarray(a.T), numpy.ascontiguousarray(b.T), ia, ib)
    return replace(found, side="below", dx=found.dy, dy=found.dx)
