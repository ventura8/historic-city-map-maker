"""The worker's loop, its sign-in and its command (M7, docs/research/M7-local-worker.md §1.2, §2.3)."""

import io
import json
import signal
import threading
from collections.abc import Callable

import httpx
import pytest
from hcm_pipeline.contract import Errors
from hcm_pipeline.jobs import LeaseLostError
from hcm_pipeline.model import RUN_JOB_TYPES
from hcm_pipeline.runner import RunOutcome
from hcm_pipeline.worker.api import WorkerApi
from hcm_pipeline.worker.loop import Pass, WorkerLoop
from hcm_pipeline.worker.pace import AWAKE_SECONDS, MAX_PASSES, Pace
from hcm_pipeline.worker.session import Session, SessionEndedError, Tokens
from hcm_pipeline.worker.state import WorkerState

from tests.fakes.worker_api import PROJECT, fake_id_token
from tests.fakes.world import FakeClock

IDS = {"cityId": "bucharest", "workerId": "w-0123456789abcdef"}
REFRESH = "AMf-vB" + "r" * 40
COPY_DUTY = {"jobId": "ar-series", "archiveId": "ar-0123456789abcdef", "seriesId": "s-0123456789ab"}


class Server:
    """The callables as the loop meets them: `claims` answers in turn (a job id, None, or an exception's code)."""

    def __init__(self, *claims: str | None) -> None:
        self.claims = list(claims)
        self.calls: list[tuple[str, dict[str, object]]] = []
        self.on_claim: Callable[[], None] = lambda: None
        self.end_answer = httpx.Response(200, json={"result": {"status": "awaiting_approval"}})

    def __call__(self, request: httpx.Request) -> httpx.Response:
        name = request.url.path.rsplit("/", 1)[-1]
        self.calls.append((name, json.loads(request.content)["data"]))
        return self._claim() if name == "worker-claim" else self.end_answer

    def _claim(self) -> httpx.Response:
        self.on_claim()
        claim = self.claims.pop(0) if self.claims else None
        if claim == "outdated":
            return httpx.Response(200, json={"result": {"job": None, "outdated": True}})
        if claim == "copy":
            return httpx.Response(200, json={"result": {"job": None, "copy": COPY_DUTY}})
        return self._job(claim)

    @staticmethod
    def _job(claim: str | None) -> httpx.Response:
        if claim is not None and claim.startswith("apiError."):
            return httpx.Response(400, json={"error": {"message": "no", "status": "FAILED_PRECONDITION", "details": {"code": claim}}})
        return httpx.Response(200, json={"result": {"job": None if claim is None else {"jobId": claim}}})

    def ends(self) -> list[dict[str, object]]:
        return [data for name, data in self.calls if name == "worker-end"]


class Runtime:
    """A job run that ends as the test says: an outcome, or an exception."""

    def __init__(self, ending: RunOutcome | Exception = RunOutcome.DONE, before: Callable[[], None] = lambda: None) -> None:
        self.ending = ending
        self.before = before
        self.jobs: list[str] = []
        self.asked_to_stop: Callable[[], bool] = lambda: False
        self.asked_to_release: Callable[[], bool] = lambda: False

    def run(self, job_id: str, asked_to_stop: Callable[[], bool], asked_to_release: Callable[[], bool]) -> RunOutcome:
        self.jobs.append(job_id)
        self.asked_to_stop = asked_to_stop
        self.asked_to_release = asked_to_release
        self.before()
        if isinstance(self.ending, Exception):
            raise self.ending
        return self.ending


def loop_with(
    server: Server, runtime: Runtime, signed_in: bool = True, kind: type[WorkerLoop] = WorkerLoop
) -> tuple[WorkerLoop, WorkerState, Session]:
    clock = FakeClock()
    client = httpx.Client(transport=httpx.MockTransport(server))
    session = Session(client, lambda: "unused", clock)
    if signed_in:
        session.begin(Tokens.of(fake_id_token(clock() + 3600), REFRESH))
    state = WorkerState("bucharest", PROJECT, session)
    state.timing.poll_seconds = 0
    worker_api = WorkerApi(client, lambda name: f"http://127.0.0.1:1/{name}", session.bearer, lambda _seconds: None)
    loop = kind(session, worker_api, state, runtime, IDS)
    loop.no_session_seconds = 0
    return loop, state, session


def test_happy_path_a_claimed_job_runs_and_its_end_is_reported() -> None:
    server, runtime = Server("job-1"), Runtime()
    loop, state, _session = loop_with(server, runtime)

    assert loop.run_once() is Pass.RAN

    assert runtime.jobs == ["job-1"]
    assert server.ends() == [{**IDS, "jobId": "job-1", "outcome": "done"}]
    assert state.snapshot()["state"] == "idle"


@pytest.mark.parametrize("claim", [None, "../job", "apiError.guardPaused"])
def test_bad_path_no_job_a_bad_id_or_a_refused_claim_leaves_the_worker_idle(claim: str | None) -> None:
    server, runtime = Server(claim), Runtime()
    loop, state, _session = loop_with(server, runtime)

    assert loop.run_once() is Pass.IDLE

    assert runtime.jobs == []
    assert state.snapshot()["lastError"] == (claim if claim == "apiError.guardPaused" else None)


def test_bad_path_an_outdated_image_under_the_supervisor_ends_the_loop() -> None:
    # Finding 72 (the starter's supervisor): the installed pipeline is newer, so the worker stops and the supervisor pulls it.
    server, runtime = Server("outdated"), Runtime()
    loop, state, _session = loop_with(server, runtime)
    loop.supervised = True

    loop.run()

    assert (loop.outdated_exit, state.snapshot()["outdated"], runtime.jobs) == (True, True, [])


def test_happy_path_a_claim_names_only_the_job_types_this_image_runs() -> None:
    server = Server(None)
    loop, _state, _session = loop_with(server, Runtime())

    assert loop.run_once() is Pass.IDLE
    (name, data), *_rest = server.calls
    assert name == "worker-claim"
    assert data["types"] == list(RUN_JOB_TYPES)


def test_happy_path_an_outdated_image_without_the_supervisor_stays_and_takes_no_job() -> None:
    server, runtime = Server("outdated"), Runtime()
    loop, state, _session = loop_with(server, runtime)

    assert loop.run_once() is Pass.IDLE
    assert (loop.outdated_exit, state.snapshot()["outdated"], loop.stopping.is_set()) == (False, True, False)


def test_bad_path_without_a_session_nothing_is_claimed() -> None:
    server = Server("job-1")
    loop, _state, _session = loop_with(server, Runtime(), signed_in=False)

    assert loop.run_once() is Pass.NO_SESSION
    assert server.calls == []


def test_bad_path_a_crash_outside_a_step_is_reported_failed_and_redacted() -> None:
    server = Server("job-1")
    loop, state, _session = loop_with(server, Runtime(RuntimeError("Authorization: Bearer leaked-token-value")))

    assert loop.run_once() is Pass.RAN

    [ended] = server.ends()
    assert ended["outcome"] == "failed"
    error = ended["error"]
    assert isinstance(error, dict)
    assert error["code"] == Errors.PROCESSING_FAILED
    assert "leaked-token-value" not in str(error["message"])
    assert state.snapshot()["lastError"] == Errors.PROCESSING_FAILED


def test_bad_path_a_lost_job_ends_done_and_a_refused_end_is_only_logged(log_stream: io.StringIO) -> None:
    server = Server("job-1")
    server.end_answer = httpx.Response(400, json={"error": {"status": "FAILED_PRECONDITION", "details": {"code": "apiError.notFound"}}})
    loop, _state, _session = loop_with(server, Runtime(LeaseLostError("another worker")))

    assert loop.run_once() is Pass.RAN

    assert server.ends()[0]["outcome"] == "done"
    assert "worker.end failed" in log_stream.getvalue()


def test_bad_path_a_session_that_ended_during_the_run_sends_no_end() -> None:
    server, runtime = Server("job-1"), Runtime(SessionEndedError("refused"))
    loop, _state, session = loop_with(server, runtime)
    runtime.before = lambda: session.end("signInAgain")

    assert loop.run_once() is Pass.RAN

    assert server.ends() == []


def test_happy_path_the_loop_runs_until_an_interrupted_run_and_restores_the_signals() -> None:
    server = Server(None, "job-1")
    loop, _state, _session = loop_with(server, Runtime(RunOutcome.REQUEUED))
    before = signal.getsignal(signal.SIGTERM)

    loop.run()

    assert [name for name, _data in server.calls] == ["worker-claim", "worker-claim", "worker-end"]
    assert loop.stopping.is_set()
    assert signal.getsignal(signal.SIGTERM) is before


def test_happy_path_sigterm_between_jobs_ends_the_loop() -> None:
    server = Server("job-1")
    loop, _state, session = loop_with(server, Runtime(RunOutcome.DONE, lambda: signal.raise_signal(signal.SIGTERM)))

    loop.run()

    assert loop.stopping.is_set()
    assert [name for name, _data in server.calls] == ["worker-claim", "worker-end"]
    session.end("signedOut")


class CountingLoop(WorkerLoop):
    """The loop, stopping itself after two passes (the test's way to end a loop off the main thread)."""

    passes: list[Pass]

    def run_once(self) -> Pass:
        done = super().run_once()
        self.passes = [*getattr(self, "passes", []), done]
        if len(self.passes) == 2:
            self.stop()
        return done


def test_happy_path_a_signed_out_worker_waits_and_a_loop_off_the_main_thread_installs_no_handler() -> None:
    server = Server()
    loop, _state, _session = loop_with(server, Runtime(), signed_in=False, kind=CountingLoop)
    before = signal.getsignal(signal.SIGTERM)

    thread = threading.Thread(target=loop.run)
    thread.start()
    thread.join(timeout=10)

    assert isinstance(loop, CountingLoop)
    assert loop.passes == [Pass.NO_SESSION, Pass.NO_SESSION]
    assert server.calls == []
    assert signal.getsignal(signal.SIGTERM) is before


def test_happy_path_a_signal_during_a_run_asks_the_run_to_stop_and_ends_the_loop_after_it() -> None:
    """The run's own handler, when there is one, tells the loop's (lesson 342); the run asks the loop at its checkpoints."""
    server = Server("job-1")
    asked: list[bool] = []
    runtime = Runtime(RunOutcome.DONE)

    def signalled() -> None:
        signal.raise_signal(signal.SIGTERM)
        asked.append(runtime.asked_to_stop())

    runtime.before = signalled
    loop, _state, session = loop_with(server, runtime)

    loop.run()

    assert asked == [True]
    assert loop.stopping.is_set()
    session.end("signedOut")


def test_happy_path_a_worker_idle_for_long_waits_longer_and_a_wake_ends_the_long_wait() -> None:
    """Scenarios: S-P31-HAPPY-CLAIM-BACKOFF"""
    server = Server()
    loop, state, _session = loop_with(server, Runtime(), kind=CountingLoop)
    now = [0.0]
    state.pace = Pace(lambda: now[0], lambda: 0.0)
    state.timing.poll_seconds, state.timing.idle_poll_seconds = 0.01, 3600.0
    now[0] = AWAKE_SECONDS + 1
    for _ in range(MAX_PASSES):
        state.pace.idle_pass()
    assert state.pace.wait(0.01, 3600.0) > 600
    # Idle for long, the next wait is over ten minutes: the admin's look, a moment later, ends it.
    waker = threading.Timer(0.3, state.pace.wake)
    waker.start()

    loop.run()
    waker.join()

    assert isinstance(loop, CountingLoop)
    assert loop.passes == [Pass.IDLE, Pass.IDLE]
    assert state.pace.awake


def test_happy_path_a_job_that_ran_wakes_the_pace() -> None:
    """Scenarios: S-P31-HAPPY-CLAIM-BACKOFF"""
    server = Server("job-1")
    loop, state, session = loop_with(server, Runtime(), kind=CountingLoop)
    now = [AWAKE_SECONDS + 1]
    state.pace = Pace(lambda: now[0], lambda: 0.0)
    now[0] += AWAKE_SECONDS
    asleep = not state.pace.awake

    loop.run()

    assert asleep
    assert state.pace.awake
    session.end("signedOut")


def test_happy_path_an_idle_worker_waits_its_poll_interval_in_short_looks() -> None:
    server = Server()
    loop, state, _session = loop_with(server, Runtime(), kind=CountingLoop)
    state.timing.poll_seconds = 0.05

    loop.run()

    assert isinstance(loop, CountingLoop)
    assert loop.passes == [Pass.IDLE, Pass.IDLE]
    assert [name for name, _data in server.calls] == ["worker-claim", "worker-claim"]


def test_happy_path_a_claim_names_the_archives_held_and_a_copy_is_sent_before_any_job() -> None:
    """M20 (2026-11-13): the holder of an archive sends a series' copy when the claim asks. Scenarios: S-P20-HAPPY-ARCHIVE-COPY"""
    server, runtime = Server("copy"), Runtime()
    sent: list[object] = []
    loop, _state, _session = loop_with(server, runtime)
    loop.archives = lambda: ["ar-0123456789abcdef"]
    loop.copier = sent.append
    loop.films = lambda: ["job-film"]

    assert loop.run_once() is Pass.RAN
    assert (sent, runtime.jobs) == ([COPY_DUTY], [])
    assert server.calls[0][1]["archives"] == ["ar-0123456789abcdef"]
    # 2026-11-13: the films this computer holds go with every claim. Scenarios: S-P20-HAPPY-FILM-HOST
    assert server.calls[0][1]["films"] == ["job-film"]


def test_happy_path_a_worker_that_shares_on_its_own_says_so_with_each_claim() -> None:
    """M20 §22 (2026-11-14): the sharing thread sends the copies; the claim says `shares`. Scenarios: S-P20-HAPPY-ARCHIVE-SHARE"""
    server = Server()
    loop, _state, _session = loop_with(server, Runtime())
    loop.run_once()
    loop.shares = True
    loop.run_once()

    assert ["shares" in data for _name, data in server.calls] == [False, True]
    assert server.calls[1][1]["shares"] is True


def test_bad_path_a_run_without_the_sheets_is_reported_returned() -> None:
    """M20 (2026-11-13): no sheets and no copy: the server queues the job again unspent. Scenarios: S-P20-BAD-ARCHIVE-COPY"""
    server, runtime = Server("job-1"), Runtime(RunOutcome.RETURNED)
    loop, _state, _session = loop_with(server, runtime)

    assert loop.run_once() is Pass.RAN
    assert server.ends() == [{**IDS, "jobId": "job-1", "outcome": "returned"}]
