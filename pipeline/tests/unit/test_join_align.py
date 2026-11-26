"""The verdict on a seam's correction: no frame shifts unless the measurement says it helped (M8-join-interfaces.md §3, `align` 10)."""

import cv2
import numpy
import numpy.typing
import pytest
from hcm_pipeline.geo import Grid
from hcm_pipeline.join.canvas import Raster
from hcm_pipeline.join.measure import Kept, Measured
from hcm_pipeline.join.seams import Sample, Seam
from hcm_pipeline.steps.align import Verdict, judge

SIZE = 400
GRID = Grid(0.0, 0.0, 10.0, SIZE, SIZE)
SAMPLES = (Sample(1.0, 2000.0, -1000.0), Sample(2.0, 2000.0, -2000.0), Sample(3.0, 2000.0, -3000.0))


def picture() -> numpy.typing.NDArray[numpy.uint8]:
    noise = numpy.random.default_rng(9).normal(0, 1, (SIZE, SIZE))
    return numpy.asarray(numpy.clip(128 + numpy.asarray(cv2.GaussianBlur(noise, (0, 0), 2.0)) * 120, 0, 255), numpy.uint8)


def part(pixels: numpy.typing.NDArray[numpy.uint8], dx: float = 0.0, valid: bool = True) -> Raster:
    moved = numpy.asarray(
        cv2.warpAffine(pixels, numpy.array([[1.0, 0.0, dx], [0.0, 1.0, 0.0]]), (SIZE, SIZE), borderMode=cv2.BORDER_REFLECT), numpy.uint8
    )
    return Raster(GRID, moved, numpy.full((SIZE, SIZE), 255 if valid else 0, numpy.uint8))


def measured() -> Measured:
    seam = Seam(0, 1, numpy.zeros((1, 2)), (0.0, 0.0), (0.0, 1.0), 4000.0, SAMPLES, 1.0)
    return Measured(seam, tuple(Kept(sample, 0.0, 0.0) for sample in SAMPLES))


@pytest.mark.parametrize(
    ("before", "after", "helped"),
    [(40.0, 3.0, True), (40.0, 40.0, False), (40.0, 41.0, False), (None, 3.0, False), (40.0, None, False)],
)
def test_happy_path_only_less_than_before_counts_as_help(before: float | None, after: float | None, helped: bool) -> None:
    assert Verdict(before, after).helped is helped


def test_happy_path_a_closed_seam_is_judged_on_its_samples() -> None:
    pixels = picture()

    verdict = judge([part(pixels), part(pixels, 6.0)], [part(pixels), part(pixels)], measured(), 1.0)

    assert verdict.before_m == pytest.approx(60.0, abs=3.0)
    assert verdict.after_m == pytest.approx(0.0, abs=3.0)
    assert verdict.helped


def test_bad_path_samples_the_correction_lost_are_no_help_and_the_before_figure_stays() -> None:
    pixels = picture()

    verdict = judge([part(pixels), part(pixels, 6.0)], [part(pixels), part(pixels, valid=False)], measured(), 1.0)

    assert verdict.before_m == pytest.approx(60.0, abs=3.0)
    assert verdict.after_m is None
    assert not verdict.helped


def test_bad_path_samples_nothing_ever_found_have_no_figure() -> None:
    blank = part(picture(), valid=False)

    verdict = judge([blank, blank], [blank, blank], measured(), 1.0)

    assert verdict == Verdict(None, None)
