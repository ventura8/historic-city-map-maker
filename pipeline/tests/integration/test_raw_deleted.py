"""The raw USGS delivery is deleted once the city crop exists (M7, docs/research/M7-local-worker.md §5)."""

import json
from dataclasses import replace
from pathlib import Path

import pytest
from hcm_pipeline.runner import RunOutcome
from hcm_pipeline.steps import locate

from tests.contracts_loader import record
from tests.fakes.http import Reply
from tests.fakes.world import CITY, ENTITY_ID, JOB_ID, LAYER_ID, OVERPASS_PATH, PipelineWorld, dig
from tests.synthetic.scenes import overpass_answer, render_world, write_sentinel2

RAW = f"usgs-raw/corona2/{ENTITY_ID}/{ENTITY_ID}.tgz"
SCAN = f"rasters/{CITY}/{LAYER_ID}/{JOB_ID}/scan.tif"
DELETED = f"the USGS delivery {RAW} is deleted: the city crop is recorded"


def deliveries(world: PipelineWorld) -> int:
    return sum(1 for request in world.http.requests if request.path.endswith(f"{ENTITY_ID}.tgz"))


def test_happy_path_the_delivery_is_deleted_once_the_city_crop_exists(world: PipelineWorld) -> None:
    """Scenarios: S-P01-HAPPY-RAW-DELETED"""
    world.seed_import()

    assert world.run() is RunOutcome.DONE

    assert world.gcs.names("usgs-raw/") == []
    assert SCAN in world.gcs.names(f"rasters/{CITY}/")
    assert dig(world.version(), "scan", "path") == SCAN
    lines = world.log_lines()
    assert lines.index("step locate started") < lines.index(DELETED) < lines.index("step locate done")


def test_happy_path_a_retry_after_locate_needs_no_delivery(world: PipelineWorld) -> None:
    """Scenarios: S-P01-HAPPY-RAW-DELETED"""
    for _ in range(3):
        world.http.enqueue(OVERPASS_PATH, Reply(503, b"<html>busy</html>", "text/html"))
    world.seed_import()
    assert world.run() is RunOutcome.FAILED
    assert dig(world.job(), "steps", "reference", "status") == "failed"
    # The dispatcher's retry: `locate`'s crop exists, so the deleted delivery is not downloaded again.
    world.store.update(world.job_path(), {"status": "starting"})

    assert world.run() is RunOutcome.DONE

    assert deliveries(world) == 1
    assert world.job()["status"] == "awaiting_approval"
    assert world.log_lines().count("step fetch started") == 1


def test_bad_path_a_resume_after_locate_with_its_work_folder_gone_goes_on(world: PipelineWorld) -> None:
    """Scenarios: S-P01-BAD-RESUME-WORK-GONE"""
    for _ in range(3):
        world.http.enqueue(OVERPASS_PATH, Reply(503, b"<html>busy</html>", "text/html"))
    world.seed_import()
    assert world.run() is RunOutcome.FAILED
    assert dig(world.job(), "steps", "locate", "status") == "done"
    # The job's scratch is gone (the bucket's lifecycle, the worker's sweep): the segments and the frame fed only `locate`.
    for name in world.gcs.names(f"work/{CITY}/{JOB_ID}/"):
        del world.gcs.objects[name]
    world.store.update(world.job_path(), {"status": "starting"})

    assert world.run() is RunOutcome.DONE

    assert world.job()["status"] == "awaiting_approval"
    assert deliveries(world) == 1
    assert world.log_lines().count("step extract started") == 1
    assert world.log_lines().count("step stitch started") == 1


def test_bad_path_a_retry_after_the_delivery_was_deleted_downloads_it_again(world: PipelineWorld) -> None:
    """Scenarios: S-P01-BAD-RAW-GONE-RETRY"""
    world.seed_import()
    world.store.update(world.job_path(), {"machine": "fetch"})
    assert world.run() is RunOutcome.DONE
    # `extract` failed, and the delivery was deleted meanwhile (another city's `locate` of the same frame); the retry.
    del world.gcs.objects[RAW]
    world.store.update(world.job_path(), {"status": "starting", "machine": "std", "steps.extract.status": "failed"})

    assert world.run() is RunOutcome.DONE

    assert deliveries(world) == 2
    assert world.log_lines().count("step fetch started") == 2
    assert world.job()["status"] == "awaiting_approval"
    assert dig(world.job(), "steps", "fetch", "status") == "done"
    assert world.gcs.names("usgs-raw/") == []


def test_happy_path_a_retry_after_the_deliverys_week_with_its_segments_left_needs_no_download(world: PipelineWorld) -> None:
    """Scenarios: S-P01-HAPPY-RAW-DELETED"""
    world.seed_import()
    world.store.update(world.job_path(), {"machine": "fetch"})
    assert world.run() is RunOutcome.DONE
    # `stitch` failed; day 8: the delivery's seven days are over, the segments' fourteen are not. The retry reads nothing else of it.
    del world.gcs.objects[RAW]
    world.store.update(world.job_path(), {"status": "starting", "machine": "std", "steps.stitch": {"status": "failed"}})

    assert world.run() is RunOutcome.DONE

    assert deliveries(world) == 1
    assert world.log_lines().count("step fetch started") == 1
    assert world.log_lines().count("step extract started") == 1
    assert world.job()["status"] == "awaiting_approval"


def test_bad_path_an_unproved_frame_too_wide_is_cut_to_fit_and_keeps_the_delivery(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P06-BAD-OVER-LIMIT, S-P01-BAD-WEAK-GUESS-TOO-WIDE"""
    world.http.serve("/s2/visual.tif", write_sentinel2(render_world(99), tmp_path / "elsewhere.tif").read_bytes())
    world.http.route("POST", OVERPASS_PATH, lambda _request: Reply.json(json.dumps(overpass_answer(render_world(99)))))
    monkeypatch.setattr(locate, "MAX_SCAN_PIXELS", 1000)
    world.seed_import()

    assert world.run() is RunOutcome.WAITING

    scan = record(world.version()["scan"])
    assert max(int(str(scan["width"])), int(str(scan["height"]))) <= 1000
    assert world.gcs.names("usgs-raw/") == [RAW]
    assert any(line.startswith("not proved") for line in world.log_lines())
    assert world.version()["state"] == "needs_gcps"


def test_bad_path_on_a_worker_an_unproved_crop_keeps_the_delivery(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P01-BAD-WEAK-GUESS-KEEPS-RAW"""
    world.http.serve("/s2/visual.tif", write_sentinel2(render_world(99), tmp_path / "elsewhere.tif").read_bytes())
    world.http.route("POST", OVERPASS_PATH, lambda _request: Reply.json(json.dumps(overpass_answer(render_world(99)))))
    world.seed_import()

    assert world.runner(replace(world.config, execution="worker")).run() is RunOutcome.WAITING

    assert world.gcs.names("usgs-raw/") == [RAW]
    assert DELETED not in world.log_lines()
