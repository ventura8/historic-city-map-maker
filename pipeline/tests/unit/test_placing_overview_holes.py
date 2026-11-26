"""The second pass: a piece the overview's features left out is looked for again in the overview's holes (overview_holes)."""

from __future__ import annotations

import numpy as np
import pytest
from hcm_pipeline.placing import overview_holes as holes_mod
from hcm_pipeline.placing.overview import TileFit, fit_tiles
from hcm_pipeline.placing.overview_holes import Found, agrees, correlate, coverage, refine, refit_in_holes, template_of

from tests.unit.test_placing_overview import _make_tile
from tests.unit.test_placing_overview_scale import GRID, UPSCALE, _dense_overview

TRUTH_SCALE = 1.0 / UPSCALE


def _pieces(overview: np.ndarray) -> list[tuple[str, np.ndarray]]:
    return [
        (f"img{index}", _make_tile(overview, index // GRID, index % GRID, (GRID, GRID), upscale=UPSCALE)) for index in range(GRID * GRID)
    ]


def _truth(index: int, overview: np.ndarray) -> np.ndarray:
    cell = overview.shape[0] // GRID
    return np.array([[TRUTH_SCALE, 0.0, (index % GRID) * cell], [0.0, TRUTH_SCALE, (index // GRID) * cell]])


def _true_fits(overview: np.ndarray, left_out: int) -> list[TileFit | None]:
    return [None if index == left_out else TileFit(_truth(index, overview), 60, 0.5) for index in range(GRID * GRID)]


def _error_px(fit: TileFit, truth: np.ndarray, side: int) -> float:
    corners = np.array([[0, 0], [side, 0], [0, side], [side, side]], dtype=np.float64)
    return float(np.abs(corners @ fit.matrix[:, :2].T + fit.matrix[:, 2] - (corners @ truth[:, :2].T + truth[:, 2])).max())


def test_happy_a_left_out_piece_lands_in_its_hole() -> None:
    """Scenarios: S-P20-HAPPY-OVERVIEW-HOLES"""
    overview = _dense_overview()
    tiles = _pieces(overview)
    fits = _true_fits(overview, 5)

    found = refit_in_holes(tiles, fits, overview)

    assert found[5] is not None
    assert _error_px(found[5], _truth(5, overview), tiles[5][1].shape[0]) < 2.0
    assert found[:5] == fits[:5]


def test_happy_the_pieces_the_first_pass_misses_land_where_they_belong() -> None:
    """Scenarios: S-P20-HAPPY-OVERVIEW-HOLES"""
    overview = _dense_overview()
    tiles = _pieces(overview)
    first = fit_tiles(tiles, overview, GRID, GRID)
    first[5] = None

    found = refit_in_holes(tiles, first, overview)

    missed = [index for index, fit in enumerate(first) if fit is None]
    for index in missed:
        fit = found[index]
        assert fit is not None
        assert _error_px(fit, _truth(index, overview), tiles[index][1].shape[0]) < 3.0


def test_happy_an_upside_down_piece_lands_turned() -> None:
    """Scenarios: S-P20-HAPPY-OVERVIEW-HOLES"""
    overview = _dense_overview()
    tiles = _pieces(overview)
    tiles[6] = (tiles[6][0], np.ascontiguousarray(tiles[6][1][::-1, ::-1]))

    found = refit_in_holes(tiles, _true_fits(overview, 6), overview)

    assert found[6] is not None
    side = tiles[6][1].shape[0]
    turned = found[6].matrix
    assert agrees(found[6], TRUTH_SCALE, float(np.pi))
    centre = turned[:, :2] @ np.array([side / 2, side / 2]) + turned[:, 2]
    expected = _truth(6, overview)[:, :2] @ np.array([side / 2, side / 2]) + _truth(6, overview)[:, 2]
    assert float(np.abs(centre - expected).max()) < 2.0


def test_bad_a_piece_of_another_map_stays_out() -> None:
    """Scenarios: S-P20-BAD-OVERVIEW-HOLES-NOT-FOUND"""
    overview = _dense_overview()
    tiles = _pieces(overview)
    noise = np.random.default_rng(5).integers(0, 255, overview.shape, dtype=np.uint8)
    tiles[9] = ("foreign", _make_tile(noise, 0, 0, (GRID, GRID), upscale=UPSCALE))

    found = refit_in_holes(tiles, _true_fits(overview, 9), overview)

    assert found[9] is None


def test_bad_a_blank_piece_stays_out() -> None:
    """Scenarios: S-P20-BAD-OVERVIEW-HOLES-NOT-FOUND"""
    overview = _dense_overview()
    tiles = _pieces(overview)
    tiles[3] = ("blank", np.full_like(tiles[3][1], 200))

    assert refit_in_holes(tiles, _true_fits(overview, 3), overview)[3] is None


def test_no_consensus_or_nothing_left_out_changes_nothing() -> None:
    overview = _dense_overview()
    tiles = _pieces(overview)[:2]
    lonely: list[TileFit | None] = [TileFit(_truth(0, overview), 60, 0.5), None]
    assert refit_in_holes(tiles, lonely, overview) == lonely
    full: list[TileFit | None] = [TileFit(_truth(0, overview), 60, 0.5), TileFit(_truth(1, overview), 60, 0.5)]
    assert refit_in_holes(tiles, full, overview) == full


def test_a_piece_larger_than_the_overview_or_without_a_clear_place_is_not_found() -> None:
    overview = _dense_overview()
    holes = np.ones(overview.shape, dtype=np.uint8)
    assert correlate(np.zeros((40, 40), dtype=np.uint8) + 9, overview, holes, (100.0, 0.0)) is None
    stripes = np.tile(np.array([[0] * 8 + [255] * 8], dtype=np.uint8), (64, 4))
    repeated = np.tile(stripes, (8, 8))
    periodic = correlate(stripes, repeated, np.ones(repeated.shape, dtype=np.uint8), (1.0, 0.0))
    assert periodic is not None
    assert periodic.margin < holes_mod.MIN_MARGIN
    no_hole = np.zeros(overview.shape, dtype=np.uint8)
    tile = _make_tile(overview, 1, 1, (GRID, GRID), upscale=UPSCALE)
    assert correlate(tile, overview, no_hole, (TRUTH_SCALE, 0.0)) is None


def test_refine_keeps_the_correlation_when_the_features_disagree() -> None:
    overview = _dense_overview()
    tile = _make_tile(overview, 2, 2, (GRID, GRID), upscale=UPSCALE)
    wrong = TileFit(np.array([[TRUTH_SCALE, 0.0, 10.0], [0.0, TRUTH_SCALE, 10.0]]), 0, 0.0)
    found = Found(wrong, 0.9, 0.5, 0.0)
    assert refine(tile, overview, found, (TRUTH_SCALE, 0.0)).matrix is wrong.matrix
    blank = np.full_like(tile, 200)
    assert refine(blank, overview, found, (TRUTH_SCALE, 0.0)) is wrong
    right = Found(TileFit(_truth(10, overview), 0, 0.0), 0.9, 0.5, 0.0)
    refined = refine(tile, overview, right, (TRUTH_SCALE, 0.0))
    assert _error_px(refined, _truth(10, overview), tile.shape[0]) < 2.0


def test_coverage_and_template_follow_the_fits() -> None:
    overview = _dense_overview()
    mask = coverage([(800, 800), (800, 800)], [TileFit(_truth(0, overview), 60, 0.5), None], overview.shape)
    assert mask[10, 10] == 255
    assert mask[790, 790] == 0
    template, matrix = template_of(np.zeros((80, 40), dtype=np.uint8), (0.5, float(np.pi)))
    assert template.shape == (40, 20)
    assert float(matrix[0, 2]) == pytest.approx(20.0)
    assert agrees(TileFit(np.array([[-0.5, 0.0, 0.0], [-1e-3, -0.5, 0.0]]), 0, 0.0), 0.5, float(-np.pi))
    assert not agrees(TileFit(np.array([[0.5, 0.0, 0.0], [0.0, 0.5, 0.0]]), 0, 0.0), 0.5, float(np.pi))


def test_bad_a_piece_with_no_clear_place_stays_out() -> None:
    """Scenarios: S-P20-BAD-OVERVIEW-HOLES-NOT-FOUND"""
    stripes = np.tile(np.array([[0] * 8 + [255] * 8], dtype=np.uint8), (64, 4))
    overview = np.tile(stripes, (8, 8))
    piece = np.repeat(np.repeat(stripes, 2, axis=0), 2, axis=1)
    placed = TileFit(np.array([[0.5, 0.0, 0.0], [0.0, 0.5, 0.0]]), 60, 0.5)
    fits: list[TileFit | None] = [placed, TileFit(np.array([[0.5, 0.0, 64.0], [0.0, 0.5, 0.0]]), 60, 0.5), None]

    assert refit_in_holes([("a", piece), ("b", piece), ("c", piece)], fits, overview)[2] is None
