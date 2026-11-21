"""The mosaic written in windows (docs/research/M20-import-local.md §19.6): never the whole canvas in memory.

The canvas is a tiled, compressed GeoTIFF (not georeferenced) created paper white. The sheets are pasted one at a time: each reads only its
content box from its own scan, straight at its size on the canvas (GDAL's average, one band at a time into one array,
`raster_io.read_box`), then turned (`Tile`); then the canvas is visited in windows of at most `WINDOW_PX` over the sheet's box, each
read, the pixels this sheet owns set and written back. A pixel belongs to the covering sheet whose centre is nearest (a hard seam, never
a feather: blending line art doubles its lines), worked out per window from the sheets' boxes alone. Peak memory is one sheet at the
canvas's scale, one band and two windows, never a whole scan, whatever the series' size; GDAL's own block cache is held to
`CANVAS_CACHE_BYTES` while the canvas is written, and the C heap's free pages are given back before the first sheet and after each
one (`heap.give_back`: with GDAL's threads, the layout's reads and each sheet's stayed resident in their malloc arenas, 870 MB
against the 800 MB budget for two 12,000 px colour sheets on 16 threads; 653 MB now).
"""

from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import cv2
import numpy

from hcm_pipeline.heap import give_back
from hcm_pipeline.placing.raster_io import RGB, read_box
from hcm_pipeline.placing.sheetwork import Box, oriented, swaps
from hcm_pipeline.placing.streets import UInt8Array, grey_of
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import GTIFF_OPTIONS, driver_of

WINDOW_PX: Final = 2048
OWNER_STEP: Final = 4
CANVAS_CACHE_BYTES: Final = 128 * 1024 * 1024
PAPER: Final = 255


@dataclass(frozen=True)
class Tile:
    """A sheet on the canvas: its scan, its content box there (scan pixels), its variant, and its box on the canvas (left, top, width,
    height in canvas pixels)."""

    path: Path
    box: Box
    variant: int
    left: int
    top: int
    width: int
    height: int
    angle: float = 0.0

    @property
    def centre(self) -> tuple[float, float]:
        return self.left + self.width / 2, self.top + self.height / 2

    def meets(self, window: Box) -> bool:
        x0, y0, x1, y1 = window
        return self.left < x1 and self.left + self.width > x0 and self.top < y1 and self.top + self.height > y0


def _read_size(tile: Tile) -> tuple[int, int]:
    """The size (width, height) the content box is read at: the tile's own, before it is turned."""
    return (tile.height, tile.width) if swaps(tile.variant) else (tile.width, tile.height)


def picture(tile: Tile, colour: bool) -> UInt8Array:
    """The tile's pixels on the canvas: only its content box read, by GDAL straight at the tile's size, then turned (a colour sheet
    costs one copy of itself at the canvas's scale and one band, never its whole scan; M20 §19.6)."""
    image = read_box(tile.path, tile.box, _read_size(tile))
    image = _colour(image) if colour else grey_of(image)
    return oriented(image, tile.variant)


def turned(image: UInt8Array, angle: float) -> tuple[UInt8Array, numpy.ndarray]:
    """The picture turned by a small `angle` (degrees, clockwise) about its centre, on paper, and where it has pixels of its own."""
    height, width = image.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2.0, height / 2.0), -angle, 1.0)
    border = (PAPER,) * (image.shape[2] if image.ndim == RGB else 1)
    moved = cv2.warpAffine(image, matrix, (width, height), flags=cv2.INTER_LINEAR, borderValue=border)
    inside = cv2.warpAffine(numpy.ones((height, width), numpy.uint8), matrix, (width, height), flags=cv2.INTER_NEAREST) > 0
    return numpy.asarray(moved, numpy.uint8), inside


def _colour(image: UInt8Array) -> UInt8Array:
    return image if image.ndim == RGB else numpy.dstack([image] * RGB)


def windows(tile: Tile, size: tuple[int, int]) -> Iterator[Box]:
    """The canvas windows over the tile's box, each at most `WINDOW_PX` on a side, cut at the canvas's edge."""
    x_end, y_end = min(size[0], tile.left + tile.width), min(size[1], tile.top + tile.height)
    for y in range(max(0, tile.top), y_end, WINDOW_PX):
        for x in range(max(0, tile.left), x_end, WINDOW_PX):
            yield x, y, min(x + WINDOW_PX, x_end), min(y + WINDOW_PX, y_end)


def owners(tiles: Sequence[Tile], window: Box) -> numpy.ndarray:
    """Which tile each window pixel takes: the covering one whose centre is nearest (-1 where none covers)."""
    x0, y0, x1, y1 = window
    v, u = numpy.mgrid[y0:y1:OWNER_STEP, x0:x1:OWNER_STEP].astype(numpy.float64) + OWNER_STEP / 2
    best = numpy.full(u.shape, numpy.inf)
    owner = numpy.full(u.shape, -1, numpy.int32)
    for index, tile in enumerate(tiles):
        if not tile.meets(window):
            continue
        inside = (u >= tile.left) & (u < tile.left + tile.width) & (v >= tile.top) & (v < tile.top + tile.height)
        distance = numpy.hypot(u - tile.centre[0], v - tile.centre[1])
        better = inside & (distance < best)
        best[better], owner[better] = distance[better], index
    return numpy.asarray(cv2.resize(owner, (x1 - x0, y1 - y0), interpolation=cv2.INTER_NEAREST), numpy.int32)


def _read(dataset: gdal.Dataset, window: Box) -> UInt8Array:
    x0, y0, x1, y1 = window
    bands = [dataset.GetRasterBand(band).ReadAsArray(x0, y0, x1 - x0, y1 - y0) for band in range(1, dataset.RasterCount + 1)]
    return numpy.asarray(numpy.dstack(bands) if len(bands) > 1 else bands[0], numpy.uint8)


def _write(dataset: gdal.Dataset, window: Box, pixels: UInt8Array) -> None:
    planes = [pixels[:, :, band] for band in range(pixels.shape[2])] if pixels.ndim == RGB else [pixels]
    for band, plane in enumerate(planes, start=1):
        dataset.GetRasterBand(band).WriteArray(plane, window[0], window[1])


@dataclass(frozen=True)
class Canvas:
    """Where the canvas goes, its size (width, height), and whether it is in colour."""

    target: Path
    size: tuple[int, int]
    colour: bool


def _paste(dataset: gdal.Dataset, tiles: Sequence[Tile], index: int, pixels: UInt8Array, size: tuple[int, int]) -> None:
    """The tile's pixels where it owns the canvas. A turned tile (`angle`) sets only its own pixels, and also takes the canvas still
    paper where a neighbour's turned corner left it bare (its box's corners are not the neighbour's pixels)."""
    tile = tiles[index]
    pixels, inside = turned(pixels, tile.angle) if tile.angle else (pixels, None)
    for window in windows(tile, size):
        region = _read(dataset, window)
        x0, y0, x1, y1 = window
        piece = pixels[y0 - tile.top : y1 - tile.top, x0 - tile.left : x1 - tile.left]
        mine = _mine(owners(tiles, window) == index, region, inside, (x0 - tile.left, y0 - tile.top))
        region[mine] = piece[mine]
        _write(dataset, window, region)


def _mine(owned: numpy.ndarray, region: UInt8Array, inside: numpy.ndarray | None, at: tuple[int, int]) -> numpy.ndarray:
    """The window pixels the tile sets: those it owns, or for a turned tile those of its own pixels it owns or finds still paper."""
    if inside is None:
        return owned
    height, width = owned.shape
    own = inside[at[1] : at[1] + height, at[0] : at[0] + width]
    bare = numpy.all(region == PAPER, axis=2) if region.ndim == RGB else region == PAPER
    return numpy.asarray(own & (owned | bare), bool)


def render(tiles: Sequence[Tile], canvas: Canvas) -> Path:
    """Every tile pasted on the canvas, one sheet and one window at a time; the canvas's path."""
    width, height = canvas.size
    bands = RGB if canvas.colour else 1
    previous = gdal.GetCacheMax()
    gdal.SetCacheMax(CANVAS_CACHE_BYTES)
    try:
        dataset = driver_of("GTiff").Create(str(canvas.target), width, height, bands, gdal.GDT_Byte, list(GTIFF_OPTIONS))
        for band in range(1, bands + 1):
            dataset.GetRasterBand(band).Fill(PAPER)
        give_back()
        for index, tile in enumerate(tiles):
            _paste(dataset, tiles, index, picture(tile, canvas.colour), canvas.size)
            dataset.FlushCache()
            give_back()
        dataset.Close()
    finally:
        gdal.SetCacheMax(previous)
    return canvas.target
