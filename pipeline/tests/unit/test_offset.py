"""Unit tests for Landsat rigid shift by phase correlation (docs/research/M25-landsat.md §3)."""

import cv2
import numpy
import pytest
from hcm_pipeline.geo import FloatArray
from hcm_pipeline.landsat.offset import BLUR_SIGMA_PX, Shift, high_pass, shift_of


def texture(size: int = 128) -> FloatArray:
    """A deterministic textured array for testing image correlation."""
    rng = numpy.random.default_rng(11)
    return numpy.asarray(rng.uniform(0, 255, (size, size)), numpy.float64)


def test_happy_path_shift_calculates_pixel_displacement() -> None:
    """Scenarios: S-P30-HAPPY"""
    shift = Shift(3.0, 4.0)

    assert shift.dx == 3.0
    assert shift.dy == 4.0
    assert shift.pixels == pytest.approx(5.0)


def test_bad_path_shift_handles_zero_and_negative_offset() -> None:
    """Scenarios: S-P30-BAD-OFFSET"""
    shift = Shift(0.0, 0.0)

    assert shift.pixels == 0.0
    assert Shift(-3.0, -4.0).pixels == pytest.approx(5.0)


def test_happy_path_high_pass_subtracts_blur_and_zeros_unmasked_pixels() -> None:
    """Scenarios: S-P30-HAPPY"""
    image = texture(64)
    keep = numpy.zeros(image.shape, numpy.bool_)
    keep[10:50, 10:50] = True

    filtered = high_pass(image, keep)

    blurred = cv2.GaussianBlur(image, (0, 0), BLUR_SIGMA_PX)
    expected = numpy.where(keep, image - blurred, 0.0)
    assert numpy.allclose(filtered, expected)
    assert (filtered[~keep] == 0.0).all()
    assert not numpy.allclose(filtered[keep], 0.0)


def test_bad_path_high_pass_returns_zeros_when_masked_or_uniform() -> None:
    """Scenarios: S-P30-BAD-OFFSET"""
    image = texture(64)
    all_masked = numpy.zeros(image.shape, numpy.bool_)
    assert (high_pass(image, all_masked) == 0.0).all()

    uniform = numpy.full((64, 64), 100.0, numpy.float64)
    all_kept = numpy.ones(uniform.shape, numpy.bool_)
    assert numpy.allclose(high_pass(uniform, all_kept), 0.0)


def test_happy_path_shift_of_measures_known_subpixel_shift() -> None:
    """Scenarios: S-P30-HAPPY"""
    reference = texture(128)
    moved = numpy.roll(reference, (-2, 3), axis=(0, 1))
    common = numpy.ones(reference.shape, numpy.bool_)

    shift = shift_of(moved, reference, common)

    assert shift is not None
    assert shift.dx == pytest.approx(3.0, abs=0.2)
    assert shift.dy == pytest.approx(-2.0, abs=0.2)
    assert shift.pixels == pytest.approx(13.0**0.5, abs=0.3)


def test_bad_path_shift_of_returns_none_when_overlap_too_small_or_no_peak() -> None:
    """Scenarios: S-P30-BAD-OFFSET"""
    reference = texture(128)
    common = numpy.ones(reference.shape, numpy.bool_)

    sparse_common = numpy.zeros(reference.shape, numpy.bool_)
    sparse_common[:10, :10] = True
    assert shift_of(reference, reference, sparse_common) is None

    empty = numpy.zeros((0, 0), numpy.float64)
    empty_mask = numpy.zeros((0, 0), numpy.bool_)
    assert shift_of(empty, empty, empty_mask) is None

    flat = numpy.zeros_like(reference)
    assert shift_of(reference, flat, common) is None
