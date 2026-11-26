"""How far two parts lie apart along a seam (docs/research/M8-join-interfaces.md §3, `align` 3 to 6)."""

import cv2
import numpy
import numpy.typing
import pytest
from hcm_pipeline.geo import Grid, zoom_resolution
from hcm_pipeline.join.canvas import COARSE_ZOOM, FINE_ZOOM, PixelBox, Raster
from hcm_pipeline.join.measure import (
    COARSE_TILE_PX,
    MAD_FLOOR_M,
    Kept,
    MatchPass,
    Measured,
    SeamModel,
    Shift,
    coarse_pass,
    fit_model,
    held_out,
    kept_samples,
    locate,
    match_tile,
    measure_seam,
    median_shift,
    prepared,
    rmse_m,
    within_mad,
)
from hcm_pipeline.join.seams import Sample, Seam

SIZE = 640
STEP = MatchPass(COARSE_TILE_PX, 30)
GROUND = 0.7
FINE_FACTOR = round(zoom_resolution(COARSE_ZOOM) / zoom_resolution(FINE_ZOOM))


def picture(seed: int = 3, size: int = SIZE) -> numpy.typing.NDArray[numpy.uint8]:
    noise = numpy.random.default_rng(seed).normal(0, 1, (size, size))
    blurred = numpy.asarray(cv2.GaussianBlur(noise, (0, 0), 2.0), numpy.float64)
    return numpy.asarray(numpy.clip(128 + blurred * 120, 0, 255), numpy.uint8)


def moved(pixels: numpy.typing.NDArray[numpy.uint8], dx: float, dy: float) -> numpy.typing.NDArray[numpy.uint8]:
    """The picture with everything in it `dx`, `dy` pixels further on."""
    matrix = numpy.array([[1.0, 0.0, dx], [0.0, 1.0, dy]])
    return numpy.asarray(
        cv2.warpAffine(pixels, matrix, pixels.shape[::-1], flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT), numpy.uint8
    )


def raster(pixels: numpy.typing.NDArray[numpy.uint8], resolution: float = 10.0) -> Raster:
    return Raster(Grid(0.0, 0.0, resolution, pixels.shape[1], pixels.shape[0]), pixels, numpy.full(pixels.shape, 255, numpy.uint8))


def sample_at(column: float, row: float, resolution: float = 10.0) -> Sample:
    return Sample(row * resolution / 1000.0, column * resolution, -row * resolution)


def seam_of(samples: list[Sample]) -> Seam:
    line = numpy.array([[sample.x, sample.y] for sample in samples])
    return Seam(0, 1, line, (0.0, 0.0), (0.0, 1.0), 5000.0, tuple(samples), GROUND)


def kept(values: list[tuple[float, float, float]]) -> list[Kept]:
    return [Kept(Sample(u, 0.0, 0.0), dx, dy) for u, dx, dy in values]


def test_happy_path_a_tile_is_found_where_the_other_part_shows_it_whatever_its_print() -> None:
    pixels = picture()
    other = numpy.asarray(numpy.clip(moved(pixels, 7.0, -4.0) * 0.7 + 20, 0, 255), numpy.uint8)

    shift = match_tile(raster(pixels), raster(other), (320, 320), STEP)

    assert shift is not None
    assert (shift.dx, shift.dy) == pytest.approx((7.0, -4.0), abs=0.2)


def test_happy_path_a_shift_is_found_between_whole_pixels() -> None:
    pixels = picture()

    shift = match_tile(raster(pixels), raster(moved(pixels, 2.5, 0.0)), (320, 320), STEP)

    assert shift is not None
    assert shift.dx == pytest.approx(2.5, abs=0.25)


def test_happy_path_the_search_runs_around_a_prior() -> None:
    pixels = picture()

    shift = match_tile(raster(pixels), raster(moved(pixels, 60.0, 0.0)), (320, 320), MatchPass(COARSE_TILE_PX, 10), (58, 0))

    assert shift is not None
    assert shift.dx == pytest.approx(60.0, abs=0.2)


def test_bad_path_a_tile_either_part_does_not_hold_counts_for_nothing() -> None:
    pixels = picture()
    half = pixels.copy()
    alpha = numpy.full(pixels.shape, 255, numpy.uint8)
    alpha[:, 320:] = 0
    partial = Raster(raster(pixels).grid, half, alpha)

    assert match_tile(partial, raster(pixels), (320, 320), STEP) is None
    assert match_tile(raster(pixels), partial, (320, 320), STEP) is None
    assert match_tile(raster(pixels), raster(pixels), (-200, 320), STEP) is None


def test_bad_path_a_flat_tile_finds_nothing() -> None:
    flat = numpy.full((SIZE, SIZE), 140, numpy.uint8)

    assert match_tile(raster(flat), raster(picture()), (320, 320), STEP) is None
    assert match_tile(raster(picture()), raster(flat), (320, 320), STEP) is None


def test_bad_path_two_different_pictures_find_no_believable_peak() -> None:
    assert match_tile(raster(picture(3)), raster(picture(4)), (320, 320), STEP) is None


def test_bad_path_a_peak_on_the_searchs_edge_is_refused() -> None:
    tile = prepared(raster(picture()).read(PixelBox(100, 100, 164, 164)))
    area = numpy.zeros((70, 70), numpy.float32)
    area[:64, :64] = tile
    area[64:, :] = numpy.random.default_rng(1).normal(0, 1, (6, 70))
    area[:, 64:] = numpy.random.default_rng(2).normal(0, 1, (70, 6))

    assert locate(tile, area) is None


def test_happy_path_no_data_in_a_tile_is_filled_with_its_median() -> None:
    pixels = picture()
    alpha = numpy.full(pixels.shape, 255, numpy.uint8)
    alpha[:64, 0:4] = 0
    patch = Raster(raster(pixels).grid, numpy.where(alpha > 0, pixels, 0).astype(numpy.uint8), alpha).read(PixelBox(0, 0, 64, 64))

    found = prepared(patch)

    # The black column would have been the strongest edge of the tile.
    assert float(numpy.abs(found[:, :6]).max()) < float(
        numpy.abs(prepared(raster(numpy.where(alpha > 0, pixels, 0).astype(numpy.uint8)).read(PixelBox(0, 0, 64, 64)))[:, :6]).max()
    )


def test_happy_path_no_data_all_over_prepares_a_flat_image() -> None:
    blank = Raster(raster(picture()).grid, numpy.zeros((SIZE, SIZE), numpy.uint8), numpy.zeros((SIZE, SIZE), numpy.uint8))

    assert float(prepared(blank.read(PixelBox(0, 0, 64, 64))).std()) == 0.0


def test_happy_path_the_coarse_pass_keeps_the_samples_that_matched() -> None:
    pixels = picture()
    a, b = raster(pixels), raster(moved(pixels, 5.0, 0.0))
    good, off = sample_at(320, 320), sample_at(-500, 320)

    found = coarse_pass(a, b, a.grid, [good, off], 1.0)

    assert set(found) == {good}
    assert found[good].metres(10.0) == pytest.approx((50.0, 0.0), abs=2.0)


def test_happy_path_the_figures_are_ground_metres_north_up() -> None:
    grid = raster(picture()).grid

    assert Shift(1.0, 2.0).metres(10.0) == (10.0, -20.0)
    assert rmse_m([Shift(3.0, 4.0)], grid, GROUND) == pytest.approx(35.0)
    assert median_shift([Shift(1.0, 9.0), Shift(2.0, 8.0), Shift(30.0, 7.0)]) == Shift(2.0, 8.0)


def test_bad_path_a_sample_beyond_the_deviations_is_dropped_on_either_axis() -> None:
    found = {Sample(float(index), 0.0, 0.0): Shift(5.0 + index * 0.1, 1.0) for index in range(9)}
    found[Sample(20.0, 0.0, 0.0)] = Shift(40.0, 1.0)
    found[Sample(21.0, 0.0, 0.0)] = Shift(5.0, -30.0)

    result = kept_samples(found, 1.0)

    assert len(result) == 9
    assert [item.sample.u for item in result] == [float(index) for index in range(9)]


def test_bad_path_nothing_found_keeps_nothing() -> None:
    assert kept_samples({}, 1.0) == ()


def test_happy_path_a_spread_under_the_noise_makes_no_outlier() -> None:
    values = numpy.array([1.0, 1.0, 1.0, 1.0, 1.0 + 3.0 * MAD_FLOOR_M])

    assert bool(within_mad(values).all())


def test_happy_path_every_fifth_kept_sample_is_held_out_once_there_are_ten() -> None:
    assert held_out(kept([(float(index), 0.0, 0.0) for index in range(9)])) == ()
    spare = held_out(kept([(float(index), 0.0, 0.0) for index in range(12)]))
    assert [item.sample.u for item in spare] == [4.0, 9.0]


def test_bad_path_under_six_samples_there_is_no_model() -> None:
    assert fit_model(kept([(float(index), 1.0, 1.0) for index in range(5)]), 5000.0) is None


def test_happy_path_six_samples_give_their_median() -> None:
    model = fit_model(kept([(0.0, 1.0, 5.0), (1.0, 2.0, 5.0), (2.0, 3.0, 5.0), (3.0, 4.0, 5.0), (4.0, 5.0, 5.0), (5.0, 90.0, 5.0)]), 5000.0)

    assert model is not None
    assert model.x == (3.5,)
    assert model.y == (5.0,)


def test_happy_path_twelve_spread_samples_give_a_quadratic_held_out_samples_do_not_take_part() -> None:
    def shift(u: float) -> float:
        return 2.0 * u * u - u + 3.0

    values = [(float(index), shift(float(index)), -shift(float(index))) for index in range(14)]
    values[4] = (4.0, 500.0, 500.0)

    model = fit_model(kept(values), 13000.0)

    assert model is not None
    assert model.x == pytest.approx((2.0, -1.0, 3.0))
    assert model.y == pytest.approx((-2.0, 1.0, -3.0))
    assert (model.low, model.high) == (0.0, 13.0)


def test_bad_path_samples_bunched_on_a_long_seam_get_only_the_median() -> None:
    values = [(index * 0.1, float(index), 0.0) for index in range(14)]

    model = fit_model(kept(values), 50000.0)

    assert model is not None
    assert len(model.x) == 1


def test_happy_path_the_model_is_clamped_outside_the_sampled_range() -> None:
    model = SeamModel((1.0, 0.0), (0.0, 2.0), 0.0, 10.0)

    x, y = model.at(numpy.array([-5.0, 5.0, 50.0]))

    assert x.tolist() == [0.0, 5.0, 10.0]
    assert y.tolist() == [2.0, 2.0, 2.0]
    assert model.largest_m() == pytest.approx(numpy.hypot(10.0, 2.0))


def test_happy_path_a_correction_is_judged_on_what_was_held_out_or_on_all_when_none_could_be() -> None:
    many, few = kept([(float(index), 0.0, 0.0) for index in range(10)]), kept([(float(index), 0.0, 0.0) for index in range(6)])
    seam = seam_of([sample_at(0, 0)])

    assert [sample.u for sample in Measured(seam, tuple(many)).judged()] == [4.0, 9.0]
    assert len(Measured(seam, tuple(few)).judged()) == 6


def _coarse_rasters(dx: float) -> tuple[Raster, Raster]:
    resolution = zoom_resolution(COARSE_ZOOM)
    pixels = picture()
    return raster(pixels, resolution), raster(moved(pixels, dx, 0.0), resolution)


def _samples_down(resolution: float) -> list[Sample]:
    return [sample_at(320, row, resolution) for row in range(100, 560, 40)]


def test_happy_path_a_seam_measures_through_both_passes() -> None:
    a, b = _coarse_rasters(4.0)
    resolution = a.grid.resolution
    fine_pixels = numpy.asarray(cv2.resize(a.grey, None, fx=FINE_FACTOR, fy=FINE_FACTOR, interpolation=cv2.INTER_LINEAR), numpy.uint8)
    fine_grid = Grid(0.0, 0.0, resolution / FINE_FACTOR, fine_pixels.shape[1], fine_pixels.shape[0])
    fine_a = Raster(fine_grid, fine_pixels, numpy.full(fine_pixels.shape, 255, numpy.uint8))
    fine_b = Raster(fine_grid, moved(fine_pixels, 4.0 * FINE_FACTOR, 0.0), fine_a.alpha)
    seam = seam_of(_samples_down(resolution))

    measured = measure_seam(a, b, a.grid, seam, lambda: (fine_a, fine_b, fine_grid))

    assert measured.model is not None
    assert len(measured.kept) == len(seam.samples)
    assert measured.coarse_m == pytest.approx(4.0 * resolution * GROUND, abs=2.0)
    assert measured.model.largest_m() == pytest.approx(4.0 * resolution, abs=2.0)


def test_bad_path_too_few_coarse_tiles_never_fetch_the_scans() -> None:
    a, b = _coarse_rasters(4.0)
    samples = _samples_down(a.grid.resolution)[:5]

    def sources() -> tuple[Raster, Raster, Grid]:
        raise AssertionError("the fine pass must not run")

    measured = measure_seam(a, b, a.grid, seam_of(samples), sources)

    assert measured.model is None
    assert measured.coarse_m == 0.0
    assert len(measured.kept) == 5


def test_bad_path_a_pair_too_far_apart_never_fetches_the_scans() -> None:
    a, b = _coarse_rasters(70.0)

    def sources() -> tuple[Raster, Raster, Grid]:
        raise AssertionError("the fine pass must not run")

    measured = measure_seam(a, b, a.grid, seam_of(_samples_down(a.grid.resolution)), sources)

    assert measured.model is None
    assert measured.coarse_m == pytest.approx(70.0 * a.grid.resolution * GROUND, abs=3.0)
