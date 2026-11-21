"""`ObjectStore` over a folder of the owner's computer: the worker's `/work` (docs/research/M7-local-worker.md §1.3).

The USGS delivery (`usgs-raw/`), the job's scratch (`work/`) and the reference cache (`reference/`) live here, so raw
scans never leave the computer. An object is the file at its path under the root; its generation is the file's
modification time in nanoseconds (it changes whenever the file is written again, as a Cloud Storage generation does).
A resumable session is a partial file under `.sessions/` with a small JSON record of its target and size, named by the
address the store hands out (`local-session:<32 hex>`), so a session outlives the process like a Cloud Storage one does
(`fetch` keeps the address in its checkpoint). Uploads are create-only as in `GcsObjectStore`: an identical file there
is kept, a different one replaced; a session's object is created only when it does not exist yet. A new session is
refused when the disk could not hold the delivery and its unpacked segments, before its first byte arrives. `sweep` lets go
what no job needs any more (`sweep.py`: finished jobs' scratch after two days, unknown ones after 14, old deliveries and an
interrupted write's leftovers); never the scratch of the job just claimed nor of a job the server still lists.

Every write is durable across a power cut (`durable.py`): a copy goes through a hidden `.tmp` sibling, `fsync`, rename and
the folder's `fsync`; each chunk of a session is `fsync`ed before the next is asked for, so its offset never runs ahead of
its bytes.
"""

import json
import math
import os
import re
import secrets
import shutil
from collections.abc import Iterator, Sequence
from contextlib import AbstractContextManager
from pathlib import Path
from typing import IO, Final

from hcm_pipeline.contract import Errors
from hcm_pipeline.durable import copy_atomic, fsync_folder, replace_durably, write_atomic
from hcm_pipeline.jobs import StepFailedError
from hcm_pipeline.log import get_logger
from hcm_pipeline.objects import ObjectInfo, ObjectStoreError, PreconditionFailedError, SessionExpiredError, md5_of
from hcm_pipeline.worker.sweep import (
    DAY_SECONDS,
    DELIVERY_DAYS,
    SESSIONS,
    TEMP_MAX_AGE_NOW_SECONDS,
    TEMP_MAX_AGE_SECONDS,
    SweepRules,
    delivery_goes,
    leftovers,
    visible,
    work_goes,
    written_at,
)

LOG = get_logger("worker.local_store")
SESSION_PREFIX: Final = "local-session:"
_SESSION: Final = re.compile(r"local-session:([0-9a-f]{32})")
_PART: Final = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,199}")
_MAX_DEPTH: Final = 12
# The disk a delivery needs while it is unpacked: the archive itself and its larger TIFF segments (8.7 GB gave 13 GB more).
ROOM_FACTOR: Final = 2.6
GIGABYTE: Final = 1_000_000_000


def _segment(part: str) -> bool:
    return _PART.fullmatch(part) is not None and ".." not in part


def _checked(path: str) -> list[str]:
    """The path's segments; an absolute path, a `..`, an empty or hidden segment is refused (it would leave its prefix)."""
    parts = path.split("/")
    if len(parts) > _MAX_DEPTH or not all(map(_segment, parts)):
        raise ObjectStoreError(f"not an object path of the work folder: {path!r}")
    return parts


def _require_room(folder: Path, size: int) -> None:
    """Refuses a delivery of `size` bytes this disk could not unpack: better now than after hours of download."""
    free, needed = shutil.disk_usage(folder).free, math.ceil(size * ROOM_FACTOR)
    if free < needed:
        room = f"{free / GIGABYTE:.1f} GB are free in the work folder; this delivery of {size / GIGABYTE:.1f} GB"
        raise StepFailedError(Errors.PROCESSING_FAILED, f"{room} needs about {needed / GIGABYTE:.1f} GB: free some disk and try again")


def _removed(folder: Path) -> bool:
    shutil.rmtree(folder, ignore_errors=True)
    return not folder.exists()


class LocalObjectStore:
    """Objects as files under `root` (the work folder)."""

    def __init__(self, root: Path) -> None:
        self._root = root

    def _file(self, path: str) -> Path:
        return self._root.joinpath(*_checked(path))

    def _info(self, path: str, file: Path) -> ObjectInfo:
        status = file.stat()
        return ObjectInfo(path, status.st_size, str(status.st_mtime_ns))

    def stat(self, path: str) -> ObjectInfo | None:
        file = self._file(path)
        return self._info(path, file) if file.is_file() else None

    def upload_file(self, local: Path, path: str, content_type: str) -> ObjectInfo:
        """A copy of `local` at `path`; an identical file already there is kept (its generation unchanged)."""
        existing, file = self.stat(path), self._file(path)
        if existing is not None and existing.size == local.stat().st_size and md5_of(file) == md5_of(local):
            return existing
        # Durable, and a copy cut short by a full disk leaves nothing behind (it would keep the room the retry needs).
        copy_atomic(local, file)
        return self._info(path, file)

    def download_file(self, path: str, local: Path) -> ObjectInfo:
        file = self._file(path)
        if not file.is_file():
            raise ObjectStoreError(f"no object at {path}")
        shutil.copyfile(file, local)
        return self._info(path, file)

    def open_read(self, path: str) -> AbstractContextManager[IO[bytes]]:
        file = self._file(path)
        if not file.is_file():
            raise ObjectStoreError(f"no object at {path}")
        return file.open("rb")

    def _walk(self) -> Iterator[Path]:
        """Every object's file, sessions and partial uploads left out (both are hidden names)."""
        for folder, folders, files in os.walk(self._root):
            folders[:] = sorted(filter(visible, folders))
            yield from (Path(folder, name) for name in sorted(filter(visible, files)))

    def list(self, prefix: str) -> list[ObjectInfo]:
        found = ((file.relative_to(self._root).as_posix(), file) for file in self._walk())
        return [self._info(path, file) for path, file in found if path.startswith(prefix)]

    def delete(self, path: str) -> None:
        """The object's file, and the folders it leaves empty up to (not including) `work/` or `usgs-raw/` themselves."""
        file = self._file(path)
        file.unlink(missing_ok=True)
        folder, top = file.parent, self._root / path.split("/", 1)[0]
        while folder != top and folder.is_dir() and not any(folder.iterdir()):
            folder.rmdir()
            folder = folder.parent

    # --- the sweep ------------------------------------------------------------------------------------------

    def sweep_leftovers(self, now: float, max_age: float = TEMP_MAX_AGE_SECONDS) -> Sequence[str]:
        """An interrupted write's `*.tmp` and `*.part` files not written for `max_age` (a power cut's leftovers), removed."""
        removed = []
        for file in leftovers(self._root):
            if written_at(file) < now - max_age:
                file.unlink(missing_ok=True)
                removed.append(file.relative_to(self._root).as_posix())
        return removed

    def _going(self, now: float, rules: SweepRules) -> Sequence[Path]:
        """The job folders that go; the old scenes' folders only on a pass that claimed nothing: nothing here says which
        delivery a claimed job reads."""
        work = [folder for folder in self._root.glob("work/*/*") if work_goes(self._root, folder, now, rules)]
        scenes = [] if rules.claimed is not None else self._root.glob("usgs-raw/*/*")
        return [*work, *filter(lambda folder: delivery_goes(folder, now), scenes)]

    def _sweep_sessions(self, now: float) -> None:
        """Unfinished downloads no run came back to; `fetch` then starts a new session, as after Cloud Storage's own week."""
        for record in (self._root / SESSIONS).glob("*.json"):
            part = record.with_suffix(".part")
            if max(written_at(record), written_at(part)) < now - DELIVERY_DAYS * DAY_SECONDS:
                part.unlink(missing_ok=True)
                record.unlink()

    def _swept(self, now: float, rules: SweepRules) -> Sequence[str]:
        """The folders removed now; the unfinished downloads go too on a pass that claimed nothing."""
        self.sweep_leftovers(now, TEMP_MAX_AGE_NOW_SECONDS if rules.now_mode else TEMP_MAX_AGE_SECONDS)
        if rules.claimed is None:
            self._sweep_sessions(now)
        return [folder.relative_to(self._root).as_posix() for folder in self._going(now, rules) if _removed(folder)]

    def sweep(self, now: float, claimed: str | None, rules: SweepRules | None = None) -> Sequence[str]:
        """What no job needs any more removed (`sweep.py`); `claimed` is the `work/` prefix of the job about to run. A disk
        that refuses is logged and tried again at the next pass: the sweep never stops the loop."""
        try:
            swept = self._swept(now, SweepRules(claimed) if rules is None else SweepRules(claimed, rules.states, rules.now_mode))
        except OSError as error:
            LOG.warning("the work folder could not be swept: %s", type(error).__name__)
            return []
        if swept:
            LOG.info("swept from the work folder, no job needs them: %s", ", ".join(swept))
        return swept

    # --- resumable sessions -------------------------------------------------------------------------------

    def _session(self, session: str) -> tuple[Path, Path]:
        """The session's record and partial file; SessionExpiredError when there is no such session."""
        found = _SESSION.fullmatch(session)
        record = self._root / SESSIONS / f"{found.group(1)}.json" if found else None
        if record is None or not record.is_file():
            raise SessionExpiredError("the local upload session is gone")
        return record, record.with_suffix(".part")

    def start_resumable(self, path: str, size: int, content_type: str) -> str:
        if self.stat(path) is not None:
            raise PreconditionFailedError(f"the local upload of {path}: the object exists")
        name = secrets.token_hex(16)
        folder = self._root / SESSIONS
        folder.mkdir(parents=True, exist_ok=True)
        _require_room(folder, size)
        write_atomic(folder / f"{name}.part", b"")
        write_atomic(folder / f"{name}.json", json.dumps({"path": path, "size": size}))
        return SESSION_PREFIX + name

    def resumable_offset(self, session: str, size: int) -> int | ObjectInfo:
        record, part = self._session(session)
        return self._state(record, part)

    def write_chunk(self, session: str, offset: int, data: bytes, size: int) -> int | ObjectInfo:
        record, part = self._session(session)
        if data and (not part.is_file() or offset != part.stat().st_size):
            raise ObjectStoreError("the local upload: the chunk does not start where the session ends")
        if data:
            with part.open("ab") as file:
                file.write(data)
                file.flush()
                # A power cut keeps no offset ahead of its bytes: the next chunk asked for starts where the disk ends.
                os.fsync(file.fileno())
        return self._state(record, part)

    def _state(self, record: Path, part: Path) -> int | ObjectInfo:
        """The bytes the session holds, or its object once every byte arrived (created then, create-only)."""
        target = json.loads(record.read_text(encoding="utf-8"))
        path, size = str(target["path"]), int(target["size"])
        if not part.is_file():
            return self._finished(path)
        held = part.stat().st_size
        return held if held < size else self._finish(path, part)

    def _finished(self, path: str) -> ObjectInfo:
        info = self.stat(path)
        if info is None:
            raise SessionExpiredError("the local upload session's object is gone")
        return info

    def _finish(self, path: str, part: Path) -> ObjectInfo:
        file = self._file(path)
        if file.exists():
            raise PreconditionFailedError(f"the local upload of {path}: the object exists")
        file.parent.mkdir(parents=True, exist_ok=True)
        replace_durably(part, file)
        fsync_folder(part.parent)
        return self._info(path, file)


def held_films(root: Path, city_id: str) -> list[str]:
    """2026-11-13: the jobs whose stitched film (`work/{city}/{job}/frame.json`) is in this work folder, newest first."""
    frames = [path for path in (root / "work" / city_id).glob("*/frame.json") if path.is_file()]
    return [path.parent.name for path in sorted(frames, key=written_at, reverse=True)]
