"""The pass's prior (M9 §2): a neighbour's model as the first place to look, never more."""

import numpy
import pytest
from hcm_pipeline.calibrate.chain import hypotheses
from hcm_pipeline.calibrate.prior import MeasuredModel, measured_model, pass_key
from hcm_pipeline.georef.panoramic import PanoramicCamera

from tests.unit.calibrate_scene import map_error_ground_m, run, scene_of, search_of


def test_happy_path_the_pass_key_is_mission_camera_and_date() -> None:
    """Scenarios: S-P06-HAPPY-PASS-PRIOR"""
    assert pass_key("D3C1203-300415F006", "1975-08-20") == "D3C1203-300415-F-1975-08-20"
    assert pass_key("d3c1203", "1975-08-20") is None


def test_happy_path_a_record_round_trips_and_a_foreign_one_is_none() -> None:
    """Scenarios: S-P06-BAD-PASS-PRIOR-WRONG"""
    model = MeasuredModel("corners", 2, True, 0.94, -0.5, 100.0, -200.0)

    assert MeasuredModel.of(model.as_record()) == model
    assert MeasuredModel.of(None) is None
    assert MeasuredModel.of({"camera": "corners"}) is None
    assert MeasuredModel.of({**model.as_record(), "scale": "much"}) is None


def test_happy_path_the_prior_warps_first_and_a_strong_one_is_all_it_takes() -> None:
    """Scenarios: S-P06-HAPPY-PASS-PRIOR"""
    scene = scene_of()
    plain = run(scene)
    assert plain.model is not None

    search = search_of(scene, plain.model)
    warps = hypotheses(search)
    found = run(scene, prior=plain.model)

    assert warps[0].from_pass
    assert warps[1].margin_m > warps[0].margin_m
    assert found.how == "pass"
    assert found.proof is not None
    assert found.proof.accepted
    assert map_error_ground_m(scene, found) < 25.0
    assert len(found.tried) == 1


def test_bad_path_a_wrong_prior_falls_through_to_the_full_search() -> None:
    """Scenarios: S-P06-BAD-PASS-PRIOR-WRONG"""
    scene = scene_of()
    plain = run(scene)
    assert plain.model is not None
    wrong = MeasuredModel(plain.model.camera, plain.model.rotation, plain.model.mirrored, 1.0, 0.0, 60_000.0, 60_000.0)

    found = run(scene, prior=wrong)

    assert found.how == "votes"
    assert found.proof is not None
    assert found.proof.accepted
    assert map_error_ground_m(scene, found) < 25.0


def test_happy_path_a_prior_of_another_orientation_or_camera_is_not_used() -> None:
    """Scenarios: S-P06-BAD-PASS-PRIOR-WRONG"""
    search = search_of(scene_of())
    first = search.orientations[0]
    other = MeasuredModel("corners", first.rotation, not first.mirrored, 1.0, 0.0, 0.0, 0.0)
    same = MeasuredModel("corners", first.rotation, first.mirrored, 1.0, 0.0, 0.0, 0.0)

    assert same.fits(first, None)
    assert not same.fits(first, PanoramicCamera(60.5, 100))
    assert not other.fits(first, None)


def test_happy_path_a_measured_model_comes_back_as_the_same_matrix() -> None:
    """Scenarios: S-P06-HAPPY-PASS-PRIOR"""
    search = search_of(scene_of())
    first, window = search.orientations[0], search.window
    cx, cy = (window.left + window.right) / 2, (window.bottom + window.top) / 2
    angle = numpy.radians(0.7)
    move = numpy.eye(3)
    move[:2, :2] = 0.93 * numpy.array([[numpy.cos(angle), -numpy.sin(angle)], [numpy.sin(angle), numpy.cos(angle)]])
    move[:2, 2] = numpy.array([cx + 1000.0, cy - 2000.0]) - move[:2, :2] @ numpy.array([cx, cy])

    model = measured_model(first, move @ first.matrix, window, None)

    assert model.scale == pytest.approx(0.93)
    assert model.rotation_deg == pytest.approx(0.7)
    assert (model.dx_m, model.dy_m) == pytest.approx((1000.0, -2000.0))
    assert numpy.allclose(model.matrix_on(first, window), move @ first.matrix)
