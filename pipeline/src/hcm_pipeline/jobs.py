"""What a pipeline step runs with and returns (docs/research/M3-interfaces.md §5.2).

A step gets a `JobContext` (the configuration, the services, the job and its layer version, a scratch folder,
the run's flags and the job log) and returns `Done` (with its recorded output), `Skipped` (the job does not need
it) or `Waiting` (the job waits on USGS or on the admin's points; the run then exits 0), or raises
`StepFailedError` with an `apiError.*` code. Long work calls `ctx.checkpoint()` (and passes `ctx.gdal_progress`
to GDAL) so a SIGTERM, a cancellation or a lost lease stops it at the next checkpoint. A transfer reports its bytes
with `ctx.report_bytes` (finding 55 of 2026-11-01: a long download looked stuck).
"""

import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Final, Protocol

import httpx

from hcm_pipeline import paths
from hcm_pipeline.calibrate.ports import NullProposalMatcher, ProposalMatcher
from hcm_pipeline.config import Config
from hcm_pipeline.contract import Errors
from hcm_pipeline.documents import Version
from hcm_pipeline.governor.actuate import GATE
from hcm_pipeline.joblog import JobLog
from hcm_pipeline.model import Job, Record, Timestamp, stamp
from hcm_pipeline.objects import ObjectInfo, ObjectStore
from hcm_pipeline.osm import OverpassClient
from hcm_pipeline.secrets import SecretSource
from hcm_pipeline.stac import StacClient
from hcm_pipeline.store import DocumentStore
from hcm_pipeline.urlguard import Resolver
from hcm_pipeline.usgs import M2MSession

GDAL_CONTINUE: Final = 1
GDAL_ABORT: Final = 0
# A transfer's bytes and the progress are written at most this often (the heartbeat writes the progress every minute).
BYTES_REPORT_SECONDS: Final = 5.0
ParamValue = str | int


class StepFailedError(Exception):
    """A failure the step understands: the job fails with `code` (an `apiError.*` code) and its `params`."""

    def __init__(self, code: str, message: str, params: Mapping[str, ParamValue] | None = None) -> None:
        super().__init__(message)
        self.code = code
        # Error parameters are texts (`apiErrorParamsSchema`): a number made the job and its version unreadable in the
        # admin (finding 62 of 2026-11-02; `{bytes}`, `{count}` and `{min}` were numbers).
        self.params = {key: str(value) for key, value in (params or {}).items()}


class StepTimeLimitError(StepFailedError):
    """A step ran past its wall-time limit (`contract.STEP_LIMIT_SECONDS`): raised at its next checkpoint, so the job fails with one
    clear line instead of holding the computer's queue (live 2026-11-12: an hour in `locate` on a KH-5 frame)."""

    def __init__(self, step: str, limit_seconds: float) -> None:
        minutes = max(1, round(limit_seconds / 60))
        super().__init__(
            Errors.STEP_TIME_LIMIT, f"the step {step} ran longer than {minutes} min and was stopped", {"step": step, "minutes": minutes}
        )
        self.step = step


@dataclass(frozen=True)
class StepDeadline:
    """When the running step must stop: `limit_seconds` after it started, read on `clock` (seconds)."""

    step: str
    ends_at: float
    limit_seconds: float
    clock: Callable[[], float]

    def passed(self) -> bool:
        return self.clock() > self.ends_at


class DeclinedError(StepFailedError):
    """M16 (docs/research/M16-recalibrate.md §3): the step chose to render nothing (a refine found no better fit, or its proof did not
    hold). The job and its version end `cancelled` with this code, so the layer is released and the current version stays as it was."""


class ArchiveElsewhereError(Exception):
    """M20 (2026-11-13): the job's local archive has no record on this computer; the worker hands the job back (`worker.end`
    `returned`), so the computer that holds the files runs it, and no attempt is spent."""


class FilmElsewhereError(ArchiveElsewhereError):
    """2026-11-13: the frame's film (the segments `stitch` made, under `work/`) is on the computer that stitched it, not here; the worker
    hands the job back, so that computer runs it, and no attempt is spent (the server fails it `filmMissing` when no computer has it)."""


class RunStoppedError(Exception):
    """The run must stop at this checkpoint."""


class InterruptedRunError(RunStoppedError):
    """SIGTERM (Cloud Run's cancel, the task timeout): keep the work, or cancel when the admin asked to."""


class CancelledRunError(RunStoppedError):
    """The admin set `cancelRequested`."""


class PausedRunError(RunStoppedError):
    """The owner paused the job (`paused` on the job, the owner's request of 2026-11-13): the run stops before its next step and
    the job goes back to `queued`, held until Resume."""


class ReleasedRunError(RunStoppedError):
    """This computer was paused (its own page, or `releaseRequested` set by the admin's Pause this computer): the run stops at its
    next checkpoint and the worker hands the job back (`worker.end` `released`), its attempt given back."""


class LeaseLostError(RunStoppedError):
    """Another execution holds the lease now: stop without writing anything."""


@dataclass(frozen=True)
class Done:
    """The step's work is complete; `output` is the object it recorded (skipped next time while it exists)."""

    output: ObjectInfo | None = None
    sha256: str | None = None


@dataclass(frozen=True)
class Skipped:
    """The job does not need this step (an upload with its own georeference skips `reference` and `georef`)."""

    reason: str


@dataclass(frozen=True)
class Waiting:
    """The job waits: on USGS (`waiting_usgs`, until `retry_at`) or on the admin's points (`awaiting_gcps`)."""

    status: str
    reason: str
    message: str
    retry_at: Timestamp | None = None


StepResult = Done | Skipped | Waiting


class RunFlags:
    """Thread-safe flags the SIGTERM handler and the heartbeat raise, and the progress the heartbeat writes.

    The handler raises its flag with `interrupt`, which takes no lock: a Python signal handler runs in the main thread
    between two bytecodes, also while that thread holds `_lock` (`progress_within` from GDAL's callback), and taking
    it there would wait for itself forever (docs/LESSONS.md 342)."""

    def __init__(
        self,
        asked_to_stop: Callable[[], bool] = lambda: False,
        hold: Callable[[Callable[[], bool]], float] = GATE.hold,
        asked_to_release: Callable[[], bool] = lambda: False,
    ) -> None:
        self._lock = threading.Lock()
        # The governor's gate (docs/research/M26-governor.md §4): while this computer has no room, a checkpoint waits here.
        self._hold = hold
        self._stop: type[RunStoppedError] | None = None
        self._interrupted = False
        # The local worker's stop (M7): a signal it took before the run's own handler was in place counts too.
        self._asked_to_stop = asked_to_stop
        # The computer's pause (its own page, or the admin's): the run hands its job back at the next checkpoint.
        self._asked_to_release = asked_to_release
        self.cancel_requested = False
        self.step: str | None = None
        self.base_progress = 0.0
        self.step_weight = 0.0
        self.step_fraction = 0.0
        self.deadline: StepDeadline | None = None

    def raise_flag(self, stop: type[RunStoppedError]) -> None:
        with self._lock:
            if self._stop is not LeaseLostError:
                self._stop = stop
        if stop is CancelledRunError:
            self.cancel_requested = True

    def interrupt(self) -> None:
        """SIGTERM or Ctrl-C: the run stops at its next checkpoint (`InterruptedRunError`, unless a cancel or a lost lease
        came first). One assignment and no lock, so a signal handler may call it at any moment."""
        self._interrupted = True

    @property
    def stopping(self) -> type[RunStoppedError] | None:
        with self._lock:
            stop = self._stop
        if stop is not None:
            return stop
        if self._interrupted or self._asked_to_stop():
            return InterruptedRunError
        return ReleasedRunError if self._asked_to_release() else None

    def _held(self) -> None:
        """Waits at the governor's gate while it is closed; the time waited is added to the step's time limit."""
        waited = self._hold(lambda: self.stopping is not None)
        deadline = self.deadline
        if waited > 0 and deadline is not None:
            self.deadline = replace(deadline, ends_at=deadline.ends_at + waited)

    def check(self) -> None:
        self._held()
        stop = self.stopping
        if stop is not None:
            raise stop(f"the run stops: {stop.__name__}")
        deadline = self.deadline
        if deadline is not None and deadline.passed():
            raise StepTimeLimitError(deadline.step, deadline.limit_seconds)

    def gdal_progress(self, complete: float, _message: str, _data: object) -> int:
        """GDAL's progress callback: 0 makes GDAL stop (and raise) when the run must stop."""
        self.progress_within(complete)
        self._held()
        return GDAL_ABORT if self.stopping is not None else GDAL_CONTINUE

    def progress_within(self, fraction: float) -> None:
        """How far the running step is (0 to 1): the heartbeat adds that share of its weight to the job's progress."""
        with self._lock:
            self.step_fraction = max(0.0, min(1.0, fraction))

    def enter(self, step: str, base: float, weight: float, deadline: StepDeadline | None = None) -> None:
        with self._lock:
            self.step, self.base_progress, self.step_weight, self.step_fraction = step, base, weight, 0.0
            self.deadline = deadline

    @property
    def progress(self) -> float:
        with self._lock:
            return round(min(1.0, self.base_progress + self.step_weight * self.step_fraction), 4)


class M2MConnection(Protocol):
    """What `with ctx.services.m2m() as m2m:` opens: the `M2MClient` on Cloud Run, the worker's proxy (M7) on a computer."""

    def __enter__(self) -> M2MSession: ...

    def __exit__(self, *exc_info: object) -> None: ...


class M2MFactory(Protocol):
    def __call__(self) -> M2MConnection: ...


@dataclass
class Services:
    """The adapters a run uses (real ones from `services.build`, fakes in the tests)."""

    store: DocumentStore
    objects: ObjectStore
    secrets: SecretSource
    m2m: M2MFactory
    downloads: httpx.Client
    stac: StacClient
    overpass: OverpassClient
    clock: Callable[[], float]
    sleep: Callable[[float], None]
    resolver: Resolver
    # A local matcher plugs in on the worker alone (docs/research/M9-calibration.md §3).
    proposal_matcher: ProposalMatcher = field(default_factory=NullProposalMatcher)
    # M20 (docs/research/M20-import-local.md §4): the work folder that holds the local archives, on the worker alone.
    archive_root: Path | None = None


@dataclass
class JobContext:
    """Everything a step runs with."""

    config: Config
    services: Services
    job: Job
    version: Version
    workdir: Path
    flags: RunFlags
    log: JobLog
    step: str = ""
    staged: dict[str, Path] = field(default_factory=dict)
    bytes_reported_at: float = float("-inf")

    def now(self) -> Timestamp:
        return Timestamp.at(self.services.clock())

    def checkpoint(self) -> None:
        self.flags.check()

    @property
    def city(self) -> str:
        return self.config.city_id

    def job_path(self) -> str:
        return f"cities/{self.city}/jobs/{self.job.id}"

    def version_path(self, version_id: str | None = None) -> str:
        return f"cities/{self.city}/layerVersions/{version_id or self.version.id}"

    def version_file(self, name: str) -> str:
        return paths.version(self.city, self.version.layer_id, self.version.id, name)

    def work_file(self, name: str) -> str:
        return paths.work(self.city, self.job.id, name)

    def local(self, name: str) -> Path:
        path = self.workdir / name
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def stage(self, object_path: str, name: str | None = None) -> Path:
        """The object downloaded into the scratch folder (once per run)."""
        if object_path not in self.staged:
            local = self.local(name or object_path.replace("/", "_"))
            self.services.objects.download_file(object_path, local)
            self.staged[object_path] = local
        return self.staged[object_path]

    def unstage(self, object_path: str) -> None:
        """A staged object's local copy removed (the scratch folder is memory on Cloud Run: finding 57)."""
        local = self.staged.pop(object_path, None)
        if local is not None:
            local.unlink(missing_ok=True)

    def publish(self, local: Path, object_path: str, content_type: str) -> ObjectInfo:
        """A local file uploaded create-only (an identical object already there is kept)."""
        self.checkpoint()
        return self.services.objects.upload_file(local, object_path, content_type)

    def update_version(self, fields: Mapping[str, object]) -> None:
        self.services.store.update(self.version_path(), {**fields, **stamp(self.now())})

    def report_bytes(self, received: int, total: int) -> None:
        """A transfer's bytes so far (`total` 0: unknown): the step's share of the progress follows at once, and
        `steps.<step>.bytes` (with `totalBytes` when known) and the progress are written at most every
        `BYTES_REPORT_SECONDS`, which the version's step line shows (`1.2 of 3.4 GB`)."""
        if total > 0:
            self.flags.progress_within(received / total)
        now = self.services.clock()
        if now - self.bytes_reported_at < BYTES_REPORT_SECONDS:
            return
        self.bytes_reported_at = now
        sizes = {"bytes": received, "totalBytes": total} if total > 0 else {"bytes": received}
        self.update_job({**{f"steps.{self.step}.{key}": value for key, value in sizes.items()}, "progress": self.flags.progress})

    def update_job(self, fields: Mapping[str, object]) -> None:
        self.services.store.update(self.job_path(), {**fields, **stamp(self.now())})

    def read(self, path: str) -> Record | None:
        return self.services.store.get(path)
