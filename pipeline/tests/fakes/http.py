"""A scriptable HTTP server on 127.0.0.1:<random port> for the pipeline's other upstreams.

It stands in for the USGS delivery host, the STAC API (search and the Sentinel-2 COG, read by GDAL's `/vsicurl/`
with HEAD and Range requests), Overpass and Secret Manager. `route(method, path, handler)` answers a path with a
handler of the request; `serve(path, data)` serves bytes with HEAD and Range (206) like a static host;
`enqueue(path, reply)` makes the next request to `path` answer `reply` instead. Every request is recorded.
Threaded, because GDAL may open several connections.
"""

import threading
from collections import deque
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from http import HTTPStatus
from socketserver import ThreadingMixIn
from types import TracebackType
from typing import Any, Self
from urllib.parse import parse_qs
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server
from wsgiref.types import StartResponse, WSGIEnvironment

# How often a fake server checks for shutdown (short, so each test's fakes stop at once).
POLL_SECONDS = 0.02


@dataclass(frozen=True)
class Request:
    method: str
    path: str
    query: Mapping[str, str]
    headers: Mapping[str, str]
    body: bytes


@dataclass(frozen=True)
class Reply:
    status: int = HTTPStatus.OK
    body: bytes = b""
    content_type: str = "application/octet-stream"
    headers: Mapping[str, str] = field(default_factory=dict)

    @classmethod
    def json(cls, text: str, status: int = HTTPStatus.OK, headers: Mapping[str, str] | None = None) -> Self:
        return cls(status, text.encode("utf-8"), "application/json", headers or {})


Handler = Callable[[Request], Reply]


def byte_range(header: str | None, size: int) -> tuple[int, int] | None:
    """The (start, end inclusive) of a `Range: bytes=a-b` header, None without one."""
    if not header or not header.startswith("bytes="):
        return None
    start_text, _, end_text = header[len("bytes=") :].partition("-")
    start = int(start_text)
    end = int(end_text) if end_text else size - 1
    return start, min(end, size - 1)


def serve_bytes(data: bytes, ranges: bool = True, content_type: str = "image/tiff") -> Handler:
    """A static file: HEAD with its size, GET whole or (when `ranges`) a 206 slice."""

    def handler(request: Request) -> Reply:
        found = byte_range(request.headers.get("range"), len(data)) if ranges else None
        headers = {"Accept-Ranges": "bytes" if ranges else "none"}
        if request.method == "HEAD":
            return Reply(HTTPStatus.OK, b"", content_type, {**headers, "X-Size": str(len(data))})
        if found is None:
            return Reply(HTTPStatus.OK, data, content_type, headers)
        start, end = found
        return Reply(
            HTTPStatus.PARTIAL_CONTENT,
            data[start : end + 1],
            content_type,
            {**headers, "Content-Range": f"bytes {start}-{end}/{len(data)}"},
        )

    return handler


class _QuietHandler(WSGIRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        return


class _ThreadingServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True


def _headers(environ: WSGIEnvironment) -> dict[str, str]:
    found = {key[5:].replace("_", "-").lower(): str(value) for key, value in environ.items() if key.startswith("HTTP_")}
    if environ.get("CONTENT_TYPE"):
        found["content-type"] = str(environ["CONTENT_TYPE"])
    return found


class FakeHttpServer:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._routes: dict[tuple[str, str], Handler] = {}
        self._queue: dict[str, deque[Reply]] = {}
        self.requests: list[Request] = []
        self._httpd: WSGIServer = make_server("127.0.0.1", 0, self._app, server_class=_ThreadingServer, handler_class=_QuietHandler)
        self._thread = threading.Thread(target=self._serve, name="fake-http", daemon=True)

    def _serve(self) -> None:
        self._httpd.serve_forever(poll_interval=POLL_SECONDS)

    @property
    def root_url(self) -> str:
        return f"http://127.0.0.1:{self._httpd.server_port}"

    def url(self, path: str) -> str:
        return f"{self.root_url}{path}"

    def route(self, method: str, path: str, handler: Handler) -> None:
        with self._lock:
            self._routes[(method, path)] = handler

    def serve(self, path: str, data: bytes, ranges: bool = True, content_type: str = "image/tiff") -> None:
        handler = serve_bytes(data, ranges, content_type)
        self.route("GET", path, handler)
        self.route("HEAD", path, handler)

    def enqueue(self, path: str, reply: Reply) -> None:
        with self._lock:
            self._queue.setdefault(path, deque()).append(reply)

    def paths(self, method: str | None = None) -> list[str]:
        with self._lock:
            return [request.path for request in self.requests if method in (None, request.method)]

    def __enter__(self) -> Self:
        self._thread.start()
        return self

    def __exit__(self, kind: type[BaseException] | None, error: BaseException | None, trace: TracebackType | None) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()
        self._thread.join()

    def answer(self, request: Request) -> Reply:
        with self._lock:
            self.requests.append(request)
            queued = self._queue.get(request.path)
            if queued:
                return queued.popleft()
            handler = self._routes.get((request.method, request.path))
        return handler(request) if handler is not None else Reply(HTTPStatus.NOT_FOUND, b"not found", "text/plain")

    def _app(self, environ: WSGIEnvironment, start_response: StartResponse) -> Iterable[bytes]:
        body = environ["wsgi.input"].read(int(environ.get("CONTENT_LENGTH") or 0))
        query = {key: values[0] for key, values in parse_qs(str(environ.get("QUERY_STRING", ""))).items()}
        request = Request(str(environ["REQUEST_METHOD"]), str(environ["PATH_INFO"]), query, _headers(environ), body)
        reply = self.answer(request)
        size = reply.headers.get("X-Size", str(len(reply.body)))
        headers = [("Content-Type", reply.content_type), ("Content-Length", size)]
        headers += [(key, value) for key, value in reply.headers.items() if key != "X-Size"]
        start_response(f"{reply.status} {HTTPStatus(reply.status).phrase}", headers)
        return [reply.body]
