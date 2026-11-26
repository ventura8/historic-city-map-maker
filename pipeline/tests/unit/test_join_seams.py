"""Who owns the window's cells and where the owners meet (docs/research/M8-join-interfaces.md §3)."""

import numpy
import numpy.typing
import pytest
from hcm_pipeline.geo import Grid
from hcm_pipeline.join.seams import (
    MAX_SAMPLE_SPACING_M,
    MIN_SAMPLE_SPACING_M,
    assign,
    find_seams,
    owners,
    pair_boundary,
    principal_axis,
    sample_spacing_m,
)

GRID = Grid(0.0, 0.0, 100.0, 100, 80)


def frame(x0: int, x1: int, y0: int = 0, y1: int = 80) -> numpy.typing.NDArray[numpy.uint8]:
    alpha = numpy.zeros((80, 100), numpy.uint8)
    alpha[y0:y1, x0:x1] = 255
    return alpha


def test_happy_path_each_cell_goes_to_the_part_deepest_inside_its_frame() -> None:
    owner = owners([frame(0, 60), frame(40, 100)])

    assert (owner[40, 10], owner[40, 90]) == (1, 2)
    # The seam lies in the middle of the overlap, off both frames' edges.
    assert (owner[40, 49], owner[40, 50]) == (1, 2)


def test_bad_path_a_cell_no_part_covers_has_no_owner() -> None:
    owner = owners([frame(0, 30), frame(70, 100)])

    assert owner[40, 50] == 0


def test_happy_path_a_tie_goes_to_the_first_part() -> None:
    owner = owners([frame(10, 90, 10, 70), frame(10, 90, 10, 70)])

    assert set(numpy.unique(owner).tolist()) == {0, 1}


def test_happy_path_a_frame_inside_another_owns_nothing_and_is_left_out() -> None:
    found = assign([frame(0, 60), frame(20, 30, 30, 50), frame(40, 100)])

    assert (found.kept, found.omitted) == ((0, 2), (1,))
    # The owners then number the kept parts.
    assert set(numpy.unique(found.owner).tolist()) == {1, 2}


def test_happy_path_a_sliver_that_alone_covers_its_ground_is_kept() -> None:
    found = assign([frame(0, 99), frame(99, 100, 0, 79)])

    assert (found.kept, found.omitted) == ((0, 1), ())


def test_happy_path_many_small_sheets_each_under_one_percent_of_the_window_are_all_kept() -> None:
    """Scenarios: S-P05-BAD-SHEET-COVERED

    Finding of 2026-11-23: 5 of the 48 cadastral sheets of 1990 were left out as under 1 % of the window, leaving holes."""
    sheets = [frame(x, x + 8, y, y + 8) for x in range(0, 96, 8) for y in range(0, 80, 8)]

    found = assign(sheets)

    assert (len(found.kept), found.omitted) == (len(sheets), ())


def test_bad_path_a_sheet_another_covers_but_for_a_sliver_is_left_out() -> None:
    found = assign([frame(0, 100), frame(0, 100, 0, 80), frame(10, 30, 10, 30)])

    assert found.omitted == (1, 2)


def test_happy_path_two_small_sheets_in_a_large_window_are_both_kept() -> None:
    found = assign([frame(0, 2, 0, 2), frame(2, 4, 0, 2)])

    assert (found.kept, found.omitted) == ((0, 1), ())


def test_bad_path_with_nothing_kept_the_owners_stay_as_they_were() -> None:
    empty = numpy.zeros((80, 100), numpy.uint8)

    found = assign([empty, empty])

    assert (found.kept, found.omitted) == ((), (0, 1))


def test_happy_path_two_owners_meet_in_one_seam_along_their_boundary() -> None:
    owner = owners([frame(0, 60), frame(40, 100)])

    seams = find_seams(owner, GRID, 0.5)

    assert len(seams) == 1
    seam = seams[0]
    assert (seam.a, seam.b) == (0, 1)
    # 80 cells of 100 m on the map, 4 km on the ground at this scale.
    assert seam.length_m == pytest.approx(3950.0, abs=60.0)
    assert seam.axis == pytest.approx((0.0, 1.0), abs=1e-6)
    assert numpy.allclose(seam.line[:, 0], 5000.0)
    # At the least spacing a 4 km seam gets a sample per 250 m, in order along it.
    assert len(seam.samples) == pytest.approx(16, abs=1)
    assert [sample.u for sample in seam.samples] == sorted(sample.u for sample in seam.samples)


def test_bad_path_owners_that_never_touch_have_no_seam() -> None:
    assert find_seams(owners([frame(0, 30), frame(70, 100)]), GRID, 0.5) == ()


def test_bad_path_a_boundary_under_a_kilometre_is_no_seam() -> None:
    owner = owners([frame(0, 60, 0, 10), frame(40, 100, 0, 10)])

    assert find_seams(owner, GRID, 0.5) == ()


def test_happy_path_three_parts_give_each_touching_pair_its_seam() -> None:
    owner = owners([frame(0, 40), frame(30, 70), frame(60, 100)])

    assert [(seam.a, seam.b) for seam in find_seams(owner, GRID, 1.0)] == [(0, 1), (1, 2)]


def test_happy_path_the_spacing_is_clamped() -> None:
    assert sample_spacing_m(100.0) == MIN_SAMPLE_SPACING_M
    assert sample_spacing_m(12000.0) == 500.0
    assert sample_spacing_m(90000.0) == MAX_SAMPLE_SPACING_M


def test_happy_path_the_axis_is_signed_the_same_way_every_time() -> None:
    points = numpy.array([[0.0, 0.0], [-10.0, -1.0], [10.0, 1.0], [5.0, 0.4]])

    assert principal_axis(points) == pytest.approx(principal_axis(points[::-1]))
    assert principal_axis(points)[0] > 0
    assert principal_axis(-points)[0] > 0
    assert principal_axis(points[:1]) == pytest.approx((0.0, 1.0))


def test_happy_path_the_pair_boundary_holds_both_sides_within_reach() -> None:
    owner = owners([frame(0, 60), frame(40, 100)])

    near = pair_boundary(owner, 0, 1, 2)

    assert bool(near[40, 48:52].all())
    assert not near[40, 47]
    assert not near[40, 52]
