"""`fetch` against the fake USGS: the waits, the refusals, the resumes and the shared deliveries."""

import json
import logging
from pathlib import Path

import httpx
import pytest
from hcm_pipeline.contract import Errors
from hcm_pipeline.documents import Version
from hcm_pipeline.joblog import JobLog
from hcm_pipeline.jobs import JobContext, RunFlags
from hcm_pipeline.model import Job, Timestamp
from hcm_pipeline.runner import RunOutcome
from hcm_pipeline.secrets import SecretUnavailableError
from hcm_pipeline.steps.fetch import DROP_ATTEMPTS, Checkpoint, _skipping, delivery_name, transfer_size

from tests.fakes.http import Reply
from tests.fakes.usgs_m2m import FORBIDDEN_PAGE
from tests.fakes.usgs_m2m import Reply as M2MReply
from tests.fakes.world import CITY, ENTITY_ID, JOB_ID, NOW, TEST_CHUNK_BYTES, PipelineWorld, dig

RAW = f"usgs-raw/corona2/{ENTITY_ID}/{ENTITY_ID}.tgz"
CHECKPOINT = f"work/{CITY}/{JOB_ID}/fetch.checkpoint.json"


def fetch(world: PipelineWorld) -> RunOutcome:
    return world.runner().run("fetch")


def only(world: PipelineWorld, step: str) -> RunOutcome:
    return world.runner().run(step)


def error_code(world: PipelineWorld) -> str:
    return str(dig(world.job(), "error", "code"))


def test_happy_path_a_delivery_another_city_fetched_is_reused(world: PipelineWorld) -> None:
    world.seed_import()
    world.gcs.put(RAW, world.delivery)

    assert fetch(world) is RunOutcome.DONE
    assert not any(request.path.endswith(".tgz") for request in world.http.requests)
    assert dig(world.job(), "steps", "fetch", "gcsPath") == RAW


def test_happy_path_a_staged_dds_delivery_is_used_when_m2m_has_not_listed_it(world: PipelineWorld) -> None:
    """Paid order-page TIFFs staged under usgs-raw/ before EarthExplorer lists the download."""
    world.seed_import()
    world.offer_download(10, available=False)
    world.gcs.put(RAW, world.delivery)

    assert fetch(world) is RunOutcome.DONE
    assert dig(world.job(), "steps", "fetch", "gcsPath") == RAW
    assert not any(request.path.endswith(".tgz") for request in world.http.requests)


def test_happy_path_a_download_reports_its_bytes_of_the_total_as_they_arrive(world: PipelineWorld) -> None:
    world.seed_import()
    size = len(world.delivery)

    def five_seconds_later(_name: str, _start: int) -> None:
        world.clock.now += 5

    world.gcs.on_chunk = five_seconds_later

    assert fetch(world) is RunOutcome.DONE
    reports = [fields for path, fields in world.store.writes if path == world.job_path() and "steps.fetch.bytes" in fields]
    received = [int(str(report["steps.fetch.bytes"])) for report in reports]
    assert len(reports) >= 2
    assert received == sorted(received)
    assert 0 < received[0] < size
    assert {report["steps.fetch.totalBytes"] for report in reports} == {size}
    assert all(0 < float(str(report["progress"])) <= 0.25 for report in reports)
    # Done, the step keeps the delivery's size and the job its share of the progress.
    assert (dig(world.job(), "steps", "fetch", "bytes"), world.job()["progress"]) == (size, 0.25)


def test_happy_path_a_download_still_being_prepared_waits_ten_minutes(world: PipelineWorld) -> None:
    world.seed_import()
    world.m2m.set_data("download-request", {"availableDownloads": [], "preparingDownloads": [{"downloadId": 1}]})
    world.m2m.set_data("download-retrieve", {"available": [], "requested": [{"downloadId": 1}]})

    assert fetch(world) is RunOutcome.WAITING
    job = world.job()
    assert (job["status"], job["waitReason"], job["retryAt"]) == ("waiting_usgs", "usgs-preparing", Timestamp.at(NOW + 600))


def test_happy_path_a_rate_limit_waits_its_retry_after(world: PipelineWorld) -> None:
    world.seed_import()
    world.m2m.enqueue("download-options", M2MReply.envelope(error_code="RATE_LIMIT_USER_DL", status=429, headers={"Retry-After": "120"}))

    assert fetch(world) is RunOutcome.WAITING
    assert (world.job()["waitReason"], world.job()["retryAt"]) == ("rate-limited", Timestamp.at(NOW + 120))


@pytest.mark.parametrize(
    ("scenario", "code"),
    [("not-scanned", Errors.NOT_SCANNED), ("bad-token", Errors.USGS_CREDENTIALS), ("m2m-error", Errors.USGS_UNAVAILABLE)],
)
def test_bad_path_a_refused_fetch_fails_with_its_code(world: PipelineWorld, scenario: str, code: str) -> None:
    world.seed_import()
    if scenario == "not-scanned":
        world.offer_download(10, available=False)
    if scenario == "bad-token":
        world.m2m.enqueue("download-options", M2MReply.page(403, FORBIDDEN_PAGE))
        world.m2m.enqueue("download-options", M2MReply.page(403, FORBIDDEN_PAGE))
    if scenario == "m2m-error":
        world.m2m.enqueue("download-options", M2MReply.envelope(error_code="UNKNOWN", status=500))

    assert fetch(world) is RunOutcome.FAILED
    assert dig(world.job(), "error", "code") == code


class NoSecrets:
    """Secret Manager without the USGS secrets (the Setup Assistant's USGS card was never completed)."""

    def read(self, name: str) -> str:
        raise SecretUnavailableError(f"no {name}")


def test_bad_path_missing_usgs_credentials_mean_usgs_is_not_configured(world: PipelineWorld) -> None:
    world.seed_import()
    world.secrets = NoSecrets()

    assert fetch(world) is RunOutcome.FAILED
    assert dig(world.job(), "error", "code") == Errors.USGS_NOT_CONFIGURED


def test_bad_path_a_host_that_ignores_ranges_still_resumes_from_the_checkpoint(world: PipelineWorld) -> None:
    world.seed_import()
    world.delivery_ranges = False
    world.sigterm_during_delivery(TEST_CHUNK_BYTES)
    assert fetch(world) is RunOutcome.REQUEUED
    world.gcs.on_chunk = None

    assert fetch(world) is RunOutcome.DONE
    assert world.gcs.objects[RAW].data == world.delivery


def test_bad_path_an_expired_upload_session_starts_over(world: PipelineWorld) -> None:
    world.seed_import()
    world.sigterm_during_delivery(TEST_CHUNK_BYTES)
    assert fetch(world) is RunOutcome.REQUEUED
    world.gcs.on_chunk = None
    world.gcs.expire_sessions()

    assert fetch(world) is RunOutcome.DONE
    assert world.gcs.objects[RAW].data == world.delivery


def test_bad_path_an_address_that_keeps_expiring_fails_the_download(world: PipelineWorld) -> None:
    world.seed_import()
    world.valid_signatures = set()

    assert fetch(world) is RunOutcome.FAILED
    assert dig(world.job(), "error", "code") == Errors.DOWNLOAD_INCOMPLETE


def dropped_reply(world: PipelineWorld, sent: int) -> Reply:
    """A delivery whose connection closes after `sent` bytes while its Content-Length announces the whole file."""
    return Reply(200, world.delivery[:sent], "application/x-gzip", {"X-Size": str(len(world.delivery))})


def test_happy_path_a_dropped_download_resumes_from_the_bytes_held(world: PipelineWorld) -> None:
    """Scenarios: S-P01-HAPPY-DROP-RESUMED"""
    # Live 2026-11-14: RemoteProtocolError, peer closed connection at 1.20 of 1.23 GB, failed the job.
    world.seed_import()
    world.http.enqueue(f"/download/{ENTITY_ID}.tgz", dropped_reply(world, 2 * TEST_CHUNK_BYTES + 7))

    assert fetch(world) is RunOutcome.DONE
    assert world.gcs.objects[RAW].data == world.delivery
    # Asked again from the bytes the session holds (none here: httpx read the short body in one piece before it failed).
    assert len([request for request in world.http.requests if request.path.endswith(".tgz")]) == 2


def test_bad_path_a_download_that_keeps_dropping_fails_and_keeps_its_bytes(world: PipelineWorld) -> None:
    """Scenarios: S-P01-BAD-DROP-REPEATED"""
    world.seed_import()
    for _ in range(DROP_ATTEMPTS):
        world.http.enqueue(f"/download/{ENTITY_ID}.tgz", dropped_reply(world, TEST_CHUNK_BYTES + 7))

    assert fetch(world) is RunOutcome.FAILED
    assert error_code(world) == Errors.DOWNLOAD_INCOMPLETE
    assert "dropped" in str(dig(world.job(), "error", "message"))
    # The session and its bytes stay for a retry to continue from.
    assert json.loads(world.gcs.objects[CHECKPOINT].data)["session"] is not None


def test_bad_path_a_delivery_host_in_maintenance_waits(world: PipelineWorld) -> None:
    world.seed_import()
    world.http.enqueue(f"/download/{ENTITY_ID}.tgz", Reply(503, b"<html>offline</html>", "text/html"))

    assert fetch(world) is RunOutcome.WAITING
    assert world.job()["waitReason"] == "usgs-maintenance"


def test_bad_path_a_delivery_host_error_fails_as_unavailable(world: PipelineWorld) -> None:
    world.seed_import()
    world.http.enqueue(f"/download/{ENTITY_ID}.tgz", Reply(500, b"oops", "text/plain"))

    assert fetch(world) is RunOutcome.FAILED
    assert dig(world.job(), "error", "code") == Errors.USGS_UNAVAILABLE


def test_happy_path_a_landsat_bundle_larger_than_announced_is_kept(world: PipelineWorld) -> None:
    """Scenarios: S-P30-HAPPY-BUNDLE-SIZE"""
    # Landsat announces a band-scale filesize; Content-Length is the full tar.
    world.seed_import()
    world.offer_download(TEST_CHUNK_BYTES + 10)

    assert fetch(world) is RunOutcome.DONE
    assert world.gcs.objects[RAW].data == world.delivery


def test_bad_path_a_truncated_delivery_is_discarded(world: PipelineWorld) -> None:
    """Scenarios: S-P01-BAD-SIZE-MISMATCH"""
    # Short of the transfer size (the announcement or Content-Length).
    world.seed_import()
    world.offer_download(len(world.delivery) + 4096)

    assert fetch(world) is RunOutcome.FAILED
    assert dig(world.job(), "error", "code") == Errors.DOWNLOAD_INCOMPLETE
    assert world.gcs.names("usgs-raw/") == []


def test_happy_path_the_delivery_is_named_by_its_header_else_its_address() -> None:
    named = httpx.Response(
        200, headers={"content-disposition": 'attachment; filename="DS1-2_a.tgz"'}, request=httpx.Request("GET", "https://x/y/z.tgz?sig=1")
    )
    plain = httpx.Response(200, request=httpx.Request("GET", "https://x/y/E1.tar.gz"))
    odd = httpx.Response(200, headers={"content-disposition": "filename=../../etc"}, request=httpx.Request("GET", "https://x/"))

    assert delivery_name(named, "E1") == "DS1-2_a.tgz"
    assert delivery_name(plain, "E1") == "E1.tar.gz"
    assert delivery_name(odd, "E1") == "E1.tgz"


def test_happy_path_a_stream_without_range_support_is_skipped_to_the_offset() -> None:
    assert b"".join(_skipping(iter([b"abc", b"de", b"fghij"]), 4)) == b"efghij"


def test_happy_path_transfer_size_takes_content_length_when_usgs_understates_the_bundle() -> None:
    """Landsat's Product Bundle filesize is often band-scale; Content-Length is the tar actually requested."""
    understated = httpx.Response(200, headers={"content-length": "900"}, request=httpx.Request("GET", "https://x/a"))
    ranged = httpx.Response(
        206, headers={"content-range": "bytes 10-99/900", "content-length": "90"}, request=httpx.Request("GET", "https://x/a")
    )
    plain = httpx.Response(200, request=httpx.Request("GET", "https://x/a"))

    assert transfer_size(100, understated) == 900
    assert transfer_size(100, ranged) == 900
    assert transfer_size(100, plain) == 100
    assert transfer_size(1000, understated) == 1000


def test_happy_path_a_delivery_the_exact_chunk_size_is_kept(world: PipelineWorld) -> None:
    world.delivered = world.scene.delivery.read_bytes()[: 2 * TEST_CHUNK_BYTES]
    world.offer_download(2 * TEST_CHUNK_BYTES)
    world.seed_import()

    assert only(world, "fetch") is RunOutcome.DONE
    assert world.gcs.objects[RAW].data == world.delivery


def test_bad_path_a_delivery_short_of_its_content_length_is_discarded(world: PipelineWorld) -> None:
    """The host announces more bytes than it sends (Content-Length / options larger than the body)."""
    world.delivered = world.scene.delivery.read_bytes()[: 2 * TEST_CHUNK_BYTES]
    world.offer_download(3 * TEST_CHUNK_BYTES)
    world.seed_import()

    assert only(world, "fetch") is RunOutcome.FAILED
    assert error_code(world) == Errors.DOWNLOAD_INCOMPLETE
    assert world.gcs.names("usgs-raw/") == []


def test_happy_path_a_session_finished_before_the_sigterm_is_used_as_is(world: PipelineWorld) -> None:
    size = len(world.delivery)
    world.seed_import()
    world.sigterm_during_delivery((size // TEST_CHUNK_BYTES) * TEST_CHUNK_BYTES)
    assert only(world, "fetch") is RunOutcome.REQUEUED
    world.gcs.on_chunk = None

    assert only(world, "fetch") is RunOutcome.DONE
    assert len([request for request in world.http.requests if request.path.endswith(".tgz")]) == 1


def test_bad_path_a_crash_mid_checkpoint_write_leaves_the_old_checkpoint_intact(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    world.seed_import()
    ctx = JobContext(
        world.config,
        world.services(),
        Job.of(JOB_ID, world.job()),
        Version.of(JOB_ID, world.version()),
        tmp_path,
        RunFlags(),
        JobLog(world.store, world.job_path(), world.clock, logging.getLogger("test")),
    )
    Checkpoint(RAW, "session-1", 1).save(ctx)
    local = ctx.local("fetch.checkpoint.json")

    def crash(_fd: int) -> None:
        raise OSError("power cut")

    monkeypatch.setattr("hcm_pipeline.durable.os.fsync", crash)
    with pytest.raises(OSError, match="power cut"):
        Checkpoint(RAW, "session-2", 2).save(ctx)

    assert json.loads(local.read_text(encoding="utf-8")) == {"path": RAW, "session": "session-1", "waits": 1, "size": None}
    assert [path.name for path in tmp_path.iterdir()] == ["fetch.checkpoint.json"]
    assert Checkpoint.load(ctx) == Checkpoint(RAW, "session-1", 1)
