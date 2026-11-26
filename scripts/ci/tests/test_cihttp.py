"""cihttp.py: the HTTPS transport of the network-bound checks, driven through a fake http.client.HTTPSConnection.

Retries and redirects are exercised with a scripted fetch; nothing reaches the network (conftest blocks it).
"""

import http.client
import logging
from collections.abc import Sequence
from http import HTTPStatus
from typing import ClassVar

import cihttp
import pytest
from cihttp import Request, Response

URL = "https://console.example.org/billing"

Answer = Response | Exception


class ScriptedFetch:
    """Serves `answers` in order (the last one repeats) and records every request."""

    def __init__(self, answers: Sequence[Answer]) -> None:
        self.answers = list(answers)
        self.calls: list[Request] = []

    def __call__(self, request: Request) -> Response:
        self.calls.append(request)
        answer = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(answer, Exception):
            raise answer
        return answer


@pytest.fixture
def log(caplog: pytest.LogCaptureFixture) -> pytest.LogCaptureFixture:
    caplog.set_level(logging.INFO, logger="hcm")
    return caplog


# --- retry --------------------------------------------------------------------------------------------


def test_happy_path_one_network_blip_is_retried(log: pytest.LogCaptureFixture) -> None:
    fetch = ScriptedFetch([TimeoutError("slow"), Response(200)])

    assert cihttp.with_retry(fetch)(Request("HEAD", URL)) == Response(200)
    assert f"  retrying HEAD {URL} after: slow" in log.text


def test_bad_path_persistent_network_error_is_raised_after_the_retry() -> None:
    fetch = ScriptedFetch([TimeoutError("down")])

    with pytest.raises(TimeoutError, match="down"):
        cihttp.with_retry(fetch)(Request("HEAD", URL))
    assert len(fetch.calls) == 2


# --- redirects ----------------------------------------------------------------------------------------


def test_happy_path_redirects_are_followed_with_the_same_method() -> None:
    fetch = ScriptedFetch([Response(302, {"location": "/sign-in"}), Response(200)])

    assert cihttp.follow(Request("GET", URL), fetch) == Response(200)
    assert [call.url for call in fetch.calls] == [URL, "https://console.example.org/sign-in"]


def test_bad_path_redirect_loop_raises_a_transport_error() -> None:
    fetch = ScriptedFetch([Response(301, {"location": URL})])

    with pytest.raises(cihttp.TransportError, match=f"more than {cihttp.MAX_REDIRECTS} redirects"):
        cihttp.follow(Request("GET", URL), fetch)
    assert len(fetch.calls) == cihttp.MAX_REDIRECTS + 1


def test_happy_path_success_statuses() -> None:
    assert cihttp.is_success(HTTPStatus.NO_CONTENT)
    assert not cihttp.is_success(HTTPStatus.MULTIPLE_CHOICES)


# --- JSON bodies --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("body", "document", "field"),
    [(b'{"id": "x"}', {"id": "x"}, "x"), (b"[1, 2]", [1, 2], None), (b"<html>", None, None)],
)
def test_happy_path_json_body_is_parsed_when_it_is_json(body: bytes, document: object, field: object) -> None:
    response = Response(200, {}, body)

    assert (response.json_document(), response.json_field("id")) == (document, field)


# --- transport ----------------------------------------------------------------------------------------


class FakeConnection:
    """Stands in for http.client.HTTPSConnection: records the exchange, answers one canned reply."""

    instances: ClassVar[list[FakeConnection]] = []

    def __init__(self, host: str, port: int | None, *, timeout: float, context: object) -> None:
        self.host, self.port, self.timeout, self.context = host, port, timeout, context
        self.sent: tuple[str, str, bytes | None, dict[str, str]] | None = None
        self.closed = False
        FakeConnection.instances.append(self)

    def request(self, method: str, target: str, *, body: bytes | None, headers: dict[str, str]) -> None:
        self.sent = (method, target, body, headers)

    def getresponse(self) -> FakeReply:
        return FakeReply()

    def close(self) -> None:
        self.closed = True


class FakeReply:
    status = 200

    def getheaders(self) -> list[tuple[str, str]]:
        return [("Content-Type", "text/css"), ("X-Cache", "HIT")]

    def read(self, limit: int) -> bytes:
        return b"body"[:limit]


def test_happy_path_https_fetch_sends_one_request(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeConnection.instances.clear()
    monkeypatch.setattr(http.client, "HTTPSConnection", FakeConnection)

    response = cihttp.https_fetch(Request("POST", "https://api.example.org:8443/a/b?x=1", b"{}", (("X-Probe", "1"),)))

    connection = FakeConnection.instances[0]
    assert response == Response(200, {"content-type": "text/css", "x-cache": "HIT"}, b"body")
    assert (connection.host, connection.port, connection.timeout, connection.closed) == ("api.example.org", 8443, 30.0, True)
    assert connection.sent == ("POST", "/a/b?x=1", b"{}", {"User-Agent": cihttp.USER_AGENT, "X-Probe": "1"})


def test_happy_path_bare_host_requests_the_root_path() -> None:
    assert cihttp.split_https("https://example.org") == ("example.org", None, "/")


@pytest.mark.parametrize("url", ["http://example.org/", "ftp://example.org/x", "https:///no-host"])
def test_bad_path_only_https_is_spoken(url: str) -> None:
    with pytest.raises(cihttp.TransportError, match="only https URLs are checked"):
        cihttp.https_fetch(Request("GET", url))
