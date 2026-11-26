"""`gather`: an archive series' originals, found and checked on the owner's computer (docs/research/M20-import-local.md §4).

The series' files are named in the worker's own `archive.json` (the scan wrote it); each must still be there with the SHA-256 the scan
read, or the job cannot be the series the owner imported: it fails with `apiError.imagery.archiveMissing` (a moved folder: the owner points
the worker to it again and retries). Nothing is uploaded. The step writes the series' per-sheet record, `sheets.json`, beside the job's
scratch files (the parts of one version: path, cell, size and hash), and the version's `source` learns how many sheets there are. On
Cloud Run there is no archive at all: the job is local-only, and this step says so rather than looking.
"""

import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Final

from hcm_pipeline.archive.intake import ArchiveStore, IntakeError
from hcm_pipeline.archive.probe import sha256_file
from hcm_pipeline.archive.safepath import UnsafePathError, inside
from hcm_pipeline.contract import Errors
from hcm_pipeline.jobs import Done, JobContext, StepFailedError, StepResult

SHEETS: Final = "sheets.json"


def text_param(params: Mapping[str, object], name: str) -> str:
    value = params.get(name)
    if not isinstance(value, str):
        raise StepFailedError(Errors.INVALID_REQUEST, f"the job has no {name}")
    return value


def _mapping(value: object) -> Mapping[str, object]:
    return value if isinstance(value, dict) else {}


def _series_files(record: Mapping[str, object], series_id: str) -> tuple[list[str], Mapping[str, object]]:
    found = _mapping(_mapping(record.get("series")).get(series_id))
    files = found.get("files")
    if not isinstance(files, list):
        raise StepFailedError(Errors.ARCHIVE_MISSING, f"the archive's record has no series {series_id}")
    return [str(path) for path in files], _mapping(found.get("cells"))


def _hashes(record: Mapping[str, object]) -> dict[str, str]:
    files = record.get("files")
    rows = files if isinstance(files, list) else []
    return {str(row.get("path")): str(row.get("sha256")) for row in rows if isinstance(row, dict)}


def checked_sheet(root: Path, path: str, expected: str | None, cell: object) -> dict[str, object]:
    """One sheet, still where the scan found it and still the same bytes; else `archiveMissing`."""
    try:
        local = inside(root, path)
    except UnsafePathError as error:
        raise StepFailedError(Errors.ARCHIVE_MISSING, str(error)) from error
    if not local.is_file() or sha256_file(local) != expected:
        raise StepFailedError(Errors.ARCHIVE_MISSING, f"{path} is not the file the scan read")
    return {"path": path, "cell": str(cell) if cell is not None else None, "bytes": local.stat().st_size, "sha256": expected}


def store_of(ctx: JobContext) -> ArchiveStore:
    root = ctx.services.archive_root
    if root is None:
        raise StepFailedError(Errors.ARCHIVE_MISSING, "this run has no local archives (an archive series runs on the owner's computer)")
    return ArchiveStore(root)


def sheets_of(store: ArchiveStore, archive_id: str, series_id: str) -> list[dict[str, object]]:
    """The series' sheets, each checked against the scan's record."""
    try:
        record = store.record(archive_id)
        root = store.files(archive_id)
    except IntakeError as error:
        raise StepFailedError(Errors.ARCHIVE_MISSING, str(error)) from error
    paths, cells = _series_files(record, series_id)
    hashes = _hashes(record)
    return [checked_sheet(root, path, hashes.get(path), cells.get(path)) for path in paths]


def write_sheets(target: Path, sheets: Sequence[Mapping[str, object]]) -> Path:
    target.write_text(json.dumps({"sheets": list(sheets)}), encoding="utf-8")
    return target


class GatherStep:
    name = "gather"

    def run(self, ctx: JobContext) -> StepResult:
        params = ctx.job.params
        archive_id, series_id = text_param(params, "archiveId"), text_param(params, "seriesId")
        sheets = sheets_of(store_of(ctx), archive_id, series_id)
        local = write_sheets(ctx.local(SHEETS), sheets)
        ctx.log.info(f"{len(sheets)} sheets of series {series_id} found and checked on this computer", self.name)
        return Done(ctx.publish(local, ctx.work_file(SHEETS), "application/json"))
