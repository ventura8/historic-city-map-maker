"""Terrain: a KH-9 panoramic frame over relief is fitted on flat places and goes back to the ground (M15-calibration-accuracy.md,
*Terrain*)."""

import math

import numpy
import pytest
from hcm_pipeline.calibrate import terrain as terrain_module
from hcm_pipeline.calibrate.camera import Frame, fit_panoramic
from hcm_pipeline.calibrate.joining import Proved, joined_calibration
from hcm_pipeline.calibrate.pairs import ScanBox
from hcm_pipeline.calibrate.terrain import Heights, OnGround, parallax_at, terrain_of
from hcm_pipeline.geo import FloatArray, to_lnglat_arrays, to_mercator_arrays
from hcm_pipeline.steps.georef import automatic
from hcm_pipeline.steps.relief import terrain_summary

from tests.unit.test_calibrate_camera import MIDDLE_LAT, RAD_PER_PX, SCAN, TRUE_ANGLES

SCALE = math.cos(math.radians(MIDDLE_LAT))
CENTRE = numpy.array([2.9e6, 5.5e6])
# The synthetic camera's linear map from normalised rays to EPSG:3857 (as `panoramic_rows`).
LINEAR = numpy.array([[18000.0, -600.0], [600.0, 10000.0]])
HILL_M = 80.0
HILL_SIGMA_M = 4000.0


def hill(peak_m: float = HILL_M) -> Heights:
    """A hill of `peak_m` over a 60 km square around the frame, 100 m cells, on ground at 70 m."""
    side, cell = 600, 100.0
    left, top = CENTRE[0] - side * cell / 2, CENTRE[1] + side * cell / 2
    x = left + (numpy.arange(side) + 0.5) * cell
    y = top - (numpy.arange(side) + 0.5) * cell
    xx, yy = numpy.meshgrid(x - CENTRE[0] - 3000.0, y - CENTRE[1] + 2000.0)
    values = 70.0 + peak_m * numpy.exp(-(xx**2 + yy**2) * SCALE**2 / (2 * HILL_SIGMA_M**2))
    return Heights(left, top, cell, numpy.asarray(values, numpy.float32))


class Truth:
    """A panoramic camera at `TRUE_ANGLES` (its flat map) and the parallax its geometry gives, over a surface."""

    def __init__(self, film: FloatArray) -> None:
        self.frame = Frame.of(film, RAD_PER_PX)
        rays = self.frame.rays(film, TRUE_ANGLES)
        self.mean, self.std = rays.mean(axis=0), rays.std(axis=0)

    def flat(self, film: FloatArray) -> FloatArray:
        rays = (self.frame.rays(film, TRUE_ANGLES) - self.mean) / self.std
        return numpy.asarray(CENTRE + rays @ LINEAR, numpy.float64)

    def tan(self, film: FloatArray) -> FloatArray:
        linear = LINEAR / self.std[:, None]
        return numpy.asarray(self.frame.rays(film, TRUE_ANGLES) @ linear / math.sqrt(abs(numpy.linalg.det(linear))), numpy.float64)

    def ground(self, film: FloatArray, heights: Heights, shown: float = 1.0) -> FloatArray:
        """Where each film pixel's feature truly lies: its flat place less the parallax of its height (`shown` of it)."""
        flat, tan = self.flat(film), shown * self.tan(film)
        places = flat
        for _ in range(8):
            places = flat - ((heights.at(places) - 70.0) / SCALE)[:, None] * tan
        return places


def film_points(count: int, seed: int) -> FloatArray:
    rng = numpy.random.default_rng(seed)
    return numpy.column_stack((rng.uniform(1000, 41000, count), rng.uniform(0, 23000, count)))


def rows_over(heights: Heights, count: int = 1500, noise_m: float = 2.0, seed: int = 3, shown: float = 1.0) -> tuple[FloatArray, Truth]:
    film = film_points(count, seed)
    truth = Truth(film)
    places = truth.ground(film, heights, shown) + numpy.random.default_rng(seed + 1).normal(0, noise_m / SCALE, (count, 2))
    return numpy.column_stack((film, places, numpy.full(count, 0.5), numpy.full(count, 0.1))), truth


def ground_m(a: FloatArray, b: FloatArray) -> FloatArray:
    return numpy.asarray(numpy.hypot(*(a - b).T) * SCALE, numpy.float64)


def test_happy_path_heights_are_bilinear_between_cell_centres_and_level_beyond_the_grid() -> None:
    """Scenarios: S-P06-HAPPY-TERRAIN"""
    heights = Heights(0.0, 20.0, 10.0, numpy.array([[0.0, 10.0], [20.0, 30.0]], numpy.float32))

    found = heights.at(numpy.array([[5.0, 15.0], [10.0, 10.0], [15.0, 5.0], [-100.0, 100.0], [100.0, -100.0]]))

    assert found.tolist() == pytest.approx([0.0, 15.0, 30.0, 0.0, 30.0])


def test_happy_path_the_camera_reads_the_parallax_its_geometry_gives() -> None:
    """Scenarios: S-P06-HAPPY-TERRAIN"""
    film = film_points(1500, 5)
    truth = Truth(film)

    camera = fit_panoramic(film, truth.flat(film), RAD_PER_PX)

    assert camera is not None
    tan = parallax_at(camera, film)
    assert float(numpy.median(numpy.hypot(*tan.T))) == pytest.approx(float(numpy.median(numpy.hypot(*truth.tan(film).T))), rel=0.05)
    assert float(numpy.abs(tan - truth.tan(film)).max()) < 0.05


def test_happy_path_a_frame_over_a_hill_is_fitted_on_flat_places_and_lands_on_the_ground() -> None:
    """Scenarios: S-P06-HAPPY-TERRAIN"""
    heights = hill()
    rows, truth = rows_over(heights)
    flat = joined_calibration(Proved(rows, 2, SCAN, MIDDLE_LAT), 7)

    found = joined_calibration(Proved(rows, 2, SCAN, MIDDLE_LAT, heights), 7)

    assert found is not None
    assert flat is not None
    assert found.terrain is not None
    assert found.terrain.relief_m > 3.0
    assert found.lattice is not None
    assert found.lattice.model == "panoramic"
    figure, before = found.fitted.checkpoint_rmse_m, flat.fitted.checkpoint_rmse_m
    assert figure is not None
    assert before is not None
    assert figure < 4.0 < before
    film = film_points(400, 11)
    places = truth.ground(film, heights)
    lng, lat = to_lnglat_arrays(places[:, 0], places[:, 1])
    pixels = found.terrain.rpc.to_pixel(lng, lat, heights.at(places))
    scan = film - numpy.array([SCAN.left, SCAN.top])
    # The RPC with the surface puts each true place on its film pixel within a tile's noise (1.3 m a pixel).
    assert float(numpy.sqrt(numpy.mean(numpy.sum((pixels - scan) ** 2, axis=1)))) * 1.3 < 3.0


def test_happy_path_the_lattice_of_a_frame_over_terrain_lies_on_the_map_its_rpc_renders() -> None:
    """Scenarios: S-P06-HAPPY-TERRAIN"""
    heights = hill()
    rows, truth = rows_over(heights)

    found = joined_calibration(Proved(rows, 2, SCAN, MIDDLE_LAT, heights), 7)

    assert found is not None
    assert found.lattice is not None
    assert found.terrain is not None
    nodes = found.lattice.nodes
    lng, lat = numpy.array([node.lng for node in nodes]), numpy.array([node.lat for node in nodes])
    shown = numpy.column_stack(to_mercator_arrays(lng, lat))
    pixels = numpy.array([[node.x, node.y] for node in nodes])
    # Each node is where the layer puts its pixel: the RPC over the heights there reads that pixel back (1.3 m a pixel); the flat map's
    # nodes lay up to the hill's parallax away.
    back = found.terrain.rpc.to_pixel(lng, lat, heights.at(shown))
    assert float(numpy.abs(back - pixels).max()) * 1.3 < 1.0
    film = pixels + numpy.array([SCAN.left, SCAN.top])
    assert float(numpy.median(ground_m(shown, truth.ground(film, heights)))) < 4.0


def test_happy_path_a_frame_over_terrain_carries_the_heights_under_its_scan() -> None:
    """Scenarios: S-P06-HAPPY-TERRAIN"""
    heights = hill()
    rows, _ = rows_over(heights)

    found = joined_calibration(Proved(rows, 2, SCAN, MIDDLE_LAT, heights), 7)

    assert found is not None
    assert found.terrain is not None
    under = found.terrain.heights
    assert under.values.size < heights.values.size
    # Wherever the scan shows ground they read what the city's surface reads.
    lattice = found.lattice
    assert lattice is not None
    places = numpy.column_stack(
        to_mercator_arrays(numpy.array([n.lng for n in lattice.nodes]), numpy.array([n.lat for n in lattice.nodes]))
    )
    assert numpy.allclose(under.at(places), heights.at(places), rtol=0.0, atol=1e-6)
    record = automatic(found).as_record()["terrain"]
    assert isinstance(record, dict)
    assert record["heights"]["columns"] == under.values.shape[1]


def test_happy_path_the_cells_under_some_places_read_as_the_whole_grid_there() -> None:
    """Scenarios: S-P06-HAPPY-TERRAIN"""
    heights = hill()
    places = numpy.array([[CENTRE[0] - 2000.0, CENTRE[1] + 1500.0], [CENTRE[0] + 3100.0, CENTRE[1] - 900.0]])

    under = heights.covering(places)

    inside = places[0] + numpy.random.default_rng(1).uniform(0.0, 1.0, (200, 2)) * (places[1] - places[0])
    assert numpy.allclose(under.at(inside), heights.at(inside), rtol=0.0, atol=1e-6)
    assert under.values.shape == (26, 53)
    corner = heights.covering(numpy.array([[-1e9, 1e9]]))
    assert corner.values.shape == (2, 2)
    assert (corner.left, corner.top) == (heights.left, heights.top)


def test_bad_path_a_flat_city_is_fitted_exactly_as_without_a_surface() -> None:
    """Scenarios: S-P06-BAD-TERRAIN-NEGLIGIBLE"""
    level = Heights(CENTRE[0] - 30000, CENTRE[1] + 30000, 100.0, numpy.full((600, 600), 70.0, numpy.float32))
    rows, _ = rows_over(level)

    found = joined_calibration(Proved(rows, 2, SCAN, MIDDLE_LAT, level), 7)
    flat = joined_calibration(Proved(rows, 2, SCAN, MIDDLE_LAT), 7)

    assert found is not None
    assert flat is not None
    assert found.terrain is None
    assert automatic(found).as_record() == automatic(flat).as_record()


def test_bad_path_relief_under_a_metre_beyond_a_second_order_fit_is_negligible() -> None:
    """Scenarios: S-P06-BAD-TERRAIN-NEGLIGIBLE"""
    gentle = hill(1.0)
    rows, _ = rows_over(gentle)
    camera = fit_panoramic(rows[:, :2], rows[:, 2:4], RAD_PER_PX)
    assert camera is not None

    assert terrain_of(camera, rows[:, :2], rows[:, 2:4], gentle) is None
    steep, _ = rows_over(hill())
    over = fit_panoramic(steep[:, :2], steep[:, 2:4], RAD_PER_PX)
    assert over is not None
    found = terrain_of(over, steep[:, :2], steep[:, 2:4], hill())
    assert found is not None
    assert found.relief_m(steep[:, :2], steep[:, 2:4]) >= terrain_module.RELIEF_MIN_M


def test_bad_path_a_frame_without_a_camera_or_whose_camera_fails_is_fitted_flat() -> None:
    """Scenarios: S-P06-BAD-TERRAIN-NEGLIGIBLE"""
    heights = hill()
    rows, _ = rows_over(heights)
    plain = ScanBox(SCAN.left, SCAN.top, SCAN.width, SCAN.height)
    wrong = ScanBox(SCAN.left, SCAN.top, SCAN.width, SCAN.height, 2e-3)

    for box in (plain, wrong):
        found = joined_calibration(Proved(rows, 2, box, MIDDLE_LAT, heights), 7)
        assert found is not None
        assert found.terrain is None


def test_happy_path_flat_and_ground_undo_each_other() -> None:
    """Scenarios: S-P06-HAPPY-TERRAIN"""
    heights = hill()
    rows, _ = rows_over(heights)
    camera = fit_panoramic(rows[:, :2], rows[:, 2:4], RAD_PER_PX)
    assert camera is not None
    found = terrain_of(camera, rows[:, :2], rows[:, 2:4], heights)
    assert found is not None
    places = rows[:300, 2:4]

    assert float(ground_m(found.ground(found.flat(places)), places).max()) < 0.01
    at_level = found.ground(found.flat(places), found.reference_m)
    assert float(ground_m(at_level, found.flat(places)).max()) == pytest.approx(0.0, abs=1e-6)
    mapped = OnGround(camera.to_places, found)
    assert mapped(rows[:5, :2]).shape == (5, 2)


def test_happy_path_the_job_log_says_whether_a_frame_was_fitted_over_terrain() -> None:
    """Scenarios: S-P06-HAPPY-TERRAIN, S-P06-BAD-TERRAIN-NEGLIGIBLE"""
    heights = hill()
    rows, _ = rows_over(heights)
    over, plain = Proved(rows, 2, SCAN, MIDDLE_LAT, heights), Proved(rows, 2, SCAN, MIDDLE_LAT)
    found, flat = joined_calibration(over, 7), joined_calibration(plain, 7)
    assert found is not None
    assert flat is not None

    assert "fitted over the terrain (Copernicus DEM GLO-30)" in terrain_summary(found, over)
    assert "no surface model" in terrain_summary(flat, plain)
    assert "negligible" in terrain_summary(flat, over)


def test_bad_path_a_frame_whose_tiles_show_no_parallax_is_not_corrected() -> None:
    """Scenarios: S-P06-BAD-TERRAIN-NEGLIGIBLE"""
    heights = hill()
    rows, _ = rows_over(heights, shown=0.0)
    camera = fit_panoramic(rows[:, :2], rows[:, 2:4], RAD_PER_PX)
    assert camera is not None

    # Scaled to nothing, the relief it would correct is none: no terrain, no credit, no RPC render.
    assert terrain_of(camera, rows[:, :2], rows[:, 2:4], heights) is None
    found = joined_calibration(Proved(rows, 2, SCAN, MIDDLE_LAT, heights), 7)
    flat = joined_calibration(Proved(rows, 2, SCAN, MIDDLE_LAT), 7)
    assert found is not None
    assert flat is not None
    assert automatic(found).as_record() == automatic(flat).as_record()


@pytest.mark.parametrize("shown", [0.5])
def test_bad_path_a_frame_whose_tiles_show_less_parallax_than_its_camera_predicts_is_corrected_by_that_much(shown: float) -> None:
    """Scenarios: S-P06-BAD-TERRAIN-NEGLIGIBLE"""
    heights = hill()
    rows, truth = rows_over(heights, shown=shown)
    camera = fit_panoramic(rows[:, :2], rows[:, 2:4], RAD_PER_PX)
    assert camera is not None

    found = terrain_of(camera, rows[:, :2], rows[:, 2:4], heights)

    assert found is not None
    places = rows[:, 2:4]
    tan = numpy.median(numpy.hypot(*found.tan(places).T))
    assert tan == pytest.approx(shown * float(numpy.median(numpy.hypot(*truth.tan(rows[:, :2]).T))), abs=0.08)
