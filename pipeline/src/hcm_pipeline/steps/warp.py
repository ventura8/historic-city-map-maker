"""`warp`: the scan to EPSG:3857 on the tile grid (docs/research/M3-interfaces.md §5.3).

`gdalwarp -tps` through the map the version was fitted to, or with the upload's own georeference: a thin-plate spline's own
enabled GCPs; an affine or poly2 fit sampled on a 17 x 17 lattice over the scan (`-order 2` rendered GDAL's own place-to-pixel
polynomial, 8.5 to 13 m RMS off the fit on real frames: docs/research/M15-calibration-accuracy.md §1); a map the pairs cannot rebuild,
its stored `georef.lattice`. GCPs in EPSG:3857 metres; the resolution of the layer's `maxzoom` (156543.03392804097 / 2^z m, the
camera's from `SENSOR_SPECS`, else the scan's own resolution rounded to a zoom), pixels aligned on the tile grid,
bilinear, an alpha band, and `-cutline` with `-crop_to_cutline` when the version has a crop ring. A frame fitted over terrain
(`georef.terrain`, M15) renders through its RPC over the heights it carries (`-rpc -to RPC_DEM`, `attached`): each place straight to the
scan at its height. The same `attached` is what a join (`join/warping.py`) and the next frame's ties (`steps/aligning.py`) read a frame
through, so all of them show the one map the layer shows. A `regeoref` of an archive single map warps its original
(`placing/original.py`, the points scaled to it), never the reduced scan the points were placed on; a `regeoref` of an archive composite
warps its parts' originals through its kept parts record (`composite_originals`, M20 §19.18), found with its own version's files or
with the versions it was drawn from (`recordFrom`, nearest first; 2026-11-24: a redraw of a redraw looked only in its own, found
nothing and warped the 8192 px stitched picture). Redraw at full resolution (`fullResolution`) never falls back: with no original and
no record it fails with `apiError.imagery.originalMissing`, as a copy of the published version helps nobody. A USGS frame renders no
further than the city's window (`outputBounds`, M9 §5): a wide crop rendered 1,249 km² and a 500 compute-unit estimate for one
city.
"""

import json
import math
from collections.abc import Callable
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Final

from hcm_pipeline import paths
from hcm_pipeline.contract import SENSOR_SPECS, Errors
from hcm_pipeline.documents import GeorefInfo, TerrainInfo, Version
from hcm_pipeline.geo import ZOOM0_RESOLUTION_M, to_mercator, zoom_resolution
from hcm_pipeline.georef.lattice import LatticeNode, sampled
from hcm_pipeline.georef.transforms import enabled_gcps, fit_transform
from hcm_pipeline.jobs import Done, JobContext, StepFailedError, StepResult
from hcm_pipeline.join.canvas import aligned_box
from hcm_pipeline.placing import fullres
from hcm_pipeline.placing.original import based_original
from hcm_pipeline.placing.raster_io import Pair, WarpPlan
from hcm_pipeline.placing.redraw_layout import layout_of, rebuilt_record
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import GTIFF_OPTIONS, warp_memory_mb
from hcm_pipeline.steps.common import city_window, gdal_step
from hcm_pipeline.surface import write_heights

DEFAULT_MINZOOM: Final = 10
MAX_UPLOAD_ZOOM: Final = 18
FLAT_GROUND: Final = 0.0
# GDAL's RPC transformer over the surface model: its heights as they are (no geoid shift), read bilinearly.
RPC_OPTIONS: Final = ("RPC_DEM_APPLY_VDATUM_SHIFT=FALSE", "RPC_DEMINTERPOLATION=bilinear")
TPS_OPTIONS: Final = ("METHOD=GCP_TPS",)
ORIGINAL_MISSING: Final = "no full-resolution original and no parts record was found for this redraw: nothing is warped"
# EPSG:3857 x, y, the scan's column and row.
Point = tuple[float, float, float, float]


def _nodes(georef: GeorefInfo, size: tuple[int, int]) -> tuple[LatticeNode, ...]:
    """The stored lattice, else a polynomial fit's sampled; none for a thin-plate spline or a degenerate set."""
    if georef.lattice is not None:
        return georef.lattice.nodes
    transform = None if georef.transform == "tps" else fit_transform(georef.transform, enabled_gcps(georef.gcps))
    return () if transform is None else sampled(transform.to_lnglat, *size)


def rendered_points(georef: GeorefInfo, size: tuple[int, int]) -> list[Point]:
    """The points a thin-plate warp renders the version's map through (module docstring); with no nodes, its enabled points."""
    nodes = [node.as_point() for node in _nodes(georef, size)]
    return nodes or [(*to_mercator(gcp.lng, gcp.lat), gcp.x, gcp.y) for gcp in enabled_gcps(georef.gcps)]


def scan_size(scan: Path) -> tuple[int, int]:
    dataset = gdal.Open(str(scan))
    size = (dataset.RasterXSize, dataset.RasterYSize)
    dataset.Close()
    return size


def gcp_source(scan: Path, georef: GeorefInfo, target: Path) -> Path:
    """A VRT of the scan carrying the points its map renders through (`rendered_points`) in EPSG:3857 metres."""
    gcps = [gdal.GCP(x, y, FLAT_GROUND, column, row) for x, y, column, row in rendered_points(georef, scan_size(scan))]
    gdal.Translate(str(target), str(scan), format="VRT", GCPs=gcps, outputSRS="EPSG:3857").Close()
    return target


def rpc_source(scan: Path, terrain: TerrainInfo, target: Path) -> Path:
    """A VRT of the scan carrying the RPC of a map over terrain (`georef/rpc.py`)."""
    dataset = gdal.Translate(str(target), str(scan), format="VRT")
    for key, value in terrain.rpc.metadata().items():
        dataset.SetMetadataItem(key, value, "RPC")
    dataset.Close()
    return target


def rpc_method(surface: Path) -> dict[str, object]:
    """`gdalwarp -rpc -to RPC_DEM=surface`."""
    return {"rpc": True, "transformerOptions": [f"RPC_DEM={surface}", *RPC_OPTIONS]}


@dataclass(frozen=True)
class Attached:
    """A scan with the map it is read through: what GDAL warps, the warp's options, and its transformer's (pixel to place and back)."""

    source: Path
    method: dict[str, object]
    options: tuple[str, ...]


def attached(scan: Path, georef: GeorefInfo, local: Callable[[str], Path]) -> Attached:
    """The scan with its map (`local` names the files it needs): over terrain, its RPC over the heights it carries; else the points its
    map renders through, a thin-plate spline."""
    terrain = georef.terrain
    if terrain is None:
        return Attached(gcp_source(scan, georef, local("scan-gcps.vrt")), warp_method(georef), TPS_OPTIONS)
    dem = write_heights(local("terrain-dem.tif"), terrain.heights)
    return Attached(rpc_source(scan, terrain, local("scan-rpc.vrt")), rpc_method(dem), ("METHOD=RPC", f"RPC_DEM={dem}", *RPC_OPTIONS))


def warp_method(georef: GeorefInfo) -> dict[str, object]:
    """Every georeferenced scan renders through a thin-plate spline (`rendered_points`); an upload's own georeference as it is."""
    return {} if georef.method == "embedded" else {"tps": True}


def native_zoom(source: Path, method: dict[str, object], probe: Path) -> int:
    """The zoom whose resolution is closest to the source's own once warped (a VRT: nothing is resampled)."""
    dataset = gdal.Warp(str(probe), str(source), format="VRT", dstSRS="EPSG:3857", **method)
    resolution = abs(dataset.GetGeoTransform()[1])
    dataset.Close()
    return max(DEFAULT_MINZOOM, min(MAX_UPLOAD_ZOOM, round(math.log2(ZOOM0_RESOLUTION_M / resolution))))


def zooms(version: Version, native: int) -> tuple[int, int]:
    """The layer's (minzoom, maxzoom): the camera's, else from the scan's resolution."""
    spec = SENSOR_SPECS.get(version.sensor or "")
    return (spec.minzoom, spec.maxzoom) if spec is not None else (DEFAULT_MINZOOM, native)


def cutline(version: Version, target: Path) -> dict[str, object]:
    """`gdalwarp -cutline -crop_to_cutline` options for the version's crop ring (a closed GeoJSON polygon in WGS84)."""
    if not version.crop:
        return {}
    ring = [[lng, lat] for lat, lng in version.crop]
    polygon = {"type": "Polygon", "coordinates": [[*ring, ring[0]]]}
    target.write_text(json.dumps({"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": polygon}]}))
    return {"cutlineDSName": str(target), "cutlineSRS": "EPSG:4326", "cropToCutline": True}


def clipped(ctx: JobContext, version: Version) -> dict[str, object]:
    """`outputBounds` of a frame the city's window holds: nothing renders or bills beyond it. A crop ring decides by itself."""
    if version.crop or version.source.get("kind") != "usgs":
        return {}
    box = aligned_box(city_window(ctx))
    return {"outputBounds": (box.left, box.bottom, box.right, box.top)}


def scaled(georef: GeorefInfo, sx: float, sy: float) -> GeorefInfo:
    """The map with its pixels `sx` by `sy` times larger: its points' and its lattice's."""
    gcps = tuple(replace(gcp, x=gcp.x * sx, y=gcp.y * sy) for gcp in georef.gcps)
    lattice = georef.lattice
    if lattice is not None:
        lattice = replace(lattice, nodes=tuple(replace(node, x=node.x * sx, y=node.y * sy) for node in lattice.nodes))
    return replace(georef, gcps=gcps, lattice=lattice)


def _original(ctx: JobContext) -> Path | None:
    """`based_original`, or None when copying it fails: the job then warps the scan as before, never fails on the original."""
    try:
        return based_original(ctx)
    except (StepFailedError, RuntimeError) as error:
        ctx.log.warn(f"the original could not be read ({error}): the scan is warped", ctx.step)
        return None


def full_resolution(ctx: JobContext, scan: Path, georef: GeorefInfo) -> tuple[Path, GeorefInfo]:
    """A `regeoref` of an archive single map warps its original with the points scaled to it (`placing/original.py`), else the scan."""
    original = _original(ctx) if georef.method == "gcps" else None
    if original is None:
        return scan, georef
    (width, height), (scan_w, scan_h) = scan_size(original), scan_size(scan)
    ctx.log.info(f"the points are warped on the original, {width} x {height} px", ctx.step)
    return original, scaled(georef, width / scan_w, height / scan_h)


def _published_zoom(ctx: JobContext) -> int | None:
    """The `maxzoom` the version was published at (its originals' own), else None."""
    output = (ctx.services.store.get(ctx.version_path()) or {}).get("output")
    found = output.get("maxzoom") if isinstance(output, dict) else None
    # 2026-11-24: a new redraw has no output yet: the zoom its series was published at, which its layout carries.
    return _zoom(found) if found is not None else _zoom((layout_of(ctx) or {}).get("maxzoom"))


def _zoom(found: object) -> int | None:
    return found if isinstance(found, int) and not isinstance(found, bool) else None


def _plain_archive(version: Version, georef: GeorefInfo) -> bool:
    """An archive version placed by points, with no crop ring and no terrain."""
    return georef.method == "gcps" and georef.terrain is None and not version.crop and version.source.get("kind") == "archive"


def record_paths(ctx: JobContext) -> list[str]:
    """Where a composite's parts record may be: the version's own files, then each version it was drawn from (`recordFrom`)."""
    chain = ctx.job.params.get("recordFrom")
    drawn_from = [item for item in chain if isinstance(item, str)] if isinstance(chain, list) else []
    own = ctx.version_file(fullres.VERSION_RECORD)
    return [own, *(paths.version(ctx.city, ctx.version.layer_id, item, fullres.VERSION_RECORD) for item in drawn_from)]


def _staged_record(ctx: JobContext, scan: Path) -> bool:
    """The first parts record found staged beside the scan, and kept with this version too so the next redraw finds it; else False."""
    found = next((path for path in record_paths(ctx) if ctx.services.objects.stat(path) is not None), None)
    if found is None:
        return _rebuilt(ctx, scan)
    local = ctx.stage(found, fullres.sidecar(scan).name)
    if found != ctx.version_file(fullres.VERSION_RECORD):
        ctx.log.info(f"the parts record is read from {found}", ctx.step)
        ctx.publish(local, ctx.version_file(fullres.VERSION_RECORD), "application/json")
    return True


def _rebuilt(ctx: JobContext, scan: Path) -> bool:
    """No record anywhere: rebuilt from the series' layout a redraw carries (`placing/redraw_layout.py`), kept with this version."""
    if not rebuilt_record(ctx, scan, scan_size(scan)):
        return False
    ctx.publish(fullres.sidecar(scan), ctx.version_file(fullres.VERSION_RECORD), "application/json")
    return True


def _composite_record(ctx: JobContext, scan: Path, georef: GeorefInfo) -> int | None:
    """A regeoref of an archive composite with its parts record (`parts.json`, kept by its placing) staged beside the scan: the zoom
    it was published at; else None. A crop ring or a map over terrain keeps the usual warp."""
    if not _plain_archive(ctx.version, georef) or not _staged_record(ctx, scan):
        return None
    return _published_zoom(ctx)


def composite_originals(ctx: JobContext, scan: Path, georef: GeorefInfo) -> Path | None:
    """A regeoref of an archive composite warped from its parts' originals through the points (M20 §19.18), else None."""
    maxzoom = _composite_record(ctx, scan, georef)
    if maxzoom is None:
        return None
    pairs = [Pair(column, row, x, y) for x, y, column, row in rendered_points(georef, scan_size(scan))]
    plan = WarpPlan(pairs, zoom_resolution(maxzoom), tps=True)
    target = ctx.local("warped.tif")
    return gdal_step(ctx, lambda: fullres.warp_composite(scan, target, plan, lambda line: ctx.log.info(line, ctx.step)), "warp the parts")


def require_original(ctx: JobContext, from_original: bool) -> None:
    """Redraw at full resolution (`fullResolution`) with neither the original nor the parts' originals fails, plainly (2026-11-24)."""
    if ctx.job.params.get("fullResolution") is True and not from_original:
        ctx.log.warn(f"{ORIGINAL_MISSING} (version {ctx.version.id})", ctx.step)
        raise StepFailedError(Errors.ORIGINAL_MISSING, ORIGINAL_MISSING)


class WarpStep:
    name = "warp"

    def run(self, ctx: JobContext) -> StepResult:
        version = ctx.version
        if version.scan is None or version.georef is None:
            raise StepFailedError(Errors.NO_SCAN, "the version has no georeferenced scan")
        staged = ctx.stage(version.scan.path, "scan.tif")
        scan, georef = full_resolution(ctx, staged, version.georef)
        composite = composite_originals(ctx, scan, georef)
        if composite is not None:
            return Done(ctx.publish(composite, ctx.work_file("warped.tif"), "image/tiff"))
        require_original(ctx, scan != staged)
        source, method = self._source(ctx, scan, georef)
        native = gdal_step(ctx, lambda: native_zoom(source, method, ctx.local("probe.vrt")), "measure the scan")
        _, maxzoom = zooms(version, native)
        warped = ctx.local("warped.tif")
        resolution = zoom_resolution(maxzoom)
        options = {
            "dstSRS": "EPSG:3857",
            "xRes": resolution,
            "yRes": resolution,
            "targetAlignedPixels": True,
            "resampleAlg": "bilinear",
            "dstAlpha": True,
            "multithread": True,
            "warpMemoryLimit": warp_memory_mb(),
            "creationOptions": list(GTIFF_OPTIONS),
            "callback": ctx.flags.gdal_progress,
            **method,
            **cutline(version, ctx.local("cutline.geojson")),
            **clipped(ctx, version),
        }
        gdal_step(ctx, lambda: gdal.Warp(str(warped), str(source), **options).Close(), "warp the scan")
        return Done(ctx.publish(warped, ctx.work_file("warped.tif"), "image/tiff"))

    def _source(self, ctx: JobContext, scan: Path, georef: GeorefInfo) -> tuple[Path, dict[str, object]]:
        """What GDAL warps, and how: the upload as it is, else the scan with its map (`attached`)."""
        if georef.method == "embedded":
            return scan, warp_method(georef)
        found = gdal_step(ctx, lambda: attached(scan, georef, ctx.local), "attach the map")
        return found.source, found.method
