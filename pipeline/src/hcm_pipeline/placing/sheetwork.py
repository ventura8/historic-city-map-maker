"""The sheets of an atlas or pieces as small working copies (docs/research/M20-import-local.md §19.2): bounded, one sheet read at a time.

Each sheet is read reduced (`work_px`: its long side, smaller for a long series so all copies stay within `WORK_BUDGET_BYTES`), in
grey, cropped to its content (`frame.content_box`: inside its frame, or its paper margins trimmed) and told blank or not. Its turn and
flip are one of eight `variants` (a turn clockwise of 0, 90, 180 or 270 degrees, then a mirror left to right). Every copy is brought
to the series' one cell (`cell_of`, the median sheet's shape): the sheets' scale differences (a page scanned at another resolution,
paper shrink) are taken out before the seams compare them. A series of framed sheets (`framing`: a printed neat line on most of them)
is cut at each sheet's neat line instead, straightened; its sheets with no confident frame are marked `unframed` (lesson of
2026-11-24: margins and headers between the cells broke every street at the seams).
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Final

import cv2
import numpy

from hcm_pipeline.placing import framing
from hcm_pipeline.placing.frame import BLANK_MAX_MARKS, content_box, is_blank, marks
from hcm_pipeline.placing.neatline import NeatLine
from hcm_pipeline.placing.raster_io import RGB, read_box, read_working
from hcm_pipeline.placing.streets import UInt8Array, grey_of
from hcm_pipeline.rasters import raster_info

WORK_BUDGET_BYTES: Final = 160_000_000
WORK_PX_MAX: Final = 1024
WORK_PX_MIN: Final = 320
# A page blank on its working copy is looked at again with its content box's long side this many pixels.
BLANK_CHECK_PX: Final = 1024
VARIANTS: Final = 8
TURNS: Final = 4
# Two shapes are the same when their width over height differs by less than this share (a square-ish page may be turned either way).
SQUARE_SLACK: Final = 0.08
# A content box smaller than this on a side is no content (the whole page is kept); the cell is never smaller.
MIN_SIDE_PX: Final = 8
HALF: Final = 0.5

Box = tuple[int, int, int, int]


def work_px(count: int) -> int:
    """The working copies' long side: as large as `WORK_PX_MAX`, smaller for a long series (all copies within the budget)."""
    return int(min(WORK_PX_MAX, max(WORK_PX_MIN, math.sqrt(WORK_BUDGET_BYTES / max(1, count)))))


@dataclass(frozen=True)
class Part:
    """One sheet's working copy: grey, cropped to its content; its scan pixels per working pixel and its content box there (scan
    pixels); whether it is blank."""

    index: int
    name: str
    path: Path
    image: UInt8Array
    scale: float
    box: Box
    blank: bool
    colour: bool = False
    # The sheet's neat line (its four corners, scan pixels, top left first, clockwise) when the series is one of framed sheets: `image`
    # is the inside of that frame, straightened, and `box` the frame's box on the scan.
    frame: framing.Corners = ()
    # A sheet of a framed series whose own frame was not found: left out by name (`no-frame`), never mosaicked with its margins.
    unframed: bool = False

    @property
    def aspect(self) -> float:
        height, width = self.image.shape[:2]
        return float(width / max(1, height))


def read_part(index: int, name: str, path: Path, px: int) -> Part:
    working = read_working(path, px)
    grey = grey_of(working.image)
    left, top, right, bottom = content_box(grey)
    if min(right - left, bottom - top) < MIN_SIDE_PX:
        left, top, right, bottom = 0, 0, grey.shape[1], grey.shape[0]
    crop = numpy.ascontiguousarray(grey[top:bottom, left:right])
    box = tuple(round(value * working.scale) for value in (left, top, right, bottom))
    colour = working.image.ndim == RGB
    whole = (box[0], box[1], box[2], box[3])
    return Part(index, name, path, crop, working.scale, whole, blank_page(path, whole, crop), colour)


def blank_page(path: Path, box: Box, crop: UInt8Array) -> bool:
    """True when the page has no drawing. A small working copy (a long series reads each page at `WORK_PX_MIN`) averages a 1-bit
    scan's thin lines into the paper, so a page that looks blank there is looked at again, its content box only, at
    `BLANK_CHECK_PX`, where it is drawn when it holds enough ink or enough separate marks (the 1:500 sheets of 1960-71: 2,140 of
    4,536 read as blank at 320 px; M20 §19.16)."""
    if not is_blank(crop) or max(crop.shape[:2]) >= BLANK_CHECK_PX:
        return is_blank(crop)
    width, height = box[2] - box[0], box[3] - box[1]
    factor = min(1.0, BLANK_CHECK_PX / max(1, width, height))
    size = (max(1, round(width * factor)), max(1, round(height * factor)))
    sharp = grey_of(read_box(path, box, size))
    return is_blank(sharp) and marks(sharp) < BLANK_MAX_MARKS


def read_parts(named: Sequence[tuple[str, Path]]) -> list[Part]:
    """The sheets' working copies; in a series of framed sheets, each cut at its neat line (`framing`)."""
    px = work_px(len(named))
    parts = [read_part(index, name, path, px) for index, (name, path) in enumerate(named)]
    return neat_cut(parts, px) if parts else parts


def neat_cut(parts: list[Part], px: int) -> list[Part]:
    """The parts cut at their neat lines when the series is one of framed sheets (`framing.series_neatlines`); else as they are."""
    width, height = cell_of(parts)
    frames = framing.series_neatlines([part.path for part in parts], width / height)
    if frames is None:
        return parts
    return _cut_or_kept(parts, [framed_part(part, frame, px) for part, frame in zip(parts, frames, strict=True)])


def _cut_or_kept(parts: list[Part], framed: list[Part]) -> list[Part]:
    """The parts cut at their neat lines; or, when every frame already held its content box (the paper trim did the cut), the parts
    as read, no sheet held back for want of a frame."""
    return framed if any(part.frame for part in framed) else parts


def framed_part(part: Part, found: NeatLine | None, px: int) -> Part:
    """The part cut at its neat line (`px` on its long side), or marked `unframed` when it has no confident one; a blank page stays, and
    so does a part whose content box already lies inside its neat line (`content_box` found the frame and trimmed its line)."""
    if part.blank:
        return part
    if found is None or not found.confident:
        return replace(part, unframed=True)
    if framing.holds(found.corners, part.box):
        return part
    width, height = framing.frame_size(found.corners)
    factor = px / max(width, height)
    size = (max(MIN_SIDE_PX, round(width * factor)), max(MIN_SIDE_PX, round(height * factor)))
    image = grey_of(framing.read_framed(part.path, found.corners, size))
    info = raster_info(part.path)
    box = framing.bounds(found.corners, (info.width, info.height))
    return replace(part, image=image, scale=width / size[0], box=box, frame=framing.corners_of(found.corners))


def turn_of(variant: int) -> int:
    """The variant's clockwise turn in degrees."""
    return (variant % TURNS) * 90


def flip_of(variant: int) -> bool:
    return variant >= TURNS


def variant_of(turn: int, flip: bool) -> int:
    return (turn // 90) % TURNS + (TURNS if flip else 0)


def oriented(image: UInt8Array, variant: int) -> UInt8Array:
    """The picture turned clockwise by the variant's turn, then mirrored left to right when it flips."""
    turned = numpy.rot90(image, -(variant % TURNS))
    return numpy.ascontiguousarray(numpy.fliplr(turned) if flip_of(variant) else turned)


def swaps(variant: int) -> bool:
    """True when the variant turns the picture a quarter (its width and height swap)."""
    return variant % 2 == 1


def same_shape(first: float, second: float) -> bool:
    return abs(math.log(first / second)) < SQUARE_SLACK


def cell_of(parts: Sequence[Part]) -> tuple[int, int]:
    """The series' cell (width, height): the median of the inked sheets' shapes, each turned to the majority's way."""
    inked = [part for part in parts if not part.blank] or list(parts)
    shapes = numpy.array([part.image.shape[:2][::-1] for part in inked], numpy.float64)
    portrait = shapes[:, 0] <= shapes[:, 1]
    turned = portrait != (portrait.mean() >= HALF)
    shapes[turned] = shapes[turned][:, ::-1]
    width, height = numpy.median(shapes, axis=0)
    return max(MIN_SIDE_PX, round(width)), max(MIN_SIDE_PX, round(height))


def allowed(part: Part, cell: tuple[int, int]) -> tuple[int, ...]:
    """The variants a sheet's shape allows on the cell: all eight on a square cell, else those that keep its long side the cell's."""
    cell_aspect = cell[0] / cell[1]
    if same_shape(cell_aspect, 1.0):
        return tuple(range(VARIANTS))
    quarter = not same_shape(part.aspect, cell_aspect) and same_shape(1 / part.aspect, cell_aspect)
    return tuple(variant for variant in range(VARIANTS) if swaps(variant) == quarter)


def on_cell(part: Part, variant: int, cell: tuple[int, int]) -> UInt8Array:
    """The working copy turned by `variant` and stretched to the cell."""
    picture = oriented(part.image, variant)
    return numpy.asarray(cv2.resize(picture, cell, interpolation=cv2.INTER_AREA), numpy.uint8)
