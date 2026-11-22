"""The placers of drawn maps (docs/research/M20-import-local.md §3 c, *Atlases and pieces*, *PDFs*): single, atlas and pieces.

A single map is placed by its streets as it is. An atlas's pages (image files, or a PDF's pages taken out with pikepdf) and overlapping
pieces are first assembled into one canvas in the job's scratch folder (`assemble`, `joins`), then placed as one map: many junctions
over the whole city are far stronger than page by page. Pieces are joined by their features at a higher resolution (`joins`); when the
archive holds a complete smaller-scale overview of the same area, pieces are laid on that overview first (`overview_find`) and that
mosaic is the series' picture. An atlas's pages join by their edges, or by their overlaps when those join more pages (M22 §4.1). A PDF
that needs a password waits for a person (`low-confidence`: the owner exports its pages). Pages or pieces that join nothing are left
out: the job's log says how many, and the version's placed count leaves them out. A map or canvas that is not placed on its own is kept
as the one stitched picture the Help calibrate wizard places (`stitched`), with the parts left out and why. Every placer swaps a PDF for its
pages before it reads anything, the overview search included: GDAL never opens a PDF (the 1923 plan-ghid atlas failed there, 2026-11-12).
"""

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Final

import numpy

from hcm_pipeline.archive import model
from hcm_pipeline.archive.magic import sniff_file
from hcm_pipeline.jobs import JobContext, StepResult, Waiting
from hcm_pipeline.placing import assemble, autoplace, autostitch, fullres, joins, owner_layout
from hcm_pipeline.placing.output import wait_for_help
from hcm_pipeline.placing.overview import MosaicReport
from hcm_pipeline.placing.overview_find import CanvasOpts, find_overview, overview_canvas
from hcm_pipeline.placing.pdfpages import extract_pages
from hcm_pipeline.placing.raster_io import read_working
from hcm_pipeline.placing.series import SeriesJob, Sheet, series_of
from hcm_pipeline.placing.single import LARGEST_WORKING_PX, Drawn, drawn_of, place_map
from hcm_pipeline.placing.stitched import NO_JOIN, JoinQuality, Stitched, publish_stitched
from hcm_pipeline.placing.streets import UInt8Array
from hcm_pipeline.steps.gather import store_of, text_param

PDF_LOCKED: Final = "This PDF needs a password: export its pages as images from a PDF reader, then import them."
NO_PAGES: Final = "No page of this series could be laid out: add about four points on its pages, or import them as single maps."
CANVAS: Final = "canvas.tif"


def _pdf_pages(ctx: JobContext, sheet: Sheet) -> list[Sheet] | None:
    pages = extract_pages(sheet.path, ctx.local("pages"))
    if pages is None:
        return None
    return [Sheet(path, f"{sheet.name} p{index}", str(index)) for index, path in enumerate(pages.files, start=1)]


def expanded(ctx: JobContext, sheets: Sequence[Sheet]) -> list[Sheet] | None:
    """The series' parts with each PDF replaced by its pages; None when a PDF needs a password."""
    found: list[Sheet] = []
    for sheet in sheets:
        pages = _pdf_pages(ctx, sheet) if sniff_file(sheet.path) == "pdf" else [sheet]
        if pages is None:
            return None
        found.extend(pages)
    return found


def paged(ctx: JobContext, series: SeriesJob) -> SeriesJob | str:
    """The series with each PDF swapped for its pages, or why it cannot be laid out (a password PDF, no page at all)."""
    sheets = expanded(ctx, series.sheets)
    if not sheets:
        return PDF_LOCKED if sheets is None else NO_PAGES
    return replace(series, sheets=tuple(sheets))


def _drawn(path: Path, canvas: UInt8Array, name: str) -> Drawn:
    return drawn_of(path, name, max(canvas.shape[:2]), framed=False)


@dataclass(frozen=True)
class Assembled:
    """A canvas made of a series' parts: the picture, its layout, the parts' names, how, and the joins' quality."""

    canvas: UInt8Array
    layout: assemble.Layout
    names: tuple[str, ...]
    method: str
    quality: JoinQuality | None = None
    # Each part's original to the canvas (`fullres`): the published map is warped from them, never from this reduced canvas.
    originals: tuple[fullres.Part, ...] = ()

    def stitched(self) -> Stitched:
        left_out = tuple((self.names[index], NO_JOIN) for index in self.layout.left_out)
        return Stitched(self.canvas, self.method, len(self.names), left_out, joins=self.quality)


def _assembled(ctx: JobContext, series: SeriesJob, made: Assembled) -> StepResult:
    """The canvas placed as one map; when it waits for a person, its stitched picture goes with it."""
    layout = made.layout
    ctx.log.info(f"assembled {len(layout.placed)} parts, {len(layout.left_out)} left out, {layout.holes} holes", ctx.step)
    # Written once: the placing reads this file, and a series that waits for a person publishes it as its stitched picture.
    path = assemble.write_canvas(ctx.local(CANVAS), made.canvas)
    if made.originals:
        fullres.write_parts(path, made.originals, layout.size)
    result = place_map(ctx, series, _drawn(path, made.canvas, made.method), made.method, len(layout.placed))
    if isinstance(result, Waiting):
        ctx.update_version({"help.stitched": publish_stitched(ctx, made.stitched(), path)})
    return result


class SinglePlacer:
    """Class c: one map (a raster, or a one-page PDF)."""

    def place(self, ctx: JobContext) -> StepResult:
        series = series_of(ctx)
        sheets = expanded(ctx, series.sheets[:1])
        if sheets is None:
            return wait_for_help(ctx, "low-confidence", PDF_LOCKED)
        if not sheets:
            return wait_for_help(ctx, "low-confidence", NO_PAGES)
        result = place_map(ctx, series, drawn_of(sheets[0].path, sheets[0].name))
        if isinstance(result, Waiting):
            working = read_working(sheets[0].path, LARGEST_WORKING_PX)
            stitched = Stitched(working.image, "single", 1, pairs_scale=1 / working.scale)
            ctx.update_version({"help.stitched": publish_stitched(ctx, stitched)})
        return result


def page_px(count: int) -> int:
    """How large each page is read so the assembled atlas stays within `CANVAS_MAX_PX` on its long side."""
    return max(assemble.PAGE_PX, assemble.CANVAS_MAX_PX // max(1, math.ceil(math.sqrt(count)) + 1))


class AtlasPlacer:
    """An atlas: the owner's layout when given; on an overview when the archive has one; else by its names and seams (M20 §19), by its
    edges or overlaps when those place nearly all of it, or kept for its owner (`layout-check`)."""

    def place(self, ctx: JobContext) -> StepResult:
        return _series_placed(ctx, "atlas", atlas_parts)


# The older joins (edges, overlaps) are used when the automatic layout is not good, they place at least this share of the parts, and
# something vouches for them: their matched features' residual and agreeing matches meet the layout's own bar, or, for pages joined by
# their edges alone (nothing measured), the layout was only `check`, never `poor` (M20 §19, the fallback).
LEGACY_SHARE: Final = 0.9
LEGACY_RMS_PX: Final = float(model.STITCH_GOOD_RMS_PX)
LEGACY_MIN_INLIERS: Final = 2 * joins.MIN_MATCHES
# A layout the tile wizard can open names at most this many sheets (`LAYOUT_SHEETS_MAX` of @hcm/shared); a larger series waits.
SHEETS_MAX: Final = model.LAYOUT_SHEETS_MAX
TOO_MANY: Final = f"This series has more than {SHEETS_MAX} pages: import it as smaller series, one per area."


@dataclass(frozen=True)
class Parts:
    """Parts joined by the older code: their canvas (composed only when it is used, a page at a time), layout and joins' quality (None
    when nothing joined)."""

    canvas: Callable[[], UInt8Array]
    layout: assemble.Layout
    quality: JoinQuality | None = None
    originals: tuple[fullres.Part, ...] = ()


def _series_placed(ctx: JobContext, method: str, legacy: Callable[[Sequence[Sheet]], Parts | None]) -> StepResult:
    """The fallback order of M20 §19: the owner's layout, the overview, names and seams, the older joins, the owner's check."""
    series = paged(ctx, series_of(ctx))
    if isinstance(series, str):
        return wait_for_help(ctx, "low-confidence", series)
    if len(series.sheets) > SHEETS_MAX:
        return wait_for_help(ctx, "no-path", TOO_MANY)
    return _laid_out(ctx, series, method, legacy)


def _laid_out(ctx: JobContext, series: SeriesJob, method: str, legacy: Callable[[Sequence[Sheet]], Parts | None]) -> StepResult:
    answer = owner_layout.answer_of(ctx)
    if answer is not None:
        return owner_layout.place(ctx, series, answer, method)
    overviewed = overview_mosaic(ctx, series)
    if overviewed is not None:
        return _assembled(ctx, series, overviewed)
    proposal = autoplace.proposed(ctx, series)
    if proposal.quality.verdict == "good":
        return autoplace.mosaicked(ctx, series, proposal, (method, "names"))
    return _legacy_or_wait(ctx, series, method, legacy, proposal)


def _legacy_or_wait(
    ctx: JobContext, series: SeriesJob, method: str, legacy: Callable[[Sequence[Sheet]], Parts | None], proposal: autostitch.Proposal
) -> StepResult:
    parts = legacy(series.sheets)
    names = tuple(sheet.name for sheet in series.sheets)
    if parts is None or not legacy_good(parts, len(names), proposal.quality.verdict):
        return autoplace.wait_layout(ctx, series, proposal)
    ctx.log.info(f"the {method}'s edges or overlaps place {len(parts.layout.placed)} of {len(names)} parts", ctx.step)
    return _assembled(ctx, series, Assembled(parts.canvas(), parts.layout, names, method, parts.quality, parts.originals))


def legacy_good(parts: Parts, count: int, verdict: str) -> bool:
    """True when the older joins place `LEGACY_SHARE` of the parts and are vouched for: their matches as tight as a good layout's, or,
    with nothing matched (edges alone), a layout that was only `check`."""
    quality = parts.quality
    tight = verdict == "check" if quality is None else quality.rms_px <= LEGACY_RMS_PX and quality.mean_inliers >= LEGACY_MIN_INLIERS
    return tight and len(parts.layout.placed) >= LEGACY_SHARE * count


def atlas_parts(sheets: Sequence[Sheet]) -> Parts:
    """The pages cropped to their frames and laid out on their median size by their edges, or by their overlaps when those join
    more pages."""
    pages, cell = _pages(sheets)
    layout = assemble.atlas_layout(pages.grey, cell)
    overlapping = _overlapping(sheets, len(layout.placed))
    if overlapping is not None:
        return _joined_parts(overlapping, [sheet.path for sheet in sheets])
    sizes = [(page.shape[1], page.shape[0]) for page in pages.grey]
    originals = fullres.layout_parts([sheet.path for sheet in sheets], layout.placed, pages.max_px, _crops(pages))
    return Parts(lambda: assemble.compose_parts(pages.page, sizes, pages.colour, layout), layout, None, originals)


def _crops(pages: assemble.Pages) -> list[tuple[int, int]]:
    """Each page's frame corner (working pixels): where its cropped picture starts."""
    return [(int(columns.start or 0), int(rows.start or 0)) for rows, columns in pages.boxes]


def _pages(sheets: Sequence[Sheet]) -> tuple[assemble.Pages, tuple[int, int]]:
    """The pages cropped to their frames, held grey, and their median size."""
    pages = assemble.Pages.read([sheet.path for sheet in sheets], page_px(len(sheets)))
    widths, heights = [page.shape[1] for page in pages.grey], [page.shape[0] for page in pages.grey]
    return pages, (int(numpy.median(widths)), int(numpy.median(heights)))


def _overlapping(sheets: Sequence[Sheet], by_edges: int) -> joins.Joined | None:
    """The pages joined by their overlaps when their edges left some out and the overlaps place more of them; else None."""
    if by_edges >= len(sheets):
        return None
    found = joins.joined([sheet.path for sheet in sheets])
    return found if found is not None and len(found.layout.placed) > by_edges else None


def _overview_layout(names: tuple[str, ...], report: MosaicReport, size: tuple[int, int]) -> assemble.Layout:
    """A layout that only records which parts landed on the overview (identity transforms; the canvas is already drawn)."""
    index = {name: position for position, name in enumerate(names)}
    left = tuple(index[name] for name in report.unplaced if name in index)
    kept = set(range(len(names))) - set(left)
    placed = {position: assemble.IDENTITY for position in kept}
    return assemble.Layout(placed, size, left, 0)


def _series_overview(ctx: JobContext, series: SeriesJob) -> Path | None:
    root = store_of(ctx).files(text_param(ctx.job.params, "archiveId"))
    return find_overview(root, [sheet.path for sheet in series.sheets])


def overview_mosaic(ctx: JobContext, series: SeriesJob) -> Assembled | None:
    """The series' mosaic on its archive overview, or None when no overview is found or too few tiles match."""
    overview = _series_overview(ctx, series)
    if overview is None:
        return None
    made = overview_canvas([(sheet.name, sheet.path) for sheet in series.sheets], overview, CanvasOpts(colour=series.colour))
    if made is None:
        return None
    canvas, report = made
    names = tuple(sheet.name for sheet in series.sheets)
    quality = JoinQuality(links=len(report.placed), mean_inliers=0.0, rms_px=report.rms_px)
    return Assembled(canvas, _overview_layout(names, report, (canvas.shape[1], canvas.shape[0])), names, "overview", quality)


def _joined_parts(found: joins.Joined, paths: Sequence[Path]) -> Parts:
    originals = fullres.layout_parts(paths, found.layout.placed, joins.CANVAS_PX)
    return Parts(lambda: assemble.compose_canvas(found.images, found.layout), found.layout, found.quality, originals)


def _pieces_parts(sheets: Sequence[Sheet]) -> Parts | None:
    found = joins.joined([sheet.path for sheet in sheets])
    return None if found is None else _joined_parts(found, [sheet.path for sheet in sheets])


class PiecesPlacer:
    """Overlapping pieces of one sheet: the owner's layout when given; on an overview when the archive has one; else by their names
    and seams (M20 §19), joined on their overlaps when those place nearly all of them, or kept for their owner (`layout-check`)."""

    def place(self, ctx: JobContext) -> StepResult:
        return _series_placed(ctx, "pieces", _pieces_parts)
