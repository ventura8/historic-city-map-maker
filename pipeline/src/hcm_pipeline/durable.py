"""Writes that survive a power cut (RESILIENCE-AUDIT P0-2, docs/research/M7-local-worker.md *Crashes and power cuts*).

A rename alone is not durable: after a power cut ext4, XFS, NTFS and APFS may publish the new name before its data reached
the disk, which leaves a truncated or empty file that looks present. Every durable write here therefore goes to a hidden
sibling (`.<name>.<hex>.tmp`), is flushed and `fsync`ed, renamed over the target, and then the folder itself is `fsync`ed so
the rename is on the disk too. A crash at any point leaves either the old file or the new one, never half of one; the
leftover `.tmp` is swept after an hour (`LocalObjectStore.sweep_temp_files`).
"""

import json
import os
import secrets
import shutil
from collections.abc import Mapping
from pathlib import Path


def fsync_folder(folder: Path) -> None:
    """The folder's entries on the disk (a rename into it, a new file). A file system that cannot open a folder for it
    (Windows' own, not the worker's Linux volume) keeps what it has: nothing more can be done there."""
    try:
        descriptor = os.open(folder, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def fsync_file(path: Path) -> None:
    """The file's bytes on the disk (a copy made by another call, a partial download before its rename)."""
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def temp_beside(target: Path) -> Path:
    """The hidden sibling a durable write goes through (the sweep knows its `.tmp` suffix)."""
    return target.with_name(f".{target.name}.{secrets.token_hex(4)}.tmp")


def replace_durably(temp: Path, target: Path) -> None:
    """`temp`, already written, made durable and moved over `target`; the rename made durable too."""
    fsync_file(temp)
    os.replace(temp, target)
    fsync_folder(target.parent)


def write_atomic(target: Path, data: bytes | str, mode: int | None = None) -> None:
    """`data` at `target`, all or nothing across a power cut; `mode` (e.g. 0o600) is set before the first byte."""
    raw = data.encode("utf-8") if isinstance(data, str) else data
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = temp_beside(target)
    try:
        descriptor = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o666 if mode is None else mode)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        if mode is not None:
            os.chmod(temp, mode)
        os.replace(temp, target)
        fsync_folder(target.parent)
    finally:
        temp.unlink(missing_ok=True)


def write_json_atomic(target: Path, payload: Mapping[str, object]) -> None:
    """`payload` as UTF-8 JSON at `target`, all or nothing across a power cut."""
    write_atomic(target, json.dumps(payload))


def copy_atomic(source: Path, target: Path) -> None:
    """A copy of `source` at `target`, all or nothing across a power cut (a copy cut short by a full disk leaves nothing)."""
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = temp_beside(target)
    try:
        shutil.copyfile(source, temp)
        replace_durably(temp, target)
    finally:
        temp.unlink(missing_ok=True)
