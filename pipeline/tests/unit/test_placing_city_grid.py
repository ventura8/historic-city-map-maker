"""The 1:500 of 1960-71 laid out (docs/research/M20-import-local.md §19.16): its Seria/Coloana names are its grid, and its sparse
line-art sheets are never taken for blank pages.
"""

from pathlib import Path

import cv2
import numpy
from hcm_pipeline.placing import bundle, raster_io, sheetnames, sheetwork
from hcm_pipeline.placing.seams import Seam

from tests.synthetic.town import write_map


def test_happy_path_city_grid_names_are_the_grid_in_each_quarter_order() -> None:
    """Scenarios: S-P20-HAPPY-STITCH-CITY-GRID"""
    names = ["19/19A'1.tif", "19/19A'2.tif", "19/19A'3.tif", "19/19A'4.tif", "19/19B'1.tif", "20/20A'1.tif"]

    grid = sheetnames.city(names)
    turned = sheetnames.city(names, 4)

    assert grid is not None
    assert turned is not None
    assert [grid.cells[index] for index in range(6)] == [(0, 0), (0, 1), (1, 0), (1, 1), (0, 2), (2, 0)]
    assert turned.cells[1] == (1, 0)
    assert sheetnames.grid_of(names).cells == grid.cells


def test_bad_path_names_off_the_city_grid_make_no_city_grid_and_editions_keep_one_sheet() -> None:
    """Scenarios: S-P20-BAD-STITCH-CITY-GRID"""
    assert sheetnames.city(["a.tif", "b.tif", "c.tif"]) is None
    editions = sheetnames.city(["19A1_62.tif", "19A1.tif", "19A2.tif", "19A3.tif", "19A4.tif", "19B1.tif"])
    assert editions is not None
    assert sorted(editions.cells) == [1, 2, 3, 4, 5]
    assert editions.unread == (0,)
    assert sheetnames.city(["19J1.tif", "19Q1.tif"]) is None


def _sheet(tmp_path: Path, name: str, lines: int) -> Path:
    """A large 1-bit-like sheet: white, with `lines` one-pixel lines (thin linework, nothing else)."""
    page = numpy.full((4000, 4000, 3), 255, numpy.uint8)
    for index in range(lines):
        cv2.line(page, (200, 300 + 340 * index), (3800, 500 + 300 * index), (0, 0, 0), 2)
    return write_map(tmp_path / name, page, grey=True)


def test_happy_path_a_sparse_line_art_sheet_read_small_is_no_blank_page(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-STITCH-CITY-GRID"""
    path = _sheet(tmp_path, "0B'3.tif", 10)

    part = sheetwork.read_part(0, "0B'3.tif", path, sheetwork.WORK_PX_MIN)

    assert not part.blank


def test_bad_path_a_truly_blank_back_stays_blank(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-STITCH-CITY-GRID"""
    path = _sheet(tmp_path, "back.tif", 0)

    assert sheetwork.read_part(0, "back.tif", path, sheetwork.WORK_PX_MIN).blank
    assert sheetwork.read_part(0, "back.tif", path, sheetwork.BLANK_CHECK_PX).blank


def test_happy_path_an_ink_keeping_read_keeps_a_one_pixel_line(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-STITCH-CITY-GRID"""
    page = numpy.full((800, 800, 3), 255, numpy.uint8)
    page[401, :] = 0
    path = write_map(tmp_path / "line.tif", page, grey=True)

    inked = raster_io.read_box_inked(path, (0, 0, 800, 800), (100, 100))
    averaged = raster_io.read_box(path, (0, 0, 800, 800), (100, 100))

    assert int(inked.min()) < 100
    assert int(averaged.min()) > 200
    assert raster_io.ink_factor((0, 0, 50, 50), (100, 100)) == 1
    colour = write_map(tmp_path / "colour.tif", page, grey=False)
    assert raster_io.read_box_inked(colour, (0, 0, 800, 800), (100, 100)).shape == (100, 100, 3)
    assert raster_io.read_box_inked(path, (0, 0, 50, 50), (100, 100)).shape[:2] == (100, 100)


def test_happy_path_a_city_grid_keeps_its_named_places_and_seams_only_confirm_them() -> None:
    """Scenarios: S-P20-HAPPY-STITCH-CITY-GRID"""
    cells = {0: (0, 0), 1: (0, 1), 2: (1, 0)}
    seams = [
        Seam(0, 1, "right", 100.0, 2.0, 0.7, 1.0, "strong"),
        Seam(0, 2, "below", 40.0, 90.0, 0.7, 1.0, "strong"),
    ]

    answer = bundle.confirmed(cells, seams, (100, 80))

    assert answer.positions == {0: (0.0, 0.0), 1: (100.0, 0.0), 2: (0.0, 80.0)}
    assert [seam.b for seam in answer.kept] == [1]
    assert [seam.b for seam in answer.dropped] == [2]
