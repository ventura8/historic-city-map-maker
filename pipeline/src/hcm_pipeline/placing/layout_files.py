"""An automatic layout's files for its owner (docs/research/M20-import-local.md §19.7; `imagery-tiles.ts` of @hcm/shared).

The pixels every record speaks in are a sheet's **oriented** pixels: its working copy (`sheetwork.Part.image`, cropped to its content)
turned and mirrored by its variant. The layout's canvas is the bundle's, in cell pixels, moved so its first sheet starts at 0.

- `layout.json` (`layoutFileSchema`): the grid, the revision, the canvas's size, the quality, every sheet (its cell, turn, flip, why it
  is out, where its cell came from, its similarity from its oriented pixels to the canvas and its oriented size) and every seam (where
  `b`'s origin lies in `a`'s oriented pixels, its overlap there, and for a weak seam one matching point on each side and its strips).
- `thumbs.jpg`: each sheet's content as stored (not turned: the wizard turns it by `turn` and `flip`), scaled into a square of
  `THUMB_CELL_PX` from its top left, `THUMB_SPRITE_COLS` a row, cell `i` sheet `i`.
- `seams.jpg`: one row per weak seam (`strip.row`): `a`'s strip in the left `SEAM_CELL_PX` square, `b`'s in the right one, each scaled
  into its square from the top left.

The version's document keeps only the summary (`help.stitched.layout`): the grid, the revision, the quality and the weakest seams.
"""

import json
import math
from collections.abc import Mapping, Sequence
from typing import Final

import cv2
import numpy

from hcm_pipeline.archive import model
from hcm_pipeline.images import write_jpeg
from hcm_pipeline.jobs import JobContext
from hcm_pipeline.placing.autostitch import Plan, Proposal
from hcm_pipeline.placing.seams import STRIP_SHARE, Seam
from hcm_pipeline.placing.sheetwork import flip_of, oriented, swaps, turn_of
from hcm_pipeline.placing.streets import UInt8Array

THUMB_PX: Final = model.THUMB_CELL_PX
SPRITE_COLS: Final = model.THUMB_SPRITE_COLS
SEAM_PX: Final = model.SEAM_CELL_PX
WEAK_MAX: Final = model.LAYOUT_WEAK_SEAMS_MAX
QUALITY: Final = 85
NAME_MAX: Final = 500
WEAK: Final = frozenset({"weak", "missing"})
Rect = tuple[float, float, float, float]


def oriented_size(plan: Plan, index: int) -> tuple[int, int]:
    """The sheet's oriented size (width, height)."""
    height, width = plan.parts[index].image.shape[:2]
    return (height, width) if swaps(plan.variants[index]) else (width, height)


def stretch(plan: Plan, index: int) -> tuple[float, float]:
    """Cell pixels per oriented pixel, across and down."""
    width, height = oriented_size(plan, index)
    return plan.cell[0] / width, plan.cell[1] / height


def origin_of(proposal: Proposal) -> tuple[float, float]:
    """The canvas's origin in the bundle's cell pixels: the placed sheets' least corner."""
    places = list(proposal.solved.positions.values()) or [(0.0, 0.0)]
    return min(x for x, _ in places), min(y for _, y in places)


def place_of(proposal: Proposal, index: int) -> tuple[float, float]:
    """The sheet's top left on the canvas: where the bundle put it, else its cell's place on the grid."""
    plan = proposal.plan
    found = proposal.solved.positions.get(index)
    if found is None:
        row, col = plan.cells.get(index, (0, 0))
        found = (col * plan.cell[0], row * plan.cell[1])
    low = origin_of(proposal)
    return found[0] - low[0], found[1] - low[1]


def sheet_record(proposal: Proposal, index: int) -> dict[str, object]:
    plan = proposal.plan
    row, col = plan.cells.get(index, (0, 0))
    variant = plan.variants[index]
    (sx, sy), (x, y) = stretch(plan, index), place_of(proposal, index)
    width, height = oriented_size(plan, index)
    record: dict[str, object] = {
        "name": plan.parts[index].name[:NAME_MAX],
        "row": row,
        "col": col,
        "turn": turn_of(variant),
        "flip": flip_of(variant),
        "source": proposal.grid.source,
        "matrix": [round(sx, 6), 0.0, round(x, 3), 0.0, round(sy, 6), round(y, 3)],
        "width": width,
        "height": height,
    }
    reason = proposal.left_out.get(index)
    if reason is not None:
        record["out"] = reason
    return record


def in_a(plan: Plan, seam: Seam) -> tuple[float, float]:
    """The seam's offset in `a`'s oriented pixels."""
    sx, sy = stretch(plan, seam.a)
    return seam.dx / sx, seam.dy / sy


def overlap_px(plan: Plan, seam: Seam) -> int:
    """How far the two sheets overlap across the seam, in `a`'s oriented pixels (0 when they abut or leave a gap)."""
    dx, dy = in_a(plan, seam)
    width, height = oriented_size(plan, seam.a)
    return max(0, round(width - dx if seam.side == "right" else height - dy))


def suggestion(plan: Plan, seam: Seam) -> dict[str, list[float]]:
    """One point the seam says match: the middle of the overlap along `a`'s edge, and the same place on `b`."""
    width, height = oriented_size(plan, seam.a)
    half = overlap_px(plan, seam) / 2
    point = (width - half, height / 2) if seam.side == "right" else (width / 2, height - half)
    (ax, ay), (bx, by) = stretch(plan, seam.a), stretch(plan, seam.b)
    on_b = ((point[0] * ax - seam.dx) / bx, (point[1] * ay - seam.dy) / by)
    return {"a": [round(point[0], 2), round(point[1], 2)], "b": [round(on_b[0], 2), round(on_b[1], 2)]}


def strip_rects(plan: Plan, seam: Seam) -> tuple[Rect, Rect]:
    """The two strips along the seam (`STRIP_SHARE` of the side), each in its sheet's oriented pixels."""
    (aw, ah), (bw, bh) = oriented_size(plan, seam.a), oriented_size(plan, seam.b)
    if seam.side == "right":
        across_a, across_b = max(1, round(STRIP_SHARE * aw)), max(1, round(STRIP_SHARE * bw))
        return (aw - across_a, 0, across_a, ah), (0, 0, across_b, bh)
    down_a, down_b = max(1, round(STRIP_SHARE * ah)), max(1, round(STRIP_SHARE * bh))
    return (0, ah - down_a, aw, down_a), (0, 0, bw, down_b)


def weak_seams(proposal: Proposal) -> list[Seam]:
    """The weak and missing seams, weakest first, at most `LAYOUT_WEAK_SEAMS_MAX`."""
    return sorted((seam for seam in proposal.seams if seam.state in WEAK), key=lambda seam: seam.score)[:WEAK_MAX]


def clipped(score: float) -> float:
    return round(max(-1.0, min(1.0, score)), 3)


def seam_record(plan: Plan, seam: Seam, row: int | None) -> dict[str, object]:
    dx, dy = in_a(plan, seam)
    record: dict[str, object] = {
        "a": seam.a,
        "b": seam.b,
        "side": seam.side,
        "dx": round(dx, 2),
        "dy": round(dy, 2),
        "score": clipped(seam.score),
        "rmsPx": round(max(0.0, seam.rms), 2),
        "overlapPx": overlap_px(plan, seam),
        "state": seam.state,
    }
    if row is not None:
        rect_a, rect_b = strip_rects(plan, seam)
        record["suggestion"] = suggestion(plan, seam)
        record["strip"] = {"row": row, "a": list(rect_a), "b": list(rect_b)}
    return record


def grid_size(proposal: Proposal) -> tuple[int, int]:
    cells = list(proposal.plan.cells.values()) or [(0, 0)]
    return 1 + max(row for row, _ in cells), 1 + max(col for _, col in cells)


def summary(proposal: Proposal, revision: int) -> dict[str, object]:
    """`help.stitched.layout`: the grid, the revision, the quality and the weakest seams (their sheets, side and score)."""
    weak = [{"a": seam.a, "b": seam.b, "side": seam.side, "score": clipped(seam.score)} for seam in weak_seams(proposal)]
    rows, cols = grid_size(proposal)
    return {"rows": rows, "cols": cols, "revision": revision, "quality": proposal.quality.as_record(), "weakSeams": weak}


def canvas_size(proposal: Proposal) -> tuple[int, int]:
    """The canvas the matrices draw into: every sheet's box, placed or on its cell."""
    corners = [place_of(proposal, part.index) for part in proposal.plan.parts]
    width = max(x for x, _ in corners) + proposal.plan.cell[0]
    height = max(y for _, y in corners) + proposal.plan.cell[1]
    return max(1, math.ceil(width)), max(1, math.ceil(height))


def layout_record(proposal: Proposal, revision: int) -> dict[str, object]:
    """`layout.json`: the whole proposal."""
    plan = proposal.plan
    rows = {(seam.a, seam.b): row for row, seam in enumerate(weak_seams(proposal))}
    grid_rows, grid_cols = grid_size(proposal)
    width, height = canvas_size(proposal)
    return {
        "revision": revision,
        "rows": grid_rows,
        "cols": grid_cols,
        "width": width,
        "height": height,
        "sheets": [sheet_record(proposal, part.index) for part in plan.parts],
        "seams": [seam_record(plan, seam, rows.get((seam.a, seam.b))) for seam in proposal.seams],
        "quality": proposal.quality.as_record(),
    }


def fitted(image: UInt8Array, side: int) -> UInt8Array:
    """The picture scaled to fit a square of `side` from its top left, on paper white."""
    height, width = image.shape[:2]
    scale = side / max(width, height)
    small = cv2.resize(image, (max(1, round(width * scale)), max(1, round(height * scale))), interpolation=cv2.INTER_AREA)
    box = numpy.full((side, side), 255, numpy.uint8)
    box[: small.shape[0], : small.shape[1]] = small
    return box


def thumbs(plan: Plan) -> UInt8Array:
    """The sprite: every sheet's content in its square, `THUMB_SPRITE_COLS` a row."""
    cols = min(SPRITE_COLS, max(1, len(plan.parts)))
    rows = max(1, math.ceil(len(plan.parts) / cols))
    sprite = numpy.full((rows * THUMB_PX, cols * THUMB_PX), 255, numpy.uint8)
    for position, part in enumerate(plan.parts):
        row, col = divmod(position, cols)
        sprite[row * THUMB_PX : (row + 1) * THUMB_PX, col * THUMB_PX : (col + 1) * THUMB_PX] = fitted(part.image, THUMB_PX)
    return sprite


def strip_picture(plan: Plan, index: int, rect: Rect) -> UInt8Array:
    """One strip of a sheet (its oriented pixels) in its square."""
    x, y, width, height = (round(value) for value in rect)
    picture = oriented(plan.parts[index].image, plan.variants[index])
    return fitted(picture[y : y + height, x : x + width], SEAM_PX)


def seam_row(plan: Plan, seam: Seam) -> UInt8Array:
    rect_a, rect_b = strip_rects(plan, seam)
    return numpy.hstack((strip_picture(plan, seam.a, rect_a), strip_picture(plan, seam.b, rect_b)))


def seams_picture(plan: Plan, weak: Sequence[Seam]) -> UInt8Array:
    """The weak seams' strips, one row each (a paper white row when there is none)."""
    rows = [seam_row(plan, seam) for seam in weak]
    return numpy.vstack(rows) if rows else numpy.full((SEAM_PX, 2 * SEAM_PX), 255, numpy.uint8)


def revision_of(version: Mapping[str, object]) -> int:
    """The next layout's revision: one more than the version's current layout's, 0 for the first."""
    help_item = version.get("help")
    stitched = help_item.get("stitched") if isinstance(help_item, Mapping) else None
    layout = stitched.get("layout") if isinstance(stitched, Mapping) else None
    revision = layout.get("revision") if isinstance(layout, Mapping) else None
    return revision + 1 if isinstance(revision, int) else 0


def publish_layout(ctx: JobContext, proposal: Proposal, revision: int) -> dict[str, object]:
    """The three files with the version's, and the summary its document keeps."""
    local = ctx.local("layout.json")
    local.write_text(json.dumps(layout_record(proposal, revision), separators=(",", ":")), encoding="utf-8")
    ctx.publish(local, ctx.version_file("layout.json"), "application/json")
    sprite = write_jpeg(ctx.local("thumbs.jpg"), thumbs(proposal.plan), QUALITY)
    ctx.publish(sprite, ctx.version_file("thumbs.jpg"), "image/jpeg")
    strips = write_jpeg(ctx.local("seams.jpg"), seams_picture(proposal.plan, weak_seams(proposal)), QUALITY)
    ctx.publish(strips, ctx.version_file("seams.jpg"), "image/jpeg")
    return summary(proposal, revision)
