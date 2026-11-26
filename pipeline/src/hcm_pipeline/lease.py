"""The job lease and its heartbeat (docs/research/M3-interfaces.md §4.4; security review §4.1).

The run's first transaction takes the lease (`owner` = `CLOUD_RUN_EXECUTION/CLOUD_RUN_TASK_ATTEMPT`, `until` = now +
`LEASE_SECONDS`) when it is absent, lapsed or its own, and sets `running` and `startedAt`; a lease another live owner
holds makes the run exit 0 without touching the job (`S-P01-BAD-DUPLICATE-EXECUTION`). Every `HEARTBEAT_SECONDS`
the heartbeat extends the lease while it is still the owner, writes the step and the progress, and reads
`cancelRequested` (and `releaseRequested`: this computer was paused, the run hands the job back); a lease someone else took
is raised as `LeaseLostError` at the next checkpoint.
"""

import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from types import TracebackType
from typing import Final, Self

from hcm_pipeline.contract import HEARTBEAT_SECONDS, LEASE_SECONDS
from hcm_pipeline.jobs import CancelledRunError, LeaseLostError, ReleasedRunError, RunFlags
from hcm_pipeline.log import get_logger
from hcm_pipeline.model import Lease, Record, Timestamp, stamp
from hcm_pipeline.store import DELETE, DocumentStore

LOG = get_logger("lease")
RUNNABLE_STATUSES: Final = frozenset({"queued", "starting", "running"})


@dataclass
class LeaseDecision:
    """Why the lease was or was not taken: `taken`, `held` (another live owner), `missing` or the job's status."""

    verdict: str = "missing"
    record: Record = field(default_factory=dict)

    @property
    def taken(self) -> bool:
        return self.verdict == "taken"


def _blocking(record: Record, owner: str, now: Timestamp) -> str | None:
    """Why this owner may not take the lease now, or None."""
    status = record.get("status")
    if status not in RUNNABLE_STATUSES:
        return f"status {status}"
    lease = Lease.of(record.get("lease"))
    return "held" if lease is not None and lease.owner != owner and lease.until > now else None


def lease_change(owner: str, now: Timestamp, decision: LeaseDecision) -> Callable[[Record | None], Record | None]:
    """The transaction's change that takes the lease, recording its verdict in `decision`."""

    def change(record: Record | None) -> Record | None:
        blocked = "missing" if record is None else _blocking(record, owner, now)
        decision.verdict, decision.record = blocked or "taken", record or {}
        if blocked is not None or record is None:
            return None
        fields: Record = {"status": "running", "lease": Lease(owner, now.plus(LEASE_SECONDS)).as_record(), "waitReason": DELETE}
        fields.update({"retryAt": DELETE, **stamp(now)})
        return fields if "startedAt" in record else {**fields, "startedAt": now}

    return change


def take_lease(store: DocumentStore, job_path: str, owner: str, now: Timestamp) -> LeaseDecision:
    decision = LeaseDecision()
    store.transact(job_path, lease_change(owner, now, decision))
    return decision


def owned_change(owner: str, fields: Record) -> Callable[[Record | None], Record | None]:
    """A change written only while `owner` still holds the lease (the run's final writes)."""

    def change(record: Record | None) -> Record | None:
        lease = Lease.of((record or {}).get("lease"))
        return fields if lease is not None and lease.owner == owner else None

    return change


class Heartbeat:
    """A daemon thread that renews the lease every `interval` seconds while the run lasts."""

    def __init__(self, store: DocumentStore, job_path: str, owner: str, flags: RunFlags, clock: Callable[[], float]) -> None:
        self._store = store
        self._path = job_path
        self._owner = owner
        self._flags = flags
        self._clock = clock
        self.interval: float = HEARTBEAT_SECONDS
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, name="hcm-heartbeat", daemon=True)

    def __enter__(self) -> Self:
        self._thread.start()
        return self

    def __exit__(self, kind: type[BaseException] | None, error: BaseException | None, trace: TracebackType | None) -> None:
        self._stop.set()
        self._thread.join()

    def _loop(self) -> None:
        while not self._stop.wait(self.interval):
            self.beat()

    def beat(self) -> None:
        """One renewal; a failed write is logged and tried again at the next beat (the lease outlives several). A store
        that says the job is no longer this run's (the local worker's API: M7) stops the run at its next checkpoint."""
        try:
            self._store.transact(self._path, self._change)
        except LeaseLostError:
            self._flags.raise_flag(LeaseLostError)
        except Exception as error:  # the thread must survive a transient Firestore failure
            LOG.warning("heartbeat failed (%s); the next one tries again", type(error).__name__)

    def _owned(self, record: Record | None) -> bool:
        lease = Lease.of((record or {}).get("lease"))
        return lease is not None and lease.owner == self._owner

    def _asked(self, record: Record) -> None:
        """What the admin asked of the run: a cancel, or (a paused computer) its job handed back."""
        if record.get("cancelRequested") is True:
            self._flags.raise_flag(CancelledRunError)
        elif record.get("releaseRequested") is True:
            self._flags.raise_flag(ReleasedRunError)

    def _change(self, record: Record | None) -> Record | None:
        if not self._owned(record):
            self._flags.raise_flag(LeaseLostError)
            return None
        self._asked(record or {})
        now = Timestamp.at(self._clock())
        fields: Record = {"lease.until": now.plus(LEASE_SECONDS), "progress": self._flags.progress, **stamp(now)}
        return fields if self._flags.step is None else {**fields, "step": self._flags.step}
