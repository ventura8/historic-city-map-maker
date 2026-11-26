"""Tests for the overview tile placement module (synthetic data, no files)."""

from __future__ import annotations

import cv2
import numpy as np
import pytest
from hcm_pipeline.placing import overview as overview_mod
from hcm_pipeline.placing import sheetnames
from hcm_pipeline.placing.overview import (
    MosaicReport,
    TileFit,
    grid_hint,
    mosaic_on_overview,
    tile_on_overview,
)


def _draw_cell_features(
    img: np.ndarray,
    rng: np.random.Generator,
    y0: int,
    x0: int,
) -> None:
    """Draw internal features (lines and blocks) in one cell."""
    # Horizontal lines (roads)
    for _ in range(8):
        ly = int(rng.integers(y0 + 5, y0 + 195))
        lx0 = int(rng.integers(x0, x0 + 90))
        lx1 = int(rng.integers(x0 + 90, x0 + 195))
        t = int(rng.integers(1, 3))
        img[max(0, ly - t) : ly + t + 1, lx0:lx1] = int(rng.integers(30, 100))
    # Vertical lines (roads)
    for _ in range(8):
        lx = int(rng.integers(x0 + 5, x0 + 195))
        ly0 = int(rng.integers(y0, y0 + 90))
        ly1 = int(rng.integers(y0 + 90, y0 + 195))
        t = int(rng.integers(1, 3))
        img[ly0:ly1, max(0, lx - t) : lx + t + 1] = int(rng.integers(30, 100))
    # Blocks (outlines)
    for _ in range(5):
        bx = int(rng.integers(x0 + 5, x0 + 150))
        by = int(rng.integers(y0 + 5, y0 + 150))
        bw = int(rng.integers(20, 50))
        bh = int(rng.integers(20, 50))
        val = int(rng.integers(40, 130))
        img[by : by + bh, bx : bx + 2] = val
        img[by : by + bh, bx + bw - 2 : bx + bw] = val
        img[by : by + 2, bx : bx + bw] = val
        img[by + bh - 2 : by + bh, bx : bx + bw] = val
    # Small filled rectangles
    for _ in range(4):
        bx = int(rng.integers(x0 + 5, x0 + 170))
        by = int(rng.integers(y0 + 5, y0 + 170))
        bw = int(rng.integers(10, 25))
        bh = int(rng.integers(10, 25))
        img[by : by + bh, bx : bx + bw] = int(rng.integers(50, 160))


def _make_overview(shape: tuple[int, int] = (800, 800)) -> np.ndarray:
    """Create a synthetic street-like overview with lines and blocks."""
    rng = np.random.default_rng(42)
    img = np.full(shape, 220, dtype=np.uint8)

    # Major grid streets (5 horizontal + 5 vertical for a 4x4 layout)
    for i in range(5):
        pos = i * 200
        img[max(0, pos - 3) : pos + 4, :] = 40
        img[:, max(0, pos - 3) : pos + 4] = 40

    # Internal features per cell to give ORB enough corners
    for r in range(4):
        for c in range(4):
            _draw_cell_features(img, rng, r * 200 + 20, c * 200 + 20)

    return img


def _make_overview_3x3(shape: tuple[int, int] = (600, 600)) -> np.ndarray:
    """Create a synthetic street-like overview with a 3x3 grid."""
    rng = np.random.default_rng(42)
    img = np.full(shape, 220, dtype=np.uint8)
    rows, cols = 3, 3
    ch = shape[0] // rows
    cw = shape[1] // cols

    # Grid streets
    for i in range(rows + 1):
        pos = i * ch
        img[max(0, pos - 3) : pos + 4, :] = 40
    for i in range(cols + 1):
        pos = i * cw
        img[:, max(0, pos - 3) : pos + 4] = 40

    # Internal features per cell
    for r in range(rows):
        for c in range(cols):
            _draw_cell_features(img, rng, r * ch + 20, c * cw + 20)

    return img


def _make_tile(
    overview: np.ndarray,
    row: int,
    col: int,
    grid: tuple[int, int],
    *,
    upscale: int,
) -> np.ndarray:
    """Cut a tile from the overview and upscale it by *upscale*x."""
    rows, cols = grid
    ch = overview.shape[0] // rows
    cw = overview.shape[1] // cols
    y0 = row * ch
    x0 = col * cw
    crop = overview[y0 : y0 + ch, x0 : x0 + cw]
    return np.repeat(np.repeat(crop, upscale, axis=0), upscale, axis=1)


def _tile_for_cell(
    overview: np.ndarray,
    r: int,
    c: int,
    grid: tuple[int, int],
    upscale: int,
) -> np.ndarray:
    """Return a blank tile for cell (1,1) or a cropped tile otherwise."""
    if r == 1 and c == 1:
        return np.full((400, 400), 128, dtype=np.uint8)
    return _make_tile(overview, r, c, grid, upscale=upscale)


def _build_mosaic_tiles(
    overview: np.ndarray,
    rows: int,
    cols: int,
    upscale: int,
) -> list[tuple[str, np.ndarray]]:
    """Build the 3x3 tile list with one blank tile at (1,1)."""
    tiles: list[tuple[str, np.ndarray]] = []
    for r in range(rows):
        for c in range(cols):
            name = f"r{r + 1:02d}c{c + 1:02d}"
            tiles.append((name, _tile_for_cell(overview, r, c, (rows, cols), upscale)))
    return tiles


def _verify_mosaic_region(
    canvas: np.ndarray,
    overview: np.ndarray,
    rows: int,
    cols: int,
    upscale: int,
) -> None:
    """Verify each placed tile region matches expected content within MAD 12."""
    for r in range(rows):
        for c in range(cols):
            if r == 1 and c == 1:
                continue
            name = f"r{r + 1:02d}c{c + 1:02d}"
            y0 = r * 400
            x0 = c * 400
            region = canvas[y0 : y0 + 400, x0 : x0 + 400]
            expected = _make_tile(overview, r, c, (rows, cols), upscale=upscale)
            mad = float(np.mean(np.abs(region.astype(np.int16) - expected.astype(np.int16))))
            assert mad < 12, f"Tile {name} MAD {mad:.1f} exceeds 12 grey levels"


def test_tile_on_overview_fits_within_2px() -> None:
    """Each of 4 tiles should be placed within 2 px of the true offset."""
    overview = _make_overview((800, 800))
    rows, cols = 4, 4
    upscale = 2

    cells = [(0, 0), (0, 1), (1, 0), (1, 1)]
    for r, c in cells:
        tile = _make_tile(overview, r, c, (rows, cols), upscale=upscale)
        hint = grid_hint(f"r{r + 1:02d}c{c + 1:02d}", rows, cols, overview.shape)
        assert hint is not None

        fit = tile_on_overview(tile, overview, hint)
        assert fit is not None, f"Tile ({r},{c}) should produce a fit"

        tw, th = tile.shape[1], tile.shape[0]
        tcx, tcy = tw / 2.0, th / 2.0
        mx = fit.matrix[0, 0] * tcx + fit.matrix[0, 1] * tcy + fit.matrix[0, 2]
        my = fit.matrix[1, 0] * tcx + fit.matrix[1, 1] * tcy + fit.matrix[1, 2]

        ch = overview.shape[0] // rows
        cw = overview.shape[1] // cols
        exp_cx = (c + 0.5) * cw
        exp_cy = (r + 0.5) * ch

        err = float(np.sqrt((mx - exp_cx) ** 2 + (my - exp_cy) ** 2))
        assert err < 2.0, f"Tile ({r},{c}) error {err:.2f} px exceeds 2 px"


def test_blank_tile_returns_none() -> None:
    """A blank (uniform) tile should not produce a valid fit."""
    overview = _make_overview((800, 800))
    blank = np.full((400, 400), 128, dtype=np.uint8)
    fit = tile_on_overview(blank, overview, (400, 400))
    assert fit is None


def test_grid_hint_patterns() -> None:
    """grid_hint should parse all supported name patterns correctly."""
    rows, cols = 4, 4
    shape = (800, 800)
    cell = 200  # 800 / 4

    # r03c07 -> row 3, col 7 (1-based) -> 0-indexed row 2, col 6
    h = grid_hint("r03c07", rows, cols, shape)
    assert h is not None
    assert abs(h[0] - 6.5 * cell) < 1
    assert abs(h[1] - 2.5 * cell) < 1

    # 3_7 -> row 3, col 7 (1-based) -> 0-indexed row 2, col 6
    h = grid_hint("3_7", rows, cols, shape)
    assert h is not None
    assert abs(h[0] - 6.5 * cell) < 1
    assert abs(h[1] - 2.5 * cell) < 1

    # 03-07 -> row 3, col 7 (1-based) -> 0-indexed row 2, col 6
    h = grid_hint("03-07", rows, cols, shape)
    assert h is not None
    assert abs(h[0] - 6.5 * cell) < 1
    assert abs(h[1] - 2.5 * cell) < 1

    # A3 -> row A=1, col 3 (1-based) -> 0-indexed row 0, col 2
    h = grid_hint("A3", rows, cols, shape)
    assert h is not None
    assert abs(h[0] - 2.5 * cell) < 1
    assert abs(h[1] - 0.5 * cell) < 1

    # C12 -> row C=3, col 12 (1-based) -> 0-indexed row 2, col 11
    h = grid_hint("C12", rows, cols, shape)
    assert h is not None
    assert abs(h[0] - 11.5 * cell) < 1
    assert abs(h[1] - 2.5 * cell) < 1

    # Sheet 5 in 4x4 row-major -> 0-indexed row 1, col 0
    h = grid_hint("5", rows, cols, shape)
    assert h is not None
    assert abs(h[0] - 0.5 * cell) < 1
    assert abs(h[1] - 1.5 * cell) < 1


def test_grid_hint_no_numbers() -> None:
    """A name without any numbers should return None."""
    h = grid_hint("tile_alpha", 4, 4, (800, 800))
    assert h is None


def test_mosaic_3x3_placed_and_unplaced() -> None:
    """3x3 mosaic: 8 tiles placed within MAD 12, 1 blank tile unplaced."""
    overview = _make_overview_3x3((600, 600))
    rows, cols = 3, 3
    upscale = 2.0

    tiles = _build_mosaic_tiles(overview, rows, cols, 2)
    canvas, report = mosaic_on_overview(tiles, overview, rows, cols, upscale)

    # Canvas dimensions
    assert canvas.shape == (1200, 1200)
    assert canvas.dtype == np.uint8

    # 8 placed, 1 unplaced
    assert len(report.placed) == 8
    assert len(report.unplaced) == 1
    assert "r02c02" in report.unplaced

    # The placed area matches the overview at the tiles' resolution
    expected = cv2.resize(overview, (1200, 1200), interpolation=cv2.INTER_LINEAR)
    placed_area = canvas != 255
    mad = float(np.mean(np.abs(canvas[placed_area].astype(np.int16) - expected[placed_area].astype(np.int16))))
    assert mad < 12, f"mosaic MAD {mad:.1f} exceeds 12 grey levels"

    # RMS should be a positive finite value
    assert report.rms_px > 0.0
    assert np.isfinite(report.rms_px)

    # Each placed tile region should match the expected content
    _verify_mosaic_region(canvas, overview, rows, cols, 2)


def test_mosaic_report_type() -> None:
    """MosaicReport fields have the expected types."""
    overview = _make_overview_3x3((600, 600))
    tile = _make_tile(overview, 0, 0, (3, 3), upscale=2)
    tiles = [("r01c01", tile)]
    _, report = mosaic_on_overview(tiles, overview, 3, 3, 2.0)
    assert isinstance(report, MosaicReport)
    assert isinstance(report.placed, list)
    assert isinstance(report.unplaced, list)
    assert isinstance(report.rms_px, float)


def test_descriptors_ok_rejects_missing_overview_descriptors_and_few_keypoints() -> None:
    des = np.zeros((20, 32), dtype=np.uint8)
    many = [object()] * 20
    few = [object()] * 5
    assert overview_mod._descriptors_ok(des, None, many, many) is None
    assert overview_mod._descriptors_ok(des, des, few, many) is None
    assert overview_mod._descriptors_ok(des, des, many, few) is None
    assert overview_mod._descriptors_ok(des, des, many, many) is not None


def test_apply_hint_passes_through_without_hint_and_rejects_empty_window() -> None:
    src = np.array([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0]], dtype=np.float32)
    dst = src.copy()
    kept = overview_mod._apply_hint(src, dst, None, 10.0, 10.0)
    assert kept is not None
    assert len(kept[0]) == 4
    assert overview_mod._apply_hint(src, dst, (1000.0, 1000.0), 1.0, 1.0) is None


def test_tile_on_overview_without_hint_still_fits() -> None:
    overview = _make_overview((800, 800))
    tile = _make_tile(overview, 0, 0, (4, 4), upscale=2)
    fit = tile_on_overview(tile, overview, None)
    assert fit is not None
    assert fit.inliers >= 25


def test_match_rejects_too_few_ratio_matches(monkeypatch: pytest.MonkeyPatch) -> None:
    overview = _make_overview((800, 800))
    tile = _make_tile(overview, 0, 0, (4, 4), upscale=2)
    monkeypatch.setattr(overview_mod, "_ratio_match", lambda _a, _b: [])
    assert tile_on_overview(tile, overview, (100.0, 100.0)) is None


def test_match_rejects_when_hint_window_keeps_too_few_points() -> None:
    overview = _make_overview((800, 800))
    tile = _make_tile(overview, 0, 0, (4, 4), upscale=2)
    assert tile_on_overview(tile, overview, (10_000.0, 10_000.0)) is None


def test_grid_hint_rejects_sheet_outside_the_grid() -> None:
    assert grid_hint("99", 2, 2, (100, 100)) is None
    assert sheetnames.cell_of("tile", 2, 2) is None


def test_mosaic_all_unplaced_reports_zero_rms() -> None:
    overview = _make_overview((400, 400))
    blank = np.full((200, 200), 128, dtype=np.uint8)
    canvas, report = mosaic_on_overview([("blank", blank)], overview, 2, 2, 1.0)
    assert report.placed == []
    assert report.unplaced == ["blank"]
    assert report.rms_px == 0.0
    assert canvas.shape == (400, 400)


def test_better_prefers_more_inliers() -> None:
    weak = TileFit(matrix=np.eye(2, 3, dtype=np.float64), inliers=30, rms_px=1.0)
    strong = TileFit(matrix=np.eye(2, 3, dtype=np.float64), inliers=40, rms_px=2.0)
    assert overview_mod._better(None, weak) is True
    assert overview_mod._better(weak, strong) is True
    assert overview_mod._better(strong, weak) is False
