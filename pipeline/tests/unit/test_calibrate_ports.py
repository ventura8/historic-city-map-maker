"""The local matcher's port (M9 §3): a proposal is only a proposal, and it runs only after nothing else proved."""

from collections.abc import Sequence
from dataclasses import replace

import numpy
from hcm_pipeline.calibrate.chain import find_frame
from hcm_pipeline.calibrate.ports import NullProposalMatcher, Proposal, ProposalRequest
from hcm_pipeline.geo import Grid

from tests.fakes.world import PipelineWorld
from tests.unit.calibrate_scene import elsewhere, map_error_ground_m, nothing, run, scene_of, search_of


class Matcher:
    """A matcher that answers with given maps and counts its calls."""

    name = "test"

    def __init__(self, *matrices: numpy.ndarray) -> None:
        self.matrices = matrices
        self.calls = 0

    def propose(self, request: ProposalRequest) -> Sequence[Proposal]:
        self.calls += 1
        assert request.sensor == "KH-9-mapping"
        return [Proposal(matrix, 5) for matrix in self.matrices]


def test_happy_path_the_null_matcher_proposes_nothing_and_every_service_has_one(world: PipelineWorld) -> None:
    """Scenarios: S-P06-BAD-OFF-STRIP"""
    pixels = numpy.zeros((1, 1), numpy.uint8)
    request = ProposalRequest(pixels, 1.0, pixels, None, Grid(0.0, 0.0, 1.0, 1, 1), "KH-9-pan")

    assert NullProposalMatcher().propose(request) == ()
    assert world.services().proposal_matcher.name == "none"


def test_happy_path_the_matcher_is_not_called_after_a_proof() -> None:
    """Scenarios: S-P06-HAPPY-VOTES"""
    matcher = Matcher()

    found = run(scene_of(), matcher=matcher)

    assert found.proof is not None
    assert matcher.calls == 0


def test_happy_path_a_matchers_proposal_goes_through_the_same_proof() -> None:
    """Scenarios: S-P06-BAD-OFF-STRIP"""
    scene = scene_of()
    blank = numpy.full_like(scene.film, 128)
    # The votes read the shrunk preview; with it blank but the film true, only the matcher can start the tiles.
    matcher = Matcher(numpy.array([[1.0, 0.0, 300.0], [0.0, 1.0, -200.0], [0.0, 0.0, 1.0]]) @ scene.truth)
    search = search_of(scene, matcher=matcher)
    frame = replace(search.frame, pixels=blank[::3, ::3])

    found = find_frame(replace(search, frame=frame), nothing, list[str]().append)

    assert matcher.calls == 1
    assert found.how == "local-ai"
    assert found.proof is not None
    assert found.proof.accepted
    assert map_error_ground_m(scene, found) < 25.0


def test_bad_path_a_matchers_wrong_proposal_is_refused_like_any_other() -> None:
    """Scenarios: S-P06-BAD-OFF-STRIP"""
    scene = elsewhere(scene_of())
    matcher = Matcher(scene.truth)

    found = run(scene, matcher=matcher)

    assert matcher.calls == 1
    assert found.proof is None
    assert found.refused is not None
