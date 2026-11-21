"""Pairing's edges (finding 67 of 2026-11-02, M7 §2.6): the answers of `worker.pair` and of Identity Toolkit that are not
tokens, a server out of reach at `worker.hello`, a refreshed paired session kept again, and a loop without a connector."""

import json
from collections.abc import Callable
from pathlib import Path

import httpx
import pytest
from hcm_pipeline.contract import Errors
from hcm_pipeline.worker.api import WorkerApi, WorkerApiError
from hcm_pipeline.worker.args import Endpoints
from hcm_pipeline.worker.loop import NoConnector
from hcm_pipeline.worker.pairing import Connector, Kept, Pairing, SessionFile, Signer
from hcm_pipeline.worker.session import RefreshUnavailableError, Session, Tokens
from hcm_pipeline.worker.webconfig import WebConfig

from tests.fakes.worker_api import PROJECT, fake_id_token
from tests.fakes.world import FakeClock

CODE = "abcdefghijklmnopqrstuvwxyz"
PAIR = "c" * 40
CONFIG = {"apiKey": "demo-web-api-key", "authDomain": f"{PROJECT}.firebaseapp.com", "projectId": PROJECT}
ENDPOINTS = Endpoints.cloud(PROJECT)


def pairing_with(sign_in: Callable[[httpx.Request], httpx.Response], pair_id: str = PAIR) -> Pairing:
    """`worker.pair` answering `pair_id`, Hosting's web configuration, and Identity Toolkit answering with `sign_in`."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("worker-pair"):
            return httpx.Response(200, json={"result": {"token": "custom", "pairId": pair_id}})
        if request.url.path.endswith("init.json"):
            return httpx.Response(200, json=CONFIG)
        return sign_in(request)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    api = WorkerApi(client, ENDPOINTS.function, lambda: "unused", lambda _seconds: None)
    return Pairing(client, api, ENDPOINTS, WebConfig(client, ENDPOINTS.init_json, PROJECT), "bucharest")


def unreachable(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError("offline", request=request)


def test_happy_path_the_worker_id_outlives_a_restart(tmp_path: Path) -> None:
    """Scenarios: S-P04-HAPPY-WORKER-ID-KEPT"""
    ids = iter(["w-0123456789abcdef", "w-fedcba9876543210"])

    first = SessionFile(tmp_path, "bucharest").worker_id(lambda: next(ids))
    again = SessionFile(tmp_path, "bucharest").worker_id(lambda: next(ids))

    assert (first, again) == ("w-0123456789abcdef", "w-0123456789abcdef")


def test_bad_path_a_forgotten_session_or_a_damaged_file_starts_as_a_new_worker(tmp_path: Path) -> None:
    """Scenarios: S-P04-BAD-WORKER-ID-FORGOTTEN"""
    ids = iter(["w-0123456789abcdef", "w-fedcba9876543210", "w-00000000000000aa"])
    file = SessionFile(tmp_path, "bucharest")
    file.worker_id(lambda: next(ids))

    file.clear()
    assert file.worker_id(lambda: next(ids)) == "w-fedcba9876543210"

    file.id_path.write_text("not an id", "utf-8")
    assert file.worker_id(lambda: next(ids)) == "w-00000000000000aa"


def test_bad_path_a_damaged_undecodable_id_file_starts_as_a_new_worker(tmp_path: Path) -> None:
    """Scenarios: S-P04-BAD-WORKER-ID-UNWRITABLE"""
    file = SessionFile(tmp_path, "bucharest")
    file.id_path.write_bytes(b"\xff\xfe\x00 not text")

    assert file.worker_id(lambda: "w-fedcba9876543210") == "w-fedcba9876543210"
    assert file.id_path.read_text("utf-8") == "w-fedcba9876543210"


def test_bad_path_a_folder_that_cannot_be_written_keeps_the_id_and_the_session_in_memory(tmp_path: Path) -> None:
    """Scenarios: S-P04-BAD-WORKER-ID-UNWRITABLE"""
    not_a_folder = tmp_path / "work"
    not_a_folder.write_text("a file where the folder should be", "utf-8")
    file = SessionFile(not_a_folder, "bucharest")

    assert file.worker_id(lambda: "w-fedcba9876543210") == "w-fedcba9876543210"

    file.save(Kept("refresh", PAIR, "e" * 64))
    file.clear()
    file.forget_id()
    assert file.load() is None


def test_happy_path_a_kept_id_is_read_from_a_folder_that_cannot_be_written(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P04-BAD-WORKER-ID-UNWRITABLE"""
    file = SessionFile(tmp_path, "bucharest")
    file.id_path.write_text("w-0123456789abcdef", "utf-8")

    def read_only(*_args: object, **_kwargs: object) -> None:
        raise PermissionError("read-only")

    monkeypatch.setattr(Path, "write_text", read_only)

    assert file.worker_id(lambda: "w-fedcba9876543210") == "w-0123456789abcdef"


def test_happy_path_the_custom_token_is_signed_in_with_the_hosting_origin_as_referer() -> None:
    seen: list[httpx.Request] = []

    def sign_in(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"idToken": "id", "refreshToken": "refresh"})

    paired = pairing_with(sign_in).exchange(CODE, None)

    assert (paired.id_token, paired.refresh_token, paired.pair_id) == ("id", "refresh", PAIR)
    assert seen[0].headers["referer"] == f"https://{PROJECT}.web.app/"
    assert json.loads(seen[0].content) == {"token": "custom", "returnSecureToken": True}
    assert "key=demo-web-api-key" in str(seen[0].url)


@pytest.mark.parametrize(
    ("sign_in", "pair_id", "error"),
    [
        (lambda _request: httpx.Response(200, json={}), "not-a-pairing", WorkerApiError),
        (unreachable, PAIR, RefreshUnavailableError),
        (lambda _request: httpx.Response(200, content=b"<html>"), PAIR, RefreshUnavailableError),
        (lambda _request: httpx.Response(400, json={"error": {"message": "INVALID_CUSTOM_TOKEN"}}), PAIR, WorkerApiError),
    ],
)
def test_bad_path_an_answer_that_is_not_a_pairing_or_tokens_is_an_error(
    sign_in: Callable[[httpx.Request], httpx.Response], pair_id: str, error: type[Exception]
) -> None:
    with pytest.raises(error):
        pairing_with(sign_in, pair_id).exchange(CODE, "d" * 40)


class Actions:
    """The page's sign-in, answering `refusal` (None: the session begins)."""

    def __init__(self, session: Session, refusal: str | None) -> None:
        self.session = session
        self.refusal = refusal

    def sign_in(self, id_token: object, refresh_token: object, keep: Callable[[Tokens], None] | None = None) -> str | None:
        if self.refusal is None:
            self.session.begin(Tokens.of(id_token, refresh_token), keep)
        return self.refusal


def test_bad_path_a_server_out_of_reach_at_hello_is_tried_again(tmp_path: Path) -> None:
    clock = FakeClock()
    pairing = pairing_with(lambda _request: httpx.Response(200, json={"idToken": fake_id_token(clock() + 3600), "refreshToken": "r"}))
    session = Session(httpx.Client(transport=httpx.MockTransport(unreachable)), lambda: "https://token.test", clock)
    actions = Actions(session, Errors.UNAVAILABLE)
    connector = Connector(pairing, SessionFile(tmp_path, "bucharest"), Signer(session, actions, lambda _code: None), CODE, clock)

    connector.attempt()
    assert [session.active] == [False]
    actions.refusal = None
    clock.now += 30
    connector.attempt()

    assert [session.active] == [True]
    kept = SessionFile(tmp_path, "bucharest").load()
    assert kept is not None
    assert kept.pair_id == PAIR


def test_happy_path_a_paired_session_is_kept_again_after_each_refresh(tmp_path: Path) -> None:
    clock = FakeClock()
    answers = httpx.MockTransport(
        lambda _request: httpx.Response(200, json={"id_token": fake_id_token(clock() + 3600), "refresh_token": "r2"})
    )
    session = Session(httpx.Client(transport=answers), lambda: "https://token.test", clock)
    file = SessionFile(tmp_path, "bucharest")
    session.begin(Tokens.of(fake_id_token(clock() + 60), "r1"), lambda tokens: file.save(Kept(tokens.refresh_token, PAIR, "e" * 64)))

    session.bearer()

    kept = file.load()
    assert kept is not None
    assert kept.refresh_token == "r2"


def test_happy_path_a_loop_without_a_connector_tries_and_forgets_nothing() -> None:
    connector, folder_before = NoConnector(), list(Path.cwd().iterdir())

    connector.attempt()
    connector.forget()

    assert list(Path.cwd().iterdir()) == folder_before


def test_happy_path_the_admins_code_offered_later_pairs_a_worker_started_without_one(tmp_path: Path) -> None:
    # Finding 72 (auto-pair): the starter starts the worker with no code; the admin posts one to `POST /pair` later.
    clock = FakeClock()
    pairing = pairing_with(lambda _request: httpx.Response(200, json={"idToken": fake_id_token(clock() + 3600), "refreshToken": "r"}))
    session = Session(httpx.Client(transport=httpx.MockTransport(unreachable)), lambda: "https://token.test", clock)
    connector = Connector(
        pairing, SessionFile(tmp_path, "bucharest"), Signer(session, Actions(session, None), lambda _code: None), None, clock
    )

    connector.attempt()
    assert [session.active] == [False]
    connector.forget()
    connector.offer(CODE)
    connector.attempt()

    assert [session.active] == [True]
    kept = SessionFile(tmp_path, "bucharest").load()
    assert kept is not None
    assert kept.pair_id == PAIR
