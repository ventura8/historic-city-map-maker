"""Re-georeferencing a version with the admin's points, and cropping it (scenario P02)."""

from pathlib import Path

import numpy
from hcm_pipeline.contract import Errors
from hcm_pipeline.model import Timestamp
from hcm_pipeline.objects import sha256_of
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import GeoTiff, write_geotiff
from hcm_pipeline.runner import RunOutcome

from tests.fakes.world import CITY, LAYER_ID, NOW, OWNER_UID, PipelineWorld, dig, stamp_of
from tests.synthetic.scenes import AffineScan, affine_scan

BASE = "v-base-1966"
JOB = "job-regeoref-1"
BASE_SCAN = f"rasters/{CITY}/{LAYER_ID}/{BASE}/scan.tif"


def manual_gcps(scan: AffineScan, places: list[tuple[float, float]], disabled: int = 0) -> list[dict[str, object]]:
    gcps = []
    for index, (u, v) in enumerate(places, start=1):
        lng, lat = scan.to_lnglat(u, v)
        gcps.append(
            {"id": f"g{index}", "pixel": {"x": u, "y": v}, "geo": {"lat": lat, "lng": lng}, "enabled": index > disabled, "origin": "manual"}
        )
    return gcps


SPREAD = [(100.0, 80.0), (1100.0, 90.0), (1080.0, 820.0), (120.0, 800.0), (600.0, 450.0), (350.0, 250.0), (850.0, 640.0), (300.0, 700.0)]


def seed_regeoref(
    world: PipelineWorld, tmp_path: Path, gcps: list[dict[str, object]], crop: list[dict[str, float]] | None = None
) -> AffineScan:
    """A published base version with its scan, and the `regeoref` job and version `imagery.saveGcps` creates."""
    world.seed_city()
    scan = affine_scan(world.scene.world)
    local = write_geotiff(tmp_path / "scan.tif", GeoTiff([scan.pixels]))
    world.gcs.put(BASE_SCAN, local.read_bytes())
    height, width = scan.pixels.shape
    scan_record = {
        "path": BASE_SCAN,
        "width": width,
        "height": height,
        "sha256": sha256_of(local),
        "previewPath": f"rasters/{CITY}/{LAYER_ID}/{BASE}/scan-preview.jpg",
        "previewScale": 1,
    }
    world.seed_job(JOB, "regeoref", {"basedOn": BASE})
    version = {
        "layerId": LAYER_ID,
        "jobId": JOB,
        "origin": "crop" if crop else "regeoref",
        "basedOn": BASE,
        "state": "processing",
        "label": {"ro": "KH-4A Corona, 12 iulie 1966"},
        "year": 1966,
        "scan": scan_record,
        "georef": {"method": "gcps", "transform": "affine", "gcps": gcps},
        "createdBy": OWNER_UID,
        "createdAt": Timestamp.at(NOW - 20),
        **stamp_of(NOW - 20),
        **({"crop": crop} if crop else {}),
    }
    world.store.seed(world.version_path(JOB), version)
    return scan


def run_regeoref(world: PipelineWorld) -> RunOutcome:
    return world.runner(world.config.__class__(**{**world.config.__dict__, "job_id": JOB})).run()


def test_happy_path_new_points_render_a_new_version_from_the_base_scan(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P02-HAPPY"""
    scan = seed_regeoref(world, tmp_path, manual_gcps(affine_scan(world.scene.world), SPREAD, disabled=1))
    base_generation = world.gcs.objects[BASE_SCAN].generation

    outcome = run_regeoref(world)

    version = world.version(JOB)
    georef = version["georef"]
    assert isinstance(georef, dict)
    assert outcome is RunOutcome.DONE
    assert version["state"] == "awaiting_approval"
    assert georef["method"] == "gcps"
    assert georef["fitRmseM"] < 0.01
    assert (georef["checkpointRmseM"], georef["checkpointCount"]) == (0.0, 1)
    assert all(gcp["residualM"] < 0.01 for gcp in georef["gcps"])
    assert (dig(version, "output", "minzoom"), dig(version, "output", "maxzoom")) == (10, 15)
    assert world.gcs.objects[BASE_SCAN].generation == base_generation
    assert world.m2m.calls == []
    assert scan.pixels.shape == (900, 1200)


def test_bad_path_collinear_points_fail_at_georef(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P02-BAD-DEGENERATE-GCPS"""
    line = [(100.0 + 100 * index, 80.0 + 70 * index) for index in range(6)]
    seed_regeoref(world, tmp_path, manual_gcps(affine_scan(world.scene.world), line))

    outcome = run_regeoref(world)

    job = world.job(JOB)
    steps = job["steps"]
    assert isinstance(steps, dict)
    assert outcome is RunOutcome.FAILED
    assert dig(job, "error", "code") == Errors.DEGENERATE_GCPS
    assert dig(steps, "georef", "status") == "failed"
    assert world.version(JOB)["state"] == "failed"


def test_happy_path_a_crop_ring_cuts_the_layer(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P02-HAPPY-CROP"""
    scan = affine_scan(world.scene.world)
    corners = ((300.0, 200.0), (900.0, 250.0), (600.0, 750.0))
    ring = [scan.to_lnglat(u, v) for u, v in corners]
    seed_regeoref(world, tmp_path, manual_gcps(scan, SPREAD), [{"lat": lat, "lng": lng} for lng, lat in ring])

    outcome = run_regeoref(world)

    cog = tmp_path / "cog.tif"
    cog.write_bytes(world.gcs.objects[f"rasters/{CITY}/{LAYER_ID}/{JOB}/cog.tif"].data)
    dataset = gdal.Open(str(cog))
    mask = numpy.asarray(dataset.GetRasterBand(1).GetMaskBand().ReadAsArray())
    left, resolution, _, top, _, _ = dataset.GetGeoTransform()
    dataset.Close()
    centre_x, centre_y = scan.to_mercator(sum(u for u, _ in corners) / 3, sum(v for _, v in corners) / 3)
    column, row = int((centre_x - left) / resolution), int((top - centre_y) / resolution)
    assert outcome is RunOutcome.DONE
    assert world.version(JOB)["origin"] == "crop"
    assert mask[row, column] == 255
    assert (mask[0, 0], mask[-1, 0]) == (0, 0)
    assert 0.3 < float(numpy.count_nonzero(mask)) / mask.size < 0.7
