"""A waiting series placed from the owner's pairs (docs/research/M22-help-calibrate.md §4.1, docs/LESSONS.md, 2026-11-10).

A series that parked (`needs_gcps`) left its stitched picture as the version's `scan` (`placing/stitched.py`: at most `SCAN_MAX_PX`
long), and the owner placed pairs on it in the georeferencer; `imagery.saveGcps` wrote them as the version's `georef` (`method: 'gcps'`)
and queued `place` again. `place` then fits those pairs with their transform (`georef/transforms.py`, as `steps/georef.py` fits a
frame's) and never runs the class's placer again, which only re-parked the series. The pairs are scaled from the scan's pixels to the
kept `stitched.tif` (the job's work folder; the scan itself when that is gone), sampled into a lattice through the fit as `steps/warp.py`
does for a polynomial (a thin-plate spline through its own enabled pairs), and warped into `warped.tif` at the series' `maxzoom`;
the version's `georef` gets the fit's figures and `archive` its report (`method: 'gcps'`). Too few pairs, or pairs in a line, park the
series again with its help as it was and the owner's pairs kept, so the georeferencer opens with them.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Final

import numpy

from hcm_pipeline.documents import GeorefInfo, ScanInfo
from hcm_pipeline.geo import to_mercator
from hcm_pipeline.georef.lattice import sampled
from hcm_pipeline.georef.transforms import Fit, enabled_gcps, fit
from hcm_pipeline.jobs import JobContext, StepResult, Waiting
from hcm_pipeline.placing.checks import Checked, span_pct
from hcm_pipeline.placing.output import Placement, finish, param_int, resolution_of
from hcm_pipeline.placing.raster_io import Pair, WarpPlan, warp_by_pairs
from hcm_pipeline.placing.series import ENCODINGS
from hcm_pipeline.placing.stitched import STITCHED
from hcm_pipeline.steps.common import gdal_step
from hcm_pipeline.steps.georef import recorded
from hcm_pipeline.steps.warp import scan_size

OWNER_METHOD: Final = "gcps"
PICTURE_GONE: Final = "the stitched picture is gone: the pairs are warped on the scan they were placed on"
NOT_ENOUGH: Final = "Your points are too few, or lie almost in a line, for the chosen fit: add a few more, spread over the map."


def owner_pairs(georef: GeorefInfo | None) -> GeorefInfo | None:
    """The owner's pairs `imagery.saveGcps` wrote, else None (the class's placer runs)."""
    return georef if georef is not None and georef.method == OWNER_METHOD and georef.gcps else None


@dataclass(frozen=True)
class Picture:
    """What is warped: the stitched picture (or the scan) and the factors from the scan's pixels to its own."""

    path: Path
    sx: float
    sy: float


def picture_of(ctx: JobContext, scan: ScanInfo) -> Picture:
    """`stitched.tif` where this run or the parked one left it, else the scan the pairs were placed on."""
    local = ctx.local(STITCHED)
    if not local.is_file() and ctx.services.objects.stat(ctx.work_file(STITCHED)) is not None:
        local = ctx.stage(ctx.work_file(STITCHED), STITCHED)
    if not local.is_file():
        ctx.log.info(PICTURE_GONE, ctx.step)
        return Picture(ctx.stage(scan.path, "scan.tif"), 1.0, 1.0)
    width, height = scan_size(local)
    return Picture(local, width / max(scan.width, 1), height / max(scan.height, 1))


def lattice_pairs(fitted: Fit, scan: ScanInfo, picture: Picture) -> list[Pair]:
    """The fit's places at a lattice over the scan (a spline: its enabled pairs), in the picture's pixels."""
    if fitted.transform.kind == "tps":
        points = [(*to_mercator(gcp.lng, gcp.lat), gcp.x, gcp.y) for gcp in enabled_gcps(fitted.gcps)]
    else:
        points = [node.as_point() for node in sampled(fitted.transform.to_lnglat, scan.width, scan.height)]
    return [Pair(px * picture.sx, py * picture.sy, mx, my) for mx, my, px, py in points]


def _checked(fitted: Fit, scan: ScanInfo) -> Checked:
    pixels = numpy.array([(gcp.x, gcp.y) for gcp in enabled_gcps(fitted.gcps)], numpy.float64).reshape(-1, 2)
    rmse = fitted.fit_rmse_m if fitted.checkpoint_rmse_m is None else fitted.checkpoint_rmse_m
    return Checked(rmse, fitted.checkpoint_count, 0, span_pct(pixels, (0.0, 0.0, float(scan.width), float(scan.height))), None)


def _park_again(ctx: JobContext) -> Waiting:
    """The series waits again with its help (and stitched picture) as it was, a new note, and the owner's pairs kept."""
    ctx.update_version({"state": "needs_gcps", "help.note": NOT_ENOUGH, "help.at": ctx.now()})
    ctx.log.info(f"waits for a person again: {NOT_ENOUGH}", ctx.step)
    return Waiting("awaiting_gcps", "gcps", NOT_ENOUGH)


def place_from_pairs(ctx: JobContext, georef: GeorefInfo) -> StepResult:
    """The series warped through the owner's pairs, or parked again when they cannot fix the transform."""
    scan = ctx.version.scan
    fitted = fit(georef.transform, georef.gcps)
    if scan is None or not isinstance(fitted, Fit):
        return _park_again(ctx)
    params = ctx.job.params
    encoding = str(params.get("encoding")) if params.get("encoding") in ENCODINGS else "grey"
    picture = picture_of(ctx, scan)
    plan = WarpPlan(lattice_pairs(fitted, scan, picture), resolution_of(params), True, encoding == "lineart")
    warped = gdal_step(ctx, lambda: warp_by_pairs(picture.path, ctx.local("warped.tif"), plan), "warp the series by the owner's pairs")
    ctx.update_version({"georef": recorded(fitted, OWNER_METHOD).as_record()})
    scale = param_int(params, "scaleDenominator")
    placement = Placement(OWNER_METHOD, encoding, _checked(fitted, scan), True, scale, params.get("paperTransparent") is True)
    placed = param_int(ctx.version.source, "sheetCount", 1) or 1
    return finish(ctx, placement, warped, placed)
