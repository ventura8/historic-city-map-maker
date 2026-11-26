"""A USGS import job that stops and resumes: SIGTERM, cancels, maintenance, expired addresses, short deliveries."""

import hashlib
import io
import os
import signal
import tempfile
from pathlib import Path

from hcm_pipeline.contract import Errors
from hcm_pipeline.model import Timestamp
from hcm_pipeline.runner import RunOutcome

from tests.fakes.usgs_m2m import MAINTENANCE_PAGE
from tests.fakes.usgs_m2m import Reply as M2MReply
from tests.fakes.world import CITY, ENTITY_ID, FRESH_SIGNATURE, GOOD_SIGNATURE, JOB_ID, NOW, TEST_CHUNK_BYTES, PipelineWorld, dig

RAW = f"usgs-raw/corona2/{ENTITY_ID}/{ENTITY_ID}.tgz"
WORK = f"work/{CITY}/{JOB_ID}/"


def step_statuses(world: PipelineWorld) -> dict[str, str]:
    steps = world.job()["steps"]
    assert isinstance(steps, dict)
    return {name: str(record["status"]) for name, record in steps.items()}


def test_bad_path_sigterm_after_a_cancel_cancels_the_job_and_cleans_up(world: PipelineWorld) -> None:
    """Scenarios: S-P01-BAD-SIGTERM"""
    world.seed_import()
    store = world.store

    def cancel_then_sigterm(name: str, start: int) -> None:
        if name.endswith(".tgz") and start == TEST_CHUNK_BYTES:
            store.update(world.job_path(), {"cancelRequested": True})
            os.kill(os.getpid(), signal.SIGTERM)

    world.gcs.on_chunk = cancel_then_sigterm

    outcome = world.run()

    job = world.job()
    assert outcome is RunOutcome.CANCELLED
    assert job["status"] == "cancelled"
    assert job["finishedAt"] == Timestamp.at(NOW)
    assert world.version()["state"] == "cancelled"
    assert world.gcs.names(WORK) == []
    assert not list(Path(tempfile.gettempdir()).glob(f"hcm-{JOB_ID}-*"))


def test_bad_path_sigterm_without_a_cancel_requeues_and_the_resume_continues_the_download(world: PipelineWorld) -> None:
    """Scenarios: S-P01-BAD-SIGTERM-RESUME"""
    world.seed_import()
    world.sigterm_during_delivery(TEST_CHUNK_BYTES)

    first = world.run()

    job = world.job()
    assert first is RunOutcome.REQUEUED
    assert (job["status"], job["retryAt"]) == ("queued", Timestamp.at(NOW + 60))
    assert step_statuses(world)["fetch"] == "pending"
    assert world.gcs.names(WORK) == [f"{WORK}fetch.checkpoint.json"]
    assert "lease" not in job

    world.gcs.on_chunk = None
    second = world.run()

    ranges = [request.headers.get("range") for request in world.http.requests if request.path.endswith(".tgz")]
    assert second is RunOutcome.DONE
    assert ranges == [None, f"bytes={2 * TEST_CHUNK_BYTES}-"]
    # The resumed delivery arrived whole (its SHA-256), then `locate` deleted it (M7 §5).
    assert dig(world.job(), "steps", "fetch", "sha256") == hashlib.sha256(world.delivery).hexdigest()
    assert world.gcs.names("usgs-raw/") == []
    assert world.job()["status"] == "awaiting_approval"


def test_bad_path_usgs_maintenance_waits_and_backs_off(world: PipelineWorld) -> None:
    """Scenarios: S-P01-BAD-USGS-MAINTENANCE"""
    world.seed_import()
    world.m2m.enqueue("download-options", M2MReply.page(503, MAINTENANCE_PAGE))

    first = world.run()

    job = world.job()
    assert first is RunOutcome.WAITING
    assert (job["status"], job["waitReason"], job["retryAt"]) == ("waiting_usgs", "usgs-maintenance", Timestamp.at(NOW + 30 * 60))
    assert step_statuses(world)["fetch"] == "pending"

    world.store.update(world.job_path(), {"status": "queued"})
    world.m2m.enqueue("download-options", M2MReply.page(503, MAINTENANCE_PAGE))
    second = world.run()

    assert second is RunOutcome.WAITING
    assert world.job()["retryAt"] == Timestamp.at(NOW + 60 * 60)


def test_bad_path_an_expired_download_address_is_retrieved_again_and_never_logged(world: PipelineWorld, log_stream: io.StringIO) -> None:
    """Scenarios: S-P01-BAD-SIGNED-URL-EXPIRED"""
    world.valid_signatures = {FRESH_SIGNATURE}
    world.seed_import()

    outcome = world.runner().run("fetch")

    downloads = [request.query.get("sig") for request in world.http.requests if request.path.endswith(".tgz")]
    assert outcome is RunOutcome.DONE
    assert downloads == [GOOD_SIGNATURE, FRESH_SIGNATURE]
    assert "download-retrieve" in world.m2m.endpoints()
    assert world.gcs.objects[RAW].data == world.delivery
    written = world.everything_written(log_stream)
    assert GOOD_SIGNATURE not in written
    assert FRESH_SIGNATURE not in written


def test_bad_path_a_short_delivery_is_discarded(world: PipelineWorld) -> None:
    """Scenarios: S-P01-BAD-SIZE-MISMATCH"""
    world.offer_download(len(world.delivery) + 4096)
    world.seed_import()

    outcome = world.run()

    job = world.job()
    assert outcome is RunOutcome.FAILED
    assert dig(job, "error", "code") == Errors.DOWNLOAD_INCOMPLETE
    assert world.gcs.names("usgs-raw/") == []
    checkpoint = world.gcs.objects[f"{WORK}fetch.checkpoint.json"].data
    assert b'"session": null' in checkpoint
