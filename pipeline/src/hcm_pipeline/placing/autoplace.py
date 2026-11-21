"""An automatic layout mosaicked and placed, or kept for its owner (docs/research/M20-import-local.md §19.6, §19.7).

`mosaicked` writes the canvas window by window (`canvas_window`) and places it as one map; when that map waits for points, its picture
is kept as the stitched one with the layout's files. `wait_layout` does not mosaic: it renders a preview of the proposal (at most
`SCAN_MAX_PX`, the georeferencer's scan) and the version waits with `layout-check` for its owner to check the layout in the tile wizard.
"""

from collections.abc import Sequence
from pathlib import Path, PurePosixPath
from typing import Final

from hcm_pipeline.jobs import JobContext, StepResult, Waiting
from hcm_pipeline.placing.autostitch import CANVAS_MAX_PX, Proposal, propose
from hcm_pipeline.placing.canvas_window import Canvas, render
from hcm_pipeline.placing.layout_files import publish_layout, revision_of
from hcm_pipeline.placing.raster_io import read_working
from hcm_pipeline.placing.series import SeriesJob, Sheet
from hcm_pipeline.placing.single import drawn_of, place_map
from hcm_pipeline.placing.stitched import SCAN_MAX_PX, Stitched, publish_stitched, wait_stitched

CANVAS: Final = "canvas.tif"
PREVIEW: Final = "layout-preview.tif"
LAYOUT_CHECK: Final = "layout-check"
NOTE_CHECK: Final = "The pages' layout needs your check: open Help calibrate, move the pages that are off, then accept the layout."


def named_of(sheets: Sequence[Sheet]) -> list[tuple[str, Path]]:
    """Each part's name for its grid (its path in the archive when known, a PDF page's number) and its scan."""
    return [(sheet.relative or sheet.name, sheet.path) for sheet in sheets]


def proposed(ctx: JobContext, series: SeriesJob) -> Proposal:
    proposal = propose(named_of(series.sheets))
    quality = proposal.quality
    ctx.log.info(
        f"laid out by {proposal.grid.source} and seams: {len(proposal.solved.positions)} of {len(series.sheets)} placed, "
        f"seams {quality.seam_median:.2f}, rms {quality.seam_rms_px:.1f} px: {quality.verdict}",
        ctx.step,
    )
    return proposal


def _revision(ctx: JobContext, revision: int | None) -> int:
    """The layout's revision: the one given (an owner's answer's next), else one more than the version's current layout's."""
    return revision if revision is not None else revision_of(ctx.services.store.get(ctx.version_path()) or {})


def _stitched(ctx: JobContext, proposal: Proposal, canvas: Path, method: str, revision: int | None) -> Stitched:
    working = read_working(canvas, SCAN_MAX_PX)
    parts = proposal.plan.parts
    left = tuple((PurePosixPath(parts[index].name).name, reason) for index, reason in sorted(proposal.left_out.items()))
    layout = publish_layout(ctx, proposal, _revision(ctx, revision))
    return Stitched(working.image, method, len(parts), left, pairs_scale=1 / working.scale, layout=layout)


def _canvas(ctx: JobContext, proposal: Proposal, name: str, longest: int, colour: bool) -> tuple[Path, int, int]:
    tiles, size = proposal.tiles(longest)
    path = render([tile for _index, tile in tiles], Canvas(ctx.local(name), size, colour))
    return path, len(tiles), max(size)


def mosaicked(ctx: JobContext, series: SeriesJob, proposal: Proposal, methods: tuple[str, str], revision: int | None = None) -> StepResult:
    """The layout mosaicked and placed as one map (`methods`: how it is placed, how it was stitched); its picture kept when it waits."""
    path, placed, longest = _canvas(ctx, proposal, CANVAS, CANVAS_MAX_PX, series.colour)
    result = place_map(ctx, series, drawn_of(path, methods[1], longest, framed=False), methods[0], placed)
    if isinstance(result, Waiting):
        ctx.update_version({"help.stitched": publish_stitched(ctx, _stitched(ctx, proposal, path, methods[1], revision))})
    return result


def wait_layout(ctx: JobContext, series: SeriesJob, proposal: Proposal, method: str = "names", revision: int | None = None) -> Waiting:
    """The proposal kept for its owner: a preview of it, its files, and the version waiting with `layout-check`."""
    path, _placed, _longest = _canvas(ctx, proposal, PREVIEW, SCAN_MAX_PX, series.colour)
    return wait_stitched(ctx, _stitched(ctx, proposal, path, method, revision), LAYOUT_CHECK, NOTE_CHECK)
