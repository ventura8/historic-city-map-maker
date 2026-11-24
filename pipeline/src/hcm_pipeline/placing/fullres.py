"""A composite warped from its parts' originals at full resolution (docs/research/M20-import-local.md §19.18).

An assembled atlas, overlapping pieces or an automatic layout is joined on a reduced canvas (`assemble.CANVAS_MAX_PX`,
`autostitch.CANVAS_MAX_PX`): matching, point placing and the Help calibrate picture work on it. The published map must not: each part
that made the canvas records its transform from its original's pixels to the canvas's (`Part.matrix`, a 3x3, continuous pixel
coordinates: a pixel's corner is 0) in a sidecar beside the canvas (`<canvas>.parts.json`, with the canvas's size). At warp time each
original is warped on its own through (part to canvas) composed with the canvas's georeference (the pairs, a thin-plate spline or an
affine: a lattice of the original's pixels carried to EPSG:3857 by GDAL's own transformer on the canvas), cut to the canvas pixels it
owns, and written into one GeoTIFF: the same nearest-centre hard seam the canvas has (`canvas_window.owners`, `assemble._owners`),
as a convex cell (the part's quad cut by the half-planes of its neighbours' centres). Memory stays bounded: GDAL reads the original
window by window within `WARP_MEMORY_MB` and its block cache is held to `CACHE_BYTES`; nothing is read whole.

An original that is gone, unreadable, or a canvas with no sidecar (a grid's mosaic, an overview canvas) leaves the canvas warped as
before, with the reason in the job's log: the job never fails on an original.
"""

import json
import math
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import numpy

from hcm_pipeline.jobs import JobContext
from hcm_pipeline.placing import inking
from hcm_pipeline.placing.geometry import FloatArray
from hcm_pipeline.placing.raster_io import RGB, WARP_MEMORY_MB, WarpPlan, normalised, warp_by_pairs
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import GTIFF_OPTIONS, WEB_MERCATOR, driver_of, srs_wkt

SUFFIX: Final = ".parts.json"
LATTICE: Final = 9
EDGE_STEPS: Final = 8
CACHE_BYTES: Final = 128 * 1024 * 1024
SHAPE_SLACK: Final = 0.01
Box = tuple[int, int, int, int]


@dataclass(frozen=True)
class Part:
    """A part of a canvas: its original, the box of it that is on the canvas (original pixels), and its 3x3 to canvas pixels."""

    path: Path
    box: Box
    matrix: FloatArray
    # The canvas pixels the part was pasted into (a polygon), when the canvas cut it there (a grid's cell); else its box's quad.
    clip: tuple[tuple[float, float], ...] = ()

    def as_record(self) -> dict[str, object]:
        record: dict[str, object] = {
            "path": str(self.path),
            "box": list(self.box),
            "matrix": [[float(v) for v in row] for row in self.matrix],
        }
        return record | ({"clip": [list(point) for point in self.clip]} if self.clip else {})

    @classmethod
    def of(cls, record: dict[str, object]) -> Part:
        box = [int(str(value)) for value in _listed(record["box"])]
        matrix = numpy.array([[float(str(value)) for value in _listed(row)] for row in _listed(record["matrix"])], numpy.float64)
        return cls(Path(str(record["path"])), (box[0], box[1], box[2], box[3]), matrix.reshape(3, 3), _clip_of(record))

    def quad(self) -> FloatArray:
        """The part's outline on the canvas, clockwise: its clip, else its box's corners."""
        if self.clip:
            return numpy.array(self.clip, numpy.float64)
        left, top, right, bottom = self.box
        return apply(self.matrix, numpy.array([[left, top], [right, top], [right, bottom], [left, bottom]], numpy.float64))

    def centre(self) -> FloatArray:
        return numpy.asarray(self.quad().mean(axis=0), numpy.float64)


def _clip_of(record: dict[str, object]) -> tuple[tuple[float, float], ...]:
    return tuple((float(str(x)), float(str(y))) for x, y in (_listed(point) for point in _listed(record.get("clip", []))))


def _listed(value: object) -> list[object]:
    if not isinstance(value, list):
        raise TypeError("a list was expected")
    return value


def apply(matrix: FloatArray, points: FloatArray) -> FloatArray:
    """Points (n, 2) through a 3x3 (affine or projective)."""
    moved = numpy.column_stack((points, numpy.ones(len(points)))) @ matrix.T
    return numpy.asarray(moved[:, :2] / moved[:, 2:3], numpy.float64)


def affine(*values: float) -> FloatArray:
    """The 3x3 of an affine's six values, row by row."""
    return numpy.array([values[:3], values[3:6], (0.0, 0.0, 1.0)], numpy.float64)


def _homogeneous(matrix: FloatArray) -> FloatArray:
    return matrix if matrix.shape == (3, 3) else numpy.vstack((matrix, [0.0, 0.0, 1.0]))


def indexed(matrix: FloatArray) -> FloatArray:
    """A 2x3 that maps pixel indices (cv2's `warpAffine`) as a 3x3 on continuous coordinates (a pixel's corner is 0)."""
    return affine(1, 0, 0.5, 0, 1, 0.5) @ _homogeneous(matrix) @ affine(1, 0, -0.5, 0, 1, -0.5)


def size_of(path: Path) -> tuple[int, int]:
    dataset = gdal.Open(str(path))
    size = (int(dataset.RasterXSize), int(dataset.RasterYSize))
    dataset.Close()
    return size


def same_shape(size: tuple[int, int], picture: tuple[int, int]) -> bool:
    """True when a canvas of `size` and the picture have the same shape (to `SHAPE_SLACK`): the picture is the canvas, smaller."""
    return abs(size[0] / size[1] - picture[0] / picture[1]) <= SHAPE_SLACK * picture[0] / picture[1]


def sidecar(canvas: Path) -> Path:
    return canvas.with_name(canvas.name + SUFFIX)


def write_parts(canvas: Path, parts: Sequence[Part], size: tuple[int, int]) -> Path:
    """The parts' transforms beside the canvas (`size`: its width and height)."""
    target = sidecar(canvas)
    target.write_text(json.dumps({"size": list(size), "parts": [part.as_record() for part in parts]}))
    return target


@dataclass(frozen=True)
class Recorded:
    """A canvas's parts as recorded, and the canvas's size they were recorded on."""

    parts: tuple[Part, ...]
    size: tuple[int, int]

    def on(self, picture: tuple[int, int]) -> tuple[Part, ...]:
        """The parts to a picture of the canvas at another size (the stitched picture, the georeferencer's scan)."""
        rescale = affine(picture[0] / self.size[0], 0, 0, 0, picture[1] / self.size[1], 0)
        return tuple(Part(part.path, part.box, rescale @ part.matrix, _scaled_clip(part.clip, rescale)) for part in self.parts)


def _scaled_clip(clip: tuple[tuple[float, float], ...], rescale: FloatArray) -> tuple[tuple[float, float], ...]:
    if not clip:
        return ()
    return tuple((float(x), float(y)) for x, y in apply(rescale, numpy.array(clip, numpy.float64)))


def read_parts(canvas: Path) -> Recorded | None:
    """The canvas's recorded parts, else None (no sidecar, or one that does not parse)."""
    found = sidecar(canvas)
    if not found.is_file():
        return None
    try:
        record = json.loads(found.read_text())
        size = (int(record["size"][0]), int(record["size"][1]))
        return Recorded(tuple(Part.of(part) for part in record["parts"]), size)
    except ValueError, KeyError, TypeError, IndexError:
        return None


def _clip(polygon: FloatArray, normal: FloatArray, limit: float) -> FloatArray:
    """The polygon's part where `normal . p <= limit` (Sutherland-Hodgman on one half-plane)."""
    kept: list[FloatArray] = []
    for index, point in enumerate(polygon):
        follower = polygon[(index + 1) % len(polygon)]
        a, b = float(normal @ point) - limit, float(normal @ follower) - limit
        if a <= 0:
            kept.append(point)
        if a * b < 0:
            kept.append(point + (follower - point) * (a / (a - b)))
    return numpy.array(kept, numpy.float64).reshape(-1, 2)


def cells(parts: Sequence[Part]) -> list[FloatArray]:
    """Each part's canvas pixels: its quad, nearer its own centre than any other part's (the canvas's hard seam)."""
    centres = [part.centre() for part in parts]
    return [
        _cell(part.quad(), centres[index], [centre for other, centre in enumerate(centres) if other != index])
        for index, part in enumerate(parts)
    ]


def _cell(polygon: FloatArray, own: FloatArray, others: Sequence[FloatArray]) -> FloatArray:
    """The polygon cut by the half-plane nearer `own` than each other centre (a centre on `own` cuts nothing)."""
    for centre in others:
        if len(polygon) and not numpy.allclose(centre, own):
            normal = centre - own
            polygon = _clip(polygon, normal, float(normal @ (centre + own) / 2.0))
    return polygon


def missing(parts: Sequence[Part]) -> str | None:
    """Why the originals cannot be warped (the first one that is gone or unreadable), else None."""
    for part in parts:
        if not part.path.is_file():
            return f"the original {part.path.name} is not on this computer"
        if not _readable(part.path):
            return f"the original {part.path.name} cannot be read"
    return None


def _readable(path: Path) -> bool:
    try:
        dataset = gdal.Open(str(path))
    except RuntimeError:
        return False
    dataset.Close()
    return True


class Placer:
    """The canvas's georeference (its pairs, in canvas pixels) as GDAL's transformer: canvas pixels to EPSG:3857 metres."""

    def __init__(self, plan: WarpPlan, size: tuple[int, int]) -> None:
        self.memory = driver_of("MEM").Create("", size[0], size[1], 1, gdal.GDT_Byte)
        gcps = [gdal.GCP(pair.mx, pair.my, 0.0, pair.px, pair.py) for pair in plan.pairs]
        self.memory.SetGCPs(gcps, srs_wkt(WEB_MERCATOR))
        options = ["METHOD=GCP_TPS"] if plan.tps else ["METHOD=GCP_POLYNOMIAL", "MAX_GCP_ORDER=1"]
        self.transformer = gdal.Transformer(self.memory, None, options)

    def places(self, pixels: FloatArray) -> FloatArray:
        found, _ok = self.transformer.TransformPoints(0, [(float(x), float(y)) for x, y in pixels])
        return numpy.array([(x, y) for x, y, *_rest in found], numpy.float64).reshape(-1, 2)


def _lattice(box: Box) -> FloatArray:
    left, top, right, bottom = box
    u, v = numpy.meshgrid(numpy.linspace(left, right, LATTICE), numpy.linspace(top, bottom, LATTICE))
    return numpy.column_stack((u.ravel(), v.ravel()))


def _dense(polygon: FloatArray) -> FloatArray:
    """The polygon with `EDGE_STEPS` points per edge (a straight canvas edge bends once placed)."""
    steps = numpy.linspace(0.0, 1.0, EDGE_STEPS, endpoint=False)
    edges = [a + numpy.outer(steps, b - a) for a, b in zip(polygon, numpy.roll(polygon, -1, axis=0), strict=True)]
    return numpy.vstack(edges)


@dataclass(frozen=True)
class Placed:
    """A part ready to warp: its source (a VRT of the original with its pairs), and its cell placed (EPSG:3857 metres)."""

    source: str
    cell: FloatArray
    # Mercator metres a pixel of the original covers once placed (`inking`: line art much finer than the output is averaged).
    source_m: float = 0.0


def _bands(path: Path) -> int:
    vrt = normalised(path)
    try:
        dataset = gdal.Open(vrt)
        count = int(dataset.RasterCount)
        dataset.Close()
    finally:
        gdal.Unlink(vrt)
    return count


def _source(part: Part, placer: Placer, bands: int) -> str:
    """The original as a VRT of `bands` 8-bit bands carrying its lattice's places (original pixels to EPSG:3857 metres)."""
    pixels = _lattice(part.box)
    places = placer.places(apply(part.matrix, pixels))
    gcps = [gdal.GCP(mx, my, 0.0, px, py) for (px, py), (mx, my) in zip(pixels, places, strict=True)]
    vrt = normalised(part.path)
    target = f"/vsimem/hcm-full-{uuid.uuid4().hex}.vrt"
    grey_in_colour = {"bandList": [1, 1, 1]} if bands == RGB and _bands(part.path) == 1 else {}
    gdal.Translate(target, vrt, format="VRT", GCPs=gcps, outputSRS=srs_wkt(WEB_MERCATOR), **grey_in_colour).Close()
    return target


def _output(placed: Sequence[Placed], target: Path, resolution: float, bands: int) -> gdal.Dataset:
    """The output GeoTIFF over every placed cell, its pixels on the `resolution` grid (as `targetAlignedPixels`), alpha last."""
    every = numpy.vstack([found.cell for found in placed])
    left, bottom = (math.floor(value / resolution) * resolution for value in every.min(axis=0))
    right, top = (math.ceil(value / resolution) * resolution for value in every.max(axis=0))
    width, height = max(1, round((right - left) / resolution)), max(1, round((top - bottom) / resolution))
    dataset = driver_of("GTiff").Create(str(target), width, height, bands + 1, gdal.GDT_Byte, list(GTIFF_OPTIONS))
    dataset.SetGeoTransform((float(left), resolution, 0.0, float(top), 0.0, -resolution))
    dataset.SetProjection(srs_wkt(WEB_MERCATOR))
    dataset.GetRasterBand(bands + 1).SetColorInterpretation(gdal.GCI_AlphaBand)
    return dataset


def _cutline(cell: FloatArray, target: Path) -> str:
    ring = [[float(x), float(y)] for x, y in cell] + [[float(cell[0][0]), float(cell[0][1])]]
    feature = {"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [ring]}}
    target.write_text(json.dumps({"type": "FeatureCollection", "features": [feature]}))
    return str(target)


def _source_m(part: Part, placer: Placer) -> float:
    """Mercator metres per pixel of the part's original, along its box's top edge once placed."""
    left, top, right, _bottom = part.box
    ends = placer.places(apply(part.matrix, numpy.array([[left, top], [right, top]], numpy.float64)))
    return float(numpy.hypot(*(ends[1] - ends[0]))) / max(1, right - left)


@dataclass(frozen=True)
class Originals:
    """What a canvas's parts' originals hold: their median Mercator metres a pixel and the Mercator area they cover."""

    mercator_m: float
    area_m2: float


def originals_of(source: Path, plan: WarpPlan) -> Originals | None:
    """The parts' originals' resolution once placed by the plan's pairs, else None (no parts record that fits the picture)."""
    recorded = read_parts(source)
    size = size_of(source)
    fits = recorded is not None and bool(recorded.parts) and same_shape(recorded.size, size)
    return _measured(recorded.on(size), Placer(plan, size)) if fits and recorded is not None else None


def _measured(parts: Sequence[Part], placer: Placer) -> Originals:
    metres = [_source_m(part, placer) for part in parts]
    area = sum(_box_area(part.box) * found**2 for part, found in zip(parts, metres, strict=True))
    return Originals(float(numpy.median(metres)), float(area))


def _box_area(box: Box) -> int:
    return (box[2] - box[0]) * (box[3] - box[1])


def _placed(parts: Sequence[Part], placer: Placer, bands: int) -> list[Placed]:
    found = []
    for part, cell in zip(parts, cells(parts), strict=True):
        if len(cell) >= RGB:
            found.append(Placed(_source(part, placer, bands), placer.places(_dense(cell)), _source_m(part, placer)))
    return found


def _resampling(plan: WarpPlan, parts: Sequence[Part], placed: Sequence[Placed]) -> tuple[str, float]:
    """The warp's resampling and ratio (`inking.chosen`)."""
    return inking.chosen(plan, [part.path for part in parts], [found.source_m for found in placed])


def warp_parts(parts: Sequence[Part], canvas_size: tuple[int, int], target: Path, plan: WarpPlan) -> Path:
    """Every part's original warped into one GeoTIFF at the plan's resolution, each inside its own cell, an alpha band last."""
    bands = max(_bands(part.path) for part in parts)
    placer = Placer(plan, canvas_size)
    placed = _placed(parts, placer, bands)
    previous = gdal.GetCacheMax()
    gdal.SetCacheMax(CACHE_BYTES)
    algorithm, ratio = _resampling(plan, parts, placed)
    try:
        output = _output(placed, target, plan.resolution, bands)
        for index, found in enumerate(placed):
            _warp_one(output, found, algorithm, target.with_name(f"{target.stem}-cut-{index}.geojson"))
        inking.finish(output, bands, algorithm, ratio)
        output.Close()
    finally:
        gdal.SetCacheMax(previous)
        for found in placed:
            gdal.Unlink(found.source)
    return target


def _warp_one(output: gdal.Dataset, found: Placed, algorithm: str, cut_path: Path) -> None:
    cut = _cutline(found.cell, cut_path)
    try:
        gdal.Warp(
            output,
            found.source,
            tps=True,
            dstAlpha=True,
            cutlineDSName=cut,
            cutlineSRS=srs_wkt(WEB_MERCATOR),
            warpMemoryLimit=WARP_MEMORY_MB,
            resampleAlg=algorithm,
        )
    finally:
        cut_path.unlink(missing_ok=True)


VERSION_RECORD: Final = "parts.json"


def keep_for_version(ctx: JobContext, picture: Path) -> None:
    """The picture's parts record with the version's files (`parts.json`), so a later `regeoref` warps the originals too."""
    found = sidecar(picture)
    if found.is_file():
        ctx.publish(found, ctx.version_file(VERSION_RECORD), "application/json")


def warp_composite(source: Path, target: Path, plan: WarpPlan, log: Callable[[str], None]) -> Path:
    """`source` (a canvas, or any picture) warped by the plan: from its parts' originals when it records them and they can be read,
    else the picture itself, the reason logged (`log`)."""
    recorded = read_parts(source)
    if recorded is None:
        return warp_by_pairs(source, target, plan)
    size = size_of(source)
    parts = recorded.on(size)
    reason = missing(parts) if same_shape(recorded.size, size) else "the parts record does not fit this picture"
    if reason is None:
        try:
            log(f"the {len(parts)} parts are warped from their originals at full resolution")
            return warp_parts(parts, size, target, plan)
        except RuntimeError as error:
            reason = f"warping the originals failed ({error})"
    log(f"{reason}: the reduced canvas is warped instead")
    return warp_by_pairs(source, target, plan)
