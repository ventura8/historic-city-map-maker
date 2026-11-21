"""The 1:500 of 1960-71 laid out (docs/research/M20-import-local.md §19.16): its Seria/Coloana names are its grid, and its sparse
line-art sheets are never taken for blank pages.
"""

from pathlib import Path

import cv2
import numpy
from hcm_pipeline.placing import sheetnames, sheetwork

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


def test_bad_path_names_off_the_city_grid_or_on_one_cell_make_no_city_grid() -> None:
    """Scenarios: S-P20-BAD-STITCH-CITY-GRID"""
    assert sheetnames.city(["a.tif", "b.tif", "c.tif"]) is None
    assert sheetnames.city(["19A1.tif", "19A1_62.tif"]) is None
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
