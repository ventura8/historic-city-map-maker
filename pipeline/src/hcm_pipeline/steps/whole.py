"""A frame nothing proved, offered whole (docs/research/M9-calibration.md §17).

Live 2026-11-12: the 1968 Corona frame DS1103-1058DF027, 131 443 pixels wide. Its footprint named two windows, neither was proved, and
`locate` kept the first unproved: countryside, in which nobody can place a point on the city. So a frame nothing proved is no longer cut
by a guess when the guess was a part of it (a strip's window), when its search ran out of time, or when it is larger than a scan the
georeferencer can show whole: its `scan.tif` is then the **whole exposure**, averaged down until its long side fits `WHOLE_MAX_PX`,
and it says so itself (`WHOLE_METADATA`, read back by `georef`: a version's files outlive the work folder, and no document changes
shape). The owner places a few rough points anywhere on it; `steps/recrop.py` then cuts the film around them at full resolution.
"""

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import numpy

from hcm_pipeline.geo import FloatArray
from hcm_pipeline.raster import gdal

# The long side of a whole frame's scan at most: `stitch`'s preview budget (`frames.PREVIEW_MAX_PX`).
WHOLE_MAX_PX: Final = 16384
WHOLE_METADATA: Final = "HCM_WHOLE_FRAME"
POINTS_NEXT: Final = "waits for a person: place a few rough points anywhere on the strip"
# Rough points closer together than this (film pixels, EPSG:3857 metres) say nothing of the film's scale.
MIN_SPREAD: Final = 1.0

Limits = tuple[int, int, int]
Box = tuple[int, int, int, int]


class RoughPointsError(Exception):
    """The rough points give no scale: they lie on one place."""


@dataclass(frozen=True)
class WholeFrame:
    """How a whole frame's scan lies on the film: shrunk `factor` times, from the film's column `left` and row `top`."""

    factor: int
    left: int
    top: int

    def to_film(self, x: float, y: float) -> tuple[float, float]:
        return x * self.factor + self.left, y * self.factor + self.top


def shrink(limits: Limits) -> int:
    """How many times the exposure inside `limits` (up to this column, up to this row, from this column) is shrunk to fit."""
    right, bottom, start = limits
    return max(1, math.ceil(max(right - start, bottom) / WHOLE_MAX_PX))


def offered_whole(searched: Limits, limits: Limits, timed_out: bool) -> bool:
    """Whether an unproved frame is offered whole: its search held a part of it, ran out of time, or the frame is over the budget."""
    return timed_out or searched != limits or shrink(limits) > 1


def mark(path: Path, whole: WholeFrame) -> Path:
    """`path` (a GeoTIFF) says it is a whole frame shrunk; one at full resolution says nothing: its points are fitted on it as they are."""
    if whole.factor > 1:
        dataset = gdal.Open(str(path), gdal.GA_Update)
        dataset.SetMetadataItem(WHOLE_METADATA, json.dumps({"factor": whole.factor, "left": whole.left, "top": whole.top}))
        dataset.Close()
    return path


def marked(path: Path) -> WholeFrame | None:
    """What `mark` wrote; None for any other scan."""
    dataset = gdal.Open(str(path))
    text = dataset.GetMetadataItem(WHOLE_METADATA)
    dataset.Close()
    if not text:
        return None
    record = json.loads(text)
    return WholeFrame(int(record["factor"]), int(record["left"]), int(record["top"]))


def rough_box(film: FloatArray, places: FloatArray, margin_m: float, limits: Limits) -> Box:
    """The film (left, top, right, bottom) around the rough points with `margin_m` of ground (EPSG:3857 metres) on every side, inside
    `limits`. The film's scale is the points' own: how far they spread on film over how far they spread on the ground."""
    on_film, on_ground = float(numpy.hypot(*film.std(axis=0))), float(numpy.hypot(*places.std(axis=0)))
    if min(on_film, on_ground) < MIN_SPREAD:
        raise RoughPointsError
    margin = margin_m * on_film / on_ground
    right, bottom, start = limits
    low, high = film.min(axis=0) - margin, film.max(axis=0) + margin
    return (
        max(start, math.floor(low[0])),
        max(0, math.floor(low[1])),
        min(right, math.ceil(high[0])),
        min(bottom, math.ceil(high[1])),
    )
