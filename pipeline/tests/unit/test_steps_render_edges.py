"""The georeferencing, rendering and registering steps' refusals and less common paths, through the runner."""

from pathlib import Path

import numpy
import pytest
from hcm_pipeline.config import Config
from hcm_pipeline.contract import Errors
from hcm_pipeline.geo import Grid, MercatorBox, to_lnglat, to_mercator
from hcm_pipeline.georef.corners import corner_transform
from hcm_pipeline.georef.matcher import References, Scan, match
from hcm_pipeline.georef.transforms import Gcp
from hcm_pipeline.raster import gdal
from hcm_pipeline.runner import JobRunner, RunOutcome, RunSettings
from hcm_pipeline.services import default_steps
from hcm_pipeline.steps.export import ExportStep
from hcm_pipeline.steps.inspect import write_scan
from hcm_pipeline.store import DELETE

from tests.fakes.world import JOB_ID, PipelineWorld, dig
from tests.integration.test_regeoref_job import JOB as REGEOREF_JOB
from tests.integration.test_regeoref_job import SPREAD, manual_gcps, seed_regeoref
from tests.synthetic.scenes import affine_scan


def only(world: PipelineWorld, step: str, config: Config | None = None) -> RunOutcome:
    return world.runner(config).run(step)


def error_code(world: PipelineWorld, job_id: str = JOB_ID) -> str:
    return str(dig(world.job(job_id), "error", "code"))


def test_bad_path_georef_refuses_points_outside_too_few_or_missing_references(world: PipelineWorld, tmp_path: Path) -> None:
    scan = affine_scan(world.scene.world)
    config = Config(**{**world.config.__dict__, "job_id": REGEOREF_JOB})
    outside = manual_gcps(scan, [*SPREAD, (5000.0, 5000.0)])
    seed_regeoref(world, tmp_path, outside)
    assert only(world, "georef", config) is RunOutcome.FAILED
    assert error_code(world, REGEOREF_JOB) == Errors.GCP_OUTSIDE

    seed_regeoref(world, tmp_path, manual_gcps(scan, SPREAD[:2]))
    assert only(world, "georef", config) is RunOutcome.FAILED
    assert error_code(world, REGEOREF_JOB) == Errors.TOO_FEW_GCPS

    corners = [{**gcp, "origin": "corner"} for gcp in manual_gcps(scan, SPREAD[:4])]
    seed_regeoref(world, tmp_path, corners)
    world.store.update(world.version_path(REGEOREF_JOB), {"georef.method": "corners"})
    assert only(world, "georef", config) is RunOutcome.FAILED
    assert "no reference window" in str(dig(world.job(REGEOREF_JOB), "error", "message"))

    seed_regeoref(world, tmp_path, corners)
    world.store.update(world.version_path(REGEOREF_JOB), {"georef.method": "corners"})
    world.store.update(
        world.job_path(REGEOREF_JOB), {"steps.reference": {"status": "done", "gcsPath": "reference/bucharest/s2/0f3c9a2e.tif"}}
    )
    assert only(world, "georef", config) is RunOutcome.FAILED
    assert error_code(world, REGEOREF_JOB) == Errors.REFERENCE_UNAVAILABLE


def test_bad_path_steps_that_need_a_scan_refuse_a_version_without_one(world: PipelineWorld, tmp_path: Path) -> None:
    config = Config(**{**world.config.__dict__, "job_id": REGEOREF_JOB})
    for step in ("georef", "warp"):
        seed_regeoref(world, tmp_path, manual_gcps(affine_scan(world.scene.world), SPREAD))
        world.store.update(world.version_path(REGEOREF_JOB), {"scan": DELETE})
        assert only(world, step, config) is RunOutcome.FAILED
        assert error_code(world, REGEOREF_JOB) == Errors.NO_SCAN


def test_bad_path_register_needs_the_exported_output(world: PipelineWorld) -> None:
    world.seed_import()

    assert only(world, "register") is RunOutcome.FAILED
    assert error_code(world) == Errors.PROCESSING_FAILED


def test_happy_path_a_thin_plate_spline_warp_and_no_studio_file_when_it_never_fits(world: PipelineWorld, tmp_path: Path) -> None:
    scan = affine_scan(world.scene.world)
    grid = [(float(u), float(v)) for u in (100, 400, 700, 1000) for v in (100, 450, 800)]
    seed_regeoref(world, tmp_path, manual_gcps(scan, grid))
    world.store.update(world.version_path(REGEOREF_JOB), {"georef.transform": "tps"})
    config = Config(**{**world.config.__dict__, "job_id": REGEOREF_JOB})
    steps = {**default_steps(), "export": ExportStep(studio_max_bytes=1)}

    outcome = JobRunner(config, world.services(), steps, RunSettings(heartbeat_seconds=3600)).run()

    output = world.version(REGEOREF_JOB)["output"]
    assert outcome is RunOutcome.DONE
    assert isinstance(output, dict)
    assert "studioPath" not in output
    assert dig(world.version(REGEOREF_JOB), "georef", "transform") == "tps"


def test_happy_path_a_16_bit_colour_upload_is_stretched_to_8_bits(tmp_path: Path) -> None:
    source = tmp_path / "colour16.tif"
    driver = gdal.GetDriverByName("GTiff")
    assert driver is not None
    dataset = driver.Create(str(source), 32, 16, 3, gdal.GDT_UInt16)
    for band in (1, 2, 3):
        dataset.GetRasterBand(band).WriteArray(numpy.tile(numpy.arange(32, dtype=numpy.uint16) * 1000 * band, (16, 1)))
    dataset.Close()

    target = write_scan(source, tmp_path / "scan.tif")

    scan = gdal.Open(str(target))
    assert (scan.RasterCount, scan.GetRasterBand(1).DataType) == (3, gdal.GDT_Byte)
    assert int(scan.GetRasterBand(1).ReadAsArray().max()) == 255
    scan.Close()


def test_bad_path_a_featureless_scan_finds_no_automatic_pairs(world: PipelineWorld) -> None:
    centre = to_mercator(26.10, 44.43)
    grid = Grid.over(MercatorBox(centre[0] - 3000, centre[1] - 2400, centre[0] + 3000, centre[1] + 2400), 10)
    corners = [Gcp(f"c{i}", x, y, lat, lng, True, "corner") for i, (x, y, (lng, lat)) in enumerate(_corners(grid), start=1)]

    found = match(
        Scan(numpy.full((900, 1200), 128, numpy.uint8), 6.0),
        corner_transform(corners).to_pixel,
        References(grid, world.scene.world.pixels[:480, :600]),
    )

    assert found.tiles.total[0] == 0
    assert found.pairs == ()


def _corners(grid: Grid) -> list[tuple[float, float, tuple[float, float]]]:
    box = grid.box()
    places = ((box.left, box.top), (box.right, box.top), (box.right, box.bottom), (box.left, box.bottom))
    pixels = ((0.0, 0.0), (1200.0, 0.0), (1200.0, 900.0), (0.0, 900.0))
    return [(x, y, to_lnglat(*place)) for (x, y), place in zip(pixels, places, strict=True)]


def test_bad_path_a_corner_transform_needs_four_corners() -> None:
    with pytest.raises(ValueError, match="exactly four"):
        corner_transform([Gcp("c1", 0, 0, 44.4, 26.1)])
