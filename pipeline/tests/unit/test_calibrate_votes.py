"""The chain of `locate` on synthetic frames: found and proved anywhere on Earth, with no landmark (M9 §10)."""

import numpy
import pytest
from hcm_pipeline.calibrate.chain import find_frame, hypotheses
from hcm_pipeline.calibrate.votes import (
    VOTE_MIN_AGREE,
    VOTE_TILE_BUDGET,
    VOTE_WARP_MIN_TILES,
    Hypothesis,
    VoteProposal,
    consensus,
    merged,
    tile_places,
    tiles_per_warp,
    vote_grid,
    warp_votes,
)
from hcm_pipeline.contract import SearchRange
from hcm_pipeline.geo import ground_scale

from tests.unit.calibrate_scene import Shot, elsewhere, map_error_ground_m, nothing, orientation_of, run, scene_of, search_of


@pytest.mark.parametrize("lat", [44.43, 0.3, 59.9])
def test_happy_path_a_frame_kilometres_off_is_found_and_proved_at_any_latitude(lat: float) -> None:
    """Scenarios: S-P06-HAPPY-VOTES"""
    scene = scene_of(Shot(lat=lat))
    lines: list[str] = []

    found = run(scene, lines)

    assert found.how == "votes"
    assert found.proof is not None
    assert found.proof.accepted
    assert map_error_ground_m(scene, found) < 25.0
    assert found.proof.checked.cv_m < 15.0
    assert any(line.startswith("tile votes:") and "moved 5.0 km" in line for line in lines)
    assert any(line.startswith("proved:") for line in lines)


@pytest.mark.parametrize(("turned", "mirrored"), [(0, False), (2, False), (0, True), (2, True)])
def test_happy_path_a_mirrored_or_turned_scan_recovers_its_orientation(turned: int, mirrored: bool) -> None:
    """Scenarios: S-P06-HAPPY-VOTES"""
    scene = scene_of(Shot(turned=turned, mirrored=mirrored))

    found = run(scene)

    assert found.proof is not None

    assert found.proof.accepted
    assert map_error_ground_m(scene, found) < 25.0
    assert orientation_of(found) is not None


def test_bad_path_a_frame_of_another_place_makes_no_false_positive() -> None:
    """Scenarios: S-P06-BAD-OFF-STRIP"""
    found = run(elsewhere(scene_of()))

    assert found.proof is None
    assert found.how == "none"


def test_bad_path_a_film_with_no_texture_says_no_votes_and_raises_nothing() -> None:
    """Scenarios: S-P06-BAD-LOW-TEXTURE"""
    scene = scene_of()
    flat = type(scene)(scene.reference, scene.grid, numpy.full_like(scene.film, 128), scene.truth, scene.quad)

    found = run(flat)

    assert found.proof is None
    assert found.refused is None
    assert found.votes == (0, 0)


def test_happy_path_the_budget_is_a_count_shared_over_the_warps() -> None:
    """Scenarios: S-P06-HAPPY-VOTES"""
    search = search_of(scene_of())
    warps = hypotheses(search)
    grid = vote_grid(search.reference, search.grid, search.search.margin_ground_m)

    places = tile_places(grid.valid, VOTE_TILE_BUDGET // len(warps), grid.tile_cells)

    assert len(places) * len(warps) <= VOTE_TILE_BUDGET * 1.2
    assert len({warp.assignment.rotation for warp in warps}) == len(warps) // (1 + len({warp.assignment.mirrored for warp in warps}) - 1)


@pytest.mark.parametrize(("warps", "tiles"), [(1, 720), (2, 360), (4, 180), (8, 180), (12, 180)])
def test_bad_path_a_warp_never_gets_too_few_tiles_to_agree(warps: int, tiles: int) -> None:
    """Scenarios: S-P06-BAD-MANY-WARPS"""
    assert tiles_per_warp(warps) == tiles
    # The real frames' true warps agreed on 13 of 196 at the least: a warp of this size can reach the bar, one of 60 cannot.
    assert tiles_per_warp(warps) * 13 / 196 > VOTE_MIN_AGREE


def test_happy_path_three_scales_ask_every_warp_in_full_the_models_own_scale_first(monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P06-BAD-MANY-WARPS"""
    asked: list[tuple[float, int]] = []

    def spy(_frame: object, hypothesis: Hypothesis, _grid: object, tiles: int, _tick: object) -> None:
        asked.append((hypothesis.scale, tiles))

    monkeypatch.setattr("hcm_pipeline.calibrate.chain.warp_votes", spy)
    scene = scene_of()
    find_frame(search_of(scene, search=SearchRange(15_000.0, (0.85, 1.0, 1.15))), nothing, lambda _line: None)

    assert {tiles for _, tiles in asked} == {VOTE_WARP_MIN_TILES}
    orientations = len(asked) // 3
    assert [scale for scale, _ in asked[:orientations]] == [1.0] * orientations


def test_happy_path_a_city_sized_window_keeps_the_full_tile_and_a_small_town_a_finer_one() -> None:
    """Scenarios: S-P06-HAPPY-VOTES"""
    search = search_of(scene_of())
    city = vote_grid(search.reference, search.grid, 30_000.0)
    town = vote_grid(search.reference[:600, :600], type(search.grid)(search.grid.left, search.grid.top, 10.0, 600, 600), 30_000.0)

    assert city.tile_cells >= town.tile_cells
    ground = ground_scale(search.grid.box().bounds().middle_lat)
    assert town.grid.resolution * ground == pytest.approx(30.0, abs=12.0)


def test_bad_path_a_warp_with_no_place_for_a_tile_is_no_proposal() -> None:
    """Scenarios: S-P06-BAD-OFF-STRIP"""
    search = search_of(scene_of())
    grid = vote_grid(search.reference, search.grid, 100.0)
    away = search.orientations[0]
    moved = type(away)(away.rotation, away.mirrored, numpy.array([[1.0, 0.0, 9e6], [0.0, 1.0, 9e6], [0.0, 0.0, 1.0]]) @ away.matrix)

    assert warp_votes(search.frame, Hypothesis(moved, 1.0, 100.0), grid, 10, nothing) is None


def _vote_rows(count: int, spread: float, shift: float = 5.0) -> numpy.ndarray:
    rng = numpy.random.default_rng(3)
    source = rng.uniform(0, spread, (count, 2))
    return numpy.column_stack((source, source + shift, numpy.full(count, 0.5)))


def test_bad_path_too_few_votes_too_narrow_or_an_unbelievable_scale_are_no_proposal() -> None:
    """Scenarios: S-P06-BAD-OFF-STRIP"""
    search = search_of(scene_of())
    matrix, grid = search.orientations[0].matrix, vote_grid(search.reference, search.grid, 100.0).grid
    hypothesis = Hypothesis(search.orientations[0], 1.0, 100.0)

    assert consensus(_vote_rows(3, 500.0), hypothesis, matrix, grid) is None
    assert consensus(_vote_rows(7, 500.0), hypothesis, matrix, grid) is None
    assert consensus(_vote_rows(30, 20.0), hypothesis, matrix, grid) is None
    stretched = _vote_rows(30, 500.0)
    stretched[:, 2:4] = stretched[:, :2] * 1.5
    assert consensus(stretched, hypothesis, matrix, grid) is None
    good = consensus(_vote_rows(30, 500.0), hypothesis, matrix, grid)
    assert good is not None
    assert good.agreed == 30
    assert good.strong


def test_happy_path_weak_proposals_of_one_place_add_their_votes() -> None:
    """Scenarios: S-P06-HAPPY-VOTES"""
    search = search_of(scene_of())
    first = Hypothesis(search.orientations[0], 1.0, 100.0)
    near = VoteProposal(first, search.orientations[0].matrix, 9, 50, 0.1, 1.0, 0.0, (100.0, 100.0))
    same = VoteProposal(first, search.orientations[0].matrix, 8, 50, 0.1, 1.0, 0.0, (400.0, 100.0))
    far = VoteProposal(first, search.orientations[0].matrix, 10, 50, 0.1, 1.0, 0.0, (9000.0, 100.0))

    kept = merged([near, same, far], 0.7)

    assert [each.agreed for each in kept] == [17, 10]
