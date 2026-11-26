"""An automatic layout mosaicked, kept for its owner, or the owner's layout fixed (docs/research/M20-import-local.md §19.6-§19.8)."""

import json
from dataclasses import replace
from pathlib import Path

import pytest
from hcm_pipeline.jobs import JobContext, Waiting
from hcm_pipeline.placing import autoplace, layout_files, owner_layout
from hcm_pipeline.placing.autostitch import Proposal
from hcm_pipeline.placing.quality import Quality
from hcm_pipeline.placing.series import SeriesJob
from hcm_pipeline.steps.place import PlaceStep

from tests.fakes.world import PipelineWorld, dig
from tests.synthetic.sheets import Series, SheetsSpec
from tests.unit.placing_support import originals, staged_series


def _series(world: PipelineWorld, tmp_path: Path, spec: SheetsSpec, kind: str = "atlas") -> tuple[JobContext, Series]:
    return staged_series(world, tmp_path, spec, kind)


def _stitched(world: PipelineWorld) -> dict[str, object]:
    found = dig(world.version(), "help", "stitched")
    assert isinstance(found, dict)
    return found


def _layout_file(world: PipelineWorld) -> dict[str, object]:
    path = next(path for path in world.gcs.objects if path.endswith("/layout.json"))
    found = json.loads(world.gcs.objects[path].data)
    assert isinstance(found, dict)
    return found


def test_happy_path_a_good_layout_is_mosaicked_and_waits_for_points_with_its_files(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-STITCH-NAMES, S-P20-HAPPY-STITCH-WINDOWED"""
    ctx, _staging = _series(world, tmp_path, SheetsSpec(rows=2, cols=3, overlap=0.08, names="rc"))

    assert isinstance(PlaceStep().run(ctx), Waiting)

    record = _stitched(world)
    assert (record["method"], record["joined"], record["parts"]) == ("names", 6, 6)
    layout = record["layout"]
    assert isinstance(layout, dict)
    assert (layout["rows"], layout["cols"], layout["revision"]) == (2, 3, 0)
    assert dig(layout, "quality", "verdict") == "good"
    assert {Path(path).name for path in world.gcs.objects} >= {"layout.json", "thumbs.jpg", "seams.jpg", "stitched.jpg"}
    sheets = _layout_file(world)["sheets"]
    assert isinstance(sheets, list)
    assert len(sheets) == 6
    assert {(sheet["source"], "out" in sheet) for sheet in sheets} == {("name", False)}


def test_bad_path_noise_waits_for_its_owner_with_layout_check_and_no_mosaic(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-STITCH-GARBAGE-WAITS"""
    ctx, _staging = _series(world, tmp_path, SheetsSpec(rows=1, cols=2, overlap=0.06, names="img", noise=6), kind="pieces")

    assert isinstance(PlaceStep().run(ctx), Waiting)

    assert dig(world.version(), "help", "reason") == autoplace.LAYOUT_CHECK
    assert dig(_stitched(world), "layout", "quality", "verdict") == "poor"
    assert not (ctx.local(autoplace.CANVAS)).exists()
    assert ctx.local(autoplace.PREVIEW).exists()
    weak = _layout_file(world)["seams"]
    assert isinstance(weak, list)
    assert any({"strip", "suggestion"} <= set(seam) for seam in weak)


def test_happy_path_the_older_joins_place_a_layout_the_seams_could_not_vouch_for(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ctx, _staging = _series(world, tmp_path, SheetsSpec(rows=2, cols=2, overlap=0.0, names="rc"))
    proposed = autoplace.proposed

    def doubtful(job: JobContext, series: SeriesJob) -> Proposal:
        return replace(proposed(job, series), quality=Quality(100.0, 0.4, 1.0, 0.0, "check"))

    monkeypatch.setattr(autoplace, "proposed", doubtful)

    assert isinstance(PlaceStep().run(ctx), Waiting)

    assert _stitched(world)["method"] == "atlas"


def _sheets() -> list[dict[str, object]]:
    return [{"index": index, "row": index // 2, "col": index % 2, "turn": 0, "flip": False} for index in range(4)]


def _answer(**fields: object) -> dict[str, object]:
    return {"revision": 3, "sheets": _sheets(), "seams": [], "preview": False, "by": "u-owner", "at": "2026-11-12T00:00:00Z", **fields}


def test_happy_path_the_owners_preview_waits_again_with_the_next_revision_and_keeps_the_answer(
    world: PipelineWorld, tmp_path: Path
) -> None:
    """Scenarios: S-P20-HAPPY-STITCH-OWNER"""
    ctx, _staging = _series(world, tmp_path, SheetsSpec(rows=2, cols=2, overlap=0.08, names="img"))
    sheets = [*_sheets()[:3], {"index": 3, "row": 0, "col": 0, "turn": 0, "flip": False, "out": "not-part"}]
    answer = _answer(preview=True, sheets=sheets)
    ctx.update_version({"help": {"reason": "layout-check", "layoutAnswer": answer}})

    assert isinstance(PlaceStep().run(ctx), Waiting)

    assert dig(world.version(), "help", "reason") == autoplace.LAYOUT_CHECK
    assert dig(world.version(), "help", "layoutAnswer", "revision") == 3
    record = _stitched(world)
    assert (record["method"], dig(record, "layout", "revision")) == ("owner", 4)
    written = _layout_file(world)["sheets"]
    assert isinstance(written, list)
    assert written[3]["out"] == "not-part"
    assert {sheet["source"] for sheet in written} == {"owner"}


def test_happy_path_an_accepted_answer_is_mosaicked_with_the_owners_seams(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-STITCH-OWNER"""
    ctx, _staging = _series(world, tmp_path, SheetsSpec(rows=2, cols=2, overlap=0.08, names="rc"))
    seam = {"a": 0, "b": 1, "side": "right", "points": {"a": [470.0, 180.0], "b": [28.0, 180.0]}}
    ctx.update_version({"help": {"reason": "layout-check", "layoutAnswer": _answer(seams=[seam], accepted=True, preview=True)}})

    assert isinstance(PlaceStep().run(ctx), Waiting)

    record = _stitched(world)
    assert (record["method"], record["joined"]) == ("owner", 4)
    seams = _layout_file(world)["seams"]
    assert isinstance(seams, list)
    assert any(item["state"] == "owner" and item["dx"] == pytest.approx(442.0, abs=0.5) for item in seams)
    # The answer outlives the mosaic's wait for points: a later `place` (Locate again) lays the series out the owner's way again.
    assert dig(world.version(), "help", "layoutAnswer", "revision") == 3


def test_happy_path_an_answer_with_no_sheets_takes_the_proposal_as_it_is(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-STITCH-OWNER"""
    ctx, staging = _series(world, tmp_path, SheetsSpec(rows=1, cols=2, overlap=0.08, names="rc"))
    answer = owner_layout.Answer(0, (), (), False, {})

    proposal = owner_layout.owner_proposal([(name, originals(ctx) / name) for name, _path in staging.named], answer)

    assert len(proposal.solved.positions) == 2
    assert proposal.grid.source == "name"


def test_bad_path_a_malformed_answer_reads_zeroes_and_drops_its_malformed_points() -> None:
    """Scenarios: S-P20-BAD-STITCH-OWNER-MALFORMED"""
    assert owner_layout.number({"row": True}, "row") == 0
    assert owner_layout.point({"a": [1, "x"]}, "a") is None
    assert owner_layout.point({"a": [True, 2]}, "a") is None
    assert owner_layout.point({"a": [1, float("nan")]}, "a") is None
    assert owner_layout.point({"a": [1, 2.5]}, "a") == (1.0, 2.5)


def test_bad_path_no_answer_and_a_broken_one(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-STITCH-OWNER-MALFORMED"""
    ctx, _staging = _series(world, tmp_path, SheetsSpec(rows=1, cols=2, overlap=0.08, names="rc"))
    assert owner_layout.answer_of(ctx) is None

    ctx.update_version({"help": {"reason": "layout-check", "layoutAnswer": {"revision": "x", "sheets": "y", "seams": [1, {"a": 0}]}}})

    found = owner_layout.answer_of(ctx)
    assert found is not None
    assert (found.revision, found.sheets, found.seams, found.preview) == (0, (), ({"a": 0},), False)


def test_happy_path_the_next_revision_follows_the_versions_layout() -> None:
    assert layout_files.revision_of({}) == 0
    assert layout_files.revision_of({"help": {"stitched": {"layout": {"revision": 4}}}}) == 5
    assert layout_files.revision_of({"help": {"stitched": {"layout": {"revision": "4"}}}}) == 0
