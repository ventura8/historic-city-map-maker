"""The map a warp renders over terrain: a rational cubic from longitude, latitude and height to the scan (M15, *Terrain*).

A frame corrected for terrain shows each place at a film pixel that depends on the height there, which a lattice of 17 x 17 nodes cannot
hold (11 m RMS lost on A001; 2 m with 49 x 49). GDAL renders such a map natively: rational polynomial coefficients (RPC00B, the
twenty terms below) with a surface model (`gdalwarp -rpc -to RPC_DEM=...`), each output pixel's place and height straight to the scan.
The coefficients are fitted on the map itself, a grid over the scan at five heights; the camera's rays are rational, and the fit holds
them within a thousandth of a pixel on the real frames. GDAL reads RPC lines and samples at pixel centres: the fit takes half a pixel off.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Final

import numpy

from hcm_pipeline.geo import FloatArray
from hcm_pipeline.model import Record

TERMS: Final = 20
GRID_SIDE: Final = 25
HEIGHT_LEVELS: Final = 5
ITERATIONS: Final = 10
# A fit off by more than this anywhere on its own samples is no map to render through (scan pixels).
MAX_ERROR_PX: Final = 0.5
CENTRE_PX: Final = 0.5
MIN_SCALE: Final = 1e-9
OFFSET_KEYS: Final = ("line", "samp", "lat", "lng", "height")
GDAL_NAMES: Final = {"line": "LINE", "samp": "SAMP", "lat": "LAT", "lng": "LONG", "height": "HEIGHT"}
COEFFICIENT_KEYS: Final = ("lineNum", "lineDen", "sampNum", "sampDen")
GDAL_COEFFICIENTS: Final = {
    "lineNum": "LINE_NUM_COEFF",
    "lineDen": "LINE_DEN_COEFF",
    "sampNum": "SAMP_NUM_COEFF",
    "sampDen": "SAMP_DEN_COEFF",
}

# Film pixels (scan.tif) and a height in metres to longitudes and latitudes.
GroundAt = Callable[[FloatArray, float], tuple[FloatArray, FloatArray]]


def terms(lng: FloatArray, lat: FloatArray, height: FloatArray) -> FloatArray:
    """The RPC00B terms of normalised longitude L, latitude P and height H, in GDAL's order."""
    one = numpy.ones_like(lng)
    big_l, big_p, big_h = lng, lat, height
    return numpy.column_stack(
        (
            one,
            big_l,
            big_p,
            big_h,
            big_l * big_p,
            big_l * big_h,
            big_p * big_h,
            big_l * big_l,
            big_p * big_p,
            big_h * big_h,
            big_p * big_l * big_h,
            big_l**3,
            big_l * big_p * big_p,
            big_l * big_h * big_h,
            big_l * big_l * big_p,
            big_p**3,
            big_p * big_h * big_h,
            big_l * big_l * big_h,
            big_p * big_p * big_h,
            big_h**3,
        )
    )


@dataclass(frozen=True)
class Rpc:
    """`georef.terrain.rpc`: offsets and scales by `OFFSET_KEYS`, the four sets of twenty coefficients by `COEFFICIENT_KEYS`."""

    offset: Mapping[str, float]
    scale: Mapping[str, float]
    coefficients: Mapping[str, tuple[float, ...]]

    def _normalised(self, lng: FloatArray, lat: FloatArray, height: FloatArray) -> FloatArray:
        def norm(key: str, value: FloatArray) -> FloatArray:
            return (value - self.offset[key]) / self.scale[key]

        return terms(norm("lng", lng), norm("lat", lat), norm("height", height))

    def to_pixel(self, lng: FloatArray, lat: FloatArray, height: FloatArray) -> FloatArray:
        """Scan pixels (GDAL's corner convention) of places at heights, as GDAL's RPC transformer computes them."""
        design = self._normalised(lng, lat, height)

        def axis(name: str) -> FloatArray:
            ratio = (design @ numpy.array(self.coefficients[f"{name}Num"])) / (design @ numpy.array(self.coefficients[f"{name}Den"]))
            return numpy.asarray(ratio * self.scale[name] + self.offset[name] + CENTRE_PX, numpy.float64)

        return numpy.column_stack((axis("samp"), axis("line")))

    def as_record(self) -> Record:
        return {
            "offset": {key: self.offset[key] for key in OFFSET_KEYS},
            "scale": {key: self.scale[key] for key in OFFSET_KEYS},
            **{key: list(self.coefficients[key]) for key in COEFFICIENT_KEYS},
        }

    def metadata(self) -> dict[str, str]:
        """GDAL's `RPC` metadata domain."""
        found = {f"{GDAL_NAMES[key]}_OFF": repr(self.offset[key]) for key in OFFSET_KEYS}
        found |= {f"{GDAL_NAMES[key]}_SCALE": repr(self.scale[key]) for key in OFFSET_KEYS}
        return found | {GDAL_COEFFICIENTS[key]: " ".join(repr(value) for value in self.coefficients[key]) for key in COEFFICIENT_KEYS}

    @classmethod
    def of(cls, record: object) -> Rpc:
        """A stored `rpc`; ValueError when it is not one."""
        if not isinstance(record, dict):
            raise ValueError("georef.terrain.rpc is not an object")
        offset, scale = _numbers(record.get("offset"), OFFSET_KEYS), _numbers(record.get("scale"), OFFSET_KEYS)
        coefficients = {key: _coefficients(record.get(key)) for key in COEFFICIENT_KEYS}
        return cls(dict(zip(OFFSET_KEYS, offset, strict=True)), dict(zip(OFFSET_KEYS, scale, strict=True)), coefficients)


def _number(value: object) -> float:
    """A number, never a bool; ValueError otherwise."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError("georef.terrain.rpc lacks a number")
    return float(value)


def _plain(values: Sequence[object]) -> list[float]:
    return [_number(value) for value in values]


def _numbers(record: object, keys: Sequence[str]) -> list[float]:
    return _plain([record.get(key) for key in keys] if isinstance(record, dict) else [None])


def _coefficients(values: object) -> tuple[float, ...]:
    if not isinstance(values, list) or len(values) != TERMS:
        raise ValueError("georef.terrain.rpc needs twenty coefficients a set")
    return tuple(_plain(values))


def _rational(design: FloatArray, target: FloatArray) -> tuple[FloatArray, FloatArray]:
    """Numerator and denominator (its first term 1) by least squares, the denominator's weight refined each time."""
    weight = numpy.ones(len(design))
    numerator, denominator = numpy.zeros(TERMS), numpy.eye(TERMS)[0]
    for _ in range(ITERATIONS):
        system = numpy.column_stack((design, -target[:, None] * design[:, 1:])) / weight[:, None]
        solution = numpy.linalg.lstsq(system, target / weight, rcond=None)[0]
        numerator, denominator = solution[:TERMS], numpy.concatenate(([1.0], solution[TERMS:]))
        weight = design @ denominator
    return numerator, denominator


def _offset_scale(values: FloatArray) -> tuple[float, float]:
    low, high = float(values.min()), float(values.max())
    return (low + high) / 2, max((high - low) / 2, MIN_SCALE)


def _samples(ground_at: GroundAt, size: tuple[int, int], heights_m: tuple[float, float]) -> dict[str, FloatArray]:
    """The map on a grid over the scan at `HEIGHT_LEVELS` heights: longitude, latitude, height, and the RPC's sample and line."""
    x, y = numpy.meshgrid(numpy.linspace(0.0, size[0], GRID_SIDE), numpy.linspace(0.0, size[1], GRID_SIDE))
    film = numpy.column_stack((x.ravel(), y.ravel()))
    levels = numpy.linspace(heights_m[0], heights_m[1], HEIGHT_LEVELS)
    grounds = [ground_at(film, float(level)) for level in levels]
    pixels = numpy.tile(film - CENTRE_PX, (HEIGHT_LEVELS, 1))
    return {
        "lng": numpy.concatenate([ground[0] for ground in grounds]),
        "lat": numpy.concatenate([ground[1] for ground in grounds]),
        "height": numpy.repeat(levels, len(film)),
        "samp": pixels[:, 0],
        "line": pixels[:, 1],
    }


def fit_rpc(ground_at: GroundAt, size: tuple[int, int], heights_m: tuple[float, float]) -> Rpc | None:
    """The RPC of a map over a scan of `size` and heights in `heights_m`; None when it cannot hold the map (`MAX_ERROR_PX`)."""
    named = _samples(ground_at, size, heights_m)
    bounds = {key: _offset_scale(values) for key, values in named.items()}
    rpc = _fitted(named, {key: value[0] for key, value in bounds.items()}, {key: value[1] for key, value in bounds.items()})
    shown = rpc.to_pixel(named["lng"], named["lat"], named["height"]) - CENTRE_PX
    error = numpy.hypot(shown[:, 0] - named["samp"], shown[:, 1] - named["line"])
    return rpc if float(error.max()) <= MAX_ERROR_PX else None


def _fitted(named: Mapping[str, FloatArray], offset: Mapping[str, float], scale: Mapping[str, float]) -> Rpc:
    def norm(key: str) -> FloatArray:
        return (named[key] - offset[key]) / scale[key]

    design = terms(norm("lng"), norm("lat"), norm("height"))
    line, samp = _rational(design, norm("line")), _rational(design, norm("samp"))
    coefficients = {"lineNum": line[0], "lineDen": line[1], "sampNum": samp[0], "sampDen": samp[1]}
    return Rpc(dict(offset), dict(scale), {key: tuple(float(v) for v in value) for key, value in coefficients.items()})
