"""The grids a join works on, and the pieces of raster its steps read (docs/research/M8-join-interfaces.md §3).

Every level shares one box, aligned on the coarsest level's tile pixels, so a level's cell is an exact block of the next
level's pixels. Distances named in a threshold of the join are ground metres (Mercator metres times `ground_scale`), as
every reported figure of the pipeline is; a tile's size stays in pixels of its level.
"""

import math
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Protocol

import numpy

from hcm_pipeline.geo import FloatArray, Grid, MercatorBox, zoom_resolution
from hcm_pipeline.images import UInt8Array, as_uint8
from hcm_pipeline.raster import gdal

TONE_ZOOM: Final = 12
OWNER_ZOOM: Final = 13
COARSE_ZOOM: Final = 14
FINE_ZOOM: Final = 16


def aligned_box(window: MercatorBox) -> MercatorBox:
    """The window grown to whole pixels of the coarsest level, so every level's grid lies on the tile grid."""
    cell = zoom_resolution(TONE_ZOOM)
    return MercatorBox(
        math.floor(window.left / cell) * cell,
        math.floor(window.bottom / cell) * cell,
        math.ceil(window.right / cell) * cell,
        math.ceil(window.top / cell) * cell,
    )


def level_grid(box: MercatorBox, zoom: int) -> Grid:
    """The aligned box at `zoom`: its size is exact, never one pixel over from a rounding."""
    resolution = zoom_resolution(zoom)
    return Grid(box.left, box.top, resolution, round(box.width / resolution), round(box.height / resolution))


def smoothstep(values: FloatArray) -> FloatArray:
    """0 to 1 with a flat start and a flat end (a field that ends here leaves no crease)."""
    clipped = numpy.clip(values, 0.0, 1.0)
    return numpy.asarray(clipped * clipped * (3.0 - 2.0 * clipped), numpy.float64)


@dataclass(frozen=True)
class PixelBox:
    """A box of a level's pixels (`x1`, `y1` exclusive); it may reach outside the grid."""

    x0: int
    y0: int
    x1: int
    y1: int

    @property
    def size(self) -> tuple[int, int]:
        return self.x1 - self.x0, self.y1 - self.y0

    def around(self, x: int, y: int, half: int) -> PixelBox:
        return PixelBox(x - half, y - half, x + half, y + half)

    def moved(self, dx: int, dy: int) -> PixelBox:
        return PixelBox(self.x0 + dx, self.y0 + dy, self.x1 + dx, self.y1 + dy)

    def grown(self, by: int) -> PixelBox:
        return PixelBox(self.x0 - by, self.y0 - by, self.x1 + by, self.y1 + by)


@dataclass(frozen=True)
class Patch:
    """Grey pixels and their alpha (0: no data)."""

    grey: UInt8Array
    alpha: UInt8Array

    def valid_share(self) -> float:
        return float(numpy.count_nonzero(self.alpha)) / max(self.alpha.size, 1)


class TileSource(Protocol):
    """Something a box of pixels can be read from; outside its grid it has no data."""

    def read(self, box: PixelBox) -> Patch: ...


Fetch = Callable[[int, int, int, int], Patch]


def padded(box: PixelBox, size: tuple[int, int], fetch: Fetch) -> Patch:
    """`box` read through `fetch`, only over the `size` the source has; what lies outside is no data."""
    x0, y0, x1, y1 = max(box.x0, 0), max(box.y0, 0), min(box.x1, size[0]), min(box.y1, size[1])
    width, height = box.size
    grey, alpha = numpy.zeros((height, width), numpy.uint8), numpy.zeros((height, width), numpy.uint8)
    if x1 > x0 and y1 > y0:
        found = fetch(x0, y0, x1 - x0, y1 - y0)
        place = (slice(y0 - box.y0, y1 - box.y0), slice(x0 - box.x0, x1 - box.x0))
        grey[place], alpha[place] = found.grey, found.alpha
    return Patch(grey, alpha)


@dataclass(frozen=True)
class Raster:
    """A whole level of one part, in memory."""

    grid: Grid
    grey: UInt8Array
    alpha: UInt8Array

    def read(self, box: PixelBox) -> Patch:
        def fetch(x: int, y: int, width: int, height: int) -> Patch:
            return Patch(self.grey[y : y + height, x : x + width], self.alpha[y : y + height, x : x + width])

        return padded(box, (self.grid.width, self.grid.height), fetch)


class DatasetSource:
    """Grey and last-band alpha of a warped file or warped VRT: only what is asked for is read (GDAL's cache is bounded)."""

    def __init__(self, path: Path) -> None:
        self._dataset = gdal.Open(str(path))
        self._size = self._dataset.RasterXSize, self._dataset.RasterYSize
        self._grey = self._dataset.GetRasterBand(1)
        self._alpha = self._dataset.GetRasterBand(self._dataset.RasterCount)

    def read(self, box: PixelBox) -> Patch:
        def fetch(x: int, y: int, width: int, height: int) -> Patch:
            return Patch(as_uint8(self._grey.ReadAsArray(x, y, width, height)), as_uint8(self._alpha.ReadAsArray(x, y, width, height)))

        return padded(box, self._size, fetch)

    def averaged(self, grid: Grid) -> Raster:
        """The whole source shrunk to `grid` (each cell the mean of its pixels; a cell only partly covered has an alpha under 255)."""
        size = {"buf_xsize": grid.width, "buf_ysize": grid.height, "resample_alg": gdal.GRIORA_Average}
        return Raster(grid, as_uint8(self._grey.ReadAsArray(**size)), as_uint8(self._alpha.ReadAsArray(**size)))

    def alpha_of(self, x: int, y: int, width: int, height: int, size: tuple[int, int]) -> UInt8Array:
        """A box of the alpha band resampled to `size`."""
        return as_uint8(self._alpha.ReadAsArray(x, y, width, height, size[0], size[1]))

    def close(self) -> None:
        self._dataset.Close()
