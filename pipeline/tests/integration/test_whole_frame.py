"""A strip no window of which was proved: offered whole, then cropped around the owner's rough points (M9-calibration.md §17)."""

import json
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path
from typing import Final

import numpy
import pytest
from hcm_pipeline.calibrate import strip
from hcm_pipeline.contract import Errors
from hcm_pipeline.geo import to_lnglat
from hcm_pipeline.runner import JobRunner, RunOutcome, RunSettings
from hcm_pipeline.services import default_steps
from hcm_pipeline.steps import whole
from hcm_pipeline.steps.recrop import FILM_GONE
from hcm_pipeline.steps.whole import POINTS_NEXT, WholeFrame, marked

from tests.contracts_loader import record, records
from tests.fakes.http import Reply
from tests.fakes.world import CITY, JOB_ID, LAYER_ID, OVERPASS_PATH, PipelineWorld, dig
from tests.synthetic.scenes import Scene, SceneSpec, build_scene, overpass_answer, render_world, true_mercator, write_sentinel2

WORK: Final = f"work/{CITY}/{JOB_ID}/"
SCAN: Final = f"rasters/{CITY}/{LAYER_ID}/{JOB_ID}/scan.tif"
# A strip 40 km long and 6 km across, in four segments; the whole frame's scan may be this long at most (so it is shrunk 4 times).
STRIP_SPEC: Final = SceneSpec(width=6000, height=900, segments=4)
BUDGET_PX: Final = 1600
FACTOR: Final = 4
# The owner's rough points, on the film: a cluster around the city.
ON_FILM: Final = ((2850.0, 300.0), (3000.0, 300.0), (3150.0, 300.0), (2850.0, 600.0), (3000.0, 600.0), (3150.0, 600.0))


@pytest.fixture(scope="module")
def strip_scene(tmp_path_factory: pytest.TempPathFactory) -> Scene:
    return build_scene(tmp_path_factory.mktemp("strip"), STRIP_SPEC)


@pytest.fixture
def parked(strip_scene: Scene, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[PipelineWorld]:
    """A strip over another place than its reference, searched in a window of its footprint: nothing proves, and it waits."""
    other = render_world(99)
    monkeypatch.setattr(strip, "STRIP_MARGIN_GROUND_M", 500.0)
    monkeypatch.setattr(whole, "WHOLE_MAX_PX", BUDGET_PX)
    with PipelineWorld(strip_scene) as world:
        world.http.serve("/s2/visual.tif", write_sentinel2(other, tmp_path / "elsewhere.tif").read_bytes())
        world.http.route("POST", OVERPASS_PATH, lambda _request: Reply.json(json.dumps(overpass_answer(other))))
        world.seed_import()
        assert world.run() is RunOutcome.WAITING
        yield world


def _scan(world: PipelineWorld) -> dict[str, object]:
    return record(world.version()["scan"])


def _stored_scan(world: PipelineWorld, folder: Path) -> Path:
    local = folder / "stored-scan.tif"
    local.write_bytes(world.gcs.objects[SCAN].data)
    return local


def _points(world: PipelineWorld, on_scan: tuple[tuple[float, float], ...] | None = None) -> list[dict[str, object]]:
    """The rough points as the georeferencer saves them: on the shrunk scan, at the places the film truly shows."""
    points = []
    for index, (u, v) in enumerate(ON_FILM):
        x, y = true_mercator(world.scene.truth, numpy.array([u]), numpy.array([v]))
        lng, lat = to_lnglat(float(x[0]), float(y[0]))
        px, py = (u / FACTOR, v / FACTOR) if on_scan is None else on_scan[index]
        points.append(
            {"id": f"p{index}", "pixel": {"x": px, "y": py}, "geo": {"lat": lat, "lng": lng}, "enabled": True, "origin": "manual"}
        )
    return points


def _save_points(world: PipelineWorld, gcps: list[dict[str, object]]) -> None:
    """What `imagery.saveGcps` does: the points on the version, the job back to its dispatcher from `georef`."""
    world.store.update(world.version_path(), {"georef": {"method": "gcps", "transform": "affine", "gcps": gcps}, "state": "processing"})
    world.store.update(world.job_path(), {"status": "starting", "steps.georef": {"status": "pending"}})


def test_happy_path_a_strip_no_window_of_which_is_proved_is_offered_whole(parked: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P06-HAPPY-WHOLE-STRIP, S-P06-BAD-WHOLE-STRIP-UNPROVED"""
    scan, version = _scan(parked), parked.version()

    assert any(line.startswith("strip window: film columns") for line in parked.log_lines())
    # The whole exposure, not the window: 6000 film columns shrunk 4 times, with nothing to start a matcher from.
    assert int(str(scan["width"])) in range(1480, 1501)
    assert int(str(scan["height"])) in range(220, 226)
    assert marked(_stored_scan(parked, tmp_path)) == WholeFrame(FACTOR, 0, 0)
    assert "georef" not in version
    assert version["state"] == "needs_gcps"
    assert record(version["calibration"])["how"] == "none"
    assert parked.job()["status"] == "awaiting_gcps"
    assert parked.gcs.names("usgs-raw/") != []
    assert any("the whole frame is the scan, shrunk 4 times" in line and POINTS_NEXT in line for line in parked.log_lines())
    assert not any("crop " in line and "delivery kept, the admin's points are next" in line for line in parked.log_lines())


def test_happy_path_rough_points_on_the_whole_strip_crop_it_at_full_resolution_and_the_job_goes_on(
    parked: PipelineWorld, tmp_path: Path
) -> None:
    """Scenarios: S-P06-HAPPY-ROUGH-POINTS-CROP"""
    _save_points(parked, _points(parked))

    assert parked.run() is RunOutcome.DONE

    scan, gcps = _scan(parked), records(dig(parked.version(), "georef", "gcps"))
    width, height = int(str(scan["width"])), int(str(scan["height"]))
    # Full resolution: wider than the whole strip's shrunk scan, narrower than the strip, the film's whole height.
    assert 1600 < width < 5000
    assert height in range(880, 901)
    assert marked(_stored_scan(parked, tmp_path)) is None
    placed = [(float(str(dig(gcp, "pixel", "x"))), float(str(dig(gcp, "pixel", "y")))) for gcp in gcps]
    # The crop holds every point, where the film shows it: as far apart as on the film, not as on the shrunk scan.
    assert all(0 < x < width and 0 < y < height for x, y in placed)
    assert placed[1][0] - placed[0][0] == pytest.approx(ON_FILM[1][0] - ON_FILM[0][0])
    assert placed[3][1] - placed[0][1] == pytest.approx(ON_FILM[3][1] - ON_FILM[0][1])
    assert parked.job()["status"] == "awaiting_approval"
    assert any("rough points on the whole frame" in line and "at full resolution" in line for line in parked.log_lines())


def test_bad_path_rough_points_outside_the_strip_are_refused(parked: PipelineWorld) -> None:
    """Scenarios: S-P06-BAD-ROUGH-POINTS-OUTSIDE"""
    outside = ((float(str(_scan(parked)["width"])) + 40.0, 80.0), *((u / FACTOR, v / FACTOR) for u, v in ON_FILM[1:]))
    _save_points(parked, _points(parked, outside))

    assert parked.run() is RunOutcome.FAILED

    assert dig(parked.job(), "error", "code") == Errors.GCP_OUTSIDE
    assert any("points outside the strip: p0" in line for line in parked.log_lines())
    assert marked_still(parked)


def test_bad_path_rough_points_all_on_one_place_give_no_scale_and_are_refused(parked: PipelineWorld) -> None:
    """Scenarios: S-P06-BAD-ROUGH-POINTS-OUTSIDE"""
    _save_points(parked, _points(parked, ((700.0, 100.0),) * len(ON_FILM)))

    assert parked.run() is RunOutcome.FAILED

    assert dig(parked.job(), "error", "code") == Errors.DEGENERATE_GCPS
    assert marked_still(parked)


def marked_still(world: PipelineWorld) -> bool:
    """The version's scan is still the whole strip."""
    return int(str(_scan(world)["width"])) <= BUDGET_PX


@pytest.mark.parametrize("gone", ["frame.json", ".tif"])
def test_bad_path_points_on_a_strip_whose_film_is_no_longer_stored_ask_for_the_import_again(parked: PipelineWorld, gone: str) -> None:
    """Scenarios: S-P06-BAD-ROUGH-POINTS-FILM-GONE"""
    for name in parked.gcs.names(WORK):
        if name.endswith(gone):
            del parked.gcs.objects[name]
    _save_points(parked, _points(parked))

    assert parked.run() is RunOutcome.FAILED

    assert dig(parked.job(), "error", "code") == Errors.PROCESSING_FAILED
    assert any(FILM_GONE in line for line in parked.log_lines())
    assert "import the frame again" in FILM_GONE
    assert marked_still(parked)


def test_bad_path_on_a_worker_a_film_not_stored_here_hands_the_job_back(parked: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-FILM-GONE"""
    # 2026-11-13: the film may be on the computer that stitched it; the job goes back unspent.
    for name in parked.gcs.names(WORK):
        if name.endswith("frame.json"):
            del parked.gcs.objects[name]
    _save_points(parked, _points(parked))
    services = replace(parked.services(), archive_root=tmp_path)

    outcome = JobRunner(parked.config, services, default_steps(), RunSettings(heartbeat_seconds=3600)).run()

    assert outcome is RunOutcome.RETURNED
    assert dig(parked.job(), "status") != "failed"
    assert any("goes back for the computer that has the files" in line for line in parked.log_lines())


def test_bad_path_on_a_worker_a_strip_offered_whole_keeps_its_delivery(
    strip_scene: Scene, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P06-BAD-WHOLE-STRIP-KEEPS-RAW"""
    # Live 2026-11-14 (DS1111-1020AF035): a worker deleted the delivery after a shrunk whole strip; only a proved or recropped
    # full-resolution crop may delete it.
    other = render_world(99)
    monkeypatch.setattr(strip, "STRIP_MARGIN_GROUND_M", 500.0)
    monkeypatch.setattr(whole, "WHOLE_MAX_PX", BUDGET_PX)
    with PipelineWorld(strip_scene) as world:
        world.http.serve("/s2/visual.tif", write_sentinel2(other, tmp_path / "elsewhere.tif").read_bytes())
        world.http.route("POST", OVERPASS_PATH, lambda _request: Reply.json(json.dumps(overpass_answer(other))))
        world.seed_import()

        assert world.runner(replace(world.config, execution="worker")).run() is RunOutcome.WAITING

        assert world.gcs.names("usgs-raw/") != []
        assert not any("is deleted: the city crop is recorded" in line for line in world.log_lines())
