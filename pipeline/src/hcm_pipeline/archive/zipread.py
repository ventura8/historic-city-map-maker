"""A zip read where it lies, untrusted (docs/research/M20-import-local.md §2.1).

The whole directory is checked before one byte is written: more than 100,000 entries, an entry that expands more than 200 times its
stored size or past 64 GiB, or a total past the free space less 10 GiB refuses the archive. An entry whose name is not a plain
relative path (absolute, `..`, a drive), or that is a link or a device, is refused on its own and reported (`unsafe-path`); the others
are written under the archive's own folder only, each through `safepath.inside`, and each written byte is counted again against its
announced size (`zipfile` stops there and checks the CRC). Names are UTF-8 when the entry says so (flag bit 11), else CP437 as the
specification says.
"""

import stat
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from hcm_pipeline.archive.safepath import UnsafePathError, inside, relative_path

GIB: Final = 1024**3
MAX_ENTRIES: Final = 100_000
MAX_RATIO: Final = 200
MAX_ENTRY_BYTES: Final = 64 * GIB
FREE_MARGIN_BYTES: Final = 10 * GIB
UTF8_FLAG: Final = 0x800
COPY_BYTES: Final = 1024 * 1024
_UNIX_SYSTEM: Final = 3
SPECIAL_TYPES: Final = frozenset({stat.S_IFLNK, stat.S_IFCHR, stat.S_IFBLK, stat.S_IFIFO, stat.S_IFSOCK})
_TYPE_SHIFT: Final = 16


class ZipRefusedError(ValueError):
    """The archive as a whole is refused (too many entries, a bomb, no room); nothing was written."""


@dataclass(frozen=True)
class ZipLimits:
    """The bounds of one archive (the defaults are the design's; tests make them small)."""

    max_entries: int = MAX_ENTRIES
    max_ratio: int = MAX_RATIO
    max_entry_bytes: int = MAX_ENTRY_BYTES
    free_margin_bytes: int = FREE_MARGIN_BYTES


@dataclass(frozen=True)
class ZipResult:
    """The relative paths written, and the entries refused on their own (by their raw name)."""

    written: tuple[str, ...]
    refused: tuple[str, ...]


def entry_name(info: zipfile.ZipInfo) -> str:
    """The entry's name as its writer meant it: UTF-8 with flag 11, else the CP437 the zip specification names."""
    if info.flag_bits & UTF8_FLAG:
        return info.filename
    try:
        return info.filename.encode("cp437").decode("utf-8")
    except UnicodeError:
        return info.filename


def _special(info: zipfile.ZipInfo) -> bool:
    """A link, a device, a pipe or a socket (a Unix file type in the external attributes); a directory is no file to write either."""
    kind = stat.S_IFMT(info.external_attr >> _TYPE_SHIFT)
    return (info.create_system == _UNIX_SYSTEM and kind in SPECIAL_TYPES) or info.is_dir()


def _check_bomb(info: zipfile.ZipInfo, limits: ZipLimits) -> None:
    ratio_bad = info.file_size > max(info.compress_size, 1) * limits.max_ratio
    if ratio_bad or info.file_size > limits.max_entry_bytes:
        raise ZipRefusedError(f"entry {entry_name(info)!r} expands too much ({info.file_size} bytes)")


def check_directory(archive: zipfile.ZipFile, limits: ZipLimits, free_bytes: int) -> list[zipfile.ZipInfo]:
    """The entries, once the whole directory passed the limits; `ZipRefusedError` otherwise."""
    entries = archive.infolist()
    if len(entries) > limits.max_entries:
        raise ZipRefusedError(f"{len(entries)} entries, more than {limits.max_entries}")
    for info in entries:
        _check_bomb(info, limits)
    total = sum(info.file_size for info in entries)
    if total > free_bytes - limits.free_margin_bytes:
        raise ZipRefusedError(f"{total} bytes do not fit the free space")
    return entries


def _chunks(archive: zipfile.ZipFile, info: zipfile.ZipInfo) -> Iterator[bytes]:
    with archive.open(info) as source:
        while chunk := source.read(COPY_BYTES):
            yield chunk


def _write(archive: zipfile.ZipFile, info: zipfile.ZipInfo, target: Path) -> None:
    """Writes the entry: `zipfile` reads no more than its announced size and checks its CRC (a header that lies is a `BadZipFile`)."""
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("wb") as sink:
        for chunk in _chunks(archive, info):
            sink.write(chunk)


def _target(info: zipfile.ZipInfo, root: Path) -> tuple[str, Path] | None:
    """The entry's relative path and file under `root`, or None for an entry refused on its own."""
    if _special(info):
        return None
    try:
        relative = relative_path(entry_name(info))
        return relative, inside(root, relative)
    except UnsafePathError:
        return None


def _not_itself(target: tuple[str, Path] | None, itself: Path) -> tuple[str, Path] | None:
    """The entry's target, unless it is the zip being read."""
    return None if target is None or target[1].resolve() == itself else target


def extract(zip_path: Path, root: Path, free_bytes: int, limits: ZipLimits | None = None) -> ZipResult:
    """Every safe entry of `zip_path` written under `root`; the unsafe ones named in `refused`, directories left out. An entry that
    would land on the zip itself (it lies under `root` while it is read) is refused, never written over the zip."""
    written, refused = list[str](), list[str]()
    itself = zip_path.resolve()
    with zipfile.ZipFile(zip_path) as archive:
        for info in check_directory(archive, limits or ZipLimits(), free_bytes):
            target = _not_itself(_target(info, root), itself)
            if target is None:
                refused.extend([] if info.is_dir() else [entry_name(info)])
                continue
            _write(archive, info, target[1])
            written.append(target[0])
    return ZipResult(tuple(written), tuple(refused))
