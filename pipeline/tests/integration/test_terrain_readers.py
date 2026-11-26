"""Every reader of a frame over terrain shows the map its layer shows (M15-calibration-accuracy.md, *Terrain*, review of 2026-11-08).

The layer renders through the frame's RPC over the heights it carries. A join's part (M8), with or without the nodes of a seam, and the
image the next frame is tied against (`steps/aligning.py`) must read the same map, never the flat one nor a spline through a lattice,
which no spread of nodes holds over relief. The scan here is coded: each pixel holds its own column and row, so what a warp read at a
place is known; the frame is seen off nadir over a hill, so the flat map lies tens of metres from the ground one.
"""

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import numpy
import numpy.typing
from hcm_pipeline.calibrate.terrain import Heights
from hcm_pipeline.documents import GeorefInfo, ScanInfo, TerrainInfo, Version
from hcm_pipeline.geo import FloatArray, Grid, MercatorBox, to_lnglat_arrays, to_mercator
from hcm_pipeline.georef.heights import to_decimetres
from hcm_pipeline.georef.lattice import Lattice, sampled
from hcm_pipeline.georef.rpc import fit_rpc
from hcm_pipeline.joblog import JobLog
from hcm_pipeline.jobs import JobContext, RunFlags
from hcm_pipeline.join.correction import TAPER_M, SeamField, nodes_for
from hcm_pipeline.join.measure import SeamModel
from hcm_pipeline.join.plan import Part
from hcm_pipeline.join.seams import Seam
from hcm_pipeline.join.warping import Warper, part_size, part_transform
from hcm_pipeline.log import get_logger
from hcm_pipeline.model import Job
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import driver_of
from hcm_pipeline.steps.aligning import ours, to_film
from hcm_pipeline.steps.warp import attached

from tests.fakes.world import CITY, JOB_ID, LAYER_ID, PipelineWorld

SIZE: Final = (1200, 900)
PIXEL_GROUND_M: Final = 25.0
LAT: Final = 44.43
GROUND: Final = math.cos(math.radians(LAT))
# Ground h metres above the frame's reference shows h * PARALLAX further east on its film.
PARALLAX: Final = 0.6
HILL_M: Final = 90.0
HILL_SIGMA_M: Final = 1500.0
CELL_GROUND_M: Final = 300.0
OUTPUT_GROUND_M: Final = 50.0
FAR_M: Final = TAPER_M + 1500.0
SCAN_PATH: Final = f"rasters/{CITY}/{LAYER_ID}/v-terrain/scan.tif"
ORIGIN: Final = numpy.array(to_mercator(26.1, LAT)) - numpy.array([SIZE[0] / 2, -SIZE[1] / 2]) * PIXEL_GROUND_M / GROUND


def flat(film: FloatArray) -> FloatArray:
    """Where the film shows each pixel on flat ground."""
    return numpy.asarray(ORIGIN + numpy.column_stack((film[:, 0], -film[:, 1])) * PIXEL_GROUND_M / GROUND, numpy.float64)


def hill() -> Heights:
    """A 90 m hill north-east of the scan's middle, on 300 m cells over the scan and 3 km around, to the decimetre."""
    cell = CELL_GROUND_M / GROUND
    left, top = ORIGIN[0] - 3000.0 / GROUND, ORIGIN[1] + 3000.0 / GROUND
    columns = math.ceil((SIZE[0] * PIXEL_GROUND_M + 6000.0) / CELL_GROUND_M)
    rows = math.ceil((SIZE[1] * PIXEL_GROUND_M + 6000.0) / CELL_GROUND_M)
    x, y = numpy.meshgrid(left + (numpy.arange(columns) + 0.5) * cell, top - (numpy.arange(rows) + 0.5) * cell)
    middle = flat(numpy.array([[SIZE[0] * 0.6, SIZE[1] * 0.4]]))[0]
    squared = ((x - middle[0]) ** 2 + (y - middle[1]) ** 2) * GROUND**2
    return Heights(left, top, cell, to_decimetres(70.0 + HILL_M * numpy.exp(-squared / (2 * HILL_SIGMA_M**2))))


def ground(film: FloatArray, heights: Heights) -> FloatArray:
    """Where each film pixel's feature lies: its flat place less the parallax of its height."""
    shown = flat(film)
    places = shown
    for _ in range(12):
        places = shown - numpy.column_stack((heights.at(places) * PARALLAX / GROUND, numpy.zeros(len(places))))
    return places


def georef_over(heights: Heights) -> GeorefInfo:
    """The frame's georef as the pipeline stores it: the lattice of its map on the ground, and its RPC over these heights."""

    def ground_at(film: FloatArray, height_m: float) -> tuple[FloatArray, FloatArray]:
        places = flat(film) - numpy.array([height_m * PARALLAX / GROUND, 0.0])
        return to_lnglat_arrays(places[:, 0], places[:, 1])

    def to_lnglat(x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray]:
        places = ground(numpy.column_stack((x, y)), heights)
        return to_lnglat_arrays(places[:, 0], places[:, 1])

    rpc = fit_rpc(ground_at, SIZE, (float(heights.values.min()), float(heights.values.max())))
    assert rpc is not None
    lattice = Lattice("panoramic", sampled(to_lnglat, *SIZE))
    return GeorefInfo("auto", "poly2", lattice=lattice, terrain=TerrainInfo(rpc, 12.0, heights))


def coded_scan(target: Path) -> Path:
    dataset = driver_of("GTiff").Create(str(target), SIZE[0], SIZE[1], 2, gdal.GDT_Float32)
    u, v = numpy.meshgrid(numpy.arange(SIZE[0]) + 0.5, numpy.arange(SIZE[1]) + 0.5)
    dataset.GetRasterBand(1).WriteArray(u)
    dataset.GetRasterBand(2).WriteArray(v)
    dataset.Close()
    return target


@dataclass(frozen=True)
class Picture:
    """What a warp read at each output cell: the scan's column and row, and where it read anything."""

    u: FloatArray
    v: FloatArray
    valid: numpy.typing.NDArray[numpy.bool_]


def picture_of(dataset: gdal.Dataset) -> Picture:
    u, v, alpha = (numpy.asarray(dataset.GetRasterBand(band).ReadAsArray(), numpy.float64) for band in (1, 2, dataset.RasterCount))
    return Picture(u, v, alpha == 255)


def box_around() -> MercatorBox:
    """The scan's box and 2 km around, in whole cells of the output grid."""
    corners = flat(numpy.array([[0.0, 0.0], [SIZE[0], SIZE[1]]]))
    box = MercatorBox(corners[0, 0] - 2000.0, corners[1, 1] - 2000.0, corners[1, 0] + 2000.0, corners[0, 1] + 2000.0)
    return output_grid(box).box()


def output_grid(box: MercatorBox) -> Grid:
    return Grid.over(box, OUTPUT_GROUND_M / GROUND)


def published(scan: Path, georef: GeorefInfo, box: MercatorBox, grid: Grid, tmp: Path) -> Picture:
    """The layer: the warp step's own source and method (`attached`), over `box` at `grid`'s cells, as a join warps."""
    found = attached(scan, georef, lambda name: tmp / f"layer-{name}")
    bounds = (box.left, box.bottom, box.right, box.top)
    options = {"outputBounds": bounds, "xRes": grid.resolution, "yRes": grid.resolution, "dstSRS": "EPSG:3857", "dstAlpha": True}
    dataset = gdal.Warp("", str(found.source), format="MEM", resampleAlg="bilinear", **options, **found.method)
    picture = picture_of(dataset)
    dataset.Close()
    return picture


def context(world: PipelineWorld, workdir: Path) -> JobContext:
    world.seed_import()
    log = JobLog(world.store, f"{world.job_path()}/logs", world.clock, get_logger("test"))
    job, version = Job.of(JOB_ID, world.job()), Version.of(JOB_ID, world.version())
    workdir.mkdir(parents=True, exist_ok=True)
    return JobContext(world.config, world.services(), job, version, workdir, RunFlags(), log)


@dataclass(frozen=True)
class Frame:
    world: PipelineWorld
    heights: Heights
    georef: GeorefInfo
    scan: Path
    part: Part


def frame(world: PipelineWorld, tmp: Path) -> Frame:
    heights = hill()
    georef = georef_over(heights)
    scan = coded_scan(tmp / "coded.tif")
    world.gcs.put(SCAN_PATH, scan.read_bytes())
    info = ScanInfo(SCAN_PATH, SIZE[0], SIZE[1], "0" * 64, f"rasters/{CITY}/{LAYER_ID}/v-terrain/scan-preview.jpg", 0.1)
    version = Version.of(JOB_ID, world.version())
    return Frame(world, heights, georef, scan, Part(version, info, georef, "terrain", 6.0, 3))


def gap_m(first: Picture, second: Picture, where: numpy.typing.NDArray[numpy.bool_]) -> FloatArray:
    """How far apart two warps show one place's scan pixel, on the ground."""
    return numpy.asarray(numpy.hypot(first.u - second.u, first.v - second.v)[where] * PIXEL_GROUND_M, numpy.float64)


def west_edge_field(frame_: Frame, shift_m: float) -> SeamField:
    """A seam along the scan's west edge, moving the part `shift_m` east there."""
    places = ground(numpy.array([[0.0, 0.0], [0.0, SIZE[1]]]), frame_.heights)
    line = numpy.column_stack((numpy.full(101, places[0, 0]), numpy.linspace(places[1, 1], places[0, 1], 101)))
    seam = Seam(0, 1, line, (float(line[0, 0]), float(line[0, 1])), (0.0, 1.0), float(line[-1, 1] - line[0, 1]) * GROUND, (), GROUND)
    return SeamField(seam, SeamModel((shift_m / GROUND,), (0.0,), -1e6, 1e6), 1.0)


def test_happy_path_a_join_part_over_terrain_shows_what_its_layer_shows(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P05-HAPPY-TERRAIN-PART"""
    ctx = context(world, tmp_path / "work")
    found = frame(world, tmp_path)
    box = box_around()
    grid = output_grid(box)
    layer = published(found.scan, found.georef, box, grid, tmp_path)

    part = Warper(ctx, box).rendered(found.part, (), grid)

    dataset = gdal.Open(str(part))
    joined = picture_of(dataset)
    dataset.Close()
    both = layer.valid & joined.valid
    assert int(both.sum()) > 0.8 * int(layer.valid.sum()) > 10_000
    assert float(gap_m(layer, joined, both).max()) < 1.0


def test_happy_path_a_join_part_over_terrain_with_nodes_still_shows_its_layer_past_the_taper(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P05-HAPPY-TERRAIN-PART"""
    ctx = context(world, tmp_path / "work")
    found = frame(world, tmp_path)
    box = box_around()
    grid = output_grid(box)
    layer = published(found.scan, found.georef, box, grid, tmp_path)
    field = west_edge_field(found, 1.0)
    nodes = nodes_for(part_transform(found.part, box), part_size(found.part, box), [field])

    part = Warper(ctx, box).rendered(found.part, nodes, grid)

    dataset = gdal.Open(str(part))
    moved = picture_of(dataset)
    dataset.Close()
    x = grid.left + (numpy.arange(layer.u.shape[1]) + 0.5) * grid.resolution
    far = numpy.broadcast_to((x - float(field.seam.line[0, 0])) * GROUND > FAR_M, layer.u.shape)
    both = layer.valid & moved.valid
    assert int((both & far).sum()) > 2_000
    # Past the taper the field is nothing: the part is its layer, the hill's 54 m of parallax included, within what a spline's sparse
    # nodes hold of the field itself on any part (`test_join_warp_parity.py`).
    far_gap = gap_m(layer, moved, both & far)
    assert float(numpy.percentile(far_gap, 95)) < 1.0
    assert float(far_gap.max()) < 2.0
    near = numpy.broadcast_to((x - float(field.seam.line[0, 0])) * GROUND < 500.0, layer.u.shape)
    assert float(numpy.median(gap_m(layer, moved, both & near))) > 0.5


def test_happy_path_the_next_frame_is_tied_through_the_map_its_layer_shows(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P06-HAPPY-TERRAIN"""
    ctx = context(world, tmp_path / "work")
    found = frame(world, tmp_path)
    window = box_around()

    mine = ours(ctx, found.georef, found.part.scan, (100, 40), window)

    film = numpy.array([[150.0, 120.0], [700.0, 380.0], [1000.0, 800.0], [640.0, 450.0]])
    places = ground(film, found.heights)
    assert float(numpy.abs(to_film(mine.attached, (100, 40))(places) - (film + numpy.array([100.0, 40.0]))).max()) * PIXEL_GROUND_M < 1.0
    assert mine.image.grey.any()
