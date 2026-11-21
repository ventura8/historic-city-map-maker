"""The lease: taken when absent, lapsed or our own; refused while another live owner holds it; renewed by the heartbeat."""

import threading
from collections.abc import Mapping

import pytest
from hcm_pipeline.jobs import CancelledRunError, InterruptedRunError, LeaseLostError, RunFlags
from hcm_pipeline.lease import Heartbeat, owned_change, take_lease
from hcm_pipeline.model import Timestamp
from hcm_pipeline.store import Change

from tests.fakes.documents import MemoryStore

JOB = "cities/bucharest/jobs/job-1"
NOW = Timestamp(1792000000)
ME = "raster-pipeline-a/0"


def seeded(**fields: object) -> MemoryStore:
    store = MemoryStore()
    store.seed(JOB, {"type": "usgs-import", "status": "starting", **fields})
    return store


def test_happy_path_an_absent_lease_is_taken_and_the_job_runs() -> None:
    store = seeded(waitReason="capacity", retryAt=Timestamp(5))

    decision = take_lease(store, JOB, ME, NOW)

    job = store.get(JOB)
    assert decision.taken
    assert job == {
        "type": "usgs-import",
        "status": "running",
        "lease": {"owner": ME, "until": Timestamp(1792000600)},
        "startedAt": NOW,
        "updatedBy": "system:pipeline",
        "updatedAt": NOW,
    }


@pytest.mark.parametrize(
    "lease",
    [{"owner": "raster-pipeline-old/0", "until": Timestamp(1791999999)}, {"owner": ME, "until": Timestamp(1792000100)}],
)
def test_happy_path_a_lapsed_or_own_lease_is_taken_again_and_keeps_the_start(lease: dict[str, object]) -> None:
    store = seeded(status="running", lease=lease, startedAt=Timestamp(1))

    assert take_lease(store, JOB, ME, NOW).taken
    assert (store.get(JOB) or {})["startedAt"] == Timestamp(1)


@pytest.mark.parametrize(
    ("fields", "verdict"),
    [
        ({"status": "running", "lease": {"owner": "raster-pipeline-b/0", "until": Timestamp(1792000300)}}, "held"),
        ({"status": "awaiting_approval"}, "status awaiting_approval"),
        ({"status": "cancelled"}, "status cancelled"),
    ],
)
def test_bad_path_a_live_lease_or_an_unrunnable_status_leaves_the_job_untouched(fields: dict[str, object], verdict: str) -> None:
    store = seeded(**fields)
    store.writes.clear()

    decision = take_lease(store, JOB, ME, NOW)

    assert (decision.taken, decision.verdict) == (False, verdict)
    assert store.writes == []


def test_bad_path_a_missing_job_is_not_taken() -> None:
    assert take_lease(MemoryStore(), JOB, ME, NOW).verdict == "missing"


def test_happy_path_final_writes_need_the_lease() -> None:
    mine, theirs = owned_change(ME, {"status": "failed"}), owned_change("other/0", {"status": "failed"})
    record: dict[str, object] = {"lease": {"owner": ME, "until": NOW}}

    assert mine(record) == {"status": "failed"}
    assert theirs(record) is None
    assert mine(None) is None


def test_happy_path_the_heartbeat_extends_the_lease_and_writes_progress() -> None:
    store = seeded(status="running", lease={"owner": ME, "until": NOW})
    flags = RunFlags()
    flags.enter("warp", 0.6, 0.15)
    flags.progress_within(0.5)

    Heartbeat(store, JOB, ME, flags, lambda: 1792000060.0).beat()

    job = store.get(JOB)
    assert job is not None
    assert job["lease"] == {"owner": ME, "until": Timestamp(1792000660)}
    assert (job["step"], job["progress"]) == ("warp", 0.675)
    assert flags.stopping is None


def test_bad_path_the_heartbeat_reads_a_cancel_and_notices_a_lost_lease() -> None:
    store = seeded(status="running", lease={"owner": ME, "until": NOW}, cancelRequested=True)
    flags = RunFlags()
    beat = Heartbeat(store, JOB, ME, flags, lambda: 1792000060.0)

    beat.beat()
    assert flags.stopping is CancelledRunError
    assert flags.cancel_requested
    assert "step" not in (store.get(JOB) or {})

    store.update(JOB, {"lease.owner": "raster-pipeline-b/0"})
    beat.beat()
    lost: object = flags.stopping
    flags.raise_flag(CancelledRunError)
    still: object = flags.stopping
    assert (lost, still) == (LeaseLostError, LeaseLostError)
    with pytest.raises(LeaseLostError):
        flags.check()


class FailingStore(MemoryStore):
    """A store whose transactions fail (Firestore unavailable), counting the attempts."""

    def __init__(self) -> None:
        super().__init__()
        self.attempts = threading.Semaphore(0)

    def transact(self, path: str, change: Change) -> Mapping[str, object] | None:
        self.attempts.release()
        raise RuntimeError("firestore unavailable")


def test_bad_path_a_failed_heartbeat_is_logged_and_the_thread_runs_on() -> None:
    store = FailingStore()
    flags = RunFlags()
    heartbeat = Heartbeat(store, JOB, ME, flags, lambda: 0.0)
    heartbeat.interval = 0.001

    with heartbeat:
        assert store.attempts.acquire(timeout=5)
        assert store.attempts.acquire(timeout=5)

    assert flags.stopping is None


class NotHolderStore(MemoryStore):
    """A store that says the job is no longer this run's (the local worker's API answering notHolder: M7)."""

    def transact(self, path: str, change: Change) -> Mapping[str, object] | None:
        raise LeaseLostError("the server says another worker holds the job")


def test_bad_path_a_store_that_says_the_job_is_lost_stops_the_run() -> None:
    flags = RunFlags()

    Heartbeat(NotHolderStore(), JOB, "worker:w-0123456789abcdef", flags, lambda: 0.0).beat()

    assert flags.stopping is LeaseLostError


def test_bad_path_a_signal_stops_the_run_without_a_lock_and_a_cancel_or_a_lost_lease_still_wins() -> None:
    """`interrupt` (the signal handler's) takes no lock: it may run while the main thread holds the flags' own (lesson 342)."""
    flags = RunFlags()
    with flags._lock:
        flags.interrupt()
    interrupted: object = flags.stopping
    flags.raise_flag(CancelledRunError)
    cancelled: object = flags.stopping

    assert (interrupted, cancelled) == (InterruptedRunError, CancelledRunError)
    assert RunFlags(lambda: True).stopping is InterruptedRunError
