"""A scanned frame as its segments, never as one image in memory (finding 57 of 2026-11-01).

A KH-9 panoramic frame is tens of gigapixels: joining its parts into one array was killed for its memory even at 32 GiB.
`stitch` records where each segment lies in the frame (`frame.json`) and a shrunk, averaged preview of the whole frame
(`frame-preview.tif`); `locate` scores the preview and reads only the city's window out of the segments that cover it.
Each segment is read through GDAL by windows (`Segment.read`), stretched to 8 bits by its own linear scale, so the
memory a step needs is that of a window, a template strip or a preview, whatever the frame's size.
"""

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Final

import numpy

from hcm_pipeline.images import UInt8Array, as_uint8
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import open_raster

FRAME_JSON: Final = "frame.json"
FRAME_PREVIEW: Final = "frame-preview.tif"
# The preview's long side at most. On the 1972 KH-9 panoramic frame that is a shrink of 32: about 30 m (EPSG:3857) a pixel near
# the nadir and 50 m over the whole frame, no finer than the 30 m `locate` asks for, so `locate` never enlarges it.
PREVIEW_MAX_PX: Final = 16384
STRETCH_PCT: Final = (2.0, 98.0)
# How GDAL shrinks a read: picking every n-th pixel (fast: the segments' coarse matching), or averaging all of them (the
# preview: picked pixels are film grain, which scored the 1972 frame's true place 0.126 against 0.167 averaged).
NEAREST: Final[int] = gdal.GRIORA_NearestNeighbour
AVERAGED: Final[int] = gdal.GRIORA_Average


class Segment:
    """One segment's GDAL dataset, read by windows as 8-bit pixels."""

    def __init__(self, path: Path) -> None:
        self._dataset = open_raster(path)
        self.width: int = self._dataset.RasterXSize
        self.height: int = self._dataset.RasterYSize
        self._band = self._dataset.GetRasterBand(1)
        self.offset, self.ratio = 0.0, 1.0
        if self._band.DataType != gdal.GDT_Byte:
            self.offset, self.ratio = self._stretch()

    def _stretch(self) -> tuple[float, float]:
        """The linear scale of a deeper segment to 8 bits: its 2nd and 98th percentiles, from a shrunk read."""
        sample = numpy.asarray(self._raw((0, 0, self.width, self.height), (min(self.width, 1024), min(self.height, 1024))), numpy.float64)
        low, high = numpy.percentile(sample, STRETCH_PCT)
        ratio = 255.0 / max(float(high - low), 1e-9)
        return -float(low) * ratio, ratio

    def _raw(self, window: tuple[int, int, int, int], size: tuple[int, int], resample: int = NEAREST) -> numpy.ndarray:
        # GDAL raises on a failed read (`UseExceptions`, `hcm_pipeline.raster`): `gdal_step` turns that into the step's failure.
        return numpy.asarray(self._band.ReadAsArray(*window, size[0], size[1], resample_alg=resample))

    def _bytes(self, raw: numpy.ndarray) -> UInt8Array:
        if self.ratio == 1.0 and self.offset == 0.0 and raw.dtype == numpy.uint8:
            return as_uint8(raw)
        return as_uint8(numpy.clip(raw * self.ratio + self.offset, 0, 255))

    def read(self, x: int, y: int, width: int, height: int, size: tuple[int, int] | None = None) -> UInt8Array:
        """The window (x, y, width, height), resampled by GDAL to `size` (width, height) when given: by picking pixels."""
        return self._bytes(self._raw((x, y, width, height), size or (width, height)))

    def averaged(self, size: tuple[int, int]) -> UInt8Array:
        """The whole segment shrunk to `size` (width, height) by averaging: every pixel is read (the preview's, not the matching's)."""
        return self._bytes(self._raw((0, 0, self.width, self.height), size, AVERAGED))

    def averaged_window(self, x: int, y: int, width: int, height: int, size: tuple[int, int]) -> UInt8Array:
        """The window shrunk to `size` (width, height) by averaging: a proof's read, whose film grain must not alias."""
        return self._bytes(self._raw((x, y, width, height), size, AVERAGED))

    def close(self) -> None:
        self._dataset.Close()


@dataclass(frozen=True)
class Placement:
    """A segment's object and its place in the frame's pixels (it may start before 0: the border was cropped)."""

    path: str
    x: int
    y: int
    width: int
    height: int

    def window(self, box: tuple[int, int, int, int]) -> tuple[int, int, int, int] | None:
        """The part of `box` (left, top, width, height in the frame) this segment covers, in the frame's pixels."""
        left, top = max(box[0], self.x), max(box[1], self.y)
        right, bottom = min(box[0] + box[2], self.x + self.width), min(box[1] + box[3], self.y + self.height)
        return (left, top, right - left, bottom - top) if right > left and bottom > top else None


@dataclass(frozen=True)
class FrameLayout:
    """`frame.json`: the frame's size, the preview's shrink factor and the segments' placements, a later one on top.

    `image_start` and `image_end` are the exposure's columns, between the dark gaps that part it from a fragment of the next
    exposure on either side (`stitch.exposure_span`); 0 and None: the frame's own edges, also of a `frame.json` written before
    they existed. Only a panoramic camera's frame reads them: its model, its scoring and its crops stay on the exposure.
    """

    width: int
    height: int
    preview_factor: int
    placements: tuple[Placement, ...]
    image_end: int | None = None
    image_start: int = 0

    def to_json(self) -> str:
        record = {**asdict(self), "placements": [asdict(each) for each in self.placements]}
        return json.dumps({key: value for key, value in record.items() if value is not None})

    @classmethod
    def from_json(cls, text: str) -> FrameLayout:
        record = json.loads(text)
        placements = tuple(Placement(**each) for each in record["placements"])
        # A frame.json written before `image_end` and `image_start` existed holds neither.
        size = int(record["width"]), int(record["height"]), int(record["preview_factor"])
        return cls(*size, placements, record.get("image_end"), int(record.get("image_start", 0)))

    @property
    def image_width(self) -> int:
        """The exposure's width in film pixels."""
        return self.exposure[1] - self.exposure[0]

    @property
    def exposure(self) -> tuple[int, int]:
        """The exposure's first column and the one past its last."""
        return self.image_start, self.width if self.image_end is None else self.image_end

    def covering(self, box: tuple[int, int, int, int]) -> list[Placement]:
        """The placements that hold some of `box`, in drawing order."""
        return [each for each in self.placements if each.window(box) is not None]
