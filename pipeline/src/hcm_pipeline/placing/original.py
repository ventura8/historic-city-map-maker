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
from hcm_pipeline.jobs import JobContext
from hcm_pipeline.placing.raster_io import tiled_copy
from hcm_pipeline.placing.series import series_of
from hcm_pipeline.steps.gather import text_param

ORIGINAL: Final = "original.tif"
SINGLE: Final = "single"
ARCHIVE_JOB: Final = "archive-series"


def _raster(path: Path) -> bool:
    return path.is_file() and sniff_file(path) != "pdf"


def _single(ctx: JobContext) -> bool:
    return ctx.services.archive_root is not None and text_param(ctx.job.params, "class") == SINGLE


def single_original(ctx: JobContext) -> Path | None:
    """The job's single map's original as a tiled copy, else None (`ctx.job` is the archive series' own job)."""
    sheets = series_of(ctx).sheets if _single(ctx) else ()
    return tiled_copy(sheets[0].path, ctx.local(ORIGINAL)) if sheets and _raster(sheets[0].path) else None


# A regeoref of a regeoref (points saved again on a version awaiting approval) reaches the archive job through at most this many.
CHAIN_MAX: Final = 8


def _job(ctx: JobContext, job_id: str) -> tuple[object, dict[str, object]]:
    """A job's type and parameters (empty when it has none)."""
    base = ctx.services.store.get(f"cities/{ctx.city}/jobs/{job_id}") or {}
    params = base.get("params")
    return base.get("type"), params if isinstance(params, dict) else {}


def _archive_base(ctx: JobContext, job_id: str, depth: int = CHAIN_MAX) -> tuple[str, dict[str, object]] | None:
    """The archive series' job a chain of `regeoref` jobs starts from, with its parameters; None when it starts elsewhere."""
    kind, params = _job(ctx, job_id)
    if kind == ARCHIVE_JOB:
        return job_id, params
    following = params.get("basedOn") if kind == "regeoref" and depth > 1 else None
    return _archive_base(ctx, following, depth - 1) if isinstance(following, str) else None


def based_original(ctx: JobContext) -> Path | None:
    """A `regeoref` job's base archive single map's original, else None: the base job's parameters and sheets are its own."""
    based_on = ctx.job.params.get("basedOn") if ctx.job.type == "regeoref" else None
    found = _archive_base(ctx, based_on) if isinstance(based_on, str) and ctx.services.archive_root is not None else None
    return None if found is None else single_original(replace(ctx, job=replace(ctx.job, id=found[0], params=found[1])))
