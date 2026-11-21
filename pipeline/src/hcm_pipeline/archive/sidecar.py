"""The owner's declaration of an archive, `hcm-archive.json` at its root (docs/research/M20-import-local.md §2.3 step 10).

Data, never code: a list of entries, each naming a relative path (a file, or a folder and everything under it) and what the owner knows of
it: title, year and its label, author, scale, rights and source (and who confirmed them), the deepest zoom, a low priority, or a
reason to skip it, and the original the scan was made from (`originalLabel`, `originalUrl`, `originalProbable` when it is only
likely). Each entry is checked on its own: one with an unknown key, a wrong type or an unsafe path is left out and counted
(`Sidecar.refused`), never applied in part. Every entry that covers a file applies, from the root down: a deeper entry's keys override
its folders' (so a sheet series keeps its folder's rights and credit and adds its own year).
"""

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from hcm_pipeline.archive.model import ARCHIVE_SKIP_REASONS, RIGHTS_LICENCES, RIGHTS_STATES
from hcm_pipeline.archive.safepath import UnsafePathError, relative_path

FILE_NAME: Final = "hcm-archive.json"
MAX_BYTES: Final = 1024 * 1024
TEXTS: Final = ("title", "yearLabel", "author", "sourceLabel", "note", "watermark", "confirmedBy", "originalLabel")
URLS: Final = ("sourceUrl", "originalUrl")
FLAGS: Final = ("originalProbable",)
_CHOICES: Final = {"licence": RIGHTS_LICENCES, "state": RIGHTS_STATES, "skip": ARCHIVE_SKIP_REASONS, "priority": ("low", "normal")}
_NUMBERS: Final = ("year", "scale", "maxzoom")
_HTTPS: Final = "https://"
_MAX_TEXT: Final = 200
_KNOWN: Final = frozenset({"path", *URLS, *FLAGS, *TEXTS, *_CHOICES, *_NUMBERS})


@dataclass(frozen=True)
class Entry:
    """One validated entry: its relative path and its fields."""

    path: str
    fields: Mapping[str, object]

    def covers(self, path: str) -> bool:
        return path == self.path or path.startswith(f"{self.path}/")


@dataclass(frozen=True)
class Sidecar:
    entries: tuple[Entry, ...] = ()
    refused: int = 0

    def entry_for(self, path: str) -> Entry | None:
        """Every entry that covers `path`, merged from the root down (a deeper entry's keys override); named by the deepest."""
        return _merged(sorted((entry for entry in self.entries if entry.covers(path)), key=lambda entry: len(entry.path)))


def _merged(found: list[Entry]) -> Entry | None:
    """The entries' fields, each over the ones before it, under the last one's path; none for no entry."""
    if not found:
        return None
    return Entry(found[-1].path, {key: value for entry in found for key, value in entry.fields.items()})


def _text_ok(value: object) -> bool:
    return isinstance(value, str) and 0 < len(value.strip()) <= _MAX_TEXT


def _number_ok(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _url_ok(value: object) -> bool:
    return _text_ok(value) and str(value).startswith(_HTTPS)


def _flag_ok(value: object) -> bool:
    return value is True


def _checker(key: str) -> Callable[[object], bool]:
    if key in _NUMBERS:
        return _number_ok
    if key in URLS:
        return _url_ok
    return _flag_ok if key in FLAGS else _text_ok


def _field_ok(key: str, value: object) -> bool:
    choices = _CHOICES.get(key)
    return value in choices if choices is not None else _checker(key)(value)


def _shape_ok(raw: object) -> bool:
    return isinstance(raw, dict) and set(raw) <= _KNOWN and isinstance(raw.get("path"), str)


def _path_of(raw: str) -> str | None:
    try:
        return relative_path(raw)
    except UnsafePathError:
        return None


def _fields_of(raw: Mapping[str, object]) -> dict[str, object] | None:
    fields = {key: value for key, value in raw.items() if key != "path"}
    return fields if all(_field_ok(key, value) for key, value in fields.items()) else None


def entry_of(raw: object) -> Entry | None:
    """The entry, when every key is known and every value valid; else None."""
    if not isinstance(raw, dict) or not _shape_ok(raw):
        return None
    fields, path = _fields_of(raw), _path_of(str(raw["path"]))
    return None if fields is None or path is None else Entry(path, fields)


def _series_of(text: str) -> list[object] | None:
    """The document's `series` list, or None when it is not a JSON object with one."""
    try:
        document = json.loads(text)
    except ValueError:
        return None
    raw = document.get("series") if isinstance(document, dict) else None
    return raw if isinstance(raw, list) else None


def _counted(entries: list[Entry | None]) -> Sidecar:
    """The valid entries, and how many of the others were refused."""
    return Sidecar(tuple(entry for entry in entries if entry is not None), sum(entry is None for entry in entries))


def parse(text: str) -> Sidecar:
    """The sidecar's valid entries and how many were refused; a file that is not a JSON object with `series` gives none."""
    raw = _series_of(text)
    return Sidecar(refused=1) if raw is None else _counted([entry_of(item) for item in raw])


def _folders(root: Path) -> list[Path]:
    """The archive root's own folders (none for a root that is not one); links are never followed."""
    if not root.is_dir():
        return []
    return [child for child in root.iterdir() if child.is_dir() and not child.is_symlink()]


def _located(root: Path) -> Path:
    """The sidecar at the archive's root, or in its one top folder: a folder chosen whole arrives under its own name."""
    path = root / FILE_NAME
    folders = [] if path.is_file() else _folders(root)
    return folders[0] / FILE_NAME if len(folders) == 1 else path


def read(root: Path) -> Sidecar:
    """The archive's sidecar, if it has one (and it is not larger than 1 MiB); its paths stay relative to the archive's root."""
    path = _located(root)
    if not path.is_file() or path.stat().st_size > MAX_BYTES:
        return Sidecar(refused=int(path.is_file()))
    return parse(path.read_text(encoding="utf-8", errors="replace"))
