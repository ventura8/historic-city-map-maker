"""An archive scan read as 8-bit pixels, and warped to EPSG:3857 by its pairs (docs/research/M20-import-local.md §3, §6).

Scans come as they were made: 1-bit G4, palette colour, grey or RGB. `normalised` describes each as an in-memory VRT of 8-bit bands,
paper light and ink dark, without touching the original (§6: originals are kept untouched): a palette is expanded (GDAL gives a 1-bit
TIFF its two-colour palette, so a G4 sheet reads as 0 and 255), a fourth band is left out. The working copy is read through it,
reduced by GDAL's average (a 1-bit scan becomes grey at once, which keeps thin lines). The warp makes a VRT carrying the pairs (pixel
to EPSG:3857 metres) and warps it at the series' resolution: an affine or polynomial of order 1, or a thin-plate spline when the fit
earned one; nearest for line art (its lines stay crisp, §6), bilinear otherwise; an alpha band marks where the map is.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import numpy
from numpy.typing import NDArray

from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import GTIFF_OPTIONS, WEB_MERCATOR, fit_long_side, open_raster, srs_wkt

RGB: Final = 3
GREY_SPREAD: Final = 8
UInt8Array = NDArray[numpy.uint8]


def _palette_is_grey(table: gdal.ColorTable) -> bool:
    entries = [table.GetColorEntry(index)[:RGB] for index in range(table.GetCount())]
    return all(max(entry) - min(entry) <= GREY_SPREAD for entry in entries)


def _options(dataset: gdal.Dataset) -> dict[str, object]:
    """VRT options that make `dataset` 8-bit bands, paper light."""
    band = dataset.GetRasterBand(1)
    table = band.GetColorTable()
    if table is not None:
        return {"rgbExpand": "gray" if _palette_is_grey(table) else "rgb"}
    return {"bandList": [1, 2, 3] if dataset.RasterCount >= RGB else [1]}


def normalised(path: Path) -> str:
    """An in-memory VRT of `path` as 8-bit bands (one grey or three colour), the caller unlinks it."""
    dataset = open_raster(path)
    target = f"/vsimem/hcm-{uuid.uuid4().hex}.vrt"
    gdal.Translate(target, dataset, format="VRT", **_options(dataset)).Close()
    dataset.Close()
    return target


@dataclass(frozen=True)
class Working:
    """A reduced working copy: (h, w) grey or (h, w, 3) colour, and full-scan pixels per working pixel."""

    image: UInt8Array
    scale: float
    width: int
    height: int


def read_working(path: Path, max_px: int) -> Working:
    """The scan reduced so its long side is at most `max_px` (never enlarged)."""
    vrt = normalised(path)
    try:
        dataset = gdal.Open(vrt)
        width, height = dataset.RasterXSize, dataset.RasterYSize
        out_w, out_h, scale = fit_long_side(width, height, max_px)
        bands = [
            dataset.GetRasterBand(index).ReadAsArray(0, 0, width, height, out_w, out_h, resample_alg=gdal.GRIORA_Average)
            for index in range(1, dataset.RasterCount + 1)
        ]
        dataset.Close()
    finally:
        gdal.Unlink(vrt)
    image = numpy.dstack(bands) if len(bands) >= RGB else bands[0]
    return Working(numpy.asarray(image, numpy.uint8), 1.0 / scale, width, height)


def read_box(path: Path, box: tuple[int, int, int, int], size: tuple[int, int]) -> UInt8Array:
    """Only the scan's `box` (left, top, right, bottom in scan pixels) read at `size` (width, height) by GDAL's average, each band
    straight into the one array returned: a colour sheet costs its box at the size it is pasted, never the whole scan (M20 §19.6)."""
    vrt = normalised(path)
    try:
        dataset = gdal.Open(vrt)
        left, top = max(0, box[0]), max(0, box[1])
        across, down = max(1, min(dataset.RasterXSize, box[2]) - left), max(1, min(dataset.RasterYSize, box[3]) - top)
        count = dataset.RasterCount
        image = numpy.empty((size[1], size[0], count) if count >= RGB else (size[1], size[0]), numpy.uint8)
        for index in range(count):
            plane = image[:, :, index] if count >= RGB else image
            plane[...] = dataset.GetRasterBand(index + 1).ReadAsArray(
                left, top, across, down, size[0], size[1], resample_alg=gdal.GRIORA_Average
            )
        dataset.Close()
    finally:
        gdal.Unlink(vrt)
    return image


@dataclass(frozen=True)
class Pair:
    """One correspondence: a scan pixel (full resolution) and its place in EPSG:3857 metres."""

    px: float
    py: float
    mx: float
    my: float


@dataclass(frozen=True)
class WarpPlan:
    """How to warp: the pairs, the output resolution in Mercator metres, a spline or not, and nearest for line art."""

    pairs: Sequence[Pair]
    resolution: float
    tps: bool = False
    nearest: bool = False


def warp_by_pairs(source: Path, target: Path, plan: WarpPlan) -> Path:
    """The scan warped to EPSG:3857 by its pairs, an alpha band last."""
    vrt = normalised(source)
    gcps = [gdal.GCP(pair.mx, pair.my, 0.0, pair.px, pair.py) for pair in plan.pairs]
    placed = vrt.replace(".vrt", "-gcps.vrt")
    try:
        gdal.Translate(placed, vrt, format="VRT", GCPs=gcps, outputSRS=srs_wkt(WEB_MERCATOR)).Close()
        method = {"tps": True} if plan.tps else {"polynomialOrder": 1}
        options = {"xRes": plan.resolution, "yRes": plan.resolution, "dstAlpha": True, "creationOptions": list(GTIFF_OPTIONS)}
        resample = "near" if plan.nearest else "bilinear"
        gdal.Warp(str(target), placed, dstSRS=srs_wkt(WEB_MERCATOR), resampleAlg=resample, **method, **options).Close()
    finally:
        gdal.Unlink(placed)
        gdal.Unlink(vrt)
    return target


INCH_PER_CM: Final = 2.54
CENTIMETRE_UNIT: Final = "3"


def _number(text: str | None) -> float | None:
    try:
        value = float(str(text).strip("() ").split(",")[0])
    except ValueError:
        return None
    return value if value > 0 else None


def dpi_of(path: Path) -> float | None:
    """The scan's dots per inch from its TIFF tags, when it states them."""
    dataset = open_raster(path)
    resolution = _number(dataset.GetMetadataItem("TIFFTAG_XRESOLUTION"))
    unit = dataset.GetMetadataItem("TIFFTAG_RESOLUTIONUNIT") or ""
    dataset.Close()
    if resolution is None:
        return None
    return resolution * INCH_PER_CM if unit.startswith(CENTIMETRE_UNIT) else resolution
