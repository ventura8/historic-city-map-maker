"""A fake Cloud Storage JSON API on 127.0.0.1:<random port>: the part `GcsObjectStore` speaks.

Objects metadata (`GET /storage/v1/b/{bucket}/o/{name}`), media (`?alt=media`), listing with a prefix and pages,
deletes, and resumable uploads (`POST /upload/storage/v1/b/{bucket}/o?uploadType=resumable`, then `PUT` of chunks
with `Content-Range`, `308` with the `Range` held, the object created when the last byte arrives; `ifGenerationMatch=0`
answers 412 when the object exists). `expire_sessions()` makes every open session answer 410; `on_chunk` is called
with each chunk's object name and offset (a test raises SIGTERM there); every request is counted in `requests`.
"""

import base64
import hashlib
import itertools
import json
import threading
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from http import HTTPStatus
from types import TracebackType
from typing import Any, Self
from urllib.parse import parse_qs
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server
from wsgiref.types import StartResponse, WSGIEnvironment

from tests.fakes.http import POLL_SECONDS, _ThreadingServer

RESUME_INCOMPLETE = 308
PAGE_SIZE = 2


@dataclass
class StoredObject:
    data: bytes
    generation: int

    def metadata(self, name: str) -> dict[str, str]:
        md5 = base64.b64encode(hashlib.md5(self.data, usedforsecurity=False).digest()).decode("ascii")
        return {"name": name, "size": str(len(self.data)), "generation": str(self.generation), "md5Hash": md5}


@dataclass
class Session:
    name: str
    data: bytearray
    create_only: bool
    expired: bool = False
    finished: bool = False


@dataclass(frozen=True)
class Call:
    method: str
    path: str
    query: dict[str, str]
    content_range: str
    body: bytes


@dataclass(frozen=True)
class Answer:
    status: int
    body: bytes = b""
    headers: tuple[tuple[str, str], ...] = ()


class _QuietHandler(WSGIRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        return


def _json(status: int, value: object, *headers: tuple[str, str]) -> Answer:
    return Answer(status, json.dumps(value).encode("utf-8"), (("Content-Type", "application/json"), *headers))


class FakeGcsServer:
    def __init__(self, bucket: str) -> None:
        self.bucket = bucket
        self.objects: dict[str, StoredObject] = {}
        self.sessions: dict[str, Session] = {}
        self.requests: list[tuple[str, str]] = []
        self.on_chunk: Callable[[str, int], None] | None = None
        self._generations = itertools.count(1_792_000_000_000_001)
        self._lock = threading.RLock()
        self._httpd: WSGIServer = make_server("127.0.0.1", 0, self._app, server_class=_ThreadingServer, handler_class=_QuietHandler)
        self._thread = threading.Thread(target=self._serve, name="fake-gcs", daemon=True)

    def _serve(self) -> None:
        self._httpd.serve_forever(poll_interval=POLL_SECONDS)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self._httpd.server_port}"

    def __enter__(self) -> Self:
        self._thread.start()
        return self

    def __exit__(self, kind: type[BaseException] | None, error: BaseException | None, trace: TracebackType | None) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()
        self._thread.join()

    def put(self, name: str, data: bytes) -> None:
        with self._lock:
            self.objects[name] = StoredObject(data, next(self._generations))

    def names(self, prefix: str = "") -> list[str]:
        with self._lock:
            return sorted(name for name in self.objects if name.startswith(prefix))

    def expire_sessions(self) -> None:
        with self._lock:
            for session in self.sessions.values():
                session.expired = True

    # --- the API -------------------------------------------------------------------------------------

    def _app(self, environ: WSGIEnvironment, start_response: StartResponse) -> Iterable[bytes]:
        method, path = str(environ["REQUEST_METHOD"]), str(environ["PATH_INFO"])
        query = {key: values[0] for key, values in parse_qs(str(environ.get("QUERY_STRING", ""))).items()}
        body = environ["wsgi.input"].read(int(environ.get("CONTENT_LENGTH") or 0))
        with self._lock:
            self.requests.append((method, path))
            answer = self._answer(Call(method, path, query, str(environ.get("HTTP_CONTENT_RANGE") or "bytes */*"), body))
        start_response(f"{answer.status} {HTTPStatus(answer.status).phrase}", list(answer.headers))
        return [answer.body]

    def _route(self, call: Call) -> Callable[[Call], Answer]:
        objects_root = f"/storage/v1/b/{self.bucket}/o"
        routes: list[tuple[bool, Callable[[Call], Answer]]] = [
            (call.path.startswith("/upload/session/"), self._chunk),
            (call.path == f"/upload/storage/v1/b/{self.bucket}/o", self._start),
            (call.path == objects_root, self._list),
            (call.path.startswith(objects_root + "/"), self._object),
        ]
        return next((handler for matches, handler in routes if matches), lambda _call: Answer(HTTPStatus.NOT_FOUND))

    def _answer(self, call: Call) -> Answer:
        return self._route(call)(call)

    def _object(self, call: Call) -> Answer:
        name = call.path.split("/o/", 1)[1]
        stored = self.objects.get(name)
        if stored is None:
            return Answer(HTTPStatus.NOT_FOUND)
        if call.method == "DELETE":
            del self.objects[name]
            return Answer(HTTPStatus.NO_CONTENT)
        if call.query.get("alt") == "media":
            return Answer(HTTPStatus.OK, stored.data, (("x-goog-generation", str(stored.generation)),))
        return _json(HTTPStatus.OK, stored.metadata(name))

    def _list(self, call: Call) -> Answer:
        names = sorted(name for name in self.objects if name.startswith(call.query.get("prefix", "")))
        start = int(call.query.get("pageToken", "0"))
        listing: dict[str, object] = {"items": [self.objects[name].metadata(name) for name in names[start : start + PAGE_SIZE]]}
        more = start + PAGE_SIZE < len(names)
        return _json(HTTPStatus.OK, {**listing, **({"nextPageToken": str(start + PAGE_SIZE)} if more else {})})

    def _start(self, call: Call) -> Answer:
        name = call.query["name"]
        create_only = call.query.get("ifGenerationMatch") == "0"
        if create_only and name in self.objects:
            return Answer(HTTPStatus.PRECONDITION_FAILED)
        session = f"s{len(self.sessions) + 1}"
        self.sessions[session] = Session(name, bytearray(), create_only)
        return Answer(HTTPStatus.OK, b"", (("Location", f"{self.base_url}/upload/session/{session}?upload_id=secret-{session}"),))

    def _open(self, call: Call) -> Session | Answer:
        session = self.sessions.get(call.path.rsplit("/", 1)[1])
        if session is None:
            return Answer(HTTPStatus.NOT_FOUND)
        return Answer(HTTPStatus.GONE) if session.expired else session

    def _chunk(self, call: Call) -> Answer:
        session = self._open(call)
        if isinstance(session, Answer):
            return session
        span, _, total = call.content_range[len("bytes ") :].partition("/")
        return self._append(session, span, call.body) or self._session_state(session, None if total == "*" else int(total))

    def _append(self, session: Session, span: str, body: bytes) -> Answer | None:
        """Adds a chunk (None when it fits), or the 400 of a chunk that does not start where the session ends."""
        if span == "*":
            return None
        start = int(span.split("-", maxsplit=1)[0])
        if start != len(session.data):
            return Answer(HTTPStatus.BAD_REQUEST)
        if self.on_chunk is not None:
            self.on_chunk(session.name, start)
        session.data += body
        return None

    def _session_state(self, session: Session, total: int | None) -> Answer:
        if session.finished:
            return _json(HTTPStatus.OK, self.objects[session.name].metadata(session.name))
        if total is None or len(session.data) < total:
            return Answer(RESUME_INCOMPLETE, b"", (("Range", f"bytes=0-{len(session.data) - 1}"),) if session.data else ())
        return self._finalize(session)

    def _finalize(self, session: Session) -> Answer:
        if session.create_only and session.name in self.objects:
            return Answer(HTTPStatus.PRECONDITION_FAILED)
        self.objects[session.name] = StoredObject(bytes(session.data), next(self._generations))
        session.finished = True
        return _json(HTTPStatus.OK, self.objects[session.name].metadata(session.name))
