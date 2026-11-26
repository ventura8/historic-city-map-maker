"""Pages that only touch, laid out by what crosses their edges (docs/research/M20-import-local.md §19.15): an atlas with no useful names
is put back together, noise never joins, and the numbering helps only where the edges agree.
"""

from pathlib import Path

import numpy
import pytest
from hcm_pipeline.placing import autostitch, jigsaw
from hcm_pipeline.placing.sheetwork import Part, cell_of, read_parts

from tests.synthetic.sheets import SheetsSpec, make_series


def _relative(cells: dict[int, tuple[int, int]], truth: dict[int, tuple[int, int]]) -> int:
    """How many placed pages sit where the truth puts them, relative to the first placed page."""
    first = min(cells)
    shift = (truth[first][0] - cells[first][0], truth[first][1] - cells[first][1])
    return sum((row + shift[0], col + shift[1]) == truth[sheet] for sheet, (row, col) in cells.items())


def _atlas(tmp_path: Path) -> tuple[list[Part], dict[int, tuple[int, int]], list[str]]:
    series = make_series(tmp_path, SheetsSpec(overlap=0.0, names="rc", style="lineart", frame=True, margin_px=25))
    parts = read_parts(series.named)
    truth = {index: (series.truth[name].row, series.truth[name].col) for index, (name, _path) in enumerate(series.named)}
    return parts, truth, [f"atlas/{4 * row + col + 1}.tif" for row, col in truth.values()]


def test_happy_path_a_numbered_atlas_of_touching_pages_gets_its_stride_from_the_edges(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-STITCH-JIGSAW"""
    parts, truth, names = _atlas(tmp_path)

    proposal = autostitch.from_edges(parts, cell_of(parts), {}, names)

    assert proposal is not None
    assert len(proposal.plan.cells) == 12
    assert _relative(proposal.plan.cells, truth) == 12
    assert len(proposal.solved.positions) >= 10


def test_bad_path_pages_with_no_numbers_are_never_judged_good_when_their_layout_is_wrong(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-STITCH-JIGSAW-NOISE"""
    parts, truth, _names = _atlas(tmp_path)
    names = [f"sheet-{'abcdefghijklmnop'[index]}.tif" for index in range(len(parts))]

    proposal = autostitch.from_edges(parts, cell_of(parts), {}, names)

    assert proposal is not None
    assert len(proposal.plan.cells) >= 4
    right = _relative(proposal.plan.cells, truth) == len(proposal.plan.cells)
    assert right or proposal.quality.verdict != "good"


def test_bad_path_noise_pages_never_join() -> None:
    """Scenarios: S-P20-BAD-STITCH-JIGSAW-NOISE"""
    rng = numpy.random.default_rng(4)
    images = {index: numpy.asarray(rng.integers(0, 256, (300, 240)), numpy.uint8) for index in range(6)}
    edges = {index: jigsaw.edges_of(image) for index, image in images.items()}
    tables = [jigsaw.table(edges, "right", 300), jigsaw.table(edges, "below", 240)]

    cells, used = jigsaw.assemble(jigsaw.joins(tables, jigsaw.Order()))

    assert len(used) == 0
    assert len(cells) <= 1


def test_bad_path_a_blank_edge_has_no_profile_and_scores_nothing() -> None:
    blank = numpy.full((200, 60), 255, numpy.uint8)

    assert jigsaw.crossings(blank) is None
    assert jigsaw.continuity(None, numpy.ones(3), 4) == (0.0, 0)
    assert jigsaw.threshold(numpy.zeros((1, 1))) == pytest.approx(jigsaw.MIN_SCORE)


def test_happy_path_the_numbering_helps_only_over_the_baseline() -> None:
    scores = numpy.array([[-1.0, 0.55, 0.1], [0.2, -1.0, 0.1], [0.3, 0.1, -1.0]])
    tables = [jigsaw.Table("right", (1, 2, 3), scores, numpy.zeros((3, 3), numpy.int64), 0.65)]

    assert jigsaw.counted(tables, jigsaw.Order({1: 7, 2: 8}), 1, 2, "right") == (0.55, 0)
    assert jigsaw.counted(tables, jigsaw.Order(), 1, 2, "right") is None
    assert jigsaw.counted(tables, jigsaw.Order({1: 7, 3: 8}), 1, 3, "right") is None


def test_happy_path_groups_never_put_two_pages_on_one_cell() -> None:
    joins = [
        jigsaw.Join(1, 2, "right", 0.9, 0),
        jigsaw.Join(3, 4, "right", 0.9, 0),
        jigsaw.Join(1, 3, "below", 0.8, 0),
        jigsaw.Join(2, 3, "right", 0.7, 0),
        jigsaw.Join(2, 1, "right", 0.6, 0),
    ]

    cells, used = jigsaw.assemble(joins)

    assert cells == {1: (0, 0), 2: (0, 1), 3: (1, 0), 4: (1, 1)}
    assert len(used) == 3


def test_happy_path_the_stride_below_comes_from_the_edges_and_the_numbers_make_the_grid() -> None:
    numbers = {sheet: sheet for sheet in range(1, 13)}
    found = [
        jigsaw.Join(1, 5, "below", 0.8, 0),
        jigsaw.Join(2, 6, "below", 0.8, 0),
        jigsaw.Join(3, 9, "below", 0.5, 0),
        jigsaw.Join(5, 6, "right", 0.8, 0),
        jigsaw.Join(6, 7, "right", 0.8, 0),
    ]
    order = jigsaw.Order(numbers, jigsaw.stride_of(found, numbers))

    assert order.stride == 4
    cells = jigsaw.numbered_cells(order, found)
    assert (cells[5][0] - cells[1][0], cells[5][1] - cells[1][1]) == (1, 0)
    assert cells[6] == (cells[5][0], cells[5][1] + 1)
    assert jigsaw.stride_of(found[:1], numbers) is None
    assert jigsaw.stride_of([*found, jigsaw.Join(4, 10, "below", 0.5, 0), jigsaw.Join(7, 13, "below", 0.5, 0)], numbers) is None
