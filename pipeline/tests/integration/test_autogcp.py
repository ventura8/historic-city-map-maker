"""Automatic GCP suggestions through the `georef` step (scenario P03; docs/research/M4-interfaces.md §2.1-§2.4).

Each test seeds a USGS import whose scan is the synthetic world through an exact affine map (`matching.py`), degraded
the way the scenario says, and runs the real step against the loopback fakes; the fit is then measured against the
exact map over the whole scan, so "placed within the tolerance" means the truth's: the median distance within
`EXPECTED_RMSE_M` and the largest (a corner, outside the hull of the matched pairs, where `poly2` extrapolates) within
`EDGE_ERROR_M`. The approval policy reads the checkpoint RMSE of interior pairs, so the edges are pinned here
(the 2026-10-24 review measured 14.1, 11.7 and 23.4 m; `DECISIONS-for-review.md` §57d).
"""

import json
from pathlib import Path

import pytest
from hcm_pipeline.contract import Errors
from hcm_pipeline.documents import GeorefInfo
from hcm_pipeline.georef.autogcp import (
    AUTO_GCP_MIN_CONFIDENCE,
    AUTO_GCP_SUGGEST_MIN,
    MAX_SUGGESTIONS,
    AutoPair,
    checkpoint_count,
    decide,
)
from hcm_pipeline.georef.matcher import MatchResult, Tiles
from hcm_pipeline.georef.transforms import Fit, Gcp, fit
from hcm_pipeline.model import Timestamp
from hcm_pipeline.runner import RunOutcome
from hcm_pipeline.steps import georef as georef_step

from tests.contracts_loader import golden, record, records
from tests.fakes.http import Reply
from tests.fakes.world import OVERPASS_PATH, PipelineWorld, dig
from tests.integration.matching import SCAN_OBJECT, Seeded, blurred, faded, overcast, seed_matching, transform_error_m, uniform
from tests.synthetic.scenes import EXPECTED_RMSE_M, Scene

RIVER_ID = 900
GOLDEN = record(golden("version.needs-gcps.suggestions.json")["suggestions"])
# The largest distance from the truth anywhere on the scan: its corners lie outside the matched pairs' hull.
EDGE_ERROR_M = 2 * EXPECTED_RMSE_M


def run_georef(world: PipelineWorld) -> RunOutcome:
    return world.runner().run("georef")


def suggestions_of(world: PipelineWorld) -> dict[str, object]:
    return record(world.version()["suggestions"])


def fitted(world: PipelineWorld) -> Fit:
    """The version's automatic georeference fitted again (its transform, to measure against the truth)."""
    georef = GeorefInfo.of(world.version()["georef"])
    result = fit(georef.transform, georef.gcps)
    assert isinstance(result, Fit)
    return result


def placement_m(world: PipelineWorld, seeded: Seeded) -> tuple[float, float]:
    """The median and the largest ground distance between the version's fit and the scan's exact map."""
    return transform_error_m(fitted(world).transform, seeded.truth, (seeded.pixels.shape[1], seeded.pixels.shape[0]))


def assert_placed(world: PipelineWorld, seeded: Seeded) -> None:
    """Within the tolerance in the middle (the median) and at the edges (the largest distance)."""
    median, largest = placement_m(world, seeded)
    assert median <= EXPECTED_RMSE_M
    assert largest <= EDGE_ERROR_M


def scores_of(pairs: list[dict[str, object]]) -> list[float]:
    return [float(str(pair["score"])) for pair in pairs]


def assert_golden_shape(suggestions: dict[str, object]) -> None:
    """The record has the golden document's fields, and its pairs the golden pairs' (a residual where there is a fit)."""
    assert set(suggestions) == set(GOLDEN)
    assert set(record(suggestions["tiles"])) == {"matched", "total"}
    for pair in records(suggestions["pairs"]):
        assert set(pair) - {"residualM"} == set(records(GOLDEN["pairs"])[0])
        assert (pair["origin"], pair["enabled"]) == ("auto", True)


def only_the_river(world: PipelineWorld) -> None:
    """Overpass answers the window's river and nothing else."""
    elements = [element for element in records(world.scene.overpass["elements"]) if element["id"] == RIVER_ID]
    answer = json.dumps({"version": 0.6, "elements": elements})
    world.http.route("POST", OVERPASS_PATH, lambda _request: Reply.json(answer))


def test_happy_path_confident_pairs_fit_and_the_weaker_ones_are_suggested(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P03-HAPPY"""
    seeded = seed_matching(world, tmp_path, blurred(8))

    outcome = run_georef(world)

    georef = record(world.version()["georef"])
    gcps = records(georef["gcps"])
    suggestions = suggestions_of(world)
    pairs = records(suggestions["pairs"])
    assert outcome is RunOutcome.DONE
    assert world.version()["state"] == "processing"
    assert (georef["method"], georef["transform"]) == ("auto", "poly2")
    assert all(score >= AUTO_GCP_MIN_CONFIDENCE for score in scores_of(gcps))
    assert all("residualM" in gcp and gcp["origin"] == "auto" for gcp in gcps)
    assert georef["checkpointCount"] == checkpoint_count(len(gcps)) == len([gcp for gcp in gcps if gcp["enabled"] is False]) >= 3
    assert float(str(georef["checkpointRmseM"])) <= EXPECTED_RMSE_M
    assert_placed(world, seeded)
    assert 0 < len(pairs) <= MAX_SUGGESTIONS
    assert all(AUTO_GCP_SUGGEST_MIN <= score < AUTO_GCP_MIN_CONFIDENCE for score in scores_of(pairs))
    assert scores_of(pairs) == sorted(scores_of(pairs), reverse=True)
    assert all("residualM" in pair for pair in pairs)
    assert not {pair["id"] for pair in pairs} & {gcp["id"] for gcp in gcps}
    assert (suggestions["method"], suggestions["channels"], suggestions["minConfidence"]) == ("sift", ["s2", "osm"], 0.6)
    assert suggestions["generatedAt"] == Timestamp.at(world.clock.now)
    assert_golden_shape(suggestions)


def test_happy_path_the_same_job_matches_the_same_way_twice(world: PipelineWorld, synthetic_scene: Scene, tmp_path: Path) -> None:
    """Scenarios: S-P03-HAPPY"""
    seed_matching(world, tmp_path, blurred(8))
    run_georef(world)
    with PipelineWorld(synthetic_scene) as again:
        (tmp_path / "again").mkdir()
        seed_matching(again, tmp_path / "again", blurred(8))
        run_georef(again)

        assert again.version()["georef"] == world.version()["georef"]
        assert again.version()["suggestions"] == world.version()["suggestions"]


def test_happy_path_a_faded_scan_is_matched_with_orb(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P03-HAPPY-ORB-FALLBACK"""
    seeded = seed_matching(world, tmp_path, faded(0.05))

    outcome = run_georef(world)

    georef = record(world.version()["georef"])
    assert outcome is RunOutcome.DONE
    assert suggestions_of(world)["method"] == "orb"
    assert georef["method"] == "auto"
    assert float(str(georef["checkpointRmseM"])) <= EXPECTED_RMSE_M
    assert_placed(world, seeded)


def test_happy_path_a_clouded_sentinel2_window_is_placed_by_the_openstreetmap_lines(
    world: PipelineWorld, synthetic_scene: Scene, tmp_path: Path
) -> None:
    """Scenarios: S-P03-HAPPY-OSM-CHANNEL"""
    seeded = seed_matching(world, tmp_path, s2=overcast(synthetic_scene.world))

    outcome = run_georef(world)

    suggestions = suggestions_of(world)
    georef = record(world.version()["georef"])
    assert outcome is RunOutcome.DONE
    assert suggestions["channels"] == ["s2", "osm"]
    assert int(str(dig(suggestions, "tiles", "matched"))) >= len(records(georef["gcps"])) >= 6
    assert float(str(georef["checkpointRmseM"])) <= EXPECTED_RMSE_M
    assert_placed(world, seeded)
    assert_golden_shape(suggestions)


def test_bad_path_too_few_confident_pairs_wait_for_the_admin_with_every_candidate_suggested(
    world: PipelineWorld, synthetic_scene: Scene, tmp_path: Path
) -> None:
    """Scenarios: S-P03-BAD-FEW-CONFIDENT"""
    only_the_river(world)
    seed_matching(world, tmp_path, s2=overcast(synthetic_scene.world))

    outcome = run_georef(world)

    version, job = world.version(), world.job()
    pairs = records(suggestions_of(world)["pairs"])
    confident = [score for score in scores_of(pairs) if score >= AUTO_GCP_MIN_CONFIDENCE]
    assert outcome is RunOutcome.WAITING
    assert (job["status"], job["waitReason"]) == ("awaiting_gcps", "gcps")
    assert version["state"] == "needs_gcps"
    assert version["error"] == {"code": Errors.NO_MATCH, "params": {"pairs": str(len(confident))}}
    assert 0 < len(confident) < 6
    assert len(pairs) > len(confident)
    assert all(score >= AUTO_GCP_SUGGEST_MIN for score in scores_of(pairs))
    assert scores_of(pairs) == sorted(scores_of(pairs), reverse=True)
    assert not any("residualM" in pair for pair in pairs)
    assert dig(version, "georef", "method") == "corners"
    assert "output" not in version
    assert world.gcs.names("rasters/") == [SCAN_OBJECT]
    assert_golden_shape(suggestions_of(world))


def test_bad_path_enough_confident_pairs_in_a_line_wait_with_their_own_reason(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P03-BAD-NO-SPREAD"""
    seed_matching(world, tmp_path, blurred(8))
    # Eight confident pairs along one road: enough for a fit, but they span no area.
    lined = tuple(
        AutoPair(
            Gcp(f"t{index}", 100.0 + index * 90, 100.0 + index * 90, 44.43 - index * 0.001, 26.1 + index * 0.001, True, "auto", 0.9),
            index,
            "osm",
        )
        for index in range(8)
    )

    def matched(*_args: object) -> MatchResult:
        return MatchResult("sift", ("s2", "osm"), lined, Tiles({"osm": 8}, {"osm": 16}))

    monkeypatch.setattr(georef_step, "match", matched)

    outcome = run_georef(world)

    version, job = world.version(), world.job()
    assert outcome is RunOutcome.WAITING
    assert (job["status"], job["waitReason"]) == ("awaiting_gcps", "gcps")
    assert version["error"] == {"code": Errors.NO_SPREAD, "params": {"pairs": "8"}}
    assert len(records(suggestions_of(world)["pairs"])) == 8
    assert decide(lined).degenerate is True


def test_bad_path_a_blank_scan_gives_no_pairs_and_no_suggestions(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P03-BAD-LOW-TEXTURE"""
    seed_matching(world, tmp_path, uniform)

    outcome = run_georef(world)

    version = world.version()
    suggestions = suggestions_of(world)
    assert outcome is RunOutcome.WAITING
    assert version["state"] == "needs_gcps"
    assert version["error"] == {"code": Errors.NO_MATCH, "params": {"pairs": "0"}}
    assert suggestions["pairs"] == []
    assert dig(suggestions, "tiles", "matched") == 0
    assert suggestions["method"] == "orb"


def test_happy_path_a_retry_after_an_automatic_fit_keeps_its_suggestions(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P03-HAPPY-RETRY-KEEPS-SUGGESTIONS"""
    seed_matching(world, tmp_path, blurred(8))
    assert run_georef(world) is RunOutcome.DONE
    fitted_first, suggested = world.version()["georef"], suggestions_of(world)
    assert records(suggested["pairs"])
    # `imagery.retry` of a failure after `georef`: the step runs again on the version it fitted.
    world.store.update(world.job_path(), {"status": "starting", "steps.georef": {"status": "pending"}})

    assert run_georef(world) is RunOutcome.DONE

    assert suggestions_of(world) == suggested
    assert dig(world.version(), "georef", "method") == "auto"
    assert record(world.version()["georef"])["transform"] == record(fitted_first)["transform"]


def test_happy_path_the_admins_points_are_fitted_and_the_suggestions_are_done_with(world: PipelineWorld, tmp_path: Path) -> None:
    seed_matching(world, tmp_path, blurred(8))
    run_georef(world)
    georef = record(world.version()["georef"])
    manual = [{**gcp, "origin": "manual", "enabled": True} for gcp in records(georef["gcps"])[:8]]
    world.store.update(world.version_path(), {"georef": {"method": "gcps", "transform": "affine", "gcps": manual}})
    world.store.update(world.job_path(), {"status": "starting", "steps.georef": {"status": "pending"}})

    outcome = run_georef(world)

    version = world.version()
    assert outcome is RunOutcome.DONE
    assert dig(version, "georef", "method") == "gcps"
    assert len(records(dig(version, "georef", "gcps"))) == 8
    assert "suggestions" not in version
