"""An archive on the owner's computer: received, scanned and recorded (docs/research/M20-import-local.md §2).

Each archive has its own folder, `<work>/import/<archiveId>/`: its files under `x/` (streamed from the worker's page, extracted from a zip,
or copied there by the owner), its scan's record `archive.json` (every file's path, size, SHA-256 and probe, and which series holds it),
which never leaves the computer. `scan` reads every file through the probe, classifies them, writes `archive.json` and answers the body of
`worker.archiveReport`. A link inside `x/` is never followed; a path is always relative to `x/`.
"""

import json
import secrets
import shutil
from collections.abc import Callable, Iterable, Iterator
from dataclasses import asdict, replace
from pathlib import Path
from typing import Final

from hcm_pipeline.archive import classify, probe, report, sidecar, zipread
from hcm_pipeline.archive.model import FileRow, Probe, Series
from hcm_pipeline.archive.safepath import UnsafePathError, inside, relative_path

ARCHIVE_PREFIX: Final = "ar-"
ID_HEX_CHARS: Final = 16
RECORD: Final = "archive.json"
# M20 (live report of 2026-11-13): a record made of copied sheets, not of this computer's own scan.
PARTIAL: Final = "partial"
FILES: Final = "x"
MAX_FILE_BYTES: Final = zipread.MAX_ENTRY_BYTES
WORLD_SUFFIXES: Final = (".tfw", ".tifw", ".jgw", ".pgw", ".wld", ".prj", ".aux.xml")

Prober = Callable[[Path], Probe]
# Files read so far and of how many (the admin's scan progress).
Progress = Callable[[int, int], None]


class IntakeError(ValueError):
    """A file or an archive the intake refuses (an unknown archive, an unsafe path, a file too large, no room)."""


def new_archive_id() -> str:
    """`ar-` and 16 hex characters (`ARCHIVE_ID_PATTERN`)."""
    return ARCHIVE_PREFIX + secrets.token_hex(8)


def _valid_id(archive_id: str) -> bool:
    tail = archive_id.removeprefix(ARCHIVE_PREFIX)
    return archive_id.startswith(ARCHIVE_PREFIX) and len(tail) == ID_HEX_CHARS and all(char in "0123456789abcdef" for char in tail)


class ArchiveStore:
    """The archives under `<work>/import/`."""

    def __init__(self, work: Path, prober: Prober = probe.probe_file) -> None:
        self.root = work / "import"
        self._probe = prober

    def folder(self, archive_id: str) -> Path:
        if not _valid_id(archive_id):
            raise IntakeError(f"not an archive id: {archive_id!r}")
        return self.root / archive_id

    def files(self, archive_id: str) -> Path:
        return self.folder(archive_id) / FILES

    def create(self) -> str:
        archive_id = new_archive_id()
        self.files(archive_id).mkdir(parents=True)
        return archive_id

    def receive(self, archive_id: str, raw_path: str, chunks: Iterable[bytes], length: int) -> str:
        """One file of the page's upload, written under `x/` at its validated relative path; its relative path."""
        root = self.files(archive_id)
        if not root.is_dir() or not 0 <= length <= min(MAX_FILE_BYTES, shutil.disk_usage(root).free - zipread.FREE_MARGIN_BYTES):
            raise IntakeError("unknown archive, or no room for the file")
        try:
            relative = relative_path(raw_path)
            target = inside(root, relative)
        except UnsafePathError as error:
            raise IntakeError(str(error)) from error
        _write(target, chunks, length)
        return relative

    def extract(self, archive_id: str, zip_path: Path, limits: zipread.ZipLimits | None = None) -> zipread.ZipResult:
        """A zip the owner chose, read in place and written under `x/` (every entry checked)."""
        root = self.files(archive_id)
        return zipread.extract(zip_path, root, shutil.disk_usage(root).free, limits)

    def rows(self, archive_id: str, progress: Progress | None = None) -> list[FileRow]:
        """Every regular file under `x/` (links are never followed), probed; batch 4: `progress(read, total)` after each."""
        root = self.files(archive_id)
        paths = sorted(_regular_files(root))
        rows: list[FileRow] = []
        for path in paths:
            rows.append(self._row(root, path))
            if progress is not None:
                progress(len(rows), len(paths))
        return rows

    def _row(self, root: Path, path: Path) -> FileRow:
        relative = path.relative_to(root).as_posix()
        sidecars = tuple(suffix for suffix in WORLD_SUFFIXES if path.with_name(path.stem + suffix).is_file())
        return FileRow(relative, path.stat().st_size, probe.sha256_file(path), self._probe(path), sidecars)

    def discard(self, archive_id: str) -> None:
        """Batch 4: an import the owner cancelled leaves nothing on this computer."""
        shutil.rmtree(self.folder(archive_id), ignore_errors=True)

    def scan(self, archive_id: str, context: report.Context, progress: Progress | None = None) -> report.Report:
        """The scan: rows, series and skips; `archive.json` written; the report answered."""
        rows = self.rows(archive_id, progress)
        found = classify.classify(rows)
        context = report.Context(context.latitude, context.current_year, sidecar.read(self.files(archive_id)))
        made = report.report_of(found.series, found.skips, context)
        self.write_record(archive_id, rows, found.series)
        return replace(made, total_bytes=sum(row.size for row in rows))

    def write_record(self, archive_id: str, rows: Iterable[FileRow], series: Iterable[Series]) -> None:
        record = {
            "archiveId": archive_id,
            "files": [asdict(row) for row in rows],
            "series": {
                report.series_id(each.key): {
                    "class": each.series_class,
                    "files": [row.path for row in each.files],
                    "cells": dict(each.cells),
                }
                for each in series
            },
        }
        (self.folder(archive_id) / RECORD).write_text(json.dumps(record), encoding="utf-8")

    def holds(self, archive_id: str) -> bool:
        """True when this computer holds the whole archive: its own scan's record, not a copy of a few sheets (`PARTIAL`)."""
        try:
            return self.record(archive_id).get(PARTIAL) is not True
        except ValueError:
            return False

    def has_series(self, archive_id: str, series_id: str) -> bool:
        """True when this computer's record of the archive (its scan's, or a copy's) names the series."""
        try:
            series = self.record(archive_id).get("series")
        except ValueError:
            return False
        return isinstance(series, dict) and series_id in series

    def held(self) -> list[str]:
        """The archives this computer holds whole, newest first: what its `worker.claim` names (M20 §4.1, live report of 2026-11-13)."""
        found = [folder for folder in self.root.iterdir() if self.holds(folder.name)] if self.root.is_dir() else []
        return [folder.name for folder in sorted(found, key=lambda folder: (folder / RECORD).stat().st_mtime, reverse=True)]

    def merge_copy(self, archive_id: str, files: list[dict[str, object]], series: dict[str, object]) -> None:
        """A copy's sheets recorded beside the ones already copied here (`PARTIAL`: never named as held whole)."""
        try:
            before = self.record(archive_id)
        except IntakeError:
            before = {}
        kept = {str(row.get("path")): row for row in _rows(before)}
        kept.update({str(row.get("path")): row for row in files})
        known = before.get("series")
        record = {
            "archiveId": archive_id,
            PARTIAL: True,
            "files": list(kept.values()),
            "series": {**(known if isinstance(known, dict) else {}), **series},
        }
        self.folder(archive_id).mkdir(parents=True, exist_ok=True)
        (self.folder(archive_id) / RECORD).write_text(json.dumps(record), encoding="utf-8")

    def record(self, archive_id: str) -> dict[str, object]:
        """`archive.json`, or `IntakeError` when this computer has none for the archive."""
        path = self.folder(archive_id) / RECORD
        if not path.is_file():
            raise IntakeError(f"no record of {archive_id} on this computer")
        loaded = json.loads(path.read_text(encoding="utf-8"))
        return loaded if isinstance(loaded, dict) else {}


def _rows(record: dict[str, object]) -> list[dict[str, object]]:
    files = record.get("files")
    return [row for row in files if isinstance(row, dict)] if isinstance(files, list) else []


def _regular_files(root: Path) -> Iterator[Path]:
    for path in root.rglob("*"):
        if path.is_file() and not path.is_symlink():
            yield path


def _write(target: Path, chunks: Iterable[bytes], length: int) -> None:
    """The file, exactly its announced length: one larger, or cut off (a dropped connection), is removed and refused."""
    target.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with target.open("wb") as sink:
        for chunk in chunks:
            written += len(chunk)
            if written > length:
                break
            sink.write(chunk)
    if written != length:
        target.unlink()
        raise IntakeError("the file is larger than it says" if written > length else "the file was cut off")
