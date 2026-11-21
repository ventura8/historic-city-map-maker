"""Transforms through ground control points: affine, second-order polynomial and thin-plate spline (numpy).

The Python half of docs/research/M3-interfaces.md §6 (the TypeScript half is `packages/shared/src/georef/`; both
reproduce `pipeline/tests/contracts/georef-cases.json`). A GCP pairs a full-resolution scan pixel with a WGS84
place; fits run from pixels to EPSG:3857 metres; residuals are ground metres (the Mercator distance times the
cosine of the pair's latitude). `fitRmseM` is over the enabled pairs; `checkpointRmseM` over the disabled pairs
when there are any, else leave-one-out over the enabled ones; an enabled pair's residual is its leave-one-out
residual. A set is degenerate when its pixels or places are collinear or coincident: the design matrix's condition
number over 1e12, or the convex hull's area under 1 % of the bounding box's.
"""

import enum
import math
from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import Final

import numpy

from hcm_pipeline.contract import MIN_GCPS
from hcm_pipeline.geo import FloatArray, to_lnglat_arrays, to_mercator_arrays

MAX_CONDITION: Final = 1e12
MIN_HULL_SHARE: Final = 0.01
RESIDUAL_DIGITS: Final = 2
# Fewer distinct points than this enclose no area; the poly2 inverse is fitted on a grid of this many points a side.
MIN_HULL_POINTS: Final = 3
INVERSE_GRID: Final = 15


class FitRefusal(enum.Enum):
    TOO_FEW = "too-few"
    DEGENERATE = "degenerate"


@dataclass(frozen=True)
class Gcp:
    """One ground control point (`gcpSchema` of `@hcm/shared`)."""

    id: str
    x: float
    y: float
    lat: float
    lng: float
    enabled: bool = True
    origin: str = "manual"
    score: float | None = None
    residual_m: float | None = None

    def as_record(self) -> dict[str, object]:
        record: dict[str, object] = {
            "id": self.id,
            "pixel": {"x": _short(self.x), "y": _short(self.y)},
            "geo": {"lat": round(self.lat, 9), "lng": round(self.lng, 9)},
            "enabled": self.enabled,
            "origin": self.origin,
        }
        if self.score is not None:
            record["score"] = round(self.score, 3)
        if self.residual_m is not None:
            record["residualM"] = round(self.residual_m, RESIDUAL_DIGITS)
        return record


def _short(value: float) -> float | int:
    """A pixel coordinate as JSON keeps it: an int when it is whole, else two decimals."""
    rounded = round(value, 2)
    return int(rounded) if rounded.is_integer() else rounded


@dataclass(frozen=True)
class _Normalizer:
    """Centre and scale of a point set, so design matrices stay well conditioned."""

    cx: float
    cy: float
    scale: float

    @classmethod
    def of(cls, x: FloatArray, y: FloatArray) -> _Normalizer:
        spread = float(max(numpy.ptp(x), numpy.ptp(y)))
        return cls(float(numpy.mean(x)), float(numpy.mean(y)), spread if spread > 0 else 1.0)

    def apply(self, x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray]:
        return (x - self.cx) / self.scale, (y - self.cy) / self.scale


def _design(kind: str, u: FloatArray, v: FloatArray) -> FloatArray:
    ones = numpy.ones_like(u)
    if kind == "poly2":
        return numpy.column_stack((ones, u, v, u * u, u * v, v * v))
    return numpy.column_stack((ones, u, v))


def _kernel(du: FloatArray, dv: FloatArray) -> FloatArray:
    """The thin-plate spline's radial basis r² log r (0 at r = 0)."""
    r2 = du * du + dv * dv
    return numpy.where(r2 > 0, 0.5 * r2 * numpy.log(numpy.where(r2 > 0, r2, 1.0)), 0.0)


@dataclass(frozen=True)
class _Mapping:
    """One direction of a fitted transform: normalized source → target offsets."""

    kind: str
    source: _Normalizer
    target: _Normalizer
    coefficients: FloatArray
    nodes: FloatArray

    def __call__(self, x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray]:
        u, v = self.source.apply(numpy.asarray(x, numpy.float64), numpy.asarray(y, numpy.float64))
        basis = _design("affine" if self.kind == "tps" else self.kind, u.ravel(), v.ravel())
        if self.kind == "tps":
            basis = numpy.column_stack((_kernel(u.ravel()[:, None] - self.nodes[:, 0], v.ravel()[:, None] - self.nodes[:, 1]), basis))
        values = basis @ self.coefficients
        shape = numpy.shape(u)
        tx = values[:, 0].reshape(shape) * self.target.scale + self.target.cx
        ty = values[:, 1].reshape(shape) * self.target.scale + self.target.cy
        return tx, ty


def _solve(kind: str, sx: FloatArray, sy: FloatArray, tx: FloatArray, ty: FloatArray) -> _Mapping | None:
    """The least-squares (or, for `tps`, exact) mapping from (sx, sy) to (tx, ty); None when it is degenerate."""
    source, target = _Normalizer.of(sx, sy), _Normalizer.of(tx, ty)
    u, v = source.apply(sx, sy)
    goal = numpy.column_stack(target.apply(tx, ty))
    if kind == "tps":
        return _solve_tps(source, target, numpy.column_stack((u, v)), goal)
    design = _design(kind, u, v)
    if numpy.linalg.cond(design) > MAX_CONDITION:
        return None
    coefficients = numpy.linalg.lstsq(design, goal, rcond=None)[0]
    return _Mapping(kind, source, target, coefficients, numpy.empty((0, 2)))


def _solve_tps(source: _Normalizer, target: _Normalizer, nodes: FloatArray, goal: FloatArray) -> _Mapping | None:
    kernel = _kernel(nodes[:, 0][:, None] - nodes[:, 0], nodes[:, 1][:, None] - nodes[:, 1])
    affine = _design("affine", nodes[:, 0], nodes[:, 1])
    system = numpy.block([[kernel, affine], [affine.T, numpy.zeros((3, 3))]])
    if numpy.linalg.cond(system) > MAX_CONDITION:
        return None
    coefficients = numpy.linalg.solve(system, numpy.vstack((goal, numpy.zeros((3, 2)))))
    return _Mapping("tps", source, target, coefficients, nodes.copy())


def _hull_area(x: FloatArray, y: FloatArray) -> float:
    """The area of the convex hull of the points (Andrew's monotone chain)."""
    points = sorted(set(zip(x.tolist(), y.tolist(), strict=True)))
    if len(points) < MIN_HULL_POINTS:
        return 0.0
    hull = _half_hull(points) + _half_hull(points[::-1])
    return 0.5 * abs(sum(ax * by - bx * ay for (ax, ay), (bx, by) in zip(hull, hull[1:] + hull[:1], strict=True)))


def _half_hull(points: Sequence[tuple[float, float]]) -> list[tuple[float, float]]:
    chain: list[tuple[float, float]] = []
    for point in points:
        while len(chain) >= MIN_HULL_POINTS - 1 and _cross(chain[-2], chain[-1], point) <= 0:
            chain.pop()
        chain.append(point)
    return chain[:-1]


def _cross(o: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def spread_share(x: FloatArray, y: FloatArray) -> float:
    """The convex hull's area over the bounding box's (0 for collinear or coincident points)."""
    box = float(numpy.ptp(x) * numpy.ptp(y))
    return _hull_area(x, y) / box if box > 0 else 0.0


def is_degenerate(x: FloatArray, y: FloatArray) -> bool:
    return spread_share(x, y) < MIN_HULL_SHARE


@dataclass(frozen=True)
class Transform:
    """A fitted transform: scan pixels to EPSG:3857 metres, and back (the inverse fit)."""

    kind: str
    forward: _Mapping
    inverse: _Mapping

    def to_mercator(self, x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray]:
        return self.forward(x, y)

    def to_pixel(self, mx: FloatArray, my: FloatArray) -> tuple[FloatArray, FloatArray]:
        return self.inverse(mx, my)

    def to_lnglat(self, x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray]:
        return to_lnglat_arrays(*self.forward(x, y))


@dataclass(frozen=True)
class Fit:
    """A transform with its errors; `gcps` carry their residuals (leave-one-out for the enabled ones)."""

    transform: Transform
    gcps: tuple[Gcp, ...]
    fit_rmse_m: float
    checkpoint_rmse_m: float | None
    checkpoint_count: int

    @property
    def checkpoint_kind(self) -> str | None:
        """`held-out` for disabled pairs, `leave-one-out` when the figure comes from the enabled ones (only the first auto-approves)."""
        if self.checkpoint_count == 0:
            return None
        return "held-out" if any(not gcp.enabled for gcp in self.gcps) else "leave-one-out"


@dataclass(frozen=True)
class _Pairs:
    """The pixels and the Mercator places of a GCP list, as arrays."""

    px: FloatArray
    py: FloatArray
    mx: FloatArray
    my: FloatArray
    lat: FloatArray

    @classmethod
    def of(cls, gcps: Sequence[Gcp]) -> _Pairs:
        lng = numpy.array([gcp.lng for gcp in gcps], numpy.float64)
        lat = numpy.array([gcp.lat for gcp in gcps], numpy.float64)
        mx, my = to_mercator_arrays(lng, lat)
        return cls(numpy.array([gcp.x for gcp in gcps], numpy.float64), numpy.array([gcp.y for gcp in gcps], numpy.float64), mx, my, lat)

    def degenerate(self) -> bool:
        return is_degenerate(self.px, self.py) or is_degenerate(self.mx, self.my)


def _inverse_grid(forward: _Mapping, pairs: _Pairs) -> _Mapping | None:
    """A second-order inverse fitted on a grid over the pairs' pixels mapped forward (a quadratic has no exact inverse)."""
    gx, gy = numpy.meshgrid(
        numpy.linspace(pairs.px.min(), pairs.px.max(), INVERSE_GRID), numpy.linspace(pairs.py.min(), pairs.py.max(), INVERSE_GRID)
    )
    fx, fy = forward(gx.ravel(), gy.ravel())
    return _solve("poly2", fx, fy, gx.ravel(), gy.ravel())


def _inverse(kind: str, forward: _Mapping, pairs: _Pairs) -> _Mapping | None:
    if kind == "poly2":
        return _inverse_grid(forward, pairs)
    if kind == "tps":
        return _solve("tps", pairs.mx, pairs.my, pairs.px, pairs.py)
    fx, fy = forward(pairs.px, pairs.py)
    return _solve("affine", fx, fy, pairs.px, pairs.py)


def fit_transform(kind: str, gcps: Sequence[Gcp]) -> Transform | None:
    """The transform of `kind` through every pair given (enabled or not); None when they are degenerate."""
    pairs = _Pairs.of(gcps)
    if pairs.degenerate():
        return None
    forward = _solve(kind, pairs.px, pairs.py, pairs.mx, pairs.my)
    inverse = None if forward is None else _inverse(kind, forward, pairs)
    return None if forward is None or inverse is None else Transform(kind, forward, inverse)


def residuals_m(transform: Transform, gcps: Sequence[Gcp]) -> FloatArray:
    """Ground metres between each pair's place and where the transform puts its pixel."""
    pairs = _Pairs.of(gcps)
    fx, fy = transform.to_mercator(pairs.px, pairs.py)
    return numpy.hypot(fx - pairs.mx, fy - pairs.my) * numpy.cos(numpy.radians(pairs.lat))


def rmse(values: Sequence[float]) -> float:
    return math.sqrt(sum(value * value for value in values) / len(values)) if values else 0.0


def _left_out(kind: str, enabled: Sequence[Gcp], index: int) -> float | None:
    rest = [gcp for position, gcp in enumerate(enabled) if position != index]
    transform = fit_transform(kind, rest) if len(rest) >= MIN_GCPS[kind] else None
    return None if transform is None else float(residuals_m(transform, [enabled[index]])[0])


def leave_one_out(kind: str, enabled: Sequence[Gcp]) -> dict[str, float]:
    """Each enabled pair's residual against the transform fitted without it (pairs whose remainder cannot fit are left out)."""
    found = {gcp.id: _left_out(kind, enabled, index) for index, gcp in enumerate(enabled)}
    return {gcp_id: value for gcp_id, value in found.items() if value is not None}


def _with_residuals(gcps: Sequence[Gcp], fitted: dict[str, float], held_out: dict[str, float]) -> tuple[Gcp, ...]:
    return tuple(replace(gcp, residual_m=held_out.get(gcp.id) if gcp.enabled else fitted[gcp.id]) for gcp in gcps)


def _checks(gcps: Sequence[Gcp], fitted: dict[str, float], held_out: dict[str, float]) -> list[float]:
    """The checkpoint residuals: the disabled pairs' when there are any, else the leave-one-out ones."""
    return [fitted[gcp.id] for gcp in gcps if not gcp.enabled] or list(held_out.values())


def _measured(kind: str, transform: Transform, gcps: Sequence[Gcp], enabled: Sequence[Gcp]) -> Fit:
    fitted = dict(zip([gcp.id for gcp in gcps], residuals_m(transform, gcps).tolist(), strict=True))
    held_out = leave_one_out(kind, enabled)
    checks = _checks(gcps, fitted, held_out)
    return Fit(
        transform=transform,
        gcps=_with_residuals(gcps, fitted, held_out),
        fit_rmse_m=rmse(residuals_m(transform, enabled).tolist()),
        checkpoint_rmse_m=rmse(checks) if checks else None,
        checkpoint_count=len(checks),
    )


def enabled_gcps(gcps: Sequence[Gcp]) -> list[Gcp]:
    return [gcp for gcp in gcps if gcp.enabled]


def fit(kind: str, gcps: Sequence[Gcp]) -> Fit | FitRefusal:
    """The fit of `kind` through the enabled pairs, with its residuals and checkpoint error (§6.1)."""
    enabled = enabled_gcps(gcps)
    if len(enabled) < MIN_GCPS[kind]:
        return FitRefusal.TOO_FEW
    transform = fit_transform(kind, enabled)
    if transform is None:
        return FitRefusal.DEGENERATE
    return _measured(kind, transform, gcps, enabled)
