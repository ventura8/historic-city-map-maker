"""`georef`: automatic GCPs and suggestions, or the fit of the admin's points (M3-interfaces.md §5.6, §6; M4 §2).

A frame `locate` proved (docs/research/M9-calibration.md §7) has its tiles in `calibration.json`: they become its pairs, every fifth cell
a checkpoint set aside before RANSAC; with that file gone, the tiles are measured again on `scan.tif`. The admin's rough points of a frame
nothing proved seed the same measuring: proved, they are replaced by tiles (`how: 'points'`); refused, they are fitted as today. Points
placed on a whole frame shrunk (`steps/whole.py`) first become the city's crop at full resolution (`steps/recrop.py`). A set
holding automatic pairs is fitted as saved, so a later edit is never overwritten.

A version still on its corner GCPs and not proved (`method: 'corners'`, a USGS import) is matched against the Sentinel-2 window and
OpenStreetMap's lines (`georef/matcher.py`). With at least six confident pairs (`AUTO_GCP_MIN_CONFIDENCE`) the version gets its
`georef` (`poly2` from 12 well-spread pairs, else `affine`; a fifth held out as checkpoints from 15) and the weaker pairs are its
`suggestions`; with fewer, every candidate is a suggestion and the job waits for the admin's points (`awaiting_gcps`, the version
`needs_gcps` with `apiError.imagery.noMatch {pairs}`, the confident count, or `apiError.imagery.noSpread {pairs}` when enough
confident pairs lie almost in a line), which is not a failure (`georef/autogcp.py`). The corner pairs of a guess nothing confirmed
(`weakCorners`) go then: kilometres off, they would spoil the admin's fit (3.3 km of error at 8 hand-read points of the 1972
frame, 0.4 km without them) and could be saved alone. A version that holds the admin's points (or any other method) is only fitted
with its own transform, and its suggestions are done with; an automatic fit met again (a retry after this step) is fitted the same
way and keeps its suggestions: the corner GCPs a new match starts from were replaced by it, and the georeferencer still offers
those pairs. A scan without any georeference waits for points; an upload's own georeference needs none (`skipped`).
"""

import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final, NoReturn

import numpy

from hcm_pipeline.calibrate.dense import PROOF_SEARCH_GROUND_M, dense_grid, nothing_measured, read_film
from hcm_pipeline.calibrate.joining import Proved, joined_calibration
from hcm_pipeline.calibrate.pairs import Calibrated, ScanBox, calibrated
from hcm_pipeline.calibrate.poly import MatrixMap, PlaceMap
from hcm_pipeline.calibrate.proof import Proof, no_film
from hcm_pipeline.calibrate.reach import measured_pct
from hcm_pipeline.calibrate.rival import proved
from hcm_pipeline.calibrate.stored import StoredTiles
from hcm_pipeline.contract import MIN_GCPS, Errors
from hcm_pipeline.documents import GeorefInfo, ScanInfo, TerrainInfo
from hcm_pipeline.frames import Segment
from hcm_pipeline.geo import FloatArray, Grid, fnv1a, ground_scale, to_mercator
from hcm_pipeline.georef.autogcp import Decision, GcpSuggestions, decide
from hcm_pipeline.georef.corners import corner_transform
from hcm_pipeline.georef.lattice import Lattice
from hcm_pipeline.georef.matcher import MatchResult, References, Scan, match
from hcm_pipeline.georef.transforms import Fit, FitRefusal, Gcp, Transform, enabled_gcps, fit
from hcm_pipeline.images import UInt8Array, seeded
from hcm_pipeline.jobs import Done, JobContext, Skipped, StepFailedError, StepResult, Waiting
from hcm_pipeline.osm import draw
from hcm_pipeline.rasters import read_band, to_uint8
from hcm_pipeline.steps.aligning import Joining, joined_to_held
from hcm_pipeline.steps.common import Sentinel2, city_window, gdal_step, grey_reference, osm_features
from hcm_pipeline.steps.locate import CALIBRATION_FILE
from hcm_pipeline.steps.recrop import recropped
from hcm_pipeline.steps.relief import city_heights, terrain_summary
from hcm_pipeline.store import DELETE

NEEDS_POINTS: Final = "the scan needs the admin's points (georeferencer)"
AUTO_METHOD: Final = "auto"
MATCHER_HOW: Final = "matcher"
# What `locate` recorded of the proof, gone once the matcher fits the frame.
PROOF_FIGURES: Final = frozenset({"measuredPct", "crossValidatedM", "tiles"})
NOT_PROVED_HOW: Final = "none"
ALIGNMENT: Final = "alignment"
TILES_GONE: Final = "the proof's tiles are gone, or too few lie in the crop: they are measured again on the scan"
# How far the tiles search around the admin's points: as far as a proposal, further with points that hold worse (ground metres).
SEED_MAX_SEARCH_M: Final = 2000.0
SEED_SEARCH_RMSE_SHARE: Final = 3.0


def recorded(fitted: Fit, method: str, lattice: Lattice | None = None, terrain: TerrainInfo | None = None) -> GeorefInfo:
    """The version's `georef` for a fit; `lattice`, the nodes of a map its pairs cannot rebuild (M15 §1); `terrain`, the RPC a map over
    terrain renders through (M15, *Terrain*)."""
    kind = fitted.checkpoint_kind
    return GeorefInfo(
        method,
        fitted.transform.kind,
        fitted.gcps,
        fitted.fit_rmse_m,
        fitted.checkpoint_rmse_m,
        fitted.checkpoint_count,
        kind=kind,
        lattice=lattice,
        terrain=terrain,
    )


def automatic(found: Calibrated) -> GeorefInfo:
    """A proved frame's `georef`: its fit, its lattice and, over terrain, its RPC."""
    terrain = None if found.terrain is None else TerrainInfo(found.terrain.rpc, found.terrain.relief_m, found.terrain.heights)
    return recorded(found.fitted, AUTO_METHOD, found.lattice, terrain)


def wait_for_points(ctx: JobContext, pairs: int, fields: Mapping[str, object] | None = None, code: str = Errors.NO_MATCH) -> Waiting:
    """The job waits for the admin's points; the version is `needs_gcps` with `code {pairs}` (and `fields`)."""
    # Error parameters are texts (`apiErrorParamsSchema`): the page fills `{pairs}` in; a number made the version unreadable.
    error = {"code": code, "params": {"pairs": str(pairs)}}
    ctx.update_version({"state": "needs_gcps", "error": error, **(fields or {})})
    why = "lie almost in a line" if code == Errors.NO_SPREAD else "are too few"
    return Waiting("awaiting_gcps", "gcps", f"{pairs} automatic pairs {why}: {NEEDS_POINTS}")


def _outside(gcps: tuple[Gcp, ...], scan: ScanInfo) -> list[str]:
    return [gcp.id for gcp in gcps if not (0 <= gcp.x <= scan.width and 0 <= gcp.y <= scan.height)]


def fit_points(georef: GeorefInfo, scan: ScanInfo) -> GeorefInfo:
    """The admin's (or any recorded) points fitted with their transform; a refusal fails the step."""
    outside = _outside(georef.gcps, scan)
    if outside:
        raise StepFailedError(Errors.GCP_OUTSIDE, f"points outside the scan: {', '.join(outside)}", {"count": len(outside)})
    result = fit(georef.transform, georef.gcps)
    if result is FitRefusal.TOO_FEW:
        raise StepFailedError(Errors.TOO_FEW_GCPS, "too few enabled points for the transform", {"min": MIN_GCPS[georef.transform]})
    if isinstance(result, FitRefusal):
        raise StepFailedError(Errors.DEGENERATE_GCPS, "the points are collinear or coincident")
    return recorded(result, georef.method)


def scan_resolution(gcps: tuple[Gcp, ...], width: int) -> float:
    """The scan's approximate pixel size in EPSG:3857 metres, from its first two corner GCPs (a weak crop's lie inside the scan)."""
    first, second = gcps[0], gcps[1]
    (x0, y0), (x1, y1) = to_mercator(first.lng, first.lat), to_mercator(second.lng, second.lat)
    pixels = math.hypot(second.x - first.x, second.y - first.y) or width
    return max(math.hypot(x1 - x0, y1 - y0) / max(pixels, 1), 1e-3)


def _missing(path: str) -> NoReturn:
    raise StepFailedError(Errors.REFERENCE_UNAVAILABLE, f"the reference {path} is gone")


def osm_lines(ctx: JobContext, grid: Grid) -> UInt8Array | None:
    """The window's cached OpenStreetMap lines drawn on the reference grid; None without them (Sentinel-2 alone)."""
    try:
        features, _ = osm_features(ctx, city_window(ctx))
    except StepFailedError as error:
        ctx.log.warn(f"no OpenStreetMap lines ({error}): matching on Sentinel-2 alone", "georef")
        return None
    return draw(features, grid)


def references(ctx: JobContext) -> References:
    """The job's Sentinel-2 window (the `reference` step's) in grey, and the OpenStreetMap lines on its grid."""
    reference_path = ctx.job.step("reference").gcs_path
    if reference_path is None:
        raise StepFailedError(Errors.REFERENCE_UNAVAILABLE, "the job has no reference window")
    info = ctx.services.objects.stat(reference_path) or _missing(reference_path)
    source = Sentinel2(ctx.stage(reference_path, "reference-s2.tif"), info, ())
    grid = source.grid()
    return References(grid, grey_reference(source), osm_lines(ctx, grid))


def match_scan(ctx: JobContext, georef: GeorefInfo, scan: ScanInfo) -> MatchResult:
    """Automatic pairs of the scan against the references, seeded from the job id (a job matches the same way twice)."""
    found = references(ctx)
    pixels = gdal_step(ctx, lambda: to_uint8(read_band(ctx.stage(scan.path, "scan.tif"))), "read the scan")
    initial = corner_transform(georef.gcps)
    seeded(int(fnv1a(ctx.job.id)[:7], 16))
    return match(Scan(pixels, scan_resolution(georef.gcps, scan.width)), initial.to_pixel, found)


def _scan_of(scan: ScanInfo | None) -> ScanInfo:
    if scan is None:
        raise StepFailedError(Errors.NO_SCAN, "the version has no scan")
    return scan


def _embedded(georef: GeorefInfo | None) -> bool:
    return georef is not None and georef.method == "embedded"


def _suggestions(ctx: JobContext, result: MatchResult, decision: Decision) -> dict[str, object]:
    record = GcpSuggestions(result.method, result.channels, ctx.now(), result.tiles.total, decision.suggestions).as_record()
    return {"suggestions": record}


def _left_by_a_fit(georef: GeorefInfo) -> Mapping[str, object]:
    """The admin's points are done with the suggestions; an automatic fit retried keeps those its match left."""
    return {} if georef.method == AUTO_METHOD else {"suggestions": DELETE}


def _left_by_a_weak_guess(corners: GeorefInfo) -> Mapping[str, object]:
    """The scan waits for the admin: the corner pairs of a guess nothing confirmed go (`needs_gcps` asks only for a scan)."""
    return {"georef": DELETE} if corners.weak_corners else {}


def _blocked(found: Calibrated) -> dict[str, object]:
    """The blocked figure when one was measured: too few pairs have none, and whatever `locate` measured stands."""
    return {} if found.cross_validated_m is None else {"crossValidatedM": round(found.cross_validated_m, 2)}


def _figures(ctx: JobContext, found: Calibrated) -> dict[str, object]:
    """`calibration` with what the fit measured; `alignment`, the frames it was joined to, set or removed each time."""
    dropped = {"checksDropped": found.checks_dropped} if found.checks_dropped else {}
    calibration = {key: value for key, value in ctx.version.calibration.items() if key != ALIGNMENT}
    aligned = {ALIGNMENT: found.alignment_record} if found.alignment_record else {}
    return {**calibration, **_blocked(found), **dropped, **aligned}


def _matcher_took_over(ctx: JobContext) -> Mapping[str, object]:
    """A proved frame whose tiles gave no fit, fitted by the matcher: the fit is no longer the proof's, and the record says so: its tiles,
    the share they span and their error describe another map, over more ground than the city. The fit's own error is on the approval
    card."""
    calibration = {key: value for key, value in ctx.version.calibration.items() if key not in PROOF_FIGURES}
    return {"calibration": {**calibration, "how": MATCHER_HOW}} if calibration and calibration.get("how") != NOT_PROVED_HOW else {}


class _ScanReader:
    """`scan.tif` as a film: an already cropped frame, one segment."""

    def __init__(self, ctx: JobContext, scan: ScanInfo) -> None:
        self._ctx, self._scan = ctx, scan

    def read(self, box: tuple[int, int, int, int], factor: int) -> UInt8Array:
        segment = Segment(self._ctx.stage(self._scan.path, "scan.tif"))
        size = ((box[2] - box[0]) // factor, (box[3] - box[1]) // factor)
        pixels = segment.averaged_window(box[0], box[1], size[0] * factor, size[1] * factor, size)
        segment.close()
        return pixels


@dataclass(frozen=True)
class TransformMap:
    """The admin's points' transform as a map for the tiles."""

    transform: Transform

    def to_places(self, film: FloatArray) -> FloatArray:
        return numpy.column_stack(self.transform.to_mercator(film[:, 0], film[:, 1]))

    def to_film(self, places: FloatArray) -> FloatArray:
        return numpy.column_stack(self.transform.to_pixel(places[:, 0], places[:, 1]))


def job_seed(ctx: JobContext) -> int:
    """A job measures the same way twice."""
    return int(fnv1a(ctx.job.id)[:7], 16)


def _sentinel_of(found: References) -> UInt8Array:
    if found.s2 is None:
        raise StepFailedError(Errors.REFERENCE_UNAVAILABLE, "the job's reference has no Sentinel-2 window")
    return found.s2


def measured_on_scan(ctx: JobContext, start: PlaceMap, scan: ScanInfo, search_ground_m: float, given: References | None = None) -> Proof:
    """The tiles of the job's reference on the scan, from `start`, and the verdict (M16's refine has no `reference` step: `given`)."""
    found = given or references(ctx)
    grid = found.grid
    middle = grid.box().bounds().middle_lat
    reference = dense_grid(_sentinel_of(found), grid, search_ground_m)
    limits = (scan.width, scan.height, 0)
    film = read_film(start, grid.box(), _ScanReader(ctx, scan), limits, search_ground_m / ground_scale(middle))
    if film is None:
        return no_film(nothing_measured())
    return proved(start, reference, film, job_seed(ctx), ctx.checkpoint)


def _stored(ctx: JobContext) -> StoredTiles | None:
    """The proof's tiles `locate` left, when the work folder still holds them."""
    path = ctx.work_file(CALIBRATION_FILE)
    return None if ctx.services.objects.stat(path) is None else StoredTiles.read(ctx.stage(path, CALIBRATION_FILE))


def _seedable(georef: GeorefInfo) -> bool:
    """The admin's own rough points, all of them in the fit: what may start the tiles."""
    enabled = enabled_gcps(georef.gcps)
    plain = len(enabled) == len(georef.gcps) and all(gcp.origin != AUTO_METHOD for gcp in georef.gcps)
    return georef.method == "gcps" and plain and len(enabled) >= MIN_GCPS["affine"]


def _seed_map(ctx: JobContext, georef: GeorefInfo) -> PlaceMap | None:
    """The map the admin's points start the tiles from; None when they may not (`_seedable`), or the job has no reference."""
    if not _seedable(georef) or ctx.job.step("reference").gcs_path is None:
        return None
    fitted = fit(georef.transform, georef.gcps)
    return TransformMap(fitted.transform) if isinstance(fitted, Fit) else None


def _seed_search_m(fitted: GeorefInfo) -> float:
    rmse = fitted.checkpoint_rmse_m or 0.0
    return max(PROOF_SEARCH_GROUND_M, min(SEED_SEARCH_RMSE_SHARE * rmse, SEED_MAX_SEARCH_M))


class GeorefStep:
    name = "georef"

    def run(self, ctx: JobContext) -> StepResult:
        georef = ctx.version.georef
        if _embedded(georef):
            return Skipped("the upload carries its own georeference")
        scan = _scan_of(ctx.version.scan)
        return wait_for_points(ctx, 0) if georef is None or not georef.gcps else self._of_gcps(ctx, *recropped(ctx, georef, scan))

    def _of_gcps(self, ctx: JobContext, georef: GeorefInfo, scan: ScanInfo) -> StepResult:
        if georef.lattice is not None:
            ctx.log.info(f"kept: the {georef.lattice.model} map a retry cannot refit from its pairs", self.name)
            return Done()
        if georef.method != "corners":
            return self._of_points(ctx, georef, scan)
        return self._of_proof(ctx, georef, scan) or self._matched(ctx, georef, match_scan(ctx, georef, scan))

    def _of_points(self, ctx: JobContext, georef: GeorefInfo, scan: ScanInfo) -> StepResult:
        """The points fitted, or, when they may seed the tiles and those prove, replaced by them."""
        points = fit_points(georef, scan)
        start = _seed_map(ctx, georef)
        if start is None:
            return self._fitted(ctx, points, _left_by_a_fit(georef))
        proof = gdal_step(ctx, lambda: measured_on_scan(ctx, start, scan, _seed_search_m(points)), "measure the scan")
        if proof.accepted:
            return self._of_seeded(ctx, georef, points, scan, proof)
        ctx.log.info(f"the points seeded the tiles, which were not proved ({proof.refusal}): the points are fitted as saved", self.name)
        return self._fitted(ctx, points, _left_by_a_fit(georef))

    def _of_seeded(self, ctx: JobContext, georef: GeorefInfo, points: GeorefInfo, scan: ScanInfo, proof: Proof) -> StepResult:
        order = proof.forward.order if proof.forward is not None else 2
        middle = city_window(ctx).bounds().middle_lat
        found = calibrated(proof.measured.rows, order, ScanBox(0, 0, scan.width, scan.height), middle, job_seed(ctx))
        if found is None:
            return self._fitted(ctx, points, _left_by_a_fit(georef))
        ctx.log.info(
            f"the {len(georef.gcps)} points seeded the tiles: {proof.inliers} of {proof.tried} agree; they replace the points", self.name
        )
        record = {**self._calibration(ctx, proof, found, "points"), "seedPoints": len(georef.gcps)}
        return self._fitted(ctx, recorded(found.fitted, AUTO_METHOD), {**_left_by_a_fit(georef), "calibration": record})

    def _of_proof(self, ctx: JobContext, corners: GeorefInfo, scan: ScanInfo) -> StepResult | None:
        """A proved frame's fit: its stored tiles, else measured again on the scan, joined to the frames already accepted; None for a
        frame nothing proved."""
        if corners.weak_corners or not ctx.version.calibration:
            return None
        found = self._first_fit(ctx, corners, scan)
        if found is None:
            return None
        joining = Joining(found[0], scan, automatic(found[1]), job_seed(ctx))
        fitted = joined_to_held(ctx, joining, found[1])
        ctx.log.info(terrain_summary(fitted, found[0]), self.name)
        return self._fitted(ctx, automatic(fitted), {"calibration": _figures(ctx, fitted)})

    def _first_fit(self, ctx: JobContext, corners: GeorefInfo, scan: ScanInfo) -> tuple[Proved, Calibrated] | None:
        """The proved frame's tiles and its fit alone; None when it has none or they do not fit."""
        proved = self._stored_tiles(ctx, scan) or self._remeasured_tiles(ctx, corners, scan)
        found = None if proved is None else joined_calibration(proved, job_seed(ctx))
        return None if proved is None or found is None else (proved, found)

    def _stored_tiles(self, ctx: JobContext, scan: ScanInfo) -> Proved | None:
        stored = _stored(ctx)
        if stored is None:
            return None
        box = ScanBox(stored.left, stored.top, scan.width, scan.height, stored.rad_per_px)
        return Proved(stored.rows, stored.order, box, stored.middle_lat, None if box.rad_per_px is None else city_heights(ctx))

    def _remeasured_tiles(self, ctx: JobContext, corners: GeorefInfo, scan: ScanInfo) -> Proved | None:
        """The work folder is gone (a resume): the tiles again, from the proved corners."""
        ctx.log.info(TILES_GONE, self.name)
        start = MatrixMap(corner_transform(corners.gcps).matrix)
        proof = gdal_step(ctx, lambda: measured_on_scan(ctx, start, scan, PROOF_SEARCH_GROUND_M), "measure the scan")
        if proof.forward is None or not proof.accepted:
            return None
        middle = city_window(ctx).bounds().middle_lat
        return Proved(proof.measured.rows, proof.forward.order, ScanBox(0, 0, scan.width, scan.height), middle)

    def _calibration(self, ctx: JobContext, proof: Proof, found: Calibrated, how: str) -> dict[str, object]:
        record: dict[str, object] = {
            **ctx.version.calibration,
            "how": how,
            "tiles": {"agreed": proof.inliers, "tried": proof.tried},
            "measuredPct": measured_pct(proof),
            **_blocked(found),
        }
        record.pop("refusal", None)
        return record

    def _matched(self, ctx: JobContext, corners: GeorefInfo, result: MatchResult) -> StepResult:
        decision = decide(result.pairs)
        matched, total = result.tiles.total
        ctx.log.info(
            f"{result.method} over {', '.join(result.channels)}: {decision.confident} confident pairs, "
            f"{len(decision.suggestions)} suggestions, {matched} of {total} tiles matched",
            self.name,
        )
        suggestions = _suggestions(ctx, result, decision)
        if decision.fitted is None:
            code = Errors.NO_SPREAD if decision.degenerate else Errors.NO_MATCH
            return wait_for_points(ctx, decision.confident, {**suggestions, **_left_by_a_weak_guess(corners)}, code)
        return self._fitted(ctx, recorded(decision.fitted, AUTO_METHOD), {**suggestions, **_matcher_took_over(ctx)})

    def _fitted(self, ctx: JobContext, georef: GeorefInfo, fields: Mapping[str, object]) -> Done:
        ctx.update_version({"georef": georef.as_record(), **fields})
        ctx.log.info(_summary(georef), self.name)
        return Done()


def _summary(georef: GeorefInfo) -> str:
    checkpoint = "no checkpoint" if georef.checkpoint_rmse_m is None else f"checkpoint RMSE {georef.checkpoint_rmse_m:.1f} m"
    return f"{georef.transform} through {len(georef.gcps)} pairs, fit RMSE {georef.fit_rmse_m or 0:.1f} m, {checkpoint}"
