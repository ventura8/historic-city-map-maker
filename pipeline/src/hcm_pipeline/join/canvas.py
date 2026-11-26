"""The grids a join works on, and the pieces of raster its steps read (docs/research/M8-join-interfaces.md §3).

Every level shares one box, aligned on the coarsest level's tile pixels, so a level's cell is an exact block of the next
level's pixels. Distances named in a threshold of the join are ground metres (Mercator metres times `ground_scale`), as
every reported figure of the pipeline is; a tile's size stays in pixels of its level.
"""

import math
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final, Protocol

import numpy
import numpy.typing

from hcm_pipeline.geo import FloatArray, Grid, MercatorBox, zoom_resolution
from hcm_pipeline.images import UInt8Array, as_uint8
from hcm_pipeline.raster import gdal

TONE_ZOOM: Final = 12
OWNER_ZOOM: Final = 13
COARSE_ZOOM: Final = 14
FINE_ZOOM: Final = 16


def spilled(path: Path, array: numpy.typing.NDArray[Any]) -> numpy.typing.NDArray[Any]:
    """`array` kept in a file of the scratch folder and paged in as it is read: a join of up to `JOIN_MAX_PARTS` (64) parts holds
    a whole level per part, which together would not fit a modest computer's memory (M8 §3, the owner's 48 sheets, 2026-11-22).
    The file must not be written again while the result is in use, so every caller names a new one."""
    kept = numpy.lib.format.open_memmap(path, mode="w+", dtype=array.dtype, shape=array.shape)
    kept[...] = array
    kept.flush()
    del kept
    return numpy.asarray(numpy.lib.format.open_memmap(path, mode="r"))


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
    """Grey pixels and their alpha (0: no data); a colour part's red, green and blue too, when they were asked for."""

    grey: UInt8Array
    alpha: UInt8Array
    colour: UInt8Array | None = None

    def valid_share(self) -> float:
        return float(numpy.count_nonzero(self.alpha)) / max(self.alpha.size, 1)


class TileSource(Protocol):
    """Something a box of pixels can be read from; outside its grid it has no data."""

    def read(self, box: PixelBox) -> Patch: ...


Fetch = Callable[[int, int, int, int], Patch]


def padded(box: PixelBox, size: tuple[int, int], fetch: Fetch, with_colour: bool = False) -> Patch:
    """`box` read through `fetch`, only over the `size` the source has; what lies outside is no data."""
    x0, y0, x1, y1 = max(box.x0, 0), max(box.y0, 0), min(box.x1, size[0]), min(box.y1, size[1])
    width, height = box.size
    grey, alpha = numpy.zeros((height, width), numpy.uint8), numpy.zeros((height, width), numpy.uint8)
    colour = numpy.zeros((height, width, 3), numpy.uint8) if with_colour else None
    if x1 > x0 and y1 > y0:
        found = fetch(x0, y0, x1 - x0, y1 - y0)
        place = (slice(y0 - box.y0, y1 - box.y0), slice(x0 - box.x0, x1 - box.x0))
        grey[place], alpha[place] = found.grey, found.alpha
        _place_colour(colour, place, found.colour)
    return Patch(grey, alpha, colour)


def _place_colour(colour: UInt8Array | None, place: tuple[slice, slice], found: UInt8Array | None) -> None:
    if colour is not None and found is not None:
        colour[place] = found


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


COLOUR_BANDS: Final = 4
RGB: Final = 3
# ITU-R BT.601 luma: a colour part's grey, so its tones and seams are measured as a grey part's are.
LUMA: Final = (0.299, 0.587, 0.114)


def luma(colour: UInt8Array) -> UInt8Array:
    """The grey of red, green and blue (the last axis)."""
    weighted = colour[..., 0] * LUMA[0] + colour[..., 1] * LUMA[1] + colour[..., 2] * LUMA[2]
    return as_uint8(numpy.clip(weighted + 0.5, 0, 255))


class DatasetSource:
    """Grey and last-band alpha of a warped file or warped VRT: only what is asked for is read (GDAL's cache is bounded).

    A colour part (red, green, blue and alpha) reads as its luma, and `read_colour` gives its three bands as well (bug of
    2026-11-22: the 2017 orthophoto joined grey).
    """

    def __init__(self, path: Path) -> None:
        self._dataset = gdal.Open(str(path))
        self._size = self._dataset.RasterXSize, self._dataset.RasterYSize
        self.colour = self._dataset.RasterCount >= COLOUR_BANDS
        self._bands = [self._dataset.GetRasterBand(index) for index in ((1, 2, 3) if self.colour else (1,))]
        self._grey = self._bands[0]
        self._alpha = self._dataset.GetRasterBand(self._dataset.RasterCount)

    def _rgb(self, x: int, y: int, width: int, height: int) -> UInt8Array:
        return numpy.dstack([as_uint8(band.ReadAsArray(x, y, width, height)) for band in self._bands])

    def _rgb_on(self, grid: Grid) -> UInt8Array:
        """The three bands shrunk to `grid`, each cell the mean of its pixels."""
        size = {"buf_xsize": grid.width, "buf_ysize": grid.height, "resample_alg": gdal.GRIORA_Average}
        return numpy.dstack([as_uint8(band.ReadAsArray(**size)) for band in self._bands])

    def _fetch(self, with_colour: bool) -> Fetch:
        def fetch(x: int, y: int, width: int, height: int) -> Patch:
            alpha = as_uint8(self._alpha.ReadAsArray(x, y, width, height))
            if not self.colour:
                return Patch(as_uint8(self._grey.ReadAsArray(x, y, width, height)), alpha)
            rgb = self._rgb(x, y, width, height)
            return Patch(luma(rgb), alpha, rgb if with_colour else None)

        return fetch

    def read(self, box: PixelBox) -> Patch:
        return padded(box, self._size, self._fetch(False))

    def read_colour(self, box: PixelBox) -> Patch:
        """`box` with the part's red, green and blue (a grey part's grey three times)."""
        patch = padded(box, self._size, self._fetch(True), with_colour=self.colour)
        return patch if patch.colour is not None else Patch(patch.grey, patch.alpha, numpy.dstack([patch.grey] * 3))

    def averaged(self, grid: Grid) -> Raster:
        """The whole source shrunk to `grid` (each cell the mean of its pixels; a cell only partly covered has an alpha under 255)."""
        size = {"buf_xsize": grid.width, "buf_ysize": grid.height, "resample_alg": gdal.GRIORA_Average}
        grey = luma(self._rgb_on(grid)) if self.colour else as_uint8(self._grey.ReadAsArray(**size))
        return Raster(grid, grey, as_uint8(self._alpha.ReadAsArray(**size)))

    def alpha_of(self, x: int, y: int, width: int, height: int, size: tuple[int, int]) -> UInt8Array:
        """A box of the alpha band resampled to `size`."""
        return as_uint8(self._alpha.ReadAsArray(x, y, width, height, size[0], size[1]))

    def close(self) -> None:
        self._dataset.Close()
