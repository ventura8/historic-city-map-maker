"""`ObjectStore` over `worker.urls`' signed URLs: the version's files and the job's inputs (M7 §1.3, §2.4, §2.5).

Each operation asks the server for one V4 signed URL of the object (15 minutes, a PUT bound to its content type), with
the object's metadata when it exists: `stat` reads that metadata; `upload_file` keeps an identical object (same MD5),
else sends the file, streamed, with the method and headers the server gave (`PUT` on Cloud Storage; the emulators'
stand-in may answer another), and takes the generation from `x-goog-generation` or the answer's JSON; `download_file`
and `open_read` stream a GET (a download the network fails is an `ObjectStoreError` and leaves no partial file).
A PUT a power cut or the network stops is never half an object (Cloud Storage commits an upload whole or not at all), so
an interrupted upload restarts clean at the step's next run (RESILIENCE-AUDIT P0-4); one whose `x-goog-hash` names another MD5
than the file's arrived damaged and is sent once more, then refused, so the step is never recorded done on a bad object.
Listing, deleting and resumable sessions are refused: no step needs them for these objects (the delivery and the
scratch are local, `local_store.py`). Every signed address passes the address guard of the client the worker builds
(https and public, or this machine's under `--emulators`) and is never logged.
"""

import io
from collections.abc import Iterator, Mapping
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import IO, Final, NoReturn

import httpx

from hcm_pipeline.objects import READ_BYTES, ObjectInfo, ObjectStoreError, StreamReader, md5_of, transported
from hcm_pipeline.worker.api import ARCHIVE_COPY, URLS, WorkerApi
from hcm_pipeline.worker.documents import JobIds

GENERATION_HEADER: Final = "x-goog-generation"
HASH_HEADER: Final = "x-goog-hash"
# One more PUT after an upload that arrived different from the file (then the step fails and its retry starts clean).
UPLOAD_TRIES: Final = 2


def _md5_said(response: httpx.Response) -> str | None:
    """The MD5 Cloud Storage computed of what it received (`x-goog-hash: crc32c=..., md5=...`), when it says one."""
    for part in str(response.headers.get(HASH_HEADER, "")).split(","):
        name, _, value = part.strip().partition("=")
        if name == "md5" and value:
            return value
    return None


def _first(answer: Mapping[str, object]) -> Mapping[str, object]:
    objects = answer.get("objects")
    first = objects[0] if isinstance(objects, list) and objects else None
    return first if isinstance(first, dict) else {}


def _text(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _headers(value: object) -> dict[str, str]:
    return {str(key): str(item) for key, item in value.items()} if isinstance(value, dict) else {}


@dataclass(frozen=True)
class SignedObject:
    """One object of `worker.urls`' answer: where and how to send the request, and the object's metadata."""

    path: str
    url: str
    method: str
    headers: Mapping[str, str]
    exists: bool
    size: int = 0
    generation: str | None = None
    md5: str | None = None

    @classmethod
    def of(cls, path: str, answer: Mapping[str, object]) -> SignedObject:
        found = _first(answer)
        url, method = _text(found.get("url")), _text(found.get("method"))
        if url is None or method is None or found.get("path") != path:
            raise ObjectStoreError(f"the server signed no URL for {path}")
        size = found.get("size")
        return cls(
            path,
            url,
            method,
            _headers(found.get("headers")),
            found.get("exists") is True,
            size if isinstance(size, int) else 0,
            _text(found.get("generation")),
            _text(found.get("md5")),
        )

    def info(self) -> ObjectInfo:
        return ObjectInfo(self.path, self.size, self.generation or "0", self.md5)


def _generation(response: httpx.Response) -> str | None:
    header = response.headers.get(GENERATION_HEADER)
    if header:
        return str(header)
    try:
        body = response.json()
    except ValueError:
        return None
    value = body.get("generation") if isinstance(body, dict) else None
    return str(value) if isinstance(value, str | int) else None


def _checked(response: httpx.Response, what: str) -> httpx.Response:
    if not response.is_success:
        raise ObjectStoreError(f"the signed {what} answered HTTP {response.status_code}")
    return response


class SignedObjectStore:
    """The claimed job's version files (PUT) and inputs (GET), one signed URL per operation."""

    # Which callable signs, and the field its request names the objects in: `worker.urls`, or M20's `worker.archiveCopy`
    # (`copy_store`: the holder's side of an archive series' copy, for a job it does not hold).
    callable: str = URLS
    field: str = "request"

    def __init__(self, api: WorkerApi, ids: JobIds, http: httpx.Client) -> None:
        self._api = api
        self._ids = ids
        self._http = http

    def _sign(self, path: str, method: str, content_type: str | None = None) -> SignedObject:
        wanted: dict[str, object] = {"path": path, "method": method, **({"contentType": content_type} if content_type else {})}
        answer = self._api.call(self.callable, {**self._ids.body(), self.field: {"kind": "objects", "objects": [wanted]}})
        return SignedObject.of(path, answer)

    def _readable(self, path: str) -> SignedObject:
        signed = self._sign(path, "GET")
        if not signed.exists:
            raise ObjectStoreError(f"no object at {path}")
        return signed

    def stat(self, path: str) -> ObjectInfo | None:
        signed = self._sign(path, "GET")
        return signed.info() if signed.exists else None

    def upload_file(self, local: Path, path: str, content_type: str) -> ObjectInfo:
        """The file sent to its signed URL, unless an identical object is already there."""
        signed, md5 = self._sign(path, "PUT", content_type), md5_of(local)
        return signed.info() if signed.exists and signed.md5 == md5 else self._sent(signed, local, (path, content_type, md5))

    def _sent(self, signed: SignedObject, local: Path, what: tuple[str, str, str]) -> ObjectInfo:
        """The file PUT until Cloud Storage says it received its MD5 (`UPLOAD_TRIES`), else an error: never a damaged object recorded."""
        path, content_type, md5 = what
        for _ in range(UPLOAD_TRIES):
            response = self._put(signed, local, content_type)
            if _md5_said(response) in (None, md5):
                generation = _generation(response) or self._generation_of(path)
                return ObjectInfo(path, local.stat().st_size, generation, md5)
            signed = self._sign(path, "PUT", content_type)
        raise ObjectStoreError(f"the signed upload of {path} arrived different from the file, twice")

    def _put(self, signed: SignedObject, local: Path, content_type: str) -> httpx.Response:
        with local.open("rb") as file:
            headers = {"Content-Type": content_type, **signed.headers}
            return _checked(self._http.request(signed.method, signed.url, content=file, headers=headers), "upload")

    def _generation_of(self, path: str) -> str:
        info = self.stat(path)
        return info.generation if info is not None else "0"

    def download_file(self, path: str, local: Path) -> ObjectInfo:
        signed = self._readable(path)
        with transported("the signed download", local), self._http.stream("GET", signed.url, headers=dict(signed.headers)) as response:
            _checked(response, "download")
            with local.open("wb") as file:
                for block in response.iter_bytes(READ_BYTES):
                    file.write(block)
            generation = response.headers.get(GENERATION_HEADER) or signed.generation or "0"
        return ObjectInfo(path, local.stat().st_size, str(generation), signed.md5)

    @contextmanager
    def _reading(self, signed: SignedObject) -> Iterator[IO[bytes]]:
        with self._http.stream("GET", signed.url, headers=dict(signed.headers)) as response:
            _checked(response, "read")
            yield io.BufferedReader(StreamReader(response.iter_bytes(READ_BYTES)), READ_BYTES)

    def open_read(self, path: str) -> AbstractContextManager[IO[bytes]]:
        return self._reading(self._readable(path))

    @staticmethod
    def _refused(what: str) -> NoReturn:
        raise ObjectStoreError(f"{what} is not available through signed URLs (the local worker keeps such objects locally)")

    def list(self, prefix: str) -> list[ObjectInfo]:
        self._refused(f"listing {prefix}")

    def delete(self, path: str) -> None:
        self._refused(f"deleting {path}")

    def start_resumable(self, path: str, size: int, content_type: str) -> str:
        self._refused(f"a resumable upload of {path}")

    def resumable_offset(self, session: str, size: int) -> int | ObjectInfo:
        self._refused("a resumable session")

    def write_chunk(self, session: str, offset: int, data: bytes, size: int) -> int | ObjectInfo:
        self._refused("a resumable session")


def copy_store(api: WorkerApi, ids: JobIds, http: httpx.Client) -> SignedObjectStore:
    """M20 (2026-11-13): the objects of an archive series' copy, signed by `worker.archiveCopy` for the job another worker waits on."""
    store = SignedObjectStore(api, ids, http)
    store.callable, store.field = ARCHIVE_COPY, "copy"
    return store
