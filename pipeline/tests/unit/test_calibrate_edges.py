"""The rarer paths of the chain, `locate` and `align` (M9 §4, §5, §6, §15): a weak proposal proved late, what a refusal records."""

from types import SimpleNamespace
from typing import cast

import numpy
import pytest
from hcm_pipeline.calibrate import votes
from hcm_pipeline.calibrate.chain import Found, _Run
from hcm_pipeline.calibrate.dense import ROW_COLUMNS, DenseGrid, Measured
from hcm_pipeline.calibrate.poly import MatrixMap
from hcm_pipeline.calibrate.proof import Checked, Proof, _spread
from hcm_pipeline.calibrate.votes import WarpedFrame, tile_vote
from hcm_pipeline.documents import JoinSeam
from hcm_pipeline.frames import FrameLayout, Placement
from hcm_pipeline.geo import Grid
from hcm_pipeline.jobs import JobContext
from hcm_pipeline.join.measure import Measured as SeamMeasured
from hcm_pipeline.join.measure import SeamModel
from hcm_pipeline.join.seams import Seam
from hcm_pipeline.steps.align import Aligning, Verdict, _reported
from hcm_pipeline.steps.locate import SegmentReader, _calibration, _refusal_record

from tests.fakes.world import city_bounds
from tests.unit.calibrate_scene import run, scene_of, search_of


def _refused(inliers: int) -> Proof:
    empty = numpy.empty((0, ROW_COLUMNS))
    measured = Measured(empty, None, numpy.zeros(0, numpy.bool_), 0.0, None, None)
    return Proof("few-inliers", inliers, 40, 0.0, 0.0, Checked(float("inf"), 1.0, 0), measured)


def test_happy_path_a_weak_proposal_is_proved_after_the_warps(monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P06-HAPPY-VOTES"""
    monkeypatch.setattr(votes, "VOTE_STOP_AGREE", 10**6)

    found = run(scene_of())

    assert found.proof is not None
    assert found.how == "votes"


def test_bad_path_the_refusal_kept_is_the_one_with_the_most_tiles() -> None:
    """Scenarios: S-P06-BAD-OFF-STRIP"""
    keeping = _Run(search_of(scene_of()), cast("DenseGrid", None), lambda: None, lambda _line: None)
    keeping.heard(_refused(16))
    keeping.heard(_refused(3))

    assert keeping.refused is not None
    assert keeping.refused.inliers == 16
    assert keeping.accepted is None


def test_bad_path_no_tile_or_no_covered_window_has_no_spread() -> None:
    """Scenarios: S-P06-BAD-OFF-STRIP"""
    grid = Grid(0.0, 100.0, 10.0, 10, 10)

    assert _spread(numpy.empty((0, ROW_COLUMNS)), 0.5, grid) == 0.0
    assert _spread(numpy.ones((3, ROW_COLUMNS)), 0.0, grid) == 0.0


def test_bad_path_a_flat_tile_or_one_with_no_place_casts_no_vote() -> None:
    """Scenarios: S-P06-BAD-LOW-TEXTURE"""
    rng = numpy.random.default_rng(1)
    filtered = rng.random((40, 40), numpy.float32)
    tile = rng.random((8, 8), numpy.float32)
    nowhere = WarpedFrame(filtered, numpy.zeros((33, 33), numpy.float32), (0, 0))

    assert tile_vote(numpy.zeros((8, 8), numpy.float32), nowhere, (0, 0)) is None
    assert tile_vote(tile, nowhere, (0, 0)) is None


def test_bad_path_a_refusal_records_its_votes_its_tiles_and_what_the_crop_lost() -> None:
    """Scenarios: S-P06-BAD-OVER-LIMIT"""
    found = Found(None, "none", None, (6, 196), _refused(16), ())

    assert _refusal_record(found, 2) == {
        "how": "none",
        "refusal": "few-inliers",
        "votes": {"agreed": 6, "tiles": 196},
        "tiles": {"agreed": 16, "tried": 40},
        "cutOrientations": 2,
    }


class _City:
    def read(self, _path: str) -> dict[str, object]:
        return {"bounds": city_bounds()}

    city = "bucharest"


def test_bad_path_a_found_frame_with_no_model_or_proof_records_only_what_it_has() -> None:
    """Scenarios: S-P06-BAD-CROP-COVERAGE"""
    far = numpy.eye(3)
    far[:2, 2] = [1e9, 1e9]
    ctx = cast("JobContext", _City())

    record = _calibration(ctx, Found(None, "votes", None, (1, 2), None, ()), MatrixMap(far), (10, 10, 0))

    assert record == {"how": "votes", "votes": {"agreed": 1, "tiles": 2}, "coveredPct": 0.0}


def test_bad_path_a_segment_off_the_box_is_never_staged() -> None:
    """Scenarios: S-P06-BAD-CROP-COVERAGE"""
    reader = SegmentReader(cast("JobContext", None), cast("FrameLayout", None))
    pixels = numpy.zeros((4, 4), numpy.uint8)

    reader._onto(pixels, Placement("far.tif", 1000, 1000, 10, 10), (0, 0, 4, 4), 1)

    assert not pixels.any()


def _seam_with(before_m: float) -> JoinSeam:
    run = SimpleNamespace(parts=[SimpleNamespace(entity_id="F039"), SimpleNamespace(entity_id="F040")])
    item = SeamMeasured(cast("Seam", SimpleNamespace(a=0, b=1)), (), cast("SeamModel", object()))
    verdict = cast("Verdict", SimpleNamespace(before_m=before_m))
    return _reported(cast("Aligning", run), item, verdict, False)


def test_happy_path_a_seam_already_closed_counts_as_closed_though_nothing_moved() -> None:
    """Scenarios: S-P05-HAPPY-ALREADY-CLOSED"""
    seam = _seam_with(0.34)

    assert (seam.applied, seam.max_shift_m) == (True, 0.0)


def test_bad_path_a_refused_correction_on_an_open_seam_stays_refused() -> None:
    """Scenarios: S-P05-HAPPY-ALREADY-CLOSED, S-P05-BAD-WORSENED"""
    assert _seam_with(12.0).applied is False
