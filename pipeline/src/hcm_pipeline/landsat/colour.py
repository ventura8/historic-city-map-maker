"""A Landsat scene's colour on the tile grid (docs/research/M25-landsat.md §3): masks, pan-sharpening and the per-scene stretch.

Pure arrays, so every rule is tested without GDAL. The quality band (`QA_PIXEL`, Collection 2 for Landsat 4 to 9: the same bits)
marks fill (bit 0), dilated cloud (1), cloud (3) and cloud shadow (4); a pixel is valid when it is no fill and every colour band has a
value (0 is no data in a Level-1 product; OLI's are 16 bits, which the per-band stretch takes as they come). An ETM+ or OLI scene is
pan-sharpened by the Brovey ratio: each colour band scaled by the panchromatic band over the mean of the three, so the 15 m band brings
its detail and the colour stays the 30 m bands'. The stretch is per band, between robust percentiles of the clear pixels only (haze and
clouds do not set the white point; a scene with no clear pixel falls back to every valid one), to
1..255, so the alpha band alone says where the image is.

Lesson 726 (2026-11-14): a systematic (L1GS) scene's quality band may call nothing cloud: USGS's 30 June 1991 scene over Bucharest
was one cloud deck, saturated (each colour band at its largest value) over the whole city, and its quality band and its metadata said
0 % cloud. The stretch then had no range (blue p2 = p98 = 255: every pixel 1) and the preview came out solid yellow. A pixel saturated
in any colour band (`Bands.saturated`) now counts as cloud, and a band with no range left stretches from 0 to its largest value, so a
cloud deck is white and the city's cloud share says why the version waits.
"""

from dataclasses import dataclass
from typing import Final

import numpy
from numpy.typing import NDArray

from hcm_pipeline.geo import FloatArray
from hcm_pipeline.images import UInt8Array

FILL_BIT: Final = 1
CLOUD_BITS: Final = (1 << 1) | (1 << 3) | (1 << 4)
LOW_PCT: Final = 2.0
HIGH_PCT: Final = 98.0
OPAQUE: Final = 255
MIN_RANGE: Final = 1.0

QualityArray = NDArray[numpy.uint16]
BoolArray = NDArray[numpy.bool_]


@dataclass(frozen=True)
class Bands:
    """A scene's bands on one grid: red, green, blue (float), the quality band, and the panchromatic band of an ETM+ or OLI scene."""

    red: FloatArray
    green: FloatArray
    blue: FloatArray
    quality: QualityArray
    pan: FloatArray | None = None
    saturated: BoolArray | None = None


@dataclass(frozen=True)
class Composite:
    """The 8-bit colour bands and the alpha, the grey the offset check reads, and where the scene is valid and where it is cloud."""

    rgba: tuple[UInt8Array, UInt8Array, UInt8Array, UInt8Array]
    grey: FloatArray
    valid: BoolArray
    cloudy: BoolArray


def masks(bands: Bands) -> tuple[BoolArray, BoolArray]:
    """Where the scene has data, and where its quality band says cloud or its shadow (within the valid pixels)."""
    quality = bands.quality.astype(numpy.uint16)
    filled = (bands.red > 0) & (bands.green > 0) & (bands.blue > 0)
    valid = numpy.asarray(((quality & FILL_BIT) == 0) & filled, numpy.bool_)
    flagged = (quality & CLOUD_BITS) != 0
    if bands.saturated is not None:
        flagged = flagged | bands.saturated
    cloudy = numpy.asarray(flagged & valid, numpy.bool_)
    return valid, cloudy


def brovey(bands: Bands) -> tuple[FloatArray, FloatArray, FloatArray]:
    """The colour bands pan-sharpened by the Brovey ratio; as they are without a panchromatic band."""
    if bands.pan is None:
        return bands.red, bands.green, bands.blue
    intensity = (bands.red + bands.green + bands.blue) / 3.0
    ratio = numpy.divide(bands.pan, intensity, out=numpy.zeros_like(intensity), where=intensity > 0)
    return bands.red * ratio, bands.green * ratio, bands.blue * ratio


def stretch(band: FloatArray, clear: BoolArray, valid: BoolArray) -> UInt8Array:
    """1..255 between the 2nd and 98th percentiles of the clear pixels (every valid one when none is clear); 0 outside `valid`.
    Percentiles closer than `MIN_RANGE` (a saturated band) stretch from 0 to the band's largest value instead (lesson 726)."""
    sample = band[clear] if clear.any() else band[valid]
    if sample.size == 0:
        return numpy.zeros(band.shape, numpy.uint8)
    low, high = numpy.percentile(sample, [LOW_PCT, HIGH_PCT])
    if high - low < MIN_RANGE:
        low, high = 0.0, max(float(sample.max()), MIN_RANGE)
    scaled = 1.0 + (band - low) / max(float(high - low), 1e-9) * (OPAQUE - 1)
    return numpy.asarray(numpy.where(valid, numpy.clip(scaled, 1, OPAQUE), 0), numpy.uint8)


def compose(bands: Bands) -> Composite:
    """The scene's stretched colour and alpha, and its grey (the mean of the three stretched bands) for the offset check."""
    valid, cloudy = masks(bands)
    clear = numpy.asarray(valid & ~cloudy, numpy.bool_)
    red, green, blue = (stretch(band, clear, valid) for band in brovey(bands))
    alpha = numpy.asarray(numpy.where(valid, OPAQUE, 0), numpy.uint8)
    grey = numpy.asarray((red.astype(numpy.float64) + green + blue) / 3.0, numpy.float64)
    return Composite((red, green, blue, alpha), grey, valid, cloudy)


def cloud_pct(composite: Composite, rows: slice, columns: slice) -> float:
    """The share of the valid pixels within `rows` by `columns` (the city) under cloud, percent; 100 when none is valid."""
    valid = composite.valid[rows, columns]
    count = int(numpy.count_nonzero(valid))
    if count == 0:
        return 100.0
    return round(100.0 * int(numpy.count_nonzero(composite.cloudy[rows, columns])) / count, 1)
