"""The proof's last look (M9 §4, lesson 374): a map wrong by whole periods of a pattern, or over a part of the frame, has a rival."""

import math

import numpy
import pytest
from hcm_pipeline.calibrate.dense import dense_grid, nothing_measured
from hcm_pipeline.calibrate.proof import Checked, Proof, no_film
from hcm_pipeline.calibrate.rival import NO_RIVAL, PROOF_MAX_RIVAL, RIVAL_MIN_SIGMAS, Rival, looked_again, rival_of, rival_share

from tests.unit.calibrate_pattern import CENTRE, film_of, lattice, proof_of, random_land
from tests.unit.calibrate_scene import nothing, scene_of, search_of


def test_happy_path_a_true_map_over_land_that_repeats_nothing_has_no_rival() -> None:
    """Scenarios: S-P06-HAPPY-VOTES"""
    world = random_land()

    look = proof_of(world, film_of(world), (120.0, -80.0))

    assert look.proof.accepted
    assert look.proof.rival < PROOF_MAX_RIVAL / 2
    assert look.proof.rival_sigmas < RIVAL_MIN_SIGMAS
    assert look.error_m < 10.0


def test_happy_path_a_true_map_over_a_field_lattice_is_not_refused() -> None:
    """Scenarios: S-P06-BAD-REPEATING-PATTERN"""
    world = lattice()

    look = proof_of(world, film_of(world))

    assert look.proof.accepted, look.proof.refusal
    assert look.error_m < 10.0


@pytest.mark.parametrize("off", [(1680.0, 0.0), (1700.0, 10.0)])
def test_bad_path_a_map_whole_periods_of_a_field_lattice_off_is_refused(off: tuple[float, float]) -> None:
    """Scenarios: S-P06-BAD-REPEATING-PATTERN"""
    world = lattice()

    look = proof_of(world, film_of(world), off)

    # The narrowing search sees only the lattice, and the tiles that know better have no peak in it: this map held every gate.
    assert look.error_m > 500.0
    assert look.proof.refusal == "rival"
    assert look.proof.rival > PROOF_MAX_RIVAL


def test_bad_path_a_lattice_that_is_not_the_films_own_is_refused_as_well() -> None:
    """Scenarios: S-P06-BAD-REPEATING-PATTERN"""
    # The same period, its lines elsewhere: fields look alike, nothing truly matches, and the votes can propose such a place.
    look = proof_of(lattice(2), film_of(lattice(2, 5)), (1680.0, 0.0))

    assert look.proof.refusal == "rival"


@pytest.mark.parametrize(("start_share", "metres"), [(0.7, 500.0), (0.7, 1000.0), (0.8, 500.0)])
def test_bad_path_a_part_of_the_film_displaced_as_by_a_bad_seam_is_refused(start_share: float, metres: float) -> None:
    """Scenarios: S-P06-BAD-DISPLACED-PART"""
    world = random_land()
    half = 1200 * 10.0
    film = film_of(world, CENTRE[0] - half + 2 * half * start_share, metres)

    look = proof_of(world, film)

    assert look.proof.refusal == "rival"


def test_bad_path_a_map_whose_own_place_agrees_on_nothing_has_an_infinite_rival() -> None:
    """Scenarios: S-P06-BAD-REPEATING-PATTERN"""
    total = numpy.full((41, 41), -1.0)

    assert rival_of(total, 5).share == math.inf
    assert Rival(math.inf, 0.0).stands
    total[20, 20] = 4.0
    total[3, 3] = 1.0
    assert rival_of(total, 5).share == pytest.approx(0.25)
    assert rival_of(total, 5).sigmas > RIVAL_MIN_SIGMAS
    assert rival_of(total, 5).stands
    assert not Rival(0.09, 40.0).stands
    assert not Rival(0.3, 6.0).stands


def test_bad_path_a_window_too_small_for_the_sum_says_nothing() -> None:
    """Scenarios: S-P06-BAD-REPEATING-PATTERN"""
    scene = scene_of()
    search = search_of(scene)
    small = dense_grid(search.reference[:500, :500], type(search.grid)(search.grid.left, search.grid.top, 10.0, 500, 500))
    measured = nothing_measured()

    assert looked_again(no_film(measured), small, nothing).rival == 0.0
    accepted = Proof(None, 100, 100, 1.0, 1.0, Checked(1.0, 0.0, 9), measured)
    assert looked_again(accepted, small, nothing) is accepted


def test_happy_path_too_few_tiles_on_film_are_no_figure() -> None:
    """Scenarios: S-P06-BAD-REPEATING-PATTERN"""
    world = random_land()
    look = proof_of(world, film_of(world))
    assert look.proof.mapping is not None
    assert look.proof.measured.film is not None
    search = search_of(scene_of())
    tiny = dense_grid(search.reference[:300, :300], type(search.grid)(search.grid.left, search.grid.top, 10.0, 300, 300))

    assert rival_share(look.proof.mapping, look.proof.measured.film, tiny, nothing) == NO_RIVAL
