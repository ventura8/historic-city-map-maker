"""The proof's gates on tiles with known errors (M9 §4)."""

from dataclasses import replace

import numpy
import pytest
from hcm_pipeline.calibrate.chain import prove_map
from hcm_pipeline.calibrate.dense import ROW_COLUMNS, Measured, dense_grid, film_box, read_film
from hcm_pipeline.calibrate.poly import MatrixMap, PolyMap, fit_poly, ground_errors, pixel_ground_m, rmse_m, robust_fit
from hcm_pipeline.calibrate.proof import CHECK_GROSS_M, PROOF_MIN_CHECKS, Checked, cross_checked, no_film, prove
from hcm_pipeline.calibrate.reach import OUTLINE_MAX_VERTICES, Reach, outline, proved_box, reach_of
from hcm_pipeline.geo import Grid, MercatorBox

from tests.unit.calibrate_scene import ArrayReader, Shot, film_points, nothing, scene_of, search_of

CELL_M = 2240.0
SEED = 7


def rows_of(count: int, noise_m: float = 3.0, seed: int = 1, peak: float = 0.5) -> numpy.ndarray:
    """Tiles over a 40 km box whose map is a known mild polynomial, with `noise_m` Mercator metres of error."""
    rng = numpy.random.default_rng(seed)
    film = rng.uniform(0, 40000, (count, 2))
    places = numpy.column_stack(
        (2.9e6 + 1.1 * film[:, 0] + 2e-6 * film[:, 0] ** 2, 5.5e6 - 1.1 * film[:, 1] + 1e-6 * film[:, 0] * film[:, 1])
    )
    places += rng.normal(0, noise_m, places.shape)
    return numpy.column_stack((film, places, numpy.full(count, peak), numpy.full(count, 0.1)))


def test_happy_path_ransac_keeps_the_map_and_refuses_gross_tiles() -> None:
    """Scenarios: S-P06-HAPPY-VOTES"""
    rows = rows_of(300)
    rows[:30, 2:4] += 3000.0

    found = robust_fit(rows[:, :2], rows[:, 2:4], 2, 25.0, SEED)

    assert found is not None
    assert not found[1][:30].any()
    assert found[1][30:].mean() > 0.95
    assert robust_fit(rows[:3, :2], rows[:3, 2:4], 2, 25.0, SEED) is None


def test_happy_path_the_same_seed_gives_the_same_map() -> None:
    """Scenarios: S-P06-HAPPY-VOTES"""
    rows = rows_of(120)

    first = robust_fit(rows[:, :2], rows[:, 2:4], 1, 25.0, SEED)
    second = robust_fit(rows[:, :2], rows[:, 2:4], 1, 25.0, SEED)

    assert first is not None

    assert second is not None
    assert numpy.array_equal(first[0].coefficients, second[0].coefficients)


def test_happy_path_ground_metres_follow_each_pairs_own_latitude() -> None:
    """Scenarios: S-P06-HAPPY-VOTES"""
    equator = numpy.array([[0.0, 0.0]])
    high = numpy.array([[0.0, 8399737.0]])

    assert ground_errors(equator + numpy.array([100.0, 0.0]), equator)[0] == pytest.approx(100.0)
    assert ground_errors(high + numpy.array([100.0, 0.0]), high)[0] == pytest.approx(50.0, abs=0.2)


def test_happy_path_blocked_checks_measure_what_was_held_out() -> None:
    """Scenarios: S-P06-HAPPY-VOTES"""
    rows = rows_of(800, 5.0)

    found = cross_checked(rows, 2, CELL_M, SEED)

    assert found.count > 50
    assert found.cv_m == pytest.approx(5.0 * 0.71 * 2**0.5, abs=3.0)
    assert found.gross == 0.0


def test_bad_path_a_bad_tile_in_a_held_cell_raises_the_figure() -> None:
    """Scenarios: S-P06-HAPPY-VOTES"""
    clean = rows_of(800, 5.0)
    bad = clean.copy()
    bad[:, 4] = 0.4
    # The strongest tile of about a sixth of the cells is off by 60 m: RANSAC never sees it in its own fold, the figure must.
    worst = numpy.random.default_rng(9).choice(len(bad), 200, replace=False)
    bad[worst, 2:4] += 60.0
    bad[worst, 4] = 0.9

    assert cross_checked(bad, 2, CELL_M, SEED).cv_m > cross_checked(clean, 2, CELL_M, SEED).cv_m + 3.0


def test_bad_path_no_clear_check_is_no_figure() -> None:
    """Scenarios: S-P06-BAD-OFF-STRIP"""
    rows = rows_of(200, peak=0.25)

    found = cross_checked(rows, 2, CELL_M, SEED)

    assert found == Checked(float("inf"), 1.0, 0)
    assert rmse_m(numpy.empty(0)) == float("inf")


def measured(rows: numpy.ndarray, inliers: numpy.ndarray, covered: float = 0.5) -> Measured:
    forward = fit_poly(2, rows[:, :2], rows[:, 2:4])
    return Measured(rows, forward, inliers, covered, PolyMap.over(forward, (0.0, 0.0, 40000.0, 40000.0)), None)


@pytest.mark.parametrize(
    ("count", "share", "covered", "refusal"),
    [
        (40, 1.0, 0.5, "few-inliers"),
        (400, 0.4, 0.5, "low-share"),
        (400, 1.0, 0.01, "small"),
    ],
)
def test_bad_path_each_gate_names_itself(count: int, share: float, covered: float, refusal: str) -> None:
    """Scenarios: S-P06-BAD-OFF-STRIP"""
    rows = rows_of(count)
    inliers = numpy.arange(count) < count * share
    grid = search_of(scene_of()).grid

    assert prove(measured(rows, inliers, covered), replace(grid, width=4000, height=4000), SEED).refusal == refusal


def test_bad_path_one_clear_tile_cannot_decide_the_checks() -> None:
    """Scenarios: S-P06-BAD-FEW-CHECKS"""
    rows = rows_of(2209, peak=0.25)
    rows[1000, 4] = 0.5
    grid = replace(search_of(scene_of()).grid, width=4000, height=4000)

    proof = prove(measured(rows, numpy.ones(2209, bool), 0.5), grid, SEED)

    assert proof.checked.count == 1
    assert proof.refusal == "cross-validation"


def test_happy_path_a_check_in_every_fold_is_enough() -> None:
    """Scenarios: S-P06-BAD-FEW-CHECKS"""
    rows = rows_of(2209, peak=0.25)
    rows[::200, 4] = 0.5
    grid = replace(search_of(scene_of()).grid, width=4000, height=4000)

    proof = prove(measured(rows, numpy.ones(2209, bool), 0.5), grid, SEED)

    assert proof.checked.count >= PROOF_MIN_CHECKS
    assert proof.refusal is None


def test_bad_path_tiles_in_a_corner_of_the_window_are_narrow() -> None:
    """Scenarios: S-P06-BAD-OFF-STRIP"""
    rows = rows_of(400)
    grid = replace(search_of(scene_of()).grid, width=40000, height=40000)

    assert prove(measured(rows, numpy.ones(400, bool), 1.0), grid, SEED).refusal == "narrow"


def test_bad_path_a_film_that_misses_the_window_is_a_small_refusal_not_an_exception() -> None:
    """Scenarios: S-P06-BAD-OFF-STRIP"""
    scene = scene_of()
    search = search_of(scene)
    away = numpy.array([[1.0, 0.0, 9e6], [0.0, 1.0, 9e6], [0.0, 0.0, 1.0]])
    reference = dense_grid(search.reference, search.grid)

    proof = prove_map(search, reference, MatrixMap(away @ scene.truth), nothing)

    assert proof.refusal == "small"
    assert not proof.accepted
    assert proof.forward is None
    assert no_film(proof.measured).inliers == 0


def test_bad_path_a_map_kilometres_off_cannot_prove_itself() -> None:
    """Scenarios: S-P06-BAD-OFF-STRIP"""
    scene = scene_of()
    search = search_of(scene)
    reference = dense_grid(search.reference, search.grid)
    off = numpy.array([[1.0, 0.0, 5000.0], [0.0, 1.0, -4000.0], [0.0, 0.0, 1.0]])

    proof = prove_map(search, reference, MatrixMap(off @ scene.truth), nothing)

    assert not proof.accepted


def test_happy_path_the_film_is_read_averaged_at_about_five_ground_metres() -> None:
    """Scenarios: S-P06-HAPPY-VOTES"""
    scene = scene_of(Shot(pixel_ground_m=1.0))
    mapping = MatrixMap(scene.truth)
    reader = ArrayReader(scene.film)
    box = scene.grid.box()

    film = read_film(mapping, box, reader, (*scene.size, 0), 100.0)

    assert film is not None
    assert film.factor == 5
    assert pixel_ground_m(mapping, film_points(scene)[:1]) == pytest.approx(1.0, rel=0.01)
    far = MercatorBox(box.left + 9e6, box.bottom, box.right + 9e6, box.top)
    assert film_box(mapping, far, (*scene.size, 0)) is None
    assert ROW_COLUMNS == 6
    assert CHECK_GROSS_M == 100.0


def test_happy_path_what_a_proved_map_reaches_is_measured_on_the_exposure() -> None:
    """Scenarios: S-P06-BAD-CROP-COVERAGE"""
    scene = scene_of()
    mapping = MatrixMap(scene.truth)
    width, height = scene.size
    box = scene.grid.box()

    whole = reach_of(mapping, box, (width, height, 0))
    half = reach_of(mapping, box, (width // 2, height, 0))
    away = reach_of(mapping, MercatorBox(box.left + 9e6, box.bottom, box.right + 9e6, box.top), (width, height, 0))

    assert half.share == pytest.approx(whole.share / 2, abs=0.05)
    found = proved_box(half, (width // 2, height, 0))
    assert found is not None
    assert found[2] <= width // 2
    assert proved_box(away, (width, height, 0)) is None
    assert outline(away) == []
    edge = outline(whole)
    assert 3 <= len(edge) <= OUTLINE_MAX_VERTICES
    assert all(set(place) == {"lat", "lng"} for place in edge)


def test_happy_path_a_jagged_outline_is_simplified_and_a_speck_has_none() -> None:
    """Scenarios: S-P06-BAD-CROP-COVERAGE"""
    grid = Grid(0.0, 0.0, 10.0, 256, 256)
    teeth = numpy.zeros((256, 256), bool)
    teeth[40:200, ::4] = True
    teeth[100:120, :] = True
    speck = numpy.zeros((256, 256), bool)
    speck[9, 9:12] = True

    assert len(outline(Reach(teeth, numpy.empty((0, 2)), grid))) <= OUTLINE_MAX_VERTICES
    assert outline(Reach(speck, numpy.empty((0, 2)), grid)) == []
