"""The verdict on an automatic layout (docs/research/M20-import-local.md §19.5): mosaic it on its own, or ask the owner.

`good` when at least `MIN_PLACED_PCT` of the sheets that are part of the map are placed and held by a kept seam (blank pages and sheets
the owner marked out do not count; a sheet only its cell's prior holds is not placed for the verdict), the seams' median correlation
is at least `MIN_SEAM_MEDIAN` (a missing seam, or one the bundle dropped, scores 0), their residual's 95th percentile at most
`MAX_RMS_P95_PX` cell pixels and no sheet lies more than `MAX_MOVED_CELLS` of a cell from its place on the grid. `poor` when fewer
than half are placed or the seams say nothing (their median under `POOR_SEAM_MEDIAN`: most neighbours missing); else `check`. On
`check` or `poor` the series is not mosaicked: it waits for its owner with `layout-check` and its proposal.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

import numpy

from hcm_pipeline.archive import model

MIN_PLACED_PCT: Final = float(model.STITCH_GOOD_PLACED_PCT)
MIN_SEAM_MEDIAN: Final = model.STITCH_GOOD_SEAM_NCC
MAX_RMS_P95_PX: Final = float(model.STITCH_GOOD_RMS_PX)
MAX_MOVED_CELLS: Final = model.STITCH_MAX_MOVE_CELL
POOR_PLACED_PCT: Final = 50.0
POOR_SEAM_MEDIAN: Final = 0.25


@dataclass(frozen=True)
class Quality:
    placed_pct: float
    seam_median: float
    seam_rms_px: float
    moved: float
    verdict: str

    def as_record(self) -> dict[str, object]:
        return {
            "placedPct": round(self.placed_pct, 1),
            "seamMedian": round(max(-1.0, min(1.0, self.seam_median)), 3),
            "seamRmsPx": round(self.seam_rms_px, 2),
            "verdict": self.verdict,
        }


def _poor(placed_pct: float, seam_median: float) -> bool:
    return placed_pct < POOR_PLACED_PCT or seam_median < POOR_SEAM_MEDIAN


def _good(placed_pct: float, seam_median: float, rms: float, moved: float) -> bool:
    checks = (placed_pct >= MIN_PLACED_PCT, seam_median >= MIN_SEAM_MEDIAN, rms <= MAX_RMS_P95_PX, moved <= MAX_MOVED_CELLS)
    return all(checks)


def _verdict(placed_pct: float, seam_median: float, rms: float, moved: float) -> str:
    if _poor(placed_pct, seam_median):
        return "poor"
    return "good" if _good(placed_pct, seam_median, rms, moved) else "check"


@dataclass(frozen=True)
class Measures:
    """What the verdict reads: sheets placed (and held by a kept seam) of those that count, every seam's score (0 when not kept), the
    kept seams' residuals, the largest move (cells)."""

    placed: int
    counted: int
    scores: Sequence[float]
    residuals: Sequence[float]
    moved: float


def judged(measures: Measures) -> Quality:
    placed_pct = 100.0 * measures.placed / measures.counted if measures.counted else 0.0
    median = float(numpy.median(measures.scores)) if len(measures.scores) else 0.0
    rms = float(numpy.percentile(measures.residuals, 95)) if len(measures.residuals) else 0.0
    return Quality(placed_pct, median, rms, measures.moved, _verdict(placed_pct, median, rms, measures.moved))
