"""The block compositor: every part's pixels, weighted over the valid ones (docs/research/M8-join-interfaces.md §3, `merge` 3 and 4).

`grey = Σ w·a·tone(p) / Σ w·a` and `alpha = any a`: normalising over the valid pixels leaves neither the translucent line of a
feathered cutline nor a feather running into no data. Only the parts whose weight is not zero in a block are read; where those
leave a hole (a corrected frame's edge moved off a cell it owned), any other part that covers it fills it.
"""

import math
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

import cv2
import numpy
import numpy.typing

from hcm_pipeline.documents import JoinSeam
from hcm_pipeline.geo import FloatArray, Grid
from hcm_pipeline.images import UInt8Array, as_uint8
from hcm_pipeline.join.canvas import PixelBox, TileSource
from hcm_pipeline.join.seams import pair_boundary
from hcm_pipeline.join.tone import Tone
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import WEB_MERCATOR, driver_of, srs_wkt

BLOCK_PX: Final = 4096
MOSAIC_OPTIONS: Final = ("COMPRESS=DEFLATE", "TILED=YES", "BIGTIFF=YES")
# The half-width of the blend across a seam: a wide one where the seam closed, else a hard cut, which beats double streets.
BLEND_HALF_WIDTH_M: Final = 48.0
CUT_HALF_WIDTH_M: Final = 12.0
CLOSED_SEAM_M: Final = 15.0
FULL_ALPHA: Final = 255.0
FloatImage = numpy.typing.NDArray[numpy.float32]


def closes(seam: JoinSeam) -> bool:
    """The seam was measured and what is left of it after the correction, if any, is small enough to blend."""
    return seam.measured and seam.after_rmse_m is not None and seam.after_rmse_m <= CLOSED_SEAM_M


def half_widths(owner: UInt8Array, seams: Iterable[tuple[int, int, JoinSeam]], cell_m: float) -> FloatImage:
    """Each owner cell's blend half-width (ground metres): `BLEND_HALF_WIDTH_M` near a seam that closed."""
    found = numpy.full(owner.shape, CUT_HALF_WIDTH_M, numpy.float32)
    reach = max(1, math.ceil(BLEND_HALF_WIDTH_M / cell_m) + 1)
    for a, b, seam in seams:
        if closes(seam):
            found[pair_boundary(owner, a, b, reach)] = BLEND_HALF_WIDTH_M
    return found


def signed_distance(owned: numpy.typing.NDArray[numpy.bool_]) -> FloatArray:
    """Cells to the owned region's edge: positive inside it, negative outside."""
    inside = numpy.asarray(cv2.distanceTransform(as_uint8(owned), cv2.DIST_L2, cv2.DIST_MASK_PRECISE), numpy.float64)
    outside = numpy.asarray(cv2.distanceTransform(as_uint8(~owned), cv2.DIST_L2, cv2.DIST_MASK_PRECISE), numpy.float64)
    return numpy.where(owned, inside - 0.5, 0.5 - outside)


def weight_of(owner: UInt8Array, part: int, widths: FloatImage, cell_m: float) -> FloatImage:
    """`w = clamp(0.5 + D / (2F), 0, 1)` on the owner grid."""
    distance = signed_distance(owner == part + 1) * cell_m
    return numpy.asarray(numpy.clip(0.5 + distance / (2.0 * widths), 0.0, 1.0), numpy.float32)


def upsampled(cells: FloatImage, ratio: float, box: PixelBox) -> FloatImage:
    """`cells` (a level whose cell is `ratio` pixels) at `box`'s pixels, bilinearly."""
    scale = 1.0 / ratio
    to_cells = numpy.array([[scale, 0.0, (box.x0 + 0.5) * scale - 0.5], [0.0, scale, (box.y0 + 0.5) * scale - 0.5]])
    flags = cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP
    return numpy.asarray(cv2.warpAffine(cells, to_cells, box.size, flags=flags, borderMode=cv2.BORDER_REPLICATE), numpy.float32)


def _cells_of(box: PixelBox, ratio: float, shape: tuple[int, ...]) -> tuple[slice, slice]:
    """The owner cells a box of pixels touches, one more on each side (the bilinear reach)."""
    y0, x0 = max(0, math.floor(box.y0 / ratio) - 1), max(0, math.floor(box.x0 / ratio) - 1)
    return slice(y0, min(shape[0], math.ceil(box.y1 / ratio) + 1)), slice(x0, min(shape[1], math.ceil(box.x1 / ratio) + 1))


@dataclass(frozen=True)
class Layer:
    """A warped part: its pixels, its tones, its weight and where it covers on the owner grid."""

    source: TileSource
    tone: Tone
    weight: FloatImage
    covers: numpy.typing.NDArray[numpy.bool_]


@dataclass(frozen=True)
class Levels:
    """How many pixels of the mosaic an owner cell and a tone cell are."""

    owner_ratio: float
    tone_ratio: float


def _toned(layer: Layer, grey: UInt8Array, box: PixelBox, levels: Levels) -> FloatImage:
    line = layer.tone.line
    gain = numpy.exp(upsampled(layer.tone.field, levels.tone_ratio, box))
    return numpy.asarray((grey.astype(numpy.float32) * line.gain + line.offset) * gain, numpy.float32)


@dataclass
class Totals:
    """A block's running sums."""

    box: PixelBox
    levels: Levels
    total: FloatImage = field(init=False)
    weights: FloatImage = field(init=False)
    any_alpha: numpy.typing.NDArray[numpy.bool_] = field(init=False)

    def __post_init__(self) -> None:
        width, height = self.box.size
        self.total = numpy.zeros((height, width), numpy.float32)
        self.weights = numpy.zeros((height, width), numpy.float32)
        self.any_alpha = numpy.zeros((height, width), numpy.bool_)

    def add(self, layer: Layer, weight: FloatImage) -> None:
        """The part's valid pixels with `weight`."""
        patch = layer.source.read(self.box)
        counted = weight * (patch.alpha.astype(numpy.float32) / float(FULL_ALPHA))
        self.total += counted * _toned(layer, patch.grey, self.box, self.levels)
        self.weights += counted
        self.any_alpha |= patch.alpha > 0

    def result(self) -> tuple[UInt8Array, UInt8Array]:
        grey = self.total / numpy.maximum(self.weights, 1e-6)
        return as_uint8(numpy.clip(grey + 0.5, 0, 255)), as_uint8(self.any_alpha) * 255


def _weight_touches(layer: Layer, box: PixelBox, ratio: float) -> bool:
    return bool(layer.weight[_cells_of(box, ratio, layer.weight.shape)].max(initial=0.0) > 0.0)


def _covers(layer: Layer, box: PixelBox, ratio: float) -> bool:
    return bool(layer.covers[_cells_of(box, ratio, layer.covers.shape)].any())


def _fill_holes(layers: Sequence[Layer], totals: Totals) -> None:
    """Where no weighted part left a pixel, whichever part covers the block has its say."""
    holes = totals.weights <= 0.0
    if holes.any():
        for layer in layers:
            if _covers(layer, totals.box, totals.levels.owner_ratio):
                totals.add(layer, holes.astype(numpy.float32))


def compose_block(layers: Sequence[Layer], box: PixelBox, levels: Levels) -> tuple[UInt8Array, UInt8Array]:
    """One block of the mosaic (grey, alpha): the parts with a weight here first, then whichever covers what they left."""
    totals = Totals(box, levels)
    for layer in layers:
        if _weight_touches(layer, box, levels.owner_ratio):
            totals.add(layer, upsampled(layer.weight, levels.owner_ratio, box))
    _fill_holes(layers, totals)
    return totals.result()


def blocks(width: int, height: int, size: int = BLOCK_PX) -> list[PixelBox]:
    """The mosaic's blocks, row by row."""
    return [PixelBox(x, y, min(x + size, width), min(y + size, height)) for y in range(0, height, size) for x in range(0, width, size)]


def compose(target: Path, grid: Grid, layers: Sequence[Layer], levels: Levels, tick: Callable[[float], None]) -> Path:
    """The mosaic as a grey and alpha BIGTIFF, one block in memory at a time; `tick` hears how far it is (and may stop the run)."""
    dataset = driver_of("GTiff").Create(str(target), grid.width, grid.height, 2, gdal.GDT_Byte, list(MOSAIC_OPTIONS))
    dataset.SetGeoTransform(grid.geotransform())
    dataset.SetProjection(srs_wkt(WEB_MERCATOR))
    dataset.GetRasterBand(2).SetColorInterpretation(gdal.GCI_AlphaBand)
    every = blocks(grid.width, grid.height)
    for index, box in enumerate(every):
        grey, alpha = compose_block(layers, box, levels)
        dataset.GetRasterBand(1).WriteArray(grey, box.x0, box.y0)
        dataset.GetRasterBand(2).WriteArray(alpha, box.x0, box.y0)
        tick((index + 1) / len(every))
    dataset.Close()
    return target
