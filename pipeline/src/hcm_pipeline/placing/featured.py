"""A series laid out from its sheets' common features (docs/research/M20-import-local.md §19.14), for `autostitch` to weigh against its
names' grid.

1. Each sheet's turn found on its working copy (`overlaps`): its quarter turn is the variant, the global quarter that most sheets
   share taken as upright (a scan is most often upright); a sheet whose variant its shape does not allow is left out.
2. The sheets on the cell in that variant matched again over the same pairs: what is left is a small turn (`angles`, degrees,
   clockwise, about the cell's centre; their median taken as upright) and a shift, solved at once.
3. Each kept link proved by its pixels: the two sheets' matched images (`seams.prepared`) correlated over their common area once
   placed. That score, not the feature count, is what the verdict reads (`quality`): a garbage layout never scores.
"""

import itertools
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

import cv2
import numpy

from hcm_pipeline.placing import overlaps
from hcm_pipeline.placing.seams import Seam, ncc, prepared, state_of
from hcm_pipeline.placing.sheetwork import TURNS, Part, allowed, on_cell
from hcm_pipeline.placing.streets import UInt8Array

# The common area two placed sheets must share, as a share of the cell, for their correlation to say anything.
MIN_COMMON_SHARE: Final = 0.005
HALF: Final = 0.5
Cell = tuple[int, int]


@dataclass(frozen=True)
class Layout:
    """The sheets placed (top left on the cell's pixels), their variants and small turns, the seams kept (proved by their pixels) and
    their residuals, those dropped, and the sheets left out."""

    positions: dict[int, tuple[float, float]]
    variants: dict[int, int]
    angles: dict[int, float]
    kept: tuple[Seam, ...]
    residuals: tuple[float, ...]
    dropped: tuple[Seam, ...]
    left_out: tuple[int, ...]


def quarter_of(turn: float) -> int:
    return round(turn / 90.0) % TURNS


def _upright(turns: Mapping[int, float]) -> int:
    """The quarter most sheets share (taken as upright)."""
    counts = numpy.bincount([quarter_of(turn) for turn in turns.values()], minlength=TURNS)
    return int(numpy.argmax(counts))


def variants_of(parts: Sequence[Part], turns: Mapping[int, float], cell: Cell) -> dict[int, int]:
    """Each turned sheet's variant (its quarter turn from the upright one), where its shape allows it on the cell."""
    upright = _upright(turns) if turns else 0
    found = {sheet: (quarter_of(turn) - upright) % TURNS for sheet, turn in turns.items()}
    return {sheet: variant for sheet, variant in found.items() if variant in allowed(parts[sheet], cell)}


def _levelled(turns: Mapping[int, float]) -> dict[int, float]:
    """The small turns with their median taken out (most sheets lie straight)."""
    middle = float(numpy.median(list(turns.values()))) if turns else 0.0
    return {sheet: overlaps.wrapped(turn - middle) for sheet, turn in turns.items()}


def to_page(placed: overlaps.Placed, sheet: int, cell: Cell) -> numpy.ndarray:
    """The 2 x 3 affine from the canvas to the sheet's own cell pixels."""
    back = overlaps.rotation(placed.turns[sheet]).T
    centre = numpy.array(placed.centres[sheet])
    middle = numpy.array([cell[0] / 2.0, cell[1] / 2.0])
    return numpy.hstack((back, (middle - back @ centre)[:, None]))


def from_page(placed: overlaps.Placed, sheet: int, cell: Cell) -> numpy.ndarray:
    """The 2 x 3 affine from the sheet's own cell pixels to the canvas."""
    turn = overlaps.rotation(placed.turns[sheet])
    middle = numpy.array([cell[0] / 2.0, cell[1] / 2.0])
    return numpy.hstack((turn, (numpy.array(placed.centres[sheet]) - turn @ middle)[:, None]))


def _between(placed: overlaps.Placed, link: overlaps.Link, cell: Cell) -> numpy.ndarray:
    """The affine from `b`'s cell pixels to `a`'s."""
    to_a = numpy.vstack((to_page(placed, link.a, cell), (0.0, 0.0, 1.0)))
    of_b = numpy.vstack((from_page(placed, link.b, cell), (0.0, 0.0, 1.0)))
    return numpy.asarray((to_a @ of_b)[:2], numpy.float64)


def proof(images: Mapping[int, UInt8Array], placed: overlaps.Placed, link: overlaps.Link, cell: Cell) -> float:
    """How well `b` continues `a` where they overlap once placed: their matched images' correlation (0 when they barely meet)."""
    first, second = prepared(images[link.a]), prepared(images[link.b])
    matrix = _between(placed, link, cell)
    moved = cv2.warpAffine(second, matrix, cell, flags=cv2.INTER_LINEAR)
    cover = cv2.warpAffine(numpy.ones_like(second), matrix, cell, flags=cv2.INTER_NEAREST) > HALF
    if float(cover.mean()) < MIN_COMMON_SHARE:
        return 0.0
    return ncc(first[cover], moved[cover])


def seam_of(images: Mapping[int, UInt8Array], placed: overlaps.Placed, link: overlaps.Link, cell: Cell, residual: float) -> Seam:
    """The link as a seam: `b`'s top left from `a`'s, the side it mostly lies on, its proof and its residual."""
    (ax, ay), (bx, by) = placed.centres[link.a], placed.centres[link.b]
    dx, dy = bx - ax, by - ay
    score = proof(images, placed, link, cell)
    side = "right" if abs(dx) >= abs(dy) else "below"
    return Seam(link.a, link.b, side, dx, dy, score, residual, state_of(score))


def _matched(parts: Sequence[Part], variants: Mapping[int, int], cell: Cell) -> dict[int, UInt8Array]:
    return {sheet: on_cell(parts[sheet], variant, cell) for sheet, variant in variants.items()}


def _features(images: Mapping[int, UInt8Array]) -> dict[int, overlaps.Features]:
    return {sheet: overlaps.features_of(image) for sheet, image in images.items()}


def _pairs(links: Sequence[overlaps.Link], sheets: Mapping[int, int]) -> list[tuple[int, int]]:
    return [(link.a, link.b) for link in links if link.a in sheets and link.b in sheets]


def _first_pass(parts: Sequence[Part], kept: Sequence[int], cell: Cell) -> tuple[dict[int, int], list[tuple[int, int]]]:
    """The sheets' variants from their working copies' links, and the pairs that linked."""
    links = overlaps.links_of(_features({sheet: parts[sheet].image for sheet in kept}))
    turns, agree = overlaps.turns(links)
    variants = variants_of(parts, turns, cell)
    return variants, _pairs(agree, variants)


def layout(parts: Sequence[Part], cell: Cell, out: Mapping[int, str]) -> Layout | None:
    """The series laid out by its common features, or None when fewer than two sheets link."""
    variants, pairs = _first_pass(parts, [part.index for part in parts if part.index not in out], cell)
    images = _matched(parts, variants, cell)
    turns, agree = overlaps.turns(overlaps.links_of(_features(images), pairs) if pairs else [])
    if not agree:
        return None
    placed = overlaps.placed(agree, _levelled(turns), dict.fromkeys(turns, cell))
    return _layout_of(parts, images, placed, cell, variants)


@dataclass(frozen=True)
class _Proved:
    kept: tuple[Seam, ...]
    dropped: tuple[Seam, ...]


def _proved(images: Mapping[int, UInt8Array], placed: overlaps.Placed, cell: Cell) -> _Proved:
    """The kept links as seams proved by their pixels; a link they do not prove (`missing`) dropped with the outliers."""
    measured = [seam_of(images, placed, link, cell, residual) for link, residual in zip(placed.kept, placed.residuals, strict=True)]
    outliers = [seam_of(images, placed, link, cell, overlaps.OUTLIER_PX) for link in placed.dropped]
    proved = [seam.state != "missing" for seam in measured]
    unproved = itertools.compress(measured, [not ok for ok in proved])
    return _Proved(tuple(itertools.compress(measured, proved)), (*unproved, *outliers))


def _held(seams: Sequence[Seam]) -> set[int]:
    return {seam.a for seam in seams} | {seam.b for seam in seams}


def _only[T](values: Mapping[int, T], sheets: set[int]) -> dict[int, T]:
    return {sheet: values[sheet] for sheet in sheets}


def _layout_of(
    parts: Sequence[Part], images: Mapping[int, UInt8Array], placed: overlaps.Placed, cell: Cell, variants: Mapping[int, int]
) -> Layout:
    """The layout: only the sheets a proved seam holds are placed."""
    seams = _proved(images, placed, cell)
    held = _held(seams.kept)
    positions = {sheet: (x - cell[0] / 2.0, y - cell[1] / 2.0) for sheet, (x, y) in _only(placed.centres, held).items()}
    left = tuple(part.index for part in parts if part.index not in held)
    residuals = tuple(seam.rms for seam in seams.kept)
    return Layout(positions, _only(variants, held), _only(placed.turns, held), seams.kept, residuals, seams.dropped, left)
