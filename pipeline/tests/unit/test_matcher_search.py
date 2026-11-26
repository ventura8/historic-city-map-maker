"""The matcher's search (M10): the real consensus in the pipeline's own environment, over a fake network of real keypoints."""

import numpy
from hcm_pipeline.images import UInt8Array
from hcm_pipeline.matcher.box import Request
from hcm_pipeline.matcher.search import (
    CONSENSUS_KEEP,
    PAIR_MIN_INLIERS,
    TILE_PX,
    _kept_inliers,
    consensus,
    decimated,
    film_tiles,
    norm8,
    pair_inliers,
    reference_tiles,
    search,
    tile_size,
    tiles_over,
    to_matrix,
)

from tests.fakes.sidecar import OrbBackend
from tests.synthetic.scenes import render_world

SHIFT = (90, -45)
PIXEL = 15.0
GROUND = 0.71


def world_request(reference: UInt8Array | None = None) -> Request:
    """A film of the world moved by `SHIFT` cells on a grid with a margin of 150 cells, the world's middle as the reference."""
    world = render_world(7, 1800).pixels
    window = world[300:1500, 300:1500]
    film = numpy.maximum(numpy.roll(numpy.roll(world, SHIFT[1], axis=0), SHIFT[0], axis=1)[150:1650, 150:1650], 1)
    reference_grid = numpy.array([[PIXEL, 0.0, 1000.0], [0.0, -PIXEL, 90000.0], [0.0, 0.0, 1.0]], numpy.float64)
    film_grid = numpy.array([[PIXEL, 0.0, 1000.0 - 150 * PIXEL], [0.0, -PIXEL, 90000.0 + 150 * PIXEL], [0.0, 0.0, 1.0]], numpy.float64)
    return Request(numpy.asarray(film, numpy.uint8), window if reference is None else reference, film_grid, reference_grid, GROUND)


def nothing() -> None:
    """A tick that never stops."""


def test_happy_path_the_consensus_names_where_the_film_truly_lies() -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    found = search(world_request(), OrbBackend(), nothing)

    assert 1 <= len(found) <= 3
    assert found[0].pairs >= 1
    assert found[0].points >= PAIR_MIN_INLIERS
    # The start's places move back by the shift: film cell + SHIFT shows what the reference holds at the cell.
    moved = found[0].matrix @ numpy.array([2000.0, 80000.0, 1.0])
    assert abs(moved[0] - 2000.0 + SHIFT[0] * PIXEL) < 30.0
    assert abs(moved[1] - 80000.0 - SHIFT[1] * PIXEL) < 30.0


def test_bad_path_a_mirrored_reference_proposes_nothing() -> None:
    """Scenarios: S-P07-BAD-FALSE-PROPOSAL"""
    mirrored = numpy.fliplr(world_request().reference).copy()

    assert search(world_request(mirrored), OrbBackend(), nothing) == ()


def test_bad_path_a_film_with_no_data_matches_nothing_and_asks_no_network() -> None:
    """Scenarios: S-P07-BAD-FALSE-PROPOSAL"""
    request = world_request()
    empty = Request(numpy.zeros_like(request.film), request.reference, request.film_grid, request.reference_grid, GROUND)

    assert search(empty, OrbBackend(), nothing) == ()


def test_happy_path_a_window_under_a_tile_is_one_tile() -> None:
    """Scenarios: S-P07-HAPPY-SMALL-WINDOW"""
    small = numpy.full((300, 400), 90, numpy.uint8)

    assert tile_size(small) == (400, True)
    assert tile_size(numpy.full((TILE_PX, TILE_PX), 90, numpy.uint8)) == (TILE_PX, False)
    assert len(reference_tiles(small, 400)) == 1
    assert film_tiles(numpy.full((700, 800), 90, numpy.uint8), 400)


def test_happy_path_tiles_reach_the_far_edge() -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    assert tiles_over(100, 50, 50, 25) == [(0, 0), (25, 0), (50, 0)]


def test_bad_path_a_blank_tile_stays_blank_and_a_pair_with_few_or_wild_points_gives_no_vote() -> None:
    """Scenarios: S-P07-BAD-FALSE-PROPOSAL"""
    assert norm8(numpy.zeros((32, 32), numpy.uint8)).max() == 0
    few = numpy.zeros((3, 2))
    assert pair_inliers(few, few) is None
    rng = numpy.random.default_rng(3)
    points = rng.uniform(0, 700, (40, 2))
    # A consistent quarter turn: every point agrees, and it is no start's near-identity.
    turned = numpy.column_stack((-points[:, 1], points[:, 0]))
    assert pair_inliers(points, turned) is None
    assert pair_inliers(points, points + 5.0) is not None


def test_bad_path_a_consensus_of_nothing_is_nothing() -> None:
    """Scenarios: S-P07-BAD-FALSE-PROPOSAL"""
    assert consensus([], numpy.zeros(2), GROUND, 500.0, 1000.0) == []


def test_bad_path_a_fit_that_found_no_model_keeps_no_inliers() -> None:
    """Scenarios: S-P07-BAD-FALSE-PROPOSAL"""
    assert _kept_inliers(None, None) is None


def test_happy_path_too_few_points_to_refine_keep_the_pairs_own_fit() -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    film = numpy.array([[0.0, 0.0], [3000.0, 0.0], [0.0, 3000.0]])

    found = consensus([(film, film + numpy.array([100.0, 50.0]))], numpy.array([0.0, 0.0]), GROUND, 500.0, 1000.0)

    assert [(each.pairs, each.points) for each in found] == [(1, 3)]


def test_happy_path_the_consensus_keeps_only_so_many_places() -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    rng = numpy.random.default_rng(6)
    films = rng.uniform(0, 5000, (CONSENSUS_KEEP + 2, 20, 2))
    votes = [(each, each + numpy.array([9000.0 * place, 0.0])) for place, each in enumerate(films)]

    found = consensus(votes, numpy.array([2500.0, 2500.0]), GROUND, 500.0, 1000.0)

    assert len(found) == CONSENSUS_KEEP


def test_happy_path_two_places_stay_two_proposals_and_one_place_is_merged() -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    rng = numpy.random.default_rng(5)
    points = [rng.uniform(0, 5000, (20, 2)) for _ in range(5)]
    near = [(each, each + numpy.array([100.0, 0.0])) for each in points[:3]]
    far = [(each, each + numpy.array([9000.0, 0.0])) for each in points[3:]]

    found = consensus([*near, *far], numpy.array([2500.0, 2500.0]), GROUND, 500.0, 1000.0)

    assert [each.pairs for each in found] == [3, 2]
    matrix = to_matrix(found[0])
    assert abs((matrix @ numpy.array([1.0, 1.0, 1.0]))[0] - 101.0) < 1.0


def test_happy_path_the_processors_search_at_half_resolution_finds_the_same_place() -> None:
    """M26 h2: a window of two tiles a side or more is searched at half its resolution; the grids follow the coarse pixels.

    Scenarios: S-P07-HAPPY-CPU-FALLBACK
    """
    world = render_world(7, 3600).pixels
    window = world[600:3000, 600:3000]
    film = numpy.maximum(numpy.roll(numpy.roll(world, SHIFT[1], axis=0), SHIFT[0], axis=1)[300:3300, 300:3300], 1)
    reference_grid = numpy.array([[PIXEL, 0.0, 1000.0], [0.0, -PIXEL, 90000.0], [0.0, 0.0, 1.0]], numpy.float64)
    film_grid = numpy.array([[PIXEL, 0.0, 1000.0 - 300 * PIXEL], [0.0, -PIXEL, 90000.0 + 300 * PIXEL], [0.0, 0.0, 1.0]], numpy.float64)
    request = Request(numpy.asarray(film, numpy.uint8), window, film_grid, reference_grid, GROUND)

    coarse = decimated(request, 2)
    assert coarse.reference.shape == (1200, 1200)
    # The coarse pixel (0, 0) averages the fine (0, 0) to (1, 1): its place is the fine (0.5, 0.5)'s.
    assert numpy.allclose(coarse.reference_grid @ [0.0, 0.0, 1.0], reference_grid @ [0.5, 0.5, 1.0])
    found = search(request, OrbBackend(), nothing, 2)
    assert found
    moved = found[0].matrix @ numpy.array([20000.0, 70000.0, 1.0])
    assert abs(moved[0] - 20000.0 + SHIFT[0] * PIXEL) < 60.0
    assert abs(moved[1] - 70000.0 - SHIFT[1] * PIXEL) < 60.0


def test_bad_path_a_window_under_two_tiles_is_searched_as_it_is() -> None:
    """Scenarios: S-P07-HAPPY-SMALL-WINDOW"""
    request = world_request()

    assert decimated(request, 2) is request
    assert decimated(request, 1) is request
