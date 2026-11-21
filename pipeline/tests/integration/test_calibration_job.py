"""A frame's calibration through the real runner and steps (docs/research/M9-calibration.md §5 to §7)."""

import json
import math
from pathlib import Path
from typing import Final, cast

import numpy
import pytest
from hcm_pipeline.contract import Errors
from hcm_pipeline.documents import OutputInfo, Version
from hcm_pipeline.geo import Bounds, Grid, ground_scale
from hcm_pipeline.jobs import JobContext
from hcm_pipeline.join.canvas import DatasetSource, aligned_box
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import driver_of
from hcm_pipeline.runner import RunOutcome
from hcm_pipeline.steps import export, warp
from hcm_pipeline.steps.export import Warped, rendered_outline
from hcm_pipeline.steps.merge import coverage_pct

from tests.contracts_loader import record, records
from tests.fakes.http import Reply
from tests.fakes.world import CITY, JOB_ID, LAYER_ID, OVERPASS_PATH, PipelineWorld, city_bounds, dig
from tests.integration.matching import S2_OBJECT, Seeded, seed_matching
from tests.synthetic.scenes import overpass_answer, render_world, write_sentinel2

WORK: Final = f"work/{CITY}/{JOB_ID}/"
SCAN: Final = f"rasters/{CITY}/{LAYER_ID}/{JOB_ID}/scan.tif"
# The hand-read error of rough points (EPSG:3857 metres, each its own way).
ROUGH: Final = (40.0, -30.0)


def calibration(world: PipelineWorld) -> dict[str, object]:
    return record(world.version()["calibration"])


def test_happy_path_a_proved_frame_records_how_and_needs_no_admin(world: PipelineWorld) -> None:
    """Scenarios: S-P06-HAPPY-VOTES, S-P06-HAPPY-WARP-CLIPPED"""
    world.seed_import()

    assert world.run() is RunOutcome.DONE

    found = calibration(world)
    georef = record(world.version()["georef"])
    assert found["how"] == "votes"
    assert int(str(record(found["votes"])["agreed"])) >= 8
    assert int(str(record(found["tiles"])["agreed"])) >= 60
    assert float(str(found["crossValidatedM"])) < 15
    assert float(str(found["coveredPct"])) > 90
    assert len(records(found["outline"])) >= 3
    assert record(found["model"])["camera"] == "corners"
    assert georef["method"] == "auto"
    assert georef["checkpointKind"] == "held-out"
    assert any(gcp["enabled"] is False and gcp["origin"] == "auto" for gcp in records(georef["gcps"]))
    assert world.gcs.names("usgs-raw/") == []
    assert any(line.startswith("tile votes:") for line in world.log_lines())
    assert any(line.startswith("proved:") and "delivery deleted" in line for line in world.log_lines())
    output = record(world.version()["output"])
    assert float(str(output["coveragePct"])) > 80


def test_happy_path_a_retry_of_georef_with_its_tiles_gone_measures_them_again(world: PipelineWorld) -> None:
    """Scenarios: S-P06-HAPPY-VOTES"""
    world.seed_import()
    runner = world.runner()
    for step in ("fetch", "extract", "stitch", "locate", "reference"):
        assert runner.run(step) is RunOutcome.DONE
    world.gcs.objects.pop(f"{WORK}calibration.json")

    assert world.runner().run("georef") is RunOutcome.DONE

    assert dig(world.version(), "georef", "method") == "auto"
    assert any("measured again" in line for line in world.log_lines())


def test_bad_path_a_retry_keeps_a_camera_map_its_pairs_cannot_rebuild(world: PipelineWorld) -> None:
    """Scenarios: S-P06-BAD-PANORAMIC-FALLS-BACK"""
    world.seed_import()
    runner = world.runner()
    for step in ("fetch", "extract", "stitch", "locate", "reference", "georef"):
        assert runner.run(step) is RunOutcome.DONE
    georef = record(world.version()["georef"])
    sides = range(0, 1700, 100)
    nodes = [{"pixel": {"x": x, "y": y}, "geo": {"lat": 44.4 + y * 1e-6, "lng": 26.0 + x * 1e-6}} for y in sides for x in sides]
    kept = {**georef, "lattice": {"model": "panoramic", "nodes": nodes}}
    world.store.update(world.version_path(), {"georef": kept})
    # A retry runs the step again (a job retried after `georef`, or resumed while it ran).
    world.store.update(world.job_path(), {"steps.georef": {"status": "pending"}})

    assert world.runner().run("georef") is RunOutcome.DONE

    assert world.version()["georef"] == kept
    assert any(line.startswith("kept: the panoramic map") for line in world.log_lines())


def test_bad_path_tiles_that_no_longer_prove_go_on_to_the_matcher(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P06-BAD-SEEDED-REFUSED"""
    world.seed_import()
    runner = world.runner()
    for step in ("fetch", "extract", "stitch", "locate", "reference"):
        assert runner.run(step) is RunOutcome.DONE
    world.gcs.objects.pop(f"{WORK}calibration.json")
    reference = dig(world.job(), "steps", "reference", "gcsPath")
    world.gcs.put(str(reference), write_sentinel2(render_world(99), tmp_path / "other.tif").read_bytes())

    world.runner().run("georef")

    assert any(line.startswith("the proof's tiles are gone") for line in world.log_lines())
    assert any(" over " in line and "tiles matched" in line for line in world.log_lines())
    # A fit the matcher made is no longer the proof's: the record says so, and the policy reads it (M9 §11).
    if dig(world.version(), "georef", "method") == "auto":
        assert calibration(world)["how"] == "matcher"
        assert "measuredPct" not in calibration(world)


def test_bad_path_a_frame_of_another_place_waits_with_a_bounded_crop_and_says_why(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P06-BAD-OFF-STRIP"""
    other = render_world(99)
    world.http.serve("/s2/visual.tif", write_sentinel2(other, tmp_path / "elsewhere.tif").read_bytes())
    world.http.route("POST", OVERPASS_PATH, lambda _request: Reply.json(json.dumps(overpass_answer(other))))
    world.seed_import()

    assert world.run() is RunOutcome.WAITING

    found = calibration(world)
    assert found["how"] == "none"
    assert found["refusal"] in ("no-votes", "few-inliers", "low-share", "narrow", "small", "cross-validation", "gross")
    assert world.version()["state"] == "needs_gcps"
    assert dig(world.version(), "error", "code") == Errors.NO_MATCH
    assert world.gcs.names("usgs-raw/") != []
    assert "georef" not in world.version()
    assert any(line.startswith("not proved") and "delivery kept" in line for line in world.log_lines())


def test_happy_path_a_prior_of_the_pass_is_read_and_used(world: PipelineWorld) -> None:
    """Scenarios: S-P06-HAPPY-PASS-PRIOR"""
    world.seed_import()
    scene = f"cities/{CITY}/usgsScenes/{world.scene.spec.entity_id}"
    acquired = world.store.documents[scene]["acquisitionDate"]
    world.store.create(
        f"cities/{CITY}/imageryPasses/DS1035-1057D-A-{acquired}",
        {"model": {"camera": "corners", "rotation": 0, "mirrored": False, "scale": 1.0, "rotationDeg": 0.0, "dxM": -240.0, "dyM": 160.0}},
    )

    assert world.run() is RunOutcome.DONE

    assert calibration(world)["how"] == "pass"
    assert record(calibration(world)["model"])["camera"] == "corners"


def _points(seeded: Seeded, count: int = 12) -> list[dict[str, object]]:
    """Rough points over the scan, as an admin reads them."""
    height, width = seeded.pixels.shape
    points = []
    for index in range(count):
        u, v = width * (index % 4 + 0.5) / 4, height * (index // 4 + 0.5) / 3
        lng, lat = seeded.truth.to_lnglat(u + ROUGH[index % 2] * 0.1, v + ROUGH[index % 2] * 0.1)
        points.append({"id": f"p{index}", "pixel": {"x": u, "y": v}, "geo": {"lat": lat, "lng": lng}, "enabled": True, "origin": "manual"})
    return points


def _with_points(world: PipelineWorld, seeded: Seeded, change: dict[str, object] | None = None) -> None:
    gcps = _points(seeded)
    gcps[0].update(change or {})
    world.store.update(world.version_path(), {"georef": {"method": "gcps", "transform": "affine", "gcps": gcps}})


def test_happy_path_the_admins_rough_points_seed_the_tiles_and_are_replaced(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P06-HAPPY-SEEDED-POINTS"""
    seeded = seed_matching(world, tmp_path, wide=True)
    _with_points(world, seeded)

    assert world.runner().run("georef") is RunOutcome.DONE

    georef = record(world.version()["georef"])
    assert georef["method"] == "auto"
    assert georef["checkpointKind"] == "held-out"
    assert all(gcp["origin"] == "auto" for gcp in records(georef["gcps"]))
    assert calibration(world)["how"] == "points"
    assert calibration(world)["seedPoints"] == 12
    assert any("replace the points" in line for line in world.log_lines())


def test_bad_path_points_the_tiles_refuse_are_fitted_as_saved(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P06-BAD-SEEDED-REFUSED"""
    seeded = seed_matching(world, tmp_path, wide=True)
    _with_points(world, seeded)
    world.gcs.put(S2_OBJECT, write_sentinel2(render_world(99), tmp_path / "other.tif").read_bytes())

    assert world.runner().run("georef") is RunOutcome.DONE

    georef = record(world.version()["georef"])
    assert georef["method"] == "gcps"
    assert georef["checkpointKind"] == "leave-one-out"
    assert "calibration" not in world.version()
    assert any("not proved" in line and "fitted as saved" in line for line in world.log_lines())


@pytest.mark.parametrize("change", [{"enabled": False}, {"origin": "auto"}])
def test_bad_path_a_set_with_a_disabled_or_automatic_pair_is_fitted_as_saved(
    world: PipelineWorld, tmp_path: Path, change: dict[str, object]
) -> None:
    """Scenarios: S-P06-BAD-SEEDED-REFUSED"""
    seeded = seed_matching(world, tmp_path)
    _with_points(world, seeded, change)

    assert world.runner().run("georef") is RunOutcome.DONE

    assert dig(world.version(), "georef", "method") == "gcps"
    assert "calibration" not in world.version()


def test_happy_path_a_usgs_frame_renders_nothing_beyond_the_window_and_an_upload_is_free(world: PipelineWorld) -> None:
    """Scenarios: S-P06-HAPPY-WARP-CLIPPED"""
    window = Bounds.of(city_bounds()).mercator().expanded()
    box = aligned_box(window)
    world.seed_import()

    assert world.run() is RunOutcome.DONE

    version = world.version()
    bounds = Bounds.of(record(version["output"])["bounds"]).mercator()
    assert bounds.left >= box.left - 1
    assert bounds.right <= box.right + 1
    assert bounds.top <= box.top + 1
    assert bounds.bottom >= box.bottom - 1


def test_bad_path_a_crop_ring_and_an_upload_are_left_to_their_own_extent() -> None:
    """Scenarios: S-P06-HAPPY-WARP-CLIPPED"""
    ctx_version = Version.of("v", {"layerId": "l", "origin": "upload", "state": "processing", "source": {"kind": "upload"}})
    ringed = Version.of(
        "v",
        {
            "layerId": "l",
            "origin": "usgs",
            "state": "processing",
            "source": {"kind": "usgs"},
            "crop": [{"lat": 1.0, "lng": 1.0}, {"lat": 2.0, "lng": 1.0}, {"lat": 2.0, "lng": 2.0}],
        },
    )

    # Neither reads the city: no window decides them.
    no_context = cast(JobContext, None)
    assert warp.clipped(no_context, ctx_version) == {}
    assert warp.clipped(no_context, ringed) == {}


def _alpha_raster(path: Path, grid: Grid, covered: numpy.ndarray) -> None:
    dataset = driver_of("GTiff").Create(str(path), grid.width, grid.height, 2, gdal.GDT_Byte)
    dataset.SetGeoTransform(grid.geotransform())
    dataset.GetRasterBand(1).WriteArray(covered * 120)
    dataset.GetRasterBand(2).WriteArray(covered * 255)
    dataset.Close()


def test_bad_path_a_crop_is_measured_against_the_whole_city_not_against_its_own_grid(tmp_path: Path) -> None:
    """Scenarios: S-P06-BAD-CROP-COVERAGE"""
    city = Bounds.of(city_bounds()).mercator()
    half = Grid(city.left, city.top, 10.0, round(city.width / 20), round(city.height / 10))
    path = tmp_path / "half.tif"
    _alpha_raster(path, half, numpy.ones((half.height, half.width), numpy.uint8))
    source = DatasetSource(path)

    share = coverage_pct(source, half, city)

    # The join's formula alone would say 100 %: the frame holds half of the city.
    assert share == pytest.approx(50.0, abs=1.0)
    far = Grid(city.right + 1e5, city.top, 10.0, 10, 10)
    assert coverage_pct(source, far, city) == 0.0
    source.close()


def test_happy_path_a_render_says_where_it_shows_the_city(tmp_path: Path) -> None:
    """Scenarios: S-P06-HAPPY-RENDERED-OUTLINE"""
    city = Bounds.of(city_bounds()).mercator()
    window = city.expanded()
    grid = Grid(window.left, window.top, 10.0, round(window.width / 10), round(window.height / 10))
    path = tmp_path / "west.tif"
    alpha = numpy.zeros((grid.height, grid.width), numpy.uint8)
    alpha[:, : grid.width // 2] = 1
    _alpha_raster(path, grid, alpha)
    warped = Warped.of(path)

    edge = rendered_outline(warped, {"bounds": city_bounds()})

    assert 3 <= len(edge) <= 32
    bounds = Bounds.of(city_bounds())
    middle = (bounds.west + bounds.east) / 2
    assert max(place["lng"] for place in edge) == pytest.approx(middle, abs=(bounds.east - bounds.west) / 64)
    assert min(place["lng"] for place in edge) == pytest.approx(bounds.west, abs=(bounds.east - bounds.west) / 64)


def test_bad_path_a_render_off_the_city_or_with_no_city_has_no_outline(tmp_path: Path) -> None:
    """Scenarios: S-P06-HAPPY-RENDERED-OUTLINE"""
    city = Bounds.of(city_bounds()).mercator()
    far = Grid(city.right + 1e5, city.top, 10.0, 10, 10)
    path = tmp_path / "far.tif"
    _alpha_raster(path, far, numpy.ones((10, 10), numpy.uint8))
    warped = Warped.of(path)

    assert rendered_outline(warped, {"bounds": city_bounds()}) == ()
    assert rendered_outline(warped, None) == ()
    assert OutputInfo("c", 1, "s", "p", Bounds.of(city_bounds()), 10, 15, 1.0).as_record().get("outline") is None


def test_bad_path_whole_pixels_over_a_fractional_span_stop_at_the_whole_city(tmp_path: Path) -> None:
    """Scenarios: S-P06-BAD-CROP-COVERAGE"""
    # Whole pixels over a city's fractional span read 100.16 % here, which `outputSchema` and `joinReportSchema` refuse.
    city = Bounds.of(city_bounds()).mercator()
    past = Grid(city.left - 9.95, city.top + 9.95, 10.0, math.ceil(city.width / 10) + 2, math.ceil(city.height / 10) + 2)
    path = tmp_path / "past.tif"
    _alpha_raster(path, past, numpy.ones((past.height, past.width), numpy.uint8))
    source = DatasetSource(path)

    assert coverage_pct(source, past, city) == 100.0
    source.close()


def test_happy_path_output_records_its_coverage_only_with_a_figure() -> None:
    """Scenarios: S-P06-BAD-CROP-COVERAGE"""
    bounds = Bounds.of(city_bounds())
    bare = OutputInfo("c", 1, "s", "p", bounds, 10, 15, 1.0)

    assert "coveragePct" not in bare.as_record()
    assert OutputInfo("c", 1, "s", "p", bounds, 10, 15, 1.0, coverage_pct=33.333).as_record()["coveragePct"] == 33.33
    assert export.city_coverage(export.Warped(Path("none"), Grid(0.0, 0.0, 1.0, 1, 1), 2), None) is None
    assert ground_scale(0.0) == 1.0
