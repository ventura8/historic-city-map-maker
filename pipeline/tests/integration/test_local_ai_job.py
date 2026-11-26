"""A frame only the local matcher finds, through the real runner and steps (M10): the same proof, over a wider reference; the crop stays
the city's; and the worker's half against a fake sidecar answering the box."""

import numpy
import pytest
from hcm_pipeline.calibrate import chain
from hcm_pipeline.runner import RunOutcome

from tests.contracts_loader import record
from tests.fakes.sidecar import TrueProposer, truth_matrix
from tests.fakes.world import PipelineWorld, small_city


def calibration(world: PipelineWorld) -> dict[str, object]:
    return record(world.version()["calibration"])


@pytest.fixture
def blind(world: PipelineWorld) -> PipelineWorld:
    world.seed_import()
    small_city(world)
    return world


def test_happy_path_a_small_city_is_proved_over_the_wider_reference_and_records_who_proposed(
    blind: PipelineWorld, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P07-HAPPY-SMALL-WINDOW, S-P07-BAD-MATCHER-FIGURES"""
    # This film is 10 km long: 4 % of a 30 km box, and that proof says `small` (the test below). A shorter side, not a softer gate.
    monkeypatch.setattr(chain, "MATCHER_PROOF_SIDE_GROUND_M", 20_000.0)
    proposer = TrueProposer(truth_matrix(blind.scene.truth))
    blind.matcher = proposer

    outcome = blind.run()

    found = calibration(blind)
    assert proposer.calls == 1
    # So few of the tiles lie in so small a crop that `georef`'s matcher fitted it: the record says so, and it does not publish itself.
    assert found["how"] == "matcher"
    assert record(found["proposer"]) == {
        "name": "aliked-lightglue",
        "device": "gpu",
        "deviceName": "NVIDIA RTX 3080",
        "seconds": 31.0,
        "support": 46,
    }
    assert record(found["votes"])["agreed"] != 46
    # The proof's figures describe another map, over more ground than the city (`how: matcher`): the log keeps them, the record does not.
    assert not {"tiles", "crossValidatedM", "measuredPct"} & set(found)
    assert outcome in (RunOutcome.DONE, RunOutcome.WAITING)
    # The crop stays the city's, whatever the proof looked at.
    scan = record(blind.version()["scan"])
    assert int(str(scan["width"])) < blind.scene.truth.width
    assert any(line.startswith("local AI (aliked-lightglue") for line in blind.log_lines())
    assert any(line.startswith("proved:") for line in blind.log_lines())


def test_bad_path_a_film_covering_too_little_of_the_wider_box_is_refused_by_the_same_gate(blind: PipelineWorld) -> None:
    """Scenarios: S-P07-BAD-FALSE-PROPOSAL"""
    blind.matcher = TrueProposer(truth_matrix(blind.scene.truth))

    blind.run()

    found = calibration(blind)
    assert (found["how"], found["refusal"]) == ("none", "small")
    assert "proposer" not in found


def test_bad_path_with_no_matcher_the_same_small_city_waits_for_points_and_cloud_run_says_why(blind: PipelineWorld) -> None:
    """Scenarios: S-P07-BAD-CLOUD-NO-AI"""
    blind.run()

    found = calibration(blind)
    assert found["how"] == "none"
    assert "proposer" not in found
    assert any("no local AI in Google Cloud" in line for line in blind.log_lines())
    # A frame nothing proved keeps its delivery, as ever (M9 §6).
    assert blind.gcs.names("usgs-raw/") != []


def test_bad_path_a_wrong_proposal_on_the_job_is_refused_and_waits_for_points(blind: PipelineWorld) -> None:
    """Scenarios: S-P07-BAD-FALSE-PROPOSAL"""
    moved = numpy.array([[1.0, 0.0, 9000.0], [0.0, 1.0, 7000.0], [0.0, 0.0, 1.0]]) @ truth_matrix(blind.scene.truth)
    blind.matcher = TrueProposer(moved)

    blind.run()

    found = calibration(blind)
    assert found["how"] == "none"
    assert "proposer" not in found
    assert any(line.startswith("not proved") for line in blind.log_lines())


def test_happy_path_a_proved_frame_with_tiles_in_its_crop_is_fitted_from_the_proof(
    world: PipelineWorld, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    monkeypatch.setattr(chain, "warp_votes", lambda *_args: None)
    world.seed_import()
    world.matcher = TrueProposer(truth_matrix(world.scene.truth))

    assert world.run() is RunOutcome.DONE

    found = calibration(world)
    assert found["how"] == "local-ai"
    assert record(world.version()["georef"])["method"] == "auto"
    assert "model" not in found
