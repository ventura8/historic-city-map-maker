"""The owner's rough points on a whole frame become the city's crop (docs/research/M9-calibration.md §17).

`georef` meets a version whose scan is a whole frame shrunk (`steps/whole.py`) and now holds the admin's points: the points are put on
the film, the film is cut around them with the city window's larger side as margin (a point anywhere in the window keeps the whole
window in), at full resolution, out of the segments `stitch` made of the kept delivery, and the points move into the crop. The version's
scan is the crop from then on, and `georef` goes on with it as with any scan. Points off the scan are refused; segments no longer stored
(they live 14 days, the delivery 7) end the step with what to do: **Locate again** makes them from a kept delivery, else import again.
On a worker (2026-11-13) a film not stored here may be on the computer that stitched it: `FilmElsewhereError` hands the job back.
"""

from dataclasses import replace
from typing import Final

import numpy

from hcm_pipeline.contract import Errors
from hcm_pipeline.documents import GeorefInfo, ScanInfo
from hcm_pipeline.frames import FRAME_JSON, FrameLayout
from hcm_pipeline.geo import to_mercator
from hcm_pipeline.georef.corners import Crop
from hcm_pipeline.georef.transforms import Gcp
from hcm_pipeline.jobs import FilmElsewhereError, JobContext, StepFailedError
from hcm_pipeline.model import UsgsImportParams
from hcm_pipeline.steps.common import city_window, gdal_step, publish_scan
from hcm_pipeline.steps.locate import camera_of, delete_delivery, film_limits, within_limits, write_crop
from hcm_pipeline.steps.whole import Box, RoughPointsError, WholeFrame, marked, rough_box

STEP: Final = "georef"
NOT_PROVED_HOW: Final = "none"
FILM_GONE: Final = (
    "the frame's film is no longer stored (its segments are kept 14 days): use Locate again while its delivery is kept, "
    "else import the frame again"
)


def recropped(ctx: JobContext, georef: GeorefInfo, scan: ScanInfo) -> tuple[GeorefInfo, ScanInfo]:
    """`georef` and `scan` as they are, or, for the admin's points on a whole frame shrunk, the crop around them and the points in it."""
    whole = _offered(ctx, georef, scan)
    return (georef, scan) if whole is None else _cut(ctx, georef, scan, whole)


def _offered(ctx: JobContext, georef: GeorefInfo, scan: ScanInfo) -> WholeFrame | None:
    """How the scan lies on the film when it is a whole frame shrunk; only a frame nothing proved, holding the admin's points, is read."""
    if georef.method != "gcps" or ctx.version.calibration.get("how") != NOT_PROVED_HOW:
        return None
    return gdal_step(ctx, lambda: marked(ctx.stage(scan.path, "scan.tif")), "read the scan")


def _off_the_scan(gcp: Gcp, scan: ScanInfo) -> bool:
    return not (0 <= gcp.x <= scan.width and 0 <= gcp.y <= scan.height)


def _on_film(gcps: tuple[Gcp, ...], scan: ScanInfo, whole: WholeFrame) -> list[tuple[float, float]]:
    outside = [gcp.id for gcp in gcps if _off_the_scan(gcp, scan)]
    if outside:
        raise StepFailedError(Errors.GCP_OUTSIDE, f"points outside the strip: {', '.join(outside)}", {"count": len(outside)})
    return [whole.to_film(gcp.x, gcp.y) for gcp in gcps]


def _gone(ctx: JobContext) -> Exception:
    """A film not stored here: on a worker it may be on the computer that stitched it (the job goes back), in the cloud it is gone."""
    if ctx.services.archive_root is not None:
        return FilmElsewhereError(f"the film of job {ctx.job.id} is not on this computer")
    return StepFailedError(Errors.PROCESSING_FAILED, FILM_GONE)


def _layout(ctx: JobContext) -> FrameLayout:
    """The frame's layout, with every segment still stored."""
    stored = ctx.services.objects.stat
    if stored(ctx.work_file(FRAME_JSON)) is None:
        raise _gone(ctx)
    layout = FrameLayout.from_json(ctx.stage(ctx.work_file(FRAME_JSON), FRAME_JSON).read_text(encoding="utf-8"))
    if any(stored(each.path) is None for each in layout.placements):
        raise _gone(ctx)
    return layout


def _box(ctx: JobContext, gcps: tuple[Gcp, ...], film: list[tuple[float, float]], layout: FrameLayout) -> Box:
    window = city_window(ctx)
    margin = max(window.right - window.left, window.top - window.bottom)
    limits = film_limits(camera_of(UsgsImportParams.of(ctx.job.params).sensor, layout), layout)
    places = numpy.array([to_mercator(gcp.lng, gcp.lat) for gcp in gcps], numpy.float64)
    try:
        return rough_box(numpy.array(film, numpy.float64), places, margin, limits)
    except RoughPointsError as error:
        raise StepFailedError(Errors.DEGENERATE_GCPS, "the rough points lie on one place: spread them over the city") from error


def _cut(ctx: JobContext, georef: GeorefInfo, scan: ScanInfo, whole: WholeFrame) -> tuple[GeorefInfo, ScanInfo]:
    film = _on_film(georef.gcps, scan, whole)
    layout = _layout(ctx)
    left, top, right, bottom = _box(ctx, georef.gcps, film, layout)
    crop = within_limits(Crop(left, top, right - left, bottom - top, ()))
    ctx.unstage(scan.path)
    local = gdal_step(ctx, lambda: write_crop(ctx, layout, crop, ctx.local("scan.tif")), "crop the frame")
    cut = gdal_step(ctx, lambda: publish_scan(ctx, local), "read the crop")
    ctx.staged[cut.path] = local
    moved = tuple(replace(gcp, x=x - left, y=y - top) for gcp, (x, y) in zip(georef.gcps, film, strict=True))
    placed = replace(georef, gcps=moved)
    ctx.update_version({"scan": cut.as_record(), "georef": placed.as_record()})
    ctx.log.info(
        f"the {len(moved)} rough points on the whole frame: film columns {left} to {right}, rows {top} to {bottom} "
        f"are cropped at full resolution ({cut.width} x {cut.height} px), {whole.factor} times the scan they were placed on",
        STEP,
    )
    delete_delivery(ctx)
    return placed, cut
