"""M20 §22 (the owner's request of 2026-11-14): the holder shares its scanned maps from a thread of its own, also while it runs a job,
under the governor's budget (`worker/sharing.py`, `archive/copy.py`'s pacing).

Scenarios: S-P20-HAPPY-ARCHIVE-SHARE, S-P20-BAD-ARCHIVE-SHARE-PAUSED, S-P20-BAD-ARCHIVE-SHARE-STOPPED
"""

import json
import threading
from pathlib import Path

import httpx
import pytest
from hcm_pipeline.archive import report, sidecar
from hcm_pipeline.archive.copy import ShareStoppedError
from hcm_pipeline.archive.intake import ArchiveStore
from hcm_pipeline.archive.model import Probe
from hcm_pipeline.governor.budget import Budget
from hcm_pipeline.worker.api import WorkerApi
from hcm_pipeline.worker.sharing import (
    AGAIN_SECONDS,
    DAY_LIMIT_SECONDS,
    IDLE_SECONDS,
    MIB,
    WAIT_SECONDS,
    SharePacing,
    Sharer,
    sharer,
)
from hcm_pipeline.worker.worker import profile_of

CITY = "bucharest"
WORKER = "w-0123456789abcdef"


class Server:
    """`worker.archiveCopy` and the signed PUTs as the sharing thread meets them; `wanted` answers `answer`."""

    def __init__(self, answer: dict[str, object] | None = None, refuse_progress: bool = False) -> None:
        self.answer = answer if answer is not None else {"idle": "nothing", "computers": 1}
        self.refuse_progress = refuse_progress
        self.calls: list[dict[str, object]] = []
        self.puts: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.method == "PUT":
            self.puts.append(request.url.path)
            return httpx.Response(200, json={"generation": "1"})
        data = json.loads(request.content)["data"]
        self.calls.append(data)
        return self._answer(data["copy"])

    def _answer(self, copy: dict[str, object]) -> httpx.Response:
        if copy["kind"] == "wanted":
            return httpx.Response(200, json={"result": self.answer})
        if copy["kind"] == "progress" and self.refuse_progress:
            refusal = {"message": "no", "status": "FAILED_PRECONDITION", "details": {"code": "apiError.worker.refused"}}
            return httpx.Response(400, json={"error": refusal})
        if copy["kind"] in ("progress", "done"):
            return httpx.Response(200, json={"result": {"status": "queued"}})
        objects = copy["objects"]
        assert isinstance(objects, list)
        path = objects[0]["path"]
        signed = {"path": path, "url": f"http://127.0.0.1:1/put/{path}", "method": "PUT", "headers": {}, "expiresAt": "x", "exists": False}
        return httpx.Response(200, json={"result": {"objects": [signed]}})

    def kinds(self) -> list[object]:
        return [call["copy"]["kind"] for call in self.calls if isinstance(call["copy"], dict)]


def holder(work: Path) -> tuple[ArchiveStore, str, str]:
    store = ArchiveStore(work, lambda _path: Probe("jpeg", 4000, 3000, 3, 8, "rgb"))
    archive_id = store.create()
    store.receive(archive_id, "Harti/1897 plan.jpg", [b"sheet"], 5)
    made = store.scan(archive_id, report.Context(44.43, 2026, sidecar.Sidecar()))
    return store, archive_id, str(made.series[0]["seriesId"])


def api_of(server: Server) -> tuple[WorkerApi, httpx.Client]:
    client = httpx.Client(transport=httpx.MockTransport(server))
    return WorkerApi(client, lambda name: f"http://127.0.0.1:1/{name}", lambda: "token", lambda _seconds: None), client


def built(server: Server, work: Path) -> tuple[Sharer, str, str]:
    api, client = api_of(server)
    store, archive_id, series_id = holder(work)
    return sharer(api, CITY, WORKER, store, client), archive_id, series_id


def test_happy_path_a_named_series_is_shared_with_its_progress_then_done(tmp_path: Path) -> None:
    server = Server()
    made, archive_id, series_id = built(server, tmp_path)
    server.answer = {"copy": {"jobId": "ar-series", "archiveId": archive_id, "seriesId": series_id}, "computers": 2}
    made.profile = lambda: "full"

    assert made.once() == AGAIN_SECONDS

    assert server.kinds() == ["wanted", "progress", "objects", "objects", "done"]
    assert server.calls[0] == {"cityId": CITY, "workerId": WORKER, "copy": {"kind": "wanted", "archives": [archive_id]}}
    assert server.calls[1]["copy"] == {"kind": "progress", "sentBytes": 0, "totalBytes": 5}
    assert server.calls[-1] == {"cityId": CITY, "workerId": WORKER, "jobId": "ar-series", "copy": {"kind": "done", "bytes": 5}}
    assert len(server.puts) == 2


@pytest.mark.parametrize(
    ("answer", "wait"),
    [
        ({"idle": "nothing", "computers": 1}, IDLE_SECONDS),
        ({"idle": "alone", "computers": 0}, IDLE_SECONDS),
        ({"idle": "dayLimit"}, DAY_LIMIT_SECONDS),
    ],
)
def test_bad_path_no_series_to_share_waits_as_the_server_says(tmp_path: Path, answer: dict[str, object], wait: float) -> None:
    server = Server(answer)
    made, _archive, _series = built(server, tmp_path)

    assert made.once() == wait
    assert server.kinds() == ["wanted"]


def test_bad_path_paused_signed_out_or_holding_nothing_asks_nothing(tmp_path: Path) -> None:
    """S-P20-BAD-ARCHIVE-SHARE-PAUSED: the owner's pause, the battery or the heat stop the sharing as they stop the work."""
    server = Server()
    made, _archive, _series = built(server, tmp_path)
    made.profile = lambda: "paused"
    assert made.once() == WAIT_SECONDS
    made.profile, made.signed_in = (lambda: "quiet"), (lambda: False)
    assert made.once() == WAIT_SECONDS
    api, client = api_of(server)
    assert sharer(api, CITY, WORKER, ArchiveStore(tmp_path / "none"), client).once() == IDLE_SECONDS
    assert server.calls == []


def test_bad_path_a_refused_ask_or_a_refused_progress_ends_quietly(tmp_path: Path) -> None:
    refused = Server(refuse_progress=True)
    made, archive_id, series_id = built(refused, tmp_path)
    refused.answer = {"copy": {"jobId": "ar-series", "archiveId": archive_id, "seriesId": series_id}, "computers": 1}

    assert made.once() == AGAIN_SECONDS
    assert refused.kinds() == ["wanted", "progress"]

    broken = Server()
    other, _archive, _series = built(broken, tmp_path / "other")
    broken.answer = {"copy": "not a copy"}
    assert other.once() == IDLE_SECONDS


def test_bad_path_a_server_that_fails_is_asked_again_later(tmp_path: Path) -> None:
    def fail(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400, json={"error": {"message": "no", "status": "FAILED_PRECONDITION", "details": {"code": "apiError.guardPaused"}}}
        )

    client = httpx.Client(transport=httpx.MockTransport(fail))
    api = WorkerApi(client, lambda name: f"http://127.0.0.1:1/{name}", lambda: "token", lambda _seconds: None)
    store, _archive, _series = holder(tmp_path)

    assert sharer(api, CITY, WORKER, store, client).once() == IDLE_SECONDS


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


class Waits(threading.Event):
    """A stop event whose waits only advance the fake clock (and may set the stop after `stop_after` waits)."""

    def __init__(self, clock: Clock, stop_after: int | None = None) -> None:
        super().__init__()
        self.clock, self.stop_after, self.waits = clock, stop_after, list[float]()

    def wait(self, timeout: float | None = None) -> bool:
        self.waits.append(timeout or 0.0)
        self.clock.now += timeout or 0.0
        if self.stop_after is not None and len(self.waits) >= self.stop_after:
            self.set()
        return self.is_set()


def test_happy_path_the_rate_follows_the_governors_profile_and_the_progress_is_said_now_and_then() -> None:
    clock, said = Clock(), list[tuple[str, int, int]]()
    profile = ["quiet"]
    stop = Waits(clock)
    pacing = SharePacing(lambda: profile[0], stop, lambda job, sent, total: said.append((job, sent, total)), clock)

    pacing.start("ar-series", 4 * MIB)
    pacing.sent(MIB)
    assert stop.waits == [1.0]
    profile[0] = "full"
    pacing.sent(MIB)
    assert stop.waits == [1.0]
    clock.now += 20
    pacing.sent(MIB)
    assert said == [("ar-series", 0, 4 * MIB), ("ar-series", 3 * MIB, 4 * MIB)]
    profile[0] = "unknown"
    assert pacing.rate() == MIB


def test_bad_path_paused_mid_copy_waits_and_a_stop_ends_the_copy() -> None:
    """S-P20-BAD-ARCHIVE-SHARE-STOPPED: SIGTERM mid-copy stops it at the next sheet; the next start resumes it."""
    clock = Clock()
    stop = Waits(clock, stop_after=2)
    pacing = SharePacing(lambda: "paused", stop, lambda _job, _sent, _total: None, clock)
    pacing.start("ar-series", 10)

    with pytest.raises(ShareStoppedError):
        pacing.sent(1)
    assert len(stop.waits) == 2
    assert stop.waits[1] == WAIT_SECONDS


def test_bad_path_a_copy_stopped_mid_way_is_not_said_done(tmp_path: Path) -> None:
    server = Server()
    made, archive_id, series_id = built(server, tmp_path)
    server.answer = {"copy": {"jobId": "ar-series", "archiveId": archive_id, "seriesId": series_id}, "computers": 1}
    made.stop()

    assert made.once() == AGAIN_SECONDS
    assert "done" not in server.kinds()


def test_happy_path_the_thread_runs_until_stopped(tmp_path: Path) -> None:
    server = Server()
    made, _archive, _series = built(server, tmp_path)

    def signed_in() -> bool:
        made.stop()
        return False

    made.signed_in = signed_in
    made.run()
    assert made.stopping.is_set()
    assert server.calls == []


def test_happy_path_the_profile_in_force_is_the_governors_budgets() -> None:
    assert profile_of(None) is None
    assert profile_of(Budget("quiet", 4, 4096, 0.4, 256, 512, 4, 2048)) == "quiet"
