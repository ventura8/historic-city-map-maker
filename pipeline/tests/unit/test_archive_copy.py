"""An archive series' sheets copied between the owner's computers through the bucket (M20 §4.1; live report of 2026-11-13).

The computer that holds the archive sends one series' sheets and their manifest to the job's copy folder; another worker reads them,
checks each SHA-256 and keeps them in its own store, never named as held whole; with no copy, or a copy that is not the scan's bytes,
the run ends `returned` and the job goes back unspent. Scenarios: S-P20-HAPPY-ARCHIVE-COPY, S-P20-BAD-ARCHIVE-COPY
"""

import json
from dataclasses import replace
from pathlib import Path

import pytest
from hcm_pipeline.archive.copy import MANIFEST, CopySender, copy_path, ensure_series, manifest_of
from hcm_pipeline.archive.intake import ArchiveStore
from hcm_pipeline.jobs import ArchiveElsewhereError, Done, JobContext
from hcm_pipeline.objects import ObjectStore
from hcm_pipeline.runner import JobRunner, RunOutcome, RunSettings
from hcm_pipeline.steps.gather import GatherStep
from hcm_pipeline.worker.routed import SIGNED_PREFIXES

from tests.fakes.world import CITY, JOB_ID, PipelineWorld
from tests.unit.test_archive_steps import SERIES_PARAMS, archive, context


def send(world: PipelineWorld, store: ArchiveStore, archive_id: str, series_id: str) -> list[tuple[str, int]]:
    """The holder's copy of the series for the test's job; what it reported done."""
    finished: list[tuple[str, int]] = []
    objects = world.services().objects
    CopySender(store, lambda _job: objects, lambda job, sent: finished.append((job, sent))).send(
        CITY, {"jobId": JOB_ID, "archiveId": archive_id, "seriesId": series_id}
    )
    return finished


def copied_context(world: PipelineWorld, tmp_path: Path) -> tuple[JobContext, ArchiveStore, str, str]:
    """The holder's archive under `holder/`, its series copied; the job's context on another computer (`other/`)."""
    holder, archive_id, series_id = archive(tmp_path / "holder")
    ctx = context(world, tmp_path, {**SERIES_PARAMS, "archiveId": archive_id, "seriesId": series_id}, tmp_path / "other")
    [(job, sent)] = send(world, holder, archive_id, series_id)
    assert (job, sent > 0) == (JOB_ID, True)
    return ctx, ArchiveStore(tmp_path / "other"), archive_id, series_id


def test_happy_path_another_computer_runs_the_series_from_its_copy(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-ARCHIVE-COPY"""
    ctx, other, archive_id, series_id = copied_context(world, tmp_path)

    ensure_series(ctx)

    assert other.has_series(archive_id, series_id)
    assert (other.holds(archive_id), other.held()) == (False, [])
    assert isinstance(GatherStep().run(ctx), Done)
    assert any("copied to this computer from the bucket" in line for line in world.log_lines())
    ensure_series(ctx)


def test_happy_path_the_holder_names_its_whole_archives_and_sends_each_sheet_once(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-ARCHIVE-COPY"""
    holder, archive_id, series_id = archive(tmp_path / "holder")

    assert (holder.holds(archive_id), holder.held()) == (True, [archive_id])
    rows = manifest_of(holder, archive_id, series_id)["files"]
    assert isinstance(rows, list)
    assert {row["path"] for row in rows} <= {"Harti/1897 plan.jpg", "Harti/1911 plan.jpg"}
    send(world, holder, archive_id, series_id)
    objects: ObjectStore = world.services().objects
    assert objects.stat(copy_path(CITY, JOB_ID, MANIFEST)) is not None
    assert all(objects.stat(copy_path(CITY, JOB_ID, str(row["sha256"]))) is not None for row in rows)
    assert "tmp/archive-copies/" in SIGNED_PREFIXES


def test_bad_path_without_a_copy_the_run_hands_the_job_back(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-ARCHIVE-COPY"""
    _holder, archive_id, series_id = archive(tmp_path / "holder")
    ctx = context(world, tmp_path, {**SERIES_PARAMS, "archiveId": archive_id, "seriesId": series_id}, tmp_path / "other")

    with pytest.raises(ArchiveElsewhereError, match="no copy of series"):
        ensure_series(ctx)
    assert not ArchiveStore(tmp_path / "other").has_series(archive_id, series_id)


def test_bad_path_a_copy_that_is_not_the_scans_bytes_is_never_kept(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-ARCHIVE-COPY"""
    ctx, other, archive_id, series_id = copied_context(world, tmp_path)
    manifest = json.loads(ctx.stage(copy_path(CITY, JOB_ID, MANIFEST), "m.json").read_text(encoding="utf-8"))
    tampered = tmp_path / "tampered.jpg"
    tampered.write_bytes(b"another map")
    ctx.services.objects.upload_file(tampered, copy_path(CITY, JOB_ID, "f" * 64), "application/octet-stream")
    manifest["files"][0]["sha256"] = "f" * 64
    ctx.staged.clear()
    listed = tmp_path / "manifest.json"
    listed.write_text(json.dumps(manifest), encoding="utf-8")
    ctx.services.objects.delete(copy_path(CITY, JOB_ID, MANIFEST))
    ctx.services.objects.upload_file(listed, copy_path(CITY, JOB_ID, MANIFEST), "application/json")

    with pytest.raises(ArchiveElsewhereError, match="not the file the scan read"):
        ensure_series(ctx)
    assert not other.has_series(archive_id, series_id)
    assert not list(other.root.rglob("*.part"))


def test_bad_path_a_manifest_that_is_not_json_hands_the_job_back(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-ARCHIVE-COPY"""
    _holder, archive_id, series_id = archive(tmp_path / "holder")
    ctx = context(world, tmp_path, {**SERIES_PARAMS, "archiveId": archive_id, "seriesId": series_id}, tmp_path / "other")
    broken = tmp_path / "broken.json"
    broken.write_text("{", encoding="utf-8")
    ctx.services.objects.upload_file(broken, copy_path(CITY, JOB_ID, MANIFEST), "application/json")

    with pytest.raises(ArchiveElsewhereError, match="could not be read"):
        ensure_series(ctx)


def test_bad_path_a_series_the_holder_has_not_is_refused_and_not_reported(world: PipelineWorld, tmp_path: Path) -> None:
    holder, archive_id, _series_id = archive(tmp_path / "holder")

    assert send(world, holder, archive_id, "s-000000000000") == []
    assert send(world, holder, "ar-0000000000000000", "s-000000000000") == []


@pytest.mark.parametrize("change", [{"type": "usgs-import"}, {"root": None}, {"params": {}}])
def test_happy_path_other_jobs_and_cloud_runs_need_no_sheets_here(world: PipelineWorld, tmp_path: Path, change: dict[str, object]) -> None:
    ctx = context(world, tmp_path, {**SERIES_PARAMS, "archiveId": "ar-0123456789abcdef", "seriesId": "s-0123456789ab"}, tmp_path / "w")
    if "type" in change:
        ctx.job = replace(ctx.job, type="usgs-import")
    if "root" in change:
        ctx.services = replace(ctx.services, archive_root=None)
    if "params" in change:
        ctx.job = replace(ctx.job, params={})

    ensure_series(ctx)


def test_bad_path_a_run_without_the_sheets_ends_returned_and_writes_nothing(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-ARCHIVE-COPY"""
    _holder, archive_id, series_id = archive(tmp_path / "holder")
    world.seed_import()
    world.store.update(
        world.job_path(), {"type": "archive-series", "params": {**SERIES_PARAMS, "archiveId": archive_id, "seriesId": series_id}}
    )
    services = replace(world.services(), archive_root=tmp_path / "other")

    outcome = JobRunner(world.config, services, {}, RunSettings(heartbeat_seconds=3600)).run()

    assert outcome is RunOutcome.RETURNED
    assert world.job()["status"] not in ("failed", "queued")
    assert any("goes back for the computer that has the files" in line for line in world.log_lines())


def test_bad_path_an_archive_not_scanned_yet_is_neither_held_nor_a_series_source(tmp_path: Path) -> None:
    store = ArchiveStore(tmp_path)
    unscanned = store.create()

    assert (store.holds(unscanned), store.held(), store.has_series(unscanned, "s-000000000000")) == (False, [], False)
    assert store.has_series("not-an-archive", "s-000000000000") is False
