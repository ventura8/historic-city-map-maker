"""`DocumentStore` over `worker.step` (M7, docs/research/M7-local-worker.md §1.3, §2.4)."""

import json
from collections.abc import Mapping

import httpx
import pytest
from hcm_pipeline.model import Timestamp
from hcm_pipeline.store import DELETE, StoreContentionError
from hcm_pipeline.worker.api import WorkerApi
from hcm_pipeline.worker.documents import ApiDocumentStore, JobIds, from_api, to_api

IDS = JobIds("bucharest", "w-0123456789abcdef", "job-1")
JOB = "cities/bucharest/jobs/job-1"
VERSIONS = "cities/bucharest/layerVersions"


class StepServer:
    """`worker.step` over one document whose update time moves on each write; `lose` makes that many CAS writes lose."""

    def __init__(self, document: dict[str, object] | None) -> None:
        self.document = document
        self.version = 1
        self.lose = 0
        self.requests: list[dict[str, object]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        operation = json.loads(request.content)["data"]["request"]
        self.requests.append(operation)
        return httpx.Response(200, json={"result": self._answer(operation)})

    def _answer(self, operation: dict[str, object]) -> dict[str, object]:
        if operation["op"] == "get":
            return {"data": self.document, "updateTime": f"{self.version}.000000000" if self.document else None}
        if operation["op"] == "list":
            return self._list(str(operation["collection"]))
        return self._write(operation)

    def _list(self, collection: str) -> dict[str, object]:
        if collection == VERSIONS:
            return {"ids": ["v-1972"], "skipped": 2}
        return {"ids": ["000000", "000001"] if collection == f"{JOB}/logs" else None}

    def _write(self, operation: dict[str, object]) -> dict[str, object]:
        if operation["op"] == "create":
            return {"created": True}
        if "ifUpdateTime" in operation and self.lose:
            self.lose -= 1
            self.version += 1
            return {"ok": False}
        self.version += 1
        return {"ok": True}


def store(server: StepServer, seen: list[tuple[str, Mapping[str, object]]] | None = None) -> ApiDocumentStore:
    api = WorkerApi(
        httpx.Client(transport=httpx.MockTransport(server)), lambda name: f"http://127.0.0.1:1/{name}", lambda: "t", lambda _seconds: None
    )
    return ApiDocumentStore(api, IDS, None if seen is None else lambda path, fields: seen.append((path, fields)))


def test_happy_path_timestamps_and_deletes_travel_as_json() -> None:
    value = {"lease": {"owner": "worker:w-1", "until": Timestamp(1_800_000_000, 5)}, "retryAt": DELETE, "list": [Timestamp(1, 2)]}

    sent = to_api(value)

    assert sent == {
        "lease": {"owner": "worker:w-1", "until": {"seconds": 1_800_000_000, "nanoseconds": 5}},
        "retryAt": {"__hcmDelete": True},
        "list": [{"seconds": 1, "nanoseconds": 2}],
    }
    assert from_api({"lease": {"until": {"seconds": 1_800_000_000, "nanoseconds": 5}}, "list": [{"seconds": 1, "nanoseconds": 2}]}) == {
        "lease": {"until": Timestamp(1_800_000_000, 5)},
        "list": [Timestamp(1, 2)],
    }
    assert from_api({"seconds": 1, "nanoseconds": 2, "unit": "s"}) == {"seconds": 1, "nanoseconds": 2, "unit": "s"}
    assert from_api({"seconds": "1", "nanoseconds": 2}) == {"seconds": "1", "nanoseconds": 2}


def test_happy_path_each_operation_is_one_worker_step_of_the_job() -> None:
    server = StepServer({"status": "running", "startedAt": {"seconds": 10, "nanoseconds": 0}})
    seen: list[tuple[str, Mapping[str, object]]] = []
    documents = store(server, seen)

    assert documents.get(JOB) == {"status": "running", "startedAt": Timestamp(10, 0)}
    documents.update(JOB, {"step": "fetch", "retryAt": DELETE})
    assert documents.create(f"{JOB}/logs/000002", {"level": "info", "at": Timestamp(11, 0)}) is True
    assert documents.list_ids(f"{JOB}/logs") == ["000000", "000001"]
    assert documents.list_ids("cities/bucharest/jobs/job-1/other") == []

    assert server.requests[1] == {"op": "update", "path": JOB, "fields": {"step": "fetch", "retryAt": {"__hcmDelete": True}}}
    assert server.requests[2] == {
        "op": "create",
        "path": f"{JOB}/logs/000002",
        "data": {"level": "info", "at": {"seconds": 11, "nanoseconds": 0}},
    }
    assert seen == [(JOB, {"step": "fetch", "retryAt": DELETE})]


def test_happy_path_a_transaction_is_a_compare_and_set_tried_again_when_it_loses() -> None:
    server = StepServer({"status": "running"})
    server.lose = 2

    written = store(server).transact(JOB, lambda record: {"progress": 0.5} if record else None)

    assert written == {"progress": 0.5}
    updates = [request for request in server.requests if request["op"] == "update"]
    assert [request["ifUpdateTime"] for request in updates] == ["1.000000000", "2.000000000", "3.000000000"]


def test_bad_path_a_transaction_that_always_loses_raises_and_one_that_changes_nothing_writes_nothing() -> None:
    server = StepServer({"status": "running"})
    server.lose = 5

    with pytest.raises(StoreContentionError):
        store(server).transact(JOB, lambda _record: {"progress": 0.5})

    missing = StepServer(None)
    assert store(missing).transact(JOB, lambda record: None if record is None else {"x": 1}) is None
    assert [request["op"] for request in missing.requests] == ["get"]


def test_happy_path_a_list_keeps_the_count_of_documents_the_server_left_out_and_an_old_server_counts_none() -> None:
    """Scenarios: S-P06-BAD-JOINT-UNREADABLE
    The server lists only the city's versions that pass their schema and says how many it left out; one before it says nothing."""
    documents = store(StepServer(None))

    assert documents.skipped(VERSIONS) == 0
    assert documents.list_ids(VERSIONS) == ["v-1972"]
    assert documents.skipped(VERSIONS) == 2
    assert documents.list_ids(f"{JOB}/logs") == ["000000", "000001"]
    assert documents.skipped(f"{JOB}/logs") == 0
