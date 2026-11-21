"""A part through GDAL: its scan staged, its map or its nodes attached, warped clipped to the window (M8-join-interfaces.md §3).

A part shows what its layer shows: its scan read through its own map (`steps/warp.py` `attached`): a thin-plate spline through its
points, or, over terrain (M15), its RPC over the heights it carries. A part's nodes carry a seam's field: for a part through points they
pair scan pixels with places; a part over terrain is first read through its RPC onto the level's grid, and its nodes pair that grid's
pixels (`ground_grid`, at `FINE_ZOOM`, moved to each level's grid: `regridded`) with places, so the spline between them carries the
smooth field alone and never the relief, which no spread of nodes holds (A001: 11 m RMS through 17 x 17). Warps stay memory-bounded
(`rasters.warp_memory_mb`) and stop with the run (`gdal_progress`). A scan is staged only while it is warped, or while a seam it lies on is
measured: on Cloud Run the scratch folder is memory.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import numpy
import numpy.typing

from hcm_pipeline.documents import GeorefInfo
from hcm_pipeline.geo import FloatArray, Grid, MercatorBox, to_mercator
from hcm_pipeline.images import as_uint8
from hcm_pipeline.jobs import JobContext
from hcm_pipeline.join.canvas import COARSE_ZOOM, FINE_ZOOM, DatasetSource, Raster, level_grid
from hcm_pipeline.join.correction import BaseTransform, Mapping, Node
from hcm_pipeline.join.plan import Part
from hcm_pipeline.join.room import out_of_room
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import GTIFF_OPTIONS, WEB_MERCATOR, driver_of, srs_wkt, warp_memory_mb
from hcm_pipeline.steps.common import gdal_step
from hcm_pipeline.steps.warp import attached, cutline, rendered_points

FLAT_GROUND: Final = 0.0
DST_SRS: Final = "DST_SRS=EPSG:3857"
FORWARD: Final = 0
REVERSE: Final = 1
TPS_METHOD: Final = ("METHOD=GCP_TPS",)


def node_source(scan: Path, nodes: Sequence[Node], target: Path) -> Path:
    """A VRT of the scan carrying the nodes (their targets in EPSG:3857 metres)."""
    gcps = [gdal.GCP(x, y, FLAT_GROUND, u, v) for u, v, x, y in nodes]
    gdal.Translate(str(target), str(scan), format="VRT", GCPs=gcps, outputSRS="EPSG:3857").Close()
    return target


def _mapping(transformer: gdal.Transformer, to_source: int) -> Mapping:
    def apply(a: FloatArray, b: FloatArray) -> tuple[FloatArray, FloatArray, numpy.typing.NDArray[numpy.bool_]]:
        points, good = transformer.TransformPoints(to_source, numpy.column_stack((a, b)).tolist())
        found = numpy.array(points, numpy.float64).reshape(-1, 3)
        return found[:, 0], found[:, 1], numpy.array(good, numpy.bool_)

    return apply


def _transformer(gcps: Sequence[gdal.GCP], size: tuple[int, int], method: Sequence[str]) -> gdal.Transformer:
    """GDAL's transformer of these points. It reads no pixel, so a band-less dataset holds them and no scan is fetched for it."""
    dataset = driver_of("MEM").Create("", size[0], size[1], 0)
    dataset.SetGCPs(list(gcps), srs_wkt(WEB_MERCATOR))
    return gdal.Transformer(dataset, None, [*method, DST_SRS])


def base_transform(georef: GeorefInfo, size: tuple[int, int]) -> BaseTransform:
    """GDAL's own transforms of the points the part renders through (`rendered_points`), pixel to EPSG:3857 and back: the very ones
    a warp through them uses."""
    gcps = [gdal.GCP(x, y, FLAT_GROUND, column, row) for x, y, column, row in rendered_points(georef, size)]
    transformer = _transformer(gcps, size, TPS_METHOD)
    return BaseTransform(_mapping(transformer, FORWARD), _mapping(transformer, REVERSE), _anchors(georef))


def ground_grid(part: Part, box: MercatorBox) -> Grid | None:
    """The grid a part over terrain is read on and its nodes are placed on (module docstring); None for a part through points."""
    return None if part.georef.terrain is None else level_grid(box, FINE_ZOOM)


def _grid_mapping(grid: Grid, to_pixel: bool) -> Mapping:
    def apply(a: FloatArray, b: FloatArray) -> tuple[FloatArray, FloatArray, numpy.typing.NDArray[numpy.bool_]]:
        x, y = grid.to_pixel(a, b) if to_pixel else grid.to_mercator(a, b)
        return x, y, numpy.ones(len(a), numpy.bool_)

    return apply


def part_transform(part: Part, box: MercatorBox) -> BaseTransform:
    """The part's own transform in its nodes' pixels: its points' (`base_transform`), or over terrain its ground grid's."""
    grid = ground_grid(part, box)
    if grid is None:
        return base_transform(part.georef, (part.scan.width, part.scan.height))
    return BaseTransform(_grid_mapping(grid, False), _grid_mapping(grid, True))


def part_size(part: Part, box: MercatorBox) -> tuple[int, int]:
    """The size of the pixels the part's nodes are placed on."""
    grid = ground_grid(part, box)
    return (part.scan.width, part.scan.height) if grid is None else (grid.width, grid.height)


def on_ground(scan: Path, georef: GeorefInfo, grid: Grid, local: Callable[[str], Path]) -> Path:
    """The scan read through its map onto `grid` (a warped VRT: only what is read is warped)."""
    found = attached(scan, georef, local)
    box, target = grid.box(), local(f"ground-{grid.resolution:.4f}.vrt")
    bounds = (box.left, box.bottom, box.right, box.top)
    options = {"format": "VRT", "dstSRS": "EPSG:3857", "outputBounds": bounds, "width": grid.width, "height": grid.height}
    gdal.Warp(str(target), str(found.source), resampleAlg="bilinear", dstAlpha=True, **options, **found.method).Close()
    return target


def regridded(nodes: Sequence[Node], reference: Grid, grid: Grid) -> tuple[Node, ...]:
    """Nodes placed on `reference`'s pixels moved to `grid`'s, the places unchanged."""
    values = numpy.array(nodes, numpy.float64).reshape(-1, 4)
    column, row = grid.to_pixel(*reference.to_mercator(values[:, 0], values[:, 1]))
    return tuple(zip(column.tolist(), row.tolist(), values[:, 2].tolist(), values[:, 3].tolist(), strict=True))


def _anchors(georef: GeorefInfo) -> tuple[tuple[float, float], ...]:
    """A thin-plate part's own points: no grid of samples holds what a spline through them holds."""
    if georef.transform != "tps":
        return ()
    return tuple(to_mercator(gcp.lng, gcp.lat) for gcp in georef.gcps if gcp.enabled)


def node_reverse(nodes: Sequence[Node], size: tuple[int, int]) -> Mapping:
    """What a warp through the nodes runs on: a place to the pixel it reads there."""
    gcps = [gdal.GCP(x, y, FLAT_GROUND, u, v) for u, v, x, y in nodes]
    return _mapping(_transformer(gcps, size, TPS_METHOD), REVERSE)


@dataclass
class Warper:
    """A join's warps of its parts over one box."""

    ctx: JobContext
    box: MercatorBox

    def _bounds(self) -> tuple[float, float, float, float]:
        return self.box.left, self.box.bottom, self.box.right, self.box.top

    def _options(self, part: Part, grid: Grid, method: dict[str, object]) -> dict[str, object]:
        ring = cutline(part.version, self.ctx.local(f"{part.version.id}-crop.geojson"))
        clipped = {key: value for key, value in ring.items() if key != "cropToCutline"}
        return {
            "outputBounds": self._bounds(),
            "dstSRS": "EPSG:3857",
            "xRes": grid.resolution,
            "yRes": grid.resolution,
            "resampleAlg": "bilinear",
            "dstAlpha": True,
            "warpMemoryLimit": warp_memory_mb(),
            **method,
            **clipped,
        }

    def _scan(self, part: Part) -> Path:
        try:
            return self.ctx.stage(part.scan.path, f"{part.version.id}-scan.tif")
        except OSError as error:
            raise out_of_room(part.entity_id, error) from error

    def release(self, part: Part) -> None:
        self.ctx.unstage(part.scan.path)

    def attached(self, part: Part, grid: Grid, nodes: Sequence[Node] = ()) -> tuple[Path, dict[str, object]]:
        """The staged scan as a VRT with its own map, or with its nodes (a thin-plate warp); a part over terrain with nodes is read
        onto `grid` first, its nodes moved to that grid."""
        scan = self._scan(part)

        def local(name: str) -> Path:
            return self.ctx.local(f"{part.version.id}-{name}")

        reference = ground_grid(part, self.box)
        if not nodes:
            found = gdal_step(self.ctx, lambda: attached(scan, part.georef, local), "attach the map")
            return found.source, found.method
        if reference is None:
            return gdal_step(self.ctx, lambda: node_source(scan, nodes, local("nodes.vrt")), "attach the nodes"), {"tps": True}
        ground = gdal_step(self.ctx, lambda: on_ground(scan, part.georef, grid, local), "read the frame over its terrain")
        moved = regridded(nodes, reference, grid)
        return gdal_step(self.ctx, lambda: node_source(ground, moved, local("nodes.vrt")), "attach the nodes"), {"tps": True}

    def preview(self, part: Part, nodes: Sequence[Node] = ()) -> Raster:
        """The part on the coarse level, in memory; its scan is released."""
        grid = level_grid(self.box, COARSE_ZOOM)
        source, method = self.attached(part, grid, nodes)
        options = {**self._options(part, grid, method), "format": "MEM", "callback": self.ctx.flags.gdal_progress}

        def work() -> Raster:
            dataset = gdal.Warp("", str(source), **options)
            grey, alpha = as_uint8(dataset.GetRasterBand(1).ReadAsArray()), as_uint8(dataset.GetRasterBand(2).ReadAsArray())
            dataset.Close()
            return Raster(grid, grey, alpha)

        raster = gdal_step(self.ctx, work, "warp a frame's preview")
        self.release(part)
        return raster

    def fine(self, part: Part) -> DatasetSource:
        """The part on the fine level as a warped VRT: only the tiles read are warped."""
        grid = level_grid(self.box, FINE_ZOOM)
        source, method = self.attached(part, grid)
        target = self.ctx.local(f"{part.version.id}-fine.vrt")
        options = {**self._options(part, grid, method), "format": "VRT"}
        gdal_step(self.ctx, lambda: gdal.Warp(str(target), str(source), **options).Close(), "prepare a frame's fine level")
        return gdal_step(self.ctx, lambda: DatasetSource(target), "open a frame's fine level")

    def rendered(self, part: Part, nodes: Sequence[Node], grid: Grid) -> Path:
        """The part on `grid` as a local file; its scan is released."""
        source, method = self.attached(part, grid, nodes)
        target = self.ctx.local(f"{part.version.id}-warped.tif")
        options = {
            **self._options(part, grid, method),
            "multithread": True,
            "creationOptions": list(GTIFF_OPTIONS),
            "callback": self.ctx.flags.gdal_progress,
        }
        gdal_step(self.ctx, lambda: gdal.Warp(str(target), str(source), **options).Close(), "warp a frame")
        self.release(part)
        return target
