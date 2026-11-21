"""M16: a published layer, or a version waiting for approval, calibrated again (docs/research/M16-recalibrate.md §2, §3).

A recalibration is a `regeoref` version carrying `recalibration`. `RecalibratedGeorefStep` is the `georef` step for every job: a version
with the route `auto` (Refine automatically) or `points` (Snap my points) is measured again here, the rest goes to `GeorefStep` unchanged.

- **The current map** is the one its layer shows (M15, *one map for every reader*: `steps/warp.py`): a thin-plate spline through the
  points it renders (its own, a polynomial sampled on 17 x 17 nodes, or a panoramic camera's stored lattice), or over terrain its RPC over
  the heights it carries, each through GDAL's own transformer (`rendered_map`). Its pairs and figures are refitted from its record.
- **The start.** `auto`: the current pairs' fit (a seed; an RPC does not reach the window's corners). `points`: the current pairs
  moved by the rough points' corrections measured against the current map (the nearest point weighs most, so one point moves the whole
  map and several bend it), plus the points themselves, fitted with the current pairs' transform.
- **The references.** A `regeoref` job has no `reference` step: the city window's cached Sentinel-2 and OpenStreetMap lines are read here.
- **The proof** and the pairs are M9's own (`measured_on_scan`, `calibrated`), every gate unchanged.
- **The ruler** (§2): the current map and the new fit are measured on **the same checks**, the new version's disabled pairs, in ground
  metres (`figure_on`; the new fit's is its `checkpointRmseM`, the figure its version page reports). A manual version (the
  georeferencer's Save) is compared the same way when it holds at least `RECALIBRATE_MIN_CHECKS` disabled pairs.
- **Endings.** The proof refused: declined (`refineRefused`). `auto` with too few held-out checks to compare: declined
  (`refineUnmeasured`, not `refineRefused`: the tiles agreed). `auto` not better by `RECALIBRATE_MIN_GAIN_M`: declined (`notImproved`).
  Declined is `DeclinedError`: the job and its version end cancelled with the reason, nothing rendered.
- **The new fit** is a polynomial of the proof's pairs, as any re-measured proof (M15 §2): a regeoref job has neither the film's offset
  nor `calibration.json`, which the panoramic camera and the terrain fit need. It renders through its 17 x 17 nodes like any polynomial.
  A camera version is therefore refined only when the polynomial beats its camera on the same checks (M16 §14).
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Final

import numpy

from hcm_pipeline.calibrate.dense import PROOF_SEARCH_GROUND_M
from hcm_pipeline.calibrate.pairs import Calibrated, ScanBox, calibrated
from hcm_pipeline.calibrate.poly import PlaceMap
from hcm_pipeline.calibrate.proof import Proof
from hcm_pipeline.contract import MIN_GCPS, RECALIBRATE_MIN_CHECKS, RECALIBRATE_MIN_GAIN_M, Errors
from hcm_pipeline.documents import GeorefInfo, ScanInfo, Version
from hcm_pipeline.geo import FloatArray, to_lnglat, to_mercator
from hcm_pipeline.georef.matcher import References
from hcm_pipeline.georef.transforms import Fit, Gcp, Transform, enabled_gcps, fit, fit_transform, rmse
from hcm_pipeline.jobs import DeclinedError, Done, JobContext, StepFailedError, StepResult
from hcm_pipeline.model import number_of, record_of
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import WEB_MERCATOR, driver_of, srs_wkt
from hcm_pipeline.steps.common import city_window, gdal_step, grey_reference, sentinel2
from hcm_pipeline.steps.georef import (
    AUTO_METHOD,
    SEED_MAX_SEARCH_M,
    SEED_SEARCH_RMSE_SHARE,
    GeorefStep,
    TransformMap,
    job_seed,
    measured_on_scan,
    osm_lines,
    recorded,
    references,
)
from hcm_pipeline.steps.warp import FLAT_GROUND, RPC_OPTIONS, TPS_OPTIONS, rendered_points
from hcm_pipeline.store import DELETE
from hcm_pipeline.surface import write_heights

# The new pairs this close to a rough point are what Snap proposes there (ground metres).
POINT_REACH_GROUND_M: Final = 1500.0
# How far the tiles search around a start the rough points bent: at least twice the furthest the start misses a point by.
POINT_SEARCH_SHARE: Final = 2.0
STARTED_ROUTES: Final = frozenset({"auto", "points"})
DST_SRS: Final = "DST_SRS=EPSG:3857"
TO_PLACES: Final = 0
TO_FILM: Final = 1


@dataclass(frozen=True)
class GdalMap:
    """A map through GDAL's own transformer, the one a warp runs on; a place it cannot reach is NaN. It keeps its band-less dataset."""

    dataset: gdal.Dataset
    transformer: gdal.Transformer

    def _through(self, to_source: int, points: FloatArray) -> FloatArray:
        found, good = self.transformer.TransformPoints(to_source, numpy.asarray(points, numpy.float64).tolist())
        values = numpy.array(found, numpy.float64).reshape(-1, 3)[:, :2]
        values[~numpy.array(good, numpy.bool_)] = numpy.nan
        return values

    def to_places(self, film: FloatArray) -> FloatArray:
        return self._through(TO_PLACES, film)

    def to_film(self, places: FloatArray) -> FloatArray:
        return self._through(TO_FILM, places)


def rendered_map(ctx: JobContext, georef: GeorefInfo, scan: ScanInfo) -> GdalMap:
    """The map a version's layer shows (`steps/warp.py` `attached`): over terrain its RPC over the heights it carries, else a thin-plate
    spline through the points it renders. It reads no pixel, so no scan is fetched for it."""
    dataset = driver_of("MEM").Create("", scan.width, scan.height, 0)
    terrain = georef.terrain
    if terrain is None:
        points = rendered_points(georef, (scan.width, scan.height))
        dataset.SetGCPs([gdal.GCP(x, y, FLAT_GROUND, column, row) for x, y, column, row in points], srs_wkt(WEB_MERCATOR))
        return GdalMap(dataset, gdal.Transformer(dataset, None, [*TPS_OPTIONS, DST_SRS]))
    for key, value in terrain.rpc.metadata().items():
        dataset.SetMetadataItem(key, value, "RPC")
    dem = write_heights(ctx.local("current-dem.tif"), terrain.heights)
    return GdalMap(dataset, gdal.Transformer(dataset, None, ["METHOD=RPC", f"RPC_DEM={dem}", *RPC_OPTIONS, DST_SRS]))


@dataclass(frozen=True)
class Current:
    """The current version: its pairs' fit (pairs, kind, figure) and the map its layer shows (`rendered_map`)."""

    fit: Fit
    rendered: PlaceMap

    @classmethod
    def polynomial(cls, fitted: Fit) -> Current:
        """A fit that renders as itself."""
        return cls(fitted, TransformMap(fitted.transform))


@dataclass(frozen=True)
class Figure:
    """A checkpoint figure: ground metres over `checks` pairs (`recalibration.before`, `after`)."""

    rmse_m: float
    checks: int

    def as_record(self) -> dict[str, object]:
        return {"rmseM": round(self.rmse_m, 2), "checks": self.checks}


@dataclass(frozen=True)
class Compared:
    """The current fit and the new one on the same checks."""

    before: Figure
    after: Figure

    @property
    def better(self) -> bool:
        """The one reading of the figures (`recalibrationVerdict` in `@hcm/shared`): better by at least `RECALIBRATE_MIN_GAIN_M`."""
        return self.after.rmse_m <= self.before.rmse_m - RECALIBRATE_MIN_GAIN_M

    def as_record(self) -> dict[str, object]:
        return {"before": self.before.as_record(), "after": self.after.as_record()}

    def text(self) -> str:
        return f"{self.after.rmse_m:.1f} m against the current {self.before.rmse_m:.1f} m on the same {self.after.checks} checks"


def misses_m(rendered: PlaceMap, checks: Sequence[Gcp]) -> FloatArray:
    """Ground metres between each check's place and where the map puts its pixel (`transforms.residuals_m`, for any map)."""
    film = numpy.array([(gcp.x, gcp.y) for gcp in checks], numpy.float64).reshape(-1, 2)
    places = numpy.array([to_mercator(gcp.lng, gcp.lat) for gcp in checks], numpy.float64).reshape(-1, 2)
    found = rendered.to_places(film)
    latitudes = numpy.radians(numpy.array([gcp.lat for gcp in checks], numpy.float64))
    return numpy.hypot(found[:, 0] - places[:, 0], found[:, 1] - places[:, 1]) * numpy.cos(latitudes)


def figure_on(rendered: PlaceMap, checks: Sequence[Gcp]) -> Figure:
    """A map's error on `checks`, the product's ruler: ground metres between each place and where the map puts its pixel."""
    return Figure(rmse(misses_m(rendered, checks).tolist()), len(checks))


def held_out(georef: GeorefInfo) -> list[Gcp]:
    """The fit's checkpoints that it never saw: its disabled pairs."""
    return [gcp for gcp in georef.gcps if not gcp.enabled]


def compared(current: Current | None, georef: GeorefInfo) -> Compared | None:
    """The current map and the new fit on the new fit's held-out pairs, when there are enough of them; None otherwise."""
    checks = held_out(georef)
    if current is None or len(checks) < RECALIBRATE_MIN_CHECKS:
        return None
    return Compared(figure_on(current.rendered, checks), Figure(georef.checkpoint_rmse_m or 0.0, len(checks)))


def figures_record(figures: Compared | None) -> dict[str, object]:
    return {} if figures is None else figures.as_record()


def figures_text(figures: Compared | None) -> str:
    return "not compared: too few held-out checks" if figures is None else figures.text()


def refitted(georef: GeorefInfo | None) -> Fit | None:
    """A recorded georeference's fit, from its pairs; None without pairs to fit."""
    fitted = None if georef is None or not georef.gcps else fit(georef.transform, georef.gcps)
    return fitted if isinstance(fitted, Fit) else None


def current_of(ctx: JobContext, georef: GeorefInfo | None, scan: ScanInfo | None) -> Current | None:
    """A version's pairs refitted and the map its layer shows (a polynomial's own without its scan's size); None without pairs."""
    fitted = refitted(georef)
    if fitted is None or georef is None:
        return None
    return Current.polynomial(fitted) if scan is None else Current(fitted, rendered_map(ctx, georef, scan))


def current_fit(ctx: JobContext) -> Current | None:
    """The current version (`basedOn`): its pairs refitted and the map its layer shows; None when it has no pairs."""
    based_on = ctx.version.based_on
    record = None if based_on is None else ctx.services.store.get(f"cities/{ctx.city}/layerVersions/{based_on}")
    if record is None or based_on is None:
        return None
    current = Version.of(based_on, record)
    return current_of(ctx, current.georef, current.scan or ctx.version.scan)


@dataclass(frozen=True)
class RoughPoint:
    """A pixel of the scan and where the admin says it lies (`recalibration.points`)."""

    x: float
    y: float
    lat: float
    lng: float

    @classmethod
    def of(cls, value: object) -> RoughPoint:
        record = record_of(value, "a rough point")
        pixel, geo = record_of(record.get("pixel"), "its pixel"), record_of(record.get("geo"), "its place")
        return cls(number_of(pixel, "x"), number_of(pixel, "y"), number_of(geo, "lat"), number_of(geo, "lng"))

    def as_gcp(self, index: int) -> Gcp:
        return Gcp(f"r{index + 1}", self.x, self.y, self.lat, self.lng)


def ground_m(lat_a: float, lng_a: float, lat_b: float, lng_b: float) -> float:
    """Ground metres between two places (Mercator distance at their mean latitude)."""
    (xa, ya), (xb, yb) = to_mercator(lng_a, lat_a), to_mercator(lng_b, lat_b)
    return math.hypot(xb - xa, yb - ya) * math.cos(math.radians((lat_a + lat_b) / 2))


def near(gcp: Gcp, points: Sequence[RoughPoint]) -> bool:
    return any(ground_m(gcp.lat, gcp.lng, point.lat, point.lng) <= POINT_REACH_GROUND_M for point in points)


def points_of(ctx: JobContext) -> list[RoughPoint]:
    raw = ctx.version.recalibration.get("points")
    return [RoughPoint.of(point) for point in raw] if isinstance(raw, list) else []


def offsets(current: Current, points: Sequence[RoughPoint]) -> list[tuple[float, float, float, float]]:
    """Each rough point's place in Mercator and how far the current map is from it there: `(x, y, dx, dy)`."""
    found = []
    for point in points:
        shown = current.rendered.to_places(numpy.array([(point.x, point.y)], numpy.float64))
        x, y = to_mercator(point.lng, point.lat)
        found.append((x, y, x - float(shown[0, 0]), y - float(shown[0, 1])))
    return found


def moved(gcp: Gcp, shifts: Sequence[tuple[float, float, float, float]]) -> Gcp:
    """A current pair moved by the rough points' corrections, each weighing by the inverse square of its distance."""
    x, y = to_mercator(gcp.lng, gcp.lat)
    weights = [1.0 / max(math.hypot(x - sx, y - sy), 1.0) ** 2 for sx, sy, _, _ in shifts]
    total = sum(weights)
    dx = sum(weight * shift[2] for weight, shift in zip(weights, shifts, strict=True)) / total
    dy = sum(weight * shift[3] for weight, shift in zip(weights, shifts, strict=True)) / total
    lng, lat = to_lnglat(x + dx, y + dy)
    return replace(gcp, lat=lat, lng=lng)


def bent_start(current: Current, points: Sequence[RoughPoint]) -> Transform:
    """The current map bent to the rough points: every current pair moved by their corrections, nearest weighing most, and the points
    themselves, fitted with the current pairs' transform (affine when too few)."""
    shifts = offsets(current, points)
    pairs = [moved(gcp, shifts) for gcp in enabled_gcps(current.fit.gcps)] + [point.as_gcp(index) for index, point in enumerate(points)]
    kind = current.fit.transform.kind if len(pairs) >= MIN_GCPS[current.fit.transform.kind] else "affine"
    bent = fit_transform(kind, pairs)
    if bent is None:
        raise StepFailedError(Errors.DEGENERATE_GCPS, "the rough points and the pairs around them are collinear or coincident")
    return bent


def start_of(current: Current, points: Sequence[RoughPoint]) -> PlaceMap:
    """Where the tiles start: the current pairs' fit, or the current map bent to the rough points. A start is a seed the tiles search
    around, and it must reach past the scan to the window's corners, which an RPC over the heights under the scan does not."""
    return TransformMap(bent_start(current, points) if points else current.fit.transform)


def search_m(current: Current, start: PlaceMap, points: Sequence[RoughPoint]) -> float:
    """How far the tiles search: as M9's seeded points for Refine; from bent points, at least twice the furthest the start misses one by,
    as the admin reads them roughly."""
    if points:
        missed = float(numpy.max(misses_m(start, [point.as_gcp(index) for index, point in enumerate(points)])))
        return max(PROOF_SEARCH_GROUND_M, min(POINT_SEARCH_SHARE * missed, SEED_MAX_SEARCH_M))
    rmse_m = current.fit.checkpoint_rmse_m or 0.0
    return max(PROOF_SEARCH_GROUND_M, min(SEED_SEARCH_RMSE_SHARE * rmse_m, SEED_MAX_SEARCH_M))


def window_references(ctx: JobContext) -> References:
    """The job's reference when it has one, else the city window's cached Sentinel-2 and OpenStreetMap lines (a `regeoref` job)."""
    if ctx.job.step("reference").gcs_path is not None:
        return references(ctx)
    source = sentinel2(ctx, city_window(ctx))
    grid = source.grid()
    return References(grid, grey_reference(source), osm_lines(ctx, grid))


def proved_pairs(ctx: JobContext, proof: Proof, scan: ScanInfo) -> Calibrated:
    """The proof's pairs and checks, or the refine declines: the current fit stays."""
    found = None
    if proof.accepted:
        order = proof.forward.order if proof.forward is not None else 2
        middle = city_window(ctx).bounds().middle_lat
        found = calibrated(proof.measured.rows, order, ScanBox(0, 0, scan.width, scan.height), middle, job_seed(ctx))
    if found is None:
        raise DeclinedError(Errors.REFINE_REFUSED, f"the tiles were not proved ({proof.refusal or 'no fit'}): the current fit stays")
    return found


def require_better(figures: Compared | None) -> None:
    """Refine renders only a better fit: too few checks to tell, or not better, and it declines."""
    if figures is None:
        raise DeclinedError(Errors.REFINE_UNMEASURED, "too few checks to compare the two fits: the current fit stays")
    if not figures.better:
        params = {"before": f"{figures.before.rmse_m:.1f}", "after": f"{figures.after.rmse_m:.1f}"}
        raise DeclinedError(Errors.NOT_IMPROVED, f"{figures.text()}: not better, the current fit stays", params)


def proposed(georef: GeorefInfo, points: Sequence[RoughPoint]) -> int:
    """The new pairs near a rough point: what Snap proposes there."""
    return sum(1 for gcp in enabled_gcps(georef.gcps) if near(gcp, points))


def route_of(ctx: JobContext) -> object:
    return ctx.version.recalibration.get("route")


class RecalibratedGeorefStep(GeorefStep):
    """`georef`, with M16's refine for a version that asks for one and the figures of a manual recalibration."""

    def run(self, ctx: JobContext) -> StepResult:
        return self._refine(ctx) if route_of(ctx) in STARTED_ROUTES else super().run(ctx)

    def _refine(self, ctx: JobContext) -> Done:
        scan = ctx.version.scan
        current = current_fit(ctx) or current_of(ctx, ctx.version.georef, scan)
        if scan is None or current is None:
            raise StepFailedError(Errors.NO_SCAN, "the version has no scan or no fit to refine")
        points = points_of(ctx)
        start, given = start_of(current, points), window_references(ctx)
        reach = search_m(current, start, points)
        proof = gdal_step(ctx, lambda: measured_on_scan(ctx, start, scan, reach, given), "measure the scan")
        georef = recorded(proved_pairs(ctx, proof, scan).fitted, AUTO_METHOD)
        figures = compared(current, georef)
        ctx.log.info(f"refined: {proof.inliers} of {proof.tried} tiles agree; {figures_text(figures)}", self.name)
        return GeorefStep._fitted(self, ctx, georef, {"recalibration": self._record(ctx, proof, figures, georef), "suggestions": DELETE})

    def _record(self, ctx: JobContext, proof: Proof, figures: Compared | None, georef: GeorefInfo) -> dict[str, object]:
        """What the new version records; Refine with no points declines unless it is better."""
        points = points_of(ctx)
        if not points:
            require_better(figures)
        near_points = {"proposed": proposed(georef, points)} if points else {}
        tiles = {"agreed": proof.inliers, "tried": proof.tried}
        return {**ctx.version.recalibration, **figures_record(figures), "tiles": tiles, **near_points}

    def _fitted(self, ctx: JobContext, georef: GeorefInfo, fields: Mapping[str, object]) -> Done:
        """A manual recalibration (the georeferencer's Save) is fitted as saved, with the two fits on its disabled pairs."""
        if route_of(ctx) != "manual":
            return super()._fitted(ctx, georef, fields)
        figures = compared(current_fit(ctx), georef)
        ctx.log.info(figures_text(figures), self.name)
        return super()._fitted(ctx, georef, {**fields, "recalibration": {**ctx.version.recalibration, **figures_record(figures)}})
