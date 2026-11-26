"""Relative paths inside an archive (docs/research/M20-import-local.md §2.1): validated, never joined raw.

A path from a zip entry or the page's upload header is untrusted. It must be relative, POSIX-separated after a backslash is read as a
separator, free of `..`, `.`, empty parts, NUL and control characters, and at most 500 characters; it is then joined under the archive's
own folder and checked again to lie inside it (a symlinked parent would otherwise lead out).
"""

import unicodedata
from pathlib import Path, PurePosixPath
from typing import Final

MAX_PATH_CHARS: Final = 500
_DRIVE: Final = ":"
_CONTROL_BELOW: Final = 0x20


class UnsafePathError(ValueError):
    """The path would leave the archive's folder, or is not a plain relative path."""


def _printable(part: str) -> bool:
    return min((ord(char) for char in part), default=0) >= _CONTROL_BELOW


def _plain(part: str) -> bool:
    return part not in {"", ".", ".."} and _DRIVE not in part and _printable(part)


def _sized(text: str) -> bool:
    return 0 < len(text) <= MAX_PATH_CHARS and not text.startswith("/")


def relative_path(raw: str) -> str:
    """The archive-relative POSIX path of `raw` (NFC), or `UnsafePathError`."""
    text = unicodedata.normalize("NFC", raw.replace("\\", "/"))
    parts = text.split("/")
    if not (_sized(text) and all(map(_plain, parts))):
        raise UnsafePathError(f"not a plain relative path: {raw!r}")
    return str(PurePosixPath(*parts))


def inside(root: Path, relative: str) -> Path:
    """`relative` (already checked) under `root`; `UnsafePathError` when its resolved place is outside `root`."""
    target = root.joinpath(*relative_path(relative).split("/"))
    base = root.resolve()
    if not target.resolve().is_relative_to(base):
        raise UnsafePathError(f"leaves the archive: {relative!r}")
    return target
