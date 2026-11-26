"""What the first real KH-7, KH-9 mapping and KH-5 frames showed (M9 §14), on synthetic frames and on the geometry they measured."""

import cv2
import numpy
import pytest
from hcm_pipeline.calibrate.chain import find_frame, hypotheses
from hcm_pipeline.calibrate.votes import VOTE_WARP_MIN_TILES, Hypothesis, sheared_about, tiles_per_warp
from hcm_pipeline.contract import SENSOR_SPECS, SearchRange
from hcm_pipeline.documents import Scene as SceneRecord
from hcm_pipeline.geo import FloatArray, to_lnglat, to_mercator
from hcm_pipeline.georef.corners import Frame, apply, plausible
from hcm_pipeline.images import as_uint8
from hcm_pipeline.steps.locate import frame_pixel_m

from tests.unit.calibrate_scene import FILM_SIZE, Scene, Shot, elsewhere, map_error_ground_m, nothing, scene_of, search_of

SHEARS = SearchRange(15_000.0, (1.0,), (0.0, 7.5, -7.5))
# The metadata of DZB00403000026H017001 (KH-7, 1966), its film's size, and where the proof put the film's corners, north-west first.
KH7_CORNERS = ((44.7, 25.915), (44.65, 26.25), (44.25, 26.132), (44.282, 25.8))
KH7_SIZE = (71642, 31770)
KH7_PROVED = ((44.8996, 25.9763), (44.8951, 26.3428), (44.4335, 26.2144), (44.4372, 25.8499))
# DS09065A089MC039 (KH-5, 1964): no corners, a footprint standing on one of its own corners.
KH5_FOOTPRINT = ((41.953, 24.846), (46.831, 30.064), (49.841, 24.135), (44.707, 19.175))
KH5_SIZE = (16330, 16350)


def _blurred(scene: Scene, sigma: float) -> Scene:
    film = numpy.asarray(cv2.GaussianBlur(scene.film.astype(numpy.float32), (0, 0), sigma), numpy.float32)
    return Scene(scene.reference, scene.grid, as_uint8(numpy.clip(film, 0, 255)), scene.truth, scene.quad)


def _footprint_record(places: tuple[tuple[float, float], ...]) -> dict[str, object]:
    return {"acquisitionDate": "1964-06-18", "footprint": [{"lat": lat, "lng": lng} for lat, lng in places]}


def test_happy_path_a_film_lying_as_a_parallelogram_is_found_under_its_shear_and_proved() -> None:
    """Scenarios: S-P06-HAPPY-SHEARED-STRIP"""
    scene = scene_of(Shot(shear_deg=9.0))
    lines: list[str] = []

    found = find_frame(search_of(scene, search=SHEARS), nothing, lines.append)

    assert found.proof is not None
    assert found.proof.accepted
    assert map_error_ground_m(scene, found) < 25.0
    assert any(line.startswith("tile votes:") and "shear 7.5" in line for line in lines)


def test_bad_path_more_shears_over_another_place_prove_nothing() -> None:
    """Scenarios: S-P06-BAD-SHEAR-FALSE"""
    found = find_frame(search_of(elsewhere(scene_of(Shot(shear_deg=9.0))), search=SHEARS), nothing, lambda _line: None)

    assert found.proof is None
    assert found.how == "none"


def test_happy_path_a_shear_keeps_the_long_side_and_the_window_centre_whatever_the_orientation() -> None:
    """Scenarios: S-P06-HAPPY-SHEARED-STRIP"""
    frame = Frame(numpy.zeros((1, 2), numpy.uint8), 1000.0, 2000, 1000)
    centre = (5000.0, 7000.0)
    turned = numpy.array([[0.0, 2.0, 0.0], [2.0, 0.0, 0.0], [0.0, 0.0, 1.0]])
    for matrix in (turned, numpy.array([[0.0, -2.0, 9000.0], [-2.0, 0.0, 9000.0], [0.0, 0.0, 1.0]])):
        sheared = sheared_about(matrix, frame, centre, 10.0)

        assert numpy.allclose(sheared[:2, 0], matrix[:2, 0])
        assert numpy.allclose(numpy.linalg.det(sheared[:2, :2]), numpy.linalg.det(matrix[:2, :2]))
    # The short side turns towards the long side's north end, on the ground, under both orientations alike.
    down = sheared_about(turned, frame, centre, 10.0)
    assert down[1, 1] > 0
    assert numpy.allclose(numpy.dot(down[:2, 1] - turned[:2, 1], [1.0, 0.0]), 0.0)


def test_happy_path_a_film_standing_upright_keeps_its_height_as_its_long_side() -> None:
    """Scenarios: S-P06-HAPPY-SHEARED-STRIP"""
    frame = Frame(numpy.zeros((2, 1), numpy.uint8), 1000.0, 1000, 2000)
    upright = numpy.array([[2.0, 0.0, 0.0], [0.0, -2.0, 0.0], [0.0, 0.0, 1.0]])

    assert numpy.allclose(sheared_about(upright, frame, (0.0, 0.0), 10.0)[:2, 1], upright[:2, 1])


def test_bad_path_a_strip_of_two_to_one_loses_its_quarter_turns() -> None:
    """Scenarios: S-P06-HAPPY-SHEARED-STRIP"""
    kept = {(each.rotation, each.mirrored) for each in plausible(*KH7_SIZE, KH7_CORNERS)}

    assert (3, False) in kept
    assert len(kept) == len(("along", "reversed", "mirrored", "both"))


def test_happy_path_the_kh7_search_reaches_where_the_real_frame_lay() -> None:
    """Scenarios: S-P06-HAPPY-SHEARED-STRIP"""
    search = SENSOR_SPECS["KH-7"].search
    true_x, true_y = numpy.array([to_mercator(lng, lat) for lat, lng in KH7_PROVED]).T
    meta_x, meta_y = numpy.array([to_mercator(lng, lat) for lat, lng in KH7_CORNERS]).T
    off_m = float(numpy.hypot(true_x.mean() - meta_x.mean(), true_y.mean() - meta_y.mean())) * 0.714

    assert off_m < search.margin_ground_m
    assert max(search.shears_deg) >= 7.5
    assert 1.1 in search.scales


def test_happy_path_a_panoramic_short_film_and_a_full_sweep_are_both_searched_the_models_scale_first() -> None:
    """Scenarios: S-P06-BAD-MANY-WARPS"""
    scene = scene_of()
    search = search_of(scene, search=SENSOR_SPECS["KH-9-pan"].search)
    warps: list[Hypothesis] = hypotheses(search)

    assert sorted(set(SENSOR_SPECS["KH-9-pan"].search.scales)) == [0.94, 1.0]
    orientations = len(search.orientations)
    assert [each.scale for each in warps] == [1.0] * orientations + [0.94] * orientations
    assert tiles_per_warp(2 * 4) == VOTE_WARP_MIN_TILES


def test_happy_path_a_frame_with_no_corners_stands_on_its_footprint_and_every_orientation_is_searched() -> None:
    """Scenarios: S-P06-HAPPY-FOOTPRINT-ONLY"""
    record = SceneRecord.of("DS09065A089MC039", _footprint_record(KH5_FOOTPRINT))

    assert record.corners is None
    assert record.corner_quad() == ((49.841, 24.135), (46.831, 30.064), (41.953, 24.846), (44.707, 19.175))
    assert len(plausible(*KH5_SIZE, record.corner_quad())) == len(("r0", "r1", "r2", "r3", "m0", "m1", "m2", "m3"))
    assert frame_pixel_m(record, KH5_SIZE) == pytest.approx(58.5, abs=0.5)


def test_happy_path_a_turned_film_found_through_the_footprints_extremes() -> None:
    """Scenarios: S-P06-HAPPY-FOOTPRINT-ONLY"""
    shot = Shot(rotation_deg=40.0, error_ground_m=(1500.0, -1000.0))
    scene = scene_of(shot)
    film = numpy.array([[0.0, FILM_SIZE[0], FILM_SIZE[0], 0.0], [0.0, 0.0, FILM_SIZE[1], FILM_SIZE[1]]])
    x, y = apply(scene.truth, film[0], film[1])
    quad = _lat_lng_ring(x, y)
    record = SceneRecord.of("DS09065A089MC039", _footprint_record(quad))
    moved = Scene(scene.reference, scene.grid, scene.film, scene.truth, record.corner_quad())

    found = find_frame(search_of(moved, search=SearchRange(15_000.0, (1.0,))), nothing, lambda _line: None)

    assert found.proof is not None
    assert found.proof.accepted
    assert map_error_ground_m(scene, found) < 25.0


def _lat_lng_ring(x: FloatArray, y: FloatArray) -> tuple[tuple[float, float], ...]:
    places = [to_lnglat(float(each_x), float(each_y)) for each_x, each_y in zip(x, y, strict=True)]
    return tuple((lat, lng) for lng, lat in places)


def test_bad_path_a_film_far_coarser_than_its_pixels_is_refused_never_proved() -> None:
    """Scenarios: S-P06-BAD-COARSE-FILM"""
    # KH-5 reads 140 m on the ground; this film's pixel is 9 m, so a blur of about 14 pixels leaves what Argon holds.
    scene = _blurred(scene_of(), 14.0)

    found = find_frame(search_of(scene), nothing, lambda _line: None)

    assert found.proof is None
    assert found.how == "none"


def test_happy_path_argon_is_a_camera_of_its_own_on_the_declass_1_dataset() -> None:
    """Scenarios: S-P06-BAD-COARSE-FILM"""
    spec = SENSOR_SPECS["KH-5"]

    assert (spec.dataset, spec.resolution_m, spec.half_angle_deg) == ("corona2", 140, None)
    assert spec.as_contract()["name"] == "KH-5 Argon"
