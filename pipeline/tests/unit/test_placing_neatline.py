"""A sheet's neat line found with its series' help (`placing/neatline.py`): a double frame, a side the scanner cut, the guided queue.

Scenarios: S-P20-HAPPY-NEATLINE, S-P20-BAD-NEATLINE-UNSURE. The sheets are drawn like the plan cadastral 1911-1914's: a thin neat
line, a border line `BORDER` pixels outside it, the sheet's title between them, a slight turn, and one sheet cut on its right.
"""

from pathlib import Path

import cv2
import numpy
import pytest
from hcm_pipeline.placing import neatline
from hcm_pipeline.placing.neatline import Line, NeatLine, SheetLines, Sides

CELL = 500
BORDER = 20
WIDTH, HEIGHT = 700, 660
PAPER, INK = 245, 10


def _sheet(left: int, top: int, turn: float = 0.0, width: int = WIDTH) -> numpy.ndarray:
    """A sheet with its neat line at (`left`, `top`), `CELL` pixels a side, its border line outside it, some drawing inside and its
    title above; turned by `turn` degrees about its middle, then cut to `width` pixels across (the scanner's cut)."""
    grey = numpy.full((HEIGHT, WIDTH), PAPER, numpy.uint8)
    for offset in (0, BORDER):
        cv2.rectangle(grey, (left - offset, top - offset), (left + CELL + offset, top + CELL + offset), INK, 2)
    cv2.line(grey, (left + 40, top + 30), (left + 300, top + 420), INK, 2)
    cv2.line(grey, (left + 120, top + 470), (left + 460, top + 90), INK, 2)
    cv2.putText(grey, "Seria XI", (left + 180, top - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, INK, 1)
    turned = cv2.getRotationMatrix2D((WIDTH / 2, HEIGHT / 2), turn, 1.0)
    grey = cv2.warpAffine(grey, turned, (WIDTH, HEIGHT), borderValue=PAPER)
    return numpy.ascontiguousarray(grey[:, :width])


def _write(path: Path, grey: numpy.ndarray) -> Path:
    cv2.imwrite(str(path), grey)
    return path


def _corners_near(found: NeatLine, left: float, top: float, tolerance: float = 4.0) -> None:
    expected = numpy.array([[left, top], [left + CELL, top], [left + CELL, top + CELL], [left, top + CELL]])
    assert numpy.abs(found.corners - expected).max() <= tolerance


def test_happy_path_a_series_finds_each_sheets_inner_line_and_infers_the_side_the_scanner_cut(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-NEATLINE"""
    sheets = [
        _write(tmp_path / "a.png", _sheet(60, 50)),
        _write(tmp_path / "b.png", _sheet(90, 70, turn=0.4)),
        _write(tmp_path / "c.png", _sheet(70, 60)),
        # The scanner cut the right of this one: its neat line's right side and its border are gone.
        _write(tmp_path / "d.png", _sheet(80, 60, width=CELL + 40)),
    ]

    frames = neatline.series_frames(sheets, 1.0)

    assert all(frame is not None and frame.confident for frame in frames)
    first, turned, _third, cut = frames
    assert first is not None and turned is not None and cut is not None
    # The inner line, never the border line outside it.
    _corners_near(first, 60, 50)
    assert first.inferred is None
    # A sheet turned a little keeps its corners where the turn puts them.
    centre = numpy.array([WIDTH / 2, HEIGHT / 2])
    assert numpy.abs(turned.corners.mean(axis=0) - (centre + _turned([90 + CELL / 2, 70 + CELL / 2], centre, 0.4))).max() < 4
    # The cut side is placed from the series' cell, beyond the scan's edge, and the frame is less sure of it.
    assert cut.inferred == "right"
    _corners_near(cut, 80, 60, tolerance=6.0)
    assert cut.confidence < first.confidence


def _turned(point: list[float], centre: numpy.ndarray, degrees: float) -> numpy.ndarray:
    """`point` turned by `degrees` (counter-clockwise on screen, as OpenCV turns) about `centre`, less the centre."""
    angle = numpy.radians(degrees)
    x, y = numpy.asarray(point) - centre
    return numpy.array([x * numpy.cos(angle) + y * numpy.sin(angle), -x * numpy.sin(angle) + y * numpy.cos(angle)])


def test_bad_path_a_sheet_with_no_frame_has_none_and_goes_to_the_guided_queue(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-NEATLINE-UNSURE"""
    blank = numpy.full((HEIGHT, WIDTH), PAPER, numpy.uint8)
    cv2.line(blank, (100, 100), (600, 500), INK, 2)
    sheets = [_write(tmp_path / f"{name}.png", _sheet(60 + 10 * index, 50)) for index, name in enumerate("abc")]
    sheets.append(_write(tmp_path / "blank.png", blank))

    frames = neatline.series_frames(sheets, 1.0)

    assert frames[-1] is None
    # Alone, a frameless sheet gives the series no cell either.
    assert neatline.series_cell([neatline.read_lines(sheets[-1])], 1.0) == (None, None)


def test_bad_path_a_weak_frame_is_not_confident() -> None:
    """Scenarios: S-P20-BAD-NEATLINE-UNSURE"""
    faint = SheetLines((Line(50, 0.12), Line(560, 0.4)), (Line(60, 0.8), Line(560, 0.8)), WIDTH, HEIGHT)

    found = neatline.sheet_frame(faint, (500.0, 500.0))

    assert found is not None
    assert not found.confident


def test_happy_path_one_axis_cell_gives_the_other_through_the_aspect() -> None:
    """Scenarios: S-P20-HAPPY-NEATLINE"""
    rows = (Line(50, 0.8), Line(550, 0.8))
    sheets = [SheetLines(rows, (Line(10, 0.8),), WIDTH, HEIGHT) for _ in range(3)]

    assert neatline.series_cell(sheets, 2.0) == (1000.0, 500.0)
    across = [SheetLines((Line(10, 0.8),), (Line(60, 0.8), Line(560, 0.8)), WIDTH, HEIGHT) for _ in range(3)]
    assert neatline.series_cell(across, 2.0) == (500.0, 250.0)


def test_bad_path_gaps_no_two_sheets_share_give_no_cell() -> None:
    """Scenarios: S-P20-BAD-NEATLINE-UNSURE"""
    assert neatline.cell_of([[500.0], [560.0], [620.0]]) is None
    assert neatline.cell_of([[], []]) is None


def test_happy_path_without_a_cell_the_innermost_pair_is_the_frame() -> None:
    """Scenarios: S-P20-HAPPY-NEATLINE"""
    lines = [Line(30, 0.8), Line(50, 0.8), Line(550, 0.8), Line(570, 0.8)]

    sides = neatline.axis_sides(lines, 600, None, ("top", "bottom"))

    assert sides == Sides(lines[1], lines[2])
    assert neatline.evidence(sides, None) == 1.0
    assert neatline.axis_sides([Line(30, 0.8)], 600, None, ("top", "bottom")) is None


@pytest.mark.parametrize(
    ("rows", "cols", "cut"),
    [
        # Lines that stop inside the scan: nothing was cut.
        ((Line(50, 0.8, start=60, end=560),), (Line(60, 0.8, start=50, end=550),), frozenset()),
        # The top and bottom lines run off the right edge; the side lines off the top.
        ((Line(50, 0.8, start=60, end=WIDTH),), (Line(60, 0.8, start=0, end=550),), frozenset({"right", "top"})),
        # A faint line running off an edge proves nothing.
        ((Line(50, 0.2, start=0, end=WIDTH),), (Line(60, 0.2, start=0, end=HEIGHT),), frozenset()),
    ],
)
def test_bad_path_a_side_counts_as_cut_only_where_a_strong_line_runs_off_the_scan(
    rows: tuple[Line, ...], cols: tuple[Line, ...], cut: frozenset[str]
) -> None:
    """Scenarios: S-P20-BAD-NEATLINE-UNSURE"""
    assert neatline.cut_sides(SheetLines(rows, cols, WIDTH, HEIGHT)) == cut


def test_bad_path_a_strong_line_inside_the_drawing_is_never_taken_for_a_cut_frame() -> None:
    """Scenarios: S-P20-BAD-NEATLINE-UNSURE

    The plan cadastral's sheets have long lines inside the drawing: with the cell's size added they reach past the edge, but the
    neat line's own pair is there and the sides were not cut."""
    lines = [Line(60, 0.3), Line(1200, 0.95), Line(5960, 0.45)]

    sides = neatline.axis_sides(lines, 7072, 5900.0, ("left", "right"), frozenset())

    assert sides == Sides(lines[0], lines[2])
