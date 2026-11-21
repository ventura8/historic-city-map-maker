"""The local worker runs a claimed import through the API and signed URLs (M7, docs/research/M7-local-worker.md §1).

The real worker (`Worker.build`, its loop, runtime, stores and proxy) against the fake server side of
`tests/fakes/worker_api.py` and the pipeline's loopback world (the USGS delivery, STAC and Overpass): the steps are the
pipeline's own, unchanged.
"""

import hashlib
import json
import os
import shutil
import time
from collections.abc import Callable, Iterator, Mapping
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from hcm_pipeline.calibrate import chain
from hcm_pipeline.contract import Errors
from hcm_pipeline.m2m import M2MClient, http_client
from hcm_pipeline.secrets import EmulatorSecrets, usgs_credentials
from hcm_pipeline.store import DELETE
from hcm_pipeline.worker.ai_files import AiFiles
from hcm_pipeline.worker.ai_state import STARTER_VERSION
from hcm_pipeline.worker.args import Endpoints, WorkerArgs
from hcm_pipeline.worker.loop import Pass
from hcm_pipeline.worker.sweep import DAY_SECONDS
from hcm_pipeline.worker.worker import Worker

from tests.contracts_loader import record
from tests.fakes.http import FakeHttpServer, Reply
from tests.fakes.sidecar import BoxSidecar
from tests.fakes.worker_api import PROJECT, FakeWorkerApi, StoredObject
from tests.fakes.world import (
    CITY,
    ENTITY_ID,
    JOB_ID,
    LAYER_ID,
    OVERPASS_PATH,
    STAC_PATH,
    FakeClock,
    PipelineWorld,
    city_bounds,
    dig,
    small_city,
)

STEPS = ("fetch", "extract", "stitch", "locate", "reference", "georef", "warp", "export", "pyramid", "register")
# A city on Mapbox's path (the world's `seed_city`): the COG and the Studio file, since M12 the archive and its thumbnail, and since
# M15 the proved frame later frames tie to.
VERSION_FILES = (
    "align.tif",
    "cog.tif",
    "preview.png",
    "reference-osm.png",
    "reference-s2.jpg",
    "scan-preview.jpg",
    "scan.tif",
    "studio.tif",
    "thumb.webp",
    "tiles.pmtiles",
)
RAW = f"usgs-raw/corona2/{ENTITY_ID}/{ENTITY_ID}.tgz"


@pytest.fixture
def api(world: PipelineWorld) -> Iterator[FakeWorkerApi]:
    with FakeHttpServer() as server:
        fake = FakeWorkerApi(world.store, server, FakeClock(world.clock.now)).install()
        secrets = EmulatorSecrets("e2e-ok")
        fake.m2m = lambda: M2MClient(http_client(world.m2m.base_url), usgs_credentials(secrets))
        yield fake


def local_import(world: PipelineWorld) -> None:
    """An import queued for the owner's computer, as the dispatcher leaves it (no machine, waiting for a worker)."""
    world.seed_import(status="queued")
    world.store.update(world.job_path(), {"runOn": "local", "waitReason": "worker", "machine": DELETE})


@pytest.fixture
def built() -> Iterator[list[Worker]]:
    """The workers a test builds, closed after it (their page sockets and clients)."""
    workers: list[Worker] = []
    yield workers
    for worker in workers:
        worker.close()


def signed_in_worker(
    world: PipelineWorld, api: FakeWorkerApi, work: Path, built: list[Worker], clock: Callable[[], float] = time.time
) -> Worker:
    args = WorkerArgs(
        city=CITY,
        project=PROJECT,
        port=0,
        work=work,
        emulators=True,
        endpoints=Endpoints.emulated(PROJECT, api.env()),
        stac_url=world.http.url(STAC_PATH),
        overpass_url=world.http.url(OVERPASS_PATH),
    )
    worker = Worker.build(args, "127.0.0.1", clock)
    built.append(worker)
    assert worker.actions.sign_in(*api.sign_in_tokens(api.clock() + 3600)) is None
    return worker


def aged(work: Path, name: str, moment: float) -> Path:
    """A file of the work folder last written at `moment`."""
    file = work / name
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(b"left by an earlier import")
    os.utime(file, (moment, moment))
    return file


def statuses(world: PipelineWorld) -> dict[str, str]:
    steps = world.job()["steps"]
    assert isinstance(steps, dict)
    return {name: str(record["status"]) for name, record in steps.items()}


def step_requests(api: FakeWorkerApi) -> list[Mapping[str, object]]:
    found = [call.data.get("request") for call in api.calls if call.name == "worker-step"]
    return [request for request in found if isinstance(request, dict)]


def test_happy_path_the_worker_runs_a_claimed_import_through_the_api_and_signed_urls(
    world: PipelineWorld, api: FakeWorkerApi, tmp_path: Path, built: list[Worker]
) -> None:
    """Scenarios: S-P04-HAPPY-WORKER-RUN"""
    local_import(world)
    worker = signed_in_worker(world, api, tmp_path / "work", built)

    assert worker.loop.run_once() is Pass.RAN

    # Every step ran, unchanged; the version awaits approval.
    job = world.job()
    assert (job["status"], job["waitReason"]) == ("awaiting_approval", "approval")
    assert statuses(world) == dict.fromkeys(STEPS, "done")
    assert world.version()["state"] == "awaiting_approval"
    assert dig(job, "worker", "id") == worker.worker_id
    # The documents went through worker.step: the job, its version, its log lines.
    paths = {str(request.get("path") or request.get("collection")) for request in step_requests(api)}
    assert {world.job_path(), world.version_path(), f"{world.job_path()}/logs", f"cities/{CITY}"} <= paths
    # The version's files went up through signed PUTs, and nothing else was ever signed or sent.
    version_files = [f"rasters/{CITY}/{LAYER_ID}/{JOB_ID}/{name}" for name in VERSION_FILES]
    assert sorted(path for method, path in api.sent if method == "PUT") == version_files
    assert sorted(api.objects) == version_files
    assert all(path.startswith(f"rasters/{CITY}/{LAYER_ID}/{JOB_ID}/") for _method, path in api.signed)
    assert world.gcs.names() == []
    # The delivery, the segments and the frame were the work folder's: recorded there, never signed.
    assert (dig(job, "steps", "fetch", "gcsPath"), dig(job, "steps", "fetch", "sha256")) == (
        RAW,
        hashlib.sha256(world.delivery).hexdigest(),
    )
    assert str(dig(job, "steps", "extract", "gcsPath")).startswith(f"work/{CITY}/{JOB_ID}/segments/")
    assert str(dig(job, "steps", "stitch", "gcsPath")) == f"work/{CITY}/{JOB_ID}/frame.json"
    assert not (tmp_path / "work" / RAW).exists()
    assert list((tmp_path / "work" / "reference" / CITY / "s2").glob("*.tif"))
    # The run's end was reported.
    assert api.ended() == [{"cityId": CITY, "workerId": worker.worker_id, "jobId": JOB_ID, "outcome": "done"}]
    assert worker.state.snapshot()["state"] == "idle"


def test_happy_path_an_idle_pass_sweeps_what_failed_imports_left_on_the_disk(
    world: PipelineWorld, api: FakeWorkerApi, tmp_path: Path, built: list[Worker]
) -> None:
    """Scenarios: S-P04-HAPPY-DISK-SWEPT"""
    work = tmp_path / "work"
    worker = signed_in_worker(world, api, work, built, api.clock)
    old = api.clock() - 15 * DAY_SECONDS
    scratch = aged(work, f"work/{CITY}/failed-job/segments/a.tif", old)
    delivery = aged(work, "usgs-raw/corona2/E1/E1.tgz", api.clock() - 8 * DAY_SECONDS)
    recent = aged(work, f"work/{CITY}/waiting-job/segments/a.tif", api.clock() - DAY_SECONDS)

    assert worker.loop.run_once() is Pass.IDLE

    assert not scratch.exists()
    assert not delivery.exists()
    assert recent.exists()


def test_bad_path_the_sweep_of_a_claimed_pass_leaves_the_claimed_jobs_scratch_and_the_deliveries(
    world: PipelineWorld, api: FakeWorkerApi, tmp_path: Path, built: list[Worker]
) -> None:
    """Scenarios: S-P04-BAD-SWEEP-KEEPS-CLAIMED"""
    for _ in range(3):
        world.http.enqueue(OVERPASS_PATH, Reply(503, b"<html>busy</html>", "text/html"))
    local_import(world)
    work = tmp_path / "work"
    worker = signed_in_worker(world, api, work, built, api.clock)
    old = api.clock() - 30 * DAY_SECONDS
    claimed = aged(work, f"work/{CITY}/{JOB_ID}/old-scratch.bin", old)
    other = aged(work, f"work/{CITY}/failed-job/segments/a.tif", old)
    delivery = aged(work, "usgs-raw/corona2/E1/E1.tgz", old)

    assert worker.loop.run_once() is Pass.RAN

    # The run failed after `locate`: nothing but the sweep could have touched its scratch.
    assert world.job()["status"] == "failed"
    assert claimed.exists()
    assert not other.exists()
    assert delivery.exists()

    assert worker.loop.run_once() is Pass.IDLE
    assert not delivery.exists()


def test_bad_path_a_disk_too_small_fails_the_import_before_its_download(
    world: PipelineWorld, api: FakeWorkerApi, tmp_path: Path, built: list[Worker], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P04-BAD-NO-FREE-SPACE"""
    local_import(world)
    worker = signed_in_worker(world, api, tmp_path / "work", built)
    monkeypatch.setattr(shutil, "disk_usage", lambda _path: SimpleNamespace(free=len(world.delivery)))

    assert worker.loop.run_once() is Pass.RAN

    job = world.job()
    assert (job["status"], dig(job, "error", "code")) == ("failed", Errors.PROCESSING_FAILED)
    assert "free some disk" in str(dig(job, "error", "message"))
    assert statuses(world)["fetch"] == "failed"
    assert not list((tmp_path / "work" / "usgs-raw").glob("**/*.tgz"))
    assert [part.stat().st_size for part in (tmp_path / "work" / ".sessions").glob("*")] == []


def test_bad_path_a_worker_that_lost_its_job_stops_writing_and_reports_the_end(
    world: PipelineWorld, api: FakeWorkerApi, tmp_path: Path, built: list[Worker]
) -> None:
    """Scenarios: S-P04-BAD-NOT-HOLDER"""
    local_import(world)
    worker = signed_in_worker(world, api, tmp_path / "work", built)

    refused: list[int] = []

    def stitch_starts(request: Mapping[str, object]) -> bool:
        """The server gives the job to another worker as `stitch` is about to start (the call being answered is the last)."""
        fields = request.get("fields")
        starts = isinstance(fields, dict) and fields.get("step") == "stitch"
        refused.extend([len(api.calls) - 1] if starts and not refused else [])
        return starts

    api.revoke_when = stitch_starts

    assert worker.loop.run_once() is Pass.RAN

    assert api.names()[refused[0] + 1 :] == ["worker-end"]
    assert api.ended()[0]["outcome"] == "done"
    assert statuses(world) == {"fetch": "done", "extract": "done"}
    assert "step stitch started" not in world.log_lines()
    assert world.job()["status"] == "running"
    assert api.objects == {}


def test_happy_path_the_real_worker_asks_a_sidecar_through_the_box(
    world: PipelineWorld, api: FakeWorkerApi, tmp_path: Path, built: list[Worker], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P04-HAPPY-WORKER-RUN, S-P07-HAPPY-GPU"""
    monkeypatch.setenv("HCM_STARTER", STARTER_VERSION)
    monkeypatch.setattr(chain, "MATCHER_PROOF_SIDE_GROUND_M", 20_000.0)
    local_import(world)
    small_city(world)
    root = tmp_path / "ai"
    (root / "box").mkdir(parents=True)
    worker = signed_in_worker(world, api, tmp_path / "work", built)
    assert worker.state.snapshot()["ai"] == {"state": "idle", "wanted": False, "image": None, "files": False}
    worker.runtime.ai_root = root
    sidecar = BoxSidecar(root / "box")
    worker.runtime.ai_sleep = sidecar
    files = AiFiles(root / "files", worker.client)
    (root / "files").mkdir()
    (root / "files" / "ready.json").write_text(json.dumps({"pins": files._stamp()}), encoding="utf-8")
    # The real pins' weights are not in a test: that the placed ones are hashed each run is `test_ai_files.py`'s.
    monkeypatch.setattr(AiFiles, "_weights_intact", lambda _self: True)

    assert worker.loop.run_once() is Pass.RAN

    found = record(world.version()["calibration"])
    assert sidecar.answered
    assert found["how"] == "matcher"
    assert record(found["proposer"])["device"] == "gpu"
    # The panel heard, and the starter can read the device on `/state`.
    told = [call.data["ai"] for call in api.calls if call.name == "worker-hello" and "ai" in call.data]
    assert told[0] == {"state": "idle"}
    assert {"state": "ready", "device": "gpu", "deviceName": "NVIDIA RTX 3080"} in told
    state = record(worker.state.snapshot()["ai"])
    # The run is over: `/state` stops saying `wanted`, and the starter removes the sidecar; the panel still reads the device.
    assert (state["state"], state["wanted"], state["files"], state["device"]) == ("ready", False, True, "gpu")
    assert not list((root / "box").glob("*.request.npz"))
    assert (root / "files" / "code" / "matcher" / "serve.py").exists()
    assert any(line.startswith("local AI (aliked-lightglue, gpu, NVIDIA RTX 3080):") for line in world.log_lines())


def test_bad_path_a_worker_under_an_old_starter_goes_to_points_and_says_so(
    world: PipelineWorld, api: FakeWorkerApi, tmp_path: Path, built: list[Worker], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""
    monkeypatch.delenv("HCM_STARTER", raising=False)
    local_import(world)
    small_city(world)
    worker = signed_in_worker(world, api, tmp_path / "work", built)
    assert record(worker.state.snapshot()["ai"])["why"] == "old-starter"

    assert worker.loop.run_once() is Pass.RAN

    assert record(world.version()["calibration"])["how"] == "none"
    assert any("local AI unavailable (old-starter)" in line for line in world.log_lines())


def test_bad_path_an_older_version_the_server_cannot_read_never_fails_the_import(
    world: PipelineWorld, api: FakeWorkerApi, tmp_path: Path, built: list[Worker]
) -> None:
    """Scenarios: S-P06-BAD-JOINT-UNREADABLE
    Live 2026-11-08: a same-date frame failed in georef on another version's read."""
    local_import(world)
    broken = world.version_path("v-older")
    world.store.seed(broken, {**world.version(), "jobId": "v-older", "state": "published"})
    api.unreadable.add(broken)
    worker = signed_in_worker(world, api, tmp_path / "work", built)

    assert worker.loop.run_once() is Pass.RAN

    job = world.job()
    assert (job["status"], job["waitReason"]) == ("awaiting_approval", "approval")
    assert {"op": "get", "path": broken} in step_requests(api)
    assert any(line.startswith("1 other frames could not be read") and "v-older" in line for line in world.log_lines())
    assert "alignment" not in record(world.version()["calibration"])
    assert api.ended()[-1]["outcome"] == "done"


def test_bad_path_a_partner_the_server_left_out_or_cannot_be_measured_never_fails_the_import(
    world: PipelineWorld, api: FakeWorkerApi, tmp_path: Path, built: list[Worker]
) -> None:
    """Scenarios: S-P06-BAD-JOINT-UNREADABLE
    The review of 0421875: an invalid version the server leaves out of its list is counted, and an accepted frame whose `align.tif`
    GDAL cannot read is left out by name; the frame is fitted alone and the import goes on."""
    local_import(world)
    accepted = {"state": "published", "output": {"bounds": city_bounds()}, "calibration": {"how": "votes"}, "georef": {"method": "auto"}}
    world.store.seed(world.version_path("v-invalid"), {**world.version(), "jobId": "v-invalid", "year": "nineteen sixty"})
    api.invalid.add(world.version_path("v-invalid"))
    world.store.seed(world.version_path("v-corrupt"), {**world.version(), **accepted, "jobId": "v-corrupt", "year": 1966})
    api.objects[f"rasters/{CITY}/{LAYER_ID}/v-corrupt/align.tif"] = StoredObject(b"not a GeoTIFF", next(api.generations))
    worker = signed_in_worker(world, api, tmp_path / "work", built)

    assert worker.loop.run_once() is Pass.RAN

    job = world.job()
    assert (job["status"], job["waitReason"]) == ("awaiting_approval", "approval")
    lines = world.log_lines()
    assert "1 of the city's frames could not be read and were left out" in lines
    assert "the accepted frame v-corrupt could not be measured: fitted without it" in lines
    assert {"op": "get", "path": world.version_path("v-invalid")} not in step_requests(api)
    assert "alignment" not in record(world.version()["calibration"])
    assert api.ended()[-1]["outcome"] == "done"


def test_bad_path_a_partner_whose_download_the_network_cuts_midway_is_left_out_and_the_import_awaits_approval(
    world: PipelineWorld, api: FakeWorkerApi, tmp_path: Path, built: list[Worker], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P06-BAD-JOINT-UNREADABLE
    The review of a6750294: httpx's `ReadError` from a signed download escaped `PARTNER_FAILURES` and failed the import as `internal`,
    naming no frame; the connection reset after the partner's first block now leaves that partner out by name."""
    local_import(world)
    accepted = {"state": "published", "output": {"bounds": city_bounds()}, "calibration": {"how": "votes"}, "georef": {"method": "auto"}}
    world.store.seed(world.version_path("v-cut"), {**world.version(), **accepted, "jobId": "v-cut", "year": 1966})
    api.objects[f"rasters/{CITY}/{LAYER_ID}/v-cut/align.tif"] = StoredObject(b"II*\x00 the partner's image", next(api.generations))
    read = httpx.Response.iter_bytes
    cut: list[str] = []

    def reset(response: httpx.Response, chunk_size: int | None = None) -> Iterator[bytes]:
        blocks = read(response, chunk_size)
        if "/v-cut/align.tif" not in response.request.url.path:
            yield from blocks
            return
        yield next(blocks)
        cut.append(response.request.url.path)
        raise httpx.ReadError("connection reset by peer", request=response.request)

    monkeypatch.setattr(httpx.Response, "iter_bytes", reset)
    worker = signed_in_worker(world, api, tmp_path / "work", built)

    assert worker.loop.run_once() is Pass.RAN

    job = world.job()
    assert (job["status"], job["waitReason"]) == ("awaiting_approval", "approval")
    assert cut == [f"/signed/rasters/{CITY}/{LAYER_ID}/v-cut/align.tif"]
    assert "the accepted frame v-cut could not be measured: fitted without it" in world.log_lines()
    assert "alignment" not in record(world.version()["calibration"])
    assert api.ended()[-1]["outcome"] == "done"
