"""Line art warped to a coarser grid than its scan keeps its ink (docs/research/M20-import-local.md §19.20; lesson of 2026-11-24).

A 1-bit plan's lines are one or two scan pixels wide. The plan cadastral 1911-1914's sheets are about 0.12 Mercator metres a pixel and
its series' grid at zoom 17 is 1.19 m: warped with nearest, each output pixel took one scan pixel in about a hundred, and the lines fell
apart into speckle, streets and labels unreadable. Where a part's scan is at least `MIN_RATIO` times finer than the output, line art is
warped with GDAL's average instead, and each output pixel's darkness (its distance from white paper) is then amplified by the ratio, at
most `raster_io.INK_GAIN`, as `raster_io.read_box_inked` does: a thin line across the pixel keeps its full darkness, so the pyramid's
paper threshold keeps it as ink. A scan near the output's own resolution keeps nearest (its lines stay one crisp pixel). A redraw
(`steps/warp.composite_originals`) warps with plain pairs: its originals being 1-bit scans makes it line art too (`one_bit`).
"""

from collections.abc import Sequence
from pathlib import Path
from typing import Final

import numpy

from hcm_pipeline.placing.raster_io import INK_GAIN, WarpPlan
from hcm_pipeline.raster import gdal

MIN_RATIO: Final = 2.0
ONE_BIT: Final = "1"
WHITE: Final = 255.0
ROWS: Final = 1024


def chosen(plan: WarpPlan, originals: Sequence[Path], source_m: Sequence[float]) -> tuple[str, float]:
    """The warp's resampling and the output's span in scan pixels (`ratio_of`): line art when the plan says so or the originals
    are 1-bit scans."""
    ratio = ratio_of(source_m, plan.resolution)
    return resampling(plan.nearest or one_bit(originals), ratio), ratio


def one_bit(paths: Sequence[Path]) -> bool:
    """True when every original is a 1-bit scan (line art, whatever the job says: a redraw of a series warps it with plain pairs)."""
    return bool(paths) and all(_bits(path) == ONE_BIT for path in paths)


def _bits(path: Path) -> str | None:
    dataset = gdal.Open(str(path))
    try:
        found = dataset.GetRasterBand(1).GetMetadataItem("NBITS", "IMAGE_STRUCTURE")
    finally:
        dataset.Close()
    return None if found is None else str(found)


def ratio_of(source_m: Sequence[float], resolution: float) -> float:
    """How many scan pixels an output pixel spans (the parts' median), from each part's metres per scan pixel."""
    found = [value for value in source_m if value > 0]
    return float(resolution / numpy.median(found)) if found else 1.0


def resampling(nearest: bool, ratio: float) -> str:
    """GDAL's resampling: bilinear for a picture; nearest for line art near its scan's resolution; average when much coarser."""
    if not nearest:
        return "bilinear"
    return "average" if ratio >= MIN_RATIO else "near"


def gain_of(ratio: float) -> float:
    """The darkness gain of an averaged line-art pixel: the ratio, at most `INK_GAIN`."""
    return min(ratio, float(INK_GAIN))


def finish(dataset: gdal.Dataset, bands: int, algorithm: str, ratio: float) -> None:
    """After every part is warped: an averaged line art's darkness amplified (`inked`); anything else as it is."""
    if algorithm == "average":
        inked(dataset, bands, gain_of(ratio))


def inked(dataset: gdal.Dataset, bands: int, gain: float) -> None:
    """Each colour band's darkness amplified by `gain`, a block of rows at a time (the alpha band, last, is left)."""
    for index in range(1, bands + 1):
        band = dataset.GetRasterBand(index)
        for top in range(0, dataset.RasterYSize, ROWS):
            rows = min(ROWS, dataset.RasterYSize - top)
            pixels = band.ReadAsArray(0, top, dataset.RasterXSize, rows).astype(numpy.float64)
            band.WriteArray(numpy.clip(WHITE - (WHITE - pixels) * gain, 0, WHITE).astype(numpy.uint8), 0, top)
    dataset.FlushCache()
