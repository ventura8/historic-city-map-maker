"""The owner's layout of an atlas or pieces (docs/research/M20-import-local.md §19.8): what `imagery.saveLayout` wrote, fixed as given.

`help.layoutAnswer` (`layoutAnswerSchema` of @hcm/shared) names each sheet by its index in `layout.json` with its cell, turn and flip,
or `not-part` (the wizard's X). A sheet the answer does not name keeps the reason it was left out automatically (`blank`, `no-join`
for a name the grid did not read, else `no-seam`): only the owner's X makes a sheet `not-part`, which no longer counts. A turn the
cell's shape does not allow (a quarter turn of an oblong sheet on an oblong cell) is refused: the sheet keeps the owner's flip a quarter
turn back. Each seam the owner answered carries one matching point on each side, in the two sheets' oriented pixels (`layout_files`);
it becomes a fixed seam of full weight only while its two sheets are still neighbours on that side of the new grid and both points are
well formed (a seam answered before a sheet moved or turned says nothing of the new layout). The other seams are measured as usual,
and the bundle places everything. A `preview` answer renders the layout and waits again with `layout-check` (the wizard's step 3);
otherwise the layout is mosaicked and placed whatever its verdict: the owner has checked it. An answer with no sheets (accepted as
proposed) takes the automatic proposal as it is. The layout written next has the answer's revision plus one; the answer itself stays in
`help` through every later wait (`output.wait_for_help` carries it in the same write), so a retry of `place` uses it again.
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from hcm_pipeline.jobs import JobContext, StepResult
from hcm_pipeline.placing import autoplace
from hcm_pipeline.placing.autostitch import Plan, Proposal, initial_out, propose, solved
from hcm_pipeline.placing.layout_files import stretch
from hcm_pipeline.placing.output import LAYOUT_ANSWER
from hcm_pipeline.placing.series import SeriesJob
from hcm_pipeline.placing.sheetnames import NameGrid, grid_of
from hcm_pipeline.placing.sheetwork import Part, allowed, cell_of, read_parts, variant_of

OWNER: str = "owner"
POINT_SIZE: int = 2
NOT_PART: str = "not-part"
UNSEAMED: str = "no-seam"
QUARTER: int = 90


@dataclass(frozen=True)
class Answer:
    """The owner's layout as saved: the revision it was made on, its sheets and seams, whether it is a preview, the whole record."""

    revision: int
    sheets: tuple[Mapping[str, object], ...]
    seams: tuple[Mapping[str, object], ...]
    preview: bool
    record: Mapping[str, object]


def _records(value: object) -> tuple[Mapping[str, object], ...]:
    return tuple(item for item in value if isinstance(item, Mapping)) if isinstance(value, list) else ()


def answer_of(ctx: JobContext) -> Answer | None:
    """The version's `help.layoutAnswer`, or None when the owner gave none."""
    version = ctx.services.store.get(ctx.version_path()) or {}
    help_item = version.get("help")
    found = help_item.get(LAYOUT_ANSWER) if isinstance(help_item, Mapping) else None
    return None if not isinstance(found, Mapping) else _answer(found)


def _answer(found: Mapping[str, object]) -> Answer:
    preview = found.get("preview") is True and found.get("accepted") is not True
    return Answer(number(found, "revision"), _records(found.get("sheets")), _records(found.get("seams")), preview, found)


def number(record: Mapping[str, object], key: str) -> int:
    value = record.get(key)
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def point(record: Mapping[str, object], key: str) -> tuple[float, float] | None:
    """A point `[x, y]` of a seam's points, None when malformed (two finite numbers or nothing)."""
    found = record.get(key)
    values = found if isinstance(found, list) else []
    numbers = [float(value) for value in values if _numeric(value)]
    return (numbers[0], numbers[1]) if len(numbers) == len(values) == POINT_SIZE else None


def _numeric(value: object) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def owner_variant(plan: Plan, index: int, sheet: Mapping[str, object]) -> int:
    """The owner's turn and flip, or, when the cell's shape does not allow that turn, the same flip a quarter turn back."""
    turn, flip = number(sheet, "turn"), sheet.get("flip") is True
    chosen = variant_of(turn, flip)
    return chosen if chosen in allowed(plan.parts[index], plan.cell) else variant_of(turn - QUARTER, flip)


def place_sheet(plan: Plan, sheet: Mapping[str, object]) -> None:
    """One answered sheet: its variant, and its cell unless the owner marked it not part of the map."""
    index = number(sheet, "index")
    if index not in plan.variants:
        return
    plan.variants[index] = owner_variant(plan, index, sheet)
    if sheet.get("out") is None:
        plan.out.pop(index, None)
        plan.cells[index] = (number(sheet, "row"), number(sheet, "col"))
    else:
        plan.out[index] = NOT_PART


def seam_offset(plan: Plan, seam: Mapping[str, object]) -> tuple[float, float] | None:
    """Where `b` lies from `a` (cell pixels) when the owner's two points are one place; None when a point is malformed."""
    points = seam.get("points")
    found = points if isinstance(points, Mapping) else {}
    on_a, on_b = point(found, "a"), point(found, "b")
    if on_a is None or on_b is None:
        return None
    (sax, say), (sbx, sby) = stretch(plan, number(seam, "a")), stretch(plan, number(seam, "b"))
    return on_a[0] * sax - on_b[0] * sbx, on_a[1] * say - on_b[1] * sby


def _unnamed(named: Sequence[tuple[str, Path]], parts: Sequence[Part]) -> dict[int, str]:
    """Why each sheet is out before the answer is read: the automatic reasons (`blank`, `no-join`), else `no-seam`."""
    cell = cell_of(parts)
    found = initial_out(parts, grid_of([name for name, _path in named], cell[0] / cell[1]))
    return {part.index: found.get(part.index, UNSEAMED) for part in parts}


def owner_plan(named: Sequence[tuple[str, Path]], answer: Answer) -> Plan:
    """The parts with the owner's cells, turns and flips, the sheets out and the seams set; a sheet the answer does not name keeps
    its automatic reason."""
    parts = read_parts(named)
    cell = cell_of(parts)
    plan = Plan(parts, {}, {part.index: allowed(part, cell)[0] for part in parts}, cell, _unnamed(named, parts))
    for sheet in answer.sheets:
        place_sheet(plan, sheet)
    plan.fixed = _fixed(plan, answer.seams)
    return plan


def _fixed(plan: Plan, seams: Sequence[Mapping[str, object]]) -> dict[tuple[int, int], tuple[float, float]]:
    """The owner's seams between two neighbours of the layout on the side they were answered on, with well-formed points, as
    offsets."""
    pairs = set(plan.pairs())
    found = {}
    for seam in seams:
        offset = seam_offset(plan, seam)
        if offset is not None and (number(seam, "a"), number(seam, "b"), seam.get("side")) in pairs:
            found[(number(seam, "a"), number(seam, "b"))] = offset
    return found


def owner_proposal(named: Sequence[tuple[str, Path]], answer: Answer) -> Proposal:
    if not answer.sheets:
        return propose(named)
    plan = owner_plan(named, answer)
    cells = plan.cells or {0: (0, 0)}
    rows, cols = 1 + max(row for row, _ in cells.values()), 1 + max(col for _, col in cells.values())
    return solved(plan, NameGrid(dict(plan.cells), rows, cols, OWNER))


def place(ctx: JobContext, series: SeriesJob, answer: Answer, method: str) -> StepResult:
    """The owner's layout: previewed (and its answer kept), or mosaicked and placed."""
    proposal = owner_proposal(autoplace.named_of(series.sheets), answer)
    ctx.log.info(f"the owner's layout, revision {answer.revision}: {len(proposal.solved.positions)} sheets placed", ctx.step)
    if answer.preview:
        return autoplace.wait_layout(ctx, series, proposal, OWNER, answer.revision + 1)
    return autoplace.mosaicked(ctx, series, proposal, (method, OWNER), answer.revision + 1)
