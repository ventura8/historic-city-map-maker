"""Consensus and confidence (docs/research/M4-interfaces.md §2.1 step 5, §2.2).

RANSAC (`cv2.estimateAffine2D`, 3 px, confidence 0.999, 5,000 iterations, the RNG seeded from the job id) over both
channels' candidates of a level keeps the ones one affine map explains; each kept pair gets its confidence,

    score = 0.5 x margin + 0.3 x support + 0.2 x agreement   (each part 0 to 1),

the margin being the match's own (`1 - d1/d2`, or a tile's peak margin), the support the share of its cell's candidates
that are inliers within 1.5 px of its own residual, and the agreement 1 when the other channel has an inlier in the
same cell within 20 m (ground) of the same shift, 0 when it has inliers there but none agrees, 0.5 when it has none
(or did not run). At most two pairs per cell, the most confident, so the pairs spread.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

import cv2
import numpy
from numpy.typing import NDArray

from hcm_pipeline.geo import FloatArray

RANSAC_PX: Final = 3.0
RANSAC_CONFIDENCE: Final = 0.999
RANSAC_ITERATIONS: Final = 5000
MIN_RANSAC: Final = 3
PER_CELL: Final = 2
SUPPORT_PX: Final = 1.5
AGREE_M: Final = 20.0
MARGIN_WEIGHT: Final = 0.5
SUPPORT_WEIGHT: Final = 0.3
AGREEMENT_WEIGHT: Final = 0.2
ALONE: Final = 0.5


@dataclass(frozen=True)
class Candidate:
    """A match on one level: a point of the pre-warped scan, its point in the reference (grid pixels), its margin."""

    cell: int
    scan: tuple[float, float]
    reference: tuple[float, float]
    margin: float
    channel: str

    @property
    def shift(self) -> tuple[float, float]:
        return self.reference[0] - self.scan[0], self.reference[1] - self.scan[1]


@dataclass(frozen=True)
class Scored:
    """A kept pair and its confidence."""

    candidate: Candidate
    score: float


def _points(candidates: Sequence[Candidate]) -> tuple[NDArray[numpy.float32], NDArray[numpy.float32]]:
    source = numpy.array([candidate.scan for candidate in candidates], numpy.float32).reshape(-1, 2)
    return source, numpy.array([candidate.reference for candidate in candidates], numpy.float32).reshape(-1, 2)


def _usable(model: object) -> bool:
    """OpenCV's answer is a finite affine map (it gives none for collinear points and NaNs for coincident ones)."""
    return isinstance(model, numpy.ndarray) and bool(numpy.isfinite(model).all())


def ransac(candidates: Sequence[Candidate]) -> tuple[list[bool], FloatArray]:
    """Which candidates one affine map explains, and each candidate's residual (px) under it; none below three."""
    if len(candidates) < MIN_RANSAC:
        return [False] * len(candidates), numpy.full(len(candidates), numpy.inf)
    source, target = _points(candidates)
    model, inliers = cv2.estimateAffine2D(
        source, target, method=cv2.RANSAC, ransacReprojThreshold=RANSAC_PX, maxIters=RANSAC_ITERATIONS, confidence=RANSAC_CONFIDENCE
    )
    if not _usable(model):
        return [False] * len(candidates), numpy.full(len(candidates), numpy.inf)
    mapped = source.astype(numpy.float64) @ model[:, :2].T + model[:, 2]
    return numpy.ravel(inliers).astype(bool).tolist(), numpy.hypot(*(mapped - target).T)


def _by_cell(candidates: Sequence[Candidate]) -> dict[int, list[int]]:
    groups: dict[int, list[int]] = {}
    for index, candidate in enumerate(candidates):
        groups.setdefault(candidate.cell, []).append(index)
    return groups


@dataclass(frozen=True)
class _Level:
    """The level's candidates with their RANSAC verdicts and residuals, grouped by cell, and its ground metres per pixel."""

    candidates: Sequence[Candidate]
    inliers: list[bool]
    residuals: FloatArray
    metres_per_px: float
    cells: dict[int, list[int]]

    def in_cell(self, cell: int) -> list[int]:
        return self.cells[cell]

    def support(self, index: int) -> float:
        """The share of the cell's candidates that are inliers within `SUPPORT_PX` of this one's residual."""
        mates = self.in_cell(self.candidates[index].cell)
        own = self.residuals[index]
        agreeing = [mate for mate in mates if self.inliers[mate] and abs(self.residuals[mate] - own) <= SUPPORT_PX]
        return len(agreeing) / len(mates)

    def _others(self, index: int) -> list[Candidate]:
        """The other channel's inliers in this candidate's cell."""
        own = self.candidates[index]
        mates = [self.candidates[mate] for mate in self.in_cell(own.cell) if self.inliers[mate]]
        return [mate for mate in mates if mate.channel != own.channel]

    def agreement(self, index: int) -> float:
        """1 when the other channel agrees in this cell (within `AGREE_M`), 0 when it only disagrees, 0.5 without it."""
        own = self.candidates[index]
        gaps = [math.hypot(other.shift[0] - own.shift[0], other.shift[1] - own.shift[1]) for other in self._others(index)]
        if not gaps:
            return ALONE
        return 1.0 if min(gaps) * self.metres_per_px <= AGREE_M else 0.0

    def score(self, index: int) -> float:
        parts = MARGIN_WEIGHT * self.candidates[index].margin + SUPPORT_WEIGHT * self.support(index)
        return float(min(1.0, max(0.0, parts + AGREEMENT_WEIGHT * self.agreement(index))))


def _best_per_cell(scored: Sequence[Scored]) -> list[Scored]:
    """At most `PER_CELL` pairs per cell, the most confident, in cell order."""
    best: dict[int, list[Scored]] = {}
    for pair in sorted(scored, key=lambda entry: -entry.score):
        best.setdefault(pair.candidate.cell, []).append(pair)
    return [pair for cell in sorted(best) for pair in best[cell][:PER_CELL]]


def consensus(candidates: Sequence[Candidate], metres_per_px: float) -> list[Scored]:
    """The RANSAC inliers scored, at most `PER_CELL` per cell (the most confident), in cell order."""
    inliers, residuals = ransac(candidates)
    level = _Level(candidates, inliers, residuals, metres_per_px, _by_cell(candidates))
    kept = [index for index, inlier in enumerate(inliers) if inlier]
    return _best_per_cell([Scored(candidates[index], level.score(index)) for index in kept])
