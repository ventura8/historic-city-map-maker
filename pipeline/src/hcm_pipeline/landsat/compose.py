"""`warp` for a Landsat scene: the colour image on the tile grid, checked against Sentinel-2 (docs/research/M25-landsat.md §3).

The bands `extract` kept are reprojected by GDAL straight onto the city window's tile grid at the camera's zoom (`SENSOR_SPECS`: z13 for
Landsat 4 and 5 TM's 30 m,
z14 for Landsat 7 ETM+'s and Landsat 8 and 9 OLI's 15 m): the colour bands cubic, the quality band nearest. `colour.py` masks, sharpens
and stretches them into the RGBA `warped.tif` the shared tail (`export`, `pyramid`, `register`) reads, as a declassified frame's `warp`
writes it. No georeferencing: the product is on the ground already. One check instead: the image's rigid shift from the window's
Sentinel-2 (`offset.py`, the reference `reference` cached), in the camera's own pixels, and the share of the city its quality band calls
cloud. Both go into the version's `landsat` report; the approval policy publishes it on its own within a pixel over a clear city, and
holds it for Approve otherwise (and when the shift could not be measured: the log says why). Once the image is in the bucket, the
USGS delivery is deleted, as `locate` deletes a declassified one once its city crop exists (M7 §5).

A systematic scene (L1GS or L1GT) more than a pixel off is moved onto Sentinel-2 and measured again (`correct.py`, lesson 727); a
pixel saturated in a colour band counts as cloud (`colour.py`, lesson 726).
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import numpy
from numpy.typing import NDArray

from hcm_pipeline.contract import SENSOR_SPECS, Errors, SensorSpec
from hcm_pipeline.documents import city_bounds
from hcm_pipeline.geo import FloatArray, Grid, MercatorBox, ground_scale
from hcm_pipeline.jobs import Done, JobContext, StepFailedError, StepResult
from hcm_pipeline.join.canvas import aligned_box, level_grid
from hcm_pipeline.landsat.bands import PANCHROMATIC, QUALITY, band_file, delivery_level, needed_bands, true_colour
from hcm_pipeline.landsat.colour import FILL_BIT, Bands, BoolArray, Composite, cloud_pct, compose
from hcm_pipeline.landsat.correct import PRECISE, Correction, moved_grid, verdict
from hcm_pipeline.landsat.offset import Shift, shift_of
from hcm_pipeline.model import UsgsImportParams
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import GeoTiff, write_geotiff
from hcm_pipeline.steps.common import city_window, gdal_step, sentinel2
from hcm_pipeline.steps.locate import delete_delivery

WARPED: Final = "warped.tif"
COLOUR_RESAMPLING: Final = "cubic"
QUALITY_RESAMPLING: Final = "near"
REFERENCE_RESAMPLING: Final = "average"
MAX_OFFSET_PX: Final = 1.0


def staged_bands(ctx: JobContext, sensor: str) -> dict[str, Path]:
    """Each band `extract` kept, staged; a band missing from the bucket fails the step as one missing from the bundle."""
    staged: dict[str, Path] = {}
    for band in needed_bands(sensor):
        object_path = ctx.work_file(band_file(band))
        if ctx.services.objects.stat(object_path) is None:
            raise StepFailedError(Errors.MISSING_BAND, f"the Landsat band {band} was not extracted", {"band": band})
        staged[band] = ctx.stage(object_path, f"band-{band}.tif")
    return staged


def on_grid(source: Path, grid: Grid, resampling: str, fill: int = 0) -> NDArray[numpy.generic]:
    """The first band of `source` reprojected onto `grid` (EPSG:3857); `fill` where the source has nothing."""
    box = grid.box()
    dataset = gdal.Warp(
        "",
        str(source),
        format="MEM",
        dstSRS="EPSG:3857",
        outputBounds=(box.left, box.bottom, box.right, box.top),
        width=grid.width,
        height=grid.height,
        resampleAlg=resampling,
        dstNodata=fill,
        multithread=True,
    )
    array = numpy.asarray(dataset.GetRasterBand(1).ReadAsArray())
    dataset.Close()
    return array


def _colour(source: Path, grid: Grid) -> FloatArray:
    return numpy.asarray(on_grid(source, grid, COLOUR_RESAMPLING), numpy.float64)


def saturated(*bands: NDArray[numpy.generic]) -> BoolArray | None:
    """Where any integer band holds its type's largest value (the sensor saturated: lesson 726); None for float bands."""
    if not all(numpy.issubdtype(band.dtype, numpy.integer) for band in bands):
        return None
    hits = [band == numpy.iinfo(band.dtype.name).max for band in bands]
    return numpy.asarray(numpy.logical_or.reduce(hits), numpy.bool_)


def bands_on(staged: Mapping[str, Path], grid: Grid, sensor: str = "L5-TM") -> Bands:
    """The scene's bands on the grid: red, green and blue (`true_colour`), the quality band, ETM+'s or OLI's panchromatic band, and
    where a colour band saturated."""
    pan = staged.get(PANCHROMATIC)
    red, green, blue = (on_grid(staged[band], grid, COLOUR_RESAMPLING) for band in true_colour(sensor))
    return Bands(
        red=numpy.asarray(red, numpy.float64),
        green=numpy.asarray(green, numpy.float64),
        blue=numpy.asarray(blue, numpy.float64),
        quality=numpy.asarray(on_grid(staged[QUALITY], grid, QUALITY_RESAMPLING, FILL_BIT), numpy.uint16),
        pan=None if pan is None else _colour(pan, grid),
        saturated=saturated(red, green, blue),
    )


def reference_grey(ctx: JobContext, window: MercatorBox, grid: Grid) -> FloatArray | None:
    """The window's Sentinel-2 (cached by `reference`) as one grey band on the grid; None when it cannot be had (the log says so)."""
    try:
        source = sentinel2(ctx, window)
    except StepFailedError as error:
        ctx.log.warn(f"no Sentinel-2 to check the Landsat scene against: {error}", LandsatComposeStep.name)
        return None
    dataset = gdal.Warp(
        "",
        str(source.local),
        format="MEM",
        dstSRS="EPSG:3857",
        outputBounds=_extent(grid),
        width=grid.width,
        height=grid.height,
        resampleAlg=REFERENCE_RESAMPLING,
    )
    total = sum(numpy.asarray(dataset.GetRasterBand(band).ReadAsArray(), numpy.float64) for band in (1, 2, 3))
    dataset.Close()
    return numpy.asarray(numpy.asarray(total) / 3.0, numpy.float64)


def _extent(grid: Grid) -> tuple[float, float, float, float]:
    box = grid.box()
    return box.left, box.bottom, box.right, box.top


def city_slices(ctx: JobContext, grid: Grid) -> tuple[slice, slice]:
    """The grid's rows and columns over the city's own bounds (the window less its margin)."""
    box = city_bounds(ctx.read(f"cities/{ctx.city}") or {}).mercator()
    (left, right), (top, bottom) = grid.to_pixel(numpy.array([box.left, box.right]), numpy.array([box.top, box.bottom]))
    rows = slice(max(0, int(top)), min(grid.height, int(numpy.ceil(bottom))))
    columns = slice(max(0, int(left)), min(grid.width, int(numpy.ceil(right))))
    return rows, columns


@dataclass(frozen=True)
class Offset:
    """A shift on the ground: metres east and north, their length, and that length in the camera's own pixels."""

    east_m: float
    north_m: float
    metres: float
    pixels: float


def offset_of(shift: Shift, grid: Grid, spec: SensorSpec, lat: float) -> Offset:
    """`shift` (grid pixels right and down) in ground metres east and north and in the camera's own pixels."""
    metres_per_pixel = grid.resolution * ground_scale(lat)
    east, north = shift.dx * metres_per_pixel, -shift.dy * metres_per_pixel
    metres = float(numpy.hypot(east, north))
    return Offset(east, north, metres, metres / spec.resolution_m)


def shift_record(shift: Shift | None, grid: Grid, spec: SensorSpec, lat: float) -> dict[str, object]:
    """The report's shift: ground metres east and north, their length, and that length in the camera's own pixels."""
    if shift is None:
        return {"checked": False}
    offset = offset_of(shift, grid, spec, lat)
    return {
        "checked": True,
        "offsetPx": round(offset.pixels, 2),
        "offsetM": round(offset.metres, 1),
        "eastM": round(offset.east_m, 1),
        "northM": round(offset.north_m, 1),
    }


def measured_shift(composite: Composite, reference: FloatArray | None) -> Shift | None:
    """The scene's shift from the reference over the clear pixels both hold; None without a reference."""
    if reference is None:
        return None
    common = numpy.asarray(composite.valid & ~composite.cloudy & (reference > 0), numpy.bool_)
    return shift_of(composite.grey, reference, common)


@dataclass(frozen=True)
class Placement:
    """The composite `warp` keeps, its shift record, and what was done about a systematic scene's shift (None: nothing to do)."""

    composite: Composite
    record: Mapping[str, object]
    correction: Correction | None = None

    def report(self) -> dict[str, object]:
        return {**self.record} if self.correction is None else {**self.record, "correction": self.correction.record()}


@dataclass(frozen=True)
class Check:
    """What measuring a scene against Sentinel-2 needs: the scene's composite on any grid, the reference on `grid`, the camera, the
    window's latitude and the product's level (`correct.level_of`)."""

    composite_on: Callable[[Grid], Composite]
    reference: FloatArray | None
    grid: Grid
    spec: SensorSpec
    lat: float
    level: str = PRECISE

    def measure(self, composite: Composite) -> tuple[Shift | None, dict[str, object]]:
        shift = measured_shift(composite, self.reference)
        return shift, shift_record(shift, self.grid, self.spec, self.lat)

    def place(self) -> Placement:
        """The scene as it lies; a systematic one more than a pixel off moved onto Sentinel-2 when a second measure confirms it."""
        composite = self.composite_on(self.grid)
        shift, record = self.measure(composite)
        if shift is None:
            return Placement(composite, record)
        offset = offset_of(shift, self.grid, self.spec, self.lat)
        kind = verdict(self.level, offset.pixels, offset.metres, MAX_OFFSET_PX)
        if kind == "keep":
            return Placement(composite, record)
        if kind == "implausible":
            return Placement(composite, record, Correction("refused", offset.east_m, offset.north_m, "implausible"))
        return self.moved(Placement(composite, record), shift, offset)

    def moved(self, first: Placement, shift: Shift, offset: Offset) -> Placement:
        """The scene moved back by `shift` and measured again: kept within a pixel, else the scene as it lies, refused."""
        composite = self.composite_on(moved_grid(self.grid, shift))
        again, record = self.measure(composite)
        if again is None or offset_of(again, self.grid, self.spec, self.lat).pixels > MAX_OFFSET_PX:
            return Placement(first.composite, first.record, Correction("refused", offset.east_m, offset.north_m, "unconfirmed"))
        return Placement(composite, record, Correction("applied", offset.east_m, offset.north_m))


class LandsatComposeStep:
    name = "warp"

    def run(self, ctx: JobContext) -> StepResult:
        params = UsgsImportParams.of(ctx.job.params)
        spec = SENSOR_SPECS[params.sensor]
        window = city_window(ctx)
        grid = level_grid(aligned_box(window), spec.maxzoom)
        staged = staged_bands(ctx, params.sensor)
        reference = gdal_step(ctx, lambda: reference_grey(ctx, window, grid), "read the Sentinel-2 reference")

        def composite_on(on: Grid) -> Composite:
            return compose(gdal_step(ctx, lambda: bands_on(staged, on, params.sensor), "reproject the Landsat bands"))

        level = delivery_level(ctx)
        placement = Check(composite_on, reference, grid, spec, window.bounds().middle_lat, level).place()
        composite = placement.composite
        warped = gdal_step(
            ctx,
            lambda: write_geotiff(ctx.local(WARPED), GeoTiff(composite.rgba, grid.geotransform(), alpha=True)),
            "write the Landsat image",
        )
        report = {
            **placement.report(),
            "cityCloudPct": cloud_pct(composite, *city_slices(ctx, grid)),
            "resolutionM": spec.resolution_m,
            "pansharpened": PANCHROMATIC in staged,
        }
        ctx.update_version({"landsat": report})
        log_placement(ctx, level, report, placement.correction)
        published = ctx.publish(warped, ctx.work_file(WARPED), "image/tiff")
        delete_delivery(ctx)
        return Done(published)


def log_placement(ctx: JobContext, level: str, report: Mapping[str, object], correction: Correction | None) -> None:
    """The log line of what `warp` measured and, for a systematic scene, what it did about the shift."""
    ctx.log.info(
        f"the Landsat scene ({level}) lies {report.get('offsetM', '?')} m from Sentinel-2, {report['cityCloudPct']} % cloud over the city",
        LandsatComposeStep.name,
    )
    if correction is not None:
        why = "" if correction.reason is None else f" ({correction.reason})"
        ctx.log.info(
            f"the {level} scene's shift of {correction.east_m:.1f} m east, {correction.north_m:.1f} m north: {correction.state}{why}",
            LandsatComposeStep.name,
        )
