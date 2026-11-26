"""An atlas's or owner-laid series' sheets cut at their neat lines (docs/research/M20-import-local.md §19.20; lesson of 2026-11-24).

`neatline` frames a grid series' sheets (`grid.framed`); a series laid out as an atlas, by names and seams or by its owner's layout
(`sheetwork`, `autostitch`, `owner_layout`), only trimmed its paper margins, so the plan cadastral 1911-1914 was mosaicked with white
bands, its "Seria / Coloana" headers at every seam and its streets broken across them. Here the same finder runs on such a series:

1. A sample of up to `SAMPLE` sheets, spread over the series, is read first (`neatline.read_lines`): the series counts as framed only
   when the sample shares a cell on both axes and at least `FRAMED_SHARE_MIN` of it is framed confidently (`neatline.CONFIDENT`). A
   series of photos or pages without a printed frame costs that sample and nothing more.
2. Then every sheet is read, the cell learnt from all of them, and each sheet framed with the same rules as a grid's sheet.
3. A framed sheet is read straight onto its frame (`read_framed`: the frame's box, then an affine onto the frame's rectangle, paper
   beyond a side the scanner cut); a sheet with no confident frame is marked `unframed` and never mosaicked with its margins: the
   series waits in Help calibrate with it named (`no-frame`, `frame-not-found`).

Memory: one sheet's reduced copy at a time; the series keeps only each sheet's lines.
"""

from collections.abc import Sequence
from pathlib import Path
from typing import Final

import cv2
import numpy

from hcm_pipeline.placing import neatline
from hcm_pipeline.placing.geometry import FloatArray, affine
from hcm_pipeline.placing.neatline import NeatLine
from hcm_pipeline.placing.raster_io import RGB, UInt8Array, read_box, read_box_inked
from hcm_pipeline.rasters import raster_info

SAMPLE: Final = 24
FRAMED_SHARE_MIN: Final = 0.5
PAPER: Final = 255
INSIDE_SLACK: Final = 0.01
UNFRAMED: Final = (
    "The frame of {count} of {total} sheets was not found, so they would be missing from the map: open Help calibrate, which"
    " lists them, and place the series there."
)

Box = tuple[int, int, int, int]
# A frame's four corners (scan pixels, top left first, clockwise) as plain numbers, so the dataclasses holding it compare and hash.
Corners = tuple[tuple[float, float], ...]


def sample_of(count: int) -> list[int]:
    """Up to `SAMPLE` indices spread evenly over `count` sheets."""
    return sorted({int(index) for index in numpy.linspace(0, count - 1, min(count, SAMPLE)).round()})


def _framed_share(frames: Sequence[NeatLine | None]) -> float:
    return sum(frame is not None and frame.confident for frame in frames) / max(1, len(frames))


def _frames(sheets: Sequence[neatline.SheetLines], aspect: float) -> list[NeatLine | None] | None:
    """Each sheet's frame with the cell they share, or None when no cell is shared on both axes or too few are framed."""
    cell = neatline.series_cell(sheets, aspect)
    if cell[0] is None or cell[1] is None:
        return None
    frames = [neatline.sheet_frame(sheet, cell) for sheet in sheets]
    return frames if _framed_share(frames) >= FRAMED_SHARE_MIN else None


def series_neatlines(paths: Sequence[Path], aspect: float) -> list[NeatLine | None] | None:
    """Every sheet's neat line (None for a sheet with none), or None when the series is not one of framed sheets (`aspect`: the
    cell's width over its height, used only where one axis shares no gap)."""
    if not paths:
        return None
    lines = {index: neatline.read_lines(paths[index]) for index in sample_of(len(paths))}
    if _frames(list(lines.values()), aspect) is None:
        return None
    return _frames(_all_lines(paths, lines), aspect)


def _all_lines(paths: Sequence[Path], read: dict[int, neatline.SheetLines]) -> list[neatline.SheetLines]:
    """Every sheet's lines, those of the sample already `read` kept."""
    return [read[index] if index in read else neatline.read_lines(path) for index, path in enumerate(paths)]


def corners_of(corners: FloatArray) -> Corners:
    return tuple((float(x), float(y)) for x, y in numpy.asarray(corners, numpy.float64))


def holds(corners: FloatArray | Corners, box: Box) -> bool:
    """True when the content box (scan pixels) lies inside the frame, give or take `INSIDE_SLACK` of the frame's size: nothing outside
    the neat line (margins, titles, the border line) is left to cut."""
    points = numpy.asarray(corners, numpy.float64)
    low, high = points.min(axis=0), points.max(axis=0)
    slack = INSIDE_SLACK * float((high - low).max())
    return bool(box[0] >= low[0] - slack and box[1] >= low[1] - slack and box[2] <= high[0] + slack and box[3] <= high[1] + slack)


def frame_size(corners: FloatArray | Corners) -> tuple[float, float]:
    """The frame's width and height (scan pixels): the mean of its opposite sides."""
    top_left, top_right, bottom_right, bottom_left = (numpy.asarray(corner, numpy.float64) for corner in corners)
    width = (numpy.linalg.norm(top_right - top_left) + numpy.linalg.norm(bottom_right - bottom_left)) / 2
    height = (numpy.linalg.norm(bottom_left - top_left) + numpy.linalg.norm(bottom_right - top_right)) / 2
    return float(width), float(height)


def to_frame(corners: FloatArray | Corners, size: tuple[int, int]) -> FloatArray:
    """The 3x3 affine (continuous coordinates) from scan pixels to the frame's rectangle `size` (width, height), its corners on the
    rectangle's (least squares over the four)."""
    width, height = size
    target = numpy.array([[0, 0], [width, 0], [width, height], [0, height]], numpy.float64)
    found = affine(numpy.asarray(corners, numpy.float64), target)
    if found is None:
        raise ValueError("a frame's corners lie in a line")
    return numpy.vstack((found, [0.0, 0.0, 1.0]))


def bounds(corners: FloatArray | Corners, full: tuple[int, int]) -> Box:
    """The frame's box on the scan (left, top, right, bottom), cut at the scan's edges (a side the scanner cut lies beyond)."""
    points = numpy.asarray(corners, numpy.float64)
    low, high = numpy.floor(points.min(axis=0)), numpy.ceil(points.max(axis=0))
    left, top = max(0, int(low[0])), max(0, int(low[1]))
    return left, top, max(left + 1, min(full[0], int(high[0]))), max(top + 1, min(full[1], int(high[1])))


def _on_indices(matrix: FloatArray) -> FloatArray:
    """A 3x3 on continuous coordinates (a pixel's corner is 0) as the 2x3 on pixel indices `cv2.warpAffine` takes."""
    half = numpy.array([[1, 0, 0.5], [0, 1, 0.5], [0, 0, 1]], numpy.float64)
    back = numpy.array([[1, 0, -0.5], [0, 1, -0.5], [0, 0, 1]], numpy.float64)
    return numpy.asarray((back @ matrix @ half)[:2], numpy.float64)


def _read(path: Path, box: Box, factor: tuple[float, float], inked: bool) -> tuple[UInt8Array, tuple[float, float]]:
    """The box read at about `factor` of its size, and the read's pixels per scan pixel. Inked (`read_box_inked`), the scan's blocks
    are whole: the box is widened to a whole number of blocks a side (paper beyond the scan), or a side's last pixels would be lost
    and the picture stretched by their share (lesson of 2026-11-24: a paper band at each sheet's foot)."""
    across, down = box[2] - box[0], box[3] - box[1]
    if inked:
        block = max(1, int(min(1 / factor[0], 1 / factor[1])))
        read = (-(-across // block), -(-down // block))
        whole = (box[0], box[1], box[0] + block * read[0], box[1] + block * read[1])
        return read_box_inked(path, whole, read), (1 / block, 1 / block)
    read = (max(1, round(across * factor[0])), max(1, round(down * factor[1])))
    return read_box(path, box, read), (read[0] / across, read[1] / down)


def read_framed(path: Path, corners: FloatArray | Corners, size: tuple[int, int], inked: bool = False) -> UInt8Array:
    """The sheet inside its frame, straightened to `size` (width, height): only the frame's box read (by GDAL's average, or keeping
    its ink), at about the size's scale, then the affine onto the rectangle; paper where the frame runs off the scan."""
    info = raster_info(path)
    box = bounds(corners, (info.width, info.height))
    width, height = frame_size(corners)
    image, (sx, sy) = _read(path, box, (size[0] / max(1.0, width), size[1] / max(1.0, height)), inked)
    from_read = numpy.array([[1 / sx, 0, box[0]], [0, 1 / sy, box[1]], [0, 0, 1]], numpy.float64)
    matrix = _on_indices(to_frame(corners, size) @ from_read)
    border = (PAPER,) * (image.shape[2] if image.ndim == RGB else 1)
    moved = cv2.warpAffine(image, matrix, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=border)
    return numpy.asarray(moved, numpy.uint8)
