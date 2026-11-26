"""A published layer calibrated again (docs/research/M16-recalibrate.md §2, §3): Refine, Snap my points, and the manual route's figures.

The world is the synthetic one: a scan through an exact affine map, and the current version's pairs read off that map moved by `error`
metres, as a fit that is off as a whole. Every expectation is about the truth (`transform_error_m`), not about what the tiles found.
"""

import json
from pathlib import Path
from typing import Final

import pytest
from hcm_pipeline.contract import Errors
from hcm_pipeline.geo import FloatArray, ground_scale, to_lnglat, to_lnglat_arrays
from hcm_pipeline.georef.lattice import Lattice, sampled
from hcm_pipeline.runner import RunOutcome

from tests.contracts_loader import record, records
from tests.fakes.http import Reply
from tests.fakes.world import CITY, JOB_ID, LAYER_ID, OVERPASS_PATH, PipelineWorld, dig
from tests.integration.matching import Seeded, seed_matching
from tests.integration.test_terrain_job import terrain_record
from tests.synthetic.scenes import CENTRE, AffineScan, overpass_answer, render_world, write_sentinel2

BASE: Final = "v-current"
GRID: Final = [(u, v) for v in (0.15, 0.5, 0.85) for u in (0.1, 0.37, 0.63, 0.9)]


def pair(truth: AffineScan, gcp_id: str, pixel: tuple[float, float], error: tuple[float, float], enabled: bool = True) -> dict[str, object]:
    """A pair of the scan's pixel and its true place moved by `error` (east, north, Mercator metres)."""
    x, y = truth.to_mercator(*pixel)
    lng, lat = to_lnglat(x + error[0], y + error[1])
    return {"id": gcp_id, "pixel": {"x": pixel[0], "y": pixel[1]}, "geo": {"lat": lat, "lng": lng}, "enabled": enabled, "origin": "auto"}


def current_pairs(seeded: Seeded, error: tuple[float, float]) -> list[dict[str, object]]:
    height, width = seeded.pixels.shape
    return [pair(seeded.truth, f"a{index}", (u * width, v * height), error) for index, (u, v) in enumerate(GRID)]


def seed_recalibration(
    world: PipelineWorld, tmp_path: Path, recalibration: dict[str, object], error: tuple[float, float], points: bool = False
) -> Seeded:
    """The current version (published, its pairs `error` off) and the `regeoref` job and version `imagery.recalibrate` makes; `points`:
    with the admin's rough points."""
    seeded = seed_matching(world, tmp_path, wide=True)
    if points:
        recalibration = {**recalibration, "points": rough_points(seeded)}
    version = world.version()
    georef = {"method": "auto", "transform": "poly2", "gcps": current_pairs(seeded, error)}
    world.store.seed(world.version_path(BASE), {**version, "jobId": BASE, "state": "published", "georef": georef})
    world.seed_job(JOB_ID, "regeoref", {"basedOn": BASE})
    world.store.seed(
        world.version_path(), {**version, "origin": "regeoref", "basedOn": BASE, "georef": georef, "recalibration": recalibration}
    )
    return seeded


def recalibration(world: PipelineWorld) -> dict[str, object]:
    return record(world.version()["recalibration"])


def figure(world: PipelineWorld, which: str) -> float:
    return float(str(record(recalibration(world)[which])["rmseM"]))


def test_happy_path_refine_renders_a_better_fit_and_records_both_on_the_same_checks(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P19-HAPPY-REFINE"""
    seed_recalibration(world, tmp_path, {"route": "auto"}, (60.0, -45.0))

    assert world.run() is RunOutcome.DONE

    georef = record(world.version()["georef"])
    found = recalibration(world)
    assert world.version()["state"] == "awaiting_approval"
    assert georef["method"] == "auto"
    assert georef["checkpointKind"] == "held-out"
    assert figure(world, "before") > 40
    assert figure(world, "after") < 15
    assert record(found["before"])["checks"] == record(found["after"])["checks"] == georef["checkpointCount"]
    assert int(str(record(found["tiles"])["agreed"])) >= 60
    assert found["route"] == "auto"
    assert "proposed" not in found
    assert any(line.startswith("refined:") and "against the current" in line for line in world.log_lines())


def test_bad_path_refine_with_nothing_better_declines_and_renders_nothing(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P19-BAD-NOT-IMPROVED"""
    seed_recalibration(world, tmp_path, {"route": "auto"}, (0.0, 0.0))

    assert world.run() is RunOutcome.CANCELLED

    job = world.job()
    assert job["status"] == "cancelled"
    assert dig(job, "error", "code") == Errors.NOT_IMPROVED
    assert set(record(dig(job, "error", "params"))) == {"before", "after"}
    assert dig(job, "steps", "georef", "status") == "skipped"
    assert world.version()["state"] == "cancelled"
    assert dig(world.version(), "error", "code") == Errors.NOT_IMPROVED
    assert "output" not in world.version()
    assert world.gcs.names(f"rasters/{CITY}/{LAYER_ID}/{JOB_ID}/cog") == []
    assert world.version(BASE)["state"] == "published"
    assert any(line.startswith("declined, nothing rendered:") for line in world.log_lines())


def true_lattice(seeded: Seeded) -> dict[str, object]:
    """A panoramic camera's stored nodes that lie on the scan's exact map (M15 §1), whatever its pairs say."""
    height, width = seeded.pixels.shape
    a, b, c, d = seeded.truth.matrix
    east, north = seeded.truth.origin

    def to_place(x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray]:
        return to_lnglat_arrays(east + a * x + b * y, north + c * x + d * y)

    return Lattice("panoramic", sampled(to_place, width, height)).as_record()


def test_bad_path_a_current_camera_on_the_truth_is_measured_as_it_renders_and_nothing_beats_it(
    world: PipelineWorld, tmp_path: Path
) -> None:
    """Scenarios: S-P19-BAD-CURRENT-AS-RENDERED"""
    seeded = seed_recalibration(world, tmp_path, {"route": "auto"}, (60.0, -45.0))
    current = world.version(BASE)
    world.store.update(world.version_path(BASE), {"georef": {**record(current["georef"]), "lattice": true_lattice(seeded)}})

    assert world.run() is RunOutcome.CANCELLED

    # Its pairs lie 75 m off, but its layer shows the camera's nodes on the truth: that is what Refine must beat, and cannot.
    assert dig(world.job(), "error", "code") == Errors.NOT_IMPROVED
    assert float(str(record(dig(world.job(), "error", "params"))["before"])) < 5
    assert world.version(BASE)["state"] == "published"


def test_happy_path_a_current_map_over_terrain_is_measured_as_it_renders(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P19-HAPPY-CURRENT-AS-RENDERED"""
    seeded = seed_recalibration(world, tmp_path, {"route": "auto"}, (0.0, 0.0))
    current = world.version(BASE)
    # Its pairs are exact, but its layer renders through an RPC that puts 100 m of level ground 50 m off: what the public sees.
    world.store.update(world.version_path(BASE), {"georef": {**record(current["georef"]), "terrain": terrain_record(seeded.truth)}})

    assert world.run() is RunOutcome.DONE

    assert world.version()["state"] == "awaiting_approval"
    assert figure(world, "before") > 30
    assert figure(world, "after") < 15


def test_bad_path_refine_whose_tiles_are_not_proved_declines(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P19-BAD-REFUSED"""
    other = render_world(99)
    world.http.serve("/s2/visual.tif", write_sentinel2(other, tmp_path / "elsewhere.tif").read_bytes())
    world.http.route("POST", OVERPASS_PATH, lambda _request: Reply.json(json.dumps(overpass_answer(other))))
    seed_recalibration(world, tmp_path, {"route": "auto"}, (60.0, -45.0))

    assert world.run() is RunOutcome.CANCELLED

    assert dig(world.job(), "error", "code") == Errors.REFINE_REFUSED
    assert world.version()["state"] == "cancelled"


def rough_points(seeded: Seeded) -> list[dict[str, object]]:
    """Three rough points the admin placed: about 20 m off the truth, where the current fit is far off."""
    height, width = seeded.pixels.shape
    found = []
    for u, v in ((0.25, 0.3), (0.75, 0.35), (0.5, 0.75)):
        rough = pair(seeded.truth, "p", (u * width, v * height), (20.0, 15.0))
        found.append({"pixel": rough["pixel"], "geo": rough["geo"]})
    return found


def test_happy_path_rough_points_bend_the_start_and_the_tiles_snap_around_them(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P19-HAPPY-POINTS"""
    seed_recalibration(world, tmp_path, {"route": "points"}, (900.0, 700.0), points=True)

    assert world.run() is RunOutcome.DONE

    found = recalibration(world)
    assert world.version()["state"] == "awaiting_approval"
    assert figure(world, "before") > 700
    assert figure(world, "after") < 15
    assert int(str(found["proposed"])) > 0
    assert len(records(found["points"])) == 3


def test_bad_path_points_whose_tiles_are_not_proved_decline(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P19-BAD-REFUSED"""
    other = render_world(99)
    world.http.serve("/s2/visual.tif", write_sentinel2(other, tmp_path / "elsewhere.tif").read_bytes())
    seed_recalibration(world, tmp_path, {"route": "points"}, (900.0, 700.0), points=True)

    assert world.run() is RunOutcome.CANCELLED

    assert dig(world.job(), "error", "code") == Errors.REFINE_REFUSED


def manual_pairs(seeded: Seeded, disabled: int) -> list[dict[str, object]]:
    height, width = seeded.pixels.shape
    return [
        {**pair(seeded.truth, f"g{index}", (u * width, v * height), (0.0, 0.0), enabled=index >= disabled), "origin": "manual"}
        for index, (u, v) in enumerate(GRID)
    ]


@pytest.mark.parametrize(("disabled", "compared"), [(4, True), (2, False)])
def test_happy_path_a_manual_recalibration_is_fitted_as_saved_with_both_fits_on_its_disabled_pairs(
    world: PipelineWorld, tmp_path: Path, disabled: int, compared: bool
) -> None:
    """Scenarios: S-P19-HAPPY-MANUAL-FIGURES"""
    seeded = seed_recalibration(world, tmp_path, {"route": "manual"}, (50.0, 0.0))
    georef = {"method": "gcps", "transform": "affine", "gcps": manual_pairs(seeded, disabled)}
    world.store.update(world.version_path(), {"georef": georef})

    assert world.runner().run("georef") is RunOutcome.DONE

    found = recalibration(world)
    assert dig(world.version(), "georef", "method") == "gcps"
    assert ("before" in found) is compared
    if compared:
        assert figure(world, "before") == pytest.approx(50 * ground_scale(CENTRE[1]), abs=1)
        assert figure(world, "after") < 1
    else:
        assert any(line.startswith("not compared") for line in world.log_lines())


def test_bad_path_a_refine_without_a_scan_fails(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P19-BAD-REFUSED"""
    seed_recalibration(world, tmp_path, {"route": "auto"}, (60.0, -45.0))
    version = world.version()
    version.pop("scan")
    world.store.seed(world.version_path(), version)

    assert world.runner().run("georef") is RunOutcome.FAILED

    assert dig(world.job(), "error", "code") == Errors.NO_SCAN
