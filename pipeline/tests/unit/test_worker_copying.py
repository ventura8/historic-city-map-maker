"""The holder's side of an archive series' copy, wired to `worker.archiveCopy` (M20 §4.1; live report of 2026-11-13).

Scenarios: S-P20-HAPPY-ARCHIVE-COPY, S-P20-BAD-ARCHIVE-COPY
"""

import json
from pathlib import Path

import httpx
from hcm_pipeline.archive import report, sidecar
from hcm_pipeline.archive.intake import ArchiveStore
from hcm_pipeline.archive.model import Probe
from hcm_pipeline.worker.api import WorkerApi
from hcm_pipeline.worker.copying import copier

CITY = "bucharest"
WORKER = "w-0123456789abcdef"


class Bucket:
    """`worker.archiveCopy` and the signed PUTs as the holder meets them; `refuse` answers the callable with a refusal."""

    def __init__(self, refuse: bool = False) -> None:
        self.refuse = refuse
        self.calls: list[dict[str, object]] = []
        self.puts: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.method == "PUT":
            self.puts.append(request.url.path)
            return httpx.Response(200, json={"generation": "1"})
        data = json.loads(request.content)["data"]
        self.calls.append(data)
        if self.refuse:
            return httpx.Response(
                400, json={"error": {"message": "no", "status": "FAILED_PRECONDITION", "details": {"code": "apiError.worker.refused"}}}
            )
        copy = data["copy"]
        if copy["kind"] == "done":
            return httpx.Response(200, json={"result": {"status": "queued"}})
        path = copy["objects"][0]["path"]
        signed = {"path": path, "url": f"http://127.0.0.1:1/put/{path}", "method": "PUT", "headers": {}, "expiresAt": "x", "exists": False}
        return httpx.Response(200, json={"result": {"objects": [signed]}})


def holder(work: Path) -> tuple[ArchiveStore, str, str]:
    store = ArchiveStore(work, lambda _path: Probe("jpeg", 4000, 3000, 3, 8, "rgb"))
    archive_id = store.create()
    store.receive(archive_id, "Harti/1897 plan.jpg", [b"sheet"], 5)
    made = store.scan(archive_id, report.Context(44.43, 2026, sidecar.Sidecar()))
    return store, archive_id, str(made.series[0]["seriesId"])


def send(bucket: Bucket, work: Path) -> None:
    client = httpx.Client(transport=httpx.MockTransport(bucket))
    api = WorkerApi(client, lambda name: f"http://127.0.0.1:1/{name}", lambda: "token", lambda _seconds: None)
    store, archive_id, series_id = holder(work)
    copier(api, CITY, WORKER, store, client)({"jobId": "ar-series", "archiveId": archive_id, "seriesId": series_id})


def test_happy_path_the_holder_puts_the_sheets_and_the_manifest_then_says_done(tmp_path: Path) -> None:
    bucket = Bucket()

    send(bucket, tmp_path)

    assert len(bucket.puts) == 2
    assert all(call["jobId"] == "ar-series" and call["workerId"] == WORKER for call in bucket.calls)
    assert bucket.calls[-1]["copy"] == {"kind": "done", "bytes": 5}


def test_bad_path_a_refused_copy_is_logged_and_leaves_the_loop_running(tmp_path: Path) -> None:
    bucket = Bucket(refuse=True)

    send(bucket, tmp_path)

    assert bucket.puts == []
