"""Pause this computer (the owner's request of 2026-11-13): the page's command, the server's pause mirrored, the loop, the governor,
`POST /pause`, `/state` and the page."""

import json
import time
from collections.abc import Callable, Iterator
from dataclasses import replace
from pathlib import Path

import cv2
import httpx
import pytest
from hcm_pipeline.governor.actuate import Actuators, Gate
from hcm_pipeline.governor.governor import CHOICE_FILE, Governor, load_choice
from hcm_pipeline.governor.policy import Choice, PolicyState, decide, effective
from hcm_pipeline.governor.signals import Cpu, Power
from hcm_pipeline.raster import gdal
from hcm_pipeline.runner import RunOutcome
from hcm_pipeline.worker.api import WorkerApi
from hcm_pipeline.worker.args import Endpoints, WorkerArgs
from hcm_pipeline.worker.loop import Pass, WorkerLoop
from hcm_pipeline.worker.page import PAGE_HTML, PAGE_JS, content_security_policy
from hcm_pipeline.worker.pausing import BY_ADMIN, BY_COMPUTER, Command, PauseControl, epoch_of, iso, parse_command
from hcm_pipeline.worker.server import LocalServer
from hcm_pipeline.worker.session import Session, Tokens
from hcm_pipeline.worker.state import WorkerState
from hcm_pipeline.worker.worker import Worker

from tests.fakes.documents import MemoryStore
from tests.fakes.http import FakeHttpServer
from tests.fakes.machines import LINUX_NVIDIA_CDI, SMALL_NO_GPU
from tests.fakes.worker_api import PROJECT, FakeWorkerApi, fake_id_token
from tests.fakes.world import NOW, FakeClock
from tests.unit.test_governor_loop import FakeProbe, Options
from tests.unit.test_worker_app import SETTINGS, App, from_admin, request

IDS = {"cityId": "bucharest", "workerId": "w-0123456789abcdef"}
HOUR = 3600.0


@pytest.fixture
def server() -> Iterator[tuple[LocalServer, App]]:
    app = App()
    local = LocalServer(app, SETTINGS, ("127.0.0.1", 0), content_security_policy(PROJECT), Endpoints.cloud(PROJECT).hosting_origins)
    try:
        yield local, app
    finally:
        local.stop()


@pytest.fixture
def gdal_settings() -> Iterator[None]:
    """GDAL's settings and OpenCV's threads as they were: the governor sets them for the whole process."""
    kept = {key: gdal.GetConfigOption(key) for key in ("GDAL_NUM_THREADS", "GDAL_CACHEMAX", "HCM_GOVERNED_WARP_MB")}
    threads = cv2.getNumThreads()
    yield
    for key, value in kept.items():
        gdal.SetConfigOption(key, value)
    cv2.setNumThreads(threads)


@pytest.fixture
def worker(tmp_path: Path, gdal_settings: None) -> Iterator[Worker]:
    with FakeHttpServer() as fake:
        api = FakeWorkerApi(MemoryStore(), fake, FakeClock()).install()
        args = WorkerArgs(
            city="bucharest", project=PROJECT, port=0, work=tmp_path, emulators=True, endpoints=Endpoints.emulated(PROJECT, api.env())
        )
        built = Worker.build(args, "127.0.0.1", api.clock)
        yield built
        built.close()


class Target:
    """The governor as the pause sees it: what it was told."""

    def __init__(self) -> None:
        self.told: list[object] = []

    def pause(self, until: float | None) -> None:
        self.told.append(("pause", until))

    def resume(self) -> None:
        self.told.append("resume")


# --- the command ------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ({"action": "resume"}, Command("resume")),
        ({"action": "pause"}, Command("pause")),
        ({"action": "pause", "until": iso(NOW + HOUR)}, Command("pause", NOW + HOUR)),
    ],
)
def test_happy_path_the_pages_commands_are_read(body: dict[str, object], expected: Command) -> None:
    assert parse_command(body, NOW) == expected


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"action": "stop"},
        {"action": "pause", "until": "tomorrow"},
        {"action": "pause", "until": "2026-11-13T10:00:00"},
        {"action": "pause", "until": iso(NOW - 1)},
        {"action": "pause", "until": iso(NOW + 49 * HOUR)},
        {"action": "pause", "until": 12},
    ],
)
def test_bad_path_a_command_with_a_bad_end_or_action_is_refused(body: dict[str, object]) -> None:
    assert parse_command(body, NOW) is None


def test_happy_path_a_command_goes_on_the_wire_as_the_server_reads_it() -> None:
    assert Command("pause", NOW).wire() == {"action": "pause", "until": iso(NOW)}
    assert Command("pause").wire() == {"action": "pause"}
    assert Command("resume").wire() == {"action": "resume"}
    assert epoch_of(iso(NOW)) == NOW


# --- the control ------------------------------------------------------------------------------------------------


def test_happy_path_the_page_pauses_at_once_and_the_server_answer_is_mirrored() -> None:
    target, clock = Target(), FakeClock()
    control = PauseControl(target, clock)
    woken: list[int] = []
    control.woken = lambda: woken.append(1)

    control.local(Command("pause", NOW + HOUR))
    sent = control.pending()
    assert (control.paused, control.snapshot(), woken) == (True, {"by": BY_COMPUTER, "until": iso(NOW + HOUR)}, [1])

    control.answered(sent, {"paused": True, "pause": {"by": BY_COMPUTER, "at": iso(NOW), "until": iso(NOW + HOUR)}})
    assert (control.pending(), target.told) == (None, [("pause", NOW + HOUR)])

    control.answered(None, {"paused": True, "pause": {"by": "owner-uid", "at": iso(NOW)}})
    assert control.snapshot() == {"by": BY_ADMIN}
    # The computers' list (W5) may answer a bare `paused: true`: paused from the admin, with no end.
    control.answered(None, {"job": None, "paused": True})
    assert control.snapshot() == {"by": BY_ADMIN}
    control.answered(None, {"job": None})
    assert (control.paused, control.snapshot(), target.told[-1]) == (False, None, "resume")


def test_bad_path_an_answer_older_than_a_newer_command_is_not_mirrored_and_a_past_pause_ends() -> None:
    target, clock = Target(), FakeClock()
    control = PauseControl(target, clock)
    in_flight = control.pending()
    control.local(Command("pause"))

    control.answered(in_flight, {"job": None})
    assert (control.paused, control.pending()) == (True, Command("pause"))

    control.local(Command("resume"))
    assert (control.paused, target.told) == (False, [("pause", None), "resume"])

    control.answered(control.pending(), {"paused": True, "pause": {"by": BY_COMPUTER, "at": iso(NOW), "until": iso(NOW + 60)}})
    clock.now += 61
    assert (control.paused, control.snapshot()) == (False, None)


def test_bad_path_without_a_governor_a_pause_frees_nothing_and_breaks_nothing() -> None:
    control = PauseControl()
    control.local(Command("pause"))
    control.local(Command("resume"))
    assert not control.paused


# --- the loop ---------------------------------------------------------------------------------------------------


class Answers:
    """`worker.claim` and `worker.end` as the loop meets them: each claim's answer in turn."""

    def __init__(self, *claims: dict[str, object]) -> None:
        self.claims = list(claims)
        self.calls: list[tuple[str, dict[str, object]]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        name = request.url.path.rsplit("/", 1)[-1]
        self.calls.append((name, json.loads(request.content)["data"]))
        if name == "worker-end":
            return httpx.Response(200, json={"result": {"status": "queued"}})
        return httpx.Response(200, json={"result": self.claims.pop(0) if self.claims else {"job": None}})

    def named(self, name: str) -> list[dict[str, object]]:
        return [data for each, data in self.calls if each == name]


class Runtime:
    def __init__(self, outcome: RunOutcome, during: Callable[[], None] = lambda: None) -> None:
        self.outcome, self.during = outcome, during
        self.released: list[bool] = []

    def run(self, _job_id: str, _asked_to_stop: Callable[[], bool], asked_to_release: Callable[[], bool]) -> RunOutcome:
        self.during()
        self.released.append(asked_to_release())
        return self.outcome


def loop_with(answers: Answers, runtime: Runtime) -> tuple[WorkerLoop, WorkerState]:
    clock = FakeClock()
    client = httpx.Client(transport=httpx.MockTransport(answers))
    session = Session(client, lambda: "unused", clock)
    session.begin(Tokens.of(fake_id_token(clock() + 3600), "AMf-vB" + "r" * 40))
    state = WorkerState("bucharest", PROJECT, session)
    state.timing.poll_seconds = 30
    api = WorkerApi(client, lambda name: f"http://127.0.0.1:1/{name}", session.bearer, lambda _seconds: None)
    loop = WorkerLoop(session, api, state, runtime, IDS)
    loop.pausing = PauseControl(Target(), clock)
    state.paused = loop.pausing.snapshot
    return loop, state


def test_happy_path_a_pause_from_the_page_while_idle_goes_with_the_next_claim_and_is_mirrored() -> None:
    answers = Answers({"job": None, "paused": True, "pause": {"by": BY_COMPUTER, "at": iso(NOW), "until": iso(NOW + HOUR)}})
    loop, state = loop_with(answers, Runtime(RunOutcome.DONE))
    loop.pausing.local(Command("pause", NOW + HOUR))

    assert loop.run_once() is Pass.IDLE

    (claim,) = answers.named("worker-claim")
    assert claim["pause"] == {"action": "pause", "until": iso(NOW + HOUR)}
    assert (loop.pausing.pending(), state.snapshot()["paused"]) == (None, {"by": BY_COMPUTER, "until": iso(NOW + HOUR)})


def test_happy_path_a_pause_asked_during_the_run_goes_with_the_end_and_the_run_was_asked_to_release() -> None:
    answers = Answers({"job": {"jobId": "job-1"}}, {"job": None, "paused": True, "pause": {"by": BY_COMPUTER, "at": iso(NOW)}})
    runtime = Runtime(RunOutcome.RELEASED)
    loop, state = loop_with(answers, runtime)
    runtime.during = lambda: loop.pausing.local(Command("pause"))

    assert loop.run_once() is Pass.RAN
    assert loop.run_once() is Pass.IDLE

    (end,) = answers.named("worker-end")
    assert (end["outcome"], end["pause"], runtime.released) == ("released", {"action": "pause"}, [True])
    assert "pause" not in answers.named("worker-claim")[1]
    assert state.snapshot()["state"] == "idle"
    assert loop._idle_seconds() == 30


def test_bad_path_a_job_the_owner_paused_ends_done_and_a_paused_worker_waits_one_poll_only() -> None:
    answers = Answers({"job": {"jobId": "job-1"}})
    loop, _state = loop_with(answers, Runtime(RunOutcome.PAUSED))

    assert loop.run_once() is Pass.RAN
    assert answers.named("worker-end")[0]["outcome"] == "done"

    loop.nudge()
    loop._wait(lambda: 3600.0)
    assert not loop._take_nudge()


# --- the governor -----------------------------------------------------------------------------------------------


def _governor(tmp_path: Path, wall: FakeClock) -> tuple[Governor, Gate]:
    gate = Gate()
    governor = Governor(FakeProbe(SMALL_NO_GPU), tmp_path, Actuators(Options(), gate), clock=FakeClock())
    governor.wall = wall
    return governor, gate


def test_happy_path_the_governor_pauses_keeps_it_in_the_volume_and_resumes_to_the_profile_before(tmp_path: Path) -> None:
    """Scenarios: S-P32-HAPPY-GOVERNOR-PAUSED"""
    wall = FakeClock()
    governor, gate = _governor(tmp_path, wall)
    governor.choose("quiet")
    governor.pause(NOW + HOUR)

    assert (governor.owner_paused, gate.paused, governor.headroom()) == (True, True, 0.0)
    kept = json.loads((tmp_path / CHOICE_FILE).read_text(encoding="utf-8"))
    assert kept == {"chosen": "paused", "batteryAllowed": False, "resumeTo": "quiet", "until": NOW + HOUR}
    assert load_choice(tmp_path) == Choice("paused", False, NOW + HOUR, "quiet")
    machine = governor.machine()
    assert machine is not None
    assert machine["profile"] == {"chosen": "paused", "active": "paused", "why": "owner", "until": iso(NOW + HOUR)}

    governor.choose("full")
    governor.pause(None)
    assert load_choice(tmp_path) == Choice("paused", False, None, "full")
    governor.resume()
    governor.resume()
    assert (governor.choice, gate.paused) == (Choice("full"), False)


def test_bad_path_a_timed_pause_past_its_end_resumes_by_itself(tmp_path: Path) -> None:
    wall = FakeClock()
    governor, gate = _governor(tmp_path, wall)
    governor.pause(NOW + 60)
    governor.tick()
    assert governor.owner_paused
    wall.now += 61
    governor.tick()
    assert (governor.owner_paused, gate.paused, governor.choice.chosen) == (False, False, "auto")


def test_bad_path_heat_and_a_low_battery_never_make_the_owners_pause_less_paused() -> None:
    """Scenarios: S-P32-BAD-GOVERNOR-HEAT"""
    hot = replace(LINUX_NVIDIA_CDI, cpu=Cpu(16, None, 99.0), power=Power("battery", 5))
    paused = Choice("paused")
    state = decide(hot, paused, PolicyState(), 0.0)
    assert effective(state) == ("paused", "owner")


# --- the page, its server and the worker ------------------------------------------------------------------------


def test_happy_path_the_page_and_the_admin_pause_and_resume_this_computer(server: tuple[LocalServer, App]) -> None:
    """Scenarios: S-P32-HAPPY-LOCAL-PAGE"""
    local, app = server
    page = local.answer(request(local, "POST", "/pause", b'{"action": "pause"}'))
    admin = local.answer(from_admin(local, "POST", "/pause", b'{"action": "resume"}'))
    preflight = local.answer(from_admin(local, "OPTIONS", "/pause"))

    assert (page[0], admin[0], preflight[0]) == (200, 200, 204)
    assert app.pauses == [{"action": "pause"}, {"action": "resume"}]


def test_bad_path_a_stranger_or_a_bad_command_pauses_nothing(server: tuple[LocalServer, App]) -> None:
    """Scenarios: S-P32-BAD-LOCAL-PAGE"""
    local, app = server
    stranger = local.answer(from_admin(local, "POST", "/pause", b'{"action": "pause"}', headers={"origin": "https://attacker.example"}))
    no_token = local.answer(request(local, "POST", "/pause", b'{"action": "pause"}', **{"x-hcm-worker": "b" * 64}))
    too_large = local.answer(request(local, "POST", "/pause", None))
    bad = local.answer(request(local, "POST", "/pause", b'{"action": "stop"}'))

    assert (stranger[0], no_token[0], too_large[0], bad[0]) == (403, 403, 403, 400)
    assert app.pauses == [{"action": "stop"}]


def test_happy_path_the_worker_wires_the_pause_into_its_page_its_state_and_its_governor(worker: Worker) -> None:
    # The governor and the pause read the wall clock: a real end, an hour from now.
    end = time.time() + HOUR
    assert worker.state.snapshot()["paused"] is None
    assert worker.actions.pause({"action": "pause", "until": iso(end)})
    assert not worker.actions.pause({"action": "pause", "until": iso(end - 2 * HOUR)})

    assert worker.actions.pausing is worker.loop.pausing
    assert worker.governor.owner_paused
    assert worker.state.snapshot()["paused"] == {"by": BY_COMPUTER, "until": iso(end)}
    assert worker.actions.pause({"action": "resume"})
    assert (worker.governor.owner_paused, worker.state.snapshot()["paused"]) == (False, None)


def test_happy_path_the_page_offers_the_three_pauses_and_resume_in_both_languages() -> None:
    for marker in ('data-pause="resume-only"', 'data-pause="hour"', 'data-pause="tomorrow"', 'id="resume"'):
        assert marker in PAGE_HTML
    for words in ("Until I resume", "For 1 hour", "Until tomorrow", "Paused by you", "Până reiau eu", "Pus pe pauză de tine"):
        assert words in PAGE_JS
    assert "fetch('/pause'" in PAGE_JS
    assert "setHours(8, 0, 0, 0)" in PAGE_JS
