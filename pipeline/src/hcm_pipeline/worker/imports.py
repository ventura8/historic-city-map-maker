"""The worker page's import routes (docs/research/M20-import-local.md §2.1): a folder or a zip on this computer, over loopback only.

| Request | Answer |
| --- | --- |
| `GET /import` | the import page (its settings carry the CSRF token, as the main page's) |
| `GET /import.js`, `/import.css` | its files |
| `POST /import/new` (JSON) | 201 `{archiveId}`: a new archive's folder |
| `POST /import/<id>/file` (any body, `X-HCM-Path`: the file's relative path, URI-encoded) | 201 `{path}`: one file, streamed |
| `POST /import/<id>/zip` (JSON `{path}`) | 200 `{written, refused}`: an uploaded zip read in place (every entry checked) |
| `POST /import/<id>/scan` (JSON `{name, source, latitude?}`) | 202: the scan starts; it reports to the server when done |
| `POST /import/<id>/cancel` (JSON) | 200: the scan stops at its next file and the archive's folder goes |
| `GET /import/<id>` | the scan's state: `scanning` (`read` of `total` files), `reported` (its counts), `failed` (its code), `cancelled` |

Every POST needs what the main page's do: the page's own origin and the CSRF header; a file's body is not JSON, which is why only
`/file` takes another type (a cross-site form cannot set `X-HCM-Path` or the CSRF header without a preflight nobody answers). Batch 4
(the owner, 2026-11-09): the admin's own tab sends the same requests from a Hosting origin with a session token instead (`server.py`).
"""

import json
import threading
import zipfile
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from http import HTTPStatus
from typing import BinaryIO, Final
from urllib.parse import unquote

from hcm_pipeline.archive import report
from hcm_pipeline.archive.intake import ArchiveStore, IntakeError
from hcm_pipeline.archive.safepath import UnsafePathError, inside
from hcm_pipeline.archive.sidecar import Sidecar
from hcm_pipeline.archive.zipread import ZipRefusedError
from hcm_pipeline.log import get_logger
from hcm_pipeline.worker.import_page import IMPORT_CSS, IMPORT_JS

LOG = get_logger("worker.imports")
PATH_HEADER: Final = "x-hcm-path"
CHUNK_BYTES: Final = 1024 * 1024
DEFAULT_LATITUDE: Final = 45.0
MAX_LATITUDE: Final = 85.0
IMPORT_STATIC: Final = {
    "/import.js": (IMPORT_JS.encode("utf-8"), "text/javascript; charset=utf-8"),
    "/import.css": (IMPORT_CSS.encode("utf-8"), "text/css; charset=utf-8"),
}

Reply = tuple[int, bytes, str]
# Sends the report body to `worker.archiveReport` (the caller adds the city and the worker); its answer, or an exception.
Reporter = Callable[[dict[str, object]], Mapping[str, object]]


def reply(status: int, value: object) -> Reply:
    return status, json.dumps(value).encode("utf-8"), "application/json"


def chunks_of(stream: BinaryIO, length: int) -> Iterator[bytes]:
    """The request's body, `length` bytes at most, a chunk at a time."""
    left = length
    while left > 0:
        chunk = stream.read(min(CHUNK_BYTES, left))
        if not chunk:
            return
        left -= len(chunk)
        yield chunk


class ScanCancelledError(RuntimeError):
    """The owner cancelled the import while its scan ran."""


@dataclass
class ImportRoutes:
    """The import routes over an `ArchiveStore`; `report` sends a scan's report to the server."""

    store: ArchiveStore
    report: Reporter
    states: dict[str, dict[str, object]] = field(default_factory=dict)
    cancelled: set[str] = field(default_factory=set)
    now: Callable[[], datetime] = lambda: datetime.now(UTC)
    # How a scan is started: in its own daemon thread (tests run it at once).
    start: Callable[[Callable[[], None]], None] = lambda work: threading.Thread(target=work, daemon=True).start()

    def get(self, path: str) -> Reply | None:
        """`GET /import/<id>`: the scan's state; None for a path that is not the import's."""
        archive_id = path.removeprefix("/import/")
        if archive_id == path or "/" in archive_id:
            return None
        state = self.states.get(archive_id)
        return reply(HTTPStatus.OK, state) if state is not None else reply(HTTPStatus.NOT_FOUND, {})

    def new(self) -> Reply:
        return reply(HTTPStatus.CREATED, {"archiveId": self.store.create()})

    def upload(self, archive_id: str, headers: Mapping[str, str], stream: BinaryIO, length: int) -> Reply:
        try:
            relative = self.store.receive(archive_id, unquote(headers.get(PATH_HEADER, "")), chunks_of(stream, length), length)
        except IntakeError as error:
            LOG.warning("import file refused: %s", error)
            return reply(HTTPStatus.BAD_REQUEST, {"error": "refused"})
        return reply(HTTPStatus.CREATED, {"path": relative})

    def unzip(self, archive_id: str, body: Mapping[str, object]) -> Reply:
        """An uploaded zip, read in place; refused as a whole (a bomb, too many entries, no room) or entry by entry."""
        try:
            zip_path = inside(self.store.files(archive_id), str(body.get("path", "")))
            result = self.store.extract(archive_id, zip_path) if zip_path.is_file() else None
        except (IntakeError, UnsafePathError, ZipRefusedError, zipfile.BadZipFile, OSError) as error:
            LOG.warning("zip refused: %s", error)
            return reply(HTTPStatus.BAD_REQUEST, {"error": "refused"})
        if result is None:
            return reply(HTTPStatus.NOT_FOUND, {})
        zip_path.unlink()
        return reply(HTTPStatus.OK, {"written": len(result.written), "refused": len(result.refused)})

    def scan(self, archive_id: str, body: Mapping[str, object]) -> Reply:
        """Starts the scan in its own thread; the page follows `GET /import/<id>`."""
        try:
            self.store.files(archive_id)
        except IntakeError:
            return reply(HTTPStatus.NOT_FOUND, {})
        self.states[archive_id] = {"state": "scanning", "read": 0, "total": 0}
        self.cancelled.discard(archive_id)
        kept = dict(body)
        self.start(lambda: self.run_scan(archive_id, kept))
        return reply(HTTPStatus.ACCEPTED, self.states[archive_id])

    def cancel(self, archive_id: str, _body: Mapping[str, object]) -> Reply:
        """Batch 4: the scan stops at its next file (or, while files are still sent, at once) and the archive's folder goes."""
        try:
            self.store.folder(archive_id)
        except IntakeError:
            return reply(HTTPStatus.NOT_FOUND, {})
        self.cancelled.add(archive_id)
        if self.states.get(archive_id, {}).get("state") != "scanning":
            self.store.discard(archive_id)
            self.states[archive_id] = {"state": "cancelled"}
        return reply(HTTPStatus.OK, {"state": "cancelled"})

    def _progress(self, archive_id: str) -> Callable[[int, int], None]:
        def read(done: int, total: int) -> None:
            if archive_id in self.cancelled:
                raise ScanCancelledError(archive_id)
            self.states[archive_id] = {"state": "scanning", "read": done, "total": total}

        return read

    def run_scan(self, archive_id: str, body: Mapping[str, object]) -> None:
        """The scan and its report; any failure is the state's, never the server's; a cancelled one leaves nothing."""
        try:
            self.states[archive_id] = self.scanned(archive_id, body)
        except ScanCancelledError:
            self.store.discard(archive_id)
            self.states[archive_id] = {"state": "cancelled"}
        except Exception as error:  # the page must learn of any failure: the worker itself goes on
            LOG.exception("archive scan failed")
            self.states[archive_id] = {"state": "failed", "error": getattr(error, "code", "apiError.internal")}

    def scanned(self, archive_id: str, body: Mapping[str, object]) -> dict[str, object]:
        context = report.Context(_latitude(body.get("latitude")), self.now().year, Sidecar())
        made = self.store.scan(archive_id, context, self._progress(archive_id))
        sent: dict[str, object] = {
            "archiveId": archive_id,
            "name": str(body.get("name") or archive_id)[:200],
            "source": "zip" if body.get("source") == "zip" else "folder",
            "fileCount": sum(made.skipped.values()) + sum(int(str(each["files"])) for each in made.series),
            "bytes": made.total_bytes,
            "series": made.series,
            "skipped": made.skipped,
            "issues": made.issues,
        }
        self.report(sent)
        return {"state": "reported", "series": len(made.series), "skipped": made.skipped}


def _latitude(value: object) -> float:
    if isinstance(value, int | float) and not isinstance(value, bool) and abs(value) <= MAX_LATITUDE:
        return float(value)
    return DEFAULT_LATITUDE
