"""The worker's half of the local matcher (docs/research/M10-local-ai.md), behind `calibrate/ports.py`.

A frame the votes do not find asks here. This side has no PyTorch and no Docker socket: it says on `/state` that the AI is wanted (the
starter file brings the sidecar up), fetches the files, warps the film through each orientation's start at 15 m and puts one request at
a time in the box. **Every failure ends at the admin's points with a line in the log, never a failed job and never a softened gate:**
each returns no proposal, whatever raised it; only the job's own stop (`RunStoppedError`) goes through. A request lost after others
proposed costs that request, not their proposals: the proof still gets them. The wait looks at the injected clock only here, an
adapter's timeout; the job's `tick` still stops it, and a cancelled wait leaves a cancel file for the sidecar. When a run ends `/state`
stops saying `wanted`, and the starter takes the sidecar down: the next frame probes the graphics card again and gets a sidecar of the
image it names. A request's id names its run, so an old child's late answer is never read as a new request's.
"""

import platform
import time
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Final, Protocol

import cv2
import numpy

from hcm_pipeline.calibrate.dense import film_box
from hcm_pipeline.calibrate.poly import MatrixMap
from hcm_pipeline.calibrate.ports import Proposal, ProposalRequest, Proposer
from hcm_pipeline.geo import FloatArray, Grid, MercatorBox, ground_scale
from hcm_pipeline.images import UInt8Array
from hcm_pipeline.jobs import RunStoppedError
from hcm_pipeline.log import get_logger
from hcm_pipeline.matcher.box import (
    ANSWER_SUFFIX,
    CANCEL_SUFFIX,
    GARBAGE,
    REQUEST_SUFFIX,
    RERUN_SUFFIX,
    STARTER,
    Answer,
    BadAnswerError,
    Found,
    MatcherBudget,
    Request,
    SidecarStatus,
    clear_request,
    read_answer,
    read_status,
    starter_word,
    write_request,
)
from hcm_pipeline.worker.ai_files import AiFilesError
from hcm_pipeline.worker.ai_state import WHY_NO_ANSWER, AiState, never_here, why_of_fault

LOG = get_logger("worker.local_matcher")
NAME: Final = "aliked-lightglue"
MATCHER_PIXEL_M: Final = 15.0
# The reference is averaged down only from this factor on, as gate R1's preparation did.
AVERAGE_FROM_FACTOR: Final = 1.5
FIRST_USE_WAIT_S: Final = 30 * 60.0
# Once a sidecar gave no answer: enough for a fresh start of an image already here; a hung driver must not cost each later frame 30 minutes.
RETRY_WAIT_S: Final = 5 * 60.0
GPU_TIMEOUT_S: Final = 10 * 60.0
CPU_TIMEOUT_S: Final = 45 * 60.0
# The sidecar beats every second, also while a child works: this long without a beat, it is gone.
BEAT_LOST_S: Final = 120.0
POLL_S: Final = 1.0
CPU_ORIENTATIONS: Final = 2
WHY_GARBAGE: Final = GARBAGE


class StandAsideError(Exception):
    """The matcher cannot help this run; its `why` is what the panel says."""

    def __init__(self, why: str, detail: str) -> None:
        super().__init__(detail)
        self.why = why


@dataclass(frozen=True)
class Warped:
    """A start's film on the search grid, the reference on its own, and those grids."""

    film: UInt8Array
    reference: UInt8Array
    film_grid: FloatArray
    reference_grid: FloatArray


def _grid_matrix(left: float, top: float) -> FloatArray:
    return numpy.array([[MATCHER_PIXEL_M, 0.0, left], [0.0, -MATCHER_PIXEL_M, top], [0.0, 0.0, 1.0]], numpy.float64)


def reference_at_15(reference: UInt8Array, grid: Grid) -> UInt8Array:
    """The reference on the matcher's grid."""
    size = (int(grid.width * grid.resolution / MATCHER_PIXEL_M), int(grid.height * grid.resolution / MATCHER_PIXEL_M))
    factor = MATCHER_PIXEL_M / grid.resolution
    base, shrink = reference, 1
    if factor > AVERAGE_FROM_FACTOR:
        shrink = round(factor)
        base = numpy.asarray(cv2.resize(reference, None, fx=1 / shrink, fy=1 / shrink, interpolation=cv2.INTER_AREA), numpy.uint8)
    # Target cells to the base's cells.
    scale = factor / shrink
    to_base = numpy.array([[scale, 0.0, 0.0], [0.0, scale, 0.0], [0.0, 0.0, 1.0]], numpy.float64)
    flags = cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP
    return numpy.asarray(cv2.warpPerspective(base, to_base, size, flags=flags, borderValue=0), numpy.uint8)


def warp_start(request: ProposalRequest, start: FloatArray, reference: UInt8Array) -> Warped:
    """The film under `start` on a grid of the window plus its margin, at 15 m: read averaged, warped once; empty where it misses."""
    box = request.grid.box()
    margin = int(request.margin_m / MATCHER_PIXEL_M)
    height, width = reference.shape
    film_grid = _grid_matrix(box.left - margin * MATCHER_PIXEL_M, box.top + margin * MATCHER_PIXEL_M)
    reference_grid = _grid_matrix(box.left, box.top)
    size = (width + 2 * margin, height + 2 * margin)
    return Warped(_film_on(request, start, film_grid, size), reference, film_grid, reference_grid)


def _film_on(request: ProposalRequest, start: FloatArray, film_grid: FloatArray, size: tuple[int, int]) -> UInt8Array:
    left, top = film_grid[0, 2], film_grid[1, 2]
    wide = MercatorBox(left, top - size[1] * MATCHER_PIXEL_M, left + size[0] * MATCHER_PIXEL_M, top)
    mapping = MatrixMap(start)
    box = film_box(mapping, wide, request.limits)
    if box is None or request.read is None:
        return numpy.zeros((size[1], size[0]), numpy.uint8)
    centre = numpy.array([[(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]], numpy.float64)
    pixel = float(numpy.hypot(*(mapping.to_places(centre + numpy.array([1.0, 0.0])) - mapping.to_places(centre))[0]))
    factor = max(1, round(MATCHER_PIXEL_M / max(pixel, 1e-3)))
    film = request.read.read(
        (box[0], box[1], box[0] + (box[2] - box[0]) // factor * factor, box[1] + (box[3] - box[1]) // factor * factor), factor
    )
    cells = numpy.array([[factor, 0.0, box[0] + factor / 2], [0.0, factor, box[1] + factor / 2], [0.0, 0.0, 1.0]], numpy.float64)
    inverse = numpy.linalg.inv(start @ cells) @ film_grid
    flags = cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP
    # A real film pixel of 0 would read as no data.
    return numpy.asarray(cv2.warpPerspective(numpy.maximum(film, 1), inverse, size, flags=flags, borderValue=0), numpy.uint8)


@dataclass
class Patience:
    """How long a run waits for the sidecar, remembered across this worker's runs: each run has its own `LocalMatcher`."""

    gave_up: bool = False

    def wait_s(self) -> float:
        return RETRY_WAIT_S if self.gave_up else FIRST_USE_WAIT_S


class Files(Protocol):
    """The matcher's files (`ai_files.AiFiles`)."""

    image: str
    tick: Callable[[], None]

    def ready(self) -> bool: ...

    def ensure(self) -> None: ...


@dataclass(frozen=True)
class Ports:
    """What the adapter touches outside: the volumes, the starter's poll and panel, the clock."""

    box: Path
    files: Files
    report: Callable[[AiState], None]
    environment: Mapping[str, str]
    clock: Callable[[], float] = time.monotonic
    sleep: Callable[[float], None] = time.sleep
    machine: str | None = None
    patience: Patience = field(default_factory=Patience)
    run_id: Callable[[], str] = lambda: uuid.uuid4().hex[:8]
    # The governor's word on each request (docs/research/M26-governor.md §4): threads, keypoints, the card's share or its yield.
    budget: Callable[[], MatcherBudget] = MatcherBudget


class LocalMatcher:
    """The sidecar through the box. One per run: `Services.proposal_matcher` of the worker only."""

    name = NAME

    def __init__(self, ports: Ports) -> None:
        self._ports = ports
        self._requests = 0
        self._run = ports.run_id()

    def propose(self, request: ProposalRequest) -> Sequence[Proposal]:
        """At most what the sidecar validly proposed, best first; none whenever it cannot help."""
        started = self._ports.clock()
        try:
            status = self._ready(request)
            answers = self._asked(request, status)
        except RunStoppedError:
            self._ports.report(AiState())
            raise
        except Exception as fault:  # the module's promise: no fault of the AI's fails the job
            return self._stood_aside(request, _stand_aside_of(fault))
        self._ports.report(replace(self._running(status), wanted=False))
        return self._proposals(request, answers, self._ports.clock() - started)

    def _stood_aside(self, request: ProposalRequest, stopped: StandAsideError) -> Sequence[Proposal]:
        request.say(f"local AI unavailable ({stopped.why}): {stopped}; the frame waits for the admin's points")
        self._ports.report(AiState("unavailable", why=stopped.why))
        return ()

    def _ready(self, request: ProposalRequest) -> SidecarStatus:
        """The files fetched and the sidecar alive, or `StandAsideError`."""
        why = never_here(self._ports.environment, self._ports.machine or platform.machine())
        if why is not None:
            raise StandAsideError(why, "the worker cannot start the sidecar here")
        self._clean()
        ports = self._ports
        if not ports.files.ready():
            request.say("local AI: first use: about 10 GB to fetch, once, from the upstreams; it runs on this computer, never in a cloud")
        ports.report(AiState("preparing", wanted=True, image=ports.files.image))
        ports.files.tick = request.tick
        ports.files.ensure()
        ports.report(AiState("preparing", wanted=True, image=ports.files.image, files=True))
        status = self._sidecar(request)
        ports.report(self._running(status))
        return status

    def _running(self, status: SidecarStatus) -> AiState:
        image = self._ports.files.image
        return AiState("ready", status.device, status.device_name, None, True, image, True)

    def _clean(self) -> None:
        """What an earlier run left in the box (a crash, a cancel) gone; the sidecar's own status stays."""
        box = self._ports.box
        (box / STARTER).unlink(missing_ok=True)
        for pattern in ("*.request.npz", f"*{ANSWER_SUFFIX}", f"*{CANCEL_SUFFIX}", f"*{RERUN_SUFFIX}", "*.part*"):
            for each in box.glob(pattern):
                each.unlink(missing_ok=True)

    def _sidecar(self, request: ProposalRequest) -> SidecarStatus:
        """The sidecar's status once it beats (a stale file from an earlier life does not), within `FIRST_USE_WAIT_S`."""
        ports = self._ports
        first = read_status(ports.box)
        wait = ports.patience.wait_s()
        deadline = ports.clock() + wait
        while ports.clock() < deadline:
            request.tick()
            status = self._alive(first)
            if status is not None:
                ports.patience.gave_up = False
                return status
            ports.sleep(POLL_S)
        raise self._no_answer(f"the sidecar did not come up within {wait / 60:.0f} minutes")

    def _no_answer(self, detail: str) -> StandAsideError:
        """A sidecar that does not answer: the next run waits less, and with `wanted` gone the starter removes this one."""
        self._ports.patience.gave_up = True
        return StandAsideError(WHY_NO_ANSWER, detail)

    def _alive(self, first: SidecarStatus | None) -> SidecarStatus | None:
        """The status when it is news; `StandAsideError` when the starter file says it cannot bring the sidecar up."""
        word = starter_word(self._ports.box)
        if word is not None:
            raise StandAsideError(word, "the starter file says so")
        status = read_status(self._ports.box)
        return status if status is not None and _news(status, first) else None

    def _asked(self, request: ProposalRequest, status: SidecarStatus) -> list[tuple[FloatArray, Answer]]:
        """Each orientation's starts in turn, best votes first; the processor looks at the first two orientations."""
        starts = request.starts[: CPU_ORIENTATIONS * request.starts_each if status.device == "cpu" else None]
        reference = reference_at_15(request.reference, request.grid)
        answers: list[tuple[FloatArray, Answer]] = []
        lost: StandAsideError | None = None
        for start in starts:
            answer = self._answer_or_loss(request, start, reference, status)
            if isinstance(answer, Answer):
                answers.append((start, answer))
                continue
            lost = answer
            if lost.why != WHY_GARBAGE:
                break
        return _kept(answers, lost)

    def _answer_or_loss(
        self, request: ProposalRequest, start: FloatArray, reference: UInt8Array, status: SidecarStatus
    ) -> Answer | StandAsideError:
        """One request's fault costs that request (M10 *As built*); `_kept` decides what is left."""
        try:
            return self._asked_one(request, start, reference, status)
        except RunStoppedError:
            raise
        except Exception as fault:  # the module's promise, as in `propose`
            lost = _stand_aside_of(fault)
            request.say(f"local AI: a request was lost ({lost.why}): {lost}")
            return lost

    def _asked_one(self, request: ProposalRequest, start: FloatArray, reference: UInt8Array, status: SidecarStatus) -> Answer:
        self._requests += 1
        request_id = f"r{self._run}-{self._requests:03d}"
        warped = warp_start(request, start, reference)
        ground = ground_scale(request.grid.box().bounds().middle_lat)
        box = self._ports.box
        try:
            budget = self._ports.budget()
            write_request(box, request_id, Request(warped.film, warped.reference, warped.film_grid, warped.reference_grid, ground, budget))
            return self._answer(request, request_id, status)
        except BaseException:
            _tell_the_sidecar_to_stop(box, request_id)
            raise
        finally:
            _forget(box, request_id)

    def _answer(self, request: ProposalRequest, request_id: str, status: SidecarStatus) -> Answer:
        ports = self._ports
        answer_path = ports.box / f"{request_id}{ANSWER_SUFFIX}"
        timeout = _timeout_of(status.device)
        beat, beat_at = status.beat, ports.clock()
        deadline = beat_at + timeout
        while not answer_path.exists():
            request.tick()
            deadline = self._deadline(request_id, deadline, beat_at)
            beat, beat_at = self._beat(beat, beat_at)
            if ports.clock() > deadline or ports.clock() - beat_at > BEAT_LOST_S:
                raise self._no_answer(f"no answer to {request_id}")
            ports.sleep(POLL_S)
        try:
            return read_answer(answer_path)
        except BadAnswerError as error:
            raise StandAsideError(error.word, str(error)) from error

    def _deadline(self, request_id: str, deadline: float, since: float) -> float:
        """A rerun on the processor has the processor's time."""
        return max(deadline, since + CPU_TIMEOUT_S) if (self._ports.box / f"{request_id}{RERUN_SUFFIX}").exists() else deadline

    def _beat(self, beat: int, beat_at: float) -> tuple[int, float]:
        status = read_status(self._ports.box)
        return (status.beat, self._ports.clock()) if status is not None and status.beat != beat else (beat, beat_at)

    def _proposals(self, request: ProposalRequest, answers: Sequence[tuple[FloatArray, Answer]], seconds: float) -> Sequence[Proposal]:
        ranked = _ranked(answers)
        devices = sorted({_device_words(answer) for _, answer in answers}) or ["no orientation"]
        request.say(f"local AI ({NAME}, {' and '.join(devices)}): {len(ranked)} proposals in {seconds:.0f} s")
        return [_proposal(found, start, answer, seconds) for found, start, answer in ranked]


def _stand_aside_of(fault: Exception) -> StandAsideError:
    """Any fault as what the panel says of it: a port's own word, else the disk's or that no answer came."""
    if isinstance(fault, StandAsideError):
        return fault
    if isinstance(fault, AiFilesError):
        return StandAsideError(fault.why, str(fault))
    LOG.warning("local AI: %s: %s", type(fault).__name__, fault)
    return StandAsideError(why_of_fault(fault), f"{type(fault).__name__}: {fault}")


def _kept(answers: list[tuple[FloatArray, Answer]], lost: StandAsideError | None) -> list[tuple[FloatArray, Answer]]:
    """What was answered, when a lost request left something to prove; else the loss is the run's reason."""
    if lost is not None and not any(answer.found for _, answer in answers):
        raise lost
    return answers


def _tell_the_sidecar_to_stop(box: Path, request_id: str) -> None:
    """The request gone and a cancel left; a disk too full for the cancel must not turn the job's stop into another error."""
    try:
        clear_request(box, request_id)
        (box / f"{request_id}{CANCEL_SUFFIX}").touch()
    except OSError as error:
        LOG.warning("local AI: no cancel left for %s: %s", request_id, error)


def _forget(box: Path, request_id: str) -> None:
    try:
        for suffix in (ANSWER_SUFFIX, REQUEST_SUFFIX, RERUN_SUFFIX):
            (box / f"{request_id}{suffix}").unlink(missing_ok=True)
    except OSError as error:
        LOG.warning("local AI: %s stays in the box until the next run: %s", request_id, error)


def _news(status: SidecarStatus, first: SidecarStatus | None) -> bool:
    return first is None or status.beat != first.beat or status.device != first.device


def _ranked(answers: Sequence[tuple[FloatArray, Answer]]) -> list[tuple[Found, FloatArray, Answer]]:
    """Every proposal of every orientation, those most pairs agree on first (gate R1's order)."""
    every = [(found, start, answer) for start, answer in answers for found in answer.found]
    return sorted(every, key=lambda each: (-each[0].pairs, -each[0].points))


def _proposal(found: Found, start: FloatArray, answer: Answer, seconds: float) -> Proposal:
    proposer = Proposer(NAME, answer.device, round(seconds, 1), found.points, answer.device_name, answer.fallback)
    return Proposal(found.matrix @ start, found.points, proposer)


def _timeout_of(device: str) -> float:
    return GPU_TIMEOUT_S if device == "gpu" else CPU_TIMEOUT_S


def _device_words(answer: Answer) -> str:
    return f"{answer.device}, {answer.device_name}" if answer.device_name else answer.device
