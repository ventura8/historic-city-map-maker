"""In-memory stand-ins for Firestore: a `DocumentStore` for the runner and steps, and a fake client for the adapter.

`MemoryStore` keeps documents as nested dicts (timestamps as `Timestamp`), applies dotted field updates and
`DELETE` like Firestore, and records every write (path, fields) in `writes`. `FakeFirestoreClient` mimics the few
`google.cloud.firestore` calls `FirestoreStore` makes (document get, update with a last-update-time precondition,
create, collection listing), so the adapter's conversions and retries are tested without an emulator;
`contend` makes the next N preconditioned updates fail as if another writer got there first; `faults` makes a read of a
document or a listing of a collection raise, as Firestore does when its call times out or the service is unavailable.
"""

import copy
import threading
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from google.api_core import exceptions as google_errors
from hcm_pipeline.model import Record
from hcm_pipeline.store import DELETE, Change

# The google.api_core exceptions are untyped; these typed aliases construct them in strict mode.
NOT_FOUND: Callable[[str], Exception] = google_errors.NotFound
CONTENDED: Callable[[str], Exception] = google_errors.FailedPrecondition
ALREADY_EXISTS: Callable[[str], Exception] = google_errors.AlreadyExists
DEADLINE_EXCEEDED: Callable[[str], Exception] = google_errors.DeadlineExceeded


def _apply(document: dict[str, object], dotted: str, value: object) -> None:
    *parents, leaf = dotted.split(".")
    level = document
    for key in parents:
        child = level.setdefault(key, {})
        assert isinstance(child, dict)
        level = child
    if value is DELETE:
        level.pop(leaf, None)
    else:
        level[leaf] = copy.deepcopy(value)


class MemoryStore:
    def __init__(self) -> None:
        self.documents: dict[str, dict[str, object]] = {}
        self.writes: list[tuple[str, dict[str, object]]] = []
        self._lock = threading.RLock()

    def seed(self, path: str, data: Mapping[str, object]) -> None:
        self.documents[path] = copy.deepcopy(dict(data))

    def get(self, path: str) -> Record | None:
        with self._lock:
            found = self.documents.get(path)
            return copy.deepcopy(found) if found is not None else None

    def update(self, path: str, fields: Mapping[str, object]) -> None:
        with self._lock:
            document = self.documents[path]
            for key, value in fields.items():
                _apply(document, key, value)
            self.writes.append((path, dict(fields)))

    def create(self, path: str, data: Mapping[str, object]) -> bool:
        with self._lock:
            if path in self.documents:
                return False
            self.documents[path] = copy.deepcopy(dict(data))
            self.writes.append((path, dict(data)))
            return True

    def transact(self, path: str, change: Change) -> Mapping[str, object] | None:
        with self._lock:
            fields = change(self.get(path))
            if fields:
                self.update(path, fields)
            return fields

    def list_ids(self, collection: str) -> list[str]:
        with self._lock:
            prefix = collection.rstrip("/") + "/"
            return sorted(path[len(prefix) :] for path in self.documents if path.startswith(prefix) and "/" not in path[len(prefix) :])


@dataclass
class FakeSnapshot:
    data: dict[str, Any] | None
    update_time: object = None

    @property
    def exists(self) -> bool:
        return self.data is not None

    def to_dict(self) -> dict[str, Any] | None:
        return copy.deepcopy(self.data)


@dataclass
class FakeOption:
    last_update_time: object


@dataclass(frozen=True)
class FakeName:
    id: str


@dataclass
class FakeFirestoreClient:
    documents: dict[str, dict[str, Any]] = field(default_factory=dict)
    versions: dict[str, int] = field(default_factory=dict)
    contend: int = 0
    deleted_marker: object = field(default_factory=object)
    faults: dict[str, Exception] = field(default_factory=dict)

    def fault(self, path: str) -> None:
        """The error a read of `path` raises, when one was set."""
        if path in self.faults:
            raise self.faults[path]

    def document(self, path: str, /) -> FakeReference:
        return FakeReference(self, path)

    def collection(self, path: str, /) -> FakeCollection:
        return FakeCollection(self, path)

    @staticmethod
    def write_option(**kwargs: object) -> FakeOption:
        return FakeOption(kwargs["last_update_time"])


@dataclass
class FakeReference:
    client: FakeFirestoreClient
    path: str

    def get(self) -> FakeSnapshot:
        self.client.fault(self.path)
        return FakeSnapshot(self.client.documents.get(self.path), self.client.versions.get(self.path))

    def _contended(self, option: Any) -> bool:
        if not isinstance(option, FakeOption):
            return False
        return self.client.contend > 0 or option.last_update_time != self.client.versions.get(self.path)

    def _check(self, option: Any) -> None:
        if self.path not in self.client.documents:
            raise NOT_FOUND("no document")
        if self._contended(option):
            self.client.contend -= 1
            raise CONTENDED("the document changed")

    def update(self, field_updates: dict[str, Any], option: Any = None) -> object:
        self._check(option)
        document = self.client.documents[self.path]
        for key, value in field_updates.items():
            _apply(document, key, DELETE if value is self.client.deleted_marker else value)
        self.client.versions[self.path] = self.client.versions.get(self.path, 0) + 1
        return datetime.now()

    def create(self, document_data: dict[str, Any]) -> object:
        if self.path in self.client.documents:
            raise ALREADY_EXISTS("exists")
        self.client.documents[self.path] = copy.deepcopy(document_data)
        self.client.versions[self.path] = 1
        return None


@dataclass
class FakeCollection:
    client: FakeFirestoreClient
    path: str

    def list_documents(self) -> Iterable[FakeName]:
        self.client.fault(self.path)
        prefix = self.path + "/"
        return [
            FakeName(path[len(prefix) :]) for path in self.client.documents if path.startswith(prefix) and "/" not in path[len(prefix) :]
        ]
