"""The object store port (the private Cloud Storage bucket) and its adapter over the GCS JSON API.

`ObjectStore` is what the steps need (docs/research/M3-interfaces.md §5.1-§5.2): stat, create-only uploads (an
identical object already there is reused, a different one replaced, so a step that ran half way is idempotent),
downloads to a local file, streamed reads, listing, deletes, and resumable upload sessions written chunk by chunk
(the USGS delivery streams through one; its session address and offset are the fetch checkpoint). `GcsObjectStore`
speaks the JSON API over httpx with the job's own token, or to the Storage emulator (`STORAGE_EMULATOR_HOST`,
loopback). A session address works as a credential for that one upload: it is kept in the private bucket's
`work/` checkpoint and never logged. A look-up or a download the network fails (no connection, a timeout, a read cut
short) is an `ObjectStoreError` naming the error's kind (`transported`), and a download it cut short leaves no partial file.
"""

import base64
import hashlib
import io
from collections.abc import Buffer, Iterator
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass
from http import HTTPStatus
from pathlib import Path
from typing import IO, Final, Protocol
from urllib.parse import quote

import httpx

from hcm_pipeline.tokens import TokenSource

GCS_BASE_URL: Final = "https://storage.googleapis.com"
CHUNK_BYTES: Final = 64 * 1024 * 1024
READ_BYTES: Final = 1024 * 1024
RESUME_INCOMPLETE: Final = 308
_FINISHED: Final = frozenset({HTTPStatus.OK, HTTPStatus.CREATED})


class ObjectStoreError(RuntimeError):
    """A Cloud Storage call failed (the status, never a URL with its query)."""


class SessionExpiredError(ObjectStoreError):
    """The resumable session is gone (GCS keeps one for a week): start a new one."""


@dataclass(frozen=True)
class ObjectInfo:
    path: str
    size: int
    generation: str
    md5: str | None = None


class ObjectStore(Protocol):
    def stat(self, path: str) -> ObjectInfo | None: ...

    def upload_file(self, local: Path, path: str, content_type: str) -> ObjectInfo: ...

    def download_file(self, path: str, local: Path) -> ObjectInfo: ...

    def open_read(self, path: str) -> AbstractContextManager[IO[bytes]]: ...

    def list(self, prefix: str) -> list[ObjectInfo]: ...

    def delete(self, path: str) -> None: ...

    def start_resumable(self, path: str, size: int, content_type: str) -> str: ...

    def resumable_offset(self, session: str, size: int) -> int | ObjectInfo: ...

    def write_chunk(self, session: str, offset: int, data: bytes, size: int) -> int | ObjectInfo: ...


@contextmanager
def transported(what: str, partial: Path | None = None) -> Iterator[None]:
    """httpx's own errors as an `ObjectStoreError` naming their kind, never the address (a signed URL's query is a credential), so
    a caller catches the port's error alone; a download they cut short (`partial`) leaves no file behind."""
    try:
        yield
    except httpx.HTTPError as error:
        if partial is not None:
            partial.unlink(missing_ok=True)
        raise ObjectStoreError(f"{what}: {type(error).__name__}") from error


class PreconditionFailedError(ObjectStoreError):
    """A create-only write found the object already there."""


def md5_of(local: Path) -> str:
    """The base64 MD5 of a file, as Cloud Storage reports it (`md5Hash`): the identity check of a re-upload."""
    digest = hashlib.md5(usedforsecurity=False)
    with local.open("rb") as file:
        for block in iter(lambda: file.read(READ_BYTES), b""):
            digest.update(block)
    return base64.b64encode(digest.digest()).decode("ascii")


def sha256_of(local: Path) -> str:
    digest = hashlib.sha256()
    with local.open("rb") as file:
        for block in iter(lambda: file.read(READ_BYTES), b""):
            digest.update(block)
    return digest.hexdigest()


def _info(body: object) -> ObjectInfo:
    if not isinstance(body, dict):
        raise ObjectStoreError("Cloud Storage answered without object metadata")
    md5 = body.get("md5Hash")
    return ObjectInfo(
        str(body.get("name", "")), int(str(body.get("size", "0"))), str(body.get("generation", "0")), md5 if isinstance(md5, str) else None
    )


def _persisted(header: str | None) -> int:
    """The bytes a resumable session holds, from its `Range: bytes=0-N` answer (none yet without one)."""
    return 0 if not header else int(header.rsplit("-", 1)[1]) + 1


class StreamReader(io.RawIOBase):
    """A readable file over an httpx streaming response (tarfile's `r|gz` reads it front to back)."""

    def __init__(self, chunks: Iterator[bytes]) -> None:
        self._chunks = chunks
        self._pending = b""

    def readable(self) -> bool:
        return True

    def readinto(self, buffer: Buffer, /) -> int:
        view = memoryview(buffer).cast("B")
        if not self._pending:
            self._pending = next(self._chunks, b"")
        size = min(len(view), len(self._pending))
        view[:size] = self._pending[:size]
        self._pending = self._pending[size:]
        return size


class GcsObjectStore:
    """`ObjectStore` over the Cloud Storage JSON API (or the Storage emulator at `base_url`)."""

    def __init__(self, http: httpx.Client, bucket: str, tokens: TokenSource, base_url: str = GCS_BASE_URL) -> None:
        self._http = http
        self._bucket = bucket
        self._tokens = tokens
        self._base = base_url.rstrip("/")

    def _auth(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._tokens.token()}"}

    def _object_url(self, path: str) -> str:
        return f"{self._base}/storage/v1/b/{self._bucket}/o/{quote(path, safe='')}"

    @staticmethod
    def _checked(response: httpx.Response, what: str) -> httpx.Response:
        if not response.is_success:
            raise ObjectStoreError(f"Cloud Storage {what}: HTTP {response.status_code}")
        return response

    def stat(self, path: str) -> ObjectInfo | None:
        with transported("Cloud Storage stat"):
            response = self._http.get(self._object_url(path), headers=self._auth())
        if response.status_code == HTTPStatus.NOT_FOUND:
            return None
        return _info(self._checked(response, "stat").json())

    def list(self, prefix: str) -> list[ObjectInfo]:
        found: list[ObjectInfo] = []
        page: str | None = ""
        while page is not None:
            params = {"prefix": prefix, **({"pageToken": page} if page else {})}
            body = self._checked(self._http.get(f"{self._base}/storage/v1/b/{self._bucket}/o", params=params, headers=self._auth()), "list")
            listing = body.json()
            found += [_info(item) for item in listing.get("items", [])]
            page = listing.get("nextPageToken")
        return found

    def delete(self, path: str) -> None:
        response = self._http.delete(self._object_url(path), headers=self._auth())
        if response.status_code != HTTPStatus.NOT_FOUND:
            self._checked(response, "delete")

    def download_file(self, path: str, local: Path) -> ObjectInfo:
        with (
            transported("Cloud Storage download", local),
            self._http.stream("GET", self._object_url(path), params={"alt": "media"}, headers=self._auth()) as response,
        ):
            self._checked(response, "download")
            with local.open("wb") as file:
                for block in response.iter_bytes(READ_BYTES):
                    file.write(block)
            generation = response.headers.get("x-goog-generation", "0")
        return ObjectInfo(path, local.stat().st_size, generation)

    @contextmanager
    def _reading(self, path: str) -> Iterator[IO[bytes]]:
        with self._http.stream("GET", self._object_url(path), params={"alt": "media"}, headers=self._auth()) as response:
            self._checked(response, "read")
            yield io.BufferedReader(StreamReader(response.iter_bytes(READ_BYTES)), READ_BYTES)

    def open_read(self, path: str) -> AbstractContextManager[IO[bytes]]:
        return self._reading(path)

    def start_resumable(self, path: str, size: int, content_type: str) -> str:
        response = self._http.post(
            f"{self._base}/upload/storage/v1/b/{self._bucket}/o",
            params={"uploadType": "resumable", "ifGenerationMatch": "0", "name": path},
            json={"name": path, "contentType": content_type},
            headers={**self._auth(), "X-Upload-Content-Type": content_type, "X-Upload-Content-Length": str(size)},
        )
        if response.status_code == HTTPStatus.PRECONDITION_FAILED:
            raise PreconditionFailedError(f"Cloud Storage upload of {path}: the object exists")
        location = self._checked(response, "upload start").headers.get("location")
        if not isinstance(location, str) or not location:
            raise ObjectStoreError("Cloud Storage upload start: no session address")
        return location

    def write_chunk(self, session: str, offset: int, data: bytes, size: int) -> int | ObjectInfo:
        content_range = f"bytes {offset}-{offset + len(data) - 1}/{size}" if data else f"bytes */{size}"
        return self._session_answer(self._http.put(session, content=data, headers={"Content-Range": content_range}))

    def resumable_offset(self, session: str, size: int) -> int | ObjectInfo:
        return self._session_answer(self._http.put(session, content=b"", headers={"Content-Range": f"bytes */{size}"}))

    def _session_answer(self, response: httpx.Response) -> int | ObjectInfo:
        status = response.status_code
        if status == RESUME_INCOMPLETE:
            return _persisted(response.headers.get("range"))
        if status in {HTTPStatus.NOT_FOUND, HTTPStatus.GONE}:
            raise SessionExpiredError("Cloud Storage upload session expired")
        if status == HTTPStatus.PRECONDITION_FAILED:
            raise PreconditionFailedError("Cloud Storage upload: the object exists")
        return _info(self._checked(response, "upload").json())

    def upload_file(self, local: Path, path: str, content_type: str) -> ObjectInfo:
        """Create-only upload; an identical object already there is kept, a different one is replaced."""
        try:
            return self._upload(local, path, content_type)
        except PreconditionFailedError:
            existing = self.stat(path)
            if existing is not None and existing.md5 == md5_of(local):
                return existing
            self.delete(path)
            return self._upload(local, path, content_type)

    def _upload(self, local: Path, path: str, content_type: str) -> ObjectInfo:
        size = local.stat().st_size
        session = self.start_resumable(path, size, content_type)
        with local.open("rb") as file:
            result: int | ObjectInfo = 0
            while not isinstance(result, ObjectInfo):
                file.seek(result)
                result = self.write_chunk(session, result, file.read(CHUNK_BYTES), size)
        return result
