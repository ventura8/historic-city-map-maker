"""An archive series' sheets copied from the computer that holds the archive to the worker that runs the job (M20 §4.1).

Live report of 2026-11-13: the owner's three computers all run archive series, yet the scanned maps were imported on one. The
computer that holds the archive whole sends one series' sheets on request (`send_copy`): each sheet once, named by its SHA-256, and
a `manifest.json` with the series' part of the scan's record, to `tmp/archive-copies/{city}/{job}/` (the bucket deletes it after a
day), through the signed URLs of `worker.archiveCopy`, then says `done` with the bytes sent. The worker that runs the job and has
not the sheets (`ensure_series`) reads the manifest through `worker.urls`, downloads the sheets, checks every SHA-256 and keeps them
in its own archive store (`ArchiveStore.merge_copy`, never named as held whole); with no copy yet it raises
`ArchiveElsewhereError`, and the worker hands the job back without spending an attempt.
M20 §22 (2026-11-14): the holder shares from a thread of its own (`worker/sharing.py`), also while it runs a job; its `Pacing` is told
the copy's size, then each sheet sent, and keeps the governor's rate, says the progress, and stops the copy (`ShareStoppedError`)
when the worker ends. A sheet already in the bucket with the same MD5 is not sent again (`upload_file`), so a copy cut short resumes.
"""

import json
import tempfile
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Final, Protocol

from hcm_pipeline.archive.intake import ArchiveStore, IntakeError
from hcm_pipeline.archive.probe import sha256_file
from hcm_pipeline.archive.safepath import UnsafePathError, inside
from hcm_pipeline.jobs import ArchiveElsewhereError, JobContext
from hcm_pipeline.log import get_logger
from hcm_pipeline.objects import ObjectStore, ObjectStoreError

LOG = get_logger("archive.copy")
MANIFEST: Final = "manifest.json"
SHEET_TYPE: Final = "application/octet-stream"
MANIFEST_TYPE: Final = "application/json"
ARCHIVE_SERIES: Final = "archive-series"


class ShareStoppedError(Exception):
    """M20 §22: the worker is ending, or the computer paused for good, while a copy was being sent: the copy stops where it is."""


class Pacing(Protocol):
    """How a copy is sent (M20 §22): told its size, then each sheet sent; may wait (the governor's rate) or stop the copy."""

    def start(self, job_id: str, total: int) -> None: ...

    def sent(self, size: int) -> None: ...


class NoPacing:
    """A copy asked by a claim, sent at once between two jobs."""

    def start(self, job_id: str, total: int) -> None:
        return None

    def sent(self, size: int) -> None:
        return None


def copy_path(city_id: str, job_id: str, name: str) -> str:
    """One file of the job's copy (`RASTER_PATHS.archiveCopy`)."""
    return f"tmp/archive-copies/{city_id}/{job_id}/{name}"


def _mapping(value: object) -> Mapping[str, object]:
    return value if isinstance(value, dict) else {}


def manifest_of(store: ArchiveStore, archive_id: str, series_id: str) -> dict[str, object]:
    """The series' part of this computer's record: its entry and the rows of its files (`IntakeError` without it)."""
    record = store.record(archive_id)
    series = _mapping(_mapping(record.get("series")).get(series_id))
    files = series.get("files")
    if not isinstance(files, list):
        raise IntakeError(f"the archive's record has no series {series_id}")
    wanted = {str(path) for path in files}
    rows = [row for row in _rows(record) if row.get("path") in wanted]
    return {"archiveId": archive_id, "seriesId": series_id, "series": dict(series), "files": rows}


class CopySender:
    """The holder's side: one series' sheets put in the bucket for another worker (`objects` signs through `worker.archiveCopy`)."""

    def __init__(self, store: ArchiveStore, objects: Callable[[str], ObjectStore], finish: Callable[[str, int], None]) -> None:
        self._store = store
        self._objects = objects
        self._finish = finish

    def send(self, city_id: str, duty: Mapping[str, object], pacing: Pacing | None = None) -> bool:
        """The copy asked for, or a logged refusal (the job keeps waiting; the next ask names it again); True when it was sent."""
        job_id, archive_id, series_id = (str(duty.get(key, "")) for key in ("jobId", "archiveId", "seriesId"))
        try:
            sent = self._send(city_id, (job_id, archive_id, series_id), pacing or NoPacing())
        except ShareStoppedError:
            LOG.info("the copy of series %s for job %s stopped: the worker is ending", series_id, job_id)
            return False
        except (IntakeError, UnsafePathError, ObjectStoreError, OSError) as error:
            LOG.warning("the copy of series %s of %s for job %s was not sent: %s", series_id, archive_id, job_id, error)
            return False
        self._finish(job_id, sent)
        LOG.info("series %s of %s copied for job %s: %d bytes through the bucket", series_id, archive_id, job_id, sent)
        return True

    def _send(self, city_id: str, duty: tuple[str, str, str], pacing: Pacing) -> int:
        job_id, archive_id, series_id = duty
        manifest = manifest_of(self._store, archive_id, series_id)
        objects, root, sent = self._objects(job_id), self._store.files(archive_id), 0
        sheets = {
            sha: inside(root, path) for sha, path in {str(row.get("sha256")): str(row.get("path")) for row in _rows(manifest)}.items()
        }
        pacing.start(job_id, sum(local.stat().st_size for local in sheets.values()))
        for sha, local in sheets.items():
            objects.upload_file(local, copy_path(city_id, job_id, sha), SHEET_TYPE)
            size = local.stat().st_size
            sent += size
            pacing.sent(size)
        with tempfile.TemporaryDirectory(prefix="hcm-copy-") as folder:
            listed = Path(folder) / MANIFEST
            listed.write_text(json.dumps(manifest), encoding="utf-8")
            objects.upload_file(listed, copy_path(city_id, job_id, MANIFEST), MANIFEST_TYPE)
        return sent


def _rows(manifest: Mapping[str, object]) -> list[dict[str, object]]:
    files = manifest.get("files")
    return [row for row in files if isinstance(row, dict)] if isinstance(files, list) else []


def _sheet(objects: ObjectStore, source: str, target: Path, sha: str) -> int:
    """One sheet downloaded beside its place, checked by its SHA-256, then moved there; its size."""
    partial = target.with_name(target.name + ".part")
    target.parent.mkdir(parents=True, exist_ok=True)
    objects.download_file(source, partial)
    if sha256_file(partial) != sha:
        partial.unlink()
        raise ArchiveElsewhereError(f"the copy of {target.name} is not the file the scan read")
    partial.replace(target)
    return target.stat().st_size


def fetch_copy(ctx: JobContext, store: ArchiveStore, archive_id: str, series_id: str) -> int:
    """The series' sheets from the job's copy into this computer's store; the bytes read. No copy: `ArchiveElsewhereError`."""
    objects, city, job = ctx.services.objects, ctx.config.city_id, ctx.job.id
    if objects.stat(copy_path(city, job, MANIFEST)) is None:
        raise ArchiveElsewhereError(f"no record of {archive_id} on this computer, and no copy of series {series_id} yet")
    manifest = json.loads(ctx.stage(copy_path(city, job, MANIFEST), MANIFEST).read_text(encoding="utf-8"))
    rows, root, read = _rows(_mapping(manifest)), store.files(archive_id), 0
    for row in rows:
        sha, target = str(row.get("sha256")), inside(root, str(row.get("path")))
        present = target.is_file() and sha256_file(target) == sha
        read += 0 if present else _sheet(objects, copy_path(city, job, sha), target, sha)
    store.merge_copy(archive_id, rows, {series_id: dict(_mapping(_mapping(manifest).get("series")))})
    return read


def _local_series(ctx: JobContext) -> tuple[ArchiveStore, str, str] | None:
    """The store, archive and series of an archive series run on a worker (Cloud Run has no store: `gather` says so); else None."""
    root, params = ctx.services.archive_root, ctx.job.params
    archive_id, series_id = params.get("archiveId"), params.get("seriesId")
    if ctx.job.type != ARCHIVE_SERIES or root is None:
        return None
    return (ArchiveStore(root), archive_id, series_id) if isinstance(archive_id, str) and isinstance(series_id, str) else None


def ensure_series(ctx: JobContext) -> None:
    """An archive series on a worker: its sheets here, from this computer's archive or from a copy (M20 §4.1)."""
    local = _local_series(ctx)
    if local is None or local[0].has_series(local[1], local[2]):
        return
    store, archive_id, series_id = local
    try:
        read = fetch_copy(ctx, store, archive_id, series_id)
    except (ObjectStoreError, UnsafePathError, ValueError) as error:
        raise ArchiveElsewhereError(f"the copy of series {series_id} could not be read: {error}") from error
    ctx.log.info(f"series {series_id} copied to this computer from the bucket: {read} bytes", None)
