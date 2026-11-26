"""Pieces read at the overview's own size land on it: the downscale comes from the tiles' count, weak fits join by consensus."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from hcm_pipeline.placing import overview as overview_mod
from hcm_pipeline.placing import overview_find as overview_find_mod
from hcm_pipeline.placing.overview import TileFit, detail_of, expected_scale, fit_tiles, paste_on_overview
from hcm_pipeline.placing.overview_find import CanvasOpts, overview_canvas

from tests.synthetic.town import write_map
from tests.unit.test_placing_overview import _draw_cell_features, _make_tile

GRID = 4
CELL = 200
UPSCALE = 4


def _dense_overview() -> np.ndarray:
    rng = np.random.default_rng(7)
    side = GRID * CELL
    image = np.full((side, side), 220, dtype=np.uint8)
    for r in range(GRID):
        for c in range(GRID):
            _draw_cell_features(image, rng, r * CELL, c * CELL)
    return image


def _fit(scale: float, turn: float, inliers: int) -> TileFit:
    cos, sin = scale * np.cos(turn), scale * np.sin(turn)
    return TileFit(matrix=np.array([[cos, -sin, 0.0], [sin, cos, 0.0]]), inliers=inliers, rms_px=1.0)


def test_happy_pieces_read_at_the_overview_size_land_on_it(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-OVERVIEW-SCALE"""
    overview = _dense_overview()
    overview_path = write_map(tmp_path / "overview.tif", np.dstack([overview] * 3), grey=True)
    tiles = []
    for index in range(GRID * GRID):
        image = _make_tile(overview, index // GRID, index % GRID, (GRID, GRID), upscale=UPSCALE)
        tiles.append((f"img{362 + index}.tif", write_map(tmp_path / f"img{362 + index}.tif", np.dstack([image] * 3), grey=True)))
    assert overview_mod._base_scale(np.zeros((800, 800)), overview) == 1.0

    made = overview_canvas(tiles, overview_path, CanvasOpts(read_px=GRID * CELL))

    assert made is not None
    canvas, report = made
    assert len(report.placed) >= 12
    assert report.rms_px < 3.0
    assert canvas.shape == (GRID * CELL * UPSCALE, GRID * CELL * UPSCALE)


def test_bad_a_blank_piece_is_left_out_of_the_mosaic() -> None:
    """Scenarios: S-P20-BAD-OVERVIEW-SCALE-BLANK"""
    overview = _dense_overview()
    tiles = [(f"img{index}", _make_tile(overview, index // GRID, index % GRID, (GRID, GRID), upscale=UPSCALE)) for index in range(4)]
    tiles.append(("img-blank", np.full((800, 800), 128, dtype=np.uint8)))

    fits = fit_tiles(tiles, overview, GRID, GRID)

    assert fits[-1] is None
    assert sum(fit is not None for fit in fits) >= 3


def test_expected_scale_counts_the_tiles() -> None:
    assert expected_scale(16, 800.0 * 800.0, (800, 800)) == 4.0
    assert expected_scale(0, 100.0, (0, 0)) == 10.0


def test_weak_fits_join_only_when_they_agree_with_the_strong_ones() -> None:
    strong = [_fit(0.25, 0.0, 60), _fit(0.25, 0.01, 40)]
    consensus = overview_mod.consensus_of(strong)
    assert consensus is not None
    assert overview_mod._kept(_fit(0.251, 0.0, 12), consensus) is not None
    assert overview_mod._kept(_fit(0.4, 0.0, 12), consensus) is None
    assert overview_mod._kept(_fit(0.25, 0.5, 12), consensus) is None
    assert overview_mod._kept(_fit(0.25, 0.0, 12), None) is None
    assert overview_mod._kept(None, consensus) is None
    assert overview_mod.consensus_of([strong[0], _fit(0.25, 0.0, 12), None]) is None


def test_detail_and_upscale_follow_the_fits_within_the_canvas_cap() -> None:
    assert detail_of([None]) is None
    assert detail_of([_fit(0.25, 0.0, 30), None]) == 4.0
    small = np.zeros((1000, 800), dtype=np.uint8)
    assert overview_find_mod._upscale_of([_fit(0.25, 0.0, 30)], small) == 4.0
    assert overview_find_mod._upscale_of([None], small) == overview_find_mod.UPSCALE_LO
    huge = np.zeros((5000, 4000), dtype=np.uint8)
    assert overview_find_mod._upscale_of([_fit(0.1, 0.0, 30)], huge) == 4.0


def test_a_fit_off_the_canvas_paints_nothing() -> None:
    tile = np.zeros((10, 10), dtype=np.uint8)
    away = TileFit(matrix=np.array([[1.0, 0.0, 500.0], [0.0, 1.0, 500.0]]), inliers=30, rms_px=0.5)
    canvas, report = paste_on_overview([("away", tile)], [away], (20, 20), 1.0)
    assert int(canvas.min()) == 255
    assert report.placed == ["away"]


def test_rms_is_measured_on_the_inliers() -> None:
    rng = np.random.default_rng(3)
    src = rng.uniform(0, 200, (60, 2)).astype(np.float32)
    dst = src * 0.5 + 10.0
    dst[:10] += 300.0
    fit = overview_mod._affine_fit(src, dst)
    assert fit is not None
    assert fit.inliers == 50
    assert fit.rms_px < 0.1
