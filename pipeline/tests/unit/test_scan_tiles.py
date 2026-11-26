"""The sharper scan's tiles in one file (`scan_tiles.py`): cutting an image into tiles and binary packing with offsets."""

import struct

import numpy
import pytest
from hcm_pipeline.scan_tiles import FORMAT_VERSION, HEADER, MAGIC, cut, pack


def test_happy_path_cut_slices_image_into_tiles_row_by_row() -> None:
    # A 25x28 image cut into tiles of side 10 yields 3x3 = 9 tiles.
    # The rightmost column (width 8) and bottom row (height 5) are smaller.
    image = numpy.arange(25 * 28, dtype=numpy.uint8).reshape((25, 28))

    tiles = list(cut(image, 10))

    assert len(tiles) == 9
    expected_shapes = [
        (10, 10),
        (10, 10),
        (10, 8),
        (10, 10),
        (10, 10),
        (10, 8),
        (5, 10),
        (5, 10),
        (5, 8),
    ]
    assert [tile.shape for tile in tiles] == expected_shapes
    assert numpy.array_equal(tiles[0], image[0:10, 0:10])
    assert numpy.array_equal(tiles[1], image[0:10, 10:20])
    assert numpy.array_equal(tiles[2], image[0:10, 20:28])
    assert numpy.array_equal(tiles[3], image[10:20, 0:10])
    assert numpy.array_equal(tiles[4], image[10:20, 10:20])
    assert numpy.array_equal(tiles[5], image[10:20, 20:28])
    assert numpy.array_equal(tiles[6], image[20:25, 0:10])
    assert numpy.array_equal(tiles[7], image[20:25, 10:20])
    assert numpy.array_equal(tiles[8], image[20:25, 20:28])


def test_bad_path_cut_with_zero_tile_side_raises() -> None:
    image = numpy.zeros((20, 20), dtype=numpy.uint8)

    with pytest.raises(ValueError, match="must not be zero"):
        list(cut(image, 0))


def test_happy_path_pack_encodes_header_offsets_and_tile_payloads() -> None:
    tiles = [b"TILE_A", b"TILE_B_LONGER", b"TILE_C"]
    size = (28, 25)
    tile_side = 10

    data = pack(tiles, size, tile_side)

    magic, version, unpacked_tile, width, height, count = HEADER.unpack_from(data, 0)
    assert magic == MAGIC
    assert version == FORMAT_VERSION
    assert unpacked_tile == tile_side
    assert width == size[0]
    assert height == size[1]
    assert count == len(tiles)

    offsets = struct.unpack_from(f"<{count + 1}I", data, HEADER.size)
    assert len(offsets) == count + 1
    assert offsets[0] == HEADER.size + 4 * (count + 1)
    assert offsets[-1] == len(data)
    assert [data[offsets[index] : offsets[index + 1]] for index in range(count)] == tiles


@pytest.mark.parametrize(
    ("size", "tile"),
    [
        ((-1, 25), 10),
        ((28, -1), 10),
        ((28, 25), -1),
    ],
)
def test_bad_path_pack_with_negative_dimensions_or_tile_raises(size: tuple[int, int], tile: int) -> None:
    with pytest.raises(struct.error):
        pack([b"tile_bytes"], size, tile)
