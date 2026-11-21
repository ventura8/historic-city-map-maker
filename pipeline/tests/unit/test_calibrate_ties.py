"""Film ties: a frame's image against a frame held still (docs/research/M15-calibration-accuracy.md, *Joint solve*)."""

import cv2
import numpy
import pytest
from hcm_pipeline.calibrate.ties import ALIGN_GROUND_M, AlignImage, align_cell, matched, tied
from hcm_pipeline.geo import FloatArray, ground_scale

SIDE = 600
CELL = 7.0


def texture(seed: int = 4) -> numpy.ndarray:
    """A grey land of fields and lines, 1 to 255."""
    noise = numpy.random.default_rng(seed).random((SIDE + 40, SIDE + 40)).astype(numpy.float32)
    blurred = cv2.GaussianBlur(noise, (0, 0), 3.0)
    scaled = (blurred - blurred.min()) / (blurred.max() - blurred.min())
    return numpy.asarray(1 + 254 * scaled, numpy.uint8)


def image(grey: numpy.ndarray) -> AlignImage:
    return AlignImage(grey, 2.9e6, 5.5e6, CELL)


def shifted(land: numpy.ndarray, right: float, down: float) -> numpy.ndarray:
    """The land as a frame shows it whose map puts every feature `right` and `down` cells further."""
    matrix = numpy.array([[1.0, 0.0, 20 + right], [0.0, 1.0, 20 + down]])
    moved = cv2.warpAffine(land.astype(numpy.float32), matrix, (SIDE + 40, SIDE + 40), flags=cv2.INTER_LINEAR)
    return numpy.asarray(numpy.clip(moved, 1, 255)[20 : 20 + SIDE, 20 : 20 + SIDE], numpy.uint8)


def identity(places: FloatArray) -> FloatArray:
    return places


def test_happy_path_each_tile_of_the_held_frame_is_found_where_ours_shows_it() -> None:
    """Scenarios: S-P06-HAPPY-JOINT-HELD-STILL"""
    land = texture()
    theirs, ours = image(shifted(land, 0.0, 0.0)), image(shifted(land, 3.4, -2.2))

    found = matched(ours, theirs, ALIGN_GROUND_M)
    ties = tied("held", found, ours, identity, ALIGN_GROUND_M)

    assert found.tried == 16
    assert len(found.offsets) >= 14
    assert numpy.median(found.offsets, axis=0) == pytest.approx([3.4, -2.2], abs=0.15)
    assert ties.partner == "held"
    assert ties.tried == 16
    shift = numpy.median(ties.film - ties.places, axis=0)
    assert shift == pytest.approx([3.4 * CELL, 2.2 * CELL], abs=1.2)


def test_bad_path_a_frame_of_another_place_gives_no_ties() -> None:
    """Scenarios: S-P06-BAD-JOINT-FEW-TIES"""
    theirs, ours = image(shifted(texture(4), 0.0, 0.0)), image(shifted(texture(9), 0.0, 0.0))

    found = matched(ours, theirs, ALIGN_GROUND_M)

    assert found.tried == 16
    assert len(found.offsets) <= 1


def test_bad_path_no_data_and_a_flat_image_are_never_tried() -> None:
    """Scenarios: S-P06-BAD-JOINT-FEW-TIES"""
    land = shifted(texture(), 0.0, 0.0)
    empty = numpy.zeros_like(land)
    flat = numpy.full_like(land, 120)

    assert matched(image(land), image(empty), ALIGN_GROUND_M).tried == 0
    assert matched(image(land), image(flat), ALIGN_GROUND_M).tried == 0
    none = tied("held", matched(image(land), image(empty), ALIGN_GROUND_M), image(land), identity, ALIGN_GROUND_M)
    assert none.film.shape == (0, 2)
    assert none.share == 0.0


def test_happy_path_the_align_grid_is_five_ground_metres() -> None:
    """Scenarios: S-P06-HAPPY-JOINT-HELD-STILL"""
    assert align_cell(44.4) * ground_scale(44.4) == pytest.approx(ALIGN_GROUND_M)
    places = image(texture()).places(numpy.array([0.5]), numpy.array([1.5]))
    assert places.tolist() == [[2.9e6 + 0.5 * CELL, 5.5e6 - 1.5 * CELL]]
