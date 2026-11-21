"""A small PMTiles v3 reader for the tests: it knows only the specification, none of the writer's code but its `Entry` and `tile_id`."""

import gzip
import struct
from typing import Final

from hcm_pipeline.tiles.pack import Entry, tile_id

HEADER: Final = struct.Struct("<7sBQQQQQQQQQQQBBBBBBiiiiBii")
NAMES: Final = (
    "magic",
    "version",
    "root_at",
    "root_bytes",
    "metadata_at",
    "metadata_bytes",
    "leaves_at",
    "leaves_bytes",
    "tiles_at",
    "tiles_bytes",
    "addressed",
    "entries",
    "contents",
    "clustered",
    "internal_compression",
    "tile_compression",
    "tile_type",
    "minzoom",
    "maxzoom",
    "west",
    "south",
    "east",
    "north",
    "centre_zoom",
    "centre_lng",
    "centre_lat",
)


def _varints(data: bytes, start: int, count: int) -> tuple[list[int], int]:
    values, at = list[int](), start
    for _ in range(count):
        value, shift = 0, 0
        while data[at] & 0x80:
            value |= (data[at] & 0x7F) << shift
            shift += 7
            at += 1
        values.append(value | (data[at] << shift))
        at += 1
    return values, at


class Archive:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.header = dict(zip(NAMES, HEADER.unpack_from(data), strict=True))
        assert self.header["magic"] == b"PMTiles"

    @staticmethod
    def directory(compressed: bytes) -> list[Entry]:
        data = gzip.decompress(compressed)
        (count,), at = _varints(data, 0, 1)
        deltas, at = _varints(data, at, count)
        runs, at = _varints(data, at, count)
        lengths, at = _varints(data, at, count)
        offsets, _ = _varints(data, at, count)
        entries, place, end = list[Entry](), 0, 0
        for delta, run, length, offset in zip(deltas, runs, lengths, offsets, strict=True):
            place += delta
            start = end if offset == 0 else offset - 1
            entries.append(Entry(place, start, length, run))
            end = start + length
        return entries

    def metadata(self) -> bytes:
        return self.data[self.header["metadata_at"] : self.header["metadata_at"] + self.header["metadata_bytes"]]

    def _find(self, entries: list[Entry], place: int) -> Entry | None:
        before = [entry for entry in entries if entry.id <= place]
        return before[-1] if before else None

    def tile(self, zoom: int, x: int, y: int) -> bytes | None:
        place = tile_id(zoom, x, y)
        root = self.data[self.header["root_at"] : self.header["root_at"] + self.header["root_bytes"]]
        found = self._find(self.directory(root), place)
        if found is not None and found.run == 0:
            leaf = self.data[self.header["leaves_at"] + found.offset :][: found.length]
            found = self._find(self.directory(leaf), place)
        if found is None or found.id != place:
            return None
        return self.data[self.header["tiles_at"] + found.offset :][: found.length]
