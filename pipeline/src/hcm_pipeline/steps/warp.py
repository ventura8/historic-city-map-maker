"""`warp`: the scan to EPSG:3857 on the tile grid (docs/research/M3-interfaces.md §5.3).

`gdalwarp -tps` through the map the version was fitted to, or with the upload's own georeference: a thin-plate spline's own
enabled GCPs; an affine or poly2 fit sampled on a 17 x 17 lattice over the scan (`-order 2` rendered GDAL's own place-to-pixel
polynomial, 8.5 to 13 m RMS off the fit on real frames: docs/research/M15-calibration-accuracy.md §1); a map the pairs cannot rebuild,
its stored `georef.lattice`. GCPs in EPSG:3857 metres; the resolution of the layer's `maxzoom` (156543.03392804097 / 2^z m, the
camera's from `SENSOR_SPECS`, else the scan's own resolution rounded to a zoom), pixels aligned on the tile grid,
bilinear, an alpha band, and `-cutline` with `-crop_to_cutline` when the version has a crop ring. A frame fitted over terrain
(`georef.terrain`, M15) renders through its RPC over the heights it carries (`-rpc -to RPC_DEM`, `attached`): each place straight to the
scan at its height. The same `attached` is what a join (`join/warping.py`) and the next frame's ties (`steps/aligning.py`) read a frame
through, so all of them show the one map the layer shows. A USGS frame renders no further than the city's window (`outputBounds`, M9 §5):
a wide crop rendered 1,249 km² and a 500 compute-unit estimate for one city.
"""

import json
import math
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from hcm_pipeline.contract import SENSOR_SPECS, Errors
from hcm_pipeline.documents import GeorefInfo, TerrainInfo, Version
from hcm_pipeline.geo import ZOOM0_RESOLUTION_M, to_mercator, zoom_resolution
from hcm_pipeline.georef.lattice import LatticeNode, sampled
from hcm_pipeline.georef.transforms import enabled_gcps, fit_transform
from hcm_pipeline.jobs import Done, JobContext, StepFailedError, StepResult
from hcm_pipeline.join.canvas import aligned_box
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


class WarpStep:
    name = "warp"

    def run(self, ctx: JobContext) -> StepResult:
        version = ctx.version
        if version.scan is None or version.georef is None:
            raise StepFailedError(Errors.NO_SCAN, "the version has no georeferenced scan")
        scan = ctx.stage(version.scan.path, "scan.tif")
        source, method = self._source(ctx, scan, version.georef)
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
