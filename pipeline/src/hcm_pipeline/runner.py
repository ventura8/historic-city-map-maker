"""`python -m hcm_pipeline run`: one execution of a raster job (docs/research/M3-interfaces.md §4.4-§4.5, §5.2).

It takes the lease, validates the job, then walks the job type's pipeline steps in order: a step recorded `done`
or `skipped` whose output still exists is passed over, so a retry or a resume continues where the job stopped.
How a run ends:

| Ending | The job | Exit |
| --- | --- | --- |
| every step done | `awaiting_approval` (`waitReason: 'approval'`), lease released | 0 |
| every step done of a side job (`SIDE_JOB_TYPES`: M12's `layer-tiles`) | `succeeded`, lease released | 0 |
| a step waits | `waiting_usgs` with `retryAt`, or `awaiting_gcps`; the step `pending` | 0 |
| a step fails | `failed` with `error {code, message, params}`; the version `failed` | 1 |
| an invalid job | `failed` with `apiError.invalidRequest` (a retry cannot help) | 1 |
| a job type this image does not run | `failed` with `apiError.imagery.pipelineOutdated` (an updated pipeline's retry runs it) | 1 |
| a step declines (M16: a refine with nothing better, `DeclinedError`) | `cancelled` with its `error`; the version `cancelled` with it | 0 |
| `cancelRequested` (heartbeat, a checkpoint, or SIGTERM after it) | `cancelled`; the version `cancelled`; its `work/` objects deleted | 0 |
| SIGTERM (or SIGINT: a local worker's Ctrl-C), no cancel | `queued` with `retryAt` + 1 minute; the step `pending` | 0 |
| the owner paused the job (`paused`, seen before a step starts) | `queued`, held by its `paused` until Resume; no step changed | 0 |
| this computer was paused (`releaseRequested`, or the worker's own pause) | untouched but the step `pending`; `released` queues it | 0 |
| the download phase done on the small `fetch` job | `queued`, lease released: dispatched again on `std` or `xl` | 0 |
| another live owner holds the lease, or the job is not runnable | untouched | 0 |
| M20: an archive series without its sheets here nor a copy (`ArchiveElsewhereError`) | untouched; `returned` queues it | 0 |

A side job works beside its version and never decides its state: its failure or its cancellation leaves the version where it stands.

Local scratch files live in a temporary folder removed whatever the ending. A step whose recorded output is gone runs
again, except what only feeds `locate` once `locate` is finished: `fetch` (`locate` deletes the delivery:
docs/research/M7-local-worker.md §5), `extract` and `stitch` (their `work/` files go with the job's scratch); and `fetch` once
`extract` is finished: the segments outlive the delivery by a week, and nothing else reads it.

An import runs in two phases (finding 56 of 2026-11-01): a run on the small `fetch` job does the download phase
(`DOWNLOAD_STEPS`, network-bound) and hands the job back, queued, for its processing on `std` (or `xl`); a run on a
larger job (or one no dispatcher sized: a local worker) does whatever is left. The version records which job each phase
ran on (`machines.download`, `machines.process`).
"""

import enum
import errno
import signal
import tempfile
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from types import FrameType
from typing import Final, Protocol

from hcm_pipeline import paths
from hcm_pipeline.archive.copy import ensure_series
from hcm_pipeline.config import Config
from hcm_pipeline.contract import (
    DEFAULT_STEP_LIMIT_SECONDS,
    DOWNLOAD_STEPS,
    REQUEUE_SECONDS,
    SIDE_JOB_TYPES,
    STEP_LIMIT_SECONDS,
    Errors,
    pipeline_steps_of,
    step_weights,
)
from hcm_pipeline.documents import Version
from hcm_pipeline.intact import output_intact
from hcm_pipeline.joblog import JobLog, scrub
from hcm_pipeline.jobs import (
    ArchiveElsewhereError,
    CancelledRunError,
    DeclinedError,
    Done,
    JobContext,
    LeaseLostError,
    PausedRunError,
    ReleasedRunError,
    RunFlags,
    RunStoppedError,
    Services,
    Skipped,
    StepDeadline,
    StepFailedError,
    StepResult,
    Waiting,
)
from hcm_pipeline.lease import Heartbeat, owned_change, take_lease
from hcm_pipeline.log import get_logger
from hcm_pipeline.model import DocumentError, Job, OutdatedJobError, Record, StepRecord, Timestamp, params_of, stamp
from hcm_pipeline.objects import ObjectInfo
from hcm_pipeline.store import DELETE

LOG = get_logger("runner")
ERROR_MESSAGE_MAX: Final = 2000


class RunOutcome(enum.Enum):
    DONE = "done"
    WAITING = "waiting"
    CANCELLED = "cancelled"
    REQUEUED = "requeued"
    UNTOUCHED = "untouched"
    FAILED = "failed"
    # M20 (2026-11-13): the job's archive is on another computer; the worker hands it back.
    RETURNED = "returned"
    # Pause (the owner's request of 2026-11-13): the owner paused the job; it waits queued for Resume.
    PAUSED = "paused"
    # This computer was paused: the worker hands the job back (`worker.end` `released`), its attempt given back.
    RELEASED = "released"
    # P1-6 of the resilience audit: the owner's computer ran out of disk; the worker hands the job back, its attempt given back.
    DISK_FULL = "disk-full"


# What the disk says when it is full, in an OSError's errno or in a message GDAL or a step passed on.
NO_SPACE: Final = "No space left on device"


def disk_full(error: BaseException) -> bool:
    """True for an error a full disk caused (`ENOSPC`), however a step passed it on."""
    if isinstance(error, OSError) and error.errno == errno.ENOSPC:
        return True
    return NO_SPACE in str(error) or (error.__cause__ is not None and disk_full(error.__cause__))


class JobStep(Protocol):
    """One pipeline step (`steps/<name>.py`)."""

    @property
    def name(self) -> str: ...

    def run(self, ctx: JobContext) -> StepResult: ...


# The signals that stop a run at its next checkpoint: Cloud Run's SIGTERM, and Ctrl-C on a local worker (M7).
STOP_SIGNALS: Final = (signal.SIGTERM, signal.SIGINT)
# `fetch`'s delivery is deleted by `locate` once the city crop exists (docs/research/M7-local-worker.md §5), and `extract`'s
# segments and `stitch`'s frame feed `locate` alone, in a `work/` that `register`, the bucket's lifecycle or the worker's
# sweep empties: a resume after `locate` needs none of them, so they are made again only while `locate` is not finished.
LOCATE_INPUTS: Final = ("fetch", "extract", "stitch")
LOCATE_STEP: Final = "locate"
# A Landsat scene skips `locate`: its bands (`extract`) feed `warp`. Only a consumer that ran (`done`, its output still here)
# makes its inputs dispensable; a skipped `locate` proves nothing, so a Landsat job resumed on a computer without its bands
# extracts them again instead of failing `warp` with `missingBand` (live, 2026-11-14: lesson 706).
CONSUMERS: Final = (LOCATE_STEP, "warp")
# ... and `extract` alone reads the delivery: with its segments still there, a retry after the delivery's seven days has nothing to
# download (8.7 GB that nothing reads, and a disk check that counts the segments' 13 GB against it).
DELIVERY_STEP: Final = "fetch"
EXTRACT_STEP: Final = "extract"


def _chained(before: object) -> Callable[[int, FrameType | None], object] | None:
    """The handler that was there before the run, when it is a Python one to tell too: the local worker's loop (M7).
    Not the default ones: Python's Ctrl-C handler would raise `KeyboardInterrupt` in the middle of the run."""
    return before if callable(before) and before is not signal.default_int_handler else None


@contextmanager
def sigterm_raises(flags: RunFlags) -> Iterator[None]:
    """While the run lasts, SIGTERM (or SIGINT) raises the flag the next checkpoint turns into `InterruptedRunError`,
    and tells the handler it replaced: a signal after the run's last checkpoint (its final writes, its log line) would
    otherwise be lost to the local worker's loop, which then kept claiming (docs/LESSONS.md 342)."""
    chained: dict[int, Callable[[int, FrameType | None], object] | None] = {
        int(number): _chained(signal.getsignal(number)) for number in STOP_SIGNALS
    }

    def handler(signum: int, frame: FrameType | None) -> None:
        flags.interrupt()
        before = chained.get(signum)
        if before is not None:
            before(signum, frame)

    previous = {number: signal.signal(number, handler) for number in STOP_SIGNALS}
    try:
        yield
    finally:
        for number, before in previous.items():
            signal.signal(number, before)


@dataclass(frozen=True)
class RunSettings:
    """What tests shorten: the heartbeat's interval; and the local worker's stop, which a run obeys from its start (M7)."""

    heartbeat_seconds: float | None = None
    asked_to_stop: Callable[[], bool] = lambda: False
    # The computer's pause (the local worker): the run stops at its next checkpoint and hands the job back.
    asked_to_release: Callable[[], bool] = lambda: False
    # Each step's wall-time limit in seconds, over `STEP_LIMIT_SECONDS` (the rest keep `DEFAULT_STEP_LIMIT_SECONDS`).
    step_limits: Mapping[str, float] = field(default_factory=dict)

    def limit_of(self, step: str) -> float:
        return float(self.step_limits.get(step, STEP_LIMIT_SECONDS.get(step, DEFAULT_STEP_LIMIT_SECONDS)))


class JobRunner:
    def __init__(self, config: Config, services: Services, steps: Mapping[str, JobStep], settings: RunSettings | None = None) -> None:
        self._config = config
        self._services = services
        self._steps = steps
        self._settings = settings or RunSettings()
        self._path = f"cities/{config.city_id}/jobs/{config.job_id}"
        self._log = JobLog(services.store, f"{self._path}/logs", services.clock, LOG)

    def _now(self) -> Timestamp:
        return Timestamp.at(self._services.clock())

    def run(self, only: str | None = None) -> RunOutcome:
        """One execution; `only` runs that single step (debugging)."""
        decision = take_lease(self._services.store, self._path, self._config.lease_owner, self._now())
        if not decision.taken:
            LOG.info("job %s not run: %s", self._config.job_id, decision.verdict)
            return RunOutcome.UNTOUCHED
        flags = RunFlags(self._settings.asked_to_stop, asked_to_release=self._settings.asked_to_release)
        heartbeat = Heartbeat(self._services.store, self._path, self._config.lease_owner, flags, self._services.clock)
        heartbeat.interval = self._settings.heartbeat_seconds or heartbeat.interval
        with tempfile.TemporaryDirectory(prefix=f"hcm-{self._config.job_id}-") as scratch, heartbeat, sigterm_raises(flags):
            return self._leased(decision.record, flags, Path(scratch), only)

    def _leased(self, record: Record, flags: RunFlags, scratch: Path, only: str | None) -> RunOutcome:
        try:
            ctx = self._context(Job.of(self._config.job_id, record), flags, scratch)
        except DocumentError as error:
            failure = StepFailedError(_invalid_code(error), str(error))
            self._fail_version_of(record, failure)
            return self._fail_job(None, failure)
        return self._guarded(ctx, only)

    def _guarded(self, ctx: JobContext, only: str | None) -> RunOutcome:
        try:
            return self._walk_here(ctx, only)
        except RunStoppedError as stop:
            return self._stopped(ctx, stop)
        except Exception as error:  # a crash still ends the job with a code, never a silent lapse
            return self._broke(ctx, error)

    def _broke(self, ctx: JobContext, error: Exception) -> RunOutcome:
        """A step that failed fails the job, a crash too (with a code), but a full disk on the owner's computer hands it back."""
        if self._config.execution == "worker" and disk_full(error):
            return self._disk_full(ctx)
        if isinstance(error, StepFailedError):
            return self._failed(ctx, error)
        LOG.exception("job %s crashed in %s", ctx.job.id, ctx.step or "start")
        return self._fail_job(ctx, StepFailedError(Errors.INTERNAL, f"{type(error).__name__}: {error}"))

    def _stopped(self, ctx: JobContext, stop: RunStoppedError) -> RunOutcome:
        if isinstance(stop, LeaseLostError):
            LOG.warning("job %s: another execution holds the lease; stopping without writing", ctx.job.id)
            return RunOutcome.UNTOUCHED
        if isinstance(stop, PausedRunError):
            return self._paused(ctx)
        if isinstance(stop, ReleasedRunError):
            return self._released(ctx)
        return self._ended(ctx, stop)

    def _ended(self, ctx: JobContext, stop: RunStoppedError) -> RunOutcome:
        """A cancel (asked, or seen now) ends the job; any other stop queues it again from its checkpoint."""
        cancel = isinstance(stop, CancelledRunError) or self._cancel_requested(ctx)
        return self._cancel(ctx) if cancel else self._requeue(ctx)

    def _walk_here(self, ctx: JobContext, only: str | None) -> RunOutcome:
        """M20 (2026-11-13): an archive series' sheets on this computer first (or their copy); without them the job goes back."""
        try:
            ensure_series(ctx)
            return self._walk(ctx, only)
        except ArchiveElsewhereError as elsewhere:
            # Also a stitched film on another computer (`FilmElsewhereError`, 2026-11-13), raised from inside a step.
            self._log.warn(f"{elsewhere}; the job goes back for the computer that has the files", None)
            return RunOutcome.RETURNED

    def _context(self, job: Job, flags: RunFlags, scratch: Path) -> JobContext:
        params_of(job)
        if job.version_id is None:
            raise DocumentError("the job names no layer version")
        version = self._version(job.version_id)
        return JobContext(self._config, self._services, job, version, scratch, flags, self._log)

    def _version(self, version_id: str) -> Version:
        record = self._services.store.get(f"cities/{self._config.city_id}/layerVersions/{version_id}")
        if record is None:
            raise DocumentError(f"the layer version {version_id} does not exist")
        return Version.of(version_id, record)

    def _cancel_requested(self, ctx: JobContext) -> bool:
        record = self._services.store.get(self._path) or {}
        return ctx.flags.cancel_requested or record.get("cancelRequested") is True

    # --- the step loop ---------------------------------------------------------------------------------

    def _walk(self, ctx: JobContext, only: str | None) -> RunOutcome:
        weights, base = step_weights(ctx.job.type), 0.0
        for name in _walked(ctx, only):
            result = self._step(ctx, name, base, weights[name]) if only in (None, name) else Done()
            if isinstance(result, Waiting):
                return self._wait(ctx, name, result)
            base += weights[name]
        return self._end(ctx, only, base)

    def _end(self, ctx: JobContext, only: str | None, progress: float) -> RunOutcome:
        """A step run on its own releases the job; the small job hands it over; a whole walk awaits approval."""
        if only is not None:
            return self._release(ctx)
        return self._hand_over(ctx, progress) if _on_small_job(ctx) else self._finish(ctx)

    def _finished(self, record: StepRecord) -> bool:
        if record.status not in ("done", "skipped"):
            return False
        return record.gcs_path is None or self._output_kept(record, record.gcs_path)

    def _output_kept(self, record: StepRecord, path: str) -> bool:
        """The recorded output is still there, of its generation, and whole."""
        info = self._services.objects.stat(path)
        return info is not None and record.generation in (None, info.generation) and self._intact(record, info)

    def _intact(self, record: StepRecord, info: ObjectInfo) -> bool:
        """P0-3: a local output a power cut may have torn is checked by its size and first bytes before it is passed over."""
        if output_intact(self._services.objects, record, info, self._config.execution == "worker"):
            return True
        self._log.warn(f"{info.path} is damaged (the computer stopped while writing it?): its step runs again", None)
        return False

    def _consumed(self, ctx: JobContext, name: str) -> bool:
        """True for what feeds `locate` (a Landsat scene's `warp`) once that step ran, and for the delivery once its segments or
        bands are out: nothing after them reads those outputs, maybe gone by now."""
        finished_with = (*CONSUMERS, EXTRACT_STEP) if name == DELIVERY_STEP else CONSUMERS
        return name in LOCATE_INPUTS and any(self._ran(ctx.job.step(step)) for step in finished_with)

    def _ran(self, record: StepRecord) -> bool:
        """The step ran (`done`, not `skipped`) and its output is still there."""
        return record.status == "done" and self._finished(record)

    def _step(self, ctx: JobContext, name: str, base: float, weight: float) -> StepResult:
        self._refresh(ctx)
        if self._finished(ctx.job.step(name)) or self._consumed(ctx, name):
            return Done()
        ctx.step = name
        _record_machine(ctx, name)
        limit = self._settings.limit_of(name)
        clock = self._services.clock
        ctx.flags.enter(name, base, weight, StepDeadline(name, clock() + limit, limit, clock))
        started = self._now()
        ctx.update_job({"step": name, f"steps.{name}": StepRecord("running", started_at=started).as_record(), "progress": round(base, 4)})
        self._log.info(f"step {name} started", name)
        result = self._steps[name].run(ctx)
        if not isinstance(result, Waiting):
            ctx.update_job({f"steps.{name}": _record(result, started, self._now()), "progress": round(base + weight, 4)})
            self._log.info(f"step {name} {'skipped: ' + result.reason if isinstance(result, Skipped) else 'done'}", name)
        return result

    def _refresh(self, ctx: JobContext) -> None:
        """The job and its version as the previous steps left them; stops here when the admin asked to cancel."""
        ctx.checkpoint()
        ctx.job = Job.of(ctx.job.id, self._services.store.get(self._path) or {})
        if ctx.job.cancel_requested:
            raise CancelledRunError("the admin asked to cancel the job")
        if ctx.job.paused:
            raise PausedRunError("the owner paused the job")
        ctx.version = self._version(ctx.version.id)

    # --- endings ------------------------------------------------------------------------------------------

    def _final(self, fields: Record) -> None:
        """A write that ends the run, made only while this execution still holds the lease."""
        self._services.store.transact(self._path, owned_change(self._config.lease_owner, {**fields, "lease": DELETE, **stamp(self._now())}))

    def _current(self, name: str) -> StepRecord:
        """The step's record as stored now (with the start this run wrote)."""
        return Job.of(self._config.job_id, self._services.store.get(self._path) or {"type": "-", "status": "-"}).step(name)

    def _pending(self, ctx: JobContext, name: str) -> Record:
        return {f"steps.{name}": StepRecord("pending", started_at=self._current(name).started_at).as_record()}

    def _wait(self, ctx: JobContext, name: str, waiting: Waiting) -> RunOutcome:
        fields: Record = {"status": waiting.status, "waitReason": waiting.reason, **self._pending(ctx, name)}
        self._final({**fields, "retryAt": waiting.retry_at or DELETE})
        self._log.info(waiting.message, name)
        return RunOutcome.WAITING

    def _finish(self, ctx: JobContext) -> RunOutcome:
        if ctx.job.type in SIDE_JOB_TYPES:
            self._final({"status": "succeeded", "finishedAt": self._now(), "progress": 1.0})
            self._log.info("the job is done; its version stays where it was", ctx.step or None)
            return RunOutcome.DONE
        self._final({"status": "awaiting_approval", "waitReason": "approval", "progress": 1.0})
        self._log.info("the layer version awaits approval", ctx.step or None)
        return RunOutcome.DONE

    def _hand_over(self, ctx: JobContext, progress: float) -> RunOutcome:
        """The download phase is done on the small job: the job is queued again for its processing (the dispatcher)."""
        self._final({"status": "queued", "progress": round(progress, 4)})
        self._log.info("the scene is downloaded; its processing is queued for a larger machine", ctx.step or None)
        return RunOutcome.DONE

    def _release(self, ctx: JobContext) -> RunOutcome:
        self._final({"status": "queued"})
        self._log.info(f"step {ctx.step} run on its own; the job is queued again", ctx.step or None)
        return RunOutcome.DONE

    def _requeue(self, ctx: JobContext) -> RunOutcome:
        """Back to `queued`; the step it stopped in, if it had started one (a stop asked before the first step has none)."""
        pending = self._pending(ctx, ctx.step) if ctx.step else {}
        self._final({"status": "queued", "retryAt": self._now().plus(REQUEUE_SECONDS), **pending})
        self._log.warn("stopped by Cloud Run (SIGTERM); the job resumes from its checkpoint", ctx.step or None)
        return RunOutcome.REQUEUED

    def _paused(self, ctx: JobContext) -> RunOutcome:
        """The owner paused the job: back to `queued` between two steps (nothing to undo), held by its `paused` until Resume."""
        self._final({"status": "queued", "retryAt": DELETE})
        where = f" after step {ctx.step}" if ctx.step else " before its first step"
        self._log.info(f"paused by the owner{where}; Resume puts it back in the queue and it goes on from there", ctx.step or None)
        return RunOutcome.PAUSED

    def _released(self, ctx: JobContext) -> RunOutcome:
        """This computer was paused: the step it stopped in is `pending` again; the worker hands the job back (`released`)."""
        if ctx.step and self._current(ctx.step).status == "running":
            ctx.update_job(self._pending(ctx, ctx.step))
        self._log.info("this computer was paused; the job goes back to the queue and resumes from this step", ctx.step or None)
        return RunOutcome.RELEASED

    def _disk_full(self, ctx: JobContext) -> RunOutcome:
        """P1-6: the computer's disk filled up mid-step: the step is `pending` again and the job goes back without using an attempt;
        the worker takes no job until it has room (`lowDisk`)."""
        if ctx.step and self._current(ctx.step).status == "running":
            ctx.update_job(self._pending(ctx, ctx.step))
        self._log.warn(
            "this computer's disk is full, so the work stopped; the job goes back to the queue without using a try. "
            "Free space on the computer (Free space now on its card in Settings, Computers), then it continues from this step",
            ctx.step or None,
        )
        return RunOutcome.DISK_FULL

    def _cancel(self, ctx: JobContext) -> RunOutcome:
        now = self._now()
        self._final({"status": "cancelled", "finishedAt": now})
        if ctx.job.type not in SIDE_JOB_TYPES:
            self._services.store.update(ctx.version_path(), {"state": "cancelled", **stamp(now)})
        _delete_work(ctx)
        self._log.info("the job was cancelled; its scratch files are deleted", ctx.step or None)
        return RunOutcome.CANCELLED

    def _failed(self, ctx: JobContext, error: StepFailedError) -> RunOutcome:
        return self._decline(ctx, error) if isinstance(error, DeclinedError) else self._fail_job(ctx, error)

    def _decline(self, ctx: JobContext, declined: StepFailedError) -> RunOutcome:
        """M16: the job and its version end `cancelled` with the step's reason; nothing was rendered, so its work files go."""
        now = self._now()
        step = {f"steps.{ctx.step}": {**self._current(ctx.step).as_record(), "status": "skipped"}} if ctx.step else {}
        self._final({"status": "cancelled", "finishedAt": now, "error": _job_error(declined), **step})
        self._services.store.update(ctx.version_path(), {"state": "cancelled", "error": _version_error(declined), **stamp(now)})
        _delete_work(ctx)
        self._log.info(f"declined, nothing rendered: {declined}", ctx.step or None)
        return RunOutcome.CANCELLED

    def _fail_version_of(self, record: Record, error: StepFailedError) -> None:
        """An invalid job's version, when it names one that exists: failed with it, so a Retry or a Dismiss finds it failed."""
        path = f"cities/{self._config.city_id}/layerVersions/{record.get('versionId')}"
        owned = record.get("type") not in SIDE_JOB_TYPES and isinstance(record.get("versionId"), str)
        if owned and self._services.store.get(path) is not None:
            self._services.store.update(path, {"state": "failed", "error": _version_error(error), **stamp(self._now())})

    def _fail_version(self, ctx: JobContext | None, error: StepFailedError, now: Timestamp) -> None:
        """The job's version fails with it, unless the job only works beside it."""
        if ctx is not None and ctx.job.type not in SIDE_JOB_TYPES:
            self._services.store.update(ctx.version_path(), {"state": "failed", "error": _version_error(error), **stamp(now)})

    def _fail_job(self, ctx: JobContext | None, error: StepFailedError) -> RunOutcome:
        now = self._now()
        failed = {f"steps.{ctx.step}": {**self._current(ctx.step).as_record(), "status": "failed"}} if ctx and ctx.step else {}
        self._final({"status": "failed", "finishedAt": now, "error": _job_error(error), **failed})
        self._fail_version(ctx, error, now)
        self._log.error(f"{error.code}: {error}", ctx.step if ctx else None)
        return RunOutcome.FAILED


def _on_small_job(ctx: JobContext) -> bool:
    """True on the small `fetch` job, which runs an import's download phase only."""
    return ctx.job.machine == "fetch"


def _walked(ctx: JobContext, only: str | None) -> tuple[str, ...]:
    """The steps this run walks: the download phase on the small job (a whole walk), else every one of the job type."""
    steps = pipeline_steps_of(ctx.job.type)
    return tuple(step for step in steps if step in DOWNLOAD_STEPS) if only is None and _on_small_job(ctx) else steps


def _record_machine(ctx: JobContext, name: str) -> None:
    """The version records the job its step's phase runs on, once a phase (a run no dispatcher sized records none)."""
    phase = "download" if name in DOWNLOAD_STEPS else "process"
    machine = ctx.job.machine
    if machine is not None and ctx.version.machines.get(phase) != machine:
        ctx.update_version({f"machines.{phase}": machine})


def _record(result: Done | Skipped, started: Timestamp, finished: Timestamp) -> Record:
    if isinstance(result, Skipped):
        return StepRecord("skipped", started_at=started, finished_at=finished).as_record()
    output = result.output
    return StepRecord(
        "done",
        gcs_path=output.path if output else None,
        generation=output.generation if output else None,
        sha256=result.sha256,
        bytes=output.size if output else None,
        started_at=started,
        finished_at=finished,
    ).as_record()


def _invalid_code(error: DocumentError) -> str:
    """An unknown job type is this image being older than the job (retryable); any other invalid job is invalid for good."""
    return Errors.PIPELINE_OUTDATED if isinstance(error, OutdatedJobError) else Errors.INVALID_REQUEST


def _job_error(error: StepFailedError) -> Record:
    message = scrub(str(error))[:ERROR_MESSAGE_MAX]
    return {"code": error.code, "message": message, **({"params": error.params} if error.params else {})}


def _version_error(error: StepFailedError) -> Record:
    return {"code": error.code, **({"params": error.params} if error.params else {})}


def _delete_work(ctx: JobContext) -> None:
    objects = ctx.services.objects
    for info in objects.list(paths.work_prefix(ctx.city, ctx.job.id)):
        objects.delete(info.path)
