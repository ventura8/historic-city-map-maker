"""The frames of a join, the plan `align` hands `merge`, and the grids they share (docs/research/M8-join-interfaces.md §3)."""

from pathlib import Path

import numpy
import pytest
from hcm_pipeline.contract import Errors
from hcm_pipeline.documents import GeorefInfo, JoinSeam
from hcm_pipeline.geo import Grid, MercatorBox, to_mercator_arrays, zoom_resolution
from hcm_pipeline.jobs import StepFailedError
from hcm_pipeline.join.canvas import (
    COARSE_ZOOM,
    FINE_ZOOM,
    OWNER_ZOOM,
    TONE_ZOOM,
    DatasetSource,
    Patch,
    PixelBox,
    Raster,
    aligned_box,
    level_grid,
    padded,
    smoothstep,
)
from hcm_pipeline.join.plan import JoinPlan, PlannedPart, PlannedSeam, part_of, record_list, used_parts
from hcm_pipeline.join.warping import base_transform, node_source
from hcm_pipeline.model import DocumentError
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import GeoTiff, RasterError, driver_of, write_geotiff
from hcm_pipeline.steps.merge import worst_figures

from tests.fakes.world import CITY
from tests.integration.joining import node_transform

SCAN = {"path": f"rasters/{CITY}/l/v/scan.tif", "width": 10, "height": 10, "sha256": "a" * 64, "previewPath": "p", "previewScale": 1}
GCP = {"id": "g", "pixel": {"x": 1, "y": 1}, "geo": {"lat": 44.0, "lng": 26.0}, "enabled": True, "origin": "auto"}
GEOREF = {"method": "auto", "transform": "poly2", "gcps": [GCP], "checkpointRmseM": 12.5, "checkpointCount": 4}


def record(**fields: object) -> dict[str, object]:
    source = {"kind": "usgs", "entityId": "F039"}
    return {"layerId": "l", "origin": "usgs", "state": "awaiting_approval", "source": source, "scan": SCAN, "georef": GEOREF, **fields}


def test_happy_path_a_part_keeps_the_figures_a_georef_reader_drops() -> None:
    part = part_of("v", record())

    assert (part.entity_id, part.checkpoint_rmse_m, part.checkpoint_count) == ("F039", 12.5, 4)
    assert part.georef.transform == "poly2"


def test_bad_path_a_part_without_figures_has_none() -> None:
    part = part_of("v", record(georef={"method": "gcps", "transform": "affine", "gcps": [GCP]}))

    assert (part.checkpoint_rmse_m, part.checkpoint_count) == (None, 0)


@pytest.mark.parametrize(
    ("document", "frame"),
    [
        (None, "v"),
        (record(scan=None), "F039"),
        (record(georef=None), "F039"),
        (record(georef={"method": "embedded", "transform": "affine", "gcps": []}), "F039"),
        ({**record(scan=None), "source": {}}, "v"),
    ],
)
def test_bad_path_a_frame_with_no_scan_or_points_is_missing(document: dict[str, object] | None, frame: str) -> None:
    with pytest.raises(StepFailedError) as caught:
        part_of("v", document)

    assert caught.value.code == Errors.JOIN_PART_MISSING
    assert caught.value.params == {"frame": frame}


def test_happy_path_a_plan_survives_its_file(tmp_path: Path) -> None:
    seam = JoinSeam("a", "b", True, True, 12, 2, 7.5, 40.0, 3.25)
    bare = JoinSeam("b", "c", False, False, 1, 0, 0.0)
    plan = JoinPlan(
        MercatorBox(1.0, 2.0, 3.0, 4.0),
        (PlannedPart("v1", ((1.0, 2.0, 3.0, 4.0),)), PlannedPart("v2", ())),
        (PlannedSeam(0, 1, seam), PlannedSeam(1, 2, bare)),
        ("left-out",),
        7.5,
    )

    assert JoinPlan.read(plan.write(tmp_path / "plan.json")) == plan


def test_bad_path_a_plan_that_holds_no_list_is_refused() -> None:
    with pytest.raises(DocumentError):
        record_list({"nodes": 3}, "nodes")


def test_happy_path_only_the_used_parts_in_the_plans_order() -> None:
    first, second, third = part_of("v1", record()), part_of("v2", record()), part_of("v3", record())
    plan = JoinPlan(MercatorBox(0.0, 0.0, 1.0, 1.0), (PlannedPart("v3", ()), PlannedPart("v1", ())), (), (), 0.0)

    assert used_parts([first, second, third], plan) == [third, first]


def test_happy_path_the_worst_frames_own_figures_never_pooled() -> None:
    good, bad = part_of("v", record()), part_of("v", record(georef={**GEOREF, "checkpointRmseM": 51.6, "checkpointCount": 3}))

    assert worst_figures([good, bad]) == (51.6, 3)


def test_bad_path_a_frame_with_no_figure_leaves_the_worst_unknown() -> None:
    good, blind = part_of("v", record()), part_of("v", record(georef={"method": "gcps", "transform": "affine", "gcps": [GCP]}))

    assert worst_figures([good, blind]) == (None, 0)


def test_happy_path_every_level_lies_on_the_tile_grid_and_nests() -> None:
    box = aligned_box(MercatorBox(2900123.4, 5530111.1, 2915432.1, 5541999.9))

    for zoom in (TONE_ZOOM, OWNER_ZOOM, COARSE_ZOOM, FINE_ZOOM):
        grid = level_grid(box, zoom)
        assert grid.left / zoom_resolution(zoom) == pytest.approx(round(grid.left / zoom_resolution(zoom)), abs=1e-6)
    tone, owner, coarse = level_grid(box, TONE_ZOOM), level_grid(box, OWNER_ZOOM), level_grid(box, COARSE_ZOOM)
    assert (owner.width, owner.height) == (tone.width * 2, tone.height * 2)
    assert (coarse.width, coarse.height) == (owner.width * 2, owner.height * 2)
    assert box.left <= 2900123.4
    assert box.top >= 5541999.9


def test_happy_path_smoothstep_is_flat_at_both_ends() -> None:
    assert smoothstep(numpy.array([-1.0, 0.0, 0.5, 1.0, 2.0])).tolist() == [0.0, 0.0, 0.5, 1.0, 1.0]


def test_bad_path_outside_a_source_there_is_no_data() -> None:
    def fetch(_x: int, _y: int, width: int, height: int) -> Patch:
        return Patch(numpy.full((height, width), 9, numpy.uint8), numpy.full((height, width), 255, numpy.uint8))

    inside = padded(PixelBox(-1, -1, 2, 2), (4, 4), fetch)
    outside = padded(PixelBox(10, 10, 12, 12), (4, 4), fetch)

    assert inside.alpha.tolist() == [[0, 0, 0], [0, 255, 255], [0, 255, 255]]
    assert inside.valid_share() == pytest.approx(4 / 9)
    assert outside.valid_share() == 0.0


def test_happy_path_a_box_moves_and_grows() -> None:
    box = PixelBox(0, 0, 0, 0).around(10, 10, 2)

    assert box == PixelBox(8, 8, 12, 12)
    assert box.moved(1, -1) == PixelBox(9, 7, 13, 11)
    assert box.grown(1).size == (6, 6)


def test_happy_path_a_dataset_reads_like_a_raster_and_shrinks(tmp_path: Path) -> None:
    grey = numpy.arange(64, dtype=numpy.uint8).reshape(8, 8)
    alpha = numpy.full((8, 8), 255, numpy.uint8)
    alpha[:, :4] = 0
    file = write_geotiff(tmp_path / "part.tif", GeoTiff([grey, alpha], (0.0, 1.0, 0.0, 8.0, 0.0, -1.0), alpha=True))

    source = DatasetSource(file)
    read = source.read(PixelBox(2, 2, 6, 6))
    small = source.averaged(Grid(0.0, 8.0, 2.0, 4, 4))
    corner = source.alpha_of(4, 0, 4, 4, (2, 2))
    source.close()

    memory = Raster(Grid(0.0, 8.0, 1.0, 8, 8), grey, alpha).read(PixelBox(2, 2, 6, 6))
    assert read.grey.tolist() == memory.grey.tolist()
    assert read.alpha.tolist() == memory.alpha.tolist()
    assert small.alpha.tolist()[0] == [0, 0, 255, 255]
    assert corner.tolist() == [[255, 255], [255, 255]]


def _points(transform: str, gcp_count: int = 9) -> GeorefInfo:
    """Points of an exact affine map, 10 m a pixel."""
    gcps = []
    for index in range(gcp_count):
        u, v = 100.0 * (index % 3), 100.0 * (index // 3)
        gcps.append({**GCP, "id": f"g{index}", "pixel": {"x": u, "y": v}, "geo": {"lat": 44.0 - v * 1e-4, "lng": 26.0 + u * 1e-4}})
    return GeorefInfo.of({"method": "gcps", "transform": transform, "gcps": gcps})


@pytest.mark.parametrize("transform", ["affine", "poly2", "tps"])
def test_happy_path_the_base_transform_goes_through_the_parts_points(transform: str) -> None:
    georef = _points(transform)
    u, v, lng, lat = numpy.array([(gcp.x, gcp.y, gcp.lng, gcp.lat) for gcp in georef.gcps]).T

    x, y, good = base_transform(georef, (300, 300)).forward(u, v)

    other = to_mercator_arrays(lng, lat)
    assert bool(good.all())
    # Mercator is not affine in degrees: a line misses by a little; the second order and the spline go through.
    limit = 40.0 if transform == "affine" else 1.0
    assert float(numpy.abs(x - other[0]).max()) <= limit
    assert float(numpy.abs(y - other[1]).max()) <= limit


def test_happy_path_a_warp_through_the_nodes_follows_the_nodes(tmp_path: Path) -> None:
    scan = write_geotiff(tmp_path / "scan.tif", GeoTiff([numpy.full((100, 100), 7, numpy.uint8)]))
    nodes = [(u, v, 1000.0 + u * 10.0, 2000.0 - v * 10.0) for u in (0.0, 50.0, 100.0) for v in (0.0, 50.0, 100.0)]

    vrt = node_source(scan, nodes, tmp_path / "nodes.vrt")

    dataset = gdal.Open(str(vrt))
    assert dataset.GetGCPCount() == 9
    dataset.Close()
    x, y = node_transform(nodes, (100, 100))(numpy.array([25.0]), numpy.array([75.0]))
    assert (float(x[0]), float(y[0])) == pytest.approx((1250.0, 1250.0), abs=1e-3)


def test_bad_path_gdal_without_a_driver_is_a_raster_error() -> None:
    with pytest.raises(RasterError):
        driver_of("NoSuchDriver")
