"""The parts record of a series parked before its canvas wrote one (docs/research/M20-import-local.md §19.18).

A series that waited for points before the parts record existed kept only its `stitched.tif`. When the owner's pairs place it, the
record is rebuilt from the same deterministic layout that made the picture (`help.stitched.method`): a grid's mosaic from the sheets'
names and frames, an atlas's pages by their edges or overlaps, pieces by their overlaps, the tiles on an overview, or an automatic
layout by names and seams. The layout is computed, never pasted. A record whose canvas does not have the picture's shape (to
`fullres.SHAPE_SLACK`) is not used: the layout no longer matches what the owner placed points on, and the picture is warped as it is.
"""

from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Final

from hcm_pipeline.jobs import JobContext, StepFailedError
from hcm_pipeline.placing import autoplace, fullres, fullres_parts, grid, maps, owner_layout
from hcm_pipeline.placing.autostitch import CANVAS_MAX_PX
from hcm_pipeline.placing.series import SeriesJob, series_of

NOT_REBUILT: Final = "the parts of this picture could not be rebuilt: the stitched picture is warped as it is"


def _grid(_ctx: JobContext, series: SeriesJob) -> fullres.Recorded | None:
    read = grid.parsed(series)
    rectified = [] if read.scheme is None else grid.framed(read.cells, read.scheme)
    if read.scheme is None or not rectified:
        return None
    return grid.mosaic_of(rectified, read.scheme, grid.quarter_order(rectified, read.scheme)).record


def _atlas(_ctx: JobContext, series: SeriesJob) -> fullres.Recorded | None:
    parts = maps.atlas_parts(series.sheets)
    return fullres.Recorded(parts.originals, parts.layout.size)


def _pieces(_ctx: JobContext, series: SeriesJob) -> fullres.Recorded | None:
    parts = maps.pieces_parts(series.sheets)
    return None if parts is None else fullres.Recorded(parts.originals, parts.layout.size)


def _overview(ctx: JobContext, series: SeriesJob) -> fullres.Recorded | None:
    made = maps.overview_mosaic(ctx, series)
    return None if made is None else fullres.Recorded(made.originals, (made.canvas.shape[1], made.canvas.shape[0]))


def _owner(ctx: JobContext, series: SeriesJob) -> fullres.Recorded | None:
    """The owner's layout (`help.layoutAnswer`), each sheet as its mosaic placed it (lesson of 2026-11-24)."""
    answer = owner_layout.answer_of(ctx)
    if answer is None:
        return None
    tiles, size = owner_layout.owner_proposal(autoplace.named_of(series.sheets), answer).tiles(CANVAS_MAX_PX)
    return fullres.Recorded(tuple(fullres_parts.tile_part(tile) for _index, tile in tiles), size)


def _names(ctx: JobContext, series: SeriesJob) -> fullres.Recorded | None:
    tiles, size = autoplace.proposed(ctx, series).tiles(CANVAS_MAX_PX)
    return fullres.Recorded(tuple(fullres_parts.tile_part(tile) for _index, tile in tiles), size)


BUILDERS: Final[Mapping[str, Callable[[JobContext, SeriesJob], fullres.Recorded | None]]] = {
    "grid": _grid,
    "atlas": _atlas,
    "pieces": _pieces,
    "overview": _overview,
    "names": _names,
    "owner": _owner,
}


def _method(ctx: JobContext) -> str:
    help_item = (ctx.services.store.get(ctx.version_path()) or {}).get("help")
    stitched = help_item.get("stitched") if isinstance(help_item, Mapping) else None
    return str(stitched.get("method")) if isinstance(stitched, Mapping) else ""


def _built(ctx: JobContext, builder: Callable[[JobContext, SeriesJob], fullres.Recorded | None]) -> fullres.Recorded | None:
    series = maps.paged(ctx, series_of(ctx))
    return builder(ctx, series) if isinstance(series, SeriesJob) else None


def _found(ctx: JobContext) -> fullres.Recorded | None:
    """The record from the layout `help.stitched.method` names, else None (logged when the series cannot be read again)."""
    return built_by(ctx, _method(ctx))


def built_by(ctx: JobContext, method: str) -> fullres.Recorded | None:
    """The record from the layout `method` names (`ctx.job` names the series), else None (logged when it cannot be read again)."""
    builder = BUILDERS.get(method)
    try:
        return None if builder is None else _built(ctx, builder)
    except (StepFailedError, RuntimeError, OSError) as error:
        ctx.log.warn(f"the series' layout could not be read again ({error})", ctx.step)
        return None


def rebuilt(ctx: JobContext, picture: Path, size: tuple[int, int]) -> bool:
    """The picture's parts record rebuilt beside it from its series' layout; False (logged) when it cannot be."""
    found = _found(ctx)
    if found is None or not found.parts or not fullres.same_shape(found.size, size):
        ctx.log.info(NOT_REBUILT, ctx.step)
        return False
    fullres.write_parts(picture, found.parts, found.size)
    ctx.log.info(f"the parts of this picture rebuilt from its layout: {len(found.parts)} originals", ctx.step)
    return True
