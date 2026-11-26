"""A sheet series rendered into one `warped.tif` (docs/research/M20-import-local.md §3 b steps 5 and 6, §6).

Each sheet is read once, reduced to about the output's resolution (GDAL's average: a 1-bit sheet becomes grey, which keeps thin lines),
given an alpha band that is opaque inside its neat line only, and warped into the series' output through a lattice of pairs (its
frame's homography composed with the solved grid) by a thin-plate spline. The output is one GeoTIFF in EPSG:3857 over every sheet, its
alpha band last; a sheet written after another covers it only inside its own neat line: hard seams, no feather (§3 b step 6).
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import cv2
import numpy

from hcm_pipeline.georef.transforms import Transform
from hcm_pipeline.placing.geometry import FloatArray
from hcm_pipeline.placing.gridscheme import Box
from hcm_pipeline.placing.raster_io import Pair, normalised
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import GTIFF_OPTIONS, WEB_MERCATOR, driver_of, srs_wkt

LATTICE: Final = 5
UNIT_SQUARE: Final = numpy.array([[0, 0], [1, 0], [1, 1], [0, 1]], numpy.float32)


@dataclass(frozen=True)
class SheetWarp:
    """A sheet to render: its scan, its frame's corners (scan pixels) and its pairs (scan pixels to Mercator metres)."""

    path: Path
    corners: FloatArray
    pairs: tuple[Pair, ...]

    @classmethod
    def of(cls, path: Path, corners: FloatArray, box: Box, mosaic: tuple[float, float, float], transform: Transform) -> SheetWarp:
        """The lattice of pairs: the unit square through the frame's homography (scan) and through the box and the grid (ground)."""
        west, north, metres = mosaic
        s, t = (value.ravel() for value in numpy.meshgrid(numpy.linspace(0, 1, LATTICE), numpy.linspace(0, 1, LATTICE)))
        homography = cv2.getPerspectiveTransform(UNIT_SQUARE, corners.astype(numpy.float32))
        scan = cv2.perspectiveTransform(numpy.column_stack((s, t)).reshape(-1, 1, 2).astype(numpy.float64), homography).reshape(-1, 2)
        u = (box.west + s * box.width - west) / metres
        v = (north - (box.north - t * box.height)) / metres
        mx, my = transform.to_mercator(u, v)
        return cls(path, corners, tuple(Pair(float(a), float(b), float(c), float(d)) for (a, b), c, d in zip(scan, mx, my, strict=True)))

    def mercator_box(self) -> tuple[float, float, float, float]:
        xs, ys = [pair.mx for pair in self.pairs], [pair.my for pair in self.pairs]
        return min(xs), min(ys), max(xs), max(ys)

    def metres_per_px(self) -> float:
        """About how many Mercator metres one scan pixel spans."""
        first, last = self.pairs[0], self.pairs[-1]
        return math.hypot(last.mx - first.mx, last.my - first.my) / max(1.0, math.hypot(last.px - first.px, last.py - first.py))


def _bands(path: Path) -> int:
    vrt = normalised(path)
    try:
        dataset = gdal.Open(vrt)
        count = dataset.RasterCount
        dataset.Close()
    finally:
        gdal.Unlink(vrt)
    return count


def _output(warps: Sequence[SheetWarp], target: Path, resolution: float) -> gdal.Dataset:
    boxes = numpy.array([warp.mercator_box() for warp in warps])
    left, bottom = boxes[:, 0].min(), boxes[:, 1].min()
    width = max(1, math.ceil((boxes[:, 2].max() - left) / resolution))
    height = max(1, math.ceil((boxes[:, 3].max() - bottom) / resolution))
    bands = _bands(warps[0].path)
    dataset = driver_of("GTiff").Create(str(target), width, height, bands + 1, gdal.GDT_Byte, list(GTIFF_OPTIONS))
    dataset.SetGeoTransform((float(left), resolution, 0.0, float(bottom) + height * resolution, 0.0, -resolution))
    dataset.SetProjection(srs_wkt(WEB_MERCATOR))
    dataset.GetRasterBand(bands + 1).SetColorInterpretation(gdal.GCI_AlphaBand)
    return dataset


def _source(warp: SheetWarp, factor: int) -> gdal.Dataset:
    """The sheet reduced by `factor`, an alpha band opaque inside its neat line, and its pairs (in reduced pixels)."""
    vrt = normalised(warp.path)
    try:
        dataset = gdal.Open(vrt)
        width, height = max(1, dataset.RasterXSize // factor), max(1, dataset.RasterYSize // factor)
        bands = [
            dataset.GetRasterBand(index).ReadAsArray(
                0, 0, dataset.RasterXSize, dataset.RasterYSize, width, height, resample_alg=gdal.GRIORA_Average
            )
            for index in range(1, dataset.RasterCount + 1)
        ]
        dataset.Close()
    finally:
        gdal.Unlink(vrt)
    alpha = numpy.zeros((height, width), numpy.uint8)
    cv2.fillConvexPoly(alpha, numpy.round(warp.corners / factor).astype(numpy.int32), 255)
    memory = driver_of("MEM").Create("", width, height, len(bands) + 1, gdal.GDT_Byte)
    for index, band in enumerate([*bands, alpha], start=1):
        memory.GetRasterBand(index).WriteArray(numpy.asarray(band, numpy.uint8))
    memory.GetRasterBand(len(bands) + 1).SetColorInterpretation(gdal.GCI_AlphaBand)
    gcps = [gdal.GCP(pair.mx, pair.my, 0.0, pair.px / factor, pair.py / factor) for pair in warp.pairs]
    memory.SetGCPs(gcps, srs_wkt(WEB_MERCATOR))
    return memory


def render_sheets(warps: Sequence[SheetWarp], target: Path, resolution: float, nearest: bool) -> Path:
    """Every sheet warped into one GeoTIFF at `resolution` Mercator metres a pixel, its alpha band last."""
    output = _output(warps, target, resolution)
    for warp in warps:
        factor = max(1, math.floor(resolution / max(warp.metres_per_px(), 1e-9)))
        source = _source(warp, factor)
        gdal.Warp(output, source, tps=True, srcAlpha=True, dstAlpha=True, resampleAlg="near" if nearest and factor == 1 else "bilinear")
        source.Close()
    output.Close()
    return target
