"""`DocumentStore` over `worker.step` (docs/research/M7-local-worker.md §1.3, §2.4): the runner's and the steps' document
reads and writes, each one operation of the claimed job, on the server's allow-list (§2.5).

`get`, `update`, `create` and `list_ids` are the operations of the same names (`list` for the ids, and since 2026-11-08 the count of
the city's versions it left out for failing their schema, `skipped`); `transact` is a
`get` with its update time, then an `update` with `ifUpdateTime` (the compare-and-set the Firestore adapter does),
tried five times. On the wire a timestamp is `{seconds, nanoseconds}` and a removed field `{"__hcmDelete": true}`
(Firestore's sentinel cannot travel as JSON); dotted field paths (`steps.fetch`, `lease.until`) go as they are.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Final

from hcm_pipeline.model import Record, Timestamp, convert_tree
from hcm_pipeline.store import DELETE, TRANSACTION_ATTEMPTS, Change, StoreContentionError
from hcm_pipeline.worker.api import STEP, WorkerApi

DELETE_FIELD: Final = "__hcmDelete"
_TIMESTAMP_KEYS: Final = frozenset({"seconds", "nanoseconds"})
Observer = Callable[[str, Mapping[str, object]], None]


@dataclass(frozen=True)
class JobIds:
    """Who asks for what: the city, this worker and the claimed job (every `worker.step` and `worker.urls` names them)."""

    city_id: str
    worker_id: str
    job_id: str

    def body(self) -> dict[str, object]:
        return {"cityId": self.city_id, "workerId": self.worker_id, "jobId": self.job_id}


def _api_leaf(value: object) -> object:
    if isinstance(value, Timestamp):
        return {"seconds": value.seconds, "nanoseconds": value.nanoseconds}
    return {DELETE_FIELD: True} if value is DELETE else value


def to_api(value: object) -> object:
    """A value as JSON for `worker.step`: timestamps as `{seconds, nanoseconds}`, `DELETE` as `{"__hcmDelete": true}`."""
    return convert_tree(value, _api_leaf)


def _timestamp(value: Mapping[str, object]) -> Timestamp | None:
    seconds, nanoseconds = value.get("seconds"), value.get("nanoseconds")
    exact = set(value) == _TIMESTAMP_KEYS and isinstance(seconds, int) and isinstance(nanoseconds, int)
    return Timestamp(int(str(seconds)), int(str(nanoseconds))) if exact else None


def _from_api_record(value: Mapping[str, object]) -> object:
    return _timestamp(value) or {str(key): from_api(item) for key, item in value.items()}


def from_api(value: object) -> object:
    """A value `worker.step` read, with its `{seconds, nanoseconds}` records as `Timestamp`."""
    if isinstance(value, Mapping):
        return _from_api_record(value)
    return [from_api(item) for item in value] if isinstance(value, list) else value


class ApiDocumentStore:
    """The claimed job's documents through the server; `observer` sees each write (the page's step line)."""

    def __init__(self, api: WorkerApi, ids: JobIds, observer: Observer | None = None) -> None:
        self._api = api
        self._ids = ids
        self._observer = observer
        self._skipped: dict[str, int] = {}

    def _step(self, request: Mapping[str, object]) -> dict[str, object]:
        return self._api.call(STEP, {**self._ids.body(), "request": dict(request)})

    def _read(self, path: str) -> tuple[Record | None, str | None]:
        answer = self._step({"op": "get", "path": path})
        data, update_time = from_api(answer.get("data")), answer.get("updateTime")
        return (data if isinstance(data, dict) else None), (update_time if isinstance(update_time, str) else None)

    def get(self, path: str) -> Record | None:
        return self._read(path)[0]

    def _write(self, path: str, fields: Mapping[str, object], update_time: str | None) -> bool:
        request: dict[str, object] = {"op": "update", "path": path, "fields": to_api(fields)}
        if update_time is not None:
            request["ifUpdateTime"] = update_time
        written = self._step(request).get("ok") is not False
        if written and self._observer is not None:
            self._observer(path, fields)
        return written

    def update(self, path: str, fields: Mapping[str, object]) -> None:
        self._write(path, fields, None)

    def create(self, path: str, data: Mapping[str, object]) -> bool:
        return self._step({"op": "create", "path": path, "data": to_api(data)}).get("created") is True

    def list_ids(self, collection: str) -> list[str]:
        answer = self._step({"op": "list", "collection": collection})
        ids, skipped = answer.get("ids"), answer.get("skipped")
        self._skipped[collection] = skipped if isinstance(skipped, int) else 0
        return [str(item) for item in ids] if isinstance(ids, list) else []

    def skipped(self, collection: str) -> int:
        """The city's versions the last list left out because they fail their schema (`SkipsInvalid`; an older server says none)."""
        return self._skipped.get(collection, 0)

    def transact(self, path: str, change: Change) -> Mapping[str, object] | None:
        for _ in range(TRANSACTION_ATTEMPTS):
            record, update_time = self._read(path)
            fields = change(record)
            if not fields:
                return None
            if self._write(path, fields, update_time):
                return fields
        raise StoreContentionError(f"the transaction on {path} lost {TRANSACTION_ATTEMPTS} times")
