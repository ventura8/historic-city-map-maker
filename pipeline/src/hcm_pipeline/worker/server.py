"""The local page's server and its guards (docs/research/M7-local-worker.md §2.1, §2.3, §10.4).

A threading HTTP server (`wsgiref`'s, with `ThreadingMixIn`). Inside the container it listens on every interface, as
Docker's port publishing needs; the command publishes it on the computer's loopback only (`-p 127.0.0.1:8765:8765`).
Every answer carries the page's Content-Security-Policy, `X-Content-Type-Options: nosniff`, `Referrer-Policy:
no-referrer` and `Cache-Control: no-store`. Finding 72's auto-pair (2026-11-02, M7 §2.7): the admin, open on one of the
project's Hosting origins (`https://<project>.web.app`, `https://<project>.firebaseapp.com`, and since §210 the two of
the admin's own `<project>-admin` site; the e2e admin server under the emulators), reads `GET /state` and posts its
one-time code to `POST /pair`; those two paths, and only for those origins, answer CORS (`Access-Control-Allow-Origin:
<origin>`, `Vary: Origin`) and Private Network Access's preflight (`Access-Control-Allow-Private-Network: true`). Any
other origin gets no CORS header at all.

| Request | Answer |
| --- | --- |
| any, `Host` not `localhost:<port>` or `127.0.0.1:<port>` (a DNS-rebinding name) | 421 |
| `GET /`, `/page.js`, `/page.css` | the page and its files |
| `GET /config` | the project's web configuration (503 while it cannot be read) |
| `GET /state` | the worker's state; 403 with another `Origin` |
| `POST /session` `{idToken, refreshToken}` | sign in: `worker.hello` must accept the token first (403 with its code) |
| `DELETE /session` | sign out |
| `OPTIONS /state`, `OPTIONS /pair` from a Hosting origin | 204, the CORS preflight (403 from any other origin) |
| `POST /pair` `{code}` from a Hosting origin | 202 and the state: the worker pairs with the code at its loop's next pass |
| `POST /profile` `{profile, batteryAllowed?}` from a Hosting origin | 200 and the state; 400 for a profile not `auto`, `quiet`, `full` |
| `POST /pause` `{action, until?}` from a Hosting origin, or the page with its token | 200 and the state; 400 for another body |
| `GET /import`, `POST /import/...` | M20's import of a local archive (`imports.py`, docs/research/M20-import-local.md §2.1) |
| `POST /import/session` `{city}` from a Hosting origin | 201 `{token}` while signed in for that city, else 409 |
| `OPTIONS /import/...` from a Hosting origin | 204, the preflight of the admin's own import (batch 4) |
| anything else | 404, or 405 for another method |

`POST /pause` is Pause this computer (`pausing.py`): `{action: 'pause', until?}` or `{action: 'resume'}`; 400 for an `until`
that is not an ISO time with its zone, is past, or is more than 48 h ahead.

`POST` and `DELETE` answer 403 unless `Origin` is the page's, the body is JSON (`Content-Type: application/json`, which a
cross-site form cannot send without a preflight nobody answers) and `X-HCM-Worker` is the CSRF token (32 random bytes,
per process, written only into the page). `POST /pair` has no CSRF token (the admin's page cannot know it): its guard is
the Origin allow-list (a page of another site cannot send one of the project's origins, and its JSON body needs a
preflight only those origins pass) and the code itself, single-use and minted by a city editor minutes before.

Batch 4 (the owner, 2026-11-09: no new tab): the admin's Import local files sends the import's requests itself, from a Hosting origin.
It first asks `POST /import/session` for a token, which the worker gives only while it is paired and signed in for the city the admin
names (the Hosting origins are the project's own; 32 random bytes, for this process). Every import request then carries it as
`X-HCM-Session` in place of the page's CSRF header, and CORS and Private Network Access answer those paths for the Hosting origins only.
"""

import hmac
import json
import secrets
import threading
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from http import HTTPStatus
from socketserver import ThreadingMixIn
from typing import Any, BinaryIO, Final, Protocol
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server
from wsgiref.types import StartResponse, WSGIEnvironment

from hcm_pipeline.log import get_logger
from hcm_pipeline.worker.import_page import render_import_page
from hcm_pipeline.worker.imports import IMPORT_STATIC, ImportRoutes
from hcm_pipeline.worker.page import PAGE_CSS, PAGE_JS, PageSettings, render_page

LOG = get_logger("worker.server")
CSRF_HEADER: Final = "x-hcm-worker"
LOOPBACK_NAMES: Final = ("localhost", "127.0.0.1")
MAX_BODY_BYTES: Final = 16 * 1024
JSON_TYPE: Final = "application/json"
POLL_SECONDS: Final = 0.2
# The paths the admin reads and posts to from its Hosting origin (auto-pair), and the preflight's fixed answers.
CORS_PATHS: Final = ("/state", "/pair", "/profile", "/pause")
SESSION_HEADER: Final = "x-hcm-session"
PREFLIGHT_HEADERS: Final = (
    ("Access-Control-Allow-Methods", "GET, POST"),
    ("Access-Control-Allow-Headers", "content-type, x-hcm-path, x-hcm-session"),
    ("Access-Control-Max-Age", "600"),
)
_STATIC: Final = {
    "/page.js": (PAGE_JS.encode("utf-8"), "text/javascript; charset=utf-8"),
    "/page.css": (PAGE_CSS.encode("utf-8"), "text/css; charset=utf-8"),
    **IMPORT_STATIC,
}
IMPORT_PREFIX: Final = "/import/"
UPLOAD_SUFFIX: Final = "/file"


class WorkerApp(Protocol):
    """What the page's requests do (`app.py`)."""

    def web_config(self) -> Mapping[str, str] | None: ...

    def state(self) -> Mapping[str, object]: ...

    def sign_in(self, id_token: object, refresh_token: object) -> str | None: ...

    def sign_out(self) -> None: ...

    def pair(self, code: object) -> str | None: ...

    def profile(self, chosen: object, battery_allowed: object) -> bool: ...

    def pause(self, body: Mapping[str, object]) -> bool: ...

    def remove(self) -> str | None: ...


Reply = tuple[int, bytes, str]


@dataclass(frozen=True)
class Request:
    """One request to the page: its method, path, headers (lower-case names) and body (None when it is too large)."""

    method: str
    path: str
    headers: Mapping[str, str]
    body: bytes | None


def _json(status: int, value: object) -> Reply:
    return status, json.dumps(value).encode("utf-8"), JSON_TYPE


def _headers(environ: WSGIEnvironment) -> dict[str, str]:
    found = {key[5:].replace("_", "-").lower(): str(value) for key, value in environ.items() if key.startswith("HTTP_")}
    return {**found, "content-type": str(environ.get("CONTENT_TYPE") or "")}


def _length(environ: WSGIEnvironment) -> int:
    try:
        return int(environ.get("CONTENT_LENGTH") or 0)
    except ValueError:
        return -1


def _body(environ: WSGIEnvironment) -> bytes | None:
    size = _length(environ)
    return environ["wsgi.input"].read(size) if 0 <= size <= MAX_BODY_BYTES else None


def _upload_of(method: str, path: str) -> str | None:
    """The archive id of `POST /import/<id>/file` (a streamed body), else None."""
    if method != "POST" or not (path.startswith(IMPORT_PREFIX) and path.endswith(UPLOAD_SUFFIX)):
        return None
    return path.removeprefix(IMPORT_PREFIX).removesuffix(UPLOAD_SUFFIX)


class _QuietHandler(WSGIRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        LOG.debug("local page: %s", format % args)


class _ThreadingServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True


class LocalServer:
    """The page's server; `start` serves in a daemon thread, `stop` ends it."""

    def __init__(
        self,
        app: WorkerApp,
        settings: PageSettings,
        bind: tuple[str, int],
        content_security_policy: str,
        cors_origins: Iterable[str] = (),
    ) -> None:
        self._app = app
        self._imports: ImportRoutes | None = None
        # What a look from the admin's page does besides its answer (`Worker.build`: the claims are frequent again).
        self.on_admin: Callable[[], None] = lambda: None
        self._settings = settings
        self._cors_origins = frozenset(cors_origins)
        self._sessions: set[str] = set()
        self._httpd = make_server(bind[0], bind[1], self._wsgi, server_class=_ThreadingServer, handler_class=_QuietHandler)
        self._thread = threading.Thread(target=self._httpd.serve_forever, kwargs={"poll_interval": POLL_SECONDS}, daemon=True)
        self.headers: Mapping[str, str] = {
            "Content-Security-Policy": content_security_policy,
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "Cache-Control": "no-store",
        }

    def _wsgi(self, environ: WSGIEnvironment, start_response: StartResponse) -> Iterable[bytes]:
        method, path = str(environ["REQUEST_METHOD"]), str(environ.get("PATH_INFO") or "/")
        upload = _upload_of(method, path)
        if upload is not None:
            request = Request(method, path, _headers(environ), b"")
            status, body, content_type = self.upload(request, upload, environ["wsgi.input"], _length(environ))
        else:
            request = Request(method, path, _headers(environ), _body(environ))
            status, body, content_type = self.answer(request)
        headers = [*self.headers.items(), *self.cors_headers(request), ("Content-Type", content_type), ("Content-Length", str(len(body)))]
        start_response(f"{status} {HTTPStatus(status).phrase}", headers)
        return [body]

    def answer(self, request: Request) -> Reply:
        """The reply to a request, every guard applied."""
        if not self.host_allowed(request.headers.get("host")):
            return _json(HTTPStatus.MISDIRECTED_REQUEST, {})
        route = {"GET": self.get, "POST": self.post, "DELETE": self.delete, "OPTIONS": self.preflight}.get(request.method)
        return route(request) if route is not None else _json(HTTPStatus.METHOD_NOT_ALLOWED, {})

    def serve_imports(self, imports: ImportRoutes) -> None:
        """M20: the import routes (`imports.py`); without them every import path answers 403 or 404."""
        self._imports = imports

    @staticmethod
    def new_csrf_token() -> str:
        """32 random bytes, as hex: the page's token for its state-changing requests."""
        return secrets.token_hex(32)

    @property
    def port(self) -> int:
        return int(self._httpd.server_address[1])

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        """Ends the serving thread (when it was started) and closes the socket."""
        if self._thread.is_alive():
            self._httpd.shutdown()
            self._thread.join()
        self._httpd.server_close()

    # --- guards ----------------------------------------------------------------------------------------------

    def host_allowed(self, host: str | None) -> bool:
        return host in {f"{name}:{self.port}" for name in LOOPBACK_NAMES}

    def _origin_allowed(self, origin: str | None) -> bool:
        return origin in {f"http://{name}:{self.port}" for name in LOOPBACK_NAMES}

    def cors_allowed(self, origin: str | None) -> bool:
        """One of the project's Hosting origins, where the admin runs (auto-pair)."""
        return origin in self._cors_origins

    def cors_headers(self, request: Request) -> list[tuple[str, str]]:
        """CORS for a Hosting origin (with the preflight's answers on `OPTIONS`); nothing for any other origin."""
        origin = request.headers.get("origin")
        if origin is None or not self.cors_allowed(origin):
            return []
        found = [("Access-Control-Allow-Origin", origin), ("Vary", "Origin")]
        if request.method == "OPTIONS":
            found.extend(PREFLIGHT_HEADERS)
        if request.headers.get("access-control-request-private-network") == "true":
            found.append(("Access-Control-Allow-Private-Network", "true"))
        return found

    @staticmethod
    def _json_body(request: Request) -> bool:
        return request.headers.get("content-type", "").split(";", 1)[0].strip().lower() == JSON_TYPE

    def _state_change_allowed(self, request: Request) -> bool:
        token = request.headers.get(CSRF_HEADER, "")
        same_origin = self._origin_allowed(request.headers.get("origin"))
        return same_origin and self._json_body(request) and hmac.compare_digest(token.encode("utf-8"), self._settings.csrf.encode("utf-8"))

    def _pair_allowed(self, request: Request) -> bool:
        """`POST /pair`: a Hosting origin and a JSON body (which needs the preflight only those origins pass)."""
        return self.cors_allowed(request.headers.get("origin")) and self._json_body(request)

    # --- routes ----------------------------------------------------------------------------------------------

    def get(self, request: Request) -> Reply:
        path = request.path
        routes: dict[str, Callable[[Request], Reply]] = {
            "/": self._page,
            "/config": self._config,
            "/state": self._state,
            "/import": self._import_page,
        }
        if path in _STATIC:
            return HTTPStatus.OK, *_STATIC[path]
        route = routes.get(path)
        if route is not None:
            return route(request)
        found = self._imports.get(path) if self._imports is not None else None
        return found if found is not None else _json(HTTPStatus.NOT_FOUND, {})

    def _import_page(self, _request: Request) -> Reply:
        return HTTPStatus.OK, render_import_page(self._settings.json()), "text/html; charset=utf-8"

    # --- M20's import (imports.py) ------------------------------------------------------------------------------

    def _import_allowed(self, request: Request) -> bool:
        """The page's origin and its CSRF token (a file's body is not JSON: the type is not asked of an upload), or the admin's session."""
        token = request.headers.get(CSRF_HEADER, "").encode("utf-8")
        own = self._origin_allowed(request.headers.get("origin")) and hmac.compare_digest(token, self._settings.csrf.encode("utf-8"))
        return own or self._session_allowed(request)

    def _session_allowed(self, request: Request) -> bool:
        """Batch 4: a Hosting origin with a token `POST /import/session` gave (compared in constant time)."""
        token = request.headers.get(SESSION_HEADER, "").encode("utf-8")
        known = any(hmac.compare_digest(token, each.encode("utf-8")) for each in self._sessions)
        return self.cors_allowed(request.headers.get("origin")) and known

    def _import_session(self, request: Request) -> Reply:
        """A token for the admin's import, while this worker is signed in for the city it names."""
        if not self._pair_allowed(request) or request.body is None:
            return _json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        body, state = _parsed(request.body), self._app.state()
        # The Hosting origins are the project's own, so the city is what is left to match.
        paired = state.get("signedIn") is True and state.get("city") == body.get("city")
        if not paired:
            return _json(HTTPStatus.CONFLICT, {"error": "notPaired"})
        token = secrets.token_hex(32)
        self._sessions.add(token)
        return _json(HTTPStatus.CREATED, {"token": token})

    def upload(self, request: Request, archive_id: str, stream: BinaryIO, length: int) -> Reply:
        """`POST /import/<id>/file`: the body streamed into the archive, every guard first."""
        if not self.host_allowed(request.headers.get("host")):
            return _json(HTTPStatus.MISDIRECTED_REQUEST, {})
        if self._imports is None or not self._import_allowed(request) or length < 0:
            return _json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return self._imports.upload(archive_id, request.headers, stream, length)

    def _import_post_allowed(self, request: Request) -> bool:
        """The page's origin, JSON and token, or (batch 4) JSON from a Hosting origin with the admin's session."""
        return self._state_change_allowed(request) or (self._json_body(request) and self._session_allowed(request))

    def _import_post(self, request: Request) -> Reply:
        """`POST /import/new`, `<id>/zip`, `<id>/scan`, `<id>/cancel`: JSON, the page's origin and token, or the admin's session."""
        if request.path == "/import/session":
            return self._import_session(request)
        if self._imports is None or not self._import_post_allowed(request):
            return _json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        if request.body is None:
            return _json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {})
        return _import_route(self._imports, request.path.removeprefix(IMPORT_PREFIX), _parsed(request.body))

    def _page(self, _request: Request) -> Reply:
        return HTTPStatus.OK, render_page(self._settings), "text/html; charset=utf-8"

    def _config(self, _request: Request) -> Reply:
        config = self._app.web_config()
        return _json(HTTPStatus.OK, config) if config is not None else _json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "configMissing"})

    def _state(self, request: Request) -> Reply:
        origin = request.headers.get("origin")
        if origin is not None and not (self._origin_allowed(origin) or self.cors_allowed(origin)):
            return _json(HTTPStatus.FORBIDDEN, {})
        if self.cors_allowed(origin):
            # The admin's page is open and looks at this worker: it may start a job, so the worker asks often again (`pace.py`).
            self.on_admin()
        return _json(HTTPStatus.OK, self._app.state())

    def preflight(self, request: Request) -> Reply:
        """The CORS (and Private Network Access) preflight of the admin's `GET /state`, `POST /pair` and (batch 4) its import."""
        cors_path = request.path in CORS_PATHS or request.path.startswith(IMPORT_PREFIX)
        allowed = cors_path and self.cors_allowed(request.headers.get("origin"))
        return (HTTPStatus.NO_CONTENT, b"", "text/plain") if allowed else _json(HTTPStatus.FORBIDDEN, {})

    def _guarded(self, request: Request, action: Callable[[Mapping[str, object]], Reply], path: str = "/session") -> Reply:
        if request.path != path:
            return _json(HTTPStatus.NOT_FOUND, {})
        if not self._state_change_allowed(request):
            return _json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        body = request.body
        return action(_parsed(body)) if body is not None else _json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {})

    def post(self, request: Request) -> Reply:
        if request.path.startswith(IMPORT_PREFIX):
            return self._import_post(request)
        routed = self._routes().get(request.path)
        return routed(request) if routed is not None else self._guarded(request, self._sign_in)

    def _routes(self) -> dict[str, Callable[[Request], Reply]]:
        """The POST paths with their own handler (the rest is the page's sign-in)."""
        return {
            "/profile": self._profile,
            "/pause": self._pause,
            "/remove": lambda request: self._guarded(request, self._remove, "/remove"),
            "/pair": self._pair,
        }

    def _profile(self, request: Request) -> Reply:
        """M26: the owner's profile from the admin's card, under `/pair`'s rules (a Hosting origin, JSON); kept on this computer."""
        if not self._pair_allowed(request) or request.body is None:
            return _json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        body = _parsed(request.body)
        if not self._app.profile(body.get("profile"), body.get("batteryAllowed")):
            return _json(HTTPStatus.BAD_REQUEST, {"error": "invalidRequest"})
        return _json(HTTPStatus.OK, self._app.state())

    def _pause(self, request: Request) -> Reply:
        """Pause this computer, or resume it: from the admin (a Hosting origin, JSON) or the page itself (its origin, JSON, its token)."""
        allowed = self._pair_allowed(request) or self._state_change_allowed(request)
        if not allowed or request.body is None:
            return _json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        if not self._app.pause(_parsed(request.body)):
            return _json(HTTPStatus.BAD_REQUEST, {"error": "invalidRequest"})
        return _json(HTTPStatus.OK, self._app.state())

    def _pair(self, request: Request) -> Reply:
        """The admin's one-time code (auto-pair): taken at the loop's next pass; 409 with why when it is not taken."""
        if not self._pair_allowed(request):
            return _json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        body = request.body
        if body is None:
            return _json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {})
        refused = self._app.pair(_parsed(body).get("code"))
        return _json(HTTPStatus.CONFLICT, {"error": refused}) if refused else _json(HTTPStatus.ACCEPTED, self._app.state())

    def delete(self, request: Request) -> Reply:
        return self._guarded(request, self._sign_out)

    def _sign_in(self, body: Mapping[str, object]) -> Reply:
        refused = self._app.sign_in(body.get("idToken"), body.get("refreshToken"))
        return _json(HTTPStatus.FORBIDDEN, {"error": refused}) if refused else _json(HTTPStatus.OK, self._app.state())

    def _remove(self, _body: Mapping[str, object]) -> Reply:
        """W5: the page's Stop using this computer (the page's own token): the starter cleans the computer up; 409 with why not."""
        refused = self._app.remove()
        return _json(HTTPStatus.CONFLICT, {"error": refused}) if refused else _json(HTTPStatus.ACCEPTED, self._app.state())

    def _sign_out(self, _body: Mapping[str, object]) -> Reply:
        self._app.sign_out()
        return _json(HTTPStatus.OK, self._app.state())


def _import_route(imports: ImportRoutes, rest: str, body: Mapping[str, object]) -> Reply:
    """`new`, `<id>/zip` or `<id>/scan`; 404 for anything else."""
    if rest == "new":
        return imports.new()
    archive_id, _, action = rest.partition("/")
    routes = {"zip": imports.unzip, "scan": imports.scan, "cancel": imports.cancel}
    route = routes.get(action)
    return route(archive_id, body) if route is not None else _json(HTTPStatus.NOT_FOUND, {})


def _parsed(body: bytes) -> Mapping[str, object]:
    try:
        value = json.loads(body or b"{}")
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}
