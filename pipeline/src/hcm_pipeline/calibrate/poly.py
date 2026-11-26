"""The polynomial map a frame's proof fits, its inverse, and the seeded RANSAC over tile matches (docs/research/M9-calibration.md §4).

A row of tile matches holds film x, film y, EPSG:3857 x, y, the peak and its margin. Metres are ground metres at each pair's own
latitude, never one fixed cosine: the same code serves 60 degrees and the equator.
"""

from dataclasses import dataclass
from typing import Final, Protocol

import numpy
from numpy.typing import NDArray

from hcm_pipeline.geo import FloatArray, ground_scale, to_lnglat_arrays
from hcm_pipeline.georef.corners import apply

Mask = NDArray[numpy.bool_]
Image = NDArray[numpy.float32]
TERMS: Final = {1: 3, 2: 6, 3: 10}
RANSAC_TRIES: Final = 2000
# What RANSAC's threshold starts at, then narrows through, as a share of the threshold (first values of the prototype).
RANSAC_STEPS: Final = (2.4, 1.6, 1.0, 1.0)
QUADRATIC: Final = 2
INVERSE_ORDER: Final = 3
INVERSE_SAMPLES: Final = 25


def _basis(points: FloatArray, centre: FloatArray, spread: FloatArray, order: int) -> FloatArray:
    x, y = ((points - centre) / spread).T
    terms = [numpy.ones_like(x), x, y]
    if order >= QUADRATIC:
        terms += [x * x, x * y, y * y]
    if order >= INVERSE_ORDER:
        terms += [x**3, x * x * y, x * y * y, y**3]
    return numpy.column_stack(terms)


@dataclass(frozen=True)
class Poly:
    """A polynomial from one plane to another, over coordinates centred and scaled to about 1."""

    order: int
    centre: FloatArray
    spread: FloatArray
    coefficients: FloatArray

    def __call__(self, points: FloatArray) -> FloatArray:
        return numpy.asarray(_basis(points, self.centre, self.spread, self.order) @ self.coefficients, numpy.float64)


def _frame_of(points: FloatArray) -> tuple[FloatArray, FloatArray]:
    return points.mean(axis=0), numpy.maximum(points.std(axis=0) * 3, 1.0)


def fit_poly(order: int, source: FloatArray, target: FloatArray) -> Poly:
    """The least-squares polynomial of `order` from `source` to `target` (n by 2 each)."""
    centre, spread = _frame_of(source)
    coefficients = numpy.linalg.lstsq(_basis(source, centre, spread, order), target, rcond=None)[0]
    return Poly(order, centre, spread, numpy.asarray(coefficients, numpy.float64))


def ground_errors(mapped: FloatArray, places: FloatArray) -> FloatArray:
    """Ground metres between EPSG:3857 places, at each one's own latitude."""
    _, lat = to_lnglat_arrays(places[:, 0], places[:, 1])
    return numpy.asarray(numpy.hypot(*(mapped - places).T) * ground_scale_of(lat), numpy.float64)


def ground_scale_of(lat: FloatArray) -> FloatArray:
    return numpy.cos(numpy.radians(lat))


def rmse_m(values: FloatArray) -> float:
    return float(numpy.sqrt(numpy.mean(values * values))) if values.size else float("inf")


@dataclass(frozen=True)
class _Pairs:
    """A fit's design matrix, the places it must reach and each pair's ground scale."""

    design: FloatArray
    places: FloatArray
    scale: FloatArray

    def errors_m(self, coefficients: FloatArray) -> FloatArray:
        return numpy.asarray(numpy.hypot(*(self.design @ coefficients - self.places).T) * self.scale, numpy.float64)


def _best_sample(pairs: _Pairs, terms: int, reach: float, seed: int) -> FloatArray:
    """The coefficients of the small sample most pairs agree with, within `reach` ground metres."""
    rng = numpy.random.default_rng(seed)
    best, kept = numpy.zeros((terms, 2)), -1
    for _ in range(RANSAC_TRIES):
        sample = rng.choice(len(pairs.places), terms, replace=False)
        coefficients = numpy.linalg.lstsq(pairs.design[sample], pairs.places[sample], rcond=None)[0]
        agree = int(numpy.count_nonzero(pairs.errors_m(coefficients) < reach))
        if agree > kept:
            best, kept = coefficients, agree
    return numpy.asarray(best, numpy.float64)


def _narrowed(pairs: _Pairs, start: FloatArray, threshold: float) -> tuple[FloatArray, Mask]:
    """`start` refitted on the pairs it holds, the threshold narrowing; the last coefficients and the pairs within the threshold."""
    coefficients = start
    for step in RANSAC_STEPS:
        keep = pairs.errors_m(coefficients) < threshold * step
        if numpy.count_nonzero(keep) > pairs.design.shape[1]:
            coefficients = numpy.linalg.lstsq(pairs.design[keep], pairs.places[keep], rcond=None)[0]
    return numpy.asarray(coefficients, numpy.float64), pairs.errors_m(coefficients) < threshold


def robust_fit(film: FloatArray, places: FloatArray, order: int, threshold_m: float, seed: int) -> tuple[Poly, Mask] | None:
    """The polynomial most pairs agree with and the mask of its inliers; None with too few pairs to sample."""
    if len(film) <= TERMS[order]:
        return None
    centre, spread = _frame_of(film)
    _, lat = to_lnglat_arrays(places[:, 0], places[:, 1])
    pairs = _Pairs(_basis(film, centre, spread, order), places, ground_scale_of(lat))
    start = _best_sample(pairs, TERMS[order], threshold_m * RANSAC_STEPS[0], seed)
    coefficients, keep = _narrowed(pairs, start, threshold_m)
    return Poly(order, centre, spread, coefficients), keep


# What a fit on every tile keeps, narrowing (the camera's: `camera.py`).
NARROWING_M: Final = (80.0, 60.0, 40.0, 25.0, 25.0)


def _weighted(design: FloatArray, places: FloatArray, root: FloatArray) -> FloatArray:
    return numpy.asarray(numpy.linalg.lstsq(design * root[:, None], places * root[:, None], rcond=None)[0], numpy.float64)


def fit_narrowed(order: int, film: FloatArray, places: FloatArray, weights: FloatArray) -> Poly | None:
    """The polynomial of `order` by weighted least squares on every row, the rows it keeps narrowing from 80 to 25 ground metres;
    None with too few rows."""
    if len(film) <= 2 * TERMS[order]:
        return None
    centre, spread = _frame_of(film)
    design, root = _basis(film, centre, spread, order), numpy.sqrt(weights)
    _, lat = to_lnglat_arrays(places[:, 0], places[:, 1])
    pairs, keep = _Pairs(design, places, ground_scale_of(lat)), numpy.ones(len(film), numpy.bool_)
    for reach in NARROWING_M:
        within = pairs.errors_m(_weighted(design[keep], places[keep], root[keep])) < reach
        keep = within if numpy.count_nonzero(within) > 2 * TERMS[order] else keep
    return Poly(order, centre, spread, _weighted(design[keep], places[keep], root[keep]))


class PlaceMap(Protocol):
    """Film pixels to EPSG:3857 metres, and back, around a city's window."""

    def to_places(self, film: FloatArray) -> FloatArray: ...

    def to_film(self, places: FloatArray) -> FloatArray: ...


@dataclass(frozen=True)
class MatrixMap:
    """A projective map: the first guess, a vote's proposal, a matcher's."""

    matrix: FloatArray

    def to_places(self, film: FloatArray) -> FloatArray:
        return numpy.column_stack(apply(self.matrix, film[:, 0], film[:, 1]))

    def to_film(self, places: FloatArray) -> FloatArray:
        return numpy.column_stack(apply(numpy.linalg.inv(self.matrix), places[:, 0], places[:, 1]))


@dataclass(frozen=True)
class PolyMap:
    """A fitted polynomial and the inverse fitted on a grid of it (a polynomial has no exact inverse)."""

    forward: Poly
    inverse: Poly

    @classmethod
    def over(cls, forward: Poly, box: tuple[float, float, float, float]) -> PolyMap:
        """`forward` with its inverse over the film's `box` (left, top, right, bottom)."""
        u, v = numpy.meshgrid(numpy.linspace(box[0], box[2], INVERSE_SAMPLES), numpy.linspace(box[1], box[3], INVERSE_SAMPLES))
        film = numpy.column_stack((u.ravel(), v.ravel()))
        return cls(forward, fit_poly(INVERSE_ORDER, forward(film), film))

    def to_places(self, film: FloatArray) -> FloatArray:
        return self.forward(film)

    def to_film(self, places: FloatArray) -> FloatArray:
        return self.inverse(places)


def pixel_ground_m(mapping: PlaceMap, film: FloatArray) -> float:
    """The coarser side of a film pixel at `film` (one point, 1 by 2), in ground metres."""
    probes = numpy.vstack((film, film + numpy.array([1.0, 0.0]), film + numpy.array([0.0, 1.0])))
    places = mapping.to_places(probes)
    _, lat = to_lnglat_arrays(places[:1, 0], places[:1, 1])
    longest = max(float(numpy.hypot(*(places[side] - places[0]))) for side in (1, 2))
    return longest * ground_scale(float(lat[0]))
