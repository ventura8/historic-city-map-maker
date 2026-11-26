"""How far a Landsat scene lies from Sentinel-2 (docs/research/M25-landsat.md §3): one rigid shift by phase correlation.

Both images are on the same tile grid. Each is high-passed (its own minus its blur: the edges of streets, fields and the river, which two
sensors share where their brightness does not), the pixels either lacks or the scene's quality band calls cloud are set to zero, and
OpenCV's phase correlation under a Hann window gives the sub-pixel shift of the Landsat image against the reference. A shift is only
measured over enough common pixels and with a clear peak; otherwise there is none, and the version waits for an admin's eye.
"""

from dataclasses import dataclass
from typing import Final

import cv2
import numpy

from hcm_pipeline.geo import FloatArray
from hcm_pipeline.landsat.colour import BoolArray

BLUR_SIGMA_PX: Final = 3.0
MIN_COMMON_SHARE: Final = 0.2
MIN_RESPONSE: Final = 0.02


@dataclass(frozen=True)
class Shift:
    """The Landsat image's shift against the reference, grid pixels: right (`dx`) and down (`dy`)."""

    dx: float
    dy: float

    @property
    def pixels(self) -> float:
        return float(numpy.hypot(self.dx, self.dy))


def high_pass(image: FloatArray, keep: BoolArray) -> FloatArray:
    """The image minus its blur, zero outside `keep`."""
    values = numpy.asarray(image, numpy.float64)
    blurred = cv2.GaussianBlur(values, (0, 0), BLUR_SIGMA_PX)
    return numpy.asarray(numpy.where(keep, values - blurred, 0.0), numpy.float64)


def shift_of(landsat: FloatArray, reference: FloatArray, common: BoolArray) -> Shift | None:
    """The shift of `landsat` against `reference` over the `common` pixels, or None when too few are common or no peak stands out."""
    if common.size == 0 or numpy.count_nonzero(common) < MIN_COMMON_SHARE * common.size:
        return None
    window = cv2.createHanningWindow((common.shape[1], common.shape[0]), cv2.CV_64F)
    (dx, dy), response = cv2.phaseCorrelate(high_pass(reference, common), high_pass(landsat, common), window)
    return Shift(float(dx), float(dy)) if response >= MIN_RESPONSE else None
