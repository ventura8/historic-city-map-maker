"""A matcher's proposal in the chain (M10): the proof alone decides, over at least 30 km, and an AI's count reaches no gate."""

from collections.abc import Sequence
from dataclasses import replace
from typing import Final

import numpy
import pytest
from hcm_pipeline.calibrate import chain
from hcm_pipeline.calibrate.chain import MATCHER_PROOF_SIDE_GROUND_M, FrameSearch, find_frame, wider_box
from hcm_pipeline.calibrate.dense import dense_grid
from hcm_pipeline.calibrate.ports import NO_LOCAL_AI, NullProposalMatcher, Proposal, ProposalRequest, Proposer
from hcm_pipeline.calibrate.reach import measured_pct
from hcm_pipeline.calibrate.votes import scaled_about
from hcm_pipeline.geo import FloatArray, Grid, MercatorBox, ground_scale

from tests.unit.calibrate_scene import Scene, elsewhere, map_error_ground_m, nothing, scene_of, search_of

# `AUTO_MIN_MEASURED_PCT` of @hcm/shared, the bar a frame must reach to publish itself.
AUTO_MIN_MEASURED_PCT: Final = 70.0
ON_GPU: Final = Proposer("aliked-lightglue", "gpu", 31.0, 100_000, "NVIDIA RTX 3080")


class Matcher:
    """Answers with given maps, each with a huge support: support must reach nothing."""

    name = "test"

    def __init__(self, *matrices: FloatArray) -> None:
        self.matrices = matrices
        self.requests: list[ProposalRequest] = []

    def propose(self, request: ProposalRequest) -> Sequence[Proposal]:
        self.requests.append(request)
        return [Proposal(matrix, 100_000, ON_GPU) for matrix in self.matrices]


def votes_blind(scene: Scene, matcher: Matcher) -> FrameSearch:
    """The film is true, the preview the votes read is blank: only the matcher can start the tiles."""
    search = search_of(scene, matcher=matcher)
    return replace(search, frame=replace(search.frame, pixels=numpy.full_like(scene.film, 128)[::3, ::3]))


def small_window(scene: Scene, side: int = 380) -> Scene:
    """Only the middle of the window: too little ground for the proof's 60 tiles."""
    middle_v, middle_u = scene.reference.shape[0] // 2, scene.reference.shape[1] // 2
    top, left = middle_v - side // 2, middle_u - side // 2
    grid = Grid(scene.grid.left + left * 10.0, scene.grid.top - top * 10.0, 10.0, side, side)
    return replace(scene, reference=scene.reference[top : top + side, left : left + side].copy(), grid=grid)


def test_happy_path_a_right_proposal_is_proved_as_local_ai_and_its_count_stays_for_display() -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    scene = scene_of()
    matcher = Matcher(numpy.array([[1.0, 0.0, 300.0], [0.0, 1.0, -200.0], [0.0, 0.0, 1.0]]) @ scene.truth)
    lines: list[str] = []

    found = find_frame(votes_blind(scene, matcher), nothing, lines.append)

    assert found.how == "local-ai"
    assert map_error_ground_m(scene, found) < 25.0
    assert found.proposer == ON_GPU
    assert found.votes == (0, 0)
    assert any(line.startswith("proved:") for line in lines)


def test_happy_path_the_request_holds_each_orientation_and_the_film() -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    scene = scene_of()
    matcher = Matcher()
    search = votes_blind(scene, matcher)

    find_frame(search, nothing, list[str]().append)

    request = matcher.requests[0]
    assert len(request.starts) == len(search.orientations) * request.starts_each >= 1
    assert request.read is search.reader
    assert request.limits == search.limits
    assert request.margin_m == pytest.approx(search.search.margin_ground_m / scene.ground())


def test_happy_path_the_request_starts_each_orientation_at_each_scale_the_models_own_first() -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    scene = scene_of()
    matcher = Matcher()
    search = votes_blind(scene, matcher)
    search = replace(search, search=replace(search.search, scales=(0.94, 1.0)))

    find_frame(search, nothing, list[str]().append)

    request = matcher.requests[0]
    centre = ((search.window.left + search.window.right) / 2, (search.window.bottom + search.window.top) / 2)
    expected = [scaled_about(each.matrix, centre, scale) for each in search.orientations for scale in (1.0, 0.94)]
    assert request.starts_each == 2
    assert len(request.starts) == len(expected)
    for got, wanted in zip(request.starts, expected, strict=True):
        assert got == pytest.approx(wanted)


def test_bad_path_a_wrong_proposal_is_refused_whatever_its_support() -> None:
    """Scenarios: S-P07-BAD-FALSE-PROPOSAL"""
    scene = elsewhere(scene_of())
    matcher = Matcher(scene.truth)

    found = find_frame(search_of(scene, matcher=matcher), nothing, list[str]().append)

    assert len(matcher.requests) == 1
    assert found.how == "none"
    assert found.proof is None
    assert found.proposer is None
    assert found.refused is not None
    assert found.refused.inliers < 60


def test_bad_path_no_proposal_is_a_refusal_with_no_votes() -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""
    scene = scene_of()

    found = find_frame(votes_blind(scene, Matcher()), nothing, list[str]().append)

    assert (found.how, found.proof, found.refused) == ("none", None, None)


def test_bad_path_more_proposals_than_proofs_stop_at_the_proofs_left() -> None:
    """Scenarios: S-P07-BAD-FALSE-PROPOSAL"""
    scene = elsewhere(scene_of())
    far = numpy.array([[1.0, 0.0, 400.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]])
    matcher = Matcher(*(numpy.linalg.matrix_power(far, each) @ scene.truth for each in range(1, 7)))
    search = search_of(scene, matcher=matcher)
    lines: list[str] = []

    find_frame(replace(search, frame=replace(search.frame, pixels=numpy.full_like(scene.film, 128)[::3, ::3])), nothing, lines.append)

    assert sum(line.startswith("not proved") for line in lines) == 3


def test_happy_path_a_small_window_is_proved_only_over_the_wider_reference() -> None:
    """Scenarios: S-P07-HAPPY-SMALL-WINDOW"""
    whole = scene_of()
    scene = small_window(whole)
    matcher = Matcher(whole.truth)
    asked: list[MercatorBox] = []

    def wide(box: MercatorBox) -> tuple[numpy.ndarray, Grid]:
        asked.append(box)
        return whole.reference, whole.grid

    # Refused over its own small window, under the same gates: a perfect proposal.
    refused = find_frame(votes_blind(scene, matcher), nothing, list[str]().append)
    assert refused.proof is None
    assert refused.refused is not None

    found = find_frame(replace(votes_blind(scene, matcher), wide=wide), nothing, list[str]().append)

    assert found.how == "local-ai"
    assert found.proof is not None
    assert found.proof.inliers >= 60
    # The film under the city still is the matcher's window's: the crop is `locate`'s, from the same map.
    assert map_error_ground_m(whole, found) < 25.0
    ground = ground_scale(whole.grid.box().bounds().middle_lat)
    assert len(asked) == 1
    assert asked[0].width * ground >= MATCHER_PROOF_SIDE_GROUND_M - 1
    assert asked[0].height * ground >= MATCHER_PROOF_SIDE_GROUND_M - 1


def test_bad_path_a_wider_reference_that_cannot_be_had_costs_the_proposal_not_the_run() -> None:
    """Scenarios: S-P07-HAPPY-SMALL-WINDOW"""
    whole = scene_of()
    scene = small_window(whole)

    found = find_frame(replace(votes_blind(scene, Matcher(whole.truth)), wide=lambda _box: None), nothing, list[str]().append)

    assert found.how == "none"


def test_happy_path_a_window_of_30_km_needs_no_wider_one() -> None:
    """Scenarios: S-P07-HAPPY-SMALL-WINDOW"""
    wide = MercatorBox(0.0, 0.0, 50_000.0, 50_000.0)
    narrow = MercatorBox(0.0, 0.0, 50_000.0, 10_000.0)

    assert wider_box(wide, 0.71) is None
    grown = wider_box(narrow, 0.71)
    assert grown is not None
    assert grown.width == pytest.approx(50_000.0)
    assert grown.height == pytest.approx(30_000.0 / 0.71)
    assert (grown.bottom + grown.top) / 2 == pytest.approx(5_000.0)


def test_bad_path_with_no_proof_left_the_matcher_is_not_asked_and_the_log_says_so() -> None:
    """Scenarios: S-P07-BAD-NO-PROOF-LEFT"""
    scene = scene_of()
    matcher = Matcher()
    search = search_of(scene, matcher=matcher)
    lines: list[str] = []
    run = chain._Run(search, dense_grid(search.reference, search.grid), nothing, lines.append, left=0)

    assert chain._from_matcher(search, run, []) is None
    assert matcher.requests == []
    assert lines == [chain.NOT_ASKED]


def test_bad_path_with_no_proof_left_cloud_run_still_says_it_has_no_ai() -> None:
    """Scenarios: S-P07-BAD-NO-PROOF-LEFT"""
    search = search_of(scene_of(), matcher=NullProposalMatcher())
    lines: list[str] = []
    run = chain._Run(search, dense_grid(search.reference, search.grid), nothing, lines.append, left=0)

    assert chain._from_matcher(search, run, []) is None
    assert lines == [NO_LOCAL_AI]


def _corner_only(whole: Scene, window: Grid, keep: int) -> numpy.ndarray:
    """The wider reference with the window blanked but for its top-left corner, `keep` cells a side: clouds over most of the town."""
    reference = whole.reference.copy()
    left, top = round((window.left - whole.grid.left) / whole.grid.resolution), round((whole.grid.top - window.top) / whole.grid.resolution)
    corner = reference[top : top + keep, left : left + keep].copy()
    reference[top : top + window.height, left : left + window.width] = 0
    reference[top : top + keep, left : left + keep] = corner
    return reference


def test_bad_path_tiles_in_a_corner_of_a_town_do_not_read_as_all_of_it_over_a_wide_proof() -> None:
    """Scenarios: S-P07-BAD-WIDE-SPREAD"""
    whole = scene_of()
    scene = small_window(whole, 500)
    wide = replace(votes_blind(scene, Matcher(whole.truth)), wide=lambda _box: (_corner_only(whole, scene.grid, 160), whole.grid))

    lines: list[str] = []
    found = find_frame(wide, nothing, lines.append)

    assert found.how == "local-ai", lines
    assert found.proof is not None
    # Over the box the tiles span most of the film; over the window, only the corner they hold.
    assert found.proof.spread >= 0.7, found.proof.spread
    assert found.window_spread is not None
    assert found.window_spread < 0.3
    assert measured_pct(found.proof) >= AUTO_MIN_MEASURED_PCT
    assert measured_pct(found.proof, found.window_spread) < AUTO_MIN_MEASURED_PCT


def test_happy_path_tiles_across_the_window_read_as_all_of_it_over_a_wide_proof() -> None:
    """Scenarios: S-P07-HAPPY-SMALL-WINDOW"""
    whole = scene_of()
    scene = small_window(whole, 500)
    wide = replace(votes_blind(scene, Matcher(whole.truth)), wide=lambda _box: (whole.reference, whole.grid))

    found = find_frame(wide, nothing, list[str]().append)

    assert found.proof is not None
    assert found.window_spread is not None
    assert measured_pct(found.proof, found.window_spread) >= AUTO_MIN_MEASURED_PCT


def test_happy_path_a_proof_over_the_window_itself_needs_no_second_figure() -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    scene = scene_of()

    found = find_frame(votes_blind(scene, Matcher(scene.truth)), nothing, list[str]().append)

    assert found.how == "local-ai"
    assert found.window_spread is None
    assert found.proof is not None
    assert measured_pct(found.proof, found.window_spread) == measured_pct(found.proof)


def test_bad_path_cloud_run_has_no_ai_and_says_so() -> None:
    """Scenarios: S-P07-BAD-CLOUD-NO-AI"""
    scene = scene_of()
    lines: list[str] = []
    search = search_of(scene, matcher=NullProposalMatcher())
    blind = replace(search, frame=replace(search.frame, pixels=numpy.full_like(scene.film, 128)[::3, ::3]))

    found = find_frame(blind, nothing, lines.append)

    assert found.how == "none"
    assert NO_LOCAL_AI in lines
