"""The local page signs the owner in, and its guards (M7, docs/research/M7-local-worker.md §2).

The real worker's page server on a loopback port, driven over HTTP as a browser would (and as another site would try
to), against the fake server side of `tests/fakes/worker_api.py`; time is a controlled clock.
"""

import json
import re
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import httpx
import pytest
from hcm_pipeline import __version__
from hcm_pipeline.worker.args import Endpoints, WorkerArgs
from hcm_pipeline.worker.loop import Pass
from hcm_pipeline.worker.page import FIREBASE_SDK_VERSION
from hcm_pipeline.worker.session import REFRESH_MARGIN_SECONDS
from hcm_pipeline.worker.worker import Worker

from tests.fakes.documents import MemoryStore
from tests.fakes.http import FakeHttpServer
from tests.fakes.worker_api import OWNER_EMAIL, PROJECT, FakeWorkerApi
from tests.fakes.world import CITY, FakeClock

SETTINGS = re.compile(r'<script type="application/json" id="hcm-worker-settings">(.*?)</script>')


@dataclass
class Page:
    """The worker with its page served, and a client on the page's own origin."""

    worker: Worker
    api: FakeWorkerApi
    clock: FakeClock
    client: httpx.Client

    @property
    def origin(self) -> str:
        return f"http://127.0.0.1:{self.worker.server.port}"

    def csrf(self) -> str:
        found = SETTINGS.search(self.client.get("/").text)
        assert found is not None
        return str(json.loads(found.group(1))["csrf"])

    def post_session(self, body: object, **headers: str) -> httpx.Response:
        defaults = {"Origin": self.origin, "Content-Type": "application/json", "X-HCM-Worker": self.csrf()}
        return self.client.post("/session", content=json.dumps(body), headers={**defaults, **headers})

    def sign_in(self) -> tuple[str, str]:
        tokens = self.api.sign_in_tokens(self.clock() + 3600)
        assert self.post_session({"idToken": tokens[0], "refreshToken": tokens[1]}).status_code == 200
        return tokens

    def state(self) -> dict[str, object]:
        answer = self.client.get("/state").json()
        assert isinstance(answer, dict)
        return answer


@pytest.fixture
def page(tmp_path: Path) -> Iterator[Page]:
    clock = FakeClock()
    with FakeHttpServer() as server:
        api = FakeWorkerApi(MemoryStore(), server, clock).install()
        endpoints = Endpoints.emulated(PROJECT, api.env())
        args = WorkerArgs(city=CITY, project=PROJECT, port=0, work=tmp_path, emulators=True, endpoints=endpoints)
        worker = Worker.build(args, "127.0.0.1", clock)
        worker.server.start()
        try:
            with httpx.Client(base_url=f"http://127.0.0.1:{worker.server.port}") as client:
                yield Page(worker, api, clock, client)
        finally:
            worker.close()


def no_cors(response: httpx.Response) -> bool:
    return not any(name.lower().startswith("access-control-") for name in response.headers)


def test_happy_path_the_page_signs_the_owner_in_and_the_worker_starts_claiming(page: Page) -> None:
    """Scenarios: S-P04-HAPPY-SESSION"""
    home = page.client.get("/")
    assert home.status_code == 200
    assert "default-src 'none'" in home.headers["content-security-policy"]
    assert "frame-ancestors 'none'" in home.headers["content-security-policy"]
    assert (home.headers["x-content-type-options"], home.headers["referrer-policy"]) == ("nosniff", "no-referrer")
    script = page.client.get("/page.js").text
    assert f"https://www.gstatic.com/firebasejs/{FIREBASE_SDK_VERSION}" in script
    assert page.client.get("/config").json()["projectId"] == PROJECT

    id_token, _refresh = page.sign_in()

    hello = page.api.calls[-1]
    assert (hello.name, hello.token) == ("worker-hello", id_token)
    ai = {"state": "unavailable", "why": "old-starter"}
    assert hello.data == {"cityId": CITY, "workerId": page.worker.worker_id, "version": __version__, "ai": ai}
    state = page.state()
    assert (state["signedIn"], state["email"], state["state"], state["city"]) == (True, OWNER_EMAIL, "idle", CITY)
    assert "Token" not in json.dumps(state)

    # The worker claims with the token; five minutes before it expires, the next call refreshes it first.
    assert page.worker.loop.run_once() is Pass.IDLE
    assert (page.api.calls[-1].name, page.api.calls[-1].token, page.api.refreshes) == ("worker-claim", id_token, 0)
    page.clock.now += 3600 - REFRESH_MARGIN_SECONDS
    assert page.worker.loop.run_once() is Pass.IDLE
    claim = page.api.calls[-1]
    assert (claim.name, page.api.refreshes) == ("worker-claim", 1)
    assert claim.token != id_token
    assert claim.token in page.api.id_tokens


@pytest.mark.parametrize(
    "headers",
    [
        {"Origin": "https://attacker.example"},
        {"Origin": "null"},
        {"X-HCM-Worker": ""},
        {"X-HCM-Worker": "0" * 64},
        {"Content-Type": "application/x-www-form-urlencoded"},
        {"Content-Type": "text/plain"},
    ],
)
def test_bad_path_another_site_cannot_plant_a_session(page: Page, headers: dict[str, str]) -> None:
    """Scenarios: S-P04-BAD-FORGED-ORIGIN"""
    tokens = page.api.sign_in_tokens(page.clock() + 3600)

    answer = page.post_session({"idToken": tokens[0], "refreshToken": tokens[1]}, **headers)

    assert answer.status_code == 403
    assert no_cors(answer)
    assert page.api.calls == []
    assert page.state()["signedIn"] is False


@pytest.mark.parametrize("host", ["attacker.example:8765", "localhost:1", "127.0.0.1"])
def test_bad_path_a_rebinding_host_gets_421_everywhere(page: Page, host: str) -> None:
    """Scenarios: S-P04-BAD-FORGED-ORIGIN"""
    tokens = page.api.sign_in_tokens(page.clock() + 3600)
    csrf = page.csrf()

    answers = [
        page.client.get("/", headers={"Host": host}),
        page.client.get("/state", headers={"Host": host}),
        page.post_session({"idToken": tokens[0], "refreshToken": tokens[1]}, Host=host, **{"X-HCM-Worker": csrf}),
    ]

    assert [answer.status_code for answer in answers] == [421, 421, 421]
    assert page.api.calls == []


def test_bad_path_another_site_cannot_read_the_state_or_end_the_session(page: Page) -> None:
    """Scenarios: S-P04-BAD-FORGED-ORIGIN"""
    page.sign_in()

    own = page.client.get("/state")
    foreign = page.client.get("/state", headers={"Origin": "https://attacker.example"})
    preflight = page.client.options("/session", headers={"Origin": "https://attacker.example"})
    sign_out = page.client.request("DELETE", "/session", headers={"Origin": "https://attacker.example", "Content-Type": "application/json"})

    # A preflight is answered for the admin's Hosting origins only (finding 72's auto-pair): another site's is refused.
    assert (own.status_code, foreign.status_code, preflight.status_code, sign_out.status_code) == (200, 403, 403, 403)
    assert all(no_cors(answer) for answer in (own, foreign, preflight, sign_out))
    assert page.state()["signedIn"] is True


def test_bad_path_a_refused_refresh_ends_the_session_and_claiming_stops(page: Page) -> None:
    """Scenarios: S-P04-BAD-REFRESH-REFUSED"""
    page.sign_in()
    page.api.refresh_tokens.clear()
    page.clock.now += 3600

    assert page.worker.loop.run_once() is Pass.IDLE
    assert page.worker.loop.run_once() is Pass.NO_SESSION

    assert page.api.refreshes == 1
    assert "worker-claim" not in page.api.names()
    state = page.state()
    assert (state["signedIn"], state["state"], state["lastError"]) == (False, "signed-out", "signInAgain")
    assert page.worker.session.active is False


def test_happy_path_sign_out_forgets_the_session(page: Page) -> None:
    """Scenarios: S-P04-HAPPY-SESSION"""
    page.sign_in()

    answer = page.client.request(
        "DELETE", "/session", headers={"Origin": page.origin, "Content-Type": "application/json", "X-HCM-Worker": page.csrf()}
    )

    assert answer.status_code == 200
    assert (answer.json()["signedIn"], answer.json()["lastError"]) == (False, "signedOut")
    assert page.worker.loop.run_once() is Pass.NO_SESSION
