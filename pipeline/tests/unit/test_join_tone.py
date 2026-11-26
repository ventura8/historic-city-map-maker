"""Evening out the frames' tones across their seams (docs/research/M8-join-interfaces.md §3, `merge` 2)."""

import cv2
import numpy
import numpy.typing
import pytest
from hcm_pipeline.geo import Grid
from hcm_pipeline.join.canvas import Raster
from hcm_pipeline.join.tone import (
    MAX_GAIN,
    MIN_GAIN,
    Linear,
    ToneSeam,
    linear_between,
    linear_tones,
    low_frequency,
    owned_most,
    plan_tones,
    tree_of,
)

SIZE = 200
GRID = Grid(0.0, 0.0, 38.0, SIZE, SIZE)
CELL_M = 27.0


def picture(seed: int = 5) -> numpy.typing.NDArray[numpy.float64]:
    noise = numpy.random.default_rng(seed).normal(0, 1, (SIZE, SIZE))
    return 120.0 + 40.0 * numpy.asarray(cv2.GaussianBlur(noise, (0, 0), 3.0), numpy.float64) / 0.09


def raster(values: numpy.typing.NDArray[numpy.float64], x0: int = 0, x1: int = SIZE) -> Raster:
    alpha = numpy.zeros((SIZE, SIZE), numpy.uint8)
    alpha[:, x0:x1] = 255
    return Raster(GRID, numpy.asarray(numpy.clip(values, 0, 255), numpy.uint8), alpha)


def test_happy_path_a_line_brings_one_part_to_the_others_tones() -> None:
    values = numpy.clip(picture(), 20, 200)

    line = linear_between(raster(values), raster(values * 1.25 + 5.0))

    assert line.of(numpy.array([values.min() * 1.25 + 5.0, values.max() * 1.25 + 5.0])) == pytest.approx(
        [values.min(), values.max()], abs=4.0
    )
    assert line.gain == pytest.approx(0.8, abs=0.02)


@pytest.mark.parametrize(("factor", "expected"), [(10.0, MIN_GAIN), (0.05, MAX_GAIN)])
def test_bad_path_the_gain_is_clamped(factor: float, expected: float) -> None:
    values = numpy.clip(picture(), 100, 180)

    assert linear_between(raster(values), raster((values - 100.0) * factor)).gain == expected


def test_bad_path_with_no_overlap_nothing_changes() -> None:
    assert linear_between(raster(picture(), 0, 90), raster(picture(), 110, SIZE)) == Linear()


def test_happy_path_lines_chain_along_the_walk() -> None:
    assert Linear(2.0, 1.0).after(Linear(3.0, 5.0)) == Linear(6.0, 11.0)
    assert Linear(2.0, 1.0).after(Linear(3.0, 5.0)).of(numpy.array([1.0])).tolist() == [
        Linear(2.0, 1.0).of(Linear(3.0, 5.0).of(numpy.array([1.0])))[0]
    ]


def test_happy_path_the_walk_starts_at_the_anchor_and_leaves_what_no_seam_reaches() -> None:
    assert tree_of(4, [(0, 1), (1, 2)], 1) == [(1, 0), (1, 2)]
    # A seam off the tree (0-2) is only measured, and part 3 stays out.
    assert tree_of(4, [(0, 1), (1, 2), (0, 2)], 0) == [(0, 1), (0, 2)]


def test_happy_path_three_parts_chain_to_the_anchors_tones() -> None:
    values = numpy.clip(picture(), 20, 180)
    parts = [raster(values), raster(values * 1.2), raster(values * 1.2 * 1.2)]

    tones = linear_tones(parts, [(0, 1), (1, 2)], 0)

    assert tones[0] == Linear()
    assert tones[1].gain == pytest.approx(1 / 1.2, abs=0.02)
    assert tones[2].gain == pytest.approx(1 / 1.44, abs=0.03)


def test_bad_path_a_field_needs_an_overlap() -> None:
    a = numpy.full((SIZE, SIZE), 100.0)
    none = numpy.zeros((SIZE, SIZE), numpy.bool_)

    assert bool((low_frequency(a, a, none, numpy.zeros((SIZE, SIZE)), CELL_M) == 0.0).all())


def test_happy_path_the_field_closes_a_step_at_the_seam_and_fades_away() -> None:
    a, b = numpy.full((SIZE, SIZE), 100.0), numpy.full((SIZE, SIZE), 130.0)
    both = numpy.zeros((SIZE, SIZE), numpy.bool_)
    both[:, 80:120] = True
    away = numpy.abs(numpy.arange(SIZE, dtype=numpy.float64) - 100.0)[None, :].repeat(SIZE, 0) * CELL_M * 10

    field = low_frequency(a, b, both, away, CELL_M)

    assert float(field[100, 100]) == pytest.approx(numpy.log(131.0 / 101.0), abs=0.01)
    # 30 cells off the seam is 8.1 km here: past the fade.
    assert float(field[100, 70]) == 0.0


def test_happy_path_a_seams_field_is_shared_half_and_half_with_opposite_signs() -> None:
    a = numpy.full((SIZE, SIZE), 100.0)
    away = numpy.zeros((SIZE, SIZE))
    parts = [raster(a), raster(a * 1.3)]
    flat = plan_tones(parts, [ToneSeam(0, 1, away)], 0, CELL_M)

    # Flat pictures: the percentiles are one value, so the line only shifts and the seam is already closed.
    assert flat[0].line == Linear()
    assert float(numpy.abs(flat[0].field + flat[1].field).max()) == 0.0


def test_happy_path_what_a_line_leaves_the_field_closes() -> None:
    values = numpy.clip(picture(), 20, 180)
    darker_middle = values.copy()
    second = values * (1.0 + 0.2 * numpy.linspace(0.0, 1.0, SIZE)[None, :])
    away = numpy.abs(numpy.arange(SIZE, dtype=numpy.float64) - 100.0)[None, :].repeat(SIZE, 0) * CELL_M

    tones = plan_tones([raster(darker_middle), raster(second)], [ToneSeam(0, 1, away)], 0, CELL_M)

    left = tones[0].line.of(values[100, 100:101]) * numpy.exp(tones[0].field[100, 100:101])
    right = tones[1].line.of(second[100, 100:101]) * numpy.exp(tones[1].field[100, 100:101])
    assert float(left[0]) == pytest.approx(float(right[0]), abs=8.0)
    assert float(numpy.abs(tones[0].field).max()) > 0.0
    assert float(numpy.abs(tones[0].field + tones[1].field).max()) < 1e-5


def test_happy_path_the_anchor_owns_the_most() -> None:
    assert owned_most(numpy.array([[0, 1, 2, 2]], numpy.uint8), 2) == 1
