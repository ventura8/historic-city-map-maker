"""The scan the georeferencer shows (`steps/common.publish_scan`): its preview and, for a longer scan, its sharper tiles (2026-11-12)."""

import struct
from itertools import pairwise
from pathlib import Path

import cv2
import numpy
from hcm_pipeline import scan_tiles
from hcm_pipeline.contract import SCAN_DETAIL_MAX_PIXELS, SCAN_DETAIL_MAX_PX, SCAN_PREVIEW_MAX_PX, SCAN_TILE_PX
from hcm_pipeline.documents import ScanInfo
from hcm_pipeline.rasters import GeoTiff, write_geotiff
from hcm_pipeline.steps.common import detail_scale, publish_scan

from tests.fakes.world import PipelineWorld
from tests.unit.placing_support import series_context


def _published(world: PipelineWorld, tmp_path: Path, size: tuple[int, int]) -> ScanInfo:
    ctx = series_context(world, tmp_path, [], {"class": "atlas", "encoding": "grey"})
    pixels = numpy.zeros((size[1], size[0]), numpy.uint8)
    pixels[:, ::7] = 255
    local = write_geotiff(ctx.local("scan.tif"), GeoTiff([pixels]))
    return publish_scan(ctx, local, pixels)


def test_happy_path_a_scan_longer_than_its_preview_gets_a_sharper_detail(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-A16-HAPPY-GEOREF-FULL-RES"""
    scan = _published(world, tmp_path, (SCAN_PREVIEW_MAX_PX * 2, 300))

    assert scan.preview_scale == 0.5
    assert scan.detail_scale == 1.0
    assert scan.detail_path is not None
    assert scan.detail_path.endswith("/scan-tiles.bin")
    assert scan.detail_path in world.gcs.objects
    record = scan.as_record()
    assert (record["detailPath"], record["detailScale"]) == (scan.detail_path, 1.0)
    assert ScanInfo.of(record) == scan
    assert SCAN_DETAIL_MAX_PX > SCAN_PREVIEW_MAX_PX


def test_bad_path_a_scan_no_longer_than_its_preview_gets_no_detail(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-A16-BAD-GEOREF-FULL-RES-NONE"""
    scan = _published(world, tmp_path, (1200, 300))

    assert (scan.preview_scale, scan.detail_path, scan.detail_scale) == (1.0, None, None)
    record = scan.as_record()
    assert "detailPath" not in record
    assert "detailScale" not in record
    assert not any(path.endswith("/scan-tiles.bin") for path in world.gcs.objects)
    assert ScanInfo.of(record) == scan


def test_bad_path_a_near_square_scan_gets_a_detail_capped_by_its_area(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-A16-BAD-GEOREF-FULL-RES-NONE"""
    # A 20000 x 20000 GeoTIFF upload: by its long side alone the detail would be 16384 x 16384, about 1 GiB of RGBA in the browser.
    square = detail_scale(20000, 20000)
    assert round(20000 * square) ** 2 <= SCAN_DETAIL_MAX_PIXELS
    assert round(20000 * square) == 8000
    # A 2:1 Hexagon frame: capped by its area too; a long thin Corona strip only by its long side.
    assert (40000 * detail_scale(40000, 20000)) * (20000 * detail_scale(40000, 20000)) <= SCAN_DETAIL_MAX_PIXELS * (1 + 1e-9)
    assert detail_scale(160000, 2000) == SCAN_DETAIL_MAX_PX / 160000
    # At its smallest (a square), the area-capped detail is still about twice the preview: always worth its fetch.
    assert SCAN_DETAIL_MAX_PIXELS**0.5 >= 1.5 * SCAN_PREVIEW_MAX_PX

    scan = _published(world, tmp_path, (9000, 9000))
    assert scan.detail_scale is not None
    assert round(9000 * scan.detail_scale) == 8000
    assert scan.detail_scale > 1.5 * scan.preview_scale


def _tiles(data: bytes) -> tuple[tuple[int, int, int, int, int], list[tuple[int, int]]]:
    """A tiles file's header numbers (version, tile, width, height, count) and each tile's decoded (width, height)."""
    magic, *numbers = scan_tiles.HEADER.unpack_from(data)
    assert magic == scan_tiles.MAGIC
    count = numbers[4]
    offsets = struct.unpack_from(f"<{count + 1}I", data, scan_tiles.HEADER.size)
    assert offsets[-1] == len(data)
    sizes = []
    for start, end in pairwise(offsets):
        decoded = cv2.imdecode(numpy.frombuffer(data[start:end], numpy.uint8), cv2.IMREAD_UNCHANGED)
        assert decoded is not None
        sizes.append((int(decoded.shape[1]), int(decoded.shape[0])))
    return (numbers[0], numbers[1], numbers[2], numbers[3], count), sizes


def test_happy_path_the_sharper_scan_is_tiles_no_larger_than_the_tile_side(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-A16-HAPPY-GEOREF-FULL-RES"""
    scan = _published(world, tmp_path, (SCAN_PREVIEW_MAX_PX + 1500, 1100))

    assert scan.detail_path is not None
    header, sizes = _tiles(world.gcs.objects[scan.detail_path].data)
    # 5596 x 1100 at its own pixels: six columns by two rows, the last column 476 px wide and the last row 76 px high.
    assert header == (scan_tiles.FORMAT_VERSION, SCAN_TILE_PX, 5596, 1100, 12)
    assert sizes[:6] == [(1024, 1024)] * 5 + [(476, 1024)]
    assert sizes[6:] == [(1024, 76)] * 5 + [(476, 76)]
    # No tile decodes to more than 4 MiB of RGBA, and the whole picture is never one JPEG.
    assert max(width * height * 4 for width, height in sizes) <= 4 * 1024 * 1024
    assert not any(path.endswith("/scan-detail.jpg") for path in world.gcs.objects)


def test_bad_path_an_empty_picture_packs_a_header_and_no_tile() -> None:
    """Scenarios: S-A16-BAD-GEOREF-FULL-RES-NONE"""
    data = scan_tiles.pack([], (0, 0), SCAN_TILE_PX)

    assert list(scan_tiles.cut(numpy.zeros((0, 0), numpy.uint8), SCAN_TILE_PX)) == []
    assert _tiles(data) == ((scan_tiles.FORMAT_VERSION, SCAN_TILE_PX, 0, 0, 0), [])
