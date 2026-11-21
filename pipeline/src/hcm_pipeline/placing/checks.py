"""Checks held out in spatial blocks before any fit, and what they measure (docs/research/M20-import-local.md §3 b step 5, §3 c step 6).

The map's own extent is cut into 5 x 5 blocks and the blocks on one diagonal pattern (`(col + 2 row) mod 5 == 0`, one in five, spread over
the whole map) are held out: no pair inside them helps any fit. After the fit, each held-out pair's residual is measured on the ground. A
check further than `gross_m` (5 mm on paper at the map's scale, at least 100 m) is dropped and counted: any dropped check stops the
series from publishing on its own (M9 §11). The agreeing checks' span is measured on the map's own extent, never the city's (§5).
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

import numpy

from hcm_pipeline.placing.geometry import BoolArray, FloatArray

BLOCKS: Final = 5
HELD_PATTERN: Final = 2
CHECK_GROSS_MIN_M: Final = 100.0
# 5 mm on paper.
GROSS_PAPER_M: Final = 0.005
WORST: Final = 5
P95: Final = 95


def gross_m(scale: int | None) -> float:
    """The distance past which a check is gross for a map of `scale` (100 m when the scale is unknown)."""
    return max(CHECK_GROSS_MIN_M, GROSS_PAPER_M * scale) if scale else CHECK_GROSS_MIN_M


def held_out(points: FloatArray, extent: tuple[float, float, float, float]) -> BoolArray:
    """Which `points` (in the map's own pixels) lie in a held-out block of the `extent` (left, top, right, bottom)."""
    left, top, right, bottom = extent
    col = numpy.clip(((points[:, 0] - left) / max(right - left, 1e-9) * BLOCKS).astype(numpy.int64), 0, BLOCKS - 1)
    row = numpy.clip(((points[:, 1] - top) / max(bottom - top, 1e-9) * BLOCKS).astype(numpy.int64), 0, BLOCKS - 1)
    return numpy.asarray((col + HELD_PATTERN * row) % BLOCKS == 0, numpy.bool_)


def span_pct(points: FloatArray, extent: tuple[float, float, float, float]) -> float:
    """The share (0-100) of the extent the points' bounding box spans: its width share times its height share."""
    if len(points) == 0:
        return 0.0
    left, top, right, bottom = extent
    width = (points[:, 0].max() - points[:, 0].min()) / max(right - left, 1e-9)
    height = (points[:, 1].max() - points[:, 1].min()) / max(bottom - top, 1e-9)
    return round(float(min(1.0, width) * min(1.0, height)) * 100.0, 1)


@dataclass(frozen=True)
class Residuals:
    """The per-part summary the version carries: median, 95th percentile and the worst five parts' names."""

    median_m: float
    p95_m: float
    worst: tuple[str, ...]

    def as_record(self) -> dict[str, object]:
        return {"medianM": round(self.median_m, 2), "p95M": round(self.p95_m, 2), "worst": list(self.worst)}


def residual_summary(errors: FloatArray, names: Sequence[str]) -> Residuals | None:
    """The summary of the checks' errors (each named by its part: a sheet, a page or the map), worst parts first."""
    if len(errors) == 0:
        return None
    by_part: dict[str, float] = {}
    for name, error in zip(names, errors.tolist(), strict=True):
        by_part[name] = max(by_part.get(name, 0.0), float(error))
    worst = sorted(by_part, key=lambda name: -by_part[name])[:WORST]
    return Residuals(float(numpy.median(errors)), float(numpy.percentile(errors, P95)), tuple(name[:200] for name in worst))


@dataclass(frozen=True)
class Checked:
    """What the held-out checks measured: their error (RMSE of the agreeing ones), count, the dropped ones and their span."""

    rmse_m: float | None
    count: int
    dropped: int
    measured_pct: float
    residuals: Residuals | None


def checked(
    errors: FloatArray, points: FloatArray, names: Sequence[str], extent: tuple[float, float, float, float], gross: float
) -> Checked:
    """The checks' figure: gross ones dropped and counted, the others' RMSE, span and summary."""
    agree = errors <= gross
    kept = errors[agree]
    rmse = math.sqrt(float((kept**2).mean())) if len(kept) else None
    kept_names = [name for name, ok in zip(names, agree.tolist(), strict=True) if ok]
    return Checked(rmse, int(agree.sum()), int((~agree).sum()), span_pct(points[agree], extent), residual_summary(kept, kept_names))


def in_quadrature(own: float | None, reference: float | None) -> float | None:
    """A checkpoint error with a calibrated reference's own error added in quadrature (§1.7, the reference ladder)."""
    if own is None:
        return None
    return math.hypot(own, reference or 0.0)
