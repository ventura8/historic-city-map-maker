"""What the worker puts in the box (M10): the film warped through its start at 15 m, the reference on its grid."""

import numpy
import pytest
from hcm_pipeline.geo import Grid
from hcm_pipeline.worker.local_matcher import reference_at_15, warp_start

from tests.unit.calibrate_scene import ArrayReader
from tests.unit.test_local_matcher import GRID, film_reader, request_of


def test_happy_path_the_film_is_warped_through_its_start_at_15_m() -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    film = numpy.zeros((900, 1200), numpy.uint8)
    film[300:600, 450:750] = 200
    reference = reference_at_15(numpy.array(film), GRID)
    request = request_of(ArrayReader(film), 1)

    warped = warp_start(request, request.starts[0], reference)

    assert reference.shape == (600, 800)
    # A margin of 300 m is 20 cells; the start is the grid itself, so the film and the reference line up 20 cells apart.
    assert warped.film.shape == (640, 840)
    assert warped.film_grid[0, 2] == pytest.approx(1000.0 - 20 * 15.0)
    bright_film = numpy.argwhere(warped.film > 150)
    bright_reference = numpy.argwhere(reference > 150)
    assert abs(bright_film.mean(axis=0) - bright_reference.mean(axis=0) - 20).max() < 1.0
    # A film pixel of 0 is no data only where there is no film.
    assert (warped.film[100:120, 100:120] == 1).all()


def test_bad_path_a_start_off_the_film_or_with_no_reader_warps_nothing() -> None:
    """Scenarios: S-P07-BAD-FALSE-PROPOSAL"""
    request = request_of(film_reader(), 1)
    far = numpy.array([[10.0, 0.0, 9_000_000.0], [0.0, -10.0, 90000.0], [0.0, 0.0, 1.0]])
    reference = reference_at_15(request.reference, GRID)

    assert warp_start(request, far, reference).film.max() == 0


def test_happy_path_a_coarser_reference_is_averaged_first() -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    fine = Grid(0.0, 0.0, 5.0, 600, 300)
    assert reference_at_15(numpy.full((300, 600), 90, numpy.uint8), fine).shape == (100, 200)
