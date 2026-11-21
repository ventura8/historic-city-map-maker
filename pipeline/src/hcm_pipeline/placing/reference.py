"""What a drawn map is matched against (docs/research/M20-import-local.md §1.7, §3 c step 3): the reference ladder, then OpenStreetMap.

OpenStreetMap is asked once for the city's whole window (cached beside this computer's jobs) and drawn on any box inside it.
A reference is street centre lines on a north-up EPSG:3857 grid: their skeleton, its junctions in Mercator metres, and a closeness image
(1 on a line, falling off over a few pixels) the coarse search scores against. The ladder's rung is a calibrated layer of the city (the
job's `referenceLayerIds`, an older or newer map already placed): its own street network, read from its COG through the same classical
path as the map's, and its own checkpoint error, which is added in quadrature to the figure of every map placed on it. OpenStreetMap's
highways (Overpass, cached beside the job) are the last rung. Mapbox Satellite is never a reference (its terms).
"""

import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

import cv2
import numpy
from numpy.typing import NDArray

from hcm_pipeline import paths
from hcm_pipeline.documents import city_bounds
from hcm_pipeline.geo import Grid, MercatorBox
from hcm_pipeline.jobs import JobContext
from hcm_pipeline.osm import draw
from hcm_pipeline.placing.geometry import FloatArray
from hcm_pipeline.placing.streets import BoolArray, UInt8Array, junctions, line_skeleton, street_skeleton
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import WEB_MERCATOR, srs_wkt
from hcm_pipeline.stac import ReferenceUnavailableError

# The closeness image falls to 1/e this many pixels from a line.
CLOSENESS_PX: Final = 2.0
# Further than this many reaches from any line the closeness is nothing (and an empty reference's distances never overflow).
FAR_REACHES: Final = 10.0
# How much wider than the city a map may reach (a regional map shows the city's surroundings).
CITY_MARGIN: Final = 0.5


@dataclass(frozen=True)
class Reference:
    """Street centre lines on `grid`, their junctions (Mercator metres) and the closeness image; `error_m` is the rung's own error."""

    grid: Grid
    skeleton: BoolArray
    places: FloatArray
    closeness: NDArray[numpy.float32]
    label: str
    error_m: float | None = None


def closeness_of(skeleton: BoolArray, reach_px: float = CLOSENESS_PX) -> NDArray[numpy.float32]:
    """1 on a line, falling to 1/e `reach_px` pixels from it."""
    distance = numpy.minimum(cv2.distanceTransform((~skeleton).astype(numpy.uint8), cv2.DIST_L2, 3), FAR_REACHES * reach_px)
    return numpy.asarray(numpy.exp(-((distance / reach_px) ** 2)), numpy.float32)


def reference_of(skeleton: BoolArray, grid: Grid, label: str, error_m: float | None = None) -> Reference:
    """A reference from a skeleton on `grid`: its junctions moved to Mercator metres."""
    found = junctions(skeleton)
    mx, my = grid.to_mercator(found[:, 0], found[:, 1])
    return Reference(grid, skeleton, numpy.column_stack((mx, my)), closeness_of(skeleton), label, error_m)


def city_window(ctx: JobContext, margin: float = CITY_MARGIN) -> MercatorBox | None:
    """The city's bounds grown by `margin` on every side, or None when the city has none."""
    city = ctx.read(f"cities/{ctx.city}")
    if city is None or city.get("bounds") is None:
        return None
    return city_bounds(city).mercator().expanded(margin)


def _overlaps(box: MercatorBox, outer: MercatorBox) -> bool:
    return box.left < outer.right and outer.left < box.right and box.bottom < outer.top and outer.bottom < box.top


def _asked(ctx: JobContext, box: MercatorBox) -> MercatorBox:
    """What Overpass is asked for: the city's whole window when `box` touches it (one answer serves every map of the city: a map that
    reaches past the window is matched on its part inside), else `box`."""
    window = city_window(ctx)
    return window if window is not None and _overlaps(box, window) else box


def osm_features_cached(ctx: JobContext, box: MercatorBox) -> dict[str, object] | None:
    """OpenStreetMap's lines around `box`, cached beside the jobs of this computer (one Overpass answer per city window)."""
    asked = _asked(ctx, box)
    folder = ctx.services.archive_root or ctx.workdir.parent
    cache = folder / "osm" / f"{asked.key().replace(',', '_')}.json"
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.is_file():
        loaded = json.loads(cache.read_text(encoding="utf-8"))
        return loaded if isinstance(loaded, dict) else None
    try:
        features = ctx.services.overpass.features(asked.bounds())
    except ReferenceUnavailableError as error:
        ctx.log.warn(f"OpenStreetMap is unavailable: {error}", ctx.step)
        return None
    cache.write_text(json.dumps(features), encoding="utf-8")
    return features


def osm_reference(ctx: JobContext, box: MercatorBox, resolution: float) -> Reference | None:
    """OpenStreetMap's lines over `box` at `resolution` Mercator metres a pixel, or None when Overpass cannot answer."""
    features = osm_features_cached(ctx, box)
    if features is None:
        return None
    grid = Grid.over(box, resolution)
    return reference_of(line_skeleton(draw(features, grid)), grid, "osm")


def _number(record: Mapping[str, object] | None, *keys: str) -> float | None:
    value: object = record
    for key in keys:
        value = value.get(key) if isinstance(value, dict) else None
    return float(value) if isinstance(value, int | float) else None


def _layer_error(version: Mapping[str, object] | None) -> float | None:
    return _number(version, "archive", "checkpointRmseM") or _number(version, "georef", "checkpointRmseM")


def _read_on_grid(source: str, grid: Grid) -> UInt8Array:
    left, bottom, right, top = (grid.left, grid.top - grid.height * grid.resolution, grid.left + grid.width * grid.resolution, grid.top)
    options = {"dstSRS": srs_wkt(WEB_MERCATOR), "outputBounds": (left, bottom, right, top), "width": grid.width, "height": grid.height}
    warped = gdal.Warp("", source, format="MEM", resampleAlg="average", **options)
    image = numpy.asarray(warped.GetRasterBand(1).ReadAsArray(), numpy.uint8)
    warped.Close()
    return image


def ladder_reference(ctx: JobContext, layer_id: str, box: MercatorBox, resolution: float) -> Reference | None:
    """A calibrated layer's own street network over `box`, with its own error; None when it has no rendered version."""
    layer = ctx.read(f"cities/{ctx.city}/layers/{layer_id}")
    version_id = layer.get("currentVersion") if layer else None
    if not isinstance(version_id, str):
        return None
    version = ctx.read(ctx.version_path(version_id))
    local = ctx.stage(paths.version(ctx.city, layer_id, version_id, "cog.tif"), f"ladder-{layer_id}.tif")
    grid = Grid.over(box, resolution)
    image = _read_on_grid(str(local), grid)
    return reference_of(street_skeleton(image), grid, f"layer:{layer_id}", _layer_error(version))


def references(ctx: JobContext, layer_ids: Sequence[str], box: MercatorBox, resolution: float) -> list[Reference]:
    """The ladder's rungs in order, then OpenStreetMap: each that could be read."""
    rungs = [ladder_reference(ctx, layer_id, box, resolution) for layer_id in layer_ids]
    found = [*rungs, osm_reference(ctx, box, resolution)]
    return [reference for reference in found if reference is not None]


def window_resolution(box: MercatorBox, max_px: int) -> float:
    """The coarsest resolution that keeps `box` within `max_px` on its long side, rounded up to a whole metre."""
    return float(math.ceil(max(box.width, box.height) / max_px))
