"""`align`: how far the frames of a join lie apart, and how to close that (docs/research/M8-join-interfaces.md §3).

Each part is warped small over the city's window; who owns each cell gives the seams; tiles along a seam give its offset, and
the offset shared between the parts gives their nodes. The parts are warped again through those nodes and the same tiles measured
once more: a seam the correction did not help keeps its parts as they were, because **no frame shifts unless the measurement says
it helped**. A join closes the gap only: it never improves where the frames are on the ground. The plan is a work file, so a retry
does not measure again.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Final

from hcm_pipeline.contract import Errors
from hcm_pipeline.documents import JoinSeam
from hcm_pipeline.geo import Grid, MercatorBox, ground_scale
from hcm_pipeline.jobs import Done, JobContext, StepFailedError, StepResult
from hcm_pipeline.join.canvas import COARSE_ZOOM, FINE_ZOOM, OWNER_ZOOM, DatasetSource, Raster, TileSource, aligned_box, level_grid
from hcm_pipeline.join.correction import BaseTransform, Node, SeamField, largest_move_m, nodes_for, share_of
from hcm_pipeline.join.measure import TOO_FAR_M, Measured, SeamModel, Shift, coarse_pass, held_out, measure_seam, rmse_m
from hcm_pipeline.join.plan import OWNER_FILE, PLAN_FILE, JoinPlan, Part, PlannedPart, PlannedSeam, read_parts
from hcm_pipeline.join.room import needed_to_align, require_room, scan_sizes, window_px
from hcm_pipeline.join.seams import Ownership, Sample, Seam, assign, find_seams
from hcm_pipeline.join.warping import Warper, node_reverse, part_size, part_transform
from hcm_pipeline.model import JoinParams
from hcm_pipeline.rasters import GeoTiff, write_geotiff
from hcm_pipeline.steps.common import city_window, gdal_step

MIN_PARTS: Final = 2
# A seam this close has nothing a correction could close (a fifth of a Sentinel-2 pixel): it stays as it is and counts as closed, or the
# best joins would wait for a click because nothing could improve them (found by S-P05-HAPPY-ADMIN once M9's maps agreed to 0.34 m).
SEAM_ALREADY_CLOSED_M: Final = 2.0
OWNER_STEP: Final = 1 << (COARSE_ZOOM - OWNER_ZOOM)


def _owned(previews: Sequence[Raster]) -> Ownership:
    return assign([preview.alpha[::OWNER_STEP, ::OWNER_STEP] for preview in previews])


@dataclass
class Aligning:
    """One run's parts (the kept ones, in `owner`'s order), their previews and warps."""

    ctx: JobContext
    warper: Warper
    parts: list[Part]
    previews: list[Raster]
    ground: float

    def share(self, seam: Seam) -> float:
        return share_of(self.parts[seam.a].checkpoint_rmse_m, self.parts[seam.b].checkpoint_rmse_m)

    def measure(self, seams: Sequence[Seam]) -> list[Measured]:
        """Each seam's passes; a pair too far apart ends the job. A scan another seam is about to read stays staged."""
        found = []
        for index, seam in enumerate(seams):
            found.append(self._measured(seam))
            self._release(seam, seams[index + 1 : index + 2])
        return found

    def _measured(self, seam: Seam) -> Measured:
        self.ctx.checkpoint()
        first, second = self.parts[seam.a], self.parts[seam.b]
        opened: list[DatasetSource] = []

        def sources() -> tuple[TileSource, TileSource, Grid]:
            opened.extend((self.warper.fine(first), self.warper.fine(second)))
            return opened[0], opened[1], level_grid(self.warper.box, FINE_ZOOM)

        measured = gdal_step(
            self.ctx,
            lambda: measure_seam(self.previews[seam.a], self.previews[seam.b], self.previews[0].grid, seam, sources),
            "read a seam",
        )
        for source in opened:
            source.close()
        if measured.coarse_m > TOO_FAR_M:
            names = {"a": first.entity_id, "b": second.entity_id}
            raise StepFailedError(Errors.JOIN_SEAM_TOO_FAR, f"{names['a']} and {names['b']} lie {measured.coarse_m:.0f} m apart", names)
        return measured

    def _release(self, seam: Seam, following: Sequence[Seam]) -> None:
        needed = {index for next_seam in following for index in (next_seam.a, next_seam.b)}
        for index in {seam.a, seam.b} - needed:
            self.warper.release(self.parts[index])

    def fields(self, measured: Sequence[Measured], applied: set[int]) -> list[list[SeamField]]:
        """Each part's fields: the shares of the applied seams' offsets, `a` moving forward along the offset and `b` back."""
        fields: list[list[SeamField]] = [[] for _ in self.parts]
        for seam, model in _models_of(measured, applied):
            share = self.share(seam)
            fields[seam.a].append(SeamField(seam, model, share))
            fields[seam.b].append(SeamField(seam, model, share - 1.0))
        return fields

    def nodes(self, bases: Sequence[BaseTransform], measured: Sequence[Measured], applied: set[int]) -> list[tuple[Node, ...]]:
        fields = self.fields(measured, applied)
        return [
            nodes_for(base, part_size(part, self.warper.box), field) for base, part, field in zip(bases, self.parts, fields, strict=True)
        ]

    def rewarped(self, nodes: Sequence[tuple[Node, ...]]) -> list[Raster]:
        """The previews again: a part with no nodes has not moved."""
        return [
            self.warper.preview(part, part_nodes) if part_nodes else preview
            for part, part_nodes, preview in zip(self.parts, nodes, self.previews, strict=True)
        ]


def _models_of(measured: Sequence[Measured], applied: set[int]) -> list[tuple[Seam, SeamModel]]:
    return [(item.seam, item.model) for index, item in enumerate(measured) if index in applied and item.model is not None]


def residuals(previews: Sequence[Raster], measured: Measured, ground: float) -> dict[Sample, Shift]:
    """The offsets left at the samples a seam is judged on."""
    seam = measured.seam
    return coarse_pass(previews[seam.a], previews[seam.b], previews[seam.a].grid, measured.judged(), ground)


def _paired_rmse(before: dict[Sample, Shift], after: dict[Sample, Shift], grid: Grid, ground: float) -> tuple[float, float] | None:
    """Before and after over the samples both found; None when none are."""
    common = before.keys() & after.keys()
    if not common:
        return None
    return rmse_m(_of(before, common), grid, ground), rmse_m(_of(after, common), grid, ground)


def _of(found: dict[Sample, Shift], samples: Iterable[Sample]) -> list[Shift]:
    return [found[sample] for sample in samples]


@dataclass(frozen=True)
class Verdict:
    """What the pixels say about a seam's correction."""

    before_m: float | None
    after_m: float | None

    @property
    def helped(self) -> bool:
        return self.before_m is not None and self.after_m is not None and self.after_m < self.before_m


def judge(before: Sequence[Raster], after: Sequence[Raster], measured: Measured, ground: float) -> Verdict:
    """The coarse pass again on the judged samples, over the parts as they were and as they are now."""
    found_before, found_after = residuals(before, measured, ground), residuals(after, measured, ground)
    pair = _paired_rmse(found_before, found_after, before[0].grid, ground)
    if pair is None:
        figure = rmse_m(list(found_before.values()), before[0].grid, ground) if found_before else None
        return Verdict(figure, None)
    return Verdict(*pair)


@dataclass(frozen=True)
class Settled:
    """The seams that stay applied, their verdicts and the parts' nodes."""

    applied: set[int]
    verdicts: dict[int, Verdict]
    nodes: list[tuple[Node, ...]]


def settle(run: Aligning, bases: Sequence[BaseTransform], measured: Sequence[Measured]) -> Settled:
    """Applies every measured seam, judges each on pixels, and starts again without those the correction did not help: the fields of
    several seams add up, so what is left is judged again. The verdict of a refused seam stays the one it was refused on."""
    applied = _with_a_model(measured)
    verdicts: dict[int, Verdict] = {}
    while True:
        nodes = run.nodes(bases, measured, applied)
        found = _judged(run, nodes, measured, applied)
        verdicts.update(found)
        worse = _not_helped(found)
        if not worse:
            return Settled(applied, verdicts, nodes)
        applied -= worse


def _with_a_model(measured: Sequence[Measured]) -> set[int]:
    return {index for index, item in enumerate(measured) if item.model is not None}


def _judged(run: Aligning, nodes: Sequence[tuple[Node, ...]], measured: Sequence[Measured], applied: set[int]) -> dict[int, Verdict]:
    after = run.rewarped(nodes)
    return {index: judge(run.previews, after, measured[index], run.ground) for index in applied}


def _not_helped(found: dict[int, Verdict]) -> set[int]:
    return {index for index, verdict in found.items() if not verdict.helped}


def _already_closed(before: float | None) -> bool:
    return before is not None and before <= SEAM_ALREADY_CLOSED_M


def _reported(run: Aligning, item: Measured, verdict: Verdict | None, applied: bool) -> JoinSeam:
    first, second = run.parts[item.seam.a].entity_id, run.parts[item.seam.b].entity_id
    samples, spare = len(item.kept), len(held_out(item.kept))
    if item.model is None:
        return JoinSeam(first, second, False, False, samples, 0, 0.0)
    before = None if verdict is None else verdict.before_m
    if not applied:
        # What the layer shows at this seam is what was there before: the correction is gone with its figure.
        return JoinSeam(first, second, True, _already_closed(before), samples, spare, 0.0, before, before)
    share = run.share(item.seam)
    moved = item.model.largest_m() * max(share, 1.0 - share) * run.ground
    return JoinSeam(first, second, True, True, samples, spare, moved, before, None if verdict is None else verdict.after_m)


def _plan_of(run: Aligning, box: MercatorBox, measured: Sequence[Measured], settled: Settled, omitted: tuple[str, ...]) -> JoinPlan:
    moved = gdal_step(run.ctx, lambda: _largest_move(run, settled.nodes), "read how far the frames moved")
    seams = tuple(
        PlannedSeam(item.seam.a, item.seam.b, _reported(run, item, settled.verdicts.get(index), index in settled.applied))
        for index, item in enumerate(measured)
    )
    parts = tuple(PlannedPart(part.version.id, nodes) for part, nodes in zip(run.parts, settled.nodes, strict=True))
    return JoinPlan(box, parts, seams, omitted, moved)


class AlignStep:
    name = "align"

    def run(self, ctx: JobContext) -> StepResult:
        parts = read_parts(ctx)
        box = aligned_box(city_window(ctx))
        require_room(ctx, needed_to_align(scan_sizes(ctx, parts), window_px(ctx, box)))
        warper = Warper(ctx, box)
        previews = [warper.preview(part) for part in parts]
        ownership = _owned(previews)
        run = _kept_run(ctx, warper, parts, previews, ownership)
        owner_grid = level_grid(box, OWNER_ZOOM)
        plan = _aligned(run, box, find_seams(ownership.owner, owner_grid, run.ground), _names(parts, ownership.omitted))
        _log(ctx, self.name, plan)
        owner_file = write_geotiff(ctx.local(OWNER_FILE), GeoTiff([ownership.owner], owner_grid.geotransform()))
        ctx.publish(owner_file, ctx.work_file(OWNER_FILE), "image/tiff")
        return Done(ctx.publish(plan.write(ctx.local(PLAN_FILE)), ctx.work_file(PLAN_FILE), "application/json"))


def _base_of(part: Part, box: MercatorBox) -> BaseTransform:
    return part_transform(part, box)


def _names(parts: Sequence[Part], indexes: Sequence[int]) -> tuple[str, ...]:
    return tuple(parts[index].entity_id for index in indexes)


def _kept_run(ctx: JobContext, warper: Warper, parts: list[Part], previews: list[Raster], ownership: Ownership) -> Aligning:
    """The run over the parts that add something; fewer than two ends the job."""
    if len(ownership.kept) < MIN_PARTS:
        raise StepFailedError(Errors.JOIN_NO_FRAMES, f"{len(ownership.kept)} of {len(parts)} frames add anything to the city")
    ground = ground_scale(warper.box.bounds().middle_lat)
    return Aligning(ctx, warper, _picked(parts, ownership), _picked(previews, ownership), ground)


def _picked[T](items: list[T], ownership: Ownership) -> list[T]:
    return [items[index] for index in ownership.kept]


def _largest_move(run: Aligning, nodes: Sequence[tuple[Node, ...]]) -> float:
    box = run.warper.box
    return max(_part_move(part, part_nodes, run.ground, box) for part, part_nodes in zip(run.parts, nodes, strict=True))


def _part_move(part: Part, nodes: tuple[Node, ...], ground: float, box: MercatorBox) -> float:
    """The part's real move; with no nodes it keeps its own transform."""
    if not nodes:
        return 0.0
    size = part_size(part, box)
    return largest_move_m(_base_of(part, box), nodes, node_reverse(nodes, size), size, ground)


def _aligned(run: Aligning, box: MercatorBox, seams: Sequence[Seam], omitted: tuple[str, ...]) -> JoinPlan:
    """The seams measured and settled, as a plan. An archive maps' join keeps every part on its own fit: its seams are measured (one
    too far apart ends the job) and reported, and no part moves (finding of 2026-11-14)."""
    keeps_fits = JoinParams.of(run.ctx.job.params).keeps_fits
    if keeps_fits:
        log_apart(run.ctx, run.parts, seams)
    measured = run.measure(seams)
    if keeps_fits:
        settled = Settled(set(), {}, [() for _part in run.parts])
    else:
        settled = settle(run, [_base_of(part, box) for part in run.parts], measured)
    return _plan_of(run, box, measured, settled, omitted)


def log_apart(ctx: JobContext, parts: Sequence[Part], seams: Sequence[Seam]) -> None:
    """An archive maps' join keeps a part that meets no other (a sheet of the same plan a few kilometres off, Vârteju 3 of the 1990
    cadastral plan): every part keeps its own fit, so nothing is measured against it and it is drawn where its own points put it. It
    used to end the job (`joinMapsApart`), which left such a sheet on a second layer of the same year (finding of 2026-11-23)."""
    apart = _apart_ids(parts, seams)
    if apart:
        ctx.log.info(f"apart from the others, kept on its own fit: {', '.join(apart)}", "align")


def _apart_ids(parts: Sequence[Part], seams: Sequence[Seam]) -> list[str]:
    """The ids of the parts that no seam meets."""
    met = {index for seam in seams for index in (seam.a, seam.b)}
    return [part.version.id for index, part in enumerate(parts) if index not in met]


def _log(ctx: JobContext, step: str, plan: JoinPlan) -> None:
    for seam in plan.seams:
        report = seam.report
        figures = f"{report.before_rmse_m} m before, {report.after_rmse_m} m after" if report.measured else "not measured"
        ctx.log.info(f"seam {report.a} and {report.b}: {report.samples} samples, {figures}, applied: {report.applied}", step)
    if plan.omitted:
        ctx.log.info(f"left out, adding nothing: {', '.join(plan.omitted)}", step)
