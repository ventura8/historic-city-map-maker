"""The georeferencer's sharper scan as tiles in one file (`scan-tiles.bin`, docs/research/M3-interfaces.md §10.4).

A browser decodes a JPEG whole: a 16,384 px picture is about 1 GiB of RGBA. The sharper scan is therefore cut into
square JPEG tiles of `SCAN_TILE_PX` and packed in one object, so the scan pane decodes only the tiles it shows. The file,
little-endian: `HCMT`, then five `uint32` (the format's version, the tile's side, the picture's width and height, the
number of tiles), then one `uint32` per tile plus one (each tile's first byte, row by row; the last is the file's
length), then the tiles' JPEG bytes. `packages/ui/src/admin/georef/scan-tiles.ts` reads the same layout.
"""

import struct
from collections.abc import Iterator, Sequence
from typing import Final

from hcm_pipeline.images import UInt8Array

MAGIC: Final = b"HCMT"
FORMAT_VERSION: Final = 1
HEADER: Final = struct.Struct("<4s5I")


def cut(image: UInt8Array, tile: int) -> Iterator[UInt8Array]:
    """`image` as tiles of at most `tile` px a side, row by row (the last of a row and the last row may be smaller)."""
    height, width = (int(side) for side in image.shape[:2])
    for top in range(0, height, tile):
        for left in range(0, width, tile):
            yield image[top : top + tile, left : left + tile]


def pack(tiles: Sequence[bytes], size: tuple[int, int], tile: int) -> bytes:
    """The tiles' file: the header, the offsets, the tiles (`size` is the whole picture's width and height)."""
    first = HEADER.size + 4 * (len(tiles) + 1)
    offsets = [first]
    for encoded in tiles:
        offsets.append(offsets[-1] + len(encoded))
    header = HEADER.pack(MAGIC, FORMAT_VERSION, tile, size[0], size[1], len(tiles))
    return b"".join((header, struct.pack(f"<{len(offsets)}I", *offsets), *tiles))
