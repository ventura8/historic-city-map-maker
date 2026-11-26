"""The placers' building blocks (docs/research/M20-import-local.md §3 b, c): transforms, street networks, frames and held-out checks."""

import math

import cv2
import numpy
import pytest
from hcm_pipeline.placing import checks, geometry
from hcm_pipeline.placing.frame import find_frame, order_corners
from hcm_pipeline.placing.streets import grey_of, junctions, line_skeleton, network_of, paper_of, prune, street_network, thin

RNG = numpy.random.default_rng(3)


def similarity_of(scale: float, degrees: float, shift: tuple[float, float]) -> numpy.ndarray:
    angle = math.radians(degrees)
    return numpy.array(
        [[scale * math.cos(angle), -scale * math.sin(angle), shift[0]], [scale * math.sin(angle), scale * math.cos(angle), shift[1]]]
    )


def test_happy_path_a_similarity_and_an_affine_are_recovered_from_their_points() -> None:
    truth = similarity_of(2.5, 12.0, (100.0, -40.0))
    source = RNG.uniform(0, 500, (30, 2))
    target = geometry.apply(truth, source)

    found = geometry.similarity(source, target)
    fitted = geometry.affine(source, target)

    assert found is not None
    assert fitted is not None
    assert numpy.allclose(found, truth)
    assert numpy.allclose(fitted, truth)
    assert geometry.scale_of(found) == pytest.approx(2.5)
    assert geometry.rotation_deg(found) == pytest.approx(12.0)
    assert numpy.allclose(geometry.compose(geometry.invert(found), found), [[1, 0, 0], [0, 1, 0]])


def test_happy_path_pixels_to_mercator_keep_their_flip_through_ransac() -> None:
    truth = numpy.array([[3.0, 0.2, 2.9e6], [0.2, -3.0, 5.5e6]])
    source = RNG.uniform(0, 1000, (80, 2))
    target = geometry.apply(truth, source)
    target[:20] += RNG.uniform(200, 400, (20, 2))

    plain = geometry.ransac_similarity(source, target, 5.0)
    flipped = geometry.ransac_similarity(source, target, 5.0, start=truth)

    assert plain is not None
    assert plain.count < 60
    assert flipped is not None
    assert flipped.count == 60
    assert geometry.is_flipped(flipped.matrix)
    assert numpy.allclose(flipped.matrix, truth, atol=1e-6)


def test_bad_path_too_few_or_degenerate_points_fit_nothing() -> None:
    line = numpy.array([[0.0, 0.0], [1.0, 1.0], [2.0, 2.0]])

    assert geometry.similarity(line[:1], line[:1]) is None
    assert geometry.similarity(numpy.zeros((3, 2)), line) is None
    assert geometry.affine(line[:2], line[:2]) is None
    assert geometry.affine(line, line) is None
    assert geometry.ransac_similarity(line[:2], line[:2], 1.0) is None
    assert geometry.ransac_similarity(numpy.zeros((4, 2)), line[[0, 1, 2, 0]], 1.0) is None


def street_plan(size: int = 400, step: int = 50, width: int = 6) -> numpy.ndarray:
    """A grey plan: dark blocks, light streets every `step` pixels (and one diagonal), a text-like blob in a block."""
    image = numpy.full((size, size), 60, numpy.uint8)
    for at in range(step // 2, size, step):
        image[at - width // 2 : at + width // 2, :] = 240
        image[:, at - width // 2 : at + width // 2] = 240
    cv2.line(image, (0, 0), (size, size), 240, width)
    cv2.circle(image, (step, step), 6, 240, -1)
    return image


def test_happy_path_a_street_plans_network_and_junctions_are_found() -> None:
    """Scenarios: S-P20-HAPPY-STREETS"""
    network = street_network(street_plan())

    found = network.junctions()

    assert 50 <= len(found) <= 90
    assert network.half_width == pytest.approx(3.0, abs=1.5)
    near_grid = numpy.abs(((found - 25) % 50 + 25) % 50 - 25)
    assert (near_grid.max(axis=1) < 4).mean() > 0.8


def test_bad_path_paper_cut_off_from_the_network_and_a_staircase_are_no_streets() -> None:
    image = numpy.full((200, 200), 60, numpy.uint8)
    cv2.rectangle(image, (20, 20), (60, 60), 240, -1)
    staircase = numpy.zeros((40, 40), numpy.bool_)
    for at in range(30):
        staircase[at + 5, at + 5] = staircase[at + 5, at + 6] = True

    assert not network_of(paper_of(image)).any()
    assert len(junctions(thin(staircase))) == 0
    assert not prune(thin(staircase), 40).any()


def test_happy_path_colour_paper_is_light_and_unsaturated() -> None:
    image = numpy.zeros((10, 20, 3), numpy.uint8)
    image[:, :10] = (200, 40, 40)
    image[:, 10:] = (245, 240, 235)

    paper = paper_of(image)

    assert paper[:, 10:].all()
    assert not paper[:, :10].any()
    assert grey_of(image).shape == (10, 20)


def test_happy_path_drawn_lines_thin_to_a_skeleton() -> None:
    lines = numpy.zeros((60, 60), numpy.uint8)
    cv2.line(lines, (5, 30), (55, 30), 255, 3)
    cv2.line(lines, (30, 5), (30, 55), 255, 3)

    skeleton = line_skeleton(lines)

    assert skeleton[30, 10:50].sum() >= 30
    assert len(junctions(skeleton)) == 1


def framed_sheet(size: tuple[int, int] = (500, 400), margin: int = 40) -> numpy.ndarray:
    width, height = size
    image = numpy.full((height, width), 250, numpy.uint8)
    cv2.rectangle(image, (margin, margin + 5), (width - margin, height - margin), 0, 3)
    cv2.line(image, (margin + 30, margin + 40), (width - margin - 30, height - margin - 40), 0, 2)
    return image


def test_happy_path_a_sheets_frame_is_found_in_full_scan_pixels() -> None:
    """Scenarios: S-P20-HAPPY-FRAME"""
    corners = find_frame(framed_sheet(), scale=4.0)

    assert corners is not None
    assert numpy.allclose(corners, numpy.array([[40, 45], [460, 45], [460, 360], [40, 360]]) * 4.0 + 2.0, atol=12)


def test_bad_path_a_sheet_without_a_frame_has_none() -> None:
    """Scenarios: S-P20-BAD-FRAME-NOT-FOUND"""
    blank = numpy.full((300, 300), 250, numpy.uint8)
    cv2.circle(blank, (150, 150), 80, 0, 3)

    assert find_frame(blank) is None
    assert numpy.array_equal(order_corners(numpy.array([[10.0, 0.0], [0.0, 0.0], [0.0, 10.0], [10.0, 10.0]]))[0], [0.0, 0.0])


def test_happy_path_checks_are_held_out_in_blocks_and_measured_on_the_maps_own_extent() -> None:
    """Scenarios: S-P20-HAPPY-CHECKS"""
    points = numpy.array([[x + 10.0, y + 10.0] for x in range(0, 500, 20) for y in range(0, 500, 20)])
    extent = (0.0, 0.0, 500.0, 500.0)

    held = checks.held_out(points, extent)
    errors = numpy.full(int(held.sum()), 4.0)
    errors[0] = 900.0
    result = checks.checked(errors, points[held], ["a"] * len(errors), extent, checks.gross_m(40_000))

    assert 0.15 < held.mean() < 0.25
    assert result.dropped == 1
    assert result.count == len(errors) - 1
    assert result.rmse_m == pytest.approx(4.0)
    assert result.measured_pct > 70
    assert result.residuals is not None
    assert result.residuals.as_record()["worst"] == ["a"]
    assert checks.gross_m(None) == 100.0
    assert checks.gross_m(40_000) == 200.0


def test_bad_path_no_checks_measure_nothing_and_a_rungs_error_adds_in_quadrature() -> None:
    nothing = checks.checked(numpy.zeros(0), numpy.zeros((0, 2)), [], (0.0, 0.0, 1.0, 1.0), 100.0)

    assert nothing.rmse_m is None
    assert nothing.residuals is None
    assert nothing.measured_pct == 0.0
    assert checks.in_quadrature(3.0, 4.0) == pytest.approx(5.0)
    assert checks.in_quadrature(3.0, None) == pytest.approx(3.0)
    assert checks.in_quadrature(None, 4.0) is None
