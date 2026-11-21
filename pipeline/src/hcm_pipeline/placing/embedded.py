"""Class a: a file that already carries its georeference (docs/research/M20-import-local.md §3 a).

1. Its coordinate system: the file's own (GeoTIFF keys, GCPs with theirs), or a `.prj` beside its world file. A world file with no
   `.prj` is tried in each candidate system (Stereo 70, EPSG:3844; the city's UTM zone; EPSG:3857; EPSG:4326) and kept when exactly
   one puts the file's centre in the city's window; none or several wait for a person, who names it (`low-confidence`).
2. Stereo 70 goes through PROJ's own transformation (1 to 3 m); the official TransDatRO grid is used only if PROJ-data ships it
   (UNVERIFIED).
3. Warped to EPSG:3857 at the series' resolution (nearest for line art, bilinear otherwise), an alpha band last. No matching.
4. A ruler, not a fit: its junctions are measured against OpenStreetMap's. A median offset within `RULER_LIMIT_M` behaves as a fit; a
   larger one waits for a person ("disagrees with OpenStreetMap by N m"), and never publishes on its own. Without OpenStreetMap, the
   report carries no figure (and the approval waits for a look).
"""

import math
from pathlib import Path
from typing import Final

import numpy

from hcm_pipeline.geo import Grid, MercatorBox
from hcm_pipeline.jobs import JobContext, StepResult
from hcm_pipeline.placing.checks import Checked, checked
from hcm_pipeline.placing.fine import CHECK_RATIO, nearest
from hcm_pipeline.placing.output import Placement, finish, resolution_of, wait_for_help
from hcm_pipeline.placing.raster_io import normalised
from hcm_pipeline.placing.reference import city_window, osm_reference
from hcm_pipeline.placing.series import SeriesJob, series_of
from hcm_pipeline.placing.streets import street_network
from hcm_pipeline.raster import gdal, osr
from hcm_pipeline.rasters import GTIFF_OPTIONS, WEB_MERCATOR, WGS84, open_raster, srs_wkt

STEREO_70: Final = 3844
UTM_NORTH: Final = 32600
RULER_LIMIT_M: Final = 15.0
RULER_PX: Final = 2000
NEIGHBOURS: Final = 2
NO_SYSTEM: Final = "This file's world file has no .prj and its coordinate system could not be told: name it in the report."
NO_WINDOW: Final = "The city has no bounds to check this file against: set them in Settings, then retry."


def candidates(longitude: float) -> tuple[int, ...]:
    """The systems a world file with no `.prj` may be in: Stereo 70, the UTM zone of `longitude`, Web Mercator, WGS84."""
    return STEREO_70, UTM_NORTH + int((longitude + 180) // 6) + 1, WEB_MERCATOR, WGS84


GeoTransform = tuple[float, float, float, float, float, float]
WORLD_SUFFIXES: Final = (".tfw", ".tifw", ".jgw", ".jpgw", ".pgw", ".pngw", ".wld")
WORLD_LINES: Final = 6


def _world_numbers(text: str) -> list[float] | None:
    try:
        numbers = [float(line) for line in text.split()]
    except ValueError:
        return None
    return numbers if len(numbers) == WORLD_LINES else None


def _world_text(path: Path) -> str:
    """The first world file beside `path`, read; empty when there is none."""
    found = [candidate for candidate in (path.with_suffix(suffix) for suffix in WORLD_SUFFIXES) if candidate.is_file()]
    return found[0].read_text(encoding="utf-8", errors="replace") if found else ""


def world_file(path: Path) -> GeoTransform | None:
    """The geotransform a world file beside `path` states (its six lines name the centre of the top-left pixel), or None. GDAL is
    never asked to find it: the pipeline opens files without listing their folder (`GDAL_DISABLE_READDIR_ON_OPEN`)."""
    numbers = _world_numbers(_world_text(path))
    if numbers is None:
        return None
    a, d, b, e, c, f = numbers
    return c - a / 2 - b / 2, a, b, f - d / 2 - e / 2, d, e


def transform_of(path: Path) -> GeoTransform | None:
    """The file's own geotransform, else its world file's."""
    return _own(path) or world_file(path)


def _size(path: Path) -> tuple[int, int]:
    dataset = open_raster(path)
    size = dataset.RasterXSize, dataset.RasterYSize
    dataset.Close()
    return size


def _at(transform: GeoTransform, x: float, y: float) -> tuple[float, float]:
    return transform[0] + transform[1] * x + transform[2] * y, transform[3] + transform[4] * x + transform[5] * y


def _centre(path: Path) -> tuple[float, float] | None:
    transform = transform_of(path)
    width, height = _size(path)
    return None if transform is None else _at(transform, width / 2, height / 2)


def _lands(epsg: int, centre: tuple[float, float], window: MercatorBox) -> bool:
    source, target = osr.SpatialReference(), osr.SpatialReference()
    source.ImportFromEPSG(epsg)
    target.ImportFromEPSG(WEB_MERCATOR)
    for srs in (source, target):
        srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    try:
        x, y, _ = osr.CoordinateTransformation(source, target).TransformPoint(*centre)
    except RuntimeError:
        return False
    return window.left <= x <= window.right and window.bottom <= y <= window.top


def _stated(path: Path) -> str:
    """The system the file states: its own (or its GCPs'), else its `.prj`'s; empty when it states none."""
    dataset = open_raster(path)
    own = dataset.GetProjection() or dataset.GetGCPProjection()
    dataset.Close()
    prj = path.with_suffix(".prj")
    return own or (prj.read_text(encoding="utf-8", errors="replace") if prj.is_file() else "")


def _landing(path: Path, window: MercatorBox) -> list[int]:
    centre = _centre(path)
    return [] if centre is None else [epsg for epsg in candidates(window.middle_lng) if _lands(epsg, centre, window)]


def system_of(path: Path, window: MercatorBox) -> str | None:
    """The file's coordinate system as WKT: its own, its `.prj`'s, or the one candidate that lands in the city; else None."""
    stated = _stated(path)
    if stated:
        return stated
    landing = _landing(path, window)
    return srs_wkt(landing[0]) if len(landing) == 1 else None


def _corner_gcps(path: Path) -> list[gdal.GCP]:
    """A world file's placement as four corner pairs (exact for its affine), for a file whose own tags have none."""
    transform = world_file(path)
    width, height = _size(path)
    corners = [(0.0, 0.0), (float(width), 0.0), (float(width), float(height)), (0.0, float(height))]
    return [] if transform is None else [gdal.GCP(*_at(transform, x, y), 0.0, x, y) for x, y in corners]


def warp_embedded(path: Path, system: str, target: Path, resolution: float, nearest_pixels: bool) -> Path:
    """The file warped from its own system to EPSG:3857 (by its world file's corners when its tags have no placement)."""
    vrt = normalised(path)
    placed = vrt.replace(".vrt", "-placed.vrt")
    try:
        gcps = [] if _own(path) is not None else _corner_gcps(path)
        gdal.Translate(placed, vrt, format="VRT", **({"GCPs": gcps, "outputSRS": system} if gcps else {})).Close()
        options = {"xRes": resolution, "yRes": resolution, "dstAlpha": True, "creationOptions": list(GTIFF_OPTIONS)}
        resample = "near" if nearest_pixels else "bilinear"
        gdal.Warp(str(target), placed, srcSRS=system, dstSRS=srs_wkt(WEB_MERCATOR), resampleAlg=resample, **options).Close()
    finally:
        gdal.Unlink(placed)
        gdal.Unlink(vrt)
    return target


def _own(path: Path) -> GeoTransform | None:
    dataset = open_raster(path)
    own = dataset.GetGeoTransform(can_return_null=True)
    dataset.Close()
    return own


def _warped_grid(warped: Path) -> tuple[Grid, numpy.ndarray]:
    """The warped file reduced to `RULER_PX` on its long side, as a grid and its grey pixels."""
    dataset = open_raster(warped)
    left, size, _, top, _, _ = dataset.GetGeoTransform()
    width, height = dataset.RasterXSize, dataset.RasterYSize
    scale = min(1.0, RULER_PX / max(width, height))
    out_w, out_h = max(1, round(width * scale)), max(1, round(height * scale))
    grey = dataset.GetRasterBand(1).ReadAsArray(0, 0, width, height, out_w, out_h, resample_alg=gdal.GRIORA_Average)
    dataset.Close()
    return Grid(left, top, size / scale, out_w, out_h), numpy.asarray(grey, numpy.uint8)


def ruler(ctx: JobContext, warped: Path) -> Checked:
    """The warped file's junctions measured against OpenStreetMap's: each clearly nearest one is a check."""
    grid, grey = _warped_grid(warped)
    reference = osm_reference(ctx, grid.box(), grid.resolution)
    found = street_network(grey).junctions()
    if reference is None or len(found) == 0 or len(reference.places) < NEIGHBOURS:
        return Checked(None, 0, 0, 0.0, None)
    mx, my = grid.to_mercator(found[:, 0], found[:, 1])
    _, gap = nearest(numpy.column_stack((mx, my)), reference.places, NEIGHBOURS)
    clear = gap[:, 0] < CHECK_RATIO * gap[:, 1]
    ground = math.cos(math.radians(grid.box().bounds().middle_lat))
    extent = (0.0, 0.0, float(grid.width), float(grid.height))
    return checked(gap[clear, 0] * ground, found[clear], ["file"] * int(clear.sum()), extent, float("inf"))


def _measured(ctx: JobContext, series: SeriesJob, warped: Path) -> StepResult:
    """The warped file measured by the ruler: within the limit it is placed, beyond it waits for a person."""
    result = ruler(ctx, warped)
    offset = 0.0 if result.residuals is None else result.residuals.median_m
    if offset > RULER_LIMIT_M:
        return wait_for_help(ctx, "low-confidence", f"The file's georeference disagrees with OpenStreetMap by {offset:.0f} m: check it.")
    placement = Placement("embedded", series.encoding, result, True, series.scale, series.paper_transparent)
    return finish(ctx, placement, warped, 1)


class EmbeddedPlacer:
    """Class a: the file's own georeference, warped and measured against OpenStreetMap."""

    def place(self, ctx: JobContext) -> StepResult:
        series = series_of(ctx)
        window = city_window(ctx)
        system = None if window is None else system_of(series.sheets[0].path, window)
        if system is None:
            return wait_for_help(ctx, "low-confidence", NO_WINDOW if window is None else NO_SYSTEM)
        warped = warp_embedded(series.sheets[0].path, system, ctx.local("warped.tif"), resolution_of(ctx.job.params), series.nearest)
        return _measured(ctx, series, warped)
