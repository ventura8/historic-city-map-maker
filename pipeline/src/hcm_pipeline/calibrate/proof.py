"""Prove: the gates a frame's tiles must pass before anything trusts them (docs/research/M9-calibration.md §4).

Accepted only when every gate holds; `refusal` names the first that fails. Every fifth cell of tiles is set aside before the **last**
RANSAC, and only its strongest tile, by what the match itself shows (never the fit), checks the map fitted on the rest. `refine.py`'s 11
to 12 m cross-validated RANSAC's own inliers, capped at 25 m: that flatters. What the figure does not do: the earlier rounds of
`measure` refit on every tile, held ones too, and centre the last search on that map, and a tile either side of a cell's border can
share half its pixels with a check (a tile is 900 m at a 450 m step, a cell 1,600 m with no buffer). Simulated, that does not flatter a
poly2 figure at this leverage (16.73 m against a true 16.97 m), but it means a tile with no peak is never a gross check: `rival.py` looks
for those.
"""

from dataclasses import dataclass
from typing import Final

import cv2
import numpy
from numpy.typing import NDArray

from hcm_pipeline.calibrate.dense import PROOF_RANSAC_M, Measured
from hcm_pipeline.calibrate.poly import PlaceMap, Poly, ground_errors, rmse_m, robust_fit
from hcm_pipeline.geo import FloatArray, Grid, ground_scale

PROOF_MIN_INLIERS: Final = 60
PROOF_MIN_SHARE: Final = 0.5
PROOF_MIN_SPREAD: Final = 0.4
PROOF_MIN_COVERED: Final = 0.05
PROOF_MAX_CV_M: Final = 30.0
PROOF_MAX_GROSS: Final = 0.2
# One a fold at least: a low-contrast frame has many tiles and almost no clear check, and one tile must not decide two gates.
PROOF_MIN_CHECKS: Final = 5
PAIR_CELL_GROUND_M: Final = 1600.0
CHECK_FOLDS: Final = 5
CHECK_MIN_PEAK: Final = 0.3
CHECK_MIN_MARGIN: Final = 0.06
CHECK_GROSS_M: Final = 100.0
# A cell's key: its column times this plus its row (no city's window holds this many cells).
CELL_KEY: Final = 1_000_000
NO_FIGURE: Final = float("inf")


def cells_of(places: FloatArray, cell_m: float) -> NDArray[numpy.int64]:
    """Each EPSG:3857 place's cell key, `cell_m` Mercator metres a side."""
    return numpy.floor(places[:, 0] / cell_m).astype(numpy.int64) * CELL_KEY + numpy.floor(places[:, 1] / cell_m).astype(numpy.int64)


def strongest_checks(rows: FloatArray, cells: NDArray[numpy.int64], held: NDArray[numpy.int64]) -> FloatArray:
    """The strongest tile of each held cell whose match alone is clear; a cell with none has no check."""
    clear = (rows[:, 4] >= CHECK_MIN_PEAK) & (rows[:, 5] >= CHECK_MIN_MARGIN)
    found = [_strongest(rows[clear & (cells == cell)]) for cell in held.tolist()]
    return numpy.array([row for row in found if row is not None], numpy.float64).reshape(-1, rows.shape[1])


def _strongest(rows: FloatArray) -> FloatArray | None:
    return rows[int(rows[:, 4].argmax())] if len(rows) else None


def fold_errors(rows: FloatArray, order: int, cell_m: float, fold: int, seed: int) -> FloatArray:
    """The ground errors at one fold's checks, against the map RANSAC fits on the other folds' cells."""
    cells = cells_of(rows[:, 2:4], cell_m)
    held = numpy.unique(cells)[fold::CHECK_FOLDS]
    rest = ~numpy.isin(cells, held)
    fitted = robust_fit(rows[rest, :2], rows[rest, 2:4], order, PROOF_RANSAC_M, seed)
    checks = strongest_checks(rows, cells, held)
    if fitted is None or not len(checks):
        return numpy.empty(0)
    return ground_errors(fitted[0](checks[:, :2]), checks[:, 2:4])


@dataclass(frozen=True)
class Checked:
    """The blocked figures: RMSE of the checks up to the gross limit, the gross share, how many checks."""

    cv_m: float
    gross: float
    count: int


def cross_checked(rows: FloatArray, order: int, cell_m: float, seed: int) -> Checked:
    """All five folds."""
    errors = numpy.concatenate([fold_errors(rows, order, cell_m, fold, seed) for fold in range(CHECK_FOLDS)])
    if not errors.size:
        return Checked(NO_FIGURE, 1.0, 0)
    fine = errors[errors <= CHECK_GROSS_M]
    return Checked(rmse_m(fine), 1 - fine.size / errors.size, int(errors.size))


@dataclass(frozen=True)
class Proof:
    """A proof's verdict, its figures and what it holds: the tiles and the map."""

    refusal: str | None
    inliers: int
    tried: int
    spread: float
    covered: float
    checked: Checked
    measured: Measured
    rival: float = 0.0
    rival_sigmas: float = 0.0

    @property
    def accepted(self) -> bool:
        return self.refusal is None

    @property
    def forward(self) -> Poly | None:
        return self.measured.forward

    @property
    def mapping(self) -> PlaceMap | None:
        return self.measured.mapping


def _spread(rows: FloatArray, covered: float, grid: Grid) -> float:
    """The inliers' hull over the window's covered area."""
    if not len(rows) or covered <= 0:
        return 0.0
    hull = cv2.convexHull(rows[:, 2:4].astype(numpy.float32))
    return float(cv2.contourArea(hull)) / (covered * grid.width * grid.height * grid.resolution**2)


def spread_over(proof: Proof, grid: Grid, covered: float) -> float:
    """The agreeing tiles' hull over a part of what they were measured on: those inside `grid`, over the share of it on film."""
    held = proof.measured.rows[proof.measured.inliers]
    box = grid.box()
    inside = (held[:, 2] >= box.left) & (held[:, 2] <= box.right) & (held[:, 3] >= box.bottom) & (held[:, 3] <= box.top)
    return _spread(held[inside], covered, grid)


def _first_refusal(inliers: int, tried: int, spread: float, covered: float, checked: Checked) -> str | None:
    gates = (
        (inliers >= PROOF_MIN_INLIERS, "few-inliers"),
        (inliers >= PROOF_MIN_SHARE * tried, "low-share"),
        (spread >= PROOF_MIN_SPREAD, "narrow"),
        (covered >= PROOF_MIN_COVERED, "small"),
        (checked.count >= PROOF_MIN_CHECKS, "cross-validation"),
        (checked.cv_m <= PROOF_MAX_CV_M, "cross-validation"),
        (checked.gross <= PROOF_MAX_GROSS, "gross"),
    )
    return next((name for passed, name in gates if not passed), None)


def prove(measured: Measured, grid: Grid, seed: int) -> Proof:
    """The verdict on what `measure` found; the checks are run only on a frame that passed the cheaper gates."""
    rows, tried = measured.rows, len(measured.rows)
    inliers = int(numpy.count_nonzero(measured.inliers))
    held = rows[measured.inliers] if inliers else rows[:0]
    spread = _spread(held, measured.covered, grid)
    cheap = _first_refusal(inliers, tried, spread, measured.covered, Checked(0.0, 0.0, PROOF_MIN_CHECKS))
    checked = Checked(NO_FIGURE, 1.0, 0)
    if cheap is None and measured.forward is not None:
        cell_m = PAIR_CELL_GROUND_M / ground_scale(grid.box().bounds().middle_lat)
        checked = cross_checked(rows, measured.forward.order, cell_m, seed)
    return Proof(
        _first_refusal(inliers, tried, spread, measured.covered, checked), inliers, tried, spread, measured.covered, checked, measured
    )


def no_film(measured: Measured) -> Proof:
    """A proposal whose film does not reach the window: a refusal, no exception."""
    return Proof("small", 0, 0, 0.0, 0.0, Checked(NO_FIGURE, 1.0, 0), measured)
