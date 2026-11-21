"""A USGS import job end to end: fetch to register against the loopback fakes (docs/research/M3-interfaces.md §5)."""

import hashlib
import io
import json
from pathlib import Path

import cv2
import numpy
from hcm_pipeline.contract import VERSION_FILES, Errors
from hcm_pipeline.geo import to_lnglat
from hcm_pipeline.model import Timestamp
from hcm_pipeline.raster import gdal
from hcm_pipeline.runner import RunOutcome

from tests.fakes.http import Reply
from tests.fakes.world import (
    CITY,
    ENTITY_ID,
    GOOD_SIGNATURE,
    JOB_ID,
    LAYER_ID,
    NOW,
    OVERPASS_PATH,
    S2_ITEM,
    STAC_PATH,
    PipelineWorld,
    dig,
)
from tests.synthetic.scenes import Scene

STEPS = ("fetch", "extract", "stitch", "locate", "reference", "georef", "warp", "export", "pyramid", "register")
RAW = f"usgs-raw/corona2/{ENTITY_ID}/{ENTITY_ID}.tgz"
WORK = f"work/{CITY}/{JOB_ID}/"
ARCHIVE_ONLY = frozenset({"stitched.jpg", "layout.json", "thumbs.jpg", "seams.jpg"})


def step_statuses(world: PipelineWorld) -> dict[str, str]:
    steps = world.job()["steps"]
    assert isinstance(steps, dict)
    return {name: str(record["status"]) for name, record in steps.items()}


def alignment_shift_m(world: PipelineWorld, scene: Scene, folder: Path) -> float:
    """How far (metres, EPSG:3857) the published COG sits from the synthetic world it was made from."""
    cog = folder / "cog.tif"
    cog.write_bytes(world.gcs.objects[f"rasters/{CITY}/{LAYER_ID}/{JOB_ID}/cog.tif"].data)
    grid = scene.world.grid
    box = grid.box()
    warped = gdal.Warp(
        str(folder / "on-world.tif"),
        str(cog),
        outputBounds=(box.left, box.bottom, box.right, box.top),
        xRes=grid.resolution,
        yRes=grid.resolution,
        dstAlpha=True,
    )
    layer, alpha = warped.GetRasterBand(1).ReadAsArray(), warped.GetRasterBand(2).ReadAsArray()
    warped.Close()
    rows, columns = numpy.nonzero(alpha)
    window = numpy.s_[rows.min() + 8 : rows.max() - 8, columns.min() + 8 : columns.max() - 8]
    (dx, dy), _ = cv2.phaseCorrelate(layer[window].astype(numpy.float64), scene.world.pixels[window].astype(numpy.float64))
    return float(numpy.hypot(dx, dy)) * grid.resolution


def test_happy_path_a_queued_import_becomes_a_version_awaiting_approval(
    world: PipelineWorld, tmp_path: Path, log_stream: io.StringIO
) -> None:
    """Scenarios: S-P01-HAPPY"""
    world.seed_import()

    outcome = world.run()

    job, version = world.job(), world.version()
    assert outcome is RunOutcome.DONE
    assert (job["status"], job["waitReason"], job["progress"]) == ("awaiting_approval", "approval", 1.0)
    assert "lease" not in job
    assert step_statuses(world) == dict.fromkeys(STEPS, "done")
    assert version["state"] == "awaiting_approval"
    georef, output, reference = version["georef"], version["output"], version["reference"]
    assert isinstance(georef, dict)
    assert isinstance(output, dict)
    assert isinstance(reference, dict)
    assert (georef["method"], georef["transform"]) == ("auto", "poly2")
    assert georef["checkpointRmseM"] < 15
    assert georef["checkpointCount"] >= 3
    assert georef["checkpointKind"] == "held-out"
    assert (output["minzoom"], output["maxzoom"]) == (10, 16)
    assert output["areaKm2"] > 15
    assert reference["s2Item"] == S2_ITEM
    # One clear date is all the catalogue holds: taken, and recorded as unchecked.
    assert dig(reference, "s2Check", "status") == "unchecked"
    assert alignment_shift_m(world, world.scene, tmp_path) < 10
    # A frame has no stitched picture and no tile layout: those are an archive series' files (M22 §4.1, M20 §19.7).
    # The sharper scan exists only for a crop longer than its preview (`publish_scan`); the version says which.
    scan = version["scan"]
    assert isinstance(scan, dict)
    absent = ARCHIVE_ONLY | (set() if scan.get("detailPath") else {"scan-tiles.bin"})
    assert world.gcs.names(f"rasters/{CITY}/{LAYER_ID}/{JOB_ID}/") == [
        f"rasters/{CITY}/{LAYER_ID}/{JOB_ID}/{name}" for name in sorted(set(VERSION_FILES) - absent)
    ]
    assert world.gcs.names(WORK) == []
    # The delivery was fetched whole, then deleted once the city crop existed (M7 §5: S-P01-HAPPY-RAW-DELETED).
    assert dig(job, "steps", "fetch", "gcsPath") == RAW
    assert dig(job, "steps", "fetch", "sha256") == hashlib.sha256(world.delivery).hexdigest()
    assert world.gcs.names("usgs-raw/") == []
    assert "step register done" in world.log_lines()
    assert GOOD_SIGNATURE not in world.everything_written(log_stream)


def test_happy_path_the_cog_is_an_8_bit_web_mercator_cog_with_overviews(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P01-HAPPY"""
    world.seed_import()
    world.run()
    cog = tmp_path / "cog.tif"
    cog.write_bytes(world.gcs.objects[f"rasters/{CITY}/{LAYER_ID}/{JOB_ID}/cog.tif"].data)

    info = gdal.Info(str(cog), format="json")

    assert dig(info, "metadata", "IMAGE_STRUCTURE", "LAYOUT") == "COG"
    band = info["bands"][0]
    assert dig(band, "type") == "Byte"
    assert dig(band, "overviews")
    assert "3857" in str(dig(info, "coordinateSystem", "wkt")).split("ID[")[-1]


def test_bad_path_a_corrupt_archive_fails_at_extract_and_is_discarded(world: PipelineWorld) -> None:
    """Scenarios: S-P01-BAD-CORRUPT-ARCHIVE"""
    world.delivered = b"\x1f\x8b" + b"not really gzip" * 100
    world.offer_download(len(world.delivered))
    world.seed_import()

    outcome = world.run()

    job = world.job()
    assert outcome is RunOutcome.FAILED
    assert job["status"] == "failed"
    assert dig(job, "error", "code") == Errors.ARCHIVE_CORRUPT
    assert step_statuses(world)["extract"] == "failed"
    assert world.version()["state"] == "failed"
    assert world.gcs.names("usgs-raw/") == []


def test_bad_path_no_sentinel2_item_fails_at_locate_with_reference_unavailable(world: PipelineWorld) -> None:
    """Scenarios: S-P01-BAD-NO-REFERENCE"""
    world.stac_items = False
    world.seed_import()

    outcome = world.run()

    assert outcome is RunOutcome.FAILED
    assert dig(world.job(), "error", "code") == Errors.REFERENCE_UNAVAILABLE
    assert step_statuses(world)["locate"] == "failed"


def test_bad_path_sentinel2_items_that_leave_a_hole_in_the_window_fail_at_locate(world: PipelineWorld) -> None:
    """Scenarios: S-P01-BAD-MOSAIC-NOT-COVERED"""
    west, south = to_lnglat(world.scene.world.grid.left, world.scene.world.grid.box().bottom)
    item = {
        "id": "half",
        "bbox": [west - 1, south - 1, west + 0.001, south + 5],
        "properties": {"datetime": "2025-08-03T09:20:31Z", "eo:cloud_cover": 3.2},
        "assets": {"visual": {"href": world.http.url("/s2/visual.tif")}},
    }
    world.http.enqueue(f"{STAC_PATH}/search", Reply.json(json.dumps({"features": [item]})))
    world.seed_import()

    outcome = world.run()

    assert outcome is RunOutcome.FAILED
    assert dig(world.job(), "error", "code") == Errors.REFERENCE_UNAVAILABLE
    assert step_statuses(world)["locate"] == "failed"


def test_bad_path_a_least_cloudy_date_twelve_metres_south_is_rejected_and_the_version_records_the_check(world: PipelineWorld) -> None:
    """Scenarios: S-P06-BAD-REFERENCE-SHIFTED-DATE, S-P06-BAD-REFERENCE-UNREADABLE"""
    world.stac_extra = [
        ("unreadable", "2025-01-02", 0.5, "s3://sentinel-s2-l2a/tiles/35/T/MK/TCI.jp2"),
        ("shifted", "2025-03-01", 1.0, world.serve_sentinel2_moved("shifted", -12.0)),
        ("twin", "2025-05-01", 5.0, world.serve_sentinel2_moved("twin", 0.0)),
    ]
    world.seed_import()

    outcome = world.run()

    reference = world.version()["reference"]
    scenes = dig(reference, "s2Check", "scenes")
    assert outcome is RunOutcome.DONE
    assert dig(reference, "s2Item") == S2_ITEM
    assert (dig(reference, "s2Check", "status"), dig(reference, "s2Check", "chosen")) == ("agreed", 2)
    assert isinstance(scenes, list)
    assert [scene["kept"] for scene in scenes] == [False, False, True, True]
    assert "northM" not in scenes[0]
    assert abs(scenes[1]["northM"] + 12.0) < 1.5
    assert abs(scenes[2]["northM"]) < 1.0
    lines = world.log_lines()
    # `locate` measured the dates once; `reference` read the verdict the cached window carries.
    assert sum("sits" in line and "off the other dates" in line for line in lines) == 1
    assert any("unreadable could not be read for the reference check" in line for line in lines)


def test_bad_path_a_window_cached_before_the_guard_is_measured_again(world: PipelineWorld) -> None:
    """Scenarios: S-P06-BAD-REFERENCE-TOO-FEW"""
    world.seed_import()
    runner = world.runner()
    for step in ("fetch", "extract", "stitch", "locate"):
        assert runner.run(step) is RunOutcome.DONE
    [cached] = world.gcs.names(f"reference/{CITY}/s2/")
    world.gcs.put(cached, world.scene.sentinel2.read_bytes())

    assert world.runner().run("reference") is RunOutcome.DONE

    assert dig(world.version(), "reference", "s2Check", "status") == "unchecked"
    assert world.gcs.objects[cached].data != world.scene.sentinel2.read_bytes()


def test_bad_path_overpass_down_fails_at_reference_with_reference_unavailable(world: PipelineWorld) -> None:
    """Scenarios: S-P01-BAD-NO-REFERENCE"""
    for _ in range(3):
        world.http.enqueue(OVERPASS_PATH, Reply(503, b"<html>busy</html>", "text/html"))
    world.seed_import()

    outcome = world.run()

    assert outcome is RunOutcome.FAILED
    assert dig(world.job(), "error", "code") == Errors.REFERENCE_UNAVAILABLE
    assert step_statuses(world)["reference"] == "failed"


def test_bad_path_a_second_execution_of_a_leased_job_does_nothing(world: PipelineWorld) -> None:
    """Scenarios: S-P01-BAD-DUPLICATE-EXECUTION"""
    world.seed_import(status="running")
    world.store.update(world.job_path(), {"lease": {"owner": "raster-pipeline-other/0", "until": Timestamp.at(NOW + 300)}})
    world.store.writes.clear()

    outcome = world.run()

    assert outcome is RunOutcome.UNTOUCHED
    assert world.store.writes == []
    assert world.m2m.calls == []
