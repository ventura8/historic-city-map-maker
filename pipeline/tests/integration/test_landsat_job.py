"""A Landsat import end to end against the loopback fakes (docs/research/M25-landsat.md §3, §8): a synthetic Level-1 bundle of the
synthetic world, fetched, its bands kept, composed on the tile grid and checked against the world's Sentinel-2."""

from pathlib import Path
from typing import Final

from hcm_pipeline.geo import MercatorBox, to_mercator
from hcm_pipeline.model import Timestamp
from hcm_pipeline.raster import gdal
from hcm_pipeline.runner import RunOutcome

from tests.fakes.world import CITY, ENTITY_ID, JOB_ID, LAYER_ID, NOW, OWNER_UID, PipelineWorld, dig, stamp_of
from tests.synthetic.landsat import ETM_PRODUCT, OLI_PRODUCT, SYSTEMATIC_PRODUCT, Bundle, landsat_bundle
from tests.synthetic.scenes import CENTRE

STEPS: Final = ("fetch", "extract", "stitch", "locate", "reference", "georef", "warp", "export", "pyramid", "register")
SKIPPED: Final = frozenset({"stitch", "locate", "georef"})
WORK: Final = f"work/{CITY}/{JOB_ID}/"


def seed_landsat(world: PipelineWorld, sensor: str = "L5-TM", dataset: str = "landsat_tm_c2_l1") -> None:
    """A `usgs-import` of a Landsat scene and its version, as `imagery.import` and the dispatcher leave them."""
    world.seed_city()
    params = {"entityId": ENTITY_ID, "dataset": dataset, "sensor": sensor}
    world.seed_job(JOB_ID, "usgs-import", params)
    world.store.seed(
        world.version_path(),
        {
            "layerId": LAYER_ID,
            "jobId": JOB_ID,
            "origin": "usgs",
            "state": "processing",
            "source": {"kind": "usgs", "entityId": ENTITY_ID, "dataset": dataset, "sensor": sensor, "acquisitionDate": "1989-07-12"},
            "label": {"ro": "Landsat 5 TM, 12 iulie 1989", "en": "Landsat 5 TM, 12 July 1989"},
            "year": 1989,
            "date": "1989-07-12",
            "sensor": sensor,
            "createdBy": OWNER_UID,
            "createdAt": Timestamp.at(NOW - 100),
            **stamp_of(NOW - 100),
        },
    )


def deliver(world: PipelineWorld, folder: Path, bundle: Bundle | None = None) -> None:
    world.delivered = landsat_bundle(world.scene.world, folder, bundle or Bundle())
    world.offer_download(len(world.delivered))


def statuses(world: PipelineWorld) -> dict[str, str]:
    steps = world.job()["steps"]
    assert isinstance(steps, dict)
    return {name: str(record["status"]) for name, record in steps.items()}


def landsat_report(world: PipelineWorld) -> dict[str, object]:
    report = world.version()["landsat"]
    assert isinstance(report, dict)
    return report


def test_happy_path_a_landsat_scene_becomes_a_true_colour_layer_within_a_pixel(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P30-HAPPY"""
    seed_landsat(world)
    deliver(world, tmp_path / "bundle")

    outcome = world.run()

    assert outcome is RunOutcome.DONE
    assert world.job()["status"] == "awaiting_approval"
    assert statuses(world) == {step: "skipped" if step in SKIPPED else "done" for step in STEPS}
    version = world.version()
    assert version["state"] == "awaiting_approval"
    assert "georef" not in version
    assert (dig(version, "output", "minzoom"), dig(version, "output", "maxzoom")) == (8, 13)
    report = landsat_report(world)
    assert report["checked"] is True
    assert isinstance(report["offsetPx"], float)
    assert report["offsetPx"] <= 1
    assert (report["cityCloudPct"], report["resolutionM"], report["pansharpened"]) == (0.0, 30, False)
    # The delivery goes once the image is in the bucket, the scratch once the version is registered.
    assert world.gcs.names("usgs-raw/") == []
    assert world.gcs.names(WORK) == []


def test_happy_path_an_etm_scene_is_pan_sharpened_to_15_m_at_z14(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P30-HAPPY-ETM"""
    seed_landsat(world, "L7-ETM", "landsat_etm_c2_l1")
    deliver(world, tmp_path / "bundle", Bundle(product=ETM_PRODUCT, bands=("B1", "B2", "B3", "B8", "QA_PIXEL")))

    assert world.run() is RunOutcome.DONE

    assert dig(world.version(), "output", "maxzoom") == 14
    report = landsat_report(world)
    assert (report["pansharpened"], report["resolutionM"]) == (True, 15)
    assert report["checked"] is True


def test_happy_path_an_oli_scene_takes_b4_b3_b2_and_is_pan_sharpened_to_15_m(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P30-HAPPY-OLI"""
    seed_landsat(world, "L9-OLI", "landsat_ot_c2_l1")
    deliver(world, tmp_path / "bundle", Bundle(product=OLI_PRODUCT, bands=("B1", "B2", "B3", "B4", "B8", "QA_PIXEL")))

    assert world.run() is RunOutcome.DONE

    assert dig(world.version(), "output", "maxzoom") == 14
    report = landsat_report(world)
    assert (report["pansharpened"], report["resolutionM"]) == (True, 15)


def test_bad_path_an_oli_bundle_without_its_red_band_b4_fails_with_the_missing_band(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P30-BAD-OLI-MISSING-BAND"""
    seed_landsat(world, "L8-OLI", "landsat_ot_c2_l1")
    deliver(world, tmp_path / "bundle", Bundle(product=OLI_PRODUCT, bands=("B1", "B2", "B3", "B8", "QA_PIXEL")))

    world.run()

    assert dig(world.job(), "error", "params", "band") == "B4"


def test_bad_path_a_bundle_without_its_red_band_fails_with_the_missing_band(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P30-BAD-MISSING-BAND"""
    seed_landsat(world)
    deliver(world, tmp_path / "bundle", Bundle(left_out=frozenset({"B3"})))

    world.run()

    job = world.job()
    assert job["status"] == "failed"
    assert dig(job, "error", "code") == "apiError.imagery.missingBand"
    assert dig(job, "error", "params", "band") == "B3"
    assert statuses(world)["extract"] == "failed"


def test_bad_path_a_scene_off_sentinel_2_or_under_cloud_says_so_in_its_report(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P30-BAD-OFFSET"""
    world.stac_href = world.serve_sentinel2_moved("north-90", 90.0)
    cx, cy = to_mercator(*CENTRE)
    seed_landsat(world)
    deliver(world, tmp_path / "bundle", Bundle(cloud=MercatorBox(cx - 2000, cy - 1500, cx + 2000, cy + 1500)))

    assert world.run() is RunOutcome.DONE

    report = landsat_report(world)
    assert report["checked"] is True
    assert isinstance(report["offsetPx"], float)
    assert report["offsetPx"] > 1
    assert isinstance(report["northM"], float)
    assert report["northM"] < 0
    assert isinstance(report["cityCloudPct"], float)
    assert report["cityCloudPct"] > 10


def test_happy_path_the_warped_layer_is_rgba_on_the_tile_grid(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P30-HAPPY"""
    seed_landsat(world)
    deliver(world, tmp_path / "bundle")
    world.run()
    preview = tmp_path / "preview.png"
    preview.write_bytes(world.gcs.objects[f"rasters/{CITY}/{LAYER_ID}/{JOB_ID}/preview.png"].data)

    info = gdal.Info(str(preview), format="json")

    assert len(info["bands"]) == 4


def test_happy_path_a_systematic_scene_off_sentinel_2_is_moved_onto_it_and_says_so(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P30-HAPPY-SYSTEMATIC-MOVED"""
    # Lesson 727: Bucharest's L1GS scene of 15 August 2008 lay 3,744 m off.
    world.stac_href = world.serve_sentinel2_moved("north-90", 90.0)
    seed_landsat(world)
    deliver(world, tmp_path / "bundle", Bundle(product=SYSTEMATIC_PRODUCT))

    assert world.run() is RunOutcome.DONE

    report = landsat_report(world)
    correction = report["correction"]
    assert isinstance(correction, dict)
    assert correction["state"] == "applied"
    assert isinstance(correction["northM"], float)
    assert correction["northM"] < -60
    assert isinstance(report["offsetPx"], float)
    assert report["offsetPx"] <= 1
