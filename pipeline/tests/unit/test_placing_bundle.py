"""Every sheet's place at once (docs/research/M20-import-local.md §19.4) and the verdict on a layout (§19.5)."""

import pytest
from hcm_pipeline.placing import bundle, quality
from hcm_pipeline.placing.seams import Seam

CELL = (100, 80)


def _grid(rows: int, cols: int) -> dict[int, tuple[int, int]]:
    return {row * cols + col: (row, col) for row in range(rows) for col in range(cols)}


def _seams(rows: int, cols: int, step: tuple[float, float] = (90.0, 72.0)) -> list[Seam]:
    found = []
    for row in range(rows):
        for col in range(cols):
            index = row * cols + col
            if col + 1 < cols:
                found.append(Seam(index, index + 1, "right", step[0], 0.0, 0.9, 0.2, "strong"))
            if row + 1 < rows:
                found.append(Seam(index, index + cols, "below", 0.0, step[1], 0.9, 0.2, "strong"))
    return found


def test_happy_path_consistent_seams_place_every_sheet_on_their_steps() -> None:
    """Scenarios: S-P20-HAPPY-STITCH-SEAMS"""
    solved = bundle.solve(_grid(3, 3), _seams(3, 3), CELL)

    assert solved.positions[4] == pytest.approx((90.0, 72.0), abs=1e-6)
    assert solved.positions[8] == pytest.approx((180.0, 144.0), abs=1e-6)
    assert solved.dropped == ()
    assert max(solved.residuals) < 1e-6
    assert max(solved.moved.values()) < 0.01


def test_bad_path_one_false_seam_is_outvoted_and_dropped() -> None:
    false = Seam(4, 5, "right", 140.0, 30.0, 0.9, 0.2, "strong")
    seams = [false if (seam.a, seam.b) == (4, 5) else seam for seam in _seams(3, 3)]

    solved = bundle.solve(_grid(3, 3), seams, CELL)

    assert [(seam.a, seam.b) for seam in solved.dropped] == [(4, 5)]
    assert solved.positions[5] == pytest.approx((180.0, 72.0), abs=2.0)


def test_bad_path_a_sheet_from_the_order_with_no_seam_is_left_out_but_a_named_one_stays() -> None:
    """Scenarios: S-P20-BAD-STITCH-FOREIGN-SHEET"""
    cells = {**_grid(1, 2), 2: (0, 2)}
    seams = [*_seams(1, 2), Seam(1, 2, "right", 300.0, 50.0, 0.1, 0.0, "missing")]

    from_order = bundle.solve(cells, seams, CELL, {0, 1, 2})
    named = bundle.solve(cells, seams, CELL)

    assert from_order.left_out == (2,)
    assert 2 not in from_order.positions
    assert named.positions[2] == pytest.approx((180.0, 0.0), abs=1.0)


def test_happy_path_the_pitch_is_the_strong_seams_median_or_the_cell() -> None:
    assert bundle.pitch_of(_seams(2, 2), CELL) == (90.0, 72.0)
    assert bundle.pitch_of([], CELL) == (100.0, 80.0)


def test_bad_path_nothing_to_place_gives_an_empty_answer() -> None:
    solved = bundle.solve({}, [], CELL)

    assert (solved.positions, solved.kept, solved.left_out) == ({}, (), ())


def _measures(
    placed: int = 10, scores: tuple[float, ...] = (0.9, 0.8), residuals: tuple[float, ...] = (0.5, 0.5), moved: float = 0.0
) -> quality.Measures:
    return quality.Measures(placed, 10, scores, residuals, moved)


def test_happy_path_a_layout_that_meets_every_threshold_is_good() -> None:
    """Scenarios: S-P20-HAPPY-STITCH-NAMES"""
    found = quality.judged(_measures())

    assert found.verdict == "good"
    assert found.as_record() == {"placedPct": 100.0, "seamMedian": 0.85, "seamRmsPx": 0.5, "verdict": "good"}


@pytest.mark.parametrize(
    "measures",
    [_measures(placed=8), _measures(scores=(0.45, 0.4)), _measures(residuals=(0.5, 5.0)), _measures(moved=0.4)],
)
def test_bad_path_a_layout_short_of_one_threshold_waits_for_a_check(measures: quality.Measures) -> None:
    """Scenarios: S-P20-BAD-STITCH-GARBAGE-WAITS"""
    assert quality.judged(measures).verdict == "check"


@pytest.mark.parametrize("measures", [_measures(placed=4), _measures(scores=(0.1, 0.2)), quality.Measures(0, 0, (), (), 0.0)])
def test_bad_path_a_layout_that_says_little_is_poor(measures: quality.Measures) -> None:
    assert quality.judged(measures).verdict == "poor"
