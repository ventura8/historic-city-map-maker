"""A fake USGS M2M API: real HTTP on 127.0.0.1:<random port>, scripted by the test.

Test credentials encode the scenario (docs/research/design-review-testability.md §3.1): login-token
with the application token `e2e-usgs-app-token-ok` (the shared fakes' approved user `e2e-ok`) returns a fresh API key
`fake-key-<n>`; any other token is
rejected the way USGS does it (HTTP 500 with errorCode AUTH_INVALID). Every other endpoint needs a
current key in X-Auth-Token, else it answers the HTML 403 page of the USGS front end; `logout`
revokes the key. `enqueue(endpoint, reply)` makes the next call to that endpoint answer `reply`
instead (the 503 maintenance page, a 429 with Retry-After, ...). Every request is recorded in
`calls`. POST /__reset forgets keys, queued replies, canned data and calls.

The server is a `wsgiref` (http.server) server in a daemon thread: `with FakeM2MServer() as fake:`.
"""

import json
import threading
from collections import deque
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from http import HTTPStatus
from types import TracebackType
from typing import Any, Self
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server
from wsgiref.types import StartResponse, WSGIEnvironment

API_ROOT = "/api/api/json/stable/"
POLL_SECONDS = 0.02
RESET_PATH = "/__reset"
GOOD_TOKEN = "e2e-usgs-app-token-ok"
FORBIDDEN_PAGE = "<html><head><title>403 Forbidden</title></head><body><h1>Forbidden</h1></body></html>"
MAINTENANCE_PAGE = (
    "<html><head><title>Application Offline</title></head>"
    "<body><h1>The application is offline for scheduled maintenance.</h1></body></html>"
)


@dataclass(frozen=True)
class Reply:
    """One scripted HTTP answer."""

    status: int = HTTPStatus.OK
    body: str = ""
    content_type: str = "application/json"
    headers: Mapping[str, str] = field(default_factory=dict)

    @classmethod
    def envelope(
        cls,
        data: object = None,
        error_code: str | None = None,
        status: int = HTTPStatus.OK,
        headers: Mapping[str, str] | None = None,
    ) -> Self:
        """The M2M JSON envelope (errors usually travel as HTTP 500 with an errorCode)."""
        message = None if error_code is None else f"fake {error_code}"
        payload = {"requestId": 1, "version": "stable", "data": data, "errorCode": error_code, "errorMessage": message}
        return cls(status, json.dumps(payload), headers=headers or {})

    @classmethod
    def page(cls, status: int, html: str, headers: Mapping[str, str] | None = None) -> Self:
        """An HTML page of the USGS front end (403 Forbidden, 503 Application Offline)."""
        return cls(status, html, "text/html; charset=utf-8", headers or {})


@dataclass(frozen=True)
class Call:
    """A request the fake received: the endpoint, the X-Auth-Token it carried and its JSON body."""

    endpoint: str
    api_key: str | None
    body: object


class _QuietHandler(WSGIRequestHandler):
    """No access log on stderr."""

    def log_message(self, format: str, *args: Any) -> None:
        return


def _json_or_none(raw: bytes) -> object:
    try:
        return json.loads(raw)
    except ValueError:
        return None


class FakeM2MServer:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._keys: set[str] = set()
        self._issued = 0
        self._queue: dict[str, deque[Reply]] = {}
        self._data: dict[str, object] = {}
        self._calls: list[Call] = []
        self._httpd: WSGIServer = make_server("127.0.0.1", 0, self._app, handler_class=_QuietHandler)
        self._thread = threading.Thread(target=self._serve, name="fake-usgs-m2m", daemon=True)

    def _serve(self) -> None:
        self._httpd.serve_forever(poll_interval=POLL_SECONDS)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self._httpd.server_port}{API_ROOT}"

    @property
    def root_url(self) -> str:
        return f"http://127.0.0.1:{self._httpd.server_port}"

    @property
    def calls(self) -> list[Call]:
        with self._lock:
            return list(self._calls)

    def endpoints(self) -> list[str]:
        return [call.endpoint for call in self.calls]

    def enqueue(self, endpoint: str, reply: Reply) -> None:
        with self._lock:
            self._queue.setdefault(endpoint, deque()).append(reply)

    def set_data(self, endpoint: str, data: object) -> None:
        """The `data` a successful call to `endpoint` returns (None by default)."""
        with self._lock:
            self._data[endpoint] = data

    def expire_keys(self) -> None:
        """Every issued API key stops working, as after USGS's 2-hour key lifetime."""
        with self._lock:
            self._keys.clear()

    def reset(self) -> None:
        with self._lock:
            self._keys.clear()
            self._queue.clear()
            self._data.clear()
            self._calls.clear()

    def __enter__(self) -> Self:
        self._thread.start()
        return self

    def __exit__(self, exc_type: type[BaseException] | None, exc: BaseException | None, tb: TracebackType | None) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()
        self._thread.join()

    def _app(self, environ: WSGIEnvironment, start_response: StartResponse) -> Iterable[bytes]:
        raw = environ["wsgi.input"].read(int(environ.get("CONTENT_LENGTH") or 0))
        reply = self.answer(str(environ["PATH_INFO"]), environ.get("HTTP_X_AUTH_TOKEN"), raw)
        body = reply.body.encode("utf-8")
        headers = [("Content-Type", reply.content_type), ("Content-Length", str(len(body))), *reply.headers.items()]
        start_response(f"{reply.status} {HTTPStatus(reply.status).phrase}", headers)
        return [body]

    def answer(self, path: str, api_key: str | None, raw: bytes) -> Reply:
        """The reply to one POST: a queued one first, else the scenario's."""
        if path == RESET_PATH:
            self.reset()
            return Reply.envelope()
        endpoint = path.removeprefix(API_ROOT)
        body = _json_or_none(raw)
        with self._lock:
            self._calls.append(Call(endpoint, api_key, body))
            queued = self._queue.get(endpoint)
            return queued.popleft() if queued else self._scenario(endpoint, api_key, body)

    def _scenario(self, endpoint: str, api_key: str | None, body: object) -> Reply:
        if endpoint == "login-token":
            return self._login(body)
        if api_key not in self._keys:
            return Reply.page(HTTPStatus.FORBIDDEN, FORBIDDEN_PAGE)
        if endpoint == "logout":
            self._keys.discard(str(api_key))
        return Reply.envelope(self._data.get(endpoint))

    def _login(self, body: object) -> Reply:
        if not isinstance(body, dict) or body.get("token") != GOOD_TOKEN:
            return Reply.envelope(error_code="AUTH_INVALID", status=HTTPStatus.INTERNAL_SERVER_ERROR)
        self._issued += 1
        key = f"fake-key-{self._issued}"
        self._keys.add(key)
        return Reply.envelope(key)
