"""A KH-9 panoramic frame's map: the camera's angles under a soft prior and a second-order term (M15-calibration-accuracy.md §2).

A slit sweeps across the track, so a film column is a scan angle (`rad_per_px` a column, from the camera's sweep over its exposure) and
a film row an angle along the track. A ray through the film meets a flat plane under the camera; five angles shape it: the scan
angle at the tiles' middle, the pitch, the drift along and across the track per radian swept, and the slit's skew. Inside, the plane
goes to EPSG:3857 by a linear map plus a second-order polynomial of the film (the angles alone get stuck: M15 §2), solved by least
squares for any angles (variable projection); the angles by Levenberg-Marquardt from eleven starting scan angles, the best of each sign
and the next best followed while the tiles it keeps narrow from 80 to 25 m. Two cameras mirrored about the nadir hold the same tiles
within a tile or two, one through a second-order term tens of times larger that keeps bending beyond the tiles; of the cameras within
1 % of the most tiles the one with the smallest second-order term is kept (M15, review). Every gated tile counts, not a cell's
strongest: a map from about 100 pairs lies 3 to 5 m from the one all tiles hold (M15's error budget). Ground metres throughout, at
each tile's own latitude.

The prior holds each angle near nothing in units of a 20 m tile: pitch 0.25 rad (KH-9's cameras converge about 10 degrees), the
drifts 0.2 a radian, the skew 0.1; the scan angle is free. Fitted on 1,000 tiles in about 0.2 s.
"""

import math
from dataclasses import dataclass
from typing import Final

import numpy

from hcm_pipeline.calibrate.poly import Mask, ground_scale_of
from hcm_pipeline.geo import FloatArray, to_lnglat_arrays

PRIOR_SIGMA: Final = numpy.array([numpy.inf, 0.25, 0.2, 0.2, 0.1])
PRIOR_TILE_M: Final = 20.0
NARROWING_M: Final = (80.0, 60.0, 40.0, 25.0, 25.0)
KEPT_M: Final = 25.0
START_DEG: Final = tuple(range(-60, 61, 12))
FOLLOWED: Final = 3
# Two cameras mirrored about the nadir hold the same tiles within a tile or two (A001: 700 and 698); the one that needs a second-order
# term of 8.7 km where the other needs 0.3 km parts from it by up to 23 m beyond the tiles. Within 1 % of the most, the plainest is kept.
NEAR_KEPT_SHARE: Final = 0.99
STEPS: Final = numpy.array([1e-3, 1e-3, 1e-3, 1e-3, 1e-4])
ITERATIONS: Final = 6
TRIES: Final = 5
MIN_KEPT: Final = 20
MAX_STEP: Final = 0.3
MAX_SCAN_RAD: Final = 1.25
MAX_PITCH_RAD: Final = 0.5
DAMPING: Final = 1e-3
SPREAD_SHARE: Final = 3.0
# At least this many tiles before a panoramic fit is tried: below it the frame keeps its polynomial.
MIN_PANORAMIC_TILES: Final = 60
# The cameras fitted so (M15 §2): KH-7 and KH-9 mapping keep their polynomial; the KH-4 panoramic cameras were never measured.
PANORAMIC_MAP_SENSORS: Final = frozenset({"KH-9-pan"})


@dataclass(frozen=True)
class Frame:
    """The film's frame for a fit: radians a column, the tiles' middle and spread (film pixels)."""

    rad_per_px: float
    centre: FloatArray
    spread: FloatArray

    @classmethod
    def of(cls, film: FloatArray, rad_per_px: float) -> Frame:
        return cls(rad_per_px, film.mean(axis=0), numpy.maximum(film.std(axis=0) * SPREAD_SHARE, 1.0))

    def rays(self, film: FloatArray, angles: FloatArray) -> FloatArray:
        """Film pixels to the plane under the camera, at a height of 1."""
        scan, pitch, along, across, skew = angles.tolist()
        x, y = (film - self.centre).T
        theta = scan + self.rad_per_px * (x + skew * y)
        dx, dy, dz = self.rad_per_px * y, numpy.sin(theta), -numpy.cos(theta)
        dx, dz = dx * math.cos(pitch) - dz * math.sin(pitch), dx * math.sin(pitch) + dz * math.cos(pitch)
        swept = theta - scan
        return numpy.column_stack((along * swept - dx / dz, across * swept - dy / dz))

    def curved(self, film: FloatArray) -> FloatArray:
        u, v = ((film - self.centre) / self.spread).T
        return numpy.column_stack((u * u, u * v, v * v))


def _design(frame: Frame, film: FloatArray, angles: FloatArray, scale: tuple[FloatArray, FloatArray] | None = None) -> FloatArray:
    rays = frame.rays(film, angles)
    mean, spread = scale if scale is not None else (rays.mean(axis=0), rays.std(axis=0) + 1e-12)
    rays = (rays - mean) / spread
    return numpy.column_stack((numpy.ones(len(film)), rays, frame.curved(film)))


def _ray_scale(frame: Frame, film: FloatArray, angles: FloatArray) -> tuple[FloatArray, FloatArray]:
    rays = frame.rays(film, angles)
    return rays.mean(axis=0), rays.std(axis=0) + 1e-12


@dataclass(frozen=True)
class _Tiles:
    """What a fit reads: film pixels, EPSG:3857 places, each one's ground scale and the square root of its weight (a film tie of a
    frame held still counts more than a Sentinel-2 tile: `joint.py`)."""

    film: FloatArray
    places: FloatArray
    scale: FloatArray
    root_weight: FloatArray

    def kept(self, keep: Mask) -> _Tiles:
        return _Tiles(self.film[keep], self.places[keep], self.scale[keep], self.root_weight[keep])


def _solved(design: FloatArray, tiles: _Tiles) -> FloatArray:
    """The linear part by weighted least squares."""
    weight = tiles.root_weight[:, None]
    return numpy.asarray(numpy.linalg.lstsq(design * weight, tiles.places * weight, rcond=None)[0], numpy.float64)


def _residuals(frame: Frame, tiles: _Tiles, angles: FloatArray, prior: bool) -> FloatArray:
    design = _design(frame, tiles.film, angles)
    coefficients = _solved(design, tiles)
    misfit = ((design @ coefficients - tiles.places) * (tiles.scale * tiles.root_weight)[:, None]).ravel()
    return numpy.concatenate((misfit, PRIOR_TILE_M * angles / PRIOR_SIGMA)) if prior else misfit


def _bounded(angles: FloatArray) -> FloatArray:
    bounded = angles.copy()
    bounded[0] = numpy.clip(bounded[0], -MAX_SCAN_RAD, MAX_SCAN_RAD)
    bounded[1] = numpy.clip(bounded[1], -MAX_PITCH_RAD, MAX_PITCH_RAD)
    return bounded


def _jacobian(frame: Frame, tiles: _Tiles, angles: FloatArray, base: FloatArray) -> FloatArray:
    steps = numpy.eye(len(angles)) * STEPS
    return numpy.column_stack(
        [(_residuals(frame, tiles, angles + step, True) - base) / size for step, size in zip(steps, STEPS, strict=True)]
    )


def _step(frame: Frame, tiles: _Tiles, angles: FloatArray, damping: float) -> tuple[FloatArray, float] | None:
    """One damped step that lowers the misfit, and the damping that found it; None when no damping does."""
    base = _residuals(frame, tiles, angles, True)
    jacobian = _jacobian(frame, tiles, angles, base)
    normal, gradient = jacobian.T @ jacobian, jacobian.T @ base
    for _ in range(TRIES):
        delta = numpy.linalg.solve(normal + damping * numpy.diag(numpy.diag(normal) + 1e-12), -gradient)
        moved = _bounded(angles + numpy.clip(delta, -MAX_STEP, MAX_STEP))
        if float(numpy.sum(_residuals(frame, tiles, moved, True) ** 2)) < float(numpy.sum(base**2)):
            return moved, max(damping / 3, 1e-9)
        damping *= 4
    return None


def _refined(frame: Frame, tiles: _Tiles, angles: FloatArray) -> FloatArray:
    """Levenberg-Marquardt on the angles, a few steps."""
    damping = DAMPING
    for _ in range(ITERATIONS):
        found = _step(frame, tiles, angles, damping)
        if found is None:
            break
        angles, damping = found
    return angles


def _errors_m(frame: Frame, tiles: _Tiles, keep: Mask, angles: FloatArray) -> FloatArray:
    design = _design(frame, tiles.film, angles)
    coefficients = _solved(design[keep], tiles.kept(keep))
    return numpy.asarray(numpy.hypot(*(design @ coefficients - tiles.places).T) * tiles.scale, numpy.float64)


def _followed(frame: Frame, tiles: _Tiles, start: FloatArray) -> tuple[FloatArray, Mask]:
    """The angles from `start`, the tiles kept narrowing; the angles and the last kept tiles."""
    angles, keep = start, numpy.ones(len(tiles.film), numpy.bool_)
    for reach in NARROWING_M:
        angles = _refined(frame, tiles.kept(keep), angles)
        within = _errors_m(frame, tiles, keep, angles) < reach
        keep = within if numpy.count_nonzero(within) > MIN_KEPT else keep
    return angles, keep


@dataclass(frozen=True)
class PanoramicMap:
    """Film pixels to EPSG:3857 metres through the fitted camera; `kept` the tiles within 25 m of it."""

    frame: Frame
    angles: FloatArray
    ray_mean: FloatArray
    ray_spread: FloatArray
    coefficients: FloatArray
    kept: int

    def to_places(self, film: FloatArray) -> FloatArray:
        design = _design(self.frame, film, self.angles, (self.ray_mean, self.ray_spread))
        return numpy.asarray(design @ self.coefficients, numpy.float64)

    @property
    def curvature_m(self) -> float:
        """The second-order term's size: EPSG:3857 metres at one spread from the tiles' middle."""
        return float(numpy.linalg.norm(self.coefficients[3:]))


def _scored(frame: Frame, tiles: _Tiles, angles: FloatArray, keep: Mask) -> PanoramicMap:
    mean, spread = _ray_scale(frame, tiles.film, angles)
    design = _design(frame, tiles.film, angles, (mean, spread))
    coefficients = _solved(design[keep], tiles.kept(keep))
    errors = numpy.hypot(*(design @ coefficients - tiles.places).T) * tiles.scale
    kept = int(numpy.count_nonzero(errors < KEPT_M))
    return PanoramicMap(frame, angles, mean, spread, coefficients, kept)


def _starts(frame: Frame, tiles: _Tiles) -> list[FloatArray]:
    """The starts followed: the best of each sign of the scan angle, so both mirror cameras are tried, then the next best."""
    starts = [numpy.array([math.radians(degrees), 0.0, 0.0, 0.0, 0.0]) for degrees in START_DEG]
    scans = numpy.array([start[0] for start in starts])
    order = numpy.argsort([float(numpy.mean(_residuals(frame, tiles, start, False) ** 2)) for start in starts], kind="stable")
    sides = numpy.array([order[scans[order] < 0][0], order[scans[order] >= 0][0]])
    chosen = numpy.concatenate((sides, order[~numpy.isin(order, sides)]))[:FOLLOWED]
    return [starts[index] for index in chosen.tolist()]


def plainest(fits: list[PanoramicMap]) -> PanoramicMap:
    """Of the cameras that hold within 1 % of the most tiles, the one whose second-order term is smallest (module docstring)."""
    most = max(fit.kept for fit in fits)
    near = [fit for fit in fits if fit.kept >= NEAR_KEPT_SHARE * most]
    return min(near, key=lambda fit: fit.curvature_m)


def fit_panoramic(film: FloatArray, places: FloatArray, rad_per_px: float, weights: FloatArray | None = None) -> PanoramicMap | None:
    """The plainest panoramic map that holds nearly the most tiles; None with too few tiles. Deterministic: the starts are fixed.
    `weights`, each row's (none: all 1)."""
    if len(film) < MIN_PANORAMIC_TILES:
        return None
    frame = Frame.of(film, rad_per_px)
    _, lat = to_lnglat_arrays(places[:, 0], places[:, 1])
    root = numpy.ones(len(film)) if weights is None else numpy.sqrt(weights)
    tiles = _Tiles(film, places, ground_scale_of(lat), root)
    return plainest([_scored(frame, tiles, *_followed(frame, tiles, start)) for start in _starts(frame, tiles)])
