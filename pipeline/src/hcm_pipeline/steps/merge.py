"""`merge`: the used frames warped and composited into `warped.tif` (docs/research/M8-join-interfaces.md §3).

Each part goes from its own `scan.tif` through its plan, one resample only, at the camera's zoom, one at a time. Tones are evened
out on a small level, the owners give the weights, and the blocks are composited with one block in memory. The result is grey and
last-band alpha like a `warp`'s, so `export` and `register` run unchanged; its alpha counts the union once, so the compute-unit
estimate is right. The report (`version.join`) names the worst frame's own checkpoint figures: **joining does not improve them**.
"""

from collections.abc import Sequence
from functools import partial
from pathlib import Path
from typing import Final

import cv2
import numpy

from hcm_pipeline.documents import JoinReport, city_bounds
from hcm_pipeline.geo import Grid, MercatorBox, ground_scale, zoom_resolution
from hcm_pipeline.images import UInt8Array, as_uint8
from hcm_pipeline.jobs import Done, JobContext, StepResult
from hcm_pipeline.join.canvas import OWNER_ZOOM, TONE_ZOOM, DatasetSource, Raster, level_grid, spilled
from hcm_pipeline.join.compose import Layer, Levels, closes, compose, half_widths, weight_of
from hcm_pipeline.join.deepest import deepest_zoom
from hcm_pipeline.join.plan import OWNER_FILE, PLAN_FILE, JoinPlan, Part, PlannedSeam, read_parts, used_parts
from hcm_pipeline.join.room import needed_to_merge, require_room, scan_sizes, window_px
from hcm_pipeline.join.seams import pair_boundary
from hcm_pipeline.join.tone import Tone, ToneSeam, owned_most, plan_tones
from hcm_pipeline.join.warping import Warper
from hcm_pipeline.model import JoinParams
from hcm_pipeline.rasters import read_band
from hcm_pipeline.steps.common import gdal_step

TONE_STEP: Final = 1 << (OWNER_ZOOM - TONE_ZOOM)
COVERAGE_SAMPLE_PX: Final = 2048
PERCENT: Final = 100.0


def _tone_seams(owner: UInt8Array, seams: Sequence[PlannedSeam], cell_m: float) -> list[ToneSeam]:
    """The seams with each tone cell's ground distance from them (measured on the owner level, then taken every other cell)."""
    found = []
    for seam in seams:
        away = numpy.asarray(cv2.distanceTransform(as_uint8(~pair_boundary(owner, seam.a, seam.b)), cv2.DIST_L2, cv2.DIST_MASK_PRECISE))
        found.append(ToneSeam(seam.a, seam.b, away[::TONE_STEP, ::TONE_STEP].astype(numpy.float64) * cell_m))
    return found


def worst_figures(parts: Sequence[Part]) -> tuple[float | None, int]:
    """The worst frame's own checkpoint RMSE (unknown when any frame's is) and the lowest count: never pooled, which would flatter."""
    lowest = min(part.checkpoint_count for part in parts)
    figures = [part.checkpoint_rmse_m for part in parts]
    return (None if None in figures else max(_known(figures))), lowest


def _known(figures: Sequence[float | None]) -> list[float]:
    return [figure for figure in figures if figure is not None]


def city_part(grid: Grid, city: MercatorBox) -> tuple[int, int, int, int] | None:
    """The grid's pixels (left, top, width, height) over the city's bounds; None when it holds none of them."""
    u, v = grid.to_pixel(numpy.array([city.left, city.right]), numpy.array([city.top, city.bottom]))
    x0, y0 = max(0, int(u[0])), max(0, int(v[0]))
    width, height = min(grid.width, int(u[1])) - x0, min(grid.height, int(v[1])) - y0
    return None if width <= 0 or height <= 0 else (x0, y0, width, height)


def coverage_pct(mosaic: DatasetSource, grid: Grid, city: MercatorBox) -> float:
    """The share of the city's bounds under the raster's alpha, on a sample at most `COVERAGE_SAMPLE_PX` a side, over the **whole
    city's** area: a crop's grid holds only part of it, and dividing by that part inflated its figure (M9 §0). At most 100: the
    pixels whole cover can exceed the city's fractional span, and the schema every reader validates with stops at 100."""
    part = city_part(grid, city)
    if part is None:
        return 0.0
    x0, y0, width, height = part
    scale = min(1.0, COVERAGE_SAMPLE_PX / max(width, height, 1))
    alpha = mosaic.alpha_of(x0, y0, width, height, (max(1, round(width * scale)), max(1, round(height * scale))))
    share = float(numpy.count_nonzero(alpha)) / max(alpha.size, 1)
    u, v = grid.to_pixel(numpy.array([city.left, city.right]), numpy.array([city.top, city.bottom]))
    whole = max(float(u[1] - u[0]) * float(v[1] - v[0]), 1.0)
    return min(share * (width * height) / whole * PERCENT, PERCENT)


def _read_plan(ctx: JobContext) -> tuple[JoinPlan, UInt8Array]:
    plan = JoinPlan.read(ctx.stage(ctx.work_file(PLAN_FILE), PLAN_FILE))
    return plan, as_uint8(read_band(ctx.stage(ctx.work_file(OWNER_FILE), OWNER_FILE)))


def _layers(ctx: JobContext, owner: UInt8Array, plan: JoinPlan, sources: Sequence[DatasetSource], tones: Sequence[Tone]) -> list[Layer]:
    """Each part's weight, tones and cover, kept in scratch files (`spilled`): with 64 parts they would not fit in memory."""
    cell_m = zoom_resolution(OWNER_ZOOM) * ground_scale(plan.box.bounds().middle_lat)
    grid = level_grid(plan.box, OWNER_ZOOM)
    widths = half_widths(owner, [(seam.a, seam.b, seam.report) for seam in plan.seams], cell_m)
    return [
        Layer(
            source,
            Tone(tone.line, numpy.asarray(spilled(ctx.local(f"tone-{index}.npy"), tone.field), numpy.float32)),
            numpy.asarray(spilled(ctx.local(f"weight-{index}.npy"), weight_of(owner, index, widths, cell_m)), numpy.float32),
            numpy.asarray(spilled(ctx.local(f"covers-{index}.npy"), source.averaged(grid).alpha > 0), numpy.bool_),
        )
        for index, (source, tone) in enumerate(zip(sources, tones, strict=True))
    ]


class MergeStep:
    name = "merge"

    def run(self, ctx: JobContext) -> StepResult:
        plan, owner = _read_plan(ctx)
        parts = used_parts(read_parts(ctx), plan)
        require_room(ctx, needed_to_merge(scan_sizes(ctx, parts), window_px(ctx, plan.box)))
        warper = Warper(ctx, plan.box)
        grid = level_grid(plan.box, self._zoom(ctx, warper, parts, plan))
        files = [warper.rendered(part, planned.nodes, grid) for part, planned in zip(parts, plan.parts, strict=True)]
        ground = ground_scale(plan.box.bounds().middle_lat)
        sources = [gdal_step(ctx, partial(DatasetSource, file), "read a warped frame") for file in files]
        tones = gdal_step(ctx, lambda: self._tones(owner, plan, sources, ground), "even out the tones")
        layers = gdal_step(ctx, lambda: _layers(ctx, owner, plan, sources, tones), "weigh the frames")
        target = ctx.local("warped.tif")
        levels = Levels(zoom_resolution(OWNER_ZOOM) / grid.resolution, zoom_resolution(TONE_ZOOM) / grid.resolution)
        gdal_step(ctx, lambda: compose(target, grid, layers, levels, lambda done: self._tick(ctx, done)), "composite the frames")
        self._cleared(sources, files)
        report = self._report(ctx, plan, parts, grid, target)
        ctx.update_version({"join": report.as_record()})
        self._log(ctx, plan, report)
        return Done(ctx.publish(target, ctx.work_file("warped.tif"), "image/tiff"))

    def _zoom(self, ctx: JobContext, warper: Warper, parts: Sequence[Part], plan: JoinPlan) -> int:
        """A camera's join at its zoom; an archive join as deep as its parts' originals hold (`join/deepest.py`)."""
        params = JoinParams.of(ctx.job.params)
        if params.sensor is not None:
            return params.maxzoom
        planned = [(part, entry.nodes) for part, entry in zip(parts, plan.parts, strict=True)]
        return deepest_zoom(ctx, warper, planned, plan.box, params.maxzoom)

    def _tick(self, ctx: JobContext, done: float) -> None:
        ctx.flags.progress_within(done)
        ctx.checkpoint()

    def _tones(self, owner: UInt8Array, plan: JoinPlan, sources: Sequence[DatasetSource], ground: float) -> list[Tone]:
        grid = level_grid(plan.box, TONE_ZOOM)
        small: list[Raster] = [source.averaged(grid) for source in sources]
        seams = _tone_seams(owner, plan.seams, zoom_resolution(OWNER_ZOOM) * ground)
        return plan_tones(small, seams, owned_most(owner, len(sources)), grid.resolution * ground)

    def _cleared(self, sources: Sequence[DatasetSource], files: Sequence[Path]) -> None:
        """Each warped part gone: the scratch folder may be memory, and `export` is next."""
        for source in sources:
            source.close()
        for file in files:
            file.unlink(missing_ok=True)

    def _report(self, ctx: JobContext, plan: JoinPlan, parts: Sequence[Part], grid: Grid, target: Path) -> JoinReport:
        record = ctx.read(f"cities/{ctx.city}") or {}
        mosaic = DatasetSource(target)
        coverage = coverage_pct(mosaic, grid, city_bounds(record).mercator())
        mosaic.close()
        rmse, count = worst_figures(parts)
        return JoinReport(tuple(seam.report for seam in plan.seams), plan.omitted, coverage, count, plan.max_shift_m, rmse)

    def _log(self, ctx: JobContext, plan: JoinPlan, report: JoinReport) -> None:
        for seam in plan.seams:
            width = "48 m blend" if closes(seam.report) else "12 m cut"
            ctx.log.info(f"seam {seam.report.a} and {seam.report.b}: {width}", self.name)
        ctx.log.info(f"covers {report.coverage_pct:.1f} % of the city, largest shift {report.max_shift_m:.1f} m", self.name)
