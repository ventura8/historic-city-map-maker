"""Tests for find_overview and overview_canvas (harti.zip tile import, slice 3)."""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy
import pytest
from hcm_pipeline.placing import overview_find as overview_find_mod
from hcm_pipeline.placing.overview_find import CanvasOpts, find_overview, overview_canvas

from tests.synthetic.town import write_map
from tests.unit.test_placing_overview import _make_overview, _make_tile


def _write_dummy_file(path: Path, size: int = 60_000) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x00" * size)


def test_happy_overview_in_parent(tmp_path: Path) -> None:
    series_dir = tmp_path / "series"
    series_dir.mkdir()
    tile1, tile2 = series_dir / "tile_001.png", series_dir / "tile_002.png"
    _write_dummy_file(tile1)
    _write_dummy_file(tile2)
    overview = tmp_path / "area-1895.png"
    _write_dummy_file(overview)

    assert find_overview(tmp_path, [tile1, tile2]) == overview


def test_same_folder_overview_beside_tiles(tmp_path: Path) -> None:
    series_dir = tmp_path / "series"
    series_dir.mkdir()
    tile1 = series_dir / "tile_001.png"
    _write_dummy_file(tile1)
    overview = series_dir / "overview.png"
    _write_dummy_file(overview)

    assert find_overview(tmp_path, [tile1]) == overview


def test_only_tiles_returns_none(tmp_path: Path) -> None:
    series_dir = tmp_path / "series"
    series_dir.mkdir()
    tile1 = series_dir / "tile_001.png"
    _write_dummy_file(tile1)

    assert find_overview(tmp_path, [tile1]) is None


def test_skips_thumbs_db(tmp_path: Path) -> None:
    series_dir = tmp_path / "series"
    series_dir.mkdir()
    tile1 = series_dir / "tile_001.png"
    _write_dummy_file(tile1)
    _write_dummy_file(tmp_path / "Thumbs.db")
    overview = tmp_path / "map.png"
    _write_dummy_file(overview)

    assert find_overview(tmp_path, [tile1]) == overview


def test_skips_small_files(tmp_path: Path) -> None:
    series_dir = tmp_path / "series"
    series_dir.mkdir()
    tile1 = series_dir / "tile_001.png"
    _write_dummy_file(tile1)
    (tmp_path / "small.png").write_bytes(b"\x00" * 100)

    assert find_overview(tmp_path, [tile1]) is None


def test_prefers_year_match(tmp_path: Path) -> None:
    series_dir = tmp_path / "series-1895"
    series_dir.mkdir()
    tile1 = series_dir / "tile_001.png"
    _write_dummy_file(tile1)
    match = tmp_path / "map-1895.png"
    other = tmp_path / "map-1900.png"
    _write_dummy_file(match)
    _write_dummy_file(other)

    assert find_overview(tmp_path, [tile1]) == match


def test_prefers_letter_token_match(tmp_path: Path) -> None:
    series_dir = tmp_path / "series-alpha"
    series_dir.mkdir()
    tile1 = series_dir / "tile_001.png"
    _write_dummy_file(tile1)
    match = tmp_path / "map-alpha.png"
    other = tmp_path / "map-beta.png"
    _write_dummy_file(match)
    _write_dummy_file(other)

    assert find_overview(tmp_path, [tile1]) == match


def test_falls_back_to_largest_size(tmp_path: Path) -> None:
    series_dir = tmp_path / "series"
    series_dir.mkdir()
    tile1 = series_dir / "tile_001.png"
    _write_dummy_file(tile1)
    small = tmp_path / "map_small.png"
    large = tmp_path / "map_large.png"
    _write_dummy_file(small, size=51_000)
    _write_dummy_file(large, size=100_000)

    assert find_overview(tmp_path, [tile1]) == large


def test_empty_sheets_returns_none(tmp_path: Path) -> None:
    assert find_overview(tmp_path, []) is None


def test_happy_sibling_series_overview(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-OVERVIEW-SIBLING"""
    pieces = tmp_path / "pieces-1895" / "1_quadrat"
    pieces.mkdir(parents=True)
    tile = pieces / "tile_001.png"
    _write_dummy_file(tile)
    iga = tmp_path / "iga-1895"
    iga.mkdir()
    overview = iga / "sheet.png"
    _write_dummy_file(overview)

    assert find_overview(tmp_path, [tile]) == overview


def test_bad_sibling_other_year_ignored(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-OVERVIEW-SIBLING-YEAR"""
    pieces = tmp_path / "pieces-1895" / "1_quadrat"
    pieces.mkdir(parents=True)
    tile = pieces / "tile_001.png"
    _write_dummy_file(tile)
    other = tmp_path / "map-1900"
    other.mkdir()
    _write_dummy_file(other / "sheet.png")

    assert find_overview(tmp_path, [tile]) is None


def test_happy_overview_canvas_matches_source(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-OVERVIEW"""
    overview = _make_overview((800, 800))
    overview_path = write_map(tmp_path / "overview.tif", numpy.dstack([overview] * 3), grey=True)
    tiles = []
    for row, col in ((0, 0), (0, 1), (1, 0), (1, 1)):
        name = f"r{row + 1:02d}c{col + 1:02d}.tif"
        image = _make_tile(overview, row, col, (2, 2), upscale=2)
        tiles.append((name, write_map(tmp_path / name, numpy.dstack([image] * 3), grey=True)))

    made = overview_canvas(tiles, overview_path, CanvasOpts(rows=2, cols=2, upscale=2.0, read_px=1200))
    assert made is not None
    canvas, report = made
    assert len(report.placed) >= 3
    expected = cv2.resize(overview, (canvas.shape[1], canvas.shape[0]), interpolation=cv2.INTER_AREA)
    mask = canvas < 250
    assert float(numpy.mean(numpy.abs(canvas[mask].astype(int) - expected[mask].astype(int)))) < 12


def test_bad_blank_overview_canvas_returns_none(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-OVERVIEW-BLANK"""
    blank = numpy.full((400, 400), 255, dtype=numpy.uint8)
    overview_path = write_map(tmp_path / "blank.tif", numpy.dstack([blank] * 3), grey=True)
    tile_img = _make_tile(_make_overview((800, 800)), 0, 0, (2, 2), upscale=2)
    tile = write_map(tmp_path / "r01c01.tif", numpy.dstack([tile_img] * 3), grey=True)

    assert overview_canvas([("r01c01.tif", tile), ("r01c02.tif", tile)], overview_path) is None


def test_bad_overview_canvas_needs_tiles_and_a_file(tmp_path: Path) -> None:
    tile = write_map(tmp_path / "r01c01.tif", numpy.dstack([_make_overview((40, 40))] * 3), grey=True)
    assert overview_canvas([], tmp_path / "missing.tif") is None
    assert overview_canvas([("r01c01.tif", tile)], tmp_path / "gone.tif") is None


def test_bad_sheets_outside_root_return_none(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    tile = outside / "tile.png"
    _write_dummy_file(tile)
    root = tmp_path / "archive"
    root.mkdir()
    assert find_overview(root, [tile]) is None


def test_bad_unreadable_mid_size_file_is_skipped(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    series_dir = tmp_path / "series"
    series_dir.mkdir()
    tile1 = series_dir / "tile_001.png"
    _write_dummy_file(tile1)
    mid = tmp_path / "mid.png"
    _write_dummy_file(mid, size=20_000)

    def boom(_path: Path, _side: int) -> object:
        raise OSError("unreadable")

    monkeypatch.setattr("hcm_pipeline.placing.overview_find.read_working", boom)
    assert find_overview(tmp_path, [tile1]) is None


def test_happy_mid_size_overview_probed_for_long_side(tmp_path: Path) -> None:
    series_dir = tmp_path / "series"
    series_dir.mkdir()
    tile1 = series_dir / "tile_001.png"
    _write_dummy_file(tile1)
    overview = tmp_path / "mid.jpg"
    pattern = numpy.zeros((300, 300), dtype=numpy.uint8)
    pattern[::3, :] = 200
    pattern[:, ::3] = 90
    cv2.imwrite(str(overview), pattern, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    assert overview_find_mod.MIN_BYTES <= overview.stat().st_size < overview_find_mod.TRUST_BYTES
    assert overview_find_mod._long_side(overview) >= overview_find_mod.MIN_SIDE
    assert find_overview(tmp_path, [tile1]) == overview


def test_bad_stat_error_skips_candidate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    series_dir = tmp_path / "series"
    series_dir.mkdir()
    tile1 = series_dir / "tile_001.png"
    _write_dummy_file(tile1)
    mid = tmp_path / "mid.png"
    _write_dummy_file(mid, size=20_000)
    real_stat = Path.stat

    def flaky(self: Path, *, follow_symlinks: bool = True) -> object:
        if self.name == "mid.png":
            raise OSError("gone")
        return real_stat(self, follow_symlinks=follow_symlinks)

    monkeypatch.setattr(Path, "stat", flaky)
    assert find_overview(tmp_path, [tile1]) is None


def test_bad_levels_stop_at_the_archive_root(tmp_path: Path) -> None:
    root = tmp_path / "archive"
    deep = root / "a" / "b"
    deep.mkdir(parents=True)
    assert overview_find_mod._levels(deep, root) == [(root / "a").resolve(), root.resolve()]
    assert overview_find_mod._levels(root, root) == []
    assert overview_find_mod._near_overview(deep, root, set(), {"1895"}) is None


def test_happy_overview_two_folders_up_under_a_top_folder(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-OVERVIEW-ANCESTOR"""
    harti = tmp_path / "Harti"
    tiles = []
    for quadrant in ("1_quadrat", "2_quadrat"):
        tile = harti / "Bucuresti 1895-1899" / "1895-1899.jpg" / quadrant / "img362.jpg"
        _write_dummy_file(tile)
        tiles.append(tile)
    _write_dummy_file(harti / "Bucuresti 1895-1899" / "1-10000" / "A.tif", size=200_000)
    _write_dummy_file(harti / "Bucuresti harta 1914.jpg", size=300_000)
    overview = harti / "Harta Bucuresti 1895.png"
    _write_dummy_file(overview, size=100_000)

    assert find_overview(tmp_path, tiles) == overview


def test_bad_overview_ancestor_of_another_year_is_not_taken(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-OVERVIEW-ANCESTOR-YEAR"""
    harti = tmp_path / "Harti"
    tile = harti / "Bucuresti 1895-1899" / "1895-1899.jpg" / "1_quadrat" / "img362.jpg"
    _write_dummy_file(tile)
    _write_dummy_file(harti / "Bucuresti harta 1914.jpg", size=300_000)
    _write_dummy_file(harti / "Bucuresti 1895-1899" / "1-10000" / "A.tif", size=200_000)

    assert find_overview(tmp_path, [tile]) is None


def test_year_tokens_stand_alone() -> None:
    assert overview_find_mod._tokens("1-10000") == set()
    assert overview_find_mod._tokens("Bucuresti 1895-1899") == {"bucuresti", "1895", "1899"}
    assert overview_find_mod._needed({"bucuresti", "1895"}) == {"1895"}
    assert overview_find_mod._needed({"alpha"}) == {"alpha"}


def test_happy_overview_canvas_infers_grid_and_upscale(tmp_path: Path) -> None:
    overview = _make_overview((600, 600))
    overview_path = write_map(tmp_path / "overview.tif", numpy.dstack([overview] * 3), grey=True)
    tiles = []
    for row, col in ((0, 0), (0, 1), (1, 0), (1, 1)):
        name = f"r{row + 1:02d}c{col + 1:02d}.tif"
        image = _make_tile(overview, row, col, (2, 2), upscale=2)
        tiles.append((name, write_map(tmp_path / name, numpy.dstack([image] * 3), grey=True)))

    made = overview_canvas(tiles, overview_path, CanvasOpts(read_px=800))
    assert made is not None
    _canvas, report = made
    assert len(report.placed) >= 2
