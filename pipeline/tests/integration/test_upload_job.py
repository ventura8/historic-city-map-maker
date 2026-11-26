"""An uploaded GeoTIFF end to end: `inspect` decides between its own georeference and a scan that needs points."""

from pathlib import Path

from hcm_pipeline.contract import Errors
from hcm_pipeline.model import Timestamp
from hcm_pipeline.rasters import GeoTiff, write_geotiff
from hcm_pipeline.runner import RunOutcome

from tests.fakes.world import CITY, NOW, OWNER_UID, PipelineWorld, dig, stamp_of

UPLOAD_ID = "up-plan1911"
LAYER = "planul-bucurestilor-1911"
UPLOAD_PATH = f"uploads/rasters/{CITY}/{OWNER_UID}/{UPLOAD_ID}/Qx7mP2rT9w.tif"
FILES = f"rasters/{CITY}/{LAYER}/{UPLOAD_ID}/"


def seed_upload(world: PipelineWorld, data: bytes) -> None:
    """The job and version `imagery.onRasterUpload` creates for an upload (the job id is the upload id)."""
    world.seed_city()
    world.gcs.put(UPLOAD_PATH, data)
    params = {"uploadPath": UPLOAD_PATH, "originalName": "Planul Bucureștilor 1911.tif", "replaces": False}
    world.seed_job(UPLOAD_ID, "geotiff-import", params, layer_id=LAYER)
    source = {"kind": "upload", "uploadPath": UPLOAD_PATH, "originalName": "Planul Bucureștilor 1911.tif", "bytes": len(data)}
    version = {"layerId": LAYER, "jobId": UPLOAD_ID, "origin": "upload", "state": "processing", "source": source}
    world.store.seed(
        world.version_path(UPLOAD_ID),
        {
            **version,
            "label": {"ro": "Planul Bucureștilor 1911"},
            "year": 1911,
            "createdBy": OWNER_UID,
            "createdAt": Timestamp.at(NOW - 50),
            **stamp_of(NOW - 50),
        },
    )


def run_upload(world: PipelineWorld) -> RunOutcome:
    return world.runner(world.config.__class__(**{**world.config.__dict__, "job_id": UPLOAD_ID})).run()


def test_happy_path_a_georeferenced_upload_is_warped_with_its_own_georeference(world: PipelineWorld) -> None:
    """Scenarios: S-P01-HAPPY-UPLOAD-GEOREFERENCED"""
    seed_upload(world, world.scene.sentinel2.read_bytes())

    outcome = run_upload(world)

    job, version = world.job(UPLOAD_ID), world.version(UPLOAD_ID)
    steps = job["steps"]
    assert isinstance(steps, dict)
    assert outcome is RunOutcome.DONE
    assert job["status"] == "awaiting_approval"
    assert {name: record["status"] for name, record in steps.items()} == {
        "inspect": "done",
        "reference": "skipped",
        "georef": "skipped",
        "warp": "done",
        "export": "done",
        "pyramid": "done",
        "register": "done",
    }
    assert version["state"] == "awaiting_approval"
    assert version["georef"] == {"method": "embedded", "transform": "affine", "gcps": []}
    assert dig(version, "output", "maxzoom") == 14
    assert world.http.paths() == []
    assert world.m2m.calls == []


def test_bad_path_a_plain_tiff_waits_for_points(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P01-BAD-UPLOAD-NO-GEOREF"""
    plain = write_geotiff(tmp_path / "plain.tif", GeoTiff([world.scene.world.pixels]))
    seed_upload(world, plain.read_bytes())

    outcome = run_upload(world)

    job, version = world.job(UPLOAD_ID), world.version(UPLOAD_ID)
    assert outcome is RunOutcome.WAITING
    assert (job["status"], job["waitReason"]) == ("awaiting_gcps", "gcps")
    assert "lease" not in job
    assert version["state"] == "needs_gcps"
    assert version["error"] == {"code": Errors.NO_MATCH, "params": {"pairs": "0"}}
    assert "georef" not in version
    assert dig(version, "scan", "width") == world.scene.world.pixels.shape[1]
    assert world.gcs.names(FILES) == [
        f"{FILES}{name}" for name in ("reference-osm.png", "reference-s2.jpg", "scan-preview.jpg", "scan.tif")
    ]


def test_bad_path_an_unreadable_upload_asks_for_the_file_again(world: PipelineWorld) -> None:
    """Scenarios: S-P01-BAD-PROCESSING-FAILED"""
    seed_upload(world, b"II*\x00not a raster at all")

    outcome = run_upload(world)

    assert outcome is RunOutcome.FAILED
    # The admin's own file could not be read: "check the file and upload it again" is the cure here, and only here.
    assert dig(world.job(UPLOAD_ID), "error", "code") == Errors.UNREADABLE_RASTER
