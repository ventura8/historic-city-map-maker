"""A frame joined to frames held still (docs/research/M15-calibration-accuracy.md, *Joint solve*)."""

import math

import numpy
import pytest
from hcm_pipeline.calibrate.joining import Proved, joined_calibration
from hcm_pipeline.calibrate.joint import (
    DISAGREE_M,
    DISAGREES,
    FEW,
    MIN_TIES,
    TIE_WEIGHT,
    USED,
    PartnerTies,
    PlaceFn,
    Rows,
    Verdict,
    counts,
    joined,
    offset_m,
)
from hcm_pipeline.calibrate.pairs import ScanBox, calibrated
from hcm_pipeline.calibrate.poly import ground_errors
from hcm_pipeline.calibrate.together import Restricted, blocked_figure_of, camera_fit, free_of, kept_tiles, polynomial_fit
from hcm_pipeline.geo import FloatArray

from tests.unit.test_calibrate_camera import RAD_PER_PX, SCAN, panoramic_rows

MIDDLE_LAT = 44.4
SCALE = math.cos(math.radians(MIDDLE_LAT))
FILM = (0.0, 0.0, 30000.0, 20000.0)


def truth(film: FloatArray) -> FloatArray:
    """A frame's true map: 1.2 m a pixel, a gentle curve along the scan."""
    x, y = film[:, 0] / 1000.0, film[:, 1] / 1000.0
    east = 2.9e6 + 1.2 / SCALE * film[:, 0] + 3.0 / SCALE * (x - 15.0) ** 2 + 0.4 / SCALE * (x - 15) ** 3 / 15
    north = 5.54e6 - 1.2 / SCALE * film[:, 1] + 2.0 / SCALE * x * y / 10
    return numpy.column_stack((east, north))


def film_points(count: int, seed: int, box: tuple[float, float, float, float] = FILM) -> FloatArray:
    rng = numpy.random.default_rng(seed)
    return numpy.column_stack((rng.uniform(box[0], box[2], count), rng.uniform(box[1], box[3], count)))


def noisy(film: FloatArray, noise_m: float, seed: int) -> FloatArray:
    return truth(film) + numpy.random.default_rng(seed).normal(0, noise_m / SCALE, (len(film), 2))


def tile_rows(film: FloatArray, places: FloatArray) -> FloatArray:
    return numpy.column_stack((film, places, numpy.full(len(film), 0.5), numpy.full(len(film), 0.1)))


def partner(name: str, count: int, seed: int, shift_m: float = 0.0, tried: int | None = None) -> PartnerTies:
    film = film_points(count, seed)
    places = noisy(film, 2.0, seed + 1) + numpy.array([shift_m / SCALE, 0.0])
    return PartnerTies(name, film, places, count * 2 if tried is None else tried)


def rms_from_truth(to_places: PlaceFn, film: FloatArray) -> float:
    errors = ground_errors(to_places(film), truth(film))
    return float(numpy.sqrt(numpy.mean(errors**2)))


def test_happy_path_ties_held_still_bring_a_noisy_frame_closer_to_its_place() -> None:
    """Scenarios: S-P06-HAPPY-JOINT-HELD-STILL"""
    film = film_points(300, 1, (0.0, 0.0, 30000.0, 20000.0))
    own = Rows.tiles(film, noisy(film, 10.0, 2))
    partners = [partner("a", 800, 3), partner("b", 800, 5)]
    check = film_points(500, 9)

    alone = own.fitted(polynomial_fit())
    found = joined(polynomial_fit(), own, partners)

    assert alone is not None
    assert found is not None
    assert [verdict.status for verdict in found.verdicts] == [USED, USED]
    assert found.used == ("a", "b")
    assert rms_from_truth(found.to_places, check) < 0.6 * rms_from_truth(alone, check)
    assert all(verdict.offset_m is not None and verdict.offset_m < 2.0 for verdict in found.verdicts)


def test_happy_path_a_frame_with_tiles_on_half_its_film_is_carried_by_ties_on_the_other() -> None:
    """Scenarios: S-P06-HAPPY-JOINT-THIN-FRAME"""
    film = film_points(200, 1, (0.0, 0.0, 15000.0, 20000.0))
    own = Rows.tiles(film, noisy(film, 8.0, 2))
    far = film_points(400, 11, (15000.0, 0.0, 30000.0, 20000.0))

    alone = own.fitted(polynomial_fit())
    found = joined(polynomial_fit(), own, [partner("a", 900, 3)])

    assert alone is not None
    assert found is not None
    assert rms_from_truth(found.to_places, far) < 5.0
    assert rms_from_truth(found.to_places, far) < 0.5 * rms_from_truth(alone, far)


def test_bad_path_a_partner_published_wrong_is_left_out_and_named() -> None:
    """Scenarios: S-P06-BAD-JOINT-PARTNER-DISAGREES"""
    film = film_points(300, 1)
    own = Rows.tiles(film, noisy(film, 8.0, 2))
    partners = [partner("good", 800, 3), partner("wrong", 800, 5, shift_m=20.0), partner("other", 800, 7)]
    check = film_points(500, 9)

    found = joined(polynomial_fit(), own, partners)

    assert found is not None
    wrong = found.verdicts[1]
    assert wrong.status == DISAGREES
    assert wrong.offset_m is not None
    assert wrong.offset_m > DISAGREE_M
    assert wrong.offset_m == pytest.approx(20.0, abs=3.0)
    assert found.used == ("good", "other")
    assert rms_from_truth(found.to_places, check) < 3.0


def test_bad_path_a_partner_with_few_or_scattered_ties_does_not_count() -> None:
    """Scenarios: S-P06-BAD-JOINT-FEW-TIES"""
    film = film_points(300, 1)
    own = Rows.tiles(film, noisy(film, 8.0, 2))
    few = partner("few", MIN_TIES - 1, 3)
    scattered = partner("scattered", 400, 5, tried=4000)

    found = joined(polynomial_fit(), own, [few, scattered])

    assert not counts(few)
    assert not counts(scattered)
    assert found is not None
    assert [(verdict.partner, verdict.status) for verdict in found.verdicts] == [("few", FEW), ("scattered", FEW)]
    assert found.used == ()


def test_bad_path_nothing_joins_when_the_model_cannot_fit() -> None:
    """Scenarios: S-P06-BAD-JOINT-FEW-TIES"""
    film = film_points(5, 1)
    own = Rows.tiles(film, noisy(film, 8.0, 2))

    assert joined(polynomial_fit(), own, [partner("a", 5, 3, tried=5)]) is None


def test_happy_path_a_verdict_records_itself_and_an_offset_is_the_median_shift() -> None:
    """Scenarios: S-P06-HAPPY-JOINT-HELD-STILL"""
    ties = partner("a", 300, 3, shift_m=4.0)
    assert offset_m(truth, ties) == pytest.approx(4.0, abs=0.5)
    assert ties.share == pytest.approx(0.5)
    assert PartnerTies("none", numpy.empty((0, 2)), numpy.empty((0, 2)), 0).share == 0.0
    assert Verdict("a", 10, 20, FEW).as_record() == {"versionId": "a", "ties": 10, "tried": 20, "status": FEW}
    assert Verdict("a", 10, 20, USED, 1.234).as_record()["offsetM"] == 1.23
    rows = Rows.tiles(film_points(3, 1), truth(film_points(3, 1))).plus([ties])
    assert rows.weights.tolist() == [1.0] * 3 + [TIE_WEIGHT] * 300


def test_happy_path_a_restricted_polynomial_is_itself_inside_and_grows_by_the_lower_order_beyond() -> None:
    """Scenarios: S-P06-HAPPY-JOINT-RESTRICTED"""
    film = film_points(600, 1, (5000.0, 5000.0, 25000.0, 15000.0))
    fitted = polynomial_fit()(film, truth(film), numpy.ones(len(film)))
    cubic = polynomial_fit(3, 3)(film, truth(film), numpy.ones(len(film)))
    assert isinstance(fitted, Restricted)
    inside = film_points(50, 2, (6000.0, 6000.0, 24000.0, 14000.0))
    assert numpy.allclose(fitted(inside), fitted.inner(inside))
    beyond = numpy.array([[30000.0, 20000.0], [0.0, 0.0], [30000.0, 0.0]])
    edge = numpy.clip(beyond, fitted.low, fitted.high)
    assert numpy.allclose(fitted(beyond) - fitted(edge), fitted.outer(beyond) - fitted.outer(edge))
    assert cubic is not None
    assert polynomial_fit()(film[:5], truth(film[:5]), numpy.ones(5)) is None


def test_happy_path_a_panoramic_frame_joins_with_its_camera_and_records_each_partner() -> None:
    """Scenarios: S-P06-HAPPY-JOINT-HELD-STILL"""
    rows = panoramic_rows(900, noise_m=6.0)
    truth_rows = panoramic_rows(900, noise_m=0.0)
    ties = PartnerTies("held", truth_rows[::2, :2], truth_rows[::2, 2:4], 600)

    alone = calibrated(rows, 2, SCAN, 44.4, 5)
    found = joined_calibration(Proved(rows, 2, SCAN, 44.4), 5, [ties])

    assert alone is not None
    assert found is not None
    assert found.lattice is not None
    assert found.lattice.model == "panoramic"
    assert [verdict.status for verdict in found.alignment] == [USED]
    assert alone.alignment == ()
    assert found.cross_validated_m is not None


def test_happy_path_a_frame_without_a_camera_joins_through_a_restricted_polynomial() -> None:
    """Scenarios: S-P06-HAPPY-JOINT-RESTRICTED"""
    film = film_points(700, 1, (1000.0, 0.0, 31000.0, 20000.0))
    rows = tile_rows(film, noisy(film, 6.0, 2))
    held = partner("held", 900, 3)
    box = ScanBox(1000, 0, 30000, 20000)

    film = held.film + numpy.array([1000.0, 0.0])
    found = joined_calibration(Proved(rows, 2, box, MIDDLE_LAT), 5, [PartnerTies("held", film, truth(film), 1800)])

    assert found is not None
    assert found.lattice is not None
    assert found.lattice.model == "polynomial"
    assert found.alignment[0].status == USED


def test_bad_path_ties_in_the_checkpoints_cells_or_outside_the_scan_never_count() -> None:
    """Scenarios: S-P06-BAD-JOINT-FEW-TIES"""
    ties = PartnerTies("held", numpy.array([[10.0, 10.0], [50000.0, 10.0]]), numpy.array([[0.0, 0.0], [5000.0, 0.0]]), 4)
    kept = free_of([ties], numpy.array([0], numpy.int64), 1000.0)
    assert len(kept[0].film) == 1
    rows = panoramic_rows(900)
    found = joined_calibration(Proved(rows, 2, SCAN, 44.4), 5, [PartnerTies("far", numpy.full((200, 2), -5.0e5), rows[:200, 2:4], 300)])
    assert found is not None
    assert found.lattice is not None
    assert [(verdict.partner, verdict.ties, verdict.status) for verdict in found.alignment] == [("far", 0, FEW)]


def test_happy_path_the_joined_figure_and_the_kept_tiles_read_the_model() -> None:
    """Scenarios: S-P06-HAPPY-JOINT-HELD-STILL"""
    rows = panoramic_rows(900)
    camera = camera_fit(RAD_PER_PX)(rows[:, :2], rows[:, 2:4], numpy.ones(len(rows)))
    assert camera is not None
    assert kept_tiles(camera, rows) >= 0.95 * len(rows)
    pairs = rows[::9]
    figure = blocked_figure_of(camera_fit(RAD_PER_PX), Rows.tiles(rows[:, :2], rows[:, 2:4]), pairs, 3200.0 / SCALE)
    assert figure is not None
    assert figure < 5.0
    assert blocked_figure_of(camera_fit(RAD_PER_PX), Rows.tiles(rows[:10, :2], rows[:10, 2:4]), pairs, 3200.0 / SCALE) is None
