"""A synthetic town for the archive's placers (docs/research/M20-import-local.md §10 C, D, E): streets in EPSG:3857 and maps drawn of them.

The town is a seeded street network around the test world's centre: a grid bent and jittered so no two junctions look alike from afar,
with a few long avenues across it. `overpass_of` gives it as Overpass's answer (OpenStreetMap's side). `draw_map` draws a map of it as a
scan would show one: streets as paper corridors between blocks (line art: blocks outlined in ink; grey: blocks filled; colour: red
blocks), a neat line, a margin outside it and a cartouche of text-like marks, through a known placement (Mercator to map pixels: a
similarity, plus an optional smooth drafting distortion). Everything is drawn into pytest's tmp_path; no raster is committed.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy
from hcm_pipeline.geo import to_lnglat_arrays, to_mercator
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import GeoTiff, write_geotiff
from numpy.typing import NDArray

from tests.synthetic.scenes import CENTRE

Line = NDArray[numpy.float64]


@dataclass(frozen=True)
class TownSpec:
    """The town's half size (metres), its block size, the jitter of its grid and its seed."""

    half_m: float = 2600.0
    block_m: float = 180.0
    jitter_m: float = 45.0
    seed: int = 7
    centre: tuple[float, float] = CENTRE


def _bend(points: Line, spec: TownSpec) -> Line:
    """A smooth bend of the grid (so its streets are not straight), the same for every line."""
    x, y = points[:, 0], points[:, 1]
    k = 2 * math.pi / (spec.half_m * 1.7)
    return numpy.column_stack((x + 60 * numpy.sin(y * k), y + 60 * numpy.sin(x * k * 1.3)))


DEFAULT_TOWN = TownSpec()


def town_lines(spec: TownSpec = DEFAULT_TOWN) -> list[Line]:
    """The town's streets as polylines in Mercator metres."""
    rng = numpy.random.default_rng(spec.seed)
    steps = numpy.arange(-spec.half_m, spec.half_m + 1, spec.block_m)
    jitter = rng.uniform(-spec.jitter_m, spec.jitter_m, (len(steps), len(steps), 2))
    cx, cy = to_mercator(*spec.centre)
    nodes = numpy.stack(numpy.meshgrid(steps, steps), axis=-1) + jitter
    keep = rng.random((len(steps), len(steps))) > 0.12
    lines: list[Line] = []
    for row in range(len(steps)):
        lines.extend(_runs(nodes[row, :], keep[row, :]))
        lines.extend(_runs(nodes[:, row], keep[:, row]))
    lines.extend(numpy.array([[-spec.half_m, -spec.half_m * f], [spec.half_m, spec.half_m * f]]) for f in (0.3, -0.6))
    return [_bend(line, spec) + numpy.array([cx, cy]) for line in lines]


def _runs(nodes: Line, keep: NDArray[numpy.bool_]) -> list[Line]:
    """The street along `nodes` cut where a node is dropped (so the network has dead ends and T junctions)."""
    runs, current = [], []
    for node, kept in zip(nodes, keep, strict=True):
        if kept:
            current.append(node)
        elif len(current) > 1:
            runs.append(numpy.array(current))
            current = []
        else:
            current = []
    if len(current) > 1:
        runs.append(numpy.array(current))
    return runs


def overpass_of(lines: Sequence[Line]) -> dict[str, object]:
    """The town's streets as an Overpass `out geom` answer."""
    elements: list[dict[str, object]] = []
    for index, line in enumerate(lines, start=1):
        lng, lat = to_lnglat_arrays(line[:, 0], line[:, 1])
        geometry = [{"lat": float(b), "lon": float(a)} for a, b in zip(lng, lat, strict=True)]
        elements.append({"type": "way", "id": index, "tags": {"highway": "residential"}, "geometry": geometry})
    return {"version": 0.6, "elements": elements}


@dataclass(frozen=True)
class Drawing:
    """How a map is drawn: Mercator to map pixels (2x3), the image size, the style, the street width and a drafting distortion."""

    matrix: NDArray[numpy.float64]
    size: tuple[int, int]
    style: str = "grey"
    street_px: int = 7
    wobble_px: float = 0.0
    margin_px: int = 60
    cartouche: bool = True
    extra: list[Line] = field(default_factory=list)

    def to_pixels(self, points: Line) -> Line:
        moved = points @ self.matrix[:, :2].T + self.matrix[:, 2]
        if self.wobble_px:
            width, height = self.size
            moved = moved + self.wobble_px * numpy.column_stack(
                (numpy.sin(moved[:, 1] / height * math.pi * 2), numpy.sin(moved[:, 0] / width * math.pi * 2))
            )
        return moved


def placement(
    metres_per_px: float, rotation_deg: float, centre_px: tuple[float, float], centre: tuple[float, float] = CENTRE
) -> NDArray[numpy.float64]:
    """Mercator metres to map pixels: the town's centre at `centre_px`, north up turned by `rotation_deg`, y down."""
    cx, cy = to_mercator(*centre)
    angle = math.radians(rotation_deg)
    k = 1.0 / metres_per_px
    linear = numpy.array([[k * math.cos(angle), -k * math.sin(angle)], [-k * math.sin(angle), -k * math.cos(angle)]])
    shift = numpy.array(centre_px) - linear @ numpy.array([cx, cy])
    return numpy.column_stack((linear, shift))


def _canvas(drawing: Drawing) -> NDArray[numpy.uint8]:
    width, height = drawing.size
    ink = {"lineart": 255, "grey": 70, "colour": 0}[drawing.style]
    image = numpy.full((height, width, 3), ink, numpy.uint8)
    if drawing.style == "colour":
        image[:] = (190, 60, 50)
    return image


def _frame(image: NDArray[numpy.uint8], drawing: Drawing) -> None:
    """The margin outside the neat line, the neat line and a cartouche of text-like marks."""
    width, height = drawing.size
    margin = drawing.margin_px
    image[:margin], image[-margin:], image[:, :margin], image[:, -margin:] = 250, 250, 250, 250
    cv2.rectangle(image, (margin, margin), (width - margin, height - margin), (0, 0, 0), 3)
    if not drawing.cartouche:
        return
    cv2.rectangle(image, (margin + 20, height - margin - 90), (margin + 260, height - margin - 20), (250, 248, 240), -1)
    for row in range(3):
        cv2.putText(image, "PLANUL ORASULUI", (margin + 30, height - margin - 70 + row * 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)


def draw_map(lines: Sequence[Line], drawing: Drawing) -> NDArray[numpy.uint8]:
    """The map as RGB pixels (grey and line art have three equal bands)."""
    image = _canvas(drawing)
    drawn = [numpy.round(drawing.to_pixels(line) * 4).astype(numpy.int32) for line in [*lines, *drawing.extra]]
    if drawing.style == "lineart":
        cv2.polylines(image, drawn, False, (0, 0, 0), drawing.street_px + 4, cv2.LINE_8, 2)
    cv2.polylines(image, drawn, False, (250, 248, 240), drawing.street_px, cv2.LINE_8, 2)
    if drawing.margin_px:
        _frame(image, drawing)
    return image


def write_map(path: Path, image: NDArray[numpy.uint8], grey: bool = False, dpi: int | None = None) -> Path:
    """The drawn map as a plain (not georeferenced) TIFF scan, grey or RGB, with its dpi when given."""
    bands = [image[:, :, 0]] if grey else [image[:, :, index] for index in range(3)]
    write_geotiff(path, GeoTiff(bands, None), ("COMPRESS=DEFLATE",))
    if dpi:
        dataset = gdal.Open(str(path), gdal.GA_Update)
        for tag, value in (("TIFFTAG_XRESOLUTION", str(dpi)), ("TIFFTAG_YRESOLUTION", str(dpi)), ("TIFFTAG_RESOLUTIONUNIT", "2")):
            dataset.SetMetadataItem(tag, value)
        dataset.Close()
    return path
