"""The governor inside the worker (docs/research/M26-governor.md §4, §6): `/state`'s machine, `POST /profile`, the matcher's budget, the
gate at a run's checkpoints, and the command that governs."""

import io
import json
from collections.abc import Iterator
from pathlib import Path

import cv2
import numpy
import pytest
from hcm_pipeline.exit_codes import ExitCode
from hcm_pipeline.governor.actuate import Gate
from hcm_pipeline.jobs import CancelledRunError, RunFlags, StepDeadline
from hcm_pipeline.main import main
from hcm_pipeline.matcher.box import MatcherBudget, Request, read_request, write_request
from hcm_pipeline.raster import gdal
from hcm_pipeline.steps import StepRegistry
from hcm_pipeline.worker.args import Endpoints, WorkerArgs
from hcm_pipeline.worker.command import WorkerCommand
from hcm_pipeline.worker.page import content_security_policy
from hcm_pipeline.worker.server import LocalServer
from hcm_pipeline.worker.worker import Worker

from tests.fakes.documents import MemoryStore
from tests.fakes.http import FakeHttpServer
from tests.fakes.worker_api import PROJECT, FakeWorkerApi
from tests.fakes.world import FakeClock
from tests.unit.test_worker_app import HOSTING, SETTINGS, App, from_admin


@pytest.fixture
def api() -> Iterator[FakeWorkerApi]:
    with FakeHttpServer() as fake:
        yield FakeWorkerApi(MemoryStore(), fake, FakeClock()).install()


@pytest.fixture
def server() -> Iterator[tuple[LocalServer, App]]:
    app = App()
    local = LocalServer(app, SETTINGS, ("127.0.0.1", 0), content_security_policy(PROJECT), Endpoints.cloud(PROJECT).hosting_origins)
    try:
        yield local, app
    finally:
        local.stop()


@pytest.fixture
def worker(api: FakeWorkerApi, tmp_path: Path) -> Iterator[Worker]:
    args = WorkerArgs(
        city="bucharest", project=PROJECT, port=0, work=tmp_path, emulators=True, endpoints=Endpoints.emulated(PROJECT, api.env())
    )
    built = Worker.build(args, "127.0.0.1", api.clock)
    yield built
    built.close()


def test_happy_path_the_admin_chooses_the_profile_of_this_computer(server: tuple[LocalServer, App]) -> None:
    """Scenarios: S-A141-HAPPY"""
    local, app = server
    preflight = from_admin(local, "OPTIONS", "/profile")
    chosen = from_admin(local, "POST", "/profile", json.dumps({"profile": "quiet", "batteryAllowed": True}).encode())

    assert local.answer(preflight)[0] == 204
    assert local.answer(chosen)[0] == 200
    assert dict(local.cors_headers(chosen))["Access-Control-Allow-Origin"] == HOSTING
    assert app.profiles == [("quiet", True)]


def test_bad_path_a_stranger_or_a_bad_profile_changes_nothing(server: tuple[LocalServer, App]) -> None:
    """Scenarios: S-A141-BAD-OLD-WORKER"""
    local, app = server
    stranger = {"origin": "https://attacker.example"}
    answers = {
        "a stranger": local.answer(from_admin(local, "POST", "/profile", b'{"profile": "full"}', headers=stranger)),
        "a body too large": local.answer(from_admin(local, "POST", "/profile", None)),
        "a form": local.answer(from_admin(local, "POST", "/profile", b"profile=full", headers={"content-type": "text/plain"})),
        "turbo": local.answer(from_admin(local, "POST", "/profile", b'{"profile": "turbo"}')),
    }
    assert {name: status for name, (status, _body, _type) in answers.items()} == {
        "a stranger": 403,
        "a body too large": 403,
        "a form": 403,
        "turbo": 400,
    }
    assert app.profiles == [("turbo", None)]


@pytest.fixture
def gdal_settings() -> Iterator[None]:
    """GDAL's settings and OpenCV's threads as they were: the governor sets them for the whole process."""
    kept = {key: gdal.GetConfigOption(key) for key in ("GDAL_NUM_THREADS", "GDAL_CACHEMAX", "HCM_GOVERNED_WARP_MB")}
    threads = cv2.getNumThreads()
    yield
    for key, value in kept.items():
        gdal.SetConfigOption(key, value)
    cv2.setNumThreads(threads)


@pytest.mark.usefixtures("gdal_settings")
def test_happy_path_the_worker_says_this_computer_and_keeps_the_owners_choice(worker: Worker, tmp_path: Path) -> None:
    assert worker.state.snapshot()["machine"] is None
    lowered: list[int] = []
    worker.govern(lambda: lowered.append(1))
    machine = worker.state.snapshot()["machine"]
    assert isinstance(machine, dict)
    profile = machine["profile"]
    assert isinstance(profile, dict)
    assert profile["chosen"] == "auto"
    assert lowered == [1]
    assert worker.actions.profile("full", None)
    assert not worker.actions.profile("turbo", None)
    assert json.loads((tmp_path / "governor.json").read_text(encoding="utf-8"))["chosen"] == "full"
    assert worker.runtime.matcher_budget().keypoints >= 1


def test_happy_path_the_command_governs_unless_told_not_to(api: FakeWorkerApi, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GDAL_NUM_THREADS", "1")
    governed: list[Worker] = []

    def govern(self: Worker) -> None:
        governed.append(self)

    monkeypatch.setattr(Worker, "govern", govern)
    env = {**api.env(), "HCM_STAC_URL": "http://127.0.0.1:1/stac", "HCM_OVERPASS_URL": "http://127.0.0.1:1/overpass"}

    def build(args: WorkerArgs) -> Worker:
        built = Worker.build(args, "127.0.0.1", api.clock)
        built.loop.stop()
        return built

    argv = ["worker", "--city", "bucharest", "--project", PROJECT, "--port", "0", "--work", str(tmp_path), "--emulators"]
    assert main(argv, env, StepRegistry((WorkerCommand(build, lambda _steps: None),)), io.StringIO()) == ExitCode.OK
    assert len(governed) == 1


def test_happy_path_the_matcher_request_carries_its_budget(tmp_path: Path) -> None:
    grid = numpy.eye(3)
    budget = MatcherBudget(4, 1024, 0.4, yield_gpu=True)
    path = write_request(
        tmp_path, "r001", Request(numpy.zeros((8, 8), numpy.uint8), numpy.zeros((4, 4), numpy.uint8), grid, grid, 1.0, budget)
    )
    assert read_request(path).budget == budget
    assert MatcherBudget.of_array(numpy.zeros(2)) == MatcherBudget()
    assert MatcherBudget.of_array(numpy.array([-3.0, 0.0, 9.0, 0.0])) == MatcherBudget(0, 1, 1.0, False)
    old = tmp_path / "old.request.npz"
    numpy.savez_compressed(old, film=grid, reference=grid, film_grid=grid, reference_grid=grid, ground=numpy.array(1.0))
    assert read_request(old).budget == MatcherBudget()


def test_bad_path_a_paused_computer_holds_the_step_and_moves_its_time_limit() -> None:
    """Scenarios: S-A141-BAD-BATTERY"""
    gate = Gate(iter([0.0, 30.0, 30.0, 30.0]).__next__)
    flags = RunFlags(hold=gate.hold)
    flags.deadline = StepDeadline("warp", 100.0, 100.0, lambda: 110.0)
    gate.pause()
    flags.raise_flag(CancelledRunError)
    with pytest.raises(CancelledRunError):
        flags.check()
    assert flags.deadline.ends_at == 130.0
    assert flags.gdal_progress(0.5, "", None) == 0
