"""Each canvas builder's parts record (docs/research/M20-import-local.md §19.18): its parts' originals to its canvas pixels.

`tile_part` for a `canvas_window` tile (automatic and owner layouts), `layout_parts` for an `assemble.Layout` (atlases, pieces) and
`overview_parts` for the tiles laid on an overview; the grid's mosaic writes its own (`grid.mosaic_parts`). `fullres` reads them.
"""

import math
from collections.abc import Sequence
from pathlib import Path
from typing import Final

import numpy

from hcm_pipeline.placing import framing
from hcm_pipeline.placing.canvas_window import Tile
from hcm_pipeline.placing.fullres import Part, Recorded, affine, apply, indexed, size_of
from hcm_pipeline.placing.geometry import FloatArray
from hcm_pipeline.placing.sheetwork import flip_of, swaps
from hcm_pipeline.rasters import fit_long_side

TURNS: Final = 4


def _variant(variant: int, size: tuple[float, float]) -> FloatArray:
    """`sheetwork.oriented` on coordinates: `variant % 4` quarter turns clockwise, then a mirror left to right when it flips."""
    width, height = size
    matrix: FloatArray = numpy.asarray(numpy.eye(3), numpy.float64)
    for _ in range(variant % TURNS):
        matrix = affine(0, -1, height, 1, 0, 0) @ matrix
        width, height = height, width
    return affine(-1, 0, width, 0, 1, 0) @ matrix if flip_of(variant) else matrix


def _turn(angle: float, size: tuple[int, int]) -> FloatArray:
    """`canvas_window.turned` on coordinates: a turn by `angle` degrees clockwise about the picture's centre."""
    radians = math.radians(angle)
    cos, sin = math.cos(radians), math.sin(radians)
    cx, cy = size[0] / 2.0, size[1] / 2.0
    return affine(cos, -sin, cx - cos * cx + sin * cy, sin, cos, cy - sin * cx - cos * cy)


def tile_part(tile: Tile) -> Part:
    """A `canvas_window` tile's original to the canvas: its box read at the tile's size (a framed sheet: its neat line onto the read
    rectangle, clipped there), turned by its variant and its angle, moved."""
    read = (tile.height, tile.width) if swaps(tile.variant) else (tile.width, tile.height)
    matrix = _variant(tile.variant, (float(read[0]), float(read[1]))) @ _to_read(tile, read)
    if tile.angle:
        matrix = _turn(tile.angle, (tile.width, tile.height)) @ matrix
    matrix = affine(1, 0, tile.left, 0, 1, tile.top) @ matrix
    clip = tuple((float(x), float(y)) for x, y in apply(matrix, numpy.array(tile.frame, numpy.float64))) if tile.frame else ()
    return Part(tile.path, tile.box, matrix, clip)


def _to_read(tile: Tile, read: tuple[int, int]) -> FloatArray:
    """The tile's scan to the picture read for it, before its turn: the frame onto the read rectangle, else the box scaled."""
    if tile.frame:
        return framing.to_frame(tile.frame, read)
    left, top, right, bottom = tile.box
    sx, sy = read[0] / max(1, right - left), read[1] / max(1, bottom - top)
    return affine(sx, 0, -left * sx, 0, sy, -top * sy)


def working_part(path: Path, full: tuple[int, int], working: tuple[int, int], crop: tuple[int, int], matrix: FloatArray) -> Part:
    """An `assemble.Layout` part: the original (`full` pixels) read at `working` size, cropped from `crop` (working pixels, the frame's
    corner), then `matrix` (a 2x3 on working pixel indices) to the canvas."""
    to_working = affine(working[0] / full[0], 0, -crop[0], 0, working[1] / full[1], -crop[1])
    left, top = (math.floor(crop[0] * full[0] / working[0]), math.floor(crop[1] * full[1] / working[1]))
    return Part(path, (left, top, full[0], full[1]), indexed(matrix) @ to_working)


def layout_parts(
    paths: Sequence[Path], placed: dict[int, FloatArray], max_px: int, crops: Sequence[tuple[int, int]] | None = None
) -> tuple[Part, ...]:
    """An `assemble.Layout`'s placed parts, each read at most `max_px` long (`raster_io.read_working`) and cropped from `crops`."""
    found = []
    for index, matrix in placed.items():
        full = size_of(paths[index])
        width, height, _scale = fit_long_side(full[0], full[1], max_px)
        crop = (0, 0) if crops is None else crops[index]
        found.append(working_part(paths[index], full, (width, height), crop, matrix))
    return tuple(found)


def overview_parts(tiles: Sequence[tuple[str, Path]], on_canvas: dict[str, FloatArray], read_px: int, size: tuple[int, int]) -> Recorded:
    """An overview canvas's placed tiles (`overview.MosaicReport.on_canvas`, each read at most `read_px` long) as its parts record."""
    placed = {index: on_canvas[name] for index, (name, _path) in enumerate(tiles) if name in on_canvas}
    return Recorded(layout_parts([path for _name, path in tiles], placed, read_px), size)
