"""A proved frame's pairs (docs/research/M9-calibration.md §7).

Cells of 1,600 m, doubled until the pairs fit `DENSE_MAX_PAIRS`; one pair a cell, but with no buffer between cells, so two pairs either
side of a border can share pixels. Every fifth cell is set aside **before this RANSAC** (`measure`'s earlier rounds saw it: `proof.py`);
its strongest clear tile is a checkpoint (`enabled: false`), one over 100 m dropped and counted, the rest not trimmed: a dropped check
may be a false match or a part of the map that is wrong, nothing here can tell them apart, so `checkpointRmseM` is the survivors' figure
and any dropped check keeps the version from publishing itself (`approval.ts`). Of the other cells, each one's strongest inlier is a
pair. `affine` or `poly2` by a blocked 5-fold over the pairs; `tps` is never automatic.

A KH-9 panoramic frame (`rad_per_px`, M15 §2) is mapped by its camera (`camera.py`), fitted on **every** gated tile of the cells not
held: the pairs stay the editor's sample, their residuals, the checks and the blocked figure are the camera's, a check over 100 m from
it is dropped, and the map goes to the warp as a lattice of nodes over the scan (`georef/lattice.py`), since the pairs cannot rebuild
it. Too few tiles, or a camera that holds under 90 % of the tiles within 25 m the polynomial's RANSAC kept: the frame keeps its
polynomial.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
from typing import Final

import numpy
from numpy.typing import NDArray

from hcm_pipeline.calibrate.camera import PanoramicMap, fit_panoramic
from hcm_pipeline.calibrate.dense import PROOF_RANSAC_M
from hcm_pipeline.calibrate.joint import PlaceFn, Verdict
from hcm_pipeline.calibrate.poly import Mask, Poly, fit_poly, ground_errors, rmse_m, robust_fit
from hcm_pipeline.calibrate.proof import CHECK_FOLDS, CHECK_GROSS_M, PAIR_CELL_GROUND_M, cells_of, strongest_checks
from hcm_pipeline.calibrate.terrain import TerrainFit
from hcm_pipeline.calibrate.together import PANORAMIC_MODEL
from hcm_pipeline.contract import MIN_GCPS
from hcm_pipeline.geo import FloatArray, ground_scale, to_lnglat_arrays, to_mercator
from hcm_pipeline.georef.autogcp import AUTO_GCP_CHECKPOINT_SHARE, AUTO_GCP_MIN_CONFIDENCE, ID_DIGITS, MIN_POLY2_PAIRS
from hcm_pipeline.georef.lattice import Lattice, sampled
from hcm_pipeline.georef.matcher import MAX_AUTO_GCPS
from hcm_pipeline.georef.transforms import Fit, Gcp, fit, rmse

PAIR_CELL_DOUBLINGS: Final = 8
TRANSFORM_MIN_GAIN_M: Final = 2.0
PEAK_TO_SCORE: Final = 2.0
# A camera that converged holds within 2 % of the tiles the polynomial's RANSAC kept (500 fits on real KH-9 frames: 0.989 at worst);
# one that failed holds far fewer. "At least as many" sent 9 of those 500 back to the poly2 of ~100 pairs, 20 to 30 m off (M15).
CAMERA_MIN_KEPT_SHARE: Final = 0.9
HELD_EVERY: Final = round(1 / AUTO_GCP_CHECKPOINT_SHARE)


def _cell_size(rows: FloatArray, middle_lat: float) -> float:
    """The cell's side in EPSG:3857 metres: doubled until the cells' pairs fit `MAX_AUTO_GCPS`."""
    cell = PAIR_CELL_GROUND_M / ground_scale(middle_lat)
    for _ in range(PAIR_CELL_DOUBLINGS):
        if numpy.unique(cells_of(rows[:, 2:4], cell)).size <= MAX_AUTO_GCPS:
            break
        cell *= 2
    return cell


def _per_cell(rows: FloatArray, cells: NDArray[numpy.int64]) -> FloatArray:
    """The strongest row of each cell, by cell."""
    found = [rows[cells == cell][int(rows[cells == cell, 4].argmax())] for cell in numpy.unique(cells).tolist()]
    return numpy.array(found, numpy.float64).reshape(-1, rows.shape[1])


def _gross(to_places: Callable[[FloatArray], FloatArray], checks: FloatArray) -> Mask:
    errors = ground_errors(to_places(checks[:, :2]), checks[:, 2:4]) if len(checks) else numpy.empty(0)
    return numpy.asarray(errors > CHECK_GROSS_M, numpy.bool_)


@dataclass(frozen=True)
class Chosen:
    """What `choose` keeps: the pairs' rows, the checks' rows, how many checks went as gross errors, the tiles of the cells not held
    and how many of them RANSAC kept."""

    pairs: FloatArray
    checks: FloatArray
    dropped: int
    training: FloatArray
    kept: int

    def checked_by(self, to_places: Callable[[FloatArray], FloatArray], candidates: FloatArray) -> Chosen:
        """The same pairs, the checks gated against another map."""
        gross = _gross(to_places, candidates)
        return replace(self, checks=candidates[~gross], dropped=int(numpy.count_nonzero(gross)))


@dataclass(frozen=True)
class Ransac:
    """The polynomial RANSAC found on the cells not held, every held cell's candidate check, the cells' side and the held ones."""

    poly: Poly
    candidates: FloatArray
    cell: float
    held: NDArray[numpy.int64]


def choose(rows: FloatArray, order: int, middle_lat: float, seed: int) -> Chosen | None:
    """Pairs and checks from a proof's tiles; None when RANSAC finds nothing on the remaining cells."""
    found = _chosen(rows, order, middle_lat, seed)
    return None if found is None else found[0]


def _chosen(rows: FloatArray, order: int, middle_lat: float, seed: int) -> tuple[Chosen, Ransac] | None:
    cell = _cell_size(rows, middle_lat)
    cells = cells_of(rows[:, 2:4], cell)
    held = numpy.unique(cells)[::HELD_EVERY]
    rest = ~numpy.isin(cells, held)
    fitted = robust_fit(rows[rest, :2], rows[rest, 2:4], order, PROOF_RANSAC_M, seed)
    if fitted is None:
        return None
    pairs = _per_cell(rows[rest][fitted[1]], cells[rest][fitted[1]])
    checks = strongest_checks(rows, cells, held)
    gross = _gross(fitted[0], checks)
    chosen = Chosen(pairs, checks[~gross], int(numpy.count_nonzero(gross)), rows[rest], int(numpy.count_nonzero(fitted[1])))
    return chosen, Ransac(fitted[0], checks, cell, held)


def blocked_figure(pairs: FloatArray, order: int, cell_m: float) -> float | None:
    """The pairs' RMSE (ground metres) under a 5-fold whose folds are whole cells; None when no fold leaves enough to fit: a missing
    figure, never an infinite one, which a document cannot hold."""
    cells = cells_of(pairs[:, 2:4], cell_m)
    unique = numpy.unique(cells)
    folds = [numpy.isin(cells, unique[fold::CHECK_FOLDS]) for fold in range(CHECK_FOLDS)]
    errors = [_held_errors(pairs, held, order) for held in folds if _can_hold(held, order)]
    return rmse_m(numpy.concatenate(errors)) if errors else None


def _can_hold(held: Mask, order: int) -> bool:
    """A fold holds something and leaves more pairs than its own order needs."""
    return bool(held.any() and numpy.count_nonzero(~held) > MIN_GCPS["affine" if order == 1 else "poly2"])


def _held_errors(pairs: FloatArray, held: Mask, order: int) -> FloatArray:
    mapped = fit_poly(order, pairs[~held, :2], pairs[~held, 2:4])(pairs[held, :2])
    return ground_errors(mapped, pairs[held, 2:4])


def transform_of(pairs: FloatArray, middle_lat: float) -> tuple[str, float | None]:
    """`affine` or `poly2`, whichever earns it, and its blocked figure (None: too few pairs to hold any out)."""
    cell = 2 * PAIR_CELL_GROUND_M / ground_scale(middle_lat)
    affine = blocked_figure(pairs, 1, cell)
    curved = blocked_figure(pairs, 2, cell) if len(pairs) >= MIN_POLY2_PAIRS else None
    earned = affine is not None and curved is not None and affine - curved >= TRANSFORM_MIN_GAIN_M
    return ("poly2", curved) if earned else ("affine", affine)


def panoramic_figure(training: FloatArray, pairs: FloatArray, rad_per_px: float, cell_m: float) -> float | None:
    """The camera's blocked figure: each fold of the pairs' cells against the camera fitted on the tiles outside them."""
    cells, tile_cells = cells_of(pairs[:, 2:4], cell_m), cells_of(training[:, 2:4], cell_m)
    unique = numpy.unique(cells)
    errors = [_camera_held(training, pairs, rad_per_px, (cells, tile_cells), unique[fold::CHECK_FOLDS]) for fold in range(CHECK_FOLDS)]
    found = [each for each in errors if each is not None]
    return rmse_m(numpy.concatenate(found)) if found else None


def _camera_held(
    training: FloatArray,
    pairs: FloatArray,
    rad_per_px: float,
    cells: tuple[NDArray[numpy.int64], NDArray[numpy.int64]],
    held: NDArray[numpy.int64],
) -> FloatArray | None:
    held_pairs = numpy.isin(cells[0], held)
    camera = fit_panoramic(training[~numpy.isin(cells[1], held), :2], training[~numpy.isin(cells[1], held), 2:4], rad_per_px)
    if camera is None or not held_pairs.any():
        return None
    return ground_errors(camera.to_places(pairs[held_pairs, :2]), pairs[held_pairs, 2:4])


def _gcps(rows: FloatArray, offset: tuple[int, int], enabled: bool, first: int) -> list[Gcp]:
    lng, lat = to_lnglat_arrays(rows[:, 2], rows[:, 3])
    found = []
    for index, (row, place_lng, place_lat) in enumerate(zip(rows.tolist(), lng.tolist(), lat.tolist(), strict=True), start=first):
        score = max(AUTO_GCP_MIN_CONFIDENCE, min(1.0, PEAK_TO_SCORE * row[4]))
        found.append(Gcp(f"a{index:0{ID_DIGITS}d}", row[0] - offset[0], row[1] - offset[1], place_lat, place_lng, enabled, "auto", score))
    return found


@dataclass(frozen=True)
class Calibrated:
    """The frame's automatic georeference: the fit, its pairs and checks, the blocked figure and what was dropped; `lattice`, the nodes
    of a map the pairs cannot rebuild (a panoramic camera's), else None; `terrain`, what renders a map over terrain (`joining.py`)."""

    fitted: Fit
    cross_validated_m: float | None
    checks_dropped: int
    lattice: Lattice | None = None
    alignment: tuple[Verdict, ...] = ()
    # `calibration.alignment` as the step records it (each partner's year added): `steps/georef.py`.
    alignment_record: Mapping[str, object] | None = None
    terrain: TerrainFit | None = None


@dataclass(frozen=True)
class ScanBox:
    """Where the scan lies in the film: its corner, its size, and a panoramic camera's radians a film column (M15 §2; None: no camera
    map)."""

    left: int
    top: int
    width: int
    height: int
    rad_per_px: float | None = None


def calibrated(rows: FloatArray, order: int, scan: ScanBox, middle_lat: float, seed: int) -> Calibrated | None:
    """The fit of a proof's tiles in the scan's pixels; None when the pairs do not fit: the matcher, or the admin, goes on. A panoramic
    frame's camera when it holds (module docstring). `joining.py` joins it to frames held still."""
    found = chosen_of(rows[inside(rows, scan)], order, middle_lat, seed)
    return None if found is None else alone(found, scan, middle_lat)


def chosen_of(rows: FloatArray, order: int, middle_lat: float, seed: int) -> tuple[Chosen, Ransac] | None:
    """The pairs, checks and training tiles of a proof's tiles in the scan, with what RANSAC found; None with too few pairs."""
    found = _chosen(rows, order, middle_lat, seed)
    return None if found is None or len(found[0].pairs) < MIN_GCPS["poly2"] else found


def alone(found: tuple[Chosen, Ransac], scan: ScanBox, middle_lat: float) -> Calibrated | None:
    """The frame on its own tiles: its camera when it holds, else its polynomial."""
    return _by_camera(found, scan, middle_lat) or _by_polynomial(found[0], scan, middle_lat)


def _by_polynomial(chosen: Chosen, scan: ScanBox, middle_lat: float) -> Calibrated | None:
    kind, figure = transform_of(chosen.pairs, middle_lat)
    result = fit(kind, _all_gcps(chosen, (scan.left, scan.top)))
    return Calibrated(result, figure, chosen.dropped) if isinstance(result, Fit) else None


def _by_camera(found: tuple[Chosen, Ransac], scan: ScanBox, middle_lat: float) -> Calibrated | None:
    """The camera's georeference, when the frame has one and it holds nearly the tiles the polynomial's RANSAC kept."""
    chosen, ransac = found
    camera = None if scan.rad_per_px is None else fit_panoramic(chosen.training[:, :2], chosen.training[:, 2:4], scan.rad_per_px)
    if camera is None or camera.kept < CAMERA_MIN_KEPT_SHARE * chosen.kept:
        return None
    return _panoramic(chosen.checked_by(camera.to_places, ransac.candidates), scan, camera, middle_lat)


def _all_gcps(chosen: Chosen, offset: tuple[int, int]) -> list[Gcp]:
    pairs = _gcps(chosen.pairs, offset, True, 1)
    return pairs + _gcps(chosen.checks, offset, False, len(pairs) + 1)


def _map_residuals(gcps: tuple[Gcp, ...], to_places: PlaceFn, offset: FloatArray) -> tuple[Gcp, ...]:
    """Each pair's and check's ground metres from the map."""
    film = numpy.array([[gcp.x, gcp.y] for gcp in gcps], numpy.float64) + offset
    places = numpy.array([to_mercator(gcp.lng, gcp.lat) for gcp in gcps], numpy.float64)
    errors = ground_errors(to_places(film), places).tolist()
    return tuple(replace(gcp, residual_m=error) for gcp, error in zip(gcps, errors, strict=True))


def _residual_rmse(gcps: tuple[Gcp, ...], enabled: bool) -> float | None:
    found = [gcp.residual_m for gcp in gcps if gcp.enabled is enabled and gcp.residual_m is not None]
    return rmse(found) if found else None


@dataclass(frozen=True)
class Mapped:
    """A map the pairs cannot rebuild: film pixels to places, its lattice's model and its blocked figure. Over terrain `to_places` is
    the map on the ground, what the layer shows: the lattice samples it, as it does every other map."""

    to_places: PlaceFn
    model: str
    figure: float | None


def _panoramic(chosen: Chosen, scan: ScanBox, camera: PanoramicMap, middle_lat: float) -> Calibrated | None:
    """The camera's georeference (`_mapped`), its figure the camera's blocked one."""
    figure = panoramic_figure(chosen.training, chosen.pairs, camera.frame.rad_per_px, 2 * PAIR_CELL_GROUND_M / ground_scale(middle_lat))
    return mapped_calibration(chosen, scan, Mapped(camera.to_places, PANORAMIC_MODEL, figure), middle_lat)


def mapped_calibration(chosen: Chosen, scan: ScanBox, mapped: Mapped, middle_lat: float) -> Calibrated | None:
    """The georeference of a map the pairs cannot rebuild: the sample's transform for the editor, the map's residuals, checks, figure
    and lattice."""
    sample = fit(transform_of(chosen.pairs, middle_lat)[0], _all_gcps(chosen, (scan.left, scan.top)))
    if not isinstance(sample, Fit):
        return None
    offset = numpy.array([scan.left, scan.top], numpy.float64)
    gcps = _map_residuals(sample.gcps, mapped.to_places, offset)
    checks = len(chosen.checks)
    fitted = Fit(sample.transform, gcps, _residual_rmse(gcps, True) or 0.0, _residual_rmse(gcps, False), checks)
    lattice = Lattice(mapped.model, sampled(_in_scan(mapped.to_places, offset), scan.width, scan.height))
    return Calibrated(fitted, mapped.figure, chosen.dropped, lattice)


def _in_scan(to_places: PlaceFn, offset: FloatArray) -> Callable[[FloatArray, FloatArray], tuple[FloatArray, FloatArray]]:
    def to_lnglat(x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray]:
        places = to_places(numpy.column_stack((x, y)) + offset)
        return to_lnglat_arrays(places[:, 0], places[:, 1])

    return to_lnglat


def inside(rows: FloatArray, scan: ScanBox) -> Mask:
    x, y = rows[:, 0] - scan.left, rows[:, 1] - scan.top
    return numpy.asarray((x >= 0) & (x <= scan.width) & (y >= 0) & (y <= scan.height), numpy.bool_)
