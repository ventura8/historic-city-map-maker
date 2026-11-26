"""One PMTiles v3 archive from a `{z}/{x}/{y}.webp` tree (docs/research/M12-own-tiles.md), standard library only.

The archive is one object in a bucket: a browser reads a tile with one `Range` request and no preflight, where a tree of files
would mean 25,900 objects, a signed address and two Class A operations for each. The layout follows the PMTiles v3 specification:
a 127-byte header, the gzipped root directory, the gzipped metadata, the gzipped leaf directories, then the tiles in Hilbert order
(`clustered`), each entry a run of one. Sizes come from the files' own stat, so the directories are written first and nothing is
held in memory but the entries. A blank tile is simply absent: the reader answers it from the directory, with no request.
"""

import gzip
import json
import os
import struct
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final, NamedTuple

from hcm_pipeline.geo import Bounds

HEADER_BYTES: Final = 127
# The first 16 KiB of the file hold the header and the root directory, so one read answers both (the specification's rule).
ROOT_BUDGET: Final = 16384 - HEADER_BYTES
LEAF_ENTRIES_START: Final = 4096
LEAF_GROWTH: Final = 1.2
COMPRESSION_NONE: Final = 1
COMPRESSION_GZIP: Final = 2
TILE_TYPE_WEBP: Final = 4
VARINT_LOW_BITS: Final = 0x7F
VARINT_CONTINUES: Final = 0x80
VARINT_SHIFT: Final = 7
E7: Final = 10_000_000
GZIP_LEVEL: Final = 9
COPY_BYTES: Final = 1024 * 1024
TILE_SUFFIX: Final = ".webp"
_HEADER: Final = struct.Struct("<7sBQQQQQQQQQQQBBBBBBiiiiBii")


class PackError(RuntimeError):
    """The tree cannot make an archive (no tile in it: a raster with nothing visible)."""


class Tile(NamedTuple):
    """One file of the tree, by its place on the Hilbert curve."""

    id: int
    path: Path
    size: int


@dataclass(frozen=True)
class Entry:
    """A directory entry: a tile's id, where it lies and how long it is, or a leaf directory (`run` 0)."""

    id: int
    offset: int
    length: int
    run: int = 1


@dataclass(frozen=True)
class Packed:
    """What the archive holds."""

    count: int
    bytes: int


@dataclass(frozen=True)
class ArchiveInfo:
    """What the header says of the tiles."""

    name: str
    bounds: Bounds
    minzoom: int
    maxzoom: int


def tile_id(zoom: int, x: int, y: int) -> int:
    """The tile's place on the Hilbert curve of the PMTiles v3 specification (0 for z0, 1 to 4 for z1 ...)."""
    size = 1 << zoom
    place, half = 0, size >> 1
    while half > 0:
        right, down = int(x & half > 0), int(y & half > 0)
        place += half * half * ((3 * right) ^ down)
        x, y = _rotated(size, x, y, right, down)
        half >>= 1
    return int(4**zoom - 1) // 3 + place


def _rotated(size: int, x: int, y: int, right: int, down: int) -> tuple[int, int]:
    if down:
        return x, y
    return (size - 1 - y, size - 1 - x) if right else (y, x)


def _varint(out: bytearray, value: int) -> None:
    while value >= VARINT_CONTINUES:
        out.append((value & VARINT_LOW_BITS) | VARINT_CONTINUES)
        value >>= VARINT_SHIFT
    out.append(value)


def _offset_of(entries: Sequence[Entry], index: int) -> int:
    """0 for a tile that follows the one before it, else its offset plus one."""
    entry = entries[index]
    follows = index > 0 and entry.offset == entries[index - 1].offset + entries[index - 1].length
    return 0 if follows else entry.offset + 1


def _deltas(entries: Sequence[Entry]) -> list[int]:
    ids = [entry.id for entry in entries]
    return [place - before for place, before in zip(ids, [0, *ids], strict=False)]


def _columns(entries: Sequence[Entry]) -> tuple[list[int], ...]:
    """The count, then the id deltas, the runs, the lengths and the offsets, each column on its own."""
    runs, lengths = [entry.run for entry in entries], [entry.length for entry in entries]
    return [len(entries)], _deltas(entries), runs, lengths, [_offset_of(entries, index) for index in range(len(entries))]


def serialized(entries: Sequence[Entry]) -> bytes:
    """A gzipped directory, column by column (`_columns`)."""
    out = bytearray()
    for column in _columns(entries):
        for value in column:
            _varint(out, value)
    return gzip.compress(bytes(out), GZIP_LEVEL, mtime=0)


def directories(entries: Sequence[Entry]) -> tuple[bytes, bytes]:
    """The root directory and the leaves: one level of leaves, each larger until the root fits its first 16 KiB."""
    root = serialized(entries)
    per_leaf = LEAF_ENTRIES_START
    leaves = b""
    while len(root) > ROOT_BUDGET:
        leaves, pointers = _leaves(entries, per_leaf)
        root = serialized(pointers)
        per_leaf = int(per_leaf * LEAF_GROWTH)
    return root, leaves


def _leaves(entries: Sequence[Entry], per_leaf: int) -> tuple[bytes, list[Entry]]:
    leaves, pointers = bytearray(), list[Entry]()
    for start in range(0, len(entries), per_leaf):
        part = entries[start : start + per_leaf]
        written = serialized(part)
        pointers.append(Entry(part[0].id, len(leaves), len(written), 0))
        leaves += written
    return bytes(leaves), pointers


def _tile_of(zoom: str, x: str, file: Path) -> Tile | None:
    if file.suffix != TILE_SUFFIX or not (zoom.isdigit() and x.isdigit() and file.stem.isdigit()):
        return None
    return Tile(tile_id(int(zoom), int(x), int(file.stem)), file, file.stat().st_size)


def _tiles_in(folder: Path, names: Sequence[str], zoom: str, x: str) -> list[Tile]:
    tiles = (_tile_of(zoom, x, folder / name) for name in names)
    return [tile for tile in tiles if tile is not None]


def tiles_of(tree: Path) -> list[Tile]:
    """Every tile of the tree in Hilbert order (whatever else GDAL left there is no tile)."""
    found = list[Tile]()
    for folder, _, names in os.walk(tree):
        match Path(folder).relative_to(tree).parts:
            case (zoom, x):
                found += _tiles_in(Path(folder), names, zoom, x)
            case _:
                pass
    return sorted(found)


def _entries(tiles: Sequence[Tile]) -> list[Entry]:
    entries, offset = list[Entry](), 0
    for tile in tiles:
        entries.append(Entry(tile.id, offset, tile.size))
        offset += tile.size
    return entries


def _header(info: ArchiveInfo, root: bytes, metadata: bytes, leaves: bytes, tiles: Sequence[Tile]) -> bytes:
    metadata_at = HEADER_BYTES + len(root)
    leaves_at = metadata_at + len(metadata)
    tiles_at = leaves_at + len(leaves)
    size, count = sum(tile.size for tile in tiles), len(tiles)
    west, south, east, north = (round(value * E7) for value in info.bounds.values())
    centre_lng, centre_lat = (west + east) // 2, (south + north) // 2
    return _HEADER.pack(
        *(b"PMTiles", 3),
        *(HEADER_BYTES, len(root), metadata_at, len(metadata), leaves_at, len(leaves), tiles_at, size),
        *(count, count, count),
        *(1, COMPRESSION_GZIP, COMPRESSION_NONE, TILE_TYPE_WEBP),
        *(info.minzoom, info.maxzoom, west, south, east, north, info.minzoom, centre_lng, centre_lat),
    )


def pack(tree: Path, target: Path, info: ArchiveInfo) -> Packed:
    """The archive of `tree` at `target`; `PackError` when the tree holds no tile."""
    tiles = tiles_of(tree)
    if not tiles:
        raise PackError(f"no tile under {tree}")
    root, leaves = directories(_entries(tiles))
    metadata = gzip.compress(json.dumps({"name": info.name, "type": "overlay", "format": "webp"}).encode(), GZIP_LEVEL, mtime=0)
    with target.open("wb") as out:
        out.write(_header(info, root, metadata, leaves, tiles))
        out.write(root)
        out.write(metadata)
        out.write(leaves)
        for tile in tiles:
            with tile.path.open("rb") as source:
                while block := source.read(COPY_BYTES):
                    out.write(block)
    return Packed(len(tiles), target.stat().st_size)
