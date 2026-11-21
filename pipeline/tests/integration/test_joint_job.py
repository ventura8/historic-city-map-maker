"""A proved frame keeps its image, and a later frame of the city is joined to it held still (M15-calibration-accuracy.md, *Joint solve*)."""

from pathlib import Path
from typing import Final

import numpy
import pytest
from hcm_pipeline.config import load_config
from hcm_pipeline.geo import ground_scale
from hcm_pipeline.raster import gdal
from hcm_pipeline.runner import RunOutcome

from tests.contracts_loader import record, records
from tests.fakes.world import CITY, JOB_ID, LAYER_ID, PipelineWorld
from tests.synthetic.scenes import CENTRE

ALIGN: Final = f"rasters/{CITY}/{LAYER_ID}/{JOB_ID}/align.tif"
OLDER: Final = "v-older"
SECOND: Final = "job-2"


def edited(data: bytes, folder: Path, east_m: float = 0.0, flipped: bool = False) -> bytes:
    """An `align.tif` moved `east_m` ground metres east, or turned upside down (a frame of another place)."""
    source, target = folder / "align-in.tif", folder / "align-out.tif"
    source.write_bytes(data)
    dataset = gdal.Translate(str(target), str(source), format="GTiff")
    left, size, skew, top, turn, height = dataset.GetGeoTransform()
    dataset.SetGeoTransform((left + east_m / ground_scale(CENTRE[1]), size, skew, top, turn, height))
    band = dataset.GetRasterBand(1)
    grey = numpy.asarray(band.ReadAsArray())
    band.WriteArray(grey[::-1] if flipped else grey)
    dataset.Close()
    return target.read_bytes()


def accepted_copy(world: PipelineWorld, folder: Path, state: str = "published", east_m: float = 0.0, flipped: bool = False) -> None:
    """The first frame as a frame the admin accepted earlier, under its own id, with its image (moved, or another place's)."""
    world.store.seed(world.version_path(OLDER), {**world.version(), "jobId": OLDER, "state": state})
    world.gcs.put(f"rasters/{CITY}/{LAYER_ID}/{OLDER}/align.tif", edited(world.gcs.objects[ALIGN].data, folder, east_m, flipped))


def second_import(world: PipelineWorld) -> RunOutcome:
    world.seed_import(SECOND)
    return world.runner(load_config(world.env(JOB_ID=SECOND))).run()


def alignment(world: PipelineWorld, version_id: str) -> dict[str, object]:
    return record(record(world.version(version_id)["calibration"])["alignment"])


def test_happy_path_a_proved_frame_keeps_its_image_at_five_metres(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P06-HAPPY-JOINT-HELD-STILL"""
    world.seed_import()

    assert world.run() is RunOutcome.DONE

    assert ALIGN in world.gcs.names("rasters/")
    path = tmp_path / "align.tif"
    path.write_bytes(world.gcs.objects[ALIGN].data)
    dataset = gdal.Open(str(path))
    grey = numpy.asarray(dataset.GetRasterBand(1).ReadAsArray())
    assert dataset.GetRasterBand(1).GetNoDataValue() == 0
    assert abs(dataset.GetGeoTransform()[1]) * ground_scale(CENTRE[1]) == pytest.approx(5.0, rel=0.01)
    assert (grey > 0).mean() > 0.5
    dataset.Close()
    assert "alignment" not in record(world.version()["calibration"])


def test_happy_path_a_later_frame_is_fitted_with_an_accepted_frame_held_still_and_says_so(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P06-HAPPY-JOINT-HELD-STILL"""
    world.seed_import()
    assert world.run() is RunOutcome.DONE
    accepted_copy(world, tmp_path)
    before = world.version(OLDER)

    assert second_import(world) is RunOutcome.DONE

    partners = records(alignment(world, SECOND)["partners"])
    assert [(partner["versionId"], partner["status"], partner["year"]) for partner in partners] == [(OLDER, "used", 1966)]
    assert int(str(partners[0]["ties"])) >= 100
    assert float(str(partners[0]["offsetM"])) < 2.0
    assert record(world.version(SECOND)["georef"])["lattice"] is not None
    assert any(line.startswith("joined to 1 accepted frames held still") for line in world.log_lines(SECOND))
    assert world.version(OLDER) == before
    assert f"rasters/{CITY}/{LAYER_ID}/{SECOND}/align.tif" in world.gcs.names("rasters/")


def test_bad_path_an_accepted_frame_twenty_metres_off_is_left_out(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P06-BAD-JOINT-PARTNER-DISAGREES"""
    world.seed_import()
    assert world.run() is RunOutcome.DONE
    accepted_copy(world, tmp_path, east_m=20.0)

    assert second_import(world) is RunOutcome.DONE

    partner = records(alignment(world, SECOND)["partners"])[0]
    assert partner["status"] == "disagrees"
    assert float(str(partner["offsetM"])) == pytest.approx(20.0, abs=3.0)
    assert any(f"left out: {OLDER} (disagrees)" in line for line in world.log_lines(SECOND))
    assert float(str(record(world.version(SECOND)["georef"])["checkpointRmseM"])) < 2.0


def test_bad_path_a_frame_of_another_place_holds_nothing_still(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P06-BAD-JOINT-FEW-TIES"""
    world.seed_import()
    assert world.run() is RunOutcome.DONE
    accepted_copy(world, tmp_path, flipped=True)

    assert second_import(world) is RunOutcome.DONE

    partner = records(alignment(world, SECOND)["partners"])[0]
    assert partner["status"] == "few"
    assert int(str(partner["tried"])) > 50
    assert any(line.startswith("joined to 0 accepted frames held still") and f"{OLDER} (few)" in line for line in world.log_lines(SECOND))


def test_bad_path_a_frame_not_yet_accepted_is_never_held(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P06-BAD-JOINT-NOT-ACCEPTED"""
    world.seed_import()
    assert world.run() is RunOutcome.DONE
    accepted_copy(world, tmp_path, "awaiting_approval")

    assert second_import(world) is RunOutcome.DONE

    assert "alignment" not in record(world.version(SECOND)["calibration"])
    assert not any("accepted frames" in line for line in world.log_lines(SECOND))


def test_bad_path_an_accepted_frame_whose_image_gdal_cannot_read_is_left_out_and_the_frame_joins_the_others(
    world: PipelineWorld, tmp_path: Path
) -> None:
    """Scenarios: S-P06-BAD-JOINT-UNREADABLE"""
    world.seed_import()
    assert world.run() is RunOutcome.DONE
    accepted_copy(world, tmp_path)
    world.store.seed(world.version_path("v-corrupt"), {**world.version(OLDER), "jobId": "v-corrupt", "year": 1970})
    world.gcs.put(f"rasters/{CITY}/{LAYER_ID}/v-corrupt/align.tif", b"not a GeoTIFF")

    assert second_import(world) is RunOutcome.DONE

    partners = records(alignment(world, SECOND)["partners"])
    assert [(partner["versionId"], partner["status"]) for partner in partners] == [(OLDER, "used")]
    assert "the accepted frame v-corrupt could not be measured: fitted without it" in world.log_lines(SECOND)
