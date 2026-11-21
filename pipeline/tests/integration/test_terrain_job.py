"""A frame fitted over terrain renders through its RPC over the heights it carries; the city's surface model is fetched, cached and
refused whole (M15-calibration-accuracy.md, *Terrain*)."""

from dataclasses import replace
from pathlib import Path
from typing import Final

import cv2
import numpy
import pytest
from hcm_pipeline import paths
from hcm_pipeline.calibrate.terrain import Heights
from hcm_pipeline.config import Config
from hcm_pipeline.documents import TerrainInfo, Version
from hcm_pipeline.geo import Bounds, FloatArray, MercatorBox, ground_scale, to_lnglat_arrays
from hcm_pipeline.georef.rpc import fit_rpc
from hcm_pipeline.joblog import JobLog
from hcm_pipeline.jobs import JobContext, RunFlags
from hcm_pipeline.log import get_logger
from hcm_pipeline.model import DocumentError, Job
from hcm_pipeline.raster import gdal, osr
from hcm_pipeline.rasters import driver_of
from hcm_pipeline.runner import RunOutcome
from hcm_pipeline.steps.relief import city_heights, surface_key
from hcm_pipeline.surface import tile_names

from tests.fakes.world import CITY, DEM_PATH, JOB_ID, PipelineWorld, city_bounds
from tests.integration.test_regeoref_job import BASE, JOB, SPREAD, manual_gcps, seed_regeoref
from tests.synthetic.scenes import CENTRE, AffineScan, affine_scan

HEIGHT_M: Final = 100.0
# Higher ground shows half its height further east on this film: 100 m of ground is shown 50 m east of where it lies.
PARALLAX_EAST: Final = 0.5
MARGIN_SHARE: Final = 0.2


def window() -> MercatorBox:
    return Bounds.of(city_bounds()).mercator().expanded()


def serve_surface(world: PipelineWorld, tmp_path: Path, height_m: float = HEIGHT_M) -> None:
    """Every GLO-30 tile over the city, level at `height_m`."""
    for name in tile_names(window().bounds()):
        lat = int(name[23:25]) * (1 if name[22] == "N" else -1)
        lng = int(name[30:33]) * (1 if name[29] == "E" else -1)
        local = tmp_path / name.split("/")[-1]
        dataset = driver_of("GTiff").Create(str(local), 30, 30, 1, gdal.GDT_Float32)
        dataset.SetGeoTransform((lng, 1 / 30, 0.0, lat + 1, 0.0, -1 / 30))
        reference = osr.SpatialReference()
        reference.ImportFromEPSG(4326)
        dataset.SetProjection(reference.ExportToWkt())
        dataset.GetRasterBand(1).WriteArray(numpy.full((30, 30), height_m, numpy.float32))
        dataset.Close()
        world.http.serve(f"{DEM_PATH}/{name}", local.read_bytes())


def level_heights(height_m: float = HEIGHT_M) -> Heights:
    """Level ground over the city's window, on 400 m cells."""
    box = window()
    cell = 400.0
    shape = (int(box.height // cell) + 2, int(box.width // cell) + 2)
    return Heights(box.left - cell, box.top + cell, cell, numpy.full(shape, height_m, numpy.float32))


def terrain_record(scan: AffineScan, heights: Heights | None = None) -> dict[str, object]:
    """The scan's exact map over terrain: its affine map, a place at height h shown h * 0.5 further east; and its heights."""
    scale = ground_scale(CENTRE[1])

    def ground_at(film: FloatArray, height_m: float) -> tuple[FloatArray, FloatArray]:
        a, b, c, d = scan.matrix
        east = scan.origin[0] + a * film[:, 0] + b * film[:, 1] - height_m * PARALLAX_EAST / scale
        north = scan.origin[1] + c * film[:, 0] + d * film[:, 1]
        return to_lnglat_arrays(east, north)

    height, width = scan.pixels.shape
    rpc = fit_rpc(ground_at, (width, height), (0.0, 200.0))
    assert rpc is not None
    return TerrainInfo(rpc, 12.0, level_heights() if heights is None else heights).as_record()


def warped(world: PipelineWorld, tmp_path: Path, name: str) -> Path:
    local = tmp_path / name
    local.write_bytes(world.gcs.objects[paths.work(CITY, JOB, "warped.tif")].data)
    return local


def east_shift_m(moved: Path, flat: Path) -> float:
    """How far east `moved` shows what `flat` shows, ground metres (phase correlation over their common box)."""
    first, second = gdal.Open(str(flat)), gdal.Open(str(moved))
    left, size, _, top, _, step = first.GetGeoTransform()
    width, height = first.RasterXSize * size, -first.RasterYSize * step
    inner = (MARGIN_SHARE, 1 - MARGIN_SHARE)
    bounds = (left + inner[0] * width, top - inner[1] * height, left + inner[1] * width, top - inner[0] * height)
    images = [gdal.Warp("", dataset, format="MEM", outputBounds=bounds, xRes=size, yRes=-step) for dataset in (first, second)]
    grey = [numpy.asarray(image.GetRasterBand(1).ReadAsArray(), numpy.float32) for image in images]
    (dx, _), _ = cv2.phaseCorrelate(grey[0], grey[1])
    return float(dx * size * ground_scale(CENTRE[1]))


def warp_only(world: PipelineWorld, **config: str) -> RunOutcome:
    """The warp step alone, its job started afresh each time."""
    world.seed_job(JOB, "regeoref", {"basedOn": BASE})
    return world.runner(Config(**{**world.config.__dict__, "job_id": JOB, **config})).run("warp")


def test_happy_path_a_frame_over_terrain_renders_through_its_rpc_and_the_heights_it_carries(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P06-HAPPY-TERRAIN"""
    scan = seed_regeoref(world, tmp_path, manual_gcps(affine_scan(world.scene.world), SPREAD))
    assert warp_only(world) is RunOutcome.DONE
    flat = warped(world, tmp_path, "flat.tif")
    world.store.update(world.version_path(JOB), {"georef.terrain": terrain_record(scan)})

    # No surface served or cached: the record's own heights are what the warp reads.
    assert warp_only(world) is RunOutcome.DONE

    # 100 m of ground shown 50 m east: the layer puts each feature 50 m west of the flat render.
    assert east_shift_m(warped(world, tmp_path, "terrain.tif"), flat) == pytest.approx(-HEIGHT_M * PARALLAX_EAST, abs=3.0)
    assert world.http.paths("GET") == []
    assert world.gcs.names("reference/") == []
    assert "surface model" not in " ".join(world.log_lines(JOB))


def test_bad_path_a_frame_whose_heights_record_is_malformed_is_refused(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P06-BAD-TERRAIN-UNAVAILABLE"""
    scan = seed_regeoref(world, tmp_path, manual_gcps(affine_scan(world.scene.world), SPREAD))
    record = terrain_record(scan)
    heights = record["heights"]
    assert isinstance(heights, dict)
    record["heights"] = {**heights, "valuesDm": "AAAA"}
    world.store.update(world.version_path(JOB), {"georef.terrain": record})

    stored = world.store.get(world.version_path(JOB))
    assert stored is not None
    with pytest.raises(DocumentError, match="heights"):
        Version.of(JOB, stored)


def context(world: PipelineWorld, workdir: Path) -> JobContext:
    log = JobLog(world.store, f"{world.job_path()}/logs", world.clock, get_logger("test"))
    job, version = Job.of(JOB_ID, world.job()), Version.of(JOB_ID, world.version())
    return JobContext(world.config, world.services(), job, version, workdir, RunFlags(), log)


def test_happy_path_the_city_surface_is_fetched_once_and_cached_by_window_source_and_cell(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P06-HAPPY-TERRAIN"""
    world.seed_import()
    serve_surface(world, tmp_path)

    heights = city_heights(context(world, tmp_path / "a"))
    fetched = len(world.http.paths("GET"))
    again = city_heights(context(world, tmp_path / "b"))

    assert heights is not None
    assert again is not None
    assert numpy.array_equal(again.values, heights.values)
    assert float(heights.values.min()) == pytest.approx(HEIGHT_M)
    assert paths.reference(CITY, "dem", surface_key(window())) in world.gcs.names("reference/")
    assert len(world.http.paths("GET")) == fetched


def test_bad_path_without_every_tile_the_city_has_no_surface_and_nothing_is_cached(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P06-BAD-TERRAIN-UNAVAILABLE"""
    world.seed_import()

    assert city_heights(context(world, tmp_path / "a")) is None
    assert world.gcs.names("reference/") == []
    assert "a Copernicus DEM tile over the city could not be read" in " ".join(world.log_lines(JOB_ID))
    refused = replace(world.config, dem_url="https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com")
    ctx = context(world, tmp_path / "b")
    assert city_heights(replace(ctx, config=refused)) is None
    assert "no surface model (" in " ".join(world.log_lines(JOB_ID))
