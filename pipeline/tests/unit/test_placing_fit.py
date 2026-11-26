"""The fit's edges (docs/research/M20-import-local.md §3 c steps 4, 5): a map with no streets, a blank sheet, nothing to pair, a drift."""

import cv2
import numpy
import pytest
from hcm_pipeline.geo import Grid
from hcm_pipeline.placing import coarse, fine, geometry, streets
from hcm_pipeline.placing.reference import reference_of
from hcm_pipeline.placing.streets import line_skeleton, street_network, thin


def test_bad_path_a_map_with_no_streets_has_no_coarse_placement() -> None:
    lines = numpy.zeros((50, 50), numpy.uint8)
    cv2.line(lines, (5, 25), (45, 25), 255, 1)
    reference = reference_of(line_skeleton(lines), Grid(0.0, 500.0, 10.0, 50, 50), "osm")

    assert coarse.search(reference, numpy.zeros((0, 2)), coarse.hypotheses([10.0]), 100.0) is None


def test_bad_path_a_blank_sheet_has_no_streets_and_thinning_stops_at_its_round_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    blank = street_network(numpy.full((60, 60), 250, numpy.uint8))
    monkeypatch.setattr(streets, "THINNING_ROUNDS", 1)
    thick = thin(numpy.ones((40, 40), numpy.bool_))

    assert not blank.skeleton.any()
    assert blank.half_width == 1.0
    assert thick.sum() > 40


def test_bad_path_a_fit_with_nothing_to_pair_or_that_drifts_is_refused() -> None:
    empty, two = numpy.zeros((0, 2)), numpy.array([[0.0, 0.0], [1.0, 1.0]])
    matrix = numpy.array([[1.0, 0.0, 0.0], [0.0, -1.0, 0.0]])
    grid = numpy.array([[x * 50.0, y * 50.0] for x in range(12) for y in range(12)])
    problem = fine.Problem(grid, (0.0, 0.0, 600.0, 600.0), geometry.apply(matrix, grid), 1.0, 100.0)
    dense = numpy.array([[x * 20.0 + 3.0 * (y % 3), y * 20.0 + 2.0 * (x % 4)] for x in range(30) for y in range(30)])
    lost = fine.Problem(dense, (0.0, 0.0, 600.0, 600.0), geometry.apply(matrix, dense), 1.0, 100.0)
    swollen = geometry.compose(matrix, numpy.array([[1.25, 0.0, -75.0], [0.0, 1.25, -75.0]]))

    assert len(fine.candidates(empty, two, matrix, 10.0)[0]) == 0
    assert fine.suggestion_pairs(empty, two, matrix, 10.0)[2] == []
    held = fine.fit(problem, matrix, 20.0)
    assert held is not None
    assert len(fine.check_errors(problem, held.transform, numpy.zeros(len(grid), numpy.bool_))[0]) == 0
    assert fine.fit(lost, swollen, 8.0) is None
