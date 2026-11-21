"""The seam between two neighbouring sheets (docs/research/M20-import-local.md §19.3)."""

import numpy
import pytest
from hcm_pipeline.placing import seams

from tests.synthetic.sheets import SheetsSpec, map_of


def _grey(spec: SheetsSpec) -> numpy.ndarray:
    return numpy.ascontiguousarray(map_of(spec)[:, :, 0])


def _pair(style: str, overlap: int, shift: int = 0) -> tuple[numpy.ndarray, numpy.ndarray]:
    """Two 300 x 240 cuts of one map, the second `overlap` pixels into the first and `shift` lower."""
    whole = _grey(SheetsSpec(rows=1, cols=3, cell=(320, 300), overlap=0.0, style=style))
    first = whole[20:260, 0:300]
    second = whole[20 + shift : 260 + shift, 300 - overlap : 600 - overlap]
    return numpy.ascontiguousarray(first), numpy.ascontiguousarray(second)


@pytest.mark.parametrize(("style", "overlap", "shift"), [("grey", 18, 0), ("lineart", 30, 4), ("colour", 9, -3), ("grey", 60, 2)])
def test_happy_path_an_overlap_is_found_to_a_fraction_of_a_pixel(style: str, overlap: int, shift: int) -> None:
    """Scenarios: S-P20-HAPPY-STITCH-SEAMS"""
    first, second = _pair(style, overlap, shift)

    seam = seams.seam_of(first, second, 0, 1, "right")

    assert seam.state == "strong"
    assert seam.dx == pytest.approx(300 - overlap, abs=1.0)
    assert seam.dy == pytest.approx(shift, abs=1.0)
    assert seam.rms < 1.5


def test_happy_path_abutting_pages_continue_each_others_lines() -> None:
    """Scenarios: S-P20-HAPPY-STITCH-ABUTTING"""
    first, second = _pair("grey", 0, 3)

    seam = seams.seam_of(first, second, 0, 1, "right")

    assert seam.state in {"strong", "weak"}
    assert seam.dx == 300.0
    assert seam.dy == pytest.approx(3, abs=1)


def test_happy_path_a_seam_below_is_measured_on_the_sheets_transposed() -> None:
    first, second = _pair("grey", 24, 0)

    seam = seams.seam_of(numpy.ascontiguousarray(first.T), numpy.ascontiguousarray(second.T), 2, 5, "below")

    assert (seam.a, seam.b, seam.side) == (2, 5, "below")
    assert seam.dy == pytest.approx(276, abs=1)
    assert seam.dx == pytest.approx(0, abs=1)


def test_bad_path_sheets_of_two_towns_have_no_seam() -> None:
    """Scenarios: S-P20-BAD-STITCH-FOREIGN-SHEET"""
    first = _grey(SheetsSpec(rows=1, cols=1, cell=(300, 240)))
    other = numpy.ascontiguousarray(numpy.flipud(numpy.fliplr(first)))

    seam = seams.seam_of(first, other, 0, 1, "right")

    assert seam.state == "missing"


def test_bad_path_plain_paper_says_nothing() -> None:
    paper = numpy.full((100, 120), 250, numpy.uint8)

    seam = seams.seam_of(paper, paper.copy(), 0, 1, "right")

    assert (seam.state, seam.score) == ("missing", 0.0)


def test_happy_path_the_states_follow_the_score() -> None:
    assert seams.state_of(0.9) == "strong"
    assert seams.state_of(0.4) == "weak"
    assert seams.state_of(0.1) == "missing"


def test_happy_path_a_peak_is_refined_between_pixels_and_kept_on_an_edge() -> None:
    assert seams.subpixel(numpy.array([0.0, 1.0, 0.5]), 1) == pytest.approx(1 + 1 / 6)
    assert seams.subpixel(numpy.array([1.0, 0.5]), 0) == 0.0
    assert seams.subpixel(numpy.array([1.0, 1.0, 1.0]), 1) == 1.0


def test_bad_path_a_correlation_of_flat_pixels_is_zero() -> None:
    assert seams.ncc(numpy.ones((4, 4)), numpy.arange(16.0).reshape(4, 4)) == 0.0
    assert seams.common(numpy.ones((10, 10), numpy.uint8), numpy.ones((10, 10), numpy.uint8), 8, 0) is None
