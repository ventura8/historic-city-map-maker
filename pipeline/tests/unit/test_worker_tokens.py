"""The owner's session and the project's web configuration (M7, docs/research/M7-local-worker.md §2.1, §2.2)."""

import io
import json
from collections.abc import Callable

import httpx
import pytest
from hcm_pipeline.worker.session import (
    SIGN_IN_AGAIN,
    RefreshUnavailableError,
    Session,
    SessionEndedError,
    Tokens,
    token_claims,
)
from hcm_pipeline.worker.webconfig import WebConfig, WebConfigError

from tests.fakes.worker_api import OWNER_EMAIL, fake_id_token
from tests.fakes.world import FakeClock

REFRESH = "AMf-vB" + "r" * 120
CONFIG_URL = "https://demo-hcm.web.app/__/firebase/init.json"
WEB_CONFIG = {"apiKey": "demo-web-api-key", "authDomain": "demo-hcm.firebaseapp.com", "projectId": "demo-hcm", "appId": "1:2:web:3"}


def client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def refreshed(clock: FakeClock, requests: list[httpx.Request]) -> Callable[[httpx.Request], httpx.Response]:
    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        tokens = {"id_token": fake_id_token(clock() + 3600, email=""), "refresh_token": REFRESH, "expires_in": "3600"}
        return httpx.Response(200, json=tokens)

    return handler


def test_happy_path_the_claims_of_a_token_are_read_without_verifying() -> None:
    claims = token_claims(fake_id_token(1_800_000_000))

    assert claims is not None
    assert (claims["exp"], claims["email"]) == (1_800_000_000, OWNER_EMAIL)
    assert token_claims("not-a-jwt") is None
    assert token_claims("a.%%%.c") is None
    assert token_claims("a.WzFd.c") is None


@pytest.mark.parametrize(
    ("id_token", "refresh_token"),
    [(None, REFRESH), (fake_id_token(1), ""), (fake_id_token(1), "with space"), ("a.e30.", REFRESH), (fake_id_token(1), "x" * 5000)],
)
def test_bad_path_unusable_tokens_are_refused(id_token: object, refresh_token: object) -> None:
    with pytest.raises(ValueError, match=r"session needs|carries no expiry"):
        Tokens.of(id_token, refresh_token)


def test_happy_path_the_token_is_refreshed_five_minutes_before_it_expires(log_stream: io.StringIO) -> None:
    clock, requests = FakeClock(), list[httpx.Request]()
    first = Tokens.of(fake_id_token(clock() + 3600), REFRESH)
    session = Session(client(refreshed(clock, requests)), lambda: "https://securetoken.googleapis.com/v1/token?key=demo", clock)
    session.begin(first)

    assert (session.active, session.email, session.bearer()) == (True, OWNER_EMAIL, first.id_token)
    clock.now += 3600 - 300
    renewed = session.bearer()

    assert renewed != first.id_token
    assert session.email == OWNER_EMAIL
    assert len(requests) == 1
    assert dict(httpx.QueryParams(requests[0].content.decode())) == {"grant_type": "refresh_token", "refresh_token": REFRESH}
    assert REFRESH not in repr(first)
    assert REFRESH not in log_stream.getvalue()


def test_bad_path_a_refused_refresh_ends_the_session() -> None:
    clock = FakeClock()
    session = Session(
        client(lambda _request: httpx.Response(400, json={"error": {"message": "TOKEN_EXPIRED"}})),
        lambda: "https://securetoken.googleapis.com/v1/token?key=demo",
        clock,
    )
    session.begin(Tokens.of(fake_id_token(clock()), REFRESH))

    with pytest.raises(SessionEndedError):
        session.bearer()

    assert (session.active, session.email, session.ended_because) == (False, None, SIGN_IN_AGAIN)
    with pytest.raises(SessionEndedError, match="sign in"):
        session.bearer()


def unreachable(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError("down", request=request)


@pytest.mark.parametrize(
    "handler",
    [unreachable, lambda _request: httpx.Response(200, text="<html>"), lambda _request: httpx.Response(200, json={"id_token": "x"})],
)
def test_bad_path_an_unreachable_or_garbled_token_service_keeps_the_session(handler: Callable[[httpx.Request], httpx.Response]) -> None:
    clock = FakeClock()
    session = Session(client(handler), lambda: "https://securetoken.googleapis.com/v1/token?key=demo", clock)
    session.begin(Tokens.of(fake_id_token(clock()), REFRESH))

    with pytest.raises(RefreshUnavailableError):
        session.bearer()

    assert session.active is True


def test_happy_path_the_web_configuration_is_read_once_and_checked() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={**WEB_CONFIG, "measurementId": "<script>"})

    config = WebConfig(client(handler), CONFIG_URL, "demo-hcm")

    assert config.get() == WEB_CONFIG
    assert config.api_key() == "demo-web-api-key"
    assert [str(request.url) for request in requests] == [CONFIG_URL]


@pytest.mark.parametrize(
    ("handler", "problem"),
    [
        (unreachable, "unreachable"),
        (lambda _request: httpx.Response(404), "HTTP 404"),
        (lambda _request: httpx.Response(200, text="<html>"), "not JSON"),
        (lambda _request: httpx.Response(200, json=[1]), "does not name this project"),
        (lambda _request: httpx.Response(200, json={**WEB_CONFIG, "projectId": "other-project"}), "does not name this project"),
        (lambda _request: httpx.Response(200, json={**WEB_CONFIG, "apiKey": "a b"}), "no usable apiKey"),
    ],
)
def test_bad_path_an_unreadable_or_foreign_web_configuration_is_refused(
    handler: Callable[[httpx.Request], httpx.Response], problem: str
) -> None:
    with pytest.raises(WebConfigError, match=problem):
        WebConfig(client(handler), CONFIG_URL, "demo-hcm").get()


def test_happy_path_a_failed_read_is_tried_again() -> None:
    answers = iter([httpx.Response(503), httpx.Response(200, content=json.dumps(WEB_CONFIG).encode())])
    config = WebConfig(client(lambda _request: next(answers)), CONFIG_URL, "demo-hcm")

    with pytest.raises(WebConfigError):
        config.get()

    assert config.get()["projectId"] == "demo-hcm"
