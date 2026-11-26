"""The worker's loop (docs/research/M7-local-worker.md §1.2).

While a session is held: `worker.claim {cityId, workerId}` every `pollSeconds`, less often once idle for a while (`pace.py`;
a claim also tells the server the worker is alive); a claimed job runs at once, one at a time, with the normal runner
(`runtime.py`); then `worker.end` reports
`done` whatever state the run left the job in, or `failed` with the error when the run crashed outside a step (the
server fails the job if the worker still holds it). A job the server says this worker no longer holds, or a session
that ended, stops the run where it is without another write (a lost lease to the runner). SIGTERM or Ctrl-C: between
jobs the loop ends; during a run the step stops at its next checkpoint and the job goes back to `queued` (the runner's
path), then the loop ends; the process exits 0. One signal is enough at any moment: the runner's handler tells the
loop's (a signal after the run's last checkpoint was once lost), and the loop's takes no lock (docs/LESSONS.md 342).
Finding 67 of 2026-11-02: without a session each pass first lets the connector try (the command's pairing code, or the
session kept in the work folder); a call answered `apiError.worker.revoked` (Disconnect this computer) ends the session
and deletes the kept one; a claim answered `outdated` (the pipeline was updated in the admin) is said on the page.
A claim names the job types this image runs (`RUN_JOB_TYPES`): a newer type stays queued for an updated worker, not failed here.
W5 (household computers): a claim also says the governor's share (`share`), so the server leaves a job to a calmer computer.
M20 (2026-11-13): a claim also names the local archives this computer holds whole (`archives`); its answer may instead be
`copy`, a series another worker waits for, whose sheets this computer sends through the bucket (`copier`, `archive/copy.py`)
before its next claim; a run that finds neither the sheets nor their copy ends `returned`, and the server queues the job again
unspent, waiting for that copy. M20 §22 (2026-11-14): a worker that shares from its own thread (`sharing.py`, also while it runs a
job) says `shares`, and its claim is never answered `copy`.
Finding 72 (the starter file, M7 §1.5): under the starter's supervisor (`supervised`) an outdated claim ends the loop
instead (`outdated_exit`), and the command exits with `ExitCode.OUTDATED`, so the supervisor pulls the installed image.
Each pass that holds a session sweeps the work folder after its claim (`sweep`, `runtime.py`), told the job it claimed.
Pause this computer (the owner's request of 2026-11-13, `pausing.py`): a claim carries the command of the computer's own page (`pause`)
and its answer's `paused` is mirrored into the governor; while paused the loop claims every `pollSeconds`, a running job stops at its
next checkpoint (`asked_to_release`) and `worker.end` says `released` (the server queues it again, its attempt given back); a job the
owner paused stops before its next step and ends `done` (the runner queued it, held by its `paused`).
"""

import enum
import signal
import threading
import time
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from types import FrameType
from typing import Final, Protocol

from hcm_pipeline.contract import Errors
from hcm_pipeline.joblog import scrub
from hcm_pipeline.jobs import LeaseLostError, RunStoppedError
from hcm_pipeline.log import get_logger
from hcm_pipeline.model import RUN_JOB_TYPES
from hcm_pipeline.paths import ID
from hcm_pipeline.runner import STOP_SIGNALS, RunOutcome
from hcm_pipeline.worker.api import CLAIM, END, REVOKED, RevokedError, WorkerApi, WorkerApiError
from hcm_pipeline.worker.household import Removal
from hcm_pipeline.worker.pausing import Command, PauseControl
from hcm_pipeline.worker.session import RefreshUnavailableError, Session
from hcm_pipeline.worker.state import WorkerState

LOG = get_logger("worker.loop")
# What a call to the server may raise besides answering: a refusal, the job lost or the session ended, Google's token
# service out of reach.
CALL_ERRORS: Final = (WorkerApiError, LeaseLostError, RefreshUnavailableError)
# How often a worker without a session looks again (the page's sign-in wakes it sooner).
NO_SESSION_SECONDS: Final = 1.0
ERROR_MESSAGE_MAX: Final = 2000
# The longest a wait goes without looking at the signal's flag: the handler sets it without waking the wait.
SIGNAL_CHECK_SECONDS: Final = 0.25


class Pass(enum.Enum):
    """What one pass of the loop did."""

    NO_SESSION = "no-session"
    IDLE = "idle"
    RAN = "ran"
    INTERRUPTED = "interrupted"


class JobRunning(Protocol):
    def run(self, job_id: str, asked_to_stop: Callable[[], bool], asked_to_release: Callable[[], bool]) -> RunOutcome: ...


class Connecting(Protocol):
    """Signs the worker in without the page (`pairing.Connector`)."""

    def attempt(self) -> None: ...

    def forget(self) -> None: ...


class NoConnector:
    """A worker without a pairing code or kept session: only the page signs it in."""

    def attempt(self) -> None:
        return None

    def forget(self) -> None:
        return None


@dataclass(frozen=True)
class Ending:
    """What `worker.end` reports."""

    outcome: str
    error: dict[str, str] | None = None
    # P1-6: a `released` that a full disk caused, said to the server (`diskFull`) so the attempt is given back.
    disk_full: bool = False

    def wire(self) -> dict[str, object]:
        """The ending's fields of `worker.end` beyond its outcome."""
        return {**({"error": self.error} if self.error else {}), **({"diskFull": True} if self.disk_full else {})}

    @classmethod
    def crashed(cls, error: Exception) -> Ending:
        message = scrub(f"{type(error).__name__}: {error}")[:ERROR_MESSAGE_MAX]
        return cls("failed", {"code": Errors.PROCESSING_FAILED, "message": message})


DONE: Final = Ending("done")
# M20 (2026-11-13): the job's archive is on another computer: the server queues it again without spending an attempt.
RETURNED: Final = Ending("returned")
# Pause this computer: the run stopped at a checkpoint; the server queues the job again without spending an attempt.
RELEASED: Final = Ending("released")
# The run's outcomes that end otherwise than `done`.
# P1-6 of the resilience audit: the disk filled up mid-run: handed back, its attempt given back; no claim until there is room.
DISK_FULL: Final = Ending("released", disk_full=True)
ENDINGS: Final[dict[RunOutcome, Ending]] = {
    RunOutcome.RETURNED: RETURNED,
    RunOutcome.RELEASED: RELEASED,
    RunOutcome.DISK_FULL: DISK_FULL,
}
# The most local archives a claim names (`WORKER_ARCHIVES_MAX` on the server).
CLAIM_ARCHIVES_MAX: Final = 200


def _job_of(answer: Mapping[str, object]) -> str | None:
    """The claimed job's id, when the answer names one of the right shape."""
    job = answer.get("job")
    job_id = job.get("jobId") if isinstance(job, dict) else None
    return job_id if isinstance(job_id, str) and ID.fullmatch(job_id) else None


def _copy_of(answer: Mapping[str, object]) -> Mapping[str, object] | None:
    """M20: the series the claim asks this computer to copy for another worker, when the answer names one."""
    copy = answer.get("copy")
    return copy if isinstance(copy, dict) and ID.fullmatch(str(copy.get("jobId", ""))) else None


class WorkerLoop:
    def __init__(self, session: Session, api: WorkerApi, state: WorkerState, runtime: JobRunning, ids: dict[str, str]) -> None:
        self._session = session
        self._connector: Connecting = NoConnector()
        self._api = api
        self._state = state
        self._runtime = runtime
        self._ids = ids
        self.stopping = threading.Event()
        # Set by the signal handler alone: one assignment, no lock (`_stopped` turns it into `stopping`).
        self._signalled = False
        self.no_session_seconds = NO_SESSION_SECONDS
        # What each pass with a session does to the work folder, told the job it just claimed (`WorkerRuntime.sweep`).
        self.sweep: Callable[[str | None], None] = lambda _claimed: None
        # The resilience work of 2026-11-14 (`housekeeping.py`): what each claim says of this computer's disk and scratch
        # (`disk`, `held`, `freed`), and what it does with the answer (`jobStates`, `freeSpace`, `lowDisk`).
        self.claim_extra: Callable[[], Mapping[str, object]] = dict
        self.on_claim_answer: Callable[[Mapping[str, object]], None] = lambda _answer: None
        # M20 (2026-11-13): the local archives this computer holds whole (`ArchiveStore.held`): it sends their series' copies.
        self.archives: Callable[[], list[str]] = list
        # 2026-11-13: the jobs whose stitched film is in this work folder (`held_films`): a job waiting for its film comes here.
        self.films: Callable[[], list[str]] = list
        # M20: the copy of a series another worker waits for, sent before any job (`CopySender.send`).
        self.copier: Callable[[Mapping[str, object]], None] = lambda _duty: None
        # M20 §22: this worker shares its archives from its own thread (`sharing.py`): the claim says so and is never asked for a copy.
        self.shares = False
        # Finding 72: under the starter's supervisor an outdated image ends the loop (the supervisor updates it).
        self.supervised = False
        self.outdated_exit = False
        # Pause this computer (`pausing.py`): the page's command, the server's pause mirrored; `Worker.build` gives it the governor.
        self.pausing = PauseControl()
        # Set by `nudge` (a command from the page): the wait ends at its next look. One assignment each: no lock.
        self._nudged = False
        # W5 (household computers): the governor's share, said with each claim (None: not known yet, nothing said).
        self.share: Callable[[], Mapping[str, object] | None] = lambda: None
        # W5, Remove this computer: whether the starter cleans the computer up (`HCM_REMOVABLE`), and the order once accepted.
        self.removable = False
        self.removal: Removal | None = None

    def nudge(self) -> None:
        """The page paused or resumed this computer: the loop's wait ends, so the next claim tells the server now."""
        self._nudged = True

    def connect_with(self, connector: Connecting) -> None:
        """The connector each pass without a session lets try first (finding 67: pairing, the kept session)."""
        self._connector = connector

    def stop(self) -> None:
        self.stopping.set()

    def run(self) -> None:
        """Passes until a signal (or `stop`) ends the loop."""
        with self._signals():
            while not self._stopped():
                self._pause(self.run_once())

    def _asked_to_stop(self) -> bool:
        """A signal or `stop` (read without a lock: the run asks at every checkpoint, from any thread)."""
        return self._signalled or self.stopping.is_set()

    def _stopped(self) -> bool:
        if self._signalled:
            self.stop()
        return self.stopping.is_set()

    def _pause(self, done: Pass) -> None:
        if done is Pass.INTERRUPTED:
            self.stop()
        elif done is Pass.RAN:
            self._state.pace.wake()
        elif done is Pass.NO_SESSION:
            self._wait(lambda: self.no_session_seconds)
        else:
            self._state.pace.idle_pass()
            self._wait(self._idle_seconds)

    def _idle_seconds(self) -> float:
        """How long this idle pass waits (`pace.py`): asked again at every look, so a wake shortens a long wait to the poll's."""
        timing = self._state.timing
        if self.pausing.paused:
            # Paused: no idle growth and no headroom stretch, so a Resume in the admin is seen within one poll.
            return timing.poll_seconds
        return self._state.pace.wait(timing.poll_seconds, timing.idle_poll_seconds)

    def _wait(self, seconds: Callable[[], float]) -> None:
        """Until `seconds` passed or the loop stops, looking at the signal's flag every `SIGNAL_CHECK_SECONDS`."""
        started = time.monotonic()
        while not self._stopped() and not self._take_nudge() and (left := started + seconds() - time.monotonic()) > 0:
            self.stopping.wait(min(left, SIGNAL_CHECK_SECONDS))

    def _take_nudge(self) -> bool:
        nudged, self._nudged = self._nudged, False
        return nudged

    def _on_signal(self, _signum: int, _frame: FrameType | None) -> None:
        """SIGTERM or Ctrl-C. No lock here: Python runs a handler in the main thread between two bytecodes, also while
        that thread holds `stopping`'s own lock inside `wait`, and `Event.set` would then wait for itself forever."""
        self._signalled = True

    @contextmanager
    def _signals(self) -> Iterator[None]:
        """SIGTERM and SIGINT end the loop (handlers only in the main thread, where Python delivers signals)."""
        if threading.current_thread() is not threading.main_thread():
            yield
            return
        previous = {number: signal.signal(number, self._on_signal) for number in STOP_SIGNALS}
        try:
            yield
        finally:
            for number, before in previous.items():
                signal.signal(number, before)

    def run_once(self) -> Pass:
        """One pass: nothing without a session (the connector tries first); else a claim, and the claimed job's run."""
        if not self._session.active:
            self._connector.attempt()
        if not self._session.active:
            return Pass.NO_SESSION
        job_id, duty = self._claim()
        self.sweep(job_id)
        if duty is not None:
            self.copier(duty)
            return Pass.RAN
        return Pass.IDLE if job_id is None else self._work(job_id)

    def _claim(self) -> tuple[str | None, Mapping[str, object] | None]:
        try:
            # Only the types this image runs: a newer type stays queued for an updated worker, never failed here.
            sent = self.pausing.pending()
            answer = self._api.call(CLAIM, self._claim_body(sent))
        except CALL_ERRORS as error:
            LOG.warning("worker.claim failed: %s", error)
            self._refused(error)
            return None, None
        self.pausing.answered(sent, answer)
        self.on_claim_answer(answer)
        removal = Removal.of(answer)
        if removal is not None:
            self._remove(removal)
            return None, None
        self._state.outdated(answer.get("outdated") is True)
        return (None, None) if self._ends_outdated() else (_job_of(answer), _copy_of(answer))

    def _claim_body(self, sent: Command | None) -> dict[str, object]:
        """The claim: the types this image runs, the archives it holds whole, its governor's share (W5), and the page's pause command."""
        share = self.share()
        said: dict[str, object] = {} if share is None else {"share": share}
        claim: dict[str, object] = {**self._ids, "types": list(RUN_JOB_TYPES), "archives": self.archives()[:CLAIM_ARCHIVES_MAX], **said}
        claim["films"] = self.films()[:CLAIM_ARCHIVES_MAX]
        claim.update({"shares": True} if self.shares else {})
        claim.update(self.claim_extra())
        return claim if sent is None else {**claim, "pause": sent.wire()}

    def _asked_to_release(self) -> bool:
        """This computer is paused: the run hands its job back at the next checkpoint (read from the run's threads, no lock here)."""
        return self.pausing.paused

    def _remove(self, removal: Removal) -> None:
        """W5: Remove this computer. Under a starter that cleans up, `accepted` and the loop ends (the command exits with the order's
        code); a worker with no such starter says it cannot (`no-starter`), and the admin offers Disconnect now anyway."""
        word = {"step": "accepted"} if self.removable else {"step": "failed", "why": "no-starter"}
        LOG.warning("the admin asked to remove this computer: %s", word["step"])
        self.say_removal(word)
        if self.removable:
            self.removal = removal
            self.stop()

    def remove_here(self) -> str | None:
        """W5: Stop using this computer from its own page: the loop ends with an order of no Docker, keeping nothing (the
        starter's last run says done, which disconnects it); `no-starter` when no starter cleans up."""
        if not self.removable:
            return "no-starter"
        LOG.warning("stop using this computer was pressed on its page: the starter cleans it up")
        self.removal = Removal(docker=False, keep=False)
        self.stop()
        return None

    def say_removal(self, word: Mapping[str, object]) -> bool:
        """The worker's word on its removal (a claim that takes no job); the starter's last run says `done` with the kept session."""
        if not self._session.active:
            self._connector.attempt()
        if not self._session.active:
            LOG.warning("the removal's word cannot be sent: no session")
            return False
        try:
            self._api.call(CLAIM, {**self._ids, "removal": dict(word)})
        except CALL_ERRORS as error:
            LOG.warning("the removal's word was not taken: %s", error)
            return False
        return True

    def _ends_outdated(self) -> bool:
        """Under the starter's supervisor, an outdated image ends the loop (finding 72); true when it did."""
        if not (self.supervised and self._state.is_outdated):
            return False
        LOG.warning("this image is older than the installed pipeline's: stopping, so the supervisor starts the new one")
        self.outdated_exit = True
        self.stop()
        return True

    def _work(self, job_id: str) -> Pass:
        LOG.info("claimed job %s", job_id)
        self._state.busy(job_id)
        outcome, ending = self._run(job_id)
        self._state.idle()
        self._end(job_id, ending)
        return Pass.INTERRUPTED if outcome is RunOutcome.REQUEUED else Pass.RAN

    def _run(self, job_id: str) -> tuple[RunOutcome, Ending]:
        try:
            outcome = self._runtime.run(job_id, self._asked_to_stop, self._asked_to_release)
            return outcome, ENDINGS.get(outcome, DONE)
        except RunStoppedError as stop:
            LOG.warning("job %s stopped without another write: %s", job_id, stop)
            return RunOutcome.UNTOUCHED, DONE
        except Exception as error:  # a crash outside a step: the server fails the job if this worker still holds it
            LOG.exception("job %s crashed outside a step", job_id)
            self._state.failed(Errors.PROCESSING_FAILED)
            return RunOutcome.FAILED, Ending.crashed(error)

    def _end(self, job_id: str, ending: Ending) -> None:
        if not self._session.active:
            LOG.warning("job %s ended without a session: worker.end cannot be sent", job_id)
            return
        report: dict[str, object] = {**self._ids, "jobId": job_id, "outcome": ending.outcome}
        sent = self.pausing.pending()
        extra = {**ending.wire(), **({"pause": sent.wire()} if sent else {})}
        try:
            self._api.call(END, {**report, **extra})
            self.pausing.delivered(sent)
        except CALL_ERRORS as error:
            LOG.warning("worker.end failed: %s", error)
            self._refused(error)

    def _refused(self, error: Exception) -> None:
        """The page's last error; Disconnect this computer also ends the session and deletes the kept one."""
        self._state.failed(getattr(error, "code", None))
        if isinstance(error, RevokedError):
            LOG.warning("this computer was disconnected in the admin; run the admin's command again to reconnect it")
            self._session.end(REVOKED)
            self._connector.forget()
