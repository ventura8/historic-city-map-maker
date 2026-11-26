"""Sheet names that say where a sheet lies (docs/research/M20-import-local.md §2.3, §3 b): the grammars, for any city.

The names are the inventory's special cases of the Bucharest archive (names only, a data fixture: no file of it is in the tree).
"""

import pytest
from hcm_pipeline.archive import grammar
from hcm_pipeline.archive.grammar import Cell


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        # 1:500 quarters: row 17 south of the zero row, A' is column 0 east, A is -1 west.
        ("x/1_500/17/17A'3.TIF", Cell("quarter", 17, 0, 3)),
        ("x/1_500/17/17A3.tif", Cell("quarter", 17, -1, 3)),
        ("x/1_500/0/0B'2.TIF", Cell("quarter", 0, 1, 2)),
        ("x/1_500/3'/3'C4.tif", Cell("quarter", -3, -3, 4)),
        # An older edition makes its own partial series; words mark an odd sheet the report lists.
        ("x/1_500/17/17A1_62.tif", Cell("quarter", 17, -1, 1, 1, 1962)),
        ("x/1_500/17/17A1 bis.tif", Cell("quarter", 17, -1, 1, 1, None, True)),
        # 1:2000 blocks of 2 x 2 cells: the western column first, whatever the order of the name.
        ("x/1_2000/29-30/29-30cb.tif", Cell("block", 29, -3, 0, 2)),
        ("x/1_2000/9-10/9-10v'w'.tif", Cell("block", 9, 19, 0, 2)),
        ("x/1_2000/1'-0/1'-0AA'.TIF", Cell("block", -1, -1, 0, 2)),
        ("x/1_2000/27-28/27-28 CB-1977.tif", Cell("block", 27, -3, 0, 2, 1977)),
        ("x/1_2000/23-24/23-24i-h.tif", Cell("block", 23, -9, 0, 2)),
        # A prime spelled as a word; a whole cell with no quarter is read, and listed as odd.
        ("x/1_500/13/13Aprim1.tif", Cell("quarter", 13, 0, 1)),
        ("x/1_500/2/2C.tif", Cell("quarter", 2, -3, 0, 1, None, True)),
        ("x/1_500/31/31A-MIC3.TIF", Cell("quarter", 31, -1, 3, 1, None, True)),
        ("x/1_500/3'/3'S'.tif", Cell("quarter", -3, 16, 0, 1, None, True)),
        # The cadastral plan: the row in the folder, A1 for A'; a street name after the letter is odd.
        ("x/cadastral/Seria 11/C1.tif", Cell("folder-row", 11, 2)),
        ("x/cadastral/Seria 11/E pta matache.tif", Cell("folder-row", 11, -5, odd=True)),
        # The international 1:1,000,000 scheme and a plain row-column grid.
        ("x/L-35-12-A-b.tif", Cell("international-1m", 11, 35, 12)),
        ("x/12-07.tif", Cell("row-col", 12, 7)),
        ("x/r3c4.png", Cell("row-col", 3, 4)),
    ],
)
def test_happy_path_a_grammar_reads_where_a_sheet_lies(path: str, expected: Cell) -> None:
    """Scenarios: S-P20-HAPPY-GRID-NAMES"""
    assert grammar.parse(path) == expected


@pytest.mark.parametrize(
    "path",
    [
        "x/1_500/17/17J1.tif",  # no J in the grid's letters
        "x/1_2000/5-6/5-6qp.tif",  # nor Q
        "x/Seria 11/J.tif",
        "x/NE.jpg",
        "x/1871-Maior-D-Pappasoglu.jpg",
        "x/12.jpg",
        "x/Bucuresti 1770.jpg",
        # A block whose columns or rows are not neighbours is never put on a wrong cell.
        "x/1_2000/19-20/19-20z'a.tif",
        "x/1_2000/11-12/11-12z'a''.tif",
        "x/1_2000/9-10/9-10azmic.tif",
        "x/1_2000/9-12/9-12cb.tif",
        # A file with no extension is no sheet's name.
        "x/1_500/25/25-26",
    ],
)
def test_bad_path_a_name_no_grammar_reads_is_left_to_the_other_detectors(path: str) -> None:
    """Scenarios: S-P20-BAD-GRID-ODD-NAMES"""
    assert grammar.parse(path) is None


def test_happy_path_a_connected_series_of_one_size_is_accepted() -> None:
    cells = [Cell("quarter", row, col, 1) for row in range(3) for col in range(3)]

    assert grammar.accepts(9, 10, cells, [(7008, 9933)] * 9)
    assert grammar.accepts(9, 10, cells, [(7008, 9933)] * 6 + [(6608, 9363)] * 3)
    assert not grammar.alike([])


@pytest.mark.parametrize(
    ("parsed", "rasters", "cells", "sizes"),
    [
        (3, 3, [Cell("quarter", 0, col, 1) for col in range(3)], [(10, 10)] * 3),  # too few sheets
        (5, 10, [Cell("quarter", 0, col, 1) for col in range(5)], [(10, 10)] * 5),  # half the folder unread
        (5, 5, [Cell("quarter", 0, col * 10, 1) for col in range(5)], [(10, 10)] * 5),  # scattered cells
        (5, 5, [Cell("quarter", 0, col, 1) for col in range(5)], [(10, 10), (20, 20), (30, 30), (40, 40), (10, 10)]),  # sizes differ
        (0, 0, [], []),
    ],
)
def test_bad_path_a_grammar_is_refused_for_a_set_that_is_not_a_series(
    parsed: int, rasters: int, cells: list[Cell], sizes: list[tuple[int, int]]
) -> None:
    assert not grammar.accepts(parsed, rasters, cells, sizes)


def test_happy_path_columns_and_rows_follow_the_zero_meridian_and_the_zero_row() -> None:
    assert [grammar.column(letter, "'") for letter in "ABZ"] == [0, 1, 23]
    assert [grammar.column(letter, "") for letter in "ABZ"] == [-1, -2, -24]
    assert (grammar.row("4", ""), grammar.row("4", "'")) == (4, -4)
    assert (grammar.edition_year("62"), grammar.edition_year("1977"), grammar.edition_year(None)) == (1962, 1977, None)
