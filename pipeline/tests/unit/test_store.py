"""The Firestore adapter: conversions, create-only writes, listing and optimistic transactions."""

from collections.abc import Callable
from datetime import UTC, datetime

import pytest
from google.api_core.datetime_helpers import DatetimeWithNanoseconds
from hcm_pipeline.model import Timestamp
from hcm_pipeline.store import DELETE, DocumentStoreError, FirestoreStore, StoreContentionError, from_firestore, to_firestore

from tests.fakes.documents import DEADLINE_EXCEEDED, FakeFirestoreClient, MemoryStore

JOB = "cities/bucharest/jobs/job-1"
# The SDK's datetime with nanoseconds (untyped), through a typed alias.
NANOS: Callable[..., datetime] = DatetimeWithNanoseconds


def adapter(client: FakeFirestoreClient) -> FirestoreStore:
    return FirestoreStore(client, client.write_option, client.deleted_marker)


def test_happy_path_timestamps_and_deletes_cross_the_port_both_ways() -> None:
    marker = object()

    sent = to_firestore({"at": Timestamp(1792000000, 5_000_000), "lease": DELETE, "steps": [Timestamp(1)]}, marker)

    assert sent == {
        "at": datetime(2026, 10, 14, 17, 46, 40, 5000, tzinfo=UTC),
        "lease": marker,
        "steps": [datetime(1970, 1, 1, 0, 0, 1, tzinfo=UTC)],
    }
    nanos = NANOS(2026, 10, 14, 17, 46, 40, nanosecond=123456789, tzinfo=UTC)
    assert from_firestore({"at": nanos, "plain": datetime(1970, 1, 1, tzinfo=UTC), "n": 3}) == {
        "at": Timestamp(1792000000, 123456789),
        "plain": Timestamp(0),
        "n": 3,
    }
    assert repr(DELETE) == "DELETE"


def test_happy_path_get_update_create_and_list() -> None:
    client = FakeFirestoreClient()
    store = adapter(client)

    assert store.create(JOB, {"status": "queued", "createdAt": Timestamp(10)})
    assert not store.create(JOB, {"status": "queued"})
    store.update(JOB, {"steps.fetch": {"status": "done"}, "status": "running"})
    store.create(f"{JOB}/logs/000000", {"seq": 0})

    assert store.get(JOB) == {"status": "running", "createdAt": Timestamp(10), "steps": {"fetch": {"status": "done"}}}
    assert store.get("cities/bucharest/jobs/missing") is None
    assert store.list_ids(f"{JOB}/logs") == ["000000"]


def test_happy_path_a_transaction_writes_what_the_change_decides_with_the_read_as_precondition() -> None:
    client = FakeFirestoreClient()
    store = adapter(client)
    store.create(JOB, {"status": "starting", "lease": {"owner": "x"}})

    written = store.transact(
        JOB, lambda record: {"status": "running", "lease": DELETE} if record and record["status"] == "starting" else None
    )

    assert written == {"status": "running", "lease": DELETE}
    assert store.get(JOB) == {"status": "running"}
    assert store.transact(JOB, lambda _record: None) is None


def test_bad_path_a_transaction_that_loses_to_another_writer_tries_again() -> None:
    client = FakeFirestoreClient()
    store = adapter(client)
    store.create(JOB, {"count": 1})
    client.contend = 2
    seen: list[object] = []

    def change(record: dict[str, object] | None) -> dict[str, object]:
        seen.append(record)
        return {"count": 2}

    assert store.transact(JOB, change) == {"count": 2}
    assert len(seen) == 3


def test_bad_path_a_transaction_that_always_loses_gives_up() -> None:
    client = FakeFirestoreClient()
    store = adapter(client)
    store.create(JOB, {"count": 1})
    client.contend = 99

    with pytest.raises(StoreContentionError, match="lost 5 times"):
        store.transact(JOB, lambda _record: {"count": 2})


def test_bad_path_a_read_or_a_listing_firestore_cannot_answer_is_a_store_error_naming_its_kind() -> None:
    """Scenarios: S-P06-BAD-JOINT-UNREADABLE
    The review of a6750294: a timed-out or unavailable Firestore call raised google.api_core's own error, which no caller of the port
    catches; it is the port's `DocumentStoreError` now (a `RuntimeError`), with the path and the kind, never the server's details."""
    client = FakeFirestoreClient()
    store = adapter(client)
    store.create(JOB, {"status": "queued"})
    client.faults = {JOB: DEADLINE_EXCEEDED("Deadline of 60.0s exceeded"), "cities/bucharest/jobs": DEADLINE_EXCEEDED("slow")}

    with pytest.raises(DocumentStoreError, match=rf"^Firestore read of {JOB}: DeadlineExceeded$"):
        store.get(JOB)
    with pytest.raises(DocumentStoreError, match=r"^Firestore list of cities/bucharest/jobs: DeadlineExceeded$"):
        store.list_ids("cities/bucharest/jobs")
    assert issubclass(DocumentStoreError, RuntimeError)


def test_happy_path_the_memory_store_behaves_like_the_adapter() -> None:
    store = MemoryStore()
    store.seed(JOB, {"a": {"b": 1}})

    store.update(JOB, {"a.c": 2, "a.b": DELETE})

    assert store.get(JOB) == {"a": {"c": 2}}
    assert store.list_ids("cities/bucharest/jobs") == ["job-1"]
