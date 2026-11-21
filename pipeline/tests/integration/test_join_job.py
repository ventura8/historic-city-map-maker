"""Joining one date's frames into one layer, the real steps against the fakes (docs/research/M8-join-interfaces.md §3, scenario P05).

The ground is seeded and every frame an exact affine scan of it, so the truth of each pixel is known: a seam closing is checked
against that truth, not only against the job's own figures, and so is what must not move beyond the taper.
"""

import errno
import json
import shutil
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path

import numpy
import pytest
from hcm_pipeline.config import Config
from hcm_pipeline.contract import Errors
from hcm_pipeline.geo import FloatArray, ground_scale, to_lnglat, to_mercator
from hcm_pipeline.join.correction import TAPER_M
from hcm_pipeline.join.warping import base_transform
from hcm_pipeline.m2m import M2MClient, http_client
from hcm_pipeline.objects import GcsObjectStore
from hcm_pipeline.raster import gdal
from hcm_pipeline.runner import RunOutcome
from hcm_pipeline.secrets import EmulatorSecrets, usgs_credentials
from hcm_pipeline.store import DELETE
from hcm_pipeline.worker.args import Endpoints, WorkerArgs
from hcm_pipeline.worker.loop import Pass
from hcm_pipeline.worker.worker import Worker

from tests.contracts_loader import record, records
from tests.fakes.http import FakeHttpServer
from tests.fakes.worker_api import PROJECT, FakeWorkerApi, StoredObject
from tests.fakes.world import CITY, OVERPASS_PATH, STAC_PATH, PipelineWorld, dig
from tests.integration.joining import (
    GROUND_PX,
    JOB,
    JOIN_LAYER,
    SCAN_M,
    Frame,
    georef_of,
    node_transform,
    pixels_of,
    run_join,
    seed_city,
    seed_frames,
    seed_join,
    seed_part,
    wobbled,
)
from tests.synthetic.scenes import CENTRE, World, render_world

GROUND = ground_scale(CENTRE[1])
CENTRE_X, CENTRE_Y = to_mercator(*CENTRE)
CITY_HALF = (10000.0, 5000.0)
# Taller than the window, so the seam runs straight from edge to edge: near a frame's own edge in the window the owners tie and it bends.
TALL = (1600, 1400)
WEST = Frame("west", (-5000.0, 0.0), (30.0, 0.0), size=TALL, checkpoint_rmse_m=20.0)
EAST = Frame("east", (5000.0, 0.0), (-30.0, 0.0), gain=1.25, size=TALL, checkpoint_rmse_m=40.0)
LOW_FRAMES = (
    Frame("west", (-5000.0, 0.0), (30.0, 0.0), size=(1600, 800)),
    Frame("east", (5000.0, 0.0), (-30.0, 0.0), gain=1.25, size=(1600, 800)),
)
SEAM_DONE_M = 15.0
JOIN_FILE = f"rasters/{CITY}/{JOIN_LAYER}/{JOB}"
WORK = f"work/{CITY}/{JOB}"


@pytest.fixture(scope="module")
def ground() -> World:
    return render_world(11, GROUND_PX)


def plan_of(world: PipelineWorld) -> dict[str, object]:
    """Only `align` run: the plan, which `register` later deletes with the rest of the work folder."""
    assert world.runner(_config(world)).run("align") is RunOutcome.DONE
    return record(json.loads(world.gcs.objects[f"{WORK}/join-plan.json"].data))


def _config(world: PipelineWorld) -> Config:
    return replace(world.config, job_id=JOB)


def nodes_of(plan: dict[str, object], frame: Frame) -> list[list[float]]:
    part = next(part for part in records(plan["parts"]) if part["versionId"] == frame.version_id)
    nodes = part["nodes"]
    assert isinstance(nodes, list)
    return nodes


def metres(seam: dict[str, object], key: str) -> float:
    return float(str(seam[key]))


def seams_of(world: PipelineWorld) -> list[dict[str, object]]:
    return records(dig(world.version(JOB), "join", "seams"))


def error_code(world: PipelineWorld) -> object:
    return dig(world.job(JOB), "error", "code")


def warped_pixels(world: PipelineWorld, tmp: Path) -> tuple[FloatArray, FloatArray, tuple[float, ...]]:
    """The composited `warped.tif` of a job stopped after `merge`: grey, alpha and geotransform."""
    assert world.runner(_config(world)).run("align") is RunOutcome.DONE
    assert world.runner(_config(world)).run("merge") is RunOutcome.DONE
    local = tmp / "warped.tif"
    local.write_bytes(world.gcs.objects[f"{WORK}/warped.tif"].data)
    dataset = gdal.Open(str(local))
    assert dataset.RasterCount == 2
    found = dataset.GetRasterBand(1).ReadAsArray(), dataset.GetRasterBand(2).ReadAsArray(), dataset.GetGeoTransform()
    dataset.Close()
    return found


def _true_places(x_from: float, x_to: float, y_half: float = 3000.0) -> tuple[FloatArray, FloatArray]:
    """A grid of places, metres from the ground's middle, in EPSG:3857."""
    x, y = numpy.meshgrid(numpy.linspace(x_from, x_to, 9), numpy.linspace(-y_half, y_half, 7))
    return (CENTRE_X + x.ravel()).astype(numpy.float64), (CENTRE_Y + y.ravel()).astype(numpy.float64)


def test_happy_path_a_seam_closes_and_nothing_moves_beyond_the_taper(world: PipelineWorld, ground: World, tmp_path: Path) -> None:
    """Scenarios: S-P05-HAPPY"""
    seed_frames(world, tmp_path, ground, [WEST, EAST], CITY_HALF)

    plan = plan_of(world)
    assert run_join(world) is RunOutcome.DONE

    version = world.version(JOB)
    join, seam = record(version["join"]), seams_of(world)[0]
    assert isinstance(join, dict)
    assert version["state"] == "awaiting_approval"
    assert (seam["a"], seam["b"]) == (WEST.entity_id, EAST.entity_id)
    assert (seam["measured"], seam["applied"]) == (True, True)
    assert metres(seam, "heldOut") >= 2
    # 60 EPSG:3857 metres apart at this latitude, and closed on the pixels the correction never saw.
    assert seam["beforeRmseM"] == pytest.approx(60 * GROUND, abs=4)
    assert metres(seam, "afterRmseM") <= SEAM_DONE_M
    # The figures are the worst frame's own, never pooled, and a join does not claim to improve them.
    assert (join["checkpointRmseM"], join["checkpointCount"]) == (40.0, 5)
    # A figure of 40 against 20: the worse-measured frame moves four fifths of the way.
    assert join["maxShiftM"] == pytest.approx(0.8 * 60 * GROUND, abs=3)
    assert dig(version, "output", "maxzoom") == 15

    size = WEST.size
    west_scan, east_scan = WEST.scan(ground), EAST.scan(ground)
    west, east = node_transform(nodes_of(plan, WEST), size), node_transform(nodes_of(plan, EAST), size)
    west_own = base_transform(georef_of(WEST, ground), size)
    east_own = base_transform(georef_of(EAST, ground), size)

    # At the seam both frames now put a true place within the limit of each other, measured against the truth.
    x, y = _true_places(-400.0, 400.0)
    apart = numpy.hypot(*numpy.subtract(west(*pixels_of(west_scan, x, y)), east(*pixels_of(east_scan, x, y))))
    assert float(apart.max()) * GROUND <= SEAM_DONE_M
    # Beyond the taper each frame is exactly where its own points put it: its truth error has not changed.
    reach = TAPER_M / GROUND + 300.0
    for scan, moved, own, places, error in (
        (west_scan, west, west_own, _true_places(-12500.0, -reach), WEST.error_m[0]),
        (east_scan, east, east_own, _true_places(reach, 12500.0), EAST.error_m[0]),
    ):
        u, v = pixels_of(scan, *places)
        new_x, new_y = moved(u, v)
        old_x, old_y, _ = own.forward(u, v)
        assert float(numpy.hypot(new_x - old_x, new_y - old_y).max()) * GROUND <= 1.0
        assert float(numpy.abs(new_x - places[0] - error).max()) * GROUND <= 1.0


def test_happy_path_the_mosaic_is_one_layer_with_no_seam_in_alpha_or_tone(world: PipelineWorld, ground: World, tmp_path: Path) -> None:
    """Scenarios: S-P05-HAPPY"""
    frames = list(LOW_FRAMES)
    seed_frames(world, tmp_path, ground, frames, CITY_HALF)

    grey, alpha, transform = warped_pixels(world, tmp_path)

    left, resolution, _, top, _, _ = transform
    column = int((CENTRE_X - left) / resolution)
    middle_row = int((top - CENTRE_Y) / resolution)
    # The alpha is one thing inside the union: never partly valid, and whole across the seam.
    assert set(numpy.unique(alpha).tolist()) == {0, 255}
    rows = round(3500.0 / resolution)
    assert bool((alpha[middle_row - rows : middle_row + rows, column - rows * 2 : column + rows * 2] == 255).all())
    # The 25 % print step (some 30 grey levels here) does not survive at the seam: what is left is the ground's own difference.
    band = round(250.0 / resolution)
    box = grey[middle_row - rows : middle_row + rows]
    west_side = float(box[:, column - 2 * band : column - band // 4].mean())
    east_side = float(box[:, column + band // 4 : column + 2 * band].mean())
    assert abs(west_side - east_side) <= 5.0
    far_west = float(box[:, column - 40 * band : column - 25 * band].mean())
    far_east = float(box[:, column + 25 * band : column + 40 * band].mean())
    assert abs(far_west - far_east) <= 25.0

    assert run_join(world) is RunOutcome.DONE
    # The union is counted once: the two frames' clipped areas add up to a quarter more than this.
    assert dig(world.version(JOB), "output", "areaKm2") == pytest.approx(24.0 * 8.0 * GROUND**2, rel=0.03)
    # 8 of the city's 10 km north to south, across its whole width.
    assert dig(world.version(JOB), "join", "coveragePct") == pytest.approx(80.0, abs=2.0)


def test_happy_path_three_frames_two_seams_their_fields_add_up(world: PipelineWorld, ground: World, tmp_path: Path) -> None:
    """Scenarios: S-P05-HAPPY-THREE"""
    size = (1000, 1000)
    # The outer frames lie 80 m east of the middle one's picture, so both seams pull the middle frame east.
    frames = [
        Frame("a", (-7000.0, 0.0), (40.0, 0.0), size=size),
        Frame("b", (0.0, 0.0), (-40.0, 0.0), size=size),
        Frame("c", (7000.0, 0.0), (40.0, 0.0), size=size),
    ]
    seed_frames(world, tmp_path, ground, frames, (11000.0, 4000.0))

    plan = plan_of(world)
    assert run_join(world) is RunOutcome.DONE

    seams = seams_of(world)
    assert [(seam["a"], seam["b"]) for seam in seams] == [
        (frames[0].entity_id, frames[1].entity_id),
        (frames[1].entity_id, frames[2].entity_id),
    ]
    assert all(seam["applied"] and metres(seam, "afterRmseM") <= SEAM_DONE_M for seam in seams)
    # Halfway between the seams, each 2.5 km away on the ground, each seam alone moves the frame by 0.62 of its 40 m share (equal figures).
    scan = frames[1].scan(ground)
    x, y = _true_places(-100.0, 100.0)
    u, v = pixels_of(scan, x, y)
    new_x, _ = node_transform(nodes_of(plan, frames[1]), size)(u, v)
    own_x, _, _ = base_transform(georef_of(frames[1], ground), size).forward(u, v)
    assert float(numpy.mean(new_x - own_x)) == pytest.approx(2 * 40 * 0.62, abs=6.0)


def test_happy_path_a_frame_inside_another_is_left_out(world: PipelineWorld, ground: World, tmp_path: Path) -> None:
    """Scenarios: S-P05-HAPPY-OMITTED"""
    inside = Frame("inside", (-5000.0, 0.0), size=(400, 300), checkpoint_rmse_m=500.0, checkpoint_count=1)
    seed_frames(world, tmp_path, ground, [WEST, inside, EAST], CITY_HALF)

    assert run_join(world) is RunOutcome.DONE

    join = record(world.version(JOB)["join"])
    assert join["omitted"] == [inside.entity_id]
    assert len(seams_of(world)) == 1
    # Only the frames used speak for the layer.
    assert (join["checkpointRmseM"], join["checkpointCount"]) == (40.0, 5)
    assert any(line == f"left out, adding nothing: {inside.entity_id}" for line in world.log_lines(JOB))


def test_happy_path_a_frames_crop_stays_cropped_in_the_layer(world: PipelineWorld, ground: World, tmp_path: Path) -> None:
    """Scenarios: S-P05-HAPPY"""
    seed_frames(world, tmp_path, ground, [WEST, EAST], CITY_HALF)
    ring = [to_lnglat(CENTRE_X + x, CENTRE_Y + y) for x, y in ((-8000.0, 7000.0), (9000.0, 7000.0), (9000.0, -7000.0), (-8000.0, -7000.0))]
    world.store.update(world.version_path(WEST.version_id), {"crop": [{"lat": lat, "lng": lng} for lng, lat in ring]})

    _, alpha, transform = warped_pixels(world, tmp_path)

    left, resolution, _, top, _, _ = transform
    row = int((top - CENTRE_Y) / resolution)
    assert alpha[row, int((CENTRE_X - 10000.0 - left) / resolution)] == 0
    assert alpha[row, int((CENTRE_X - 7000.0 - left) / resolution)] == 255


def test_happy_path_a_retry_does_not_measure_again(world: PipelineWorld, ground: World, tmp_path: Path) -> None:
    """Scenarios: S-P05-HAPPY"""
    seed_frames(world, tmp_path, ground, [WEST, EAST], CITY_HALF)
    plan_of(world)

    assert run_join(world) is RunOutcome.DONE

    assert world.log_lines(JOB).count("step align started") == 1
    assert world.gcs.objects.get(f"{WORK}/join-plan.json") is None
    assert world.gcs.names(f"{WORK}/") == []
    # M12: a city on the default path gets the join's own tiles, and no COG.
    assert f"{JOIN_FILE}/tiles.pmtiles" in world.gcs.objects
    assert f"{JOIN_FILE}/cog.tif" not in world.gcs.objects


def test_bad_path_frames_that_never_meet_render_with_no_seam(world: PipelineWorld, ground: World, tmp_path: Path) -> None:
    """Scenarios: S-P05-BAD-NO-OVERLAP"""
    size = (1300, 1000)
    frames = [Frame("west", (-8500.0, 0.0), size=size), Frame("east", (8500.0, 0.0), size=size)]
    seed_frames(world, tmp_path, ground, frames, CITY_HALF)

    assert run_join(world) is RunOutcome.DONE

    join = record(world.version(JOB)["join"])
    assert world.version(JOB)["state"] == "awaiting_approval"
    assert join["seams"] == []
    assert join["maxShiftM"] == 0
    assert 0 < metres(join, "coveragePct") < 100


def test_bad_path_a_flat_overlap_cannot_be_measured_and_nothing_shifts(world: PipelineWorld, ground: World, tmp_path: Path) -> None:
    """Scenarios: S-P05-BAD-UNMEASURED"""
    seed_city(world, CITY_HALF)
    frames = [WEST, EAST]
    for frame in frames:
        scan = frame.scan(ground)
        pixels = scan.pixels.copy()
        columns = numpy.arange(frame.size[0]) + 0.5
        # Snow, or fog: the shared stretch holds nothing a tile could find.
        pixels[:, numpy.abs(scan.origin[0] + columns * SCAN_M - CENTRE_X) < 3200.0] = 140
        seed_part(world, tmp_path, frame, pixels, scan)
    seed_join(world, frames)

    plan = plan_of(world)
    assert run_join(world) is RunOutcome.DONE

    seam = seams_of(world)[0]
    assert (seam["measured"], seam["applied"], seam["maxShiftM"]) == (False, False, 0)
    assert "beforeRmseM" not in seam
    assert nodes_of(plan, WEST) == nodes_of(plan, EAST) == []
    assert f"seam {WEST.entity_id} and {EAST.entity_id}: 12 m cut" in world.log_lines(JOB)
    assert world.version(JOB)["state"] == "awaiting_approval"


def test_bad_path_a_correction_that_does_not_help_is_refused(world: PipelineWorld, ground: World, tmp_path: Path) -> None:
    """Scenarios: S-P05-BAD-WORSENED"""
    seed_city(world, CITY_HALF)
    west, east = Frame("west", (-5000.0, 0.0)), Frame("east", (5000.0, 0.0))
    scan = west.scan(ground)
    # A sine a smooth correction cannot follow, whose period is five samples: what the samples held out say, the others deny.
    seed_part(world, tmp_path, west, wobbled(scan.pixels, 4.0, 250.0, 100.0), scan)
    other = east.scan(ground)
    seed_part(world, tmp_path, east, other.pixels, other)
    seed_join(world, [west, east])

    plan = plan_of(world)
    assert run_join(world) is RunOutcome.DONE

    seam = seams_of(world)[0]
    assert (seam["measured"], seam["applied"], seam["maxShiftM"]) == (True, False, 0)
    # The seam stays as it was, and the report says so: the before figure in both places.
    assert metres(seam, "beforeRmseM") > 5.0
    assert seam["afterRmseM"] == seam["beforeRmseM"]
    assert nodes_of(plan, west) == nodes_of(plan, east) == []
    assert dig(world.version(JOB), "join", "maxShiftM") == 0


def test_bad_path_frames_too_far_apart_fail_with_both_names(world: PipelineWorld, ground: World, tmp_path: Path) -> None:
    """Scenarios: S-P05-BAD-TOO-FAR"""
    # 500 metres on the ground, in EPSG:3857 metres at this latitude.
    apart = 500.0 / GROUND / 2
    frames = [Frame("west", (-5000.0, 0.0), (apart, 0.0)), Frame("east", (5000.0, 0.0), (-apart, 0.0))]
    seed_frames(world, tmp_path, ground, frames, CITY_HALF)

    assert run_join(world) is RunOutcome.FAILED

    assert error_code(world) == Errors.JOIN_SEAM_TOO_FAR
    assert dig(world.job(JOB), "error", "params") == {"a": frames[0].entity_id, "b": frames[1].entity_id}
    assert world.version(JOB)["state"] == "failed"
    assert dig(world.job(JOB), "steps", "align", "status") == "failed"


def test_bad_path_a_scan_no_longer_stored_fails_naming_its_frame(world: PipelineWorld, ground: World, tmp_path: Path) -> None:
    """Scenarios: S-P05-BAD-PART-MISSING"""
    seed_frames(world, tmp_path, ground, [WEST, EAST], CITY_HALF)
    del world.gcs.objects[EAST.scan_path]

    assert run_join(world) is RunOutcome.FAILED

    assert error_code(world) == Errors.JOIN_PART_MISSING
    assert dig(world.job(JOB), "error", "params") == {"frame": EAST.entity_id}


def test_bad_path_no_room_for_the_join_fails_before_anything_is_fetched(
    world: PipelineWorld, ground: World, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P05-BAD-NO-ROOM"""
    seed_frames(world, tmp_path, ground, [WEST, EAST], CITY_HALF)
    monkeypatch.setattr("hcm_pipeline.join.room.shutil.disk_usage", lambda _path: type("Usage", (), {"free": 1000})())

    assert run_join(world) is RunOutcome.FAILED

    assert error_code(world) == Errors.JOIN_NO_ROOM
    assert world.gcs.names(f"{WORK}/") == []


def test_bad_path_fewer_than_two_frames_add_anything(world: PipelineWorld, ground: World, tmp_path: Path) -> None:
    """Scenarios: S-P05-BAD-NO-FRAMES"""
    frames = [Frame("whole", (0.0, 0.0), size=(2800, 1400)), Frame("inside", (0.0, 0.0), size=(300, 300))]
    seed_frames(world, tmp_path, ground, frames, CITY_HALF)

    assert run_join(world) is RunOutcome.FAILED

    assert error_code(world) == Errors.JOIN_NO_FRAMES


@pytest.fixture
def api(world: PipelineWorld) -> Iterator[FakeWorkerApi]:
    with FakeHttpServer() as server:
        fake = FakeWorkerApi(world.store, server, lambda: world.clock.now).install()
        secrets = EmulatorSecrets("e2e-ok")
        fake.m2m = lambda: M2MClient(http_client(world.m2m.base_url), usgs_credentials(secrets))
        yield fake


def _run_on_worker(world: PipelineWorld, api: FakeWorkerApi, work: Path) -> None:
    args = WorkerArgs(
        city=CITY,
        project=PROJECT,
        port=0,
        work=work,
        emulators=True,
        endpoints=Endpoints.emulated(PROJECT, api.env()),
        stac_url=world.http.url(STAC_PATH),
        overpass_url=world.http.url(OVERPASS_PATH),
    )
    worker = Worker.build(args, "127.0.0.1", api.clock)
    try:
        assert worker.actions.sign_in(*api.sign_in_tokens(api.clock() + 3600)) is None
        assert worker.loop.run_once() is Pass.RAN
    finally:
        worker.close()


def _hand_scans_to_the_server(world: PipelineWorld, api: FakeWorkerApi) -> None:
    for frame in (WEST, EAST):
        api.objects[frame.scan_path] = StoredObject(world.gcs.objects[frame.scan_path].data, next(api.generations))
        del world.gcs.objects[frame.scan_path]


def _documents(api: FakeWorkerApi, operation: str) -> set[str]:
    """The paths of the worker's document requests of one kind."""
    requests = [record(call.data["request"]) for call in api.calls if call.name == "worker-step"]
    return {str(request.get("path")) for request in requests if request.get("op") == operation}


def test_happy_path_a_join_runs_on_the_local_worker_within_its_allow_lists(
    world: PipelineWorld, api: FakeWorkerApi, ground: World, tmp_path: Path
) -> None:
    """Scenarios: S-P05-HAPPY-WORKER"""
    seed_frames(world, tmp_path, ground, [WEST, EAST], CITY_HALF)
    _hand_scans_to_the_server(world, api)
    world.store.update(world.job_path(JOB), {"status": "queued", "runOn": "local", "waitReason": "worker", "machine": DELETE})

    _run_on_worker(world, api, tmp_path / "work")

    assert world.version(JOB)["state"] == "awaiting_approval"
    # It read the parts' scans and wrote only its own version's files; nothing was ever listed or deleted under `rasters/`.
    scans = {WEST.scan_path, EAST.scan_path}
    gets = {path for method, path in api.signed if method == "GET"}
    puts = {path for method, path in api.signed if method != "GET"}
    assert scans <= gets
    assert all(path.startswith(f"{JOIN_FILE}/") for path in puts | (gets - scans))
    assert {f"{JOIN_FILE}/{name}" for name in ("preview.png", "thumb.webp", "tiles.pmtiles")} <= puts
    assert f"{JOIN_FILE}/cog.tif" not in puts
    # The documents it read beyond its own are the parts': what the allow-list maps to the read-only `base` target.
    read = _documents(api, "get")
    parts = {world.version_path(WEST.version_id), world.version_path(EAST.version_id)}
    assert parts <= read
    assert read - parts <= {world.job_path(JOB), world.version_path(JOB), f"cities/{CITY}"}
    assert not _documents(api, "update") & parts


def test_bad_path_room_for_one_scan_but_not_two_fails_before_anything_is_fetched(
    world: PipelineWorld, ground: World, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P05-BAD-NO-ROOM"""
    seed_frames(world, tmp_path, ground, [WEST, EAST], CITY_HALF)
    monkeypatch.setattr("hcm_pipeline.steps.align.window_px", lambda _ctx, _box: 0)
    monkeypatch.setattr("hcm_pipeline.steps.align.scan_sizes", lambda _ctx, _parts: [100, 100])
    # A seam holds both scans: one scan and a little more is not enough, whatever the mosaic needs.
    monkeypatch.setattr("hcm_pipeline.join.room.shutil.disk_usage", lambda _path: type("Usage", (), {"free": 199})())

    assert run_join(world) is RunOutcome.FAILED

    assert error_code(world) == Errors.JOIN_NO_ROOM
    assert world.gcs.names(f"{WORK}/") == []


def test_bad_path_a_run_resumed_at_merge_on_a_fuller_disk_says_so(
    world: PipelineWorld, ground: World, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P05-BAD-NO-ROOM"""
    seed_frames(world, tmp_path, ground, [WEST, EAST], CITY_HALF)
    real = shutil.disk_usage
    checks: list[str] = []

    def filling(path: object) -> object:
        checks.append(str(path))
        return real(str(path)) if len(checks) == 1 else type("Usage", (), {"free": 1000})()

    monkeypatch.setattr("hcm_pipeline.join.room.shutil.disk_usage", filling)

    assert run_join(world) is RunOutcome.FAILED

    assert len(checks) == 2
    assert error_code(world) == Errors.JOIN_NO_ROOM
    assert dig(world.job(JOB), "steps", "merge", "status") == "failed"


def test_bad_path_a_disk_that_fills_up_while_a_scan_comes_in_is_no_room_not_an_internal_error(
    world: PipelineWorld, ground: World, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P05-BAD-NO-ROOM"""
    seed_frames(world, tmp_path, ground, [WEST, EAST], CITY_HALF)

    def full(*_args: object) -> None:
        raise OSError(errno.ENOSPC, "No space left on device")

    monkeypatch.setattr(GcsObjectStore, "download_file", full)

    assert run_join(world) is RunOutcome.FAILED

    assert error_code(world) == Errors.JOIN_NO_ROOM
