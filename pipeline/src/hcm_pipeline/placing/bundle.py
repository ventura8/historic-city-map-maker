"""Every sheet's place at once (docs/research/M20-import-local.md §19.4): a least-squares bundle of the seams, held to the grid.

The unknowns are each sheet's top left on the canvas (cell pixels; the sheets are already turned and brought to one cell, so what is
left between neighbours is a shift). Each strong or weak seam says where its second sheet lies from its first, weighted by its score;
a grid prior holds each sheet to its cell (`PRIOR_WEIGHT`, small: the seams decide, the prior only fixes the whole and bridges the
sheets no seam reaches). The grid's pitch is the seams' own median step (pages overlap or abut). Iteratively reweighted least squares
with Huber's loss (`HUBER_PX`) lets no single false seam (repeated hatching matched one period off) pull the rest; a seam still off
by more than `OUTLIER_PX` after it is dropped, and a sheet whose cell came from the order alone with no kept seam is left out (a foreign
sheet among numbered pages never joins). Plain numpy: the systems are a few hundred unknowns.
"""

import itertools
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

import numpy

from hcm_pipeline.placing.geometry import FloatArray
from hcm_pipeline.placing.seams import Seam

PRIOR_WEIGHT: Final = 0.02
HUBER_PX: Final = 2.0
OUTLIER_PX: Final = 8.0
ITERATIONS: Final = 8
Cell = tuple[int, int]


@dataclass(frozen=True)
class Solved:
    """Each placed sheet's top left (cell pixels), the seams kept and their residuals, the sheets left out, and how far each placed
    sheet moved from its prior (in cells)."""

    positions: dict[int, tuple[float, float]]
    kept: tuple[Seam, ...]
    residuals: tuple[float, ...]
    dropped: tuple[Seam, ...]
    left_out: tuple[int, ...]
    moved: dict[int, float]


def _step(seam: Seam) -> float:
    return seam.dx if seam.side == "right" else seam.dy


def _steps(seams: Sequence[Seam], side: str) -> list[float]:
    """The strong seams' steps on one side (across for `right`, down for `below`)."""
    return [_step(seam) for seam in seams if (seam.side, seam.state) == (side, "strong")]


def _median_or(values: Sequence[float], default: int) -> float:
    return float(numpy.median(values)) if values else float(default)


def pitch_of(seams: Sequence[Seam], cell: tuple[int, int]) -> tuple[float, float]:
    """The grid's step across and down: the median of the strong seams' steps, else the cell."""
    return _median_or(_steps(seams, "right"), cell[0]), _median_or(_steps(seams, "below"), cell[1])


@dataclass(frozen=True)
class _System:
    index: dict[int, int]
    seams: tuple[Seam, ...]
    prior: FloatArray


def _usable(seams: Sequence[Seam], index: Mapping[int, int]) -> tuple[Seam, ...]:
    """The seams that say something between two sheets of the system."""
    return tuple(seam for seam in seams if seam.state != "missing" and {seam.a, seam.b} <= index.keys())


def _system(cells: Mapping[int, Cell], seams: Sequence[Seam], pitch: tuple[float, float]) -> _System:
    order = sorted(cells)
    index = {sheet: position for position, sheet in enumerate(order)}
    prior = numpy.array([(cells[sheet][1] * pitch[0], cells[sheet][0] * pitch[1]) for sheet in order], numpy.float64)
    return _System(index, _usable(seams, index), prior)


def _solve(system: _System, weights: FloatArray) -> FloatArray:
    """The weighted least-squares positions (both axes at once: they share the design)."""
    count, links = len(system.index), len(system.seams)
    design = numpy.zeros((links + count, count))
    target = numpy.zeros((links + count, 2))
    for row, seam in enumerate(system.seams):
        design[row, system.index[seam.b]], design[row, system.index[seam.a]] = 1.0, -1.0
        target[row] = (seam.dx, seam.dy)
    design[links:] = numpy.eye(count)
    target[links:] = system.prior
    scale = numpy.sqrt(numpy.concatenate((weights, numpy.full(count, PRIOR_WEIGHT))))[:, None]
    solution, *_ = numpy.linalg.lstsq(design * scale, target * scale, rcond=None)
    return numpy.asarray(solution, numpy.float64)


def _residuals(system: _System, positions: FloatArray) -> FloatArray:
    found = [
        numpy.hypot(*(positions[system.index[seam.b]] - positions[system.index[seam.a]] - (seam.dx, seam.dy))) for seam in system.seams
    ]
    return numpy.asarray(found, numpy.float64)


def _irls(system: _System) -> FloatArray:
    base = numpy.array([max(seam.score, 0.05) ** 2 for seam in system.seams], numpy.float64)
    positions = _solve(system, base)
    for _ in range(ITERATIONS):
        residuals = _residuals(system, positions)
        positions = _solve(system, base * numpy.minimum(1.0, HUBER_PX / numpy.maximum(residuals, 1e-9)))
    return positions


def _unseamed(cells: Mapping[int, Cell], kept: Sequence[Seam], from_order: set[int]) -> tuple[int, ...]:
    joined = {seam.a for seam in kept} | {seam.b for seam in kept}
    return tuple(sorted((from_order & set(cells)) - joined))


def _positions(system: _System) -> FloatArray:
    return _irls(system) if system.index else numpy.zeros((0, 2))


def _split(system: _System, residuals: FloatArray) -> tuple[tuple[Seam, ...], tuple[float, ...], tuple[Seam, ...]]:
    """The seams kept (within `OUTLIER_PX` of the solution) with their residuals, and those dropped."""
    good = residuals <= OUTLIER_PX
    kept = tuple(itertools.compress(system.seams, good))
    dropped = tuple(itertools.compress(system.seams, ~good))
    return kept, tuple(float(value) for value in residuals[good]), dropped


def solve(cells: Mapping[int, Cell], seams: Sequence[Seam], cell: tuple[int, int], from_order: set[int] | None = None) -> Solved:
    """The sheets' places (`cells`: each sheet's (row, column)) from their seams, outliers dropped, unjoined order sheets left out."""
    system = _system(cells, seams, pitch_of(seams, cell))
    positions = _positions(system)
    kept, residuals, dropped = _split(system, _residuals(system, positions))
    left = _unseamed(cells, kept, from_order or set())
    placed = {sheet: (float(positions[at][0]), float(positions[at][1])) for sheet, at in system.index.items() if sheet not in left}
    moved = {sheet: _moved(positions[system.index[sheet]], system.prior[system.index[sheet]], cell) for sheet in placed}
    return Solved(placed, kept, residuals, dropped, left, moved)


def _moved(position: FloatArray, prior: FloatArray, cell: tuple[int, int]) -> float:
    """How far a sheet lies from its prior, in cells (the larger of the two axes)."""
    return float(max(abs(position[0] - prior[0]) / cell[0], abs(position[1] - prior[1]) / cell[1]))
