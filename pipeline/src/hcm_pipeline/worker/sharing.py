"""M20 §22 (the owner's request of 2026-11-14; docs/research/M20-import-local.md §22): the computer that holds scanned maps shares
them with the city's other computers from a thread of its own, also while it runs a job.

Until then a copy was asked only with the holder's claim, between two jobs: a holder busy with a long job, or one that left its jobs
to a calmer computer, sent nothing, and the other computers idled beside a queue of series. `Sharer.once` asks `worker.archiveCopy`
`wanted` with the archives this computer holds whole; the server names a series a worker handed back, else a queued one not copied
yet when another computer could take it, or says why none (`nothing`, `alone`, `dayLimit`). The series' sheets then go to the bucket
through `CopySender` (`archive/copy.py`), each once, a sheet already there with the same MD5 skipped, so a copy cut short resumes.

The governor (M26) budgets it (`SharePacing`): nothing while this computer is paused (by its owner, its battery or its heat); at most
`RATES[profile]` bytes a second on average, a sheet at a time (quiet while someone uses the computer: 1 MiB/s, about 8 Mbit/s of the
home line; full: 8 MiB/s); `progress` said at most every `PROGRESS_SECONDS`, which the Computers card shows. The worker's own I/O is
in the idle class already (`idle_io`). SIGTERM ends the copy at its next sheet (`ShareStoppedError`); the next start resumes it.
"""

import threading
import time
from collections.abc import Callable, Mapping
from typing import Final

import httpx

from hcm_pipeline.archive.copy import CopySender, ShareStoppedError
from hcm_pipeline.archive.intake import ArchiveStore
from hcm_pipeline.jobs import LeaseLostError
from hcm_pipeline.log import get_logger
from hcm_pipeline.paths import ID
from hcm_pipeline.worker.api import ARCHIVE_COPY, WorkerApi, WorkerApiError
from hcm_pipeline.worker.copying import copy_sender
from hcm_pipeline.worker.documents import JobIds
from hcm_pipeline.worker.session import RefreshUnavailableError

LOG = get_logger("worker.sharing")
CALL_ERRORS: Final = (WorkerApiError, LeaseLostError, RefreshUnavailableError)
MIB: Final = 1024 * 1024
# The average upload rate by the governor's profile; an unknown profile (before the first tick) counts as quiet.
RATES: Final[Mapping[str, int]] = {"full": 8 * MIB, "quiet": 1 * MIB}
QUIET: Final = "quiet"
PAUSED: Final = "paused"
# How long the thread waits: after a copy, before asking again; when nothing waits or no computer could take it; once today's
# bytes are spent; while paused or without a session.
AGAIN_SECONDS: Final = 1.0
IDLE_SECONDS: Final = 120.0
DAY_LIMIT_SECONDS: Final = 1800.0
WAIT_SECONDS: Final = 30.0
PROGRESS_SECONDS: Final = 15.0
# The most archives one `wanted` names (`WORKER_ARCHIVES_MAX` on the server).
ARCHIVES_MAX: Final = 200


def _duty_of(answer: Mapping[str, object]) -> Mapping[str, object] | None:
    """The series the server asks this computer to share, when the answer names one of the right shape."""
    copy = answer.get("copy")
    return copy if isinstance(copy, dict) and ID.fullmatch(str(copy.get("jobId", ""))) else None


class SharePacing:
    """The governor's budget for one copy: the rate of its profile, a stop at the worker's end, and the progress said now and then."""

    def __init__(
        self,
        profile: Callable[[], str | None],
        stop: threading.Event,
        report: Callable[[str, int, int], None],
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._profile, self._stop, self._report, self._clock = profile, stop, report, clock
        self._job, self._total, self._sent = "", 0, 0
        self._since = self._said = 0.0

    def rate(self) -> int:
        """Bytes a second for the profile in force now."""
        return RATES.get(self._profile() or QUIET, RATES[QUIET])

    def start(self, job_id: str, total: int) -> None:
        self._job, self._total, self._sent = job_id, total, 0
        self._since = self._said = self._clock()
        self._report(job_id, 0, total)

    def sent(self, size: int) -> None:
        """One sheet sent: wait until the average is within the rate (and while paused), say the progress now and then."""
        self._sent += size
        self._hold(self._sent / self.rate() - (self._clock() - self._since))
        while self._profile() == PAUSED and not self._stop.is_set():
            self._stop.wait(WAIT_SECONDS)
        if self._stop.is_set():
            raise ShareStoppedError(f"stopped after {self._sent} of {self._total} bytes")
        if self._clock() - self._said >= PROGRESS_SECONDS:
            self._said = self._clock()
            self._report(self._job, self._sent, self._total)

    def _hold(self, seconds: float) -> None:
        if seconds > 0:
            self._stop.wait(seconds)


class Sharer:
    """The sharing thread: asks which series to share, sends it under the governor's budget, and waits as the answer says."""

    def __init__(self, api: WorkerApi, ids: tuple[str, str], archives: Callable[[], list[str]], sender: CopySender) -> None:
        self._api, self._archives, self._sender = api, archives, sender
        self._city, self._worker = ids
        self.stopping = threading.Event()
        # Whether the worker's session is held (the loop signs it in); the governor's profile in force (`full`, `quiet`, `paused`).
        self.signed_in: Callable[[], bool] = lambda: True
        self.profile: Callable[[], str | None] = lambda: None
        self.clock: Callable[[], float] = time.monotonic

    def run(self) -> None:
        """Until `stop`: one ask (and copy) at a time, then the wait its outcome sets."""
        while not self.stopping.is_set():
            self.stopping.wait(self.once())

    def stop(self) -> None:
        self.stopping.set()

    def once(self) -> float:
        """One ask and, when a series is named, its copy; how long to wait before the next."""
        archives = self._archives()[:ARCHIVES_MAX]
        if not archives:
            return IDLE_SECONDS
        if not self.signed_in() or self.profile() == PAUSED:
            return WAIT_SECONDS
        return self._ask(archives)

    def _ask(self, archives: list[str]) -> float:
        try:
            body = {"cityId": self._city, "workerId": self._worker, "copy": {"kind": "wanted", "archives": archives}}
            answer = self._api.call(ARCHIVE_COPY, body)
        except CALL_ERRORS as error:
            LOG.warning("the server named no series to share: %s", error)
            return IDLE_SECONDS
        duty = _duty_of(answer)
        if duty is None:
            return DAY_LIMIT_SECONDS if answer.get("idle") == "dayLimit" else IDLE_SECONDS
        LOG.info("sharing series %s with %s other computers", duty.get("seriesId"), answer.get("computers"))
        self._share(duty)
        return AGAIN_SECONDS

    def _share(self, duty: Mapping[str, object]) -> None:
        pacing = SharePacing(self.profile, self.stopping, self._progress, self.clock)
        try:
            self._sender.send(self._city, duty, pacing)
        except CALL_ERRORS as error:
            # A refused progress or done: the job no longer takes a copy (claimed, cancelled); the next ask names another.
            LOG.warning("the copy for job %s ended: %s", duty.get("jobId"), error)

    def _progress(self, job_id: str, sent: int, total: int) -> None:
        progress = {"kind": "progress", "sentBytes": sent, "totalBytes": total}
        self._api.call(ARCHIVE_COPY, {**JobIds(self._city, self._worker, job_id).body(), "copy": progress})


def sharer(api: WorkerApi, city_id: str, worker_id: str, store: ArchiveStore, signed: httpx.Client) -> Sharer:
    """The sharing thread of a worker holding `store`'s archives, its copies signed by `worker.archiveCopy`."""
    return Sharer(api, (city_id, worker_id), store.held, copy_sender(api, city_id, worker_id, store, signed))
