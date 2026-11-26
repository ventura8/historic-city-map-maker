"""A proved frame's pairs and checkpoints (M9 §7)."""

import math
from pathlib import Path

import numpy
import pytest
from hcm_pipeline.calibrate import pairs
from hcm_pipeline.calibrate.pairs import ScanBox, blocked_figure, calibrated, choose, transform_of
from hcm_pipeline.calibrate.proof import PAIR_CELL_GROUND_M
from hcm_pipeline.calibrate.stored import StoredTiles
from hcm_pipeline.geo import ground_scale
from hcm_pipeline.georef.autogcp import AUTO_GCP_MIN_CONFIDENCE
from hcm_pipeline.georef.matcher import MAX_AUTO_GCPS

from tests.unit.test_calibrate_proof import rows_of

MIDDLE_LAT = 44.4
SCAN = ScanBox(100, 200, 60000, 60000)


def test_happy_path_pairs_are_one_a_cell_and_checks_are_set_aside_before_ransac() -> None:
    """Scenarios: S-P06-HAPPY-VOTES"""
    rows = rows_of(1200, 3.0)

    chosen = choose(rows, 2, MIDDLE_LAT, 7)

    assert chosen is not None
    assert 0 < len(chosen.pairs) <= MAX_AUTO_GCPS
    assert len(chosen.checks) > 0
    pair_places = {tuple(row[2:4]) for row in chosen.pairs.tolist()}
    assert not pair_places & {tuple(row[2:4]) for row in chosen.checks.tolist()}


def test_happy_path_the_fit_holds_pairs_and_held_out_checkpoints_of_the_scan() -> None:
    """Scenarios: S-P06-HAPPY-VOTES"""
    rows = rows_of(1200, 3.0)

    found = calibrated(rows, 2, SCAN, MIDDLE_LAT, 7)

    assert found is not None
    fitted = found.fitted
    enabled = [gcp for gcp in fitted.gcps if gcp.enabled]
    held = [gcp for gcp in fitted.gcps if not gcp.enabled]
    assert held
    assert fitted.checkpoint_kind == "held-out"
    assert fitted.checkpoint_count == len(held)
    assert all(gcp.origin == "auto" and (gcp.score or 0) >= AUTO_GCP_MIN_CONFIDENCE for gcp in fitted.gcps)
    assert fitted.transform.kind == "poly2"
    assert found.cross_validated_m is not None
    assert found.cross_validated_m < 10
    assert len({gcp.id for gcp in fitted.gcps}) == len(enabled) + len(held)
    assert all(gcp.x >= 0 and gcp.y >= 0 for gcp in fitted.gcps)


def test_bad_path_a_check_over_the_gross_limit_is_dropped_and_counted() -> None:
    """Scenarios: S-P06-BAD-OFF-STRIP"""
    rows = rows_of(1200, 3.0)
    rows[:, 4] = 0.4
    rows[:400, 2:4] += 400.0
    rows[:400, 4] = 0.95

    found = calibrated(rows, 2, SCAN, MIDDLE_LAT, 7)

    assert found is not None
    assert found.checks_dropped > 0


def test_bad_path_too_few_tiles_in_the_crop_give_no_fit() -> None:
    """Scenarios: S-P06-BAD-OFF-STRIP"""
    rows = rows_of(40)

    assert calibrated(rows, 2, ScanBox(100, 200, 10, 10), MIDDLE_LAT, 7) is None


def test_happy_path_an_affine_film_stays_affine_and_a_curved_one_earns_poly2() -> None:
    """Scenarios: S-P06-HAPPY-VOTES"""
    rows = rows_of(600, 2.0)
    flat = rows.copy()
    flat[:, 2] = 2.9e6 + 1.1 * flat[:, 0]
    flat[:, 3] = 5.5e6 - 1.1 * flat[:, 1]

    assert transform_of(flat[:, :6], MIDDLE_LAT)[0] == "affine"
    assert transform_of(rows, MIDDLE_LAT)[0] == "poly2"
    assert blocked_figure(rows[:3], 1, 2240.0) is None


def test_happy_path_a_retry_reads_the_tiles_back_whole(tmp_path: Path) -> None:
    """Scenarios: S-P06-HAPPY-VOTES"""
    rows = rows_of(30)

    back = StoredTiles.read(StoredTiles(rows, 2, 7, 9, MIDDLE_LAT).write(tmp_path / "calibration.json"))

    assert numpy.allclose(back.rows, rows, atol=1e-3)
    assert (back.order, back.left, back.top, back.middle_lat) == (2, 7, 9, MIDDLE_LAT)


def _regular_tiles(side: int) -> numpy.ndarray:
    """A clean grid of tiles 450 m apart on the ground at `MIDDLE_LAT`, as a frame clipping a corner of the window gives."""
    step = 450.0 / math.cos(math.radians(MIDDLE_LAT))
    u, v = numpy.meshgrid(numpy.arange(side) * step + 1000.0, numpy.arange(side) * step + 1000.0)
    film = numpy.column_stack((u.ravel(), v.ravel()))
    places = numpy.column_stack((2.9e6 + film[:, 0], 5.5e6 - film[:, 1]))
    places += numpy.random.default_rng(3).normal(0, 2.0, places.shape)
    return numpy.column_stack((film, places, numpy.full(len(film), 0.5), numpy.full(len(film), 0.1)))


@pytest.mark.parametrize("side", [8, 9, 10])
def test_bad_path_a_proved_frame_with_few_pairs_has_a_figure_a_document_can_hold(side: int) -> None:
    """Scenarios: S-P06-BAD-FEW-PAIRS-FIGURE"""
    found = calibrated(_regular_tiles(side), 2, ScanBox(0, 0, 60000, 60000), MIDDLE_LAT, 7)

    assert found is not None
    assert found.fitted.transform.kind == "affine"
    assert found.cross_validated_m is not None
    assert math.isfinite(found.cross_validated_m)


def test_bad_path_no_fold_to_hold_is_no_figure_never_an_infinite_one() -> None:
    """Scenarios: S-P06-BAD-FEW-PAIRS-FIGURE"""
    assert transform_of(_regular_tiles(2), MIDDLE_LAT) == ("affine", None)


def test_bad_path_tiles_spread_wider_than_every_doubling_keep_the_largest_cell() -> None:
    """Scenarios: S-P06-HAPPY-VOTES"""
    first = PAIR_CELL_GROUND_M / ground_scale(MIDDLE_LAT)
    largest = first * 2**pairs.PAIR_CELL_DOUBLINGS
    x, y = numpy.meshgrid(numpy.arange(15) * 2 * largest, numpy.arange(15) * 2 * largest)
    rows = numpy.column_stack((x.ravel(), y.ravel(), x.ravel(), y.ravel()))

    assert pairs._cell_size(rows, MIDDLE_LAT) == pytest.approx(largest)
