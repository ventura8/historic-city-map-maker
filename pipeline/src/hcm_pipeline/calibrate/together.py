"""The models a frame is joined with, and their blocked figure (docs/research/M15-calibration-accuracy.md, *Joint solve*).

A KH-9 panoramic frame keeps its camera (`camera.py`) and every other frame takes a polynomial of `JOINT_ORDER` on every tile and tie:
the ties reach where Sentinel-2 holds nothing, which a polynomial of about 100 pairs cannot use. Either is a map its pairs cannot rebuild,
so it reaches the warp as a lattice (`georef/lattice.py`).
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

import numpy
from numpy.typing import NDArray

from hcm_pipeline.calibrate.camera import KEPT_M, fit_panoramic
from hcm_pipeline.calibrate.joint import ModelFit, PartnerTies, PlaceFn, Rows
from hcm_pipeline.calibrate.poly import Poly, fit_narrowed, ground_errors, rmse_m
from hcm_pipeline.calibrate.proof import CHECK_FOLDS, cells_of
from hcm_pipeline.geo import FloatArray

JOINT_ORDER: Final = 3
# Beyond the film's measured box a polynomial of this order carries the map on from the box's edge (`Restricted`).
OUTER_ORDER: Final = 2
PANORAMIC_MODEL: Final = "panoramic"
POLYNOMIAL_MODEL: Final = "polynomial"


def camera_fit(rad_per_px: float) -> ModelFit:
    """The panoramic camera as a model."""

    def fit(film: FloatArray, places: FloatArray, weights: FloatArray) -> PlaceFn | None:
        camera = fit_panoramic(film, places, rad_per_px, weights)
        return None if camera is None else camera.to_places

    return fit


@dataclass(frozen=True)
class Restricted:
    """A polynomial held to the film's measured box: inside it, itself; beyond it, its value at the box's nearest point plus how a
    lower order grows from there. A cubic left alone beyond its tiles runs away: 151 m at an unreached corner (M15 evidence)."""

    inner: Poly
    outer: Poly
    low: FloatArray
    high: FloatArray

    def __call__(self, film: FloatArray) -> FloatArray:
        edge = numpy.clip(film, self.low, self.high)
        return numpy.asarray(self.inner(edge) + self.outer(film) - self.outer(edge), numpy.float64)


def polynomial_fit(order: int = JOINT_ORDER, outer: int = OUTER_ORDER) -> ModelFit:
    """A polynomial on every row, restricted to the rows' film box, as a model."""

    def fit(film: FloatArray, places: FloatArray, weights: FloatArray) -> PlaceFn | None:
        inner, beyond = fit_narrowed(order, film, places, weights), fit_narrowed(outer, film, places, weights)
        if inner is None or beyond is None:
            return None
        return Restricted(inner, beyond, film.min(axis=0), film.max(axis=0))

    return fit


def kept_tiles(to_places: PlaceFn, tiles: FloatArray) -> int:
    """How many Sentinel-2 tiles lie within the camera's 25 m of a map."""
    return int(numpy.count_nonzero(ground_errors(to_places(tiles[:, :2]), tiles[:, 2:4]) < KEPT_M))


def _held_errors(
    fit: ModelFit, rows: Rows, pairs: FloatArray, cells: tuple[NDArray[numpy.int64], NDArray[numpy.int64]], held: NDArray[numpy.int64]
) -> FloatArray | None:
    held_pairs = numpy.isin(cells[0], held)
    outside = ~numpy.isin(cells[1], held)
    to_places = fit(rows.film[outside], rows.places[outside], rows.weights[outside])
    if to_places is None or not held_pairs.any():
        return None
    return ground_errors(to_places(pairs[held_pairs, :2]), pairs[held_pairs, 2:4])


def blocked_figure_of(fit: ModelFit, rows: Rows, pairs: FloatArray, cell_m: float) -> float | None:
    """A model's blocked figure: each fold of the pairs' cells against the model fitted on the rows (tiles and ties) outside them."""
    cells = (cells_of(pairs[:, 2:4], cell_m), cells_of(rows.places, cell_m))
    unique = numpy.unique(cells[0])
    errors = [_held_errors(fit, rows, pairs, cells, unique[fold::CHECK_FOLDS]) for fold in range(CHECK_FOLDS)]
    found = [each for each in errors if each is not None]
    return rmse_m(numpy.concatenate(found)) if found else None


def free_of(partners: Sequence[PartnerTies], held: NDArray[numpy.int64], cell_m: float) -> list[PartnerTies]:
    """The partners' ties outside the cells held for checks, so a checkpoint stays unseen by every fit."""
    return [ties.where(~numpy.isin(cells_of(ties.places, cell_m), held)) for ties in partners]
