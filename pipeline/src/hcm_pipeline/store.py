"""The document store port (Firestore) and its adapter (docs/research/M3-interfaces.md §5.1).

`DocumentStore` is what the pipeline needs from Firestore: read a document, merge fields into it (dotted field
paths, `DELETE` to remove one), create one only when it is missing, list a collection's document ids, and
`transact`: read, decide and write as one optimistic transaction (the write carries the read's update time as a
precondition and is tried again when another writer got there first). `FirestoreStore` implements it with
`google-cloud-firestore` (which honours `FIRESTORE_EMULATOR_HOST` on its own); the tests use an in-memory store
and a fake client (`tests/fakes/documents.py`). Timestamps are `model.Timestamp` on this side of the port. A read or a
listing Firestore cannot answer (a timeout, the service unavailable) is a `DocumentStoreError`, the port's own error.
"""

import calendar
from collections.abc import Callable, Iterable, Mapping
from datetime import UTC, datetime
from typing import Any, Final, Protocol, runtime_checkable

from google.api_core import exceptions as google_errors

from hcm_pipeline.log import get_logger
from hcm_pipeline.model import NS_PER_SECOND, Record, Timestamp, convert_tree

LOG = get_logger("store")
TRANSACTION_ATTEMPTS: Final = 5
US_PER_SECOND: Final = 1_000_000
NS_PER_US: Final = 1000


class _Delete:
    """The sentinel that removes a field (`firestore.DELETE_FIELD` in the adapter)."""

    def __repr__(self) -> str:
        return "DELETE"


DELETE: Final = _Delete()

Change = Callable[[Record | None], Mapping[str, object] | None]


class StoreContentionError(RuntimeError):
    """A transaction lost to other writers on every attempt."""


class DocumentStoreError(RuntimeError):
    """A Firestore read or listing failed: its path and the error's kind, never the server's details."""


class DocumentStore(Protocol):
    def get(self, path: str) -> Record | None: ...

    def update(self, path: str, fields: Mapping[str, object]) -> None: ...

    def create(self, path: str, data: Mapping[str, object]) -> bool: ...

    def transact(self, path: str, change: Change) -> Mapping[str, object] | None: ...

    def list_ids(self, collection: str) -> list[str]: ...


@runtime_checkable
class SkipsInvalid(Protocol):
    """A store whose list leaves out the documents that fail their schema and counts them: the server's `worker.step` (2026-11-08).
    `skipped` is how many the last list of a collection left out (0 before one, or from a server that counts none)."""

    def skipped(self, collection: str) -> int: ...


# --- the google-cloud-firestore adapter ------------------------------------------------------------------


class _Snapshot(Protocol):
    @property
    def exists(self) -> bool: ...

    @property
    def update_time(self) -> object: ...

    def to_dict(self) -> dict[str, Any] | None: ...


class _Named(Protocol):
    @property
    def id(self) -> str: ...


class _DocumentRef(Protocol):
    def get(self) -> _Snapshot: ...

    def update(self, field_updates: dict[str, Any], option: Any = None) -> object: ...

    def create(self, document_data: dict[str, Any]) -> object: ...


class _Collection(Protocol):
    def list_documents(self) -> Iterable[_Named]: ...


class FirestoreClient(Protocol):
    def document(self, path: str, /) -> _DocumentRef: ...

    def collection(self, path: str, /) -> _Collection: ...


WriteOption = Callable[..., object]


def _to_firestore_leaf(value: object, delete_field: object) -> object:
    if isinstance(value, Timestamp):
        return datetime.fromtimestamp(value.seconds, UTC).replace(microsecond=value.nanoseconds // NS_PER_US)
    return delete_field if value is DELETE else value


def to_firestore(value: object, delete_field: object) -> object:
    """A value with `Timestamp` as UTC datetimes and `DELETE` as Firestore's delete sentinel."""
    return convert_tree(value, lambda leaf: _to_firestore_leaf(leaf, delete_field))


def _from_firestore_leaf(value: object) -> object:
    if not isinstance(value, datetime):
        return value
    nanoseconds = getattr(value, "nanosecond", 0) or value.microsecond * NS_PER_US
    return Timestamp(calendar.timegm(value.utctimetuple()), int(nanoseconds) % NS_PER_SECOND)


def from_firestore(value: object) -> object:
    """A value read from Firestore with its datetimes as `Timestamp` (nanoseconds kept when the SDK has them)."""
    return convert_tree(value, _from_firestore_leaf)


def _record(snapshot: _Snapshot) -> Record | None:
    data = snapshot.to_dict() if snapshot.exists else None
    converted = None if data is None else from_firestore(data)
    return converted if isinstance(converted, dict) else None


class FirestoreStore:
    """`DocumentStore` over a `google.cloud.firestore.Client` (or a fake with the same few methods)."""

    def __init__(self, client: FirestoreClient, write_option: WriteOption, delete_field: object) -> None:
        self._client = client
        self._write_option = write_option
        self._delete_field = delete_field

    def _converted(self, fields: Mapping[str, object]) -> dict[str, Any]:
        converted = to_firestore(fields, self._delete_field)
        return converted if isinstance(converted, dict) else {}

    def get(self, path: str) -> Record | None:
        try:
            return _record(self._client.document(path).get())
        except google_errors.GoogleAPIError as error:
            raise DocumentStoreError(f"Firestore read of {path}: {type(error).__name__}") from error

    def update(self, path: str, fields: Mapping[str, object]) -> None:
        self._client.document(path).update(self._converted(fields))

    def create(self, path: str, data: Mapping[str, object]) -> bool:
        try:
            self._client.document(path).create(self._converted(data))
        except google_errors.Conflict:
            return False
        return True

    def list_ids(self, collection: str) -> list[str]:
        try:
            return [document.id for document in self._client.collection(collection).list_documents()]
        except google_errors.GoogleAPIError as error:
            raise DocumentStoreError(f"Firestore list of {collection}: {type(error).__name__}") from error

    def transact(self, path: str, change: Change) -> Mapping[str, object] | None:
        for _ in range(TRANSACTION_ATTEMPTS):
            written = self._attempt(path, change)
            if written is not _LOST:
                return written if isinstance(written, Mapping) else None
            LOG.info("transaction on %s lost to another writer; trying again", path)
        raise StoreContentionError(f"the transaction on {path} lost {TRANSACTION_ATTEMPTS} times")

    def _attempt(self, path: str, change: Change) -> object:
        reference = self._client.document(path)
        snapshot = reference.get()
        fields = change(_record(snapshot))
        if not fields:
            return None
        try:
            reference.update(self._converted(fields), option=self._write_option(last_update_time=snapshot.update_time))
        except google_errors.FailedPrecondition:
            return _LOST
        return fields


_LOST: Final = object()
