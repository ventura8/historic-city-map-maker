"""The worker's sign-in, page, server edges, runtime and command (M7, docs/research/M7-local-worker.md §1, §2)."""

import dataclasses
import io
import json
import re
from collections.abc import Iterator, Mapping
from pathlib import Path

import httpx
import pytest
from hcm_pipeline.contract import Errors
from hcm_pipeline.exit_codes import ExitCode
from hcm_pipeline.main import main
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import spare_threads
from hcm_pipeline.secrets import SecretUnavailableError
from hcm_pipeline.steps import StepRegistry
from hcm_pipeline.urlguard import AddressRefusedError
from hcm_pipeline.worker.ai_state import STARTER_VERSION, starter_on_state, starter_words
from hcm_pipeline.worker.args import Endpoints, WorkerArgs
from hcm_pipeline.worker.command import WorkerCommand, yield_processor
from hcm_pipeline.worker.household import Removal
from hcm_pipeline.worker.page import FIREBASE_SDK_VERSION, PageSettings, content_security_policy, render_page
from hcm_pipeline.worker.runtime import NoSecrets, signed_client, worker_config
from hcm_pipeline.worker.server import LocalServer, Request
from hcm_pipeline.worker.worker import Worker, new_worker_id

from tests.fakes.documents import MemoryStore
from tests.fakes.http import FakeHttpServer, Reply
from tests.fakes.worker_api import PROJECT, FakeWorkerApi, fake_id_token
from tests.fakes.world import FakeClock

REPO = Path(__file__).resolve().parents[3]
CSRF = "a" * 64
SETTINGS = PageSettings(PROJECT, "bucharest", CSRF)


@pytest.fixture
def api() -> Iterator[FakeWorkerApi]:
    with FakeHttpServer() as server:
        yield FakeWorkerApi(MemoryStore(), server, FakeClock()).install()


@pytest.fixture
def built() -> Iterator[list[Worker]]:
    """The workers a test builds, closed after it (their page sockets and clients)."""
    workers: list[Worker] = []
    yield workers
    for worker in workers:
        worker.close()


def worker_for(api: FakeWorkerApi, work: Path, built: list[Worker]) -> Worker:
    worker = Worker.build(args_for(api, work), "127.0.0.1", api.clock)
    built.append(worker)
    return worker


def args_for(api: FakeWorkerApi, work: Path) -> WorkerArgs:
    return WorkerArgs(
        city="bucharest", project=PROJECT, port=0, work=work, emulators=True, endpoints=Endpoints.emulated(PROJECT, api.env())
    )


# --- sign-in ------------------------------------------------------------------------------------------------


def test_happy_path_sign_in_takes_the_hello_timing(api: FakeWorkerApi, tmp_path: Path, built: list[Worker]) -> None:
    api.hello_answer = {"pollSeconds": 12, "idlePollSeconds": 60, "heartbeatSeconds": 45}
    worker = worker_for(api, tmp_path, built)
    before = worker.state.timing.idle_poll_seconds

    assert worker.actions.sign_in(*api.sign_in_tokens(api.clock() + 3600)) is None

    assert (worker.state.timing.poll_seconds, worker.state.timing.heartbeat_seconds) == (12.0, 45.0)
    assert (before, worker.state.timing.idle_poll_seconds) == (None, 60.0)
    # The admin's page looking at the worker is what wakes its pace (`Worker.build`).
    assert worker.server.on_admin == worker.state.pace.wake
    assert worker.session.active is True
    assert re.fullmatch(r"w-[0-9a-f]{16}", worker.worker_id)
    assert new_worker_id() != worker.worker_id


def test_bad_path_a_token_the_server_refuses_is_not_kept(api: FakeWorkerApi, tmp_path: Path, built: list[Worker]) -> None:
    worker = worker_for(api, tmp_path, built)
    _id_token, refresh = api.sign_in_tokens(api.clock() + 3600)
    # Built at run time, not a literal: a token the server never issued (another project's, say).
    foreign = fake_id_token(api.clock() + 3600, uid="uid-stranger")

    assert worker.actions.sign_in(foreign, refresh) == "apiError.unauthenticated"
    assert worker.actions.sign_in("not a token", refresh) == Errors.INVALID_REQUEST
    assert worker.session.active is False
    assert [call.name for call in api.calls] == ["worker-hello"]


def test_bad_path_without_the_web_configuration_nobody_signs_in(api: FakeWorkerApi, tmp_path: Path, built: list[Worker]) -> None:
    api.server.route("GET", "/__/firebase/init.json", lambda _request: Reply(404, b"", "text/plain"))
    worker = worker_for(api, tmp_path, built)

    assert worker.actions.web_config() is None
    assert worker.actions.sign_in(*api.sign_in_tokens(api.clock() + 3600)) == "configMissing"
    assert api.calls == []


# --- the page and the server's edges -----------------------------------------------------------------------


def test_happy_path_the_page_uses_the_admins_firebase_sdk_version() -> None:
    admin = json.loads((REPO / "packages/admin/package.json").read_text(encoding="utf-8"))

    assert admin["dependencies"]["firebase"] == FIREBASE_SDK_VERSION


def test_happy_path_the_page_writes_its_checked_values_as_escaped_json() -> None:
    page = render_page(PageSettings(PROJECT, "bucharest", CSRF, "127.0.0.1:9099")).decode("utf-8")

    found = re.search(r'id="hcm-worker-settings">(.*?)</script>', page)
    assert found is not None
    assert json.loads(found.group(1)) == {"projectId": PROJECT, "cityId": "bucharest", "csrf": CSRF, "authEmulator": "127.0.0.1:9099"}
    policy = content_security_policy(PROJECT, ["127.0.0.1:9099"])
    assert "connect-src 'self' https://demo-hcm.web.app https://*.googleapis.com http://127.0.0.1:9099" in policy
    assert "script-src 'self' https://www.gstatic.com" in policy


@pytest.mark.parametrize(
    "values",
    [
        ("Demo HCM", "bucharest", CSRF, None),
        (PROJECT, "</script><script>", CSRF, None),
        (PROJECT, "bucharest", "short", None),
        (PROJECT, "bucharest", CSRF, "attacker.example:9099"),
    ],
)
def test_bad_path_a_value_of_the_wrong_shape_never_reaches_the_page(values: tuple[str, str, str, str | None]) -> None:
    with pytest.raises(ValueError, match="expected shape"):
        PageSettings(*values)


class App:
    """The page's actions as the server sees them, without a configuration."""

    def __init__(self) -> None:
        self.signed_in: list[tuple[object, object]] = []
        self.paired: list[object] = []
        self.pair_refusal: str | None = None
        self.profiles: list[tuple[object, object]] = []
        self.pauses: list[Mapping[str, object]] = []
        self.removals = 0
        self.remove_refusal: str | None = None

    def web_config(self) -> Mapping[str, str] | None:
        return None

    def state(self) -> Mapping[str, object]:
        return {"signedIn": False}

    def sign_in(self, id_token: object, refresh_token: object) -> str | None:
        self.signed_in.append((id_token, refresh_token))
        return Errors.INVALID_REQUEST

    def sign_out(self) -> None:
        return

    def pair(self, code: object) -> str | None:
        self.paired.append(code)
        return self.pair_refusal

    def profile(self, chosen: object, battery_allowed: object) -> bool:
        self.profiles.append((chosen, battery_allowed))
        return chosen in {"auto", "quiet", "full"}

    def pause(self, body: Mapping[str, object]) -> bool:
        self.pauses.append(body)
        return body.get("action") in {"pause", "resume"}

    def remove(self) -> str | None:
        self.removals += 1
        return self.remove_refusal


HOSTING = f"https://{PROJECT}.web.app"


@pytest.fixture
def server() -> Iterator[tuple[LocalServer, App]]:
    app = App()
    local = LocalServer(app, SETTINGS, ("127.0.0.1", 0), content_security_policy(PROJECT), Endpoints.cloud(PROJECT).hosting_origins)
    try:
        yield local, app
    finally:
        local.stop()


def request(local: LocalServer, method: str, path: str, body: bytes | None = b"", **headers: str) -> Request:
    base = {"host": f"127.0.0.1:{local.port}", "origin": f"http://127.0.0.1:{local.port}", "content-type": "application/json"}
    return Request(method, path, {**base, "x-hcm-worker": CSRF, **headers}, body)


def test_bad_path_the_servers_other_answers(server: tuple[LocalServer, App]) -> None:
    local, app = server

    answers = {
        "unknown page": local.answer(request(local, "GET", "/admin")),
        "missing configuration": local.answer(request(local, "GET", "/config")),
        "another method": local.answer(request(local, "PUT", "/session")),
        "another path": local.answer(request(local, "POST", "/state")),
        "a body too large": local.answer(request(local, "POST", "/session", None)),
        "not JSON": local.answer(request(local, "POST", "/session", b"{not json")),
        "not a record": local.answer(request(local, "POST", "/session", b"[1, 2]")),
    }

    assert {name: status for name, (status, _body, _type) in answers.items()} == {
        "unknown page": 404,
        "missing configuration": 503,
        "another method": 405,
        "another path": 404,
        "a body too large": 413,
        "not JSON": 403,
        "not a record": 403,
    }
    assert app.signed_in == [(None, None), (None, None)]
    assert local.answer(request(local, "GET", "/page.css"))[2].startswith("text/css")


def test_happy_path_the_server_answers_over_http_with_its_headers(server: tuple[LocalServer, App]) -> None:
    local, _app = server
    local.start()

    with httpx.Client() as client:
        answer = client.post(f"http://127.0.0.1:{local.port}/session", content=b"x" * 20_000)

    assert answer.status_code == 403
    assert answer.headers["cache-control"] == "no-store"
    assert answer.headers["content-security-policy"] == content_security_policy(PROJECT)


# --- auto-pair from the admin (finding 72, M7 §2.7) --------------------------------------------------------


def from_admin(local: LocalServer, method: str, path: str, body: bytes | None = b"", headers: Mapping[str, str] | None = None) -> Request:
    """A request of the admin's page on the project's Hosting origin (no CSRF token: it cannot know it)."""
    base = {"host": f"127.0.0.1:{local.port}", "origin": HOSTING, "content-type": "application/json"}
    return Request(method, path, {**base, **(headers or {})}, body)


def test_happy_path_the_admins_origin_reads_the_state_and_posts_its_code(server: tuple[LocalServer, App]) -> None:
    local, app = server
    preflight = from_admin(local, "OPTIONS", "/pair", headers={"access-control-request-private-network": "true"})
    state = from_admin(local, "GET", "/state")
    pair = from_admin(local, "POST", "/pair", json.dumps({"code": "a" * 26}).encode())

    assert local.answer(preflight)[0] == 204
    assert dict(local.cors_headers(preflight)) == {
        "Access-Control-Allow-Origin": HOSTING,
        "Vary": "Origin",
        "Access-Control-Allow-Methods": "GET, POST",
        "Access-Control-Allow-Headers": "content-type, x-hcm-path, x-hcm-session",
        "Access-Control-Max-Age": "600",
        "Access-Control-Allow-Private-Network": "true",
    }
    looks: list[str] = []
    local.on_admin = lambda: looks.append("admin")
    # The worker's own page (and the starter's loop, which sends no origin) wake nothing: only the admin's look does.
    assert local.answer(request(local, "GET", "/state"))[0] == 200
    assert looks == []
    assert local.answer(state)[0] == 200
    assert looks == ["admin"]
    assert dict(local.cors_headers(state)) == {"Access-Control-Allow-Origin": HOSTING, "Vary": "Origin"}
    assert local.answer(pair)[0] == 202
    assert app.paired == ["a" * 26]


def test_bad_path_another_site_can_neither_read_the_state_nor_pair(server: tuple[LocalServer, App]) -> None:
    local, app = server
    stranger = {"origin": "https://attacker.example"}
    app.pair_refusal = "paired"

    answers = {
        "a stranger's preflight": local.answer(from_admin(local, "OPTIONS", "/pair", headers=stranger)),
        "a preflight of the page's sign-in": local.answer(from_admin(local, "OPTIONS", "/session")),
        "a stranger's read": local.answer(from_admin(local, "GET", "/state", headers=stranger)),
        "a stranger's code": local.answer(from_admin(local, "POST", "/pair", b'{"code": "x"}', headers=stranger)),
        "the page's own origin": local.answer(request(local, "POST", "/pair", b'{"code": "x"}')),
        "a form's body": local.answer(from_admin(local, "POST", "/pair", b"code=x", headers={"content-type": "text/plain"})),
        "a body too large": local.answer(from_admin(local, "POST", "/pair", None)),
        "a computer paired already": local.answer(from_admin(local, "POST", "/pair", b'{"code": "x"}')),
    }

    assert {name: status for name, (status, _body, _type) in answers.items()} == {
        "a stranger's preflight": 403,
        "a preflight of the page's sign-in": 403,
        "a stranger's read": 403,
        "a stranger's code": 403,
        "the page's own origin": 403,
        "a form's body": 403,
        "a body too large": 413,
        "a computer paired already": 409,
    }
    assert local.cors_headers(from_admin(local, "GET", "/state", headers=stranger)) == []
    assert app.paired == ["x"]


def test_happy_path_the_page_actions_hand_a_code_to_the_connector_only_while_unpaired(
    api: FakeWorkerApi, tmp_path: Path, built: list[Worker]
) -> None:
    worker = worker_for(api, tmp_path, built)
    offered: list[str] = []
    worker.actions.accept_pairing(offered.append)

    assert worker.actions.pair("not a code") == Errors.INVALID_REQUEST
    assert worker.actions.pair("b" * 26) is None
    assert worker.state.snapshot()["pairable"] is True
    assert worker.state.snapshot()["workerId"] == worker.worker_id
    assert worker.actions.sign_in(*api.sign_in_tokens(api.clock() + 3600)) is None
    assert worker.actions.pair("c" * 26) == "paired"
    assert offered == ["b" * 26]
    assert worker.state.snapshot()["pairable"] is False


def test_happy_path_the_state_says_the_image_and_the_starters_version(
    api: FakeWorkerApi, tmp_path: Path, built: list[Worker], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-A142-HAPPY-VERSIONS"""
    monkeypatch.setenv("HCM_STARTER", STARTER_VERSION)
    monkeypatch.setenv("HCM_STARTER_UPDATE", "current")
    args = args_for(api, tmp_path)
    digest = "sha256:" + "ab" * 32
    worker = Worker.build(dataclasses.replace(args, image=digest), "127.0.0.1", api.clock)
    built.append(worker)

    snapshot = worker.state.snapshot()

    assert snapshot["image"] == digest
    assert snapshot["starter"] == {"version": STARTER_VERSION, "wanted": STARTER_VERSION, "update": "current"}
    assert starter_words({"version": STARTER_VERSION, "update": "current"}) == f"starter file {STARTER_VERSION}: current (this release's)"


@pytest.mark.parametrize(
    ("environment", "said", "words"),
    [
        ({}, {"version": None, "update": None}, "starter file: none (this worker was started by a command)"),
        ({"HCM_STARTER": "2"}, {"version": "2", "update": None}, f"starter file 2: OUT OF DATE, this release's is {STARTER_VERSION}"),
        ({"HCM_STARTER": "2; rm -rf", "HCM_STARTER_UPDATE": "BAD WORD"}, {"version": None, "update": None}, "starter file: none"),
        ({"HCM_STARTER": "abc", "HCM_STARTER_UPDATE": "no-list"}, {"version": "abc", "update": "no-list"}, "its last look said no-list"),
    ],
)
def test_bad_path_an_old_or_missing_starter_is_said_as_it_is(
    environment: Mapping[str, str], said: Mapping[str, object], words: str
) -> None:
    """Scenarios: S-A142-BAD-OLD-STARTER"""
    starter = starter_on_state(environment)

    assert starter == {**said, "wanted": STARTER_VERSION}
    assert words in starter_words(starter)


def test_bad_path_a_disconnected_worker_takes_no_code_from_the_admin(api: FakeWorkerApi, tmp_path: Path, built: list[Worker]) -> None:
    worker = worker_for(api, tmp_path, built)

    worker.state.failed("apiError.worker.revoked")

    assert worker.state.snapshot()["pairable"] is False


# --- the runtime and the command --------------------------------------------------------------------------


def test_happy_path_the_runs_configuration_names_the_worker_as_lease_owner(tmp_path: Path) -> None:
    args = WorkerArgs(city="bucharest", project=PROJECT, port=0, work=tmp_path, emulators=False, endpoints=Endpoints.cloud(PROJECT))

    config = worker_config(args, "w-0123456789abcdef", "job-1")

    assert (config.job_id, config.city_id, config.lease_owner, config.emulated) == (
        "job-1",
        "bucharest",
        "worker:w-0123456789abcdef",
        False,
    )
    with pytest.raises(SecretUnavailableError):
        NoSecrets().read("usgs-app-token")


def test_bad_path_a_signed_url_off_the_guard_is_never_requested() -> None:
    with signed_client(True) as sealed, pytest.raises(AddressRefusedError):
        sealed.get("https://storage.googleapis.com/bucket/scan.tif")
    with signed_client(False) as public, pytest.raises(AddressRefusedError):
        public.get("http://127.0.0.1:1/scan.tif")


def test_happy_path_the_worker_command_serves_until_stopped(api: FakeWorkerApi, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GDAL_NUM_THREADS", "1")
    env = {**api.env(), "HCM_STAC_URL": "http://127.0.0.1:1/stac", "HCM_OVERPASS_URL": "http://127.0.0.1:1/overpass", "HCM_GOVERNOR": "off"}
    built: list[Worker] = []

    def build(args: WorkerArgs) -> Worker:
        worker = Worker.build(args, "127.0.0.1", api.clock)
        worker.loop.stop()
        built.append(worker)
        return worker

    argv = ["worker", "--city", "bucharest", "--project", PROJECT, "--port", "0", "--work", str(tmp_path), "--emulators"]
    niced: list[int] = []
    code = main(argv, env, StepRegistry((WorkerCommand(build, niced.append),)), io.StringIO())

    assert code == ExitCode.OK
    assert built[0].loop.stopping.is_set()
    # The computer is its owner's first: the worker is niced, and GDAL's threads are the environment's when it names them.
    assert niced == [10]
    assert gdal.GetConfigOption("GDAL_NUM_THREADS") == "1"


@pytest.mark.parametrize(
    ("env", "niced"), [({}, [10]), ({"HCM_WORKER_NICE": "4"}, [4]), ({"HCM_WORKER_NICE": "0"}, []), ({"HCM_WORKER_NICE": "low"}, [10])]
)
def test_happy_path_the_worker_yields_the_processor_unless_told_not_to(env: dict[str, str], niced: list[int]) -> None:
    """Scenarios: S-P31-HAPPY-WORKER-POLITE, S-P31-BAD-WORKER-POLITE-OVERRIDE"""
    steps: list[int] = []

    yield_processor(env, steps.append)

    assert steps == niced
    assert (spare_threads(16), spare_threads(2), spare_threads(1), spare_threads(None)) == ("15", "1", "1", "1")


def test_bad_path_an_outdated_image_under_the_supervisor_exits_75(api: FakeWorkerApi, tmp_path: Path) -> None:
    """Scenarios: S-P04-BAD-SUPERVISED-OUTDATED"""
    # Finding 72: the starter's supervisor reads the exit and pulls the installed image.
    env = {**api.env(), "HCM_STAC_URL": "http://127.0.0.1:1/stac", "HCM_OVERPASS_URL": "http://127.0.0.1:1/overpass", "HCM_GOVERNOR": "off"}
    built: list[Worker] = []

    def build(args: WorkerArgs) -> Worker:
        worker = Worker.build(args, "127.0.0.1", api.clock)
        worker.loop.outdated_exit = True
        worker.loop.stop()
        built.append(worker)
        return worker

    digest = "sha256:" + "e7" * 32
    argv = ["worker", "--city", "bucharest", "--project", PROJECT, "--port", "0", "--work", str(tmp_path), "--emulators"]
    code = main([*argv, "--supervised", "--image", digest], env, StepRegistry((WorkerCommand(build, lambda _steps: None),)), io.StringIO())

    assert code == ExitCode.OUTDATED
    assert int(code) == 75
    assert built[0].loop.supervised is True


def test_happy_path_remove_this_computer_exits_with_the_orders_code(api: FakeWorkerApi, tmp_path: Path) -> None:
    """Scenarios: S-A143-HAPPY-REMOVE"""
    loopback = {"HCM_STAC_URL": "http://127.0.0.1:1/stac", "HCM_OVERPASS_URL": "http://127.0.0.1:1/overpass"}
    env = {**api.env(), **loopback, "HCM_GOVERNOR": "off", "HCM_REMOVABLE": "1"}
    built: list[Worker] = []

    def build(args: WorkerArgs) -> Worker:
        worker = Worker.build(args, "127.0.0.1", api.clock)
        worker.loop.removal = Removal(docker=False, keep=True)
        worker.loop.stop()
        built.append(worker)
        return worker

    argv = ["worker", "--city", "bucharest", "--project", PROJECT, "--port", "0", "--work", str(tmp_path), "--emulators"]
    code = main(argv, env, StepRegistry((WorkerCommand(build, lambda _steps: None),)), io.StringIO())

    assert int(code) == 78
    assert built[0].loop.removable is True


def test_happy_path_the_starters_last_run_only_says_done(api: FakeWorkerApi, tmp_path: Path) -> None:
    """Scenarios: S-A143-HAPPY-REMOVE"""
    loopback = {"HCM_STAC_URL": "http://127.0.0.1:1/stac", "HCM_OVERPASS_URL": "http://127.0.0.1:1/overpass"}
    env = {**api.env(), **loopback, "HCM_GOVERNOR": "off", "HCM_REMOVAL": "done", "HCM_REMOVAL_DOCKER_LEFT": "true"}
    built: list[Worker] = []

    def build(args: WorkerArgs) -> Worker:
        worker = Worker.build(args, "127.0.0.1", api.clock)
        built.append(worker)
        return worker

    argv = ["worker", "--city", "bucharest", "--project", PROJECT, "--port", "0", "--work", str(tmp_path), "--emulators"]
    code = main(argv, env, StepRegistry((WorkerCommand(build, lambda _steps: None),)), io.StringIO())

    # No kept session in this folder: the word cannot be sent (the loop's tests send it), and the loop never ran.
    assert code == ExitCode.OK
    assert built[0].loop.stopping.is_set() is False


def test_happy_path_stop_using_this_computer_on_its_page_asks_the_starter(server: tuple[LocalServer, App]) -> None:
    """Scenarios: S-A143-HAPPY-REMOVE"""
    local, app = server

    assert local.answer(request(local, "POST", "/remove", b"{}"))[0] == 202
    app.remove_refusal = "no-starter"
    status, body, _type = local.answer(request(local, "POST", "/remove", b"{}"))
    assert (status, json.loads(body)) == (409, {"error": "no-starter"})
    # Only the page itself (its token, its origin): the admin's origin, or no token, cannot ask it.
    assert local.answer(request(local, "POST", "/remove", b"{}", **{"x-hcm-worker": "wrong"}))[0] == 403
    assert local.answer(from_admin(local, "POST", "/remove", b"{}"))[0] == 403
    assert app.removals == 2


def test_bad_path_page_actions_without_a_cleaning_starter_refuse_to_remove(api: FakeWorkerApi, tmp_path: Path, built: list[Worker]) -> None:
    """Scenarios: S-A143-BAD-REMOVE-NO-STARTER"""
    worker = worker_for(api, tmp_path, built)

    assert worker.actions.remove() == "no-starter"
    worker.loop.removable = True
    assert worker.actions.remove() is None
    assert worker.loop.removal == Removal(docker=False, keep=False)
    assert worker.loop.stopping.is_set()


def test_bad_path_the_worker_command_names_a_bad_argument() -> None:
    stream = io.StringIO()

    code = main(["worker", "--project", PROJECT], {}, StepRegistry((WorkerCommand(),)), stream)

    assert code == ExitCode.CONFIG
    assert "--city must be a city id" in stream.getvalue()
