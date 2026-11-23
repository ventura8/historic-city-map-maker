"""A single archive map's original at full resolution, for the warps that would otherwise read a reduced picture (docs/LESSONS.md 762).

A single map that waited for points keeps only its working copy (at most `LARGEST_WORKING_PX` long) as `stitched.tif`, and the
georeferencer's `scan` is smaller still. `place` from the owner's pairs (`placing/owner.py`) and a later `regeoref` (`steps/warp.py`,
the points saved again on a version awaiting approval) both warp the original instead: a tiled copy in the scratch folder
(`raster_io.tiled_copy`, streamed by GDAL). Only on the computer that holds the archive; anywhere else, or for another class, a PDF,
or an original that is gone, the caller keeps its own picture.
"""

from dataclasses import replace
from pathlib import Path
from typing import Final

from hcm_pipeline.archive.magic import sniff_file
from hcm_pipeline.documents import Version
from hcm_pipeline.jobs import JobContext, StepFailedError
from hcm_pipeline.placing.raster_io import tiled_copy
from hcm_pipeline.placing.series import series_of
from hcm_pipeline.steps.gather import SHEETS, sheets_of, store_of, text_param, write_sheets

ORIGINAL: Final = "original.tif"
SINGLE: Final = "single"


def _raster(path: Path) -> bool:
    return path.is_file() and sniff_file(path) != "pdf"


def _single(ctx: JobContext) -> bool:
    return ctx.services.archive_root is not None and text_param(ctx.job.params, "class") == SINGLE


def single_original(ctx: JobContext, name: str = ORIGINAL) -> Path | None:
    """The job's single map's original as a tiled copy named `name`, else None (`ctx.job` is the archive series' own job)."""
    sheets = series_of(ctx).sheets if _single(ctx) else ()
    return tiled_copy(sheets[0].path, ctx.local(name)) if sheets and _raster(sheets[0].path) else None


def _single_params(ctx: JobContext) -> dict[str, object] | None:
    """A `regeoref` of an archive single map: its series as the version's `source` names it (copied from the archive version), on the
    computer that holds the archive; else None. A worker may read only its own job (`apiError.worker.refused`, the live 1:2000), so
    nothing of the base job is read."""
    return _version_params(ctx, ctx.version) if ctx.job.type == "regeoref" else None


def _version_params(ctx: JobContext, version: Version) -> dict[str, object] | None:
    """The version's archive single map as series parameters, on the computer that holds the archive; else None."""
    source = version.source
    single = source.get("kind") == "archive" and source.get("sheetCount") == 1
    if not single or ctx.services.archive_root is None:
        return None
    return {"archiveId": source.get("archiveId"), "seriesId": source.get("seriesId"), "class": SINGLE}


def _copied(ctx: JobContext, version: Version, params: dict[str, object] | None, name: str) -> Path | None:
    if params is None:
        return None
    try:
        sheets = sheets_of(store_of(ctx), text_param(params, "archiveId"), text_param(params, "seriesId"))
    except StepFailedError as error:
        ctx.log.warn(f"the original of {version.id} is not on this computer ({error}): the scan is warped", ctx.step)
        return None
    write_sheets(ctx.local(SHEETS), sheets)
    return single_original(replace(ctx, job=replace(ctx.job, params=params)), name)


def based_original(ctx: JobContext) -> Path | None:
    """A `regeoref` job's archive single map's original, its sheets read and checked from this computer's archive; else None."""
    return _copied(ctx, ctx.version, _single_params(ctx), ORIGINAL)


def version_original(ctx: JobContext, version: Version) -> Path | None:
    """Any version's archive single map's original (a join's part, M8 §3), as `<version>-original.tif`; else None."""
    return _copied(ctx, version, _version_params(ctx, version), f"{version.id}-{ORIGINAL}")
