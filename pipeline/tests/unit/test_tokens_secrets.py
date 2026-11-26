"""Tokens for the Google APIs and the USGS credentials from Secret Manager (never logged, never another secret)."""

import base64
import json
from collections.abc import Iterator
from dataclasses import dataclass

import google.auth
import httpx
import pytest
from hcm_pipeline.secrets import (
    EmulatorSecrets,
    SecretManager,
    SecretUnavailableError,
    usgs_credentials,
)
from hcm_pipeline.tokens import GoogleTokens, _default_credentials

from tests.fakes.http import FakeHttpServer, Reply, Request

SECRET_PATH = "/v1/projects/demo-hcm/secrets/usgs-app-token/versions/latest:access"


@dataclass
class FakeCredentials:
    token: str | None = None
    valid: bool = False
    refreshed: int = 0

    def refresh(self, _request: object) -> None:
        self.refreshed += 1
        self.token, self.valid = f"ya29.test-{self.refreshed}", True


class StaticTokens:
    def token(self) -> str:
        return "ya29.static"


def test_happy_path_default_credentials_are_loaded_once_and_refreshed_when_stale() -> None:
    credentials = FakeCredentials()
    loads: list[int] = []

    def load() -> FakeCredentials:
        loads.append(1)
        return credentials

    tokens = GoogleTokens(load, lambda: "request")

    assert tokens.token() == "ya29.test-1"
    assert tokens.token() == "ya29.test-1"
    credentials.valid = False
    assert tokens.token() == "ya29.test-2"
    assert len(loads) == 1


def test_bad_path_credentials_without_a_token_fail() -> None:
    class Empty(FakeCredentials):
        def refresh(self, _request: object) -> None:
            self.valid = True

    with pytest.raises(RuntimeError, match="no access token"):
        GoogleTokens(Empty, lambda: None).token()


@pytest.fixture
def secret_server() -> Iterator[FakeHttpServer]:
    with FakeHttpServer() as server:
        yield server


def manager(server: FakeHttpServer, client: httpx.Client) -> SecretManager:
    return SecretManager(client, "demo-hcm", StaticTokens(), server.url("/v1/"))


def payload(text: str) -> Reply:
    return Reply.json(json.dumps({"name": "x", "payload": {"data": base64.b64encode(text.encode()).decode()}}))


def test_happy_path_secret_manager_reads_the_latest_version_with_the_jobs_token(secret_server: FakeHttpServer) -> None:
    seen: list[Request] = []

    def answer(request: Request) -> Reply:
        seen.append(request)
        return payload("e2e-ok\n")

    secret_server.route("GET", SECRET_PATH, answer)
    with httpx.Client() as client:
        assert manager(secret_server, client).read("usgs-app-token") == "e2e-ok"

    assert seen[0].headers["authorization"] == "Bearer ya29.static"


@pytest.mark.parametrize(
    ("reply", "problem"),
    [
        (Reply(403, b"denied"), "HTTP 403"),
        (payload("   "), "is empty"),
        (Reply.json('{"payload": {"data": "%%%"}}'), "no readable value"),
        (Reply.json("{}"), "no readable value"),
    ],
)
def test_bad_path_an_unreadable_secret_is_unavailable(secret_server: FakeHttpServer, reply: Reply, problem: str) -> None:
    secret_server.route("GET", SECRET_PATH, lambda _request: reply)
    with httpx.Client() as client, pytest.raises(SecretUnavailableError, match=problem):
        manager(secret_server, client).read("usgs-app-token")


def test_bad_path_an_unreachable_secret_manager_is_unavailable() -> None:
    with httpx.Client() as client:
        unreachable = SecretManager(client, "demo-hcm", StaticTokens(), "http://127.0.0.1:9/v1")
        with pytest.raises(SecretUnavailableError, match="unreachable"):
            unreachable.read("usgs-username")


def test_bad_path_the_pipeline_reads_no_other_secret() -> None:
    with httpx.Client() as client, pytest.raises(SecretUnavailableError, match="no secret called mapbox-sk-tiles"):
        SecretManager(client, "demo-hcm", StaticTokens()).read("mapbox-sk-tiles")
    with pytest.raises(SecretUnavailableError):
        EmulatorSecrets("e2e-ok").read("mapbox-sk-tiles")


def test_happy_path_the_emulated_credentials_are_the_scenario_values() -> None:
    credentials = usgs_credentials(EmulatorSecrets("e2e-m2m-pending"))

    assert (credentials.username, credentials.token) == ("e2e-m2m-pending", "e2e-usgs-app-token-pending")
    approved = usgs_credentials(EmulatorSecrets("e2e-ok"))
    assert (approved.username, approved.token) == ("e2e-ok", "e2e-usgs-app-token-ok")
    assert "e2e-usgs-app-token-pending" not in repr(credentials)


def test_happy_path_default_credentials_come_from_google_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(google.auth, "default", lambda scopes: (("credentials", scopes), "demo-hcm"))

    found: object = _default_credentials()
    assert found == ("credentials", ["https://www.googleapis.com/auth/cloud-platform"])
