"""Tests for overview_canvas on a colour series: fitted on grey, pasted in its own bands (docs/LESSONS.md 572)."""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy
from hcm_pipeline.placing.overview_find import CanvasOpts, overview_canvas

from tests.synthetic.town import write_map
from tests.unit.test_placing_overview import _make_overview, _make_tile


def _tinted(grey: numpy.ndarray) -> numpy.ndarray:
    """A coloured map from a grey one: each band its own tint, so a canvas made grey cannot pass for it."""
    shade = grey.astype(numpy.float64)
    bands = (shade, numpy.clip(shade * 0.6 + 60, 0, 255), numpy.clip(255 - shade * 0.5, 0, 255))
    return numpy.dstack(bands).astype(numpy.uint8)


def _colour_series(tmp_path: Path) -> tuple[numpy.ndarray, Path, list[tuple[str, Path]]]:
    overview = _tinted(_make_overview((800, 800)))
    overview_path = write_map(tmp_path / "overview.tif", overview)
    tiles = []
    for row, col in ((0, 0), (0, 1), (1, 0), (1, 1)):
        name = f"r{row + 1:02d}c{col + 1:02d}.tif"
        tiles.append((name, write_map(tmp_path / name, _make_tile(overview, row, col, (2, 2), upscale=2))))
    return overview, overview_path, tiles


def test_happy_colour_series_canvas_keeps_its_colour(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-OVERVIEW-COLOUR"""
    overview, overview_path, tiles = _colour_series(tmp_path)

    made = overview_canvas(tiles, overview_path, CanvasOpts(rows=2, cols=2, upscale=2.0, read_px=1200, colour=True))

    assert made is not None
    canvas, report = made
    assert canvas.shape[2:] == (3,)
    assert canvas.dtype == numpy.uint8
    assert len(report.placed) >= 3
    expected = cv2.resize(overview, (canvas.shape[1], canvas.shape[0]), interpolation=cv2.INTER_AREA)
    mask = canvas.min(axis=2) < 250
    for band in range(3):
        error = numpy.abs(canvas[:, :, band][mask].astype(int) - expected[:, :, band][mask].astype(int))
        assert float(numpy.mean(error)) < 12
    assert float(numpy.mean(numpy.abs(canvas[:, :, 0][mask].astype(int) - canvas[:, :, 2][mask].astype(int)))) > 40


def test_bad_grey_series_with_colour_pieces_stays_grey(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-OVERVIEW-GREY-STAYS-GREY"""
    _overview, overview_path, tiles = _colour_series(tmp_path)

    made = overview_canvas(tiles, overview_path, CanvasOpts(rows=2, cols=2, upscale=2.0, read_px=1200))

    assert made is not None
    canvas, report = made
    assert canvas.ndim == 2
    assert len(report.placed) >= 3


def test_happy_grey_piece_fills_every_band_of_a_colour_canvas(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-OVERVIEW-COLOUR"""
    overview = _make_overview((800, 800))
    overview_path = write_map(tmp_path / "overview.tif", numpy.dstack([overview] * 3), grey=True)
    tiles = []
    for row, col in ((0, 0), (0, 1), (1, 0), (1, 1)):
        name = f"r{row + 1:02d}c{col + 1:02d}.tif"
        image = _make_tile(overview, row, col, (2, 2), upscale=2)
        tiles.append((name, write_map(tmp_path / name, numpy.dstack([image] * 3), grey=True)))

    made = overview_canvas(tiles, overview_path, CanvasOpts(rows=2, cols=2, upscale=2.0, read_px=1200, colour=True))

    assert made is not None
    canvas, _report = made
    assert canvas.ndim == 3
    assert numpy.array_equal(canvas[:, :, 0], canvas[:, :, 1])
    assert numpy.array_equal(canvas[:, :, 1], canvas[:, :, 2])
    assert int(canvas.min()) < 100
