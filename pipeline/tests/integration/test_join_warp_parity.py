"""A part with nodes shows what its own warp shows, beyond the taper, on a frame that is no affine scan (M8-join-interfaces.md §3).

A warp through a part's points runs on GDAL's reverse transform, fitted apart from the forward one. On a panoramic frame the two
differ by tens of metres, so nodes built on the forward one moved the whole frame, and a figure read at the nodes never saw it.
These frames follow a tangent across the track, as a panoramic scan does; the warps are real, of a raster whose values are its own
pixel coordinates, so what each warp reads at a place is known.
"""

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import numpy
import numpy.typing
import pytest
from hcm_pipeline.documents import GeorefInfo
from hcm_pipeline.geo import FloatArray, to_lnglat, to_mercator
from hcm_pipeline.join.correction import TAPER_M, BaseTransform, Node, SeamField, largest_move_m, nodes_for
from hcm_pipeline.join.measure import SeamModel
from hcm_pipeline.join.seams import Seam
from hcm_pipeline.join.warping import base_transform, node_reverse, node_source
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import driver_of
from hcm_pipeline.steps.warp import gcp_source, warp_method

SIZE: Final = (1500, 1000)
PIXEL_ALONG_M: Final = 40.0
HALF_ACROSS_M: Final = 30000.0
ALTITUDE_M: Final = 150000.0
LAT: Final = 44.4
LNG: Final = 26.1
GROUND: Final = math.cos(math.radians(LAT))
OUTPUT_M: Final = 120.0
EDGE_M: Final = 600.0
FAR_M: Final = TAPER_M + 1500.0
# Past the taper a part equals its approved georeference: to a few metres at a far corner, where a spline's sparse nodes hold a curved
# transform least well, and that is a tenth of what such a frame's points are worth.
FAR_TYPICAL_M: Final = 2.5
FAR_WORST_M: Final = 10.0


@dataclass(frozen=True)
class Picture:
    """What a warp read at each output cell: scan pixel, alpha, and where each cell lies."""

    u: FloatArray
    v: FloatArray
    valid: numpy.typing.NDArray[numpy.bool_]
    x: FloatArray
    y: FloatArray


def coded_scan(target: Path) -> Path:
    dataset = driver_of("GTiff").Create(str(target), SIZE[0], SIZE[1], 2, gdal.GDT_Float32)
    u, v = numpy.meshgrid(numpy.arange(SIZE[0]) + 0.5, numpy.arange(SIZE[1]) + 0.5)
    dataset.GetRasterBand(1).WriteArray(u)
    dataset.GetRasterBand(2).WriteArray(v)
    dataset.Close()
    return target


def georef_of(off_nadir_deg: float, transform: str, count: int, noise_m: float) -> GeorefInfo:
    """The points a georeferencer would leave on a panoramic frame so far off nadir."""
    rng = numpy.random.default_rng(7)
    nadir = ALTITUDE_M * math.tan(math.radians(off_nadir_deg))
    start, end = math.atan((nadir - HALF_ACROSS_M) / ALTITUDE_M), math.atan((nadir + HALF_ACROSS_M) / ALTITUDE_M)
    u, v = rng.uniform(0, SIZE[0], count), rng.uniform(0, SIZE[1], count)
    east = ALTITUDE_M * numpy.tan(start + (end - start) * u / SIZE[0]) - nadir + rng.normal(0, noise_m, count)
    north = (SIZE[1] / 2 - v) * PIXEL_ALONG_M + rng.normal(0, noise_m, count)
    centre_x, centre_y = to_mercator(LNG, LAT)
    gcps = []
    for index in range(count):
        lng, lat = to_lnglat(centre_x + east[index] / GROUND, centre_y + north[index] / GROUND)
        pixel = {"x": float(u[index]), "y": float(v[index])}
        gcps.append({"id": f"g{index}", "pixel": pixel, "geo": {"lat": lat, "lng": lng}, "enabled": True, "origin": "auto"})
    return GeorefInfo.of({"method": "auto", "transform": transform, "gcps": gcps})


def west_edge_field(base: BaseTransform, shift_m: float) -> SeamField:
    """A seam along the frame's west edge, moving the part by `shift_m` on the ground there."""
    x, y, _ = base.forward(numpy.array([0.0, 0.0]), numpy.array([0.0, float(SIZE[1])]))
    line = numpy.column_stack((numpy.linspace(x[0], x[1], 101), numpy.linspace(y[0], y[1], 101)))
    axis = numpy.array([x[1] - x[0], y[1] - y[0]]) / float(numpy.hypot(x[1] - x[0], y[1] - y[0]))
    length_m = float(numpy.hypot(x[1] - x[0], y[1] - y[0])) * GROUND
    seam = Seam(0, 1, line, (float(x[0]), float(y[0])), (float(axis[0]), float(axis[1])), length_m, (), GROUND)
    return SeamField(seam, SeamModel((shift_m / GROUND,), (0.0,), -1e6, 1e6), 1.0)


def warped(source: Path, method: dict[str, object], bounds: tuple[float, float, float, float]) -> Picture:
    resolution = OUTPUT_M / GROUND
    dataset = gdal.Warp(
        "",
        str(source),
        format="MEM",
        outputBounds=bounds,
        dstSRS="EPSG:3857",
        xRes=resolution,
        yRes=resolution,
        resampleAlg="bilinear",
        dstAlpha=True,
        **method,
    )
    u, v, alpha = (numpy.asarray(dataset.GetRasterBand(band).ReadAsArray(), numpy.float64) for band in (1, 2, 3))
    left, step_x, _, top, _, step_y = dataset.GetGeoTransform()
    dataset.Close()
    x, y = numpy.meshgrid(left + (numpy.arange(u.shape[1]) + 0.5) * step_x, top + (numpy.arange(u.shape[0]) + 0.5) * step_y)
    return Picture(u, v, alpha == 255, x, y)


def bounds_of(base: BaseTransform) -> tuple[float, float, float, float]:
    x, y, _ = base.forward(numpy.array([0.0, SIZE[0], 0.0, SIZE[0]]), numpy.array([0.0, 0.0, SIZE[1], SIZE[1]]))
    inset = EDGE_M / GROUND
    return float(x.min()) + inset, float(y.min()) + inset, float(x.max()) - inset, float(y.max()) - inset


def moved_m(base: BaseTransform, own: Picture, through: Picture, good: numpy.typing.NDArray[numpy.bool_]) -> FloatArray:
    """How far apart the two warps show one scan pixel, on the ground: the pixel gap read through the part's transform."""
    own_x, own_y, _ = base.forward(own.u[good], own.v[good])
    new_x, new_y, _ = base.forward(through.u[good], through.v[good])
    return numpy.asarray(numpy.hypot(new_x - own_x, new_y - own_y) * GROUND, numpy.float64)


@dataclass(frozen=True)
class Rendered:
    base: BaseTransform
    nodes: tuple[Node, ...]
    own: Picture
    through: Picture
    good: numpy.typing.NDArray[numpy.bool_]
    far: numpy.typing.NDArray[numpy.bool_]


def rendered(tmp: Path, georef: GeorefInfo, shift_m: float) -> Rendered:
    """Both warps of one part, its nodes built by the join's own code."""
    scan = coded_scan(tmp / "scan.tif")
    base = base_transform(georef, SIZE)
    field = west_edge_field(base, shift_m)
    nodes = nodes_for(base, SIZE, [field])
    bounds = bounds_of(base)
    own = warped(gcp_source(scan, georef, tmp / "gcps.vrt"), warp_method(georef), bounds)
    through = warped(node_source(scan, nodes, tmp / "nodes.vrt"), {"tps": True}, bounds)
    good = own.valid & through.valid
    away_m = numpy.abs(own.x - float(field.seam.line[0, 0])) * GROUND
    return Rendered(base, nodes, own, through, good, good & (away_m > FAR_M))


@pytest.mark.parametrize(("off_nadir", "transform"), [(0.0, "poly2"), (25.0, "poly2"), (40.0, "poly2"), (25.0, "affine")])
def test_happy_path_past_the_taper_a_part_with_nodes_shows_what_its_own_warp_shows(
    tmp_path: Path, off_nadir: float, transform: str
) -> None:
    """Scenarios: S-P05-HAPPY-OFF-NADIR"""
    result = rendered(tmp_path, georef_of(off_nadir, transform, 60, 20.0), 1.0)

    assert int(result.far.sum()) > 1000
    moved = moved_m(result.base, result.own, result.through, result.far)
    assert float(numpy.percentile(moved, 95)) <= FAR_TYPICAL_M
    assert float(numpy.max(moved)) <= FAR_WORST_M


@pytest.mark.parametrize(("count", "noise_m"), [(120, 20.0), (300, 10.0)])
def test_happy_path_a_thin_plate_part_keeps_its_points_past_the_taper(tmp_path: Path, count: int, noise_m: float) -> None:
    georef = georef_of(25.0, "tps", count, noise_m)

    result = rendered(tmp_path, georef, 20.0)

    moved = moved_m(result.base, result.own, result.through, result.far)
    assert int(result.far.sum()) > 1000
    assert float(numpy.median(moved)) <= FAR_TYPICAL_M
    # Its own points stay nodes: a spline through them is the part's own again, beyond the field.
    pixels = {(round(node[0], 3), round(node[1], 3)) for node in result.nodes}
    assert {(round(gcp.x, 3), round(gcp.y, 3)) for gcp in georef.gcps} <= pixels


@pytest.mark.parametrize(("off_nadir", "transform", "count"), [(40.0, "poly2", 60), (25.0, "tps", 120), (25.0, "affine", 60)])
def test_happy_path_the_largest_move_is_what_a_warp_through_the_nodes_really_does(
    tmp_path: Path, off_nadir: float, transform: str, count: int
) -> None:
    result = rendered(tmp_path, georef_of(off_nadir, transform, count, 20.0), 20.0)

    reported = largest_move_m(result.base, result.nodes, node_reverse(result.nodes, SIZE), SIZE, GROUND)

    # The seam's own 20 m is the largest thing that moved: nothing past the taper is left out of the figure.
    assert reported == pytest.approx(20.0, abs=6.0)
    assert float(numpy.percentile(moved_m(result.base, result.own, result.through, result.good), 99)) <= reported + 1.0


def test_bad_path_a_spline_that_drifts_between_its_nodes_is_reported(tmp_path: Path) -> None:
    georef = georef_of(25.0, "tps", 120, 20.0)
    base = base_transform(georef, SIZE)
    # A coarse grid and no points of the part's own: what a spline holding only some of the part's detail would do.
    columns, rows = numpy.meshgrid(numpy.linspace(0.0, SIZE[0], 6), numpy.linspace(0.0, SIZE[1], 5))
    x, y, _ = base.forward(columns.ravel(), rows.ravel())
    u, v, _ = base.reverse(x, y)
    sparse = tuple(zip(u.tolist(), v.tolist(), x.tolist(), y.tolist(), strict=True))

    # At these nodes nothing moved; between them the part did, and the figure says so.
    assert largest_move_m(base, sparse, node_reverse(sparse, SIZE), SIZE, GROUND) > 10.0
