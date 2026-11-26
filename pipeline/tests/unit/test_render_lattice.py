"""What a warp renders: the fitted map through a lattice and a thin-plate spline (docs/research/M15-calibration-accuracy.md §1)."""

import json
import math
from pathlib import Path

import numpy
import pytest
from hcm_pipeline.calibrate.stored import StoredTiles
from hcm_pipeline.contract import MAX_GCPS
from hcm_pipeline.documents import GeorefInfo
from hcm_pipeline.frames import FrameLayout
from hcm_pipeline.geo import to_lnglat, to_mercator
from hcm_pipeline.georef.lattice import LATTICE_SIDE, Lattice, LatticeNode, sampled
from hcm_pipeline.georef.transforms import Gcp, enabled_gcps, fit_transform
from hcm_pipeline.model import DocumentError
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import WEB_MERCATOR, driver_of, srs_wkt
from hcm_pipeline.steps.locate import rad_per_px
from hcm_pipeline.steps.warp import gcp_source, rendered_points, warp_method

SIZE = (30000, 20000)


def curved_gcps(count: int = 40, seed: int = 5) -> tuple[Gcp, ...]:
    """Pairs over a 30,000 by 20,000 pixel scan whose map bends as a KH-9 crop's, 14 m of noise, the last five checks."""
    rng = numpy.random.default_rng(seed)
    found = []
    for index in range(count):
        x, y = float(rng.uniform(0, SIZE[0])), float(rng.uniform(0, SIZE[1]))
        mx = 2.9e6 + 1.6 * x + 2e-6 * x * x + 1e-6 * x * y + float(rng.normal(0, 14))
        my = 5.55e6 - 1.6 * y + 1.2e-6 * x * x + float(rng.normal(0, 14))
        lng, lat = to_lnglat(mx, my)
        found.append(Gcp(f"a{index:03d}", x, y, lat, lng, index < count - 5, "auto", 0.6))
    return tuple(found)


def gdal_reverse(points: list[tuple[float, float, float, float]], method: list[str]) -> tuple[gdal.Transformer, gdal.Dataset]:
    """GDAL's transformer of `points`, and the dataset holding them, which must outlive it."""
    dataset = driver_of("MEM").Create("", SIZE[0], SIZE[1], 0)
    dataset.SetGCPs([gdal.GCP(x, y, 0.0, column, row) for x, y, column, row in points], srs_wkt(WEB_MERCATOR))
    return gdal.Transformer(dataset, None, [*method, "DST_SRS=EPSG:3857"]), dataset


def pixel_error(points: list[tuple[float, float, float, float]], method: list[str], georef: GeorefInfo) -> float:
    """The largest pixel distance between where a warp through `points` reads and where the fit puts each place (a 21 x 21 grid)."""
    transform = fit_transform(georef.transform, enabled_gcps(georef.gcps))
    assert transform is not None
    x, y = numpy.meshgrid(numpy.linspace(0, SIZE[0], 21), numpy.linspace(0, SIZE[1], 21))
    mx, my = transform.to_mercator(x.ravel(), y.ravel())
    transformer, _dataset = gdal_reverse(points, method)
    read, _ = transformer.TransformPoints(1, numpy.column_stack((mx, my)).tolist())
    found = numpy.array(read)[:, :2]
    return float(numpy.hypot(found[:, 0] - x.ravel(), found[:, 1] - y.ravel()).max())


def test_happy_path_a_poly2_fit_renders_through_a_lattice_that_reproduces_it() -> None:
    """Scenarios: S-P06-HAPPY-RENDERED-FIT"""
    georef = GeorefInfo("auto", "poly2", curved_gcps())

    points = rendered_points(georef, SIZE)
    order2 = [(*to_mercator(gcp.lng, gcp.lat), gcp.x, gcp.y) for gcp in enabled_gcps(georef.gcps)]

    assert len(points) == LATTICE_SIDE * LATTICE_SIDE <= MAX_GCPS
    assert warp_method(georef) == {"tps": True}
    assert pixel_error(points, ["METHOD=GCP_TPS"], georef) < 1.0
    assert pixel_error(order2, ["METHOD=GCP_POLYNOMIAL", "MAX_GCP_ORDER=2"], georef) > 5.0


def test_happy_path_a_stored_lattice_is_what_renders(tmp_path: Path) -> None:
    """Scenarios: S-P06-HAPPY-RENDERED-FIT"""
    nodes = sampled(lambda x, y: (26.0 + x * 1e-5, 44.4 - y * 1e-5), *SIZE, side=3)
    georef = GeorefInfo("auto", "poly2", curved_gcps(), lattice=Lattice("panoramic", nodes))
    scan = tmp_path / "scan.tif"
    driver_of("GTiff").Create(str(scan), 64, 48, 1).Close()

    points = rendered_points(georef, SIZE)
    dataset = gdal.Open(str(gcp_source(scan, georef, tmp_path / "scan.vrt")))

    assert points == [node.as_point() for node in nodes]
    assert nodes[0] == LatticeNode(0.0, 0.0, 44.4, 26.0)
    assert len(dataset.GetGCPs()) == 9
    dataset.Close()


def test_bad_path_a_thin_plate_spline_or_a_degenerate_set_renders_through_its_own_points() -> None:
    """Scenarios: S-P06-BAD-RENDERED-OWN-POINTS"""
    gcps = curved_gcps()
    spline = GeorefInfo("gcps", "tps", gcps)
    line = tuple(Gcp(f"g{index}", 100.0 * index, 100.0 * index, 44.4, 26.0 + 0.001 * index) for index in range(6))

    assert len(rendered_points(spline, SIZE)) == len(enabled_gcps(gcps))
    assert len(rendered_points(GeorefInfo("gcps", "affine", line), SIZE)) == len(line)
    assert warp_method(GeorefInfo("embedded", "affine")) == {}


def test_happy_path_the_lattice_round_trips_through_the_document() -> None:
    """Scenarios: S-P06-HAPPY-PANORAMIC-CAMERA"""
    nodes = sampled(lambda x, y: (26.0 + x * 1e-5, 44.4 - y * 1e-5), *SIZE, side=2)
    georef = GeorefInfo("auto", "poly2", curved_gcps(), lattice=Lattice("panoramic", nodes))

    record = georef.as_record()
    again = GeorefInfo.of(json.loads(json.dumps(record)))

    assert again.lattice == georef.lattice
    assert "lattice" not in GeorefInfo("auto", "poly2", curved_gcps()).as_record()
    assert GeorefInfo.of({**record, "lattice": None}).lattice is None


@pytest.mark.parametrize(
    "lattice",
    [
        {"model": "poly3", "nodes": []},
        {"model": "panoramic"},
        {"model": "panoramic", "nodes": [{"pixel": {"x": 1}, "geo": {"lat": 1, "lng": 2}}]},
    ],
)
def test_bad_path_a_malformed_lattice_is_refused(lattice: object) -> None:
    """Scenarios: S-P06-BAD-RENDERED-OWN-POINTS"""
    record = GeorefInfo("auto", "poly2", curved_gcps()).as_record()

    with pytest.raises(DocumentError):
        GeorefInfo.of({**record, "lattice": lattice})


def test_happy_path_a_kh9_frame_stores_its_rate_and_another_camera_none(tmp_path: Path) -> None:
    """Scenarios: S-P06-HAPPY-PANORAMIC-CAMERA, S-P06-BAD-PANORAMIC-FALLS-BACK"""
    full = FrameLayout(480000, 23000, 16, (), 465000, 0)
    short = FrameLayout(200000, 23000, 16, (), 200000, 0)
    rows = numpy.zeros((2, 6))

    rate = rad_per_px("KH-9-pan", full)
    StoredTiles(rows, 2, 1, 2, 44.4, rate).write(tmp_path / "with.json")
    StoredTiles(rows, 2, 1, 2, 44.4).write(tmp_path / "without.json")

    assert rate == pytest.approx(math.radians(121) / (20.2 * 23000))
    assert rad_per_px("KH-9-pan", short) == pytest.approx(rate)
    assert rad_per_px("KH-7", full) is None
    assert StoredTiles.read(tmp_path / "with.json").rad_per_px == rate
    assert StoredTiles.read(tmp_path / "without.json").rad_per_px is None
