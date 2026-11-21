"""A version's own tiles (`steps/pyramid.py`, docs/research/M12-own-tiles.md): real GDAL, real WebP, real archives read back."""

from pathlib import Path

import pytest
from hcm_pipeline.contract import Errors
from hcm_pipeline.geo import ZOOM0_RESOLUTION_M, to_mercator
from hcm_pipeline.jobs import StepFailedError
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import driver_of
from hcm_pipeline.runner import RunOutcome
from hcm_pipeline.steps.export import Warped, write_cog
from hcm_pipeline.steps.pyramid import Rendered, rgba_view

from tests.fakes.world import JOB_ID, PipelineWorld, dig
from tests.integration.tiling import FILES, TILES_JOB, grey_warped, run_tiles_job, seed_old_version
from tests.unit.pmtiles_reader import Archive


def tile_place(archive: Archive) -> tuple[int, int, int]:
    """The deepest tile the archive holds, by asking its own bounds' middle."""
    maxzoom = archive.header["maxzoom"]
    lng, lat = (archive.header["west"] + archive.header["east"]) / 2e7, (archive.header["south"] + archive.header["north"]) / 2e7
    left, top = to_mercator(lng, lat)
    span = ZOOM0_RESOLUTION_M * 256 / 2**maxzoom
    origin = ZOOM0_RESOLUTION_M * 256 / 2
    return maxzoom, int((left + origin) // span), int((origin - top) // span)


def read_tile(data: bytes, folder: Path) -> gdal.Dataset:
    file = folder / "tile.webp"
    file.write_bytes(data)
    return gdal.Open(str(file))


def test_happy_path_an_import_ends_with_its_tiles_and_no_cog(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P08-HAPPY-FROM-WARP"""
    world.seed_import()
    world.seed_own_city()

    outcome = world.run()

    version = world.version()
    assert outcome is RunOutcome.DONE
    assert world.job()["status"] == "awaiting_approval"
    assert version["state"] == "awaiting_approval"
    names = world.gcs.names(FILES)
    assert f"{FILES}tiles.pmtiles" in names
    assert f"{FILES}thumb.webp" in names
    assert f"{FILES}preview.png" in names
    assert f"{FILES}cog.tif" not in names
    assert f"{FILES}studio.tif" not in names
    output = version["output"]
    assert isinstance(output, dict)
    assert "cogPath" not in output
    tiles = output["tiles"]
    data = world.gcs.objects[f"{FILES}tiles.pmtiles"].data
    assert tiles["path"] == f"{FILES}tiles.pmtiles"
    assert tiles["bytes"] == len(data)
    assert tiles["thumbPath"] == f"{FILES}thumb.webp"
    assert dig(world.job(), "steps", "pyramid", "sha256") == tiles["sha256"]
    archive = Archive(data)
    assert archive.header["addressed"] == tiles["count"] > 0
    assert (archive.header["minzoom"], archive.header["maxzoom"]) == (output["minzoom"], output["maxzoom"])
    tile = archive.tile(*tile_place(archive))
    assert tile is not None
    assert tile.startswith(b"RIFF")
    assert tile[8:12] == b"WEBP"
    opened = read_tile(tile, tmp_path)
    # 256 px; a tile with nothing transparent in it is written with no alpha, and shows opaque.
    assert (opened.RasterXSize, opened.RasterYSize) == (256, 256)
    assert world.gcs.objects[f"{FILES}thumb.webp"].data[:4] == b"RIFF"


def test_happy_path_a_city_on_mapbox_gets_its_cog_and_studio_file_too(world: PipelineWorld) -> None:
    """Scenarios: S-P08-HAPPY-THROUGH-MAPBOX"""
    world.seed_import()

    assert world.run() is RunOutcome.DONE

    names = world.gcs.names(FILES)
    assert {f"{FILES}{name}" for name in ("cog.tif", "studio.tif", "tiles.pmtiles", "thumb.webp")} <= set(names)
    output = world.version()["output"]
    assert isinstance(output, dict)
    assert "cogPath" in output
    assert "tiles" in output


def test_happy_path_an_old_version_gets_its_tiles_from_its_cog_and_keeps_its_state(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P08-HAPPY-OLD-VERSION"""
    seed_old_version(world, tmp_path)

    assert run_tiles_job(world) is RunOutcome.DONE

    job, version = world.job(TILES_JOB), world.version(JOB_ID)
    assert (job["status"], job["progress"]) == ("succeeded", 1.0)
    assert "waitReason" not in job
    assert "lease" not in job
    assert version["state"] == "approved"
    tiles = dig(version, "output", "tiles")
    assert isinstance(tiles, dict)
    archive = Archive(world.gcs.objects[f"{FILES}tiles.pmtiles"].data)
    assert archive.header["addressed"] == tiles["count"] > 0
    data = archive.tile(*tile_place(archive))
    assert data is not None
    # The COG's mask became the tile's alpha: JPEG holds no alpha of its own.
    assert read_tile(data, tmp_path).RasterCount == 4


def test_bad_path_a_tiles_job_with_nothing_to_read_leaves_its_version_alone(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P08-BAD-FAILS-ALONE"""
    seed_old_version(world, tmp_path, with_cog=False)

    assert run_tiles_job(world) is RunOutcome.FAILED

    assert dig(world.job(TILES_JOB), "error", "code") == Errors.PROCESSING_FAILED
    version = world.version(JOB_ID)
    assert version["state"] == "approved"
    assert "error" not in version


def test_bad_path_a_cancelled_tiles_job_leaves_its_version_alone(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P08-BAD-FAILS-ALONE"""
    seed_old_version(world, tmp_path)
    world.store.update(world.job_path(TILES_JOB), {"cancelRequested": True})

    assert run_tiles_job(world) is RunOutcome.CANCELLED

    assert world.job(TILES_JOB)["status"] == "cancelled"
    assert world.version(JOB_ID)["state"] == "approved"


def test_bad_path_an_invalid_tiles_job_leaves_its_version_alone(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P08-BAD-FAILS-ALONE"""
    seed_old_version(world, tmp_path)
    world.store.update(world.job_path(TILES_JOB), {"params": {"versionId": JOB_ID, "extra": 1}})

    assert run_tiles_job(world) is RunOutcome.FAILED

    assert world.version(JOB_ID)["state"] == "approved"


def test_bad_path_a_raster_with_nothing_visible_fails_with_its_reason(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P08-BAD-NOTHING-VISIBLE"""
    seed_old_version(world, tmp_path)
    blank = Warped.of(grey_warped(tmp_path / "blank.tif", alpha_value=0))
    world.gcs.put(f"{FILES}cog.tif", write_cog(blank, tmp_path / "blank-cog.tif").read_bytes())

    assert run_tiles_job(world) is RunOutcome.FAILED

    assert dig(world.job(TILES_JOB), "error", "code") == Errors.PROCESSING_FAILED
    assert f"{FILES}tiles.pmtiles" not in world.gcs.names(FILES)


@pytest.mark.parametrize(("record", "words"), [({}, "no exported output"), ({"output": {"minzoom": "x"}}, "unreadable")])
def test_bad_path_a_version_without_output_or_with_an_unreadable_one_fails(record: dict[str, object], words: str) -> None:
    """Scenarios: S-P08-BAD-FAILS-ALONE"""
    with pytest.raises(StepFailedError, match=words):
        Rendered.of(record)


def test_happy_path_the_view_is_rgba_of_a_colour_layer_too(tmp_path: Path) -> None:
    """Scenarios: S-P08-HAPPY-FROM-WARP"""
    source = tmp_path / "colour.tif"
    dataset = driver_of("GTiff").Create(str(source), 8, 8, 4, gdal.GDT_Byte, ["ALPHA=YES"])
    dataset.Close()

    view = gdal.Open(str(rgba_view(source, tmp_path / "view.vrt")))

    assert view.RasterCount == 4
    assert view.GetRasterBand(4).GetColorInterpretation() == gdal.GCI_AlphaBand
