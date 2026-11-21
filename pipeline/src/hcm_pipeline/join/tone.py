"""Evening out the frames' tones across their seams (docs/research/M8-join-interfaces.md §3, `merge` 2).

The part owning the most is the anchor, and a breadth-first walk over the seams gives each other part a gain and offset
from the percentiles of its overlap with the part before it; a seam off that tree is only measured. Then a low-frequency
field closes what a line cannot: the median log-ratio across the overlap, smoothed, fading with distance from the seam, half
of it on each side so both meet.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Final

import cv2
import numpy
import numpy.typing

from hcm_pipeline.geo import FloatArray
from hcm_pipeline.images import UInt8Array, as_uint8
from hcm_pipeline.join.canvas import Raster, smoothstep

LOW_PERCENT: Final = 2.0
HIGH_PERCENT: Final = 98.0
MIN_GAIN: Final = 0.5
MAX_GAIN: Final = 2.0
MIN_OVERLAP_CELLS: Final = 64
FULL_ALPHA: Final = 255
FIELD_SIGMA_M: Final = 1000.0
FIELD_TAPER_M: Final = 8000.0
# The log-ratios are filtered by this many cells (about 340 m at zoom 12), so a street seen twice does not count; they are held as
# 8-bit values across this range, which is all OpenCV's wide median takes.
MEDIAN_CELLS: Final = 9
LOG_RANGE: Final = 1.0
# Where the smoothed overlap's weight is under this, the field fades out instead of being divided by nearly nothing.
FULL_REACH: Final = 0.05
LEAST_WEIGHT: Final = 1e-6
BoolArray = numpy.typing.NDArray[numpy.bool_]


@dataclass(frozen=True)
class Linear:
    """Grey levels through a gain and an offset."""

    gain: float = 1.0
    offset: float = 0.0

    def of(self, values: FloatArray) -> FloatArray:
        return numpy.asarray(values * self.gain + self.offset, numpy.float64)

    def after(self, first: Linear) -> Linear:
        """This one applied after `first`."""
        return Linear(self.gain * first.gain, self.gain * first.offset + self.offset)


def overlap(a: Raster, b: Raster) -> BoolArray:
    """The cells both parts fill whole."""
    return numpy.asarray((a.alpha == FULL_ALPHA) & (b.alpha == FULL_ALPHA), numpy.bool_)


def linear_between(reference: Raster, other: Raster) -> Linear:
    """What brings `other`'s tones to `reference`'s (p2 and p98 of their overlap), the gain clamped; nothing without an overlap."""
    both = overlap(reference, other)
    if int(both.sum()) < MIN_OVERLAP_CELLS:
        return Linear()
    low_a, high_a = numpy.percentile(reference.grey[both], [LOW_PERCENT, HIGH_PERCENT])
    low_b, high_b = numpy.percentile(other.grey[both], [LOW_PERCENT, HIGH_PERCENT])
    gain = float(numpy.clip((high_a - low_a) / max(float(high_b - low_b), 1.0), MIN_GAIN, MAX_GAIN))
    return Linear(gain, float(low_a) - gain * float(low_b))


def tree_of(count: int, seams: Sequence[tuple[int, int]], anchor: int) -> list[tuple[int, int]]:
    """The (known, new) part pairs of a breadth-first walk over the seams from the anchor."""
    seen, queue, walked = {anchor}, [anchor], []
    for part in _growing(queue):
        for known, new in _neighbours(part, seams):
            if new not in seen and new < count:
                seen.add(new)
                queue.append(new)
                walked.append((known, new))
    return walked


def _growing(queue: list[int]) -> Iterable[int]:
    index = 0
    while index < len(queue):
        yield queue[index]
        index += 1


def _neighbours(part: int, seams: Sequence[tuple[int, int]]) -> list[tuple[int, int]]:
    return [(part, b if a == part else a) for a, b in seams if part in (a, b)]


def linear_tones(parts: Sequence[Raster], seams: Sequence[tuple[int, int]], anchor: int) -> list[Linear]:
    """Each part's line to the anchor's tones; a part no seam reaches stays as it is."""
    tones = [Linear() for _ in parts]
    for known, new in tree_of(len(parts), seams, anchor):
        tones[new] = tones[known].after(linear_between(parts[known], parts[new]))
    return tones


def _log_ratio(a: FloatArray, b: FloatArray, both: BoolArray) -> FloatArray:
    """`log(b / a)` of the overlap, median-filtered."""
    ratio = numpy.log((b + 1.0) / (a + 1.0))
    filled = numpy.where(both, ratio, float(numpy.median(ratio[both])))
    coded = as_uint8(numpy.clip((filled + LOG_RANGE) / (2.0 * LOG_RANGE) * 255.0, 0.0, 255.0))
    return numpy.asarray(cv2.medianBlur(coded, MEDIAN_CELLS), numpy.float64) / 255.0 * 2.0 * LOG_RANGE - LOG_RANGE


def low_frequency(a: FloatArray, b: FloatArray, both: BoolArray, away_m: FloatArray, cell_m: float) -> FloatArray:
    """`log(b / a)` over the overlap, smoothed by `FIELD_SIGMA_M` and fading to 0 at `FIELD_TAPER_M` from the seam."""
    if int(both.sum()) < MIN_OVERLAP_CELLS:
        return numpy.zeros(a.shape, numpy.float64)
    sigma = FIELD_SIGMA_M / cell_m
    weight = cv2.GaussianBlur(both.astype(numpy.float64), (0, 0), sigma)
    smooth = cv2.GaussianBlur(_log_ratio(a, b, both) * both, (0, 0), sigma) / numpy.maximum(weight, LEAST_WEIGHT)
    reach = numpy.clip(weight / FULL_REACH, 0.0, 1.0)
    return numpy.asarray(smooth * reach * smoothstep(1.0 - away_m / FIELD_TAPER_M), numpy.float64)


@dataclass(frozen=True)
class Tone:
    """A part's tones: its line, then its low-frequency log field on the tone level (zero: none)."""

    line: Linear
    field: numpy.typing.NDArray[numpy.float32]


@dataclass(frozen=True)
class ToneSeam:
    """A seam as tone sees it: its parts, and each tone cell's distance from it on the ground."""

    a: int
    b: int
    away_m: FloatArray


def plan_tones(parts: Sequence[Raster], seams: Sequence[ToneSeam], anchor: int, cell_m: float) -> list[Tone]:
    """Every part's tones: the lines of the tree, then the fields of every seam, half on each side."""
    lines = linear_tones(parts, [(seam.a, seam.b) for seam in seams], anchor)
    fields = [numpy.zeros(part.grey.shape, numpy.float64) for part in parts]
    for seam in seams:
        first, second = parts[seam.a], parts[seam.b]
        a, b = lines[seam.a].of(first.grey.astype(numpy.float64)), lines[seam.b].of(second.grey.astype(numpy.float64))
        field = low_frequency(numpy.maximum(a, 0.0), numpy.maximum(b, 0.0), overlap(first, second), seam.away_m, cell_m) / 2.0
        fields[seam.a] += field
        fields[seam.b] -= field
    return [Tone(line, numpy.asarray(field, numpy.float32)) for line, field in zip(lines, fields, strict=True)]


def owned_most(owner: UInt8Array, count: int) -> int:
    """The part owning the most cells."""
    return int(numpy.bincount(owner.ravel(), minlength=count + 1)[1:].argmax())
