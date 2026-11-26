"""The grid read from file and folder names (docs/research/M20-import-local.md §19.1)."""

import pytest
from hcm_pipeline.placing import sheetnames


@pytest.mark.parametrize(
    ("names", "cells"),
    [
        (["r1c1.tif", "R1C2.tif", "r2c1.tif"], {0: (0, 0), 1: (0, 1), 2: (1, 0)}),
        (["03-07.tif", "3_8.tif"], {0: (2, 6), 1: (2, 7)}),
        (["A1.tif", "B12.jpg"], {0: (0, 0), 1: (1, 11)}),
    ],
)
def test_happy_path_explicit_schemes_give_each_name_its_cell(names: list[str], cells: dict[int, tuple[int, int]]) -> None:
    """Scenarios: S-P20-HAPPY-STITCH-NAMES"""
    grid = sheetnames.grid_of(names)

    assert grid.cells == cells
    assert grid.named
    assert grid.unread == ()


def test_happy_path_quadrant_letters_nest_each_sheets_quarters() -> None:
    names = ["1A.tif", "1B.tif", "1C.tif", "1D.tif", "2A.tif", "2b.tif"]

    grid = sheetnames.grid_of(names)

    assert grid.cells == {0: (0, 0), 1: (0, 1), 2: (1, 0), 3: (1, 1), 4: (0, 2), 5: (0, 3)}
    assert grid.source == "name"


def test_happy_path_folders_are_rows_and_their_files_columns_in_natural_order() -> None:
    names = ["row2/10.tif", "row1/2.tif", "row1/10.tif", "row2/2.tif"]

    grid = sheetnames.grid_of(names)

    assert grid.cells == {0: (1, 1), 1: (0, 0), 2: (0, 1), 3: (1, 0)}
    assert (grid.rows, grid.cols) == (2, 2)


def test_happy_path_names_in_order_alone_are_laid_on_the_likeliest_columns() -> None:
    """Scenarios: S-P20-HAPPY-STITCH-SEAMS"""
    names = [f"img{index:03d}.tif" for index in (3, 1, 2, 4, 6, 5)]

    grid = sheetnames.grid_of(names, aspect=1.0)

    assert grid.source == "order"
    assert not grid.named
    assert grid.cells[1] == (0, 0)
    assert grid.rows * grid.cols >= 6


def test_happy_path_natural_order_puts_page_10_after_page_9() -> None:
    names = ["page10.tif", "page9.tif", "page1.tif"]

    grid = sheetnames.ordered(names, 3)

    assert grid.cells == {0: (0, 2), 1: (0, 1), 2: (0, 0)}


def test_happy_path_column_candidates_follow_the_sheets_shape() -> None:
    assert sheetnames.col_candidates(12, 1.0)[0] in {3, 4}
    assert sheetnames.col_candidates(12, 4.0)[0] < sheetnames.col_candidates(12, 0.25)[0]
    assert sheetnames.col_candidates(1, 1.0) == [1]


def test_bad_path_a_count_no_grid_fits_falls_back_to_a_near_square_grid() -> None:
    assert sheetnames.col_candidates(5, 1000.0) == [3]


def test_bad_path_names_no_scheme_agrees_on_fall_back_to_the_order() -> None:
    """Scenarios: S-P20-BAD-STITCH-NO-NAMES"""
    names = ["north.tif", "harbour.tif", "r1c1.tif", "east.tif", "old town.tif"]

    grid = sheetnames.grid_of(names)

    assert grid.source == "order"
    assert len(grid.cells) == 5


def test_bad_path_a_foreign_sheet_among_named_ones_is_unread() -> None:
    """Scenarios: S-P20-BAD-STITCH-FOREIGN-SHEET"""
    names = [f"r{row}c{col}.tif" for row in (1, 2) for col in (1, 2, 3)] + ["legend.tif"]

    grid = sheetnames.grid_of(names)

    assert grid.named
    assert grid.unread == (6,)


def test_bad_path_two_names_on_one_cell_do_not_agree() -> None:
    grid = sheetnames.grid_of(["r1c1.tif", "r1c1 copy.tif", "r1c2.tif"])

    assert grid.source == "order"


def test_bad_path_quadrants_that_do_not_agree_are_not_read_as_such() -> None:
    assert sheetnames.grid_of(["1A.tif", "1A copy.tif", "x.tif"]).source == "order"


def test_bad_path_folders_of_one_file_each_are_not_rows() -> None:
    assert sheetnames.grid_of(["a/x.tif", "b/y.tif"]).source == "order"


def test_happy_path_cell_of_reads_one_name_on_a_known_grid() -> None:
    assert sheetnames.cell_of("r2c3.tif", 4, 4) == (1, 2)
    assert sheetnames.cell_of("sheet 6.tif", 2, 4) == (1, 1)
    assert sheetnames.number_of("img_007") == 7


def test_bad_path_cell_of_refuses_a_name_off_the_grid_or_without_a_number() -> None:
    assert sheetnames.cell_of("sheet 9.tif", 2, 4) is None
    assert sheetnames.cell_of("legend.tif", 2, 4) is None
    assert sheetnames.number_of("legend") is None
