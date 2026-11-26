"""A redraw's parts record rebuilt from its series' layout (2026-11-24, docs/LESSONS.md 799).

Redraw at full resolution of a stitched series looks for the series' parts record in the versions it was drawn from (`steps/warp.py`
`record_paths`). A series placed before records existed (1895-1899) has none; its job then carries the layout the series was placed
by (`layout`: the method, encoding, grid and published zoom, copied by `functions/src/imagery/redraw-layout.ts`, as a worker reads
no other version or job). The series' sheets are read as a join's are (this computer's archive, or the holder's copy through the
bucket, `archive/copy.py`), the layout is computed again (`placing/rebuild.py`, never pasted), and the record is written beside the
scan when its canvas has the scan's shape. Anything else returns False and the redraw fails plainly (`apiError.imagery.originalMissing`).
"""

from collections.abc import Mapping
from dataclasses import replace
from pathlib import Path

from hcm_pipeline.jobs import JobContext, StepFailedError
from hcm_pipeline.placing import fullres, rebuild
from hcm_pipeline.steps.gather import SHEETS, sheets_of, store_of, write_sheets


def layout_of(ctx: JobContext) -> Mapping[str, object] | None:
    """The redraw's layout parameter, else None (not a redraw, or a job made before it carried one)."""
    layout = ctx.job.params.get("layout")
    redraw = ctx.job.params.get("fullResolution") is True
    return layout if redraw and isinstance(layout, Mapping) else None


def _series_params(ctx: JobContext, layout: Mapping[str, object]) -> dict[str, object]:
    params = ctx.job.params
    grid = {"gridId": layout["gridId"]} if isinstance(layout.get("gridId"), str) else {}
    series = {"archiveId": params.get("originalArchiveId"), "seriesId": params.get("originalSeriesId")}
    return {**series, "encoding": layout.get("encoding"), **grid}


def _series_ctx(ctx: JobContext, layout: Mapping[str, object]) -> JobContext | None:
    """The job seen as its series' (its sheets written here), else None when they cannot be read on this computer."""
    params = _series_params(ctx, layout)
    try:
        sheets = sheets_of(store_of(ctx), str(params["archiveId"]), str(params["seriesId"]))
    except StepFailedError as error:
        ctx.log.warn(f"the series' sheets are not on this computer ({error})", ctx.step)
        return None
    write_sheets(ctx.local(SHEETS), sheets)
    return replace(ctx, job=replace(ctx.job, params=params))


def _found(ctx: JobContext, layout: Mapping[str, object]) -> fullres.Recorded | None:
    series = _series_ctx(ctx, layout)
    return None if series is None else rebuild.built_by(series, str(layout.get("method")))


def rebuilt_record(ctx: JobContext, scan: Path, size: tuple[int, int]) -> bool:
    """The scan's parts record rebuilt beside it from the redraw's layout; False (logged) when it cannot be."""
    layout = layout_of(ctx)
    if layout is None:
        return False
    found = _found(ctx, layout)
    if found is None or not found.parts or not fullres.same_shape(found.size, size):
        ctx.log.info(rebuild.NOT_REBUILT, ctx.step)
        return False
    fullres.write_parts(scan, found.parts, found.size)
    width, height = found.size
    ctx.log.info(
        f"the parts record rebuilt from the series' {layout.get('method')} layout: {len(found.parts)} originals, {width} x {height} px",
        ctx.step,
    )
    return True
