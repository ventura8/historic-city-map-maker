"""A resume after a power cut (RESILIENCE-AUDIT P0-3) and a disk that fills up mid-step (P1-6), with scripted steps."""

import errno
import io
from dataclasses import replace
from typing import cast

import pytest
from hcm_pipeline.config import Config
from hcm_pipeline.contract import Errors
from hcm_pipeline.intact import JSON_READ_MAX, output_intact
from hcm_pipeline.jobs import JobContext, StepFailedError
from hcm_pipeline.model import StepRecord
from hcm_pipeline.objects import ObjectInfo, ObjectStore, ObjectStoreError
from hcm_pipeline.runner import RunOutcome, disk_full

from tests.fakes.world import PipelineWorld, dig
from tests.unit.test_runner import JOB, Scripted, runner, scripted, seed, statuses

WARPED = "work/bucharest/job-regeoref-9/warped.tif"
TIFF = b"II*\x00" + b"\x01" * 60


def on_worker(config: Config) -> Config:
    return replace(config, execution="worker")


def finished_warp(world: PipelineWorld, data: bytes, recorded_bytes: int) -> None:
    """`warp` recorded done with `recorded_bytes`, its object now holding `data` (what the disk kept after the power cut)."""
    world.gcs.put(WARPED, data)
    generation = str(world.gcs.objects[WARPED].generation)
    record = {"status": "done", "gcsPath": WARPED, "generation": generation, "bytes": recorded_bytes}
    world.store.update(world.job_path(JOB), {"steps.warp": record})


def test_happy_path_a_whole_local_output_is_passed_over_on_resume(world: PipelineWorld) -> None:
    """Scenarios: S-P04-HAPPY-RESUME-VERIFIED"""
    config = on_worker(seed(world))
    finished_warp(world, TIFF, len(TIFF))
    steps = scripted()

    assert runner(world, config, steps).run() is RunOutcome.DONE

    assert steps["warp"].runs == 0


@pytest.mark.parametrize(
    ("data", "recorded"),
    [(b"\x00" * len(TIFF), len(TIFF)), (TIFF[:10], len(TIFF)), (b"", 0)],
    ids=["zeros-after-the-power-cut", "truncated", "empty"],
)
def test_bad_path_a_torn_local_output_runs_its_step_again(world: PipelineWorld, data: bytes, recorded: int) -> None:
    """Scenarios: S-P04-BAD-RESUME-TORN"""
    config = on_worker(seed(world))
    finished_warp(world, data, recorded)
    steps = scripted()

    assert runner(world, config, steps).run() is RunOutcome.DONE

    assert steps["warp"].runs == 1
    assert any("is damaged" in line for line in world.log_lines(JOB))


def test_bad_path_a_cloud_output_is_trusted_by_its_generation_as_before(world: PipelineWorld) -> None:
    config = seed(world)
    finished_warp(world, b"\x00" * len(TIFF), len(TIFF))
    steps = scripted()

    runner(world, config, steps).run()

    assert steps["warp"].runs == 0


class Unreadable:
    def open_read(self, path: str) -> object:
        raise ObjectStoreError(f"no object at {path}")


FRAME = "work/bucharest/job-regeoref-9/frame.json"


def test_bad_path_an_output_that_cannot_be_read_or_parsed_is_damaged(world: PipelineWorld) -> None:
    objects = world.services().objects
    world.gcs.put(FRAME, b'{"rows": [1, 2')
    torn = ObjectInfo(FRAME, 14, "1")

    assert not output_intact(cast(ObjectStore, Unreadable()), StepRecord("done"), ObjectInfo(WARPED, 4, "1"), local=True)
    assert not output_intact(objects, StepRecord("done"), torn, local=True)
    world.gcs.put(FRAME, b'{"rows": [1]}')
    assert output_intact(objects, StepRecord("done"), ObjectInfo(FRAME, 13, "1"), local=True)
    # A version file lives in Cloud Storage even for a worker: its generation is enough.
    assert output_intact(cast(ObjectStore, Unreadable()), StepRecord("done"), ObjectInfo("versions/v/x.tif", 1, "1"), local=True)


def test_bad_path_a_tile_archive_is_whole_only_with_its_header_and_any_other_kind_by_its_size(world: PipelineWorld) -> None:
    objects = world.services().objects
    tiles = "work/bucharest/job-regeoref-9/tiles.pmtiles"
    other = "work/bucharest/job-regeoref-9/notes.bin"
    world.gcs.put(tiles, b"PMTiles\x03" + b"\x00" * 8)
    world.gcs.put(other, b"\x00" * 16)

    assert output_intact(objects, StepRecord("done"), ObjectInfo(tiles, 16, "1"), local=True)
    world.gcs.put(tiles, b"\x00" * 16)
    assert not output_intact(objects, StepRecord("done"), ObjectInfo(tiles, 16, "1"), local=True)
    assert output_intact(objects, StepRecord("done"), ObjectInfo(other, 16, "1"), local=True)
    # Cloud Run's run (not on the owner's computer): a work file is trusted by its generation too.
    assert output_intact(cast(ObjectStore, Unreadable()), StepRecord("done"), ObjectInfo(WARPED, 4, "1"), local=False)


def full_disk(_ctx: JobContext) -> None:
    raise OSError(errno.ENOSPC, "No space left on device")


def test_happy_path_a_full_disk_on_the_owners_computer_hands_the_job_back_with_its_step_pending(world: PipelineWorld) -> None:
    """Scenarios: S-P04-HAPPY-DISK-FULL"""
    config = on_worker(seed(world))
    steps = scripted(warp=Scripted("warp", action=full_disk))

    assert runner(world, config, steps).run() is RunOutcome.DISK_FULL

    job = world.job(JOB)
    assert job["status"] != "failed"
    assert statuses(world)["warp"] == "pending"
    assert any("disk is full" in line for line in world.log_lines(JOB))


def test_bad_path_a_full_disk_in_cloud_run_still_fails_the_job(world: PipelineWorld) -> None:
    """Scenarios: S-P04-BAD-DISK-FULL-CLOUD"""
    steps = scripted(warp=Scripted("warp", action=full_disk))

    assert runner(world, seed(world), steps).run() is RunOutcome.FAILED

    assert dig(world.job(JOB), "error", "code") == Errors.INTERNAL


def test_bad_path_a_disk_full_passed_on_by_a_step_or_gdal_is_still_a_full_disk() -> None:
    wrapped = StepFailedError(Errors.PROCESSING_FAILED, "warp failed")
    wrapped.__cause__ = OSError(errno.ENOSPC, "x")

    assert disk_full(RuntimeError("TIFFAppendToStrip: Write error: No space left on device"))
    assert disk_full(wrapped)
    assert not disk_full(OSError(errno.EACCES, "denied"))
    assert not disk_full(StepFailedError(Errors.PROCESSING_FAILED, "bad pairs"))


class Bytes:
    """An object store whose every object holds `data`."""

    def __init__(self, data: bytes) -> None:
        self.data = data

    def open_read(self, _path: str) -> io.BytesIO:
        return io.BytesIO(self.data)


@pytest.mark.parametrize(
    ("path", "data", "whole"),
    [
        ("work/c/j/tiles.pmtiles", b"PMTiles\x03rest", True),
        ("work/c/j/tiles.pmtiles", b"\x00" * 16, False),
        ("work/c/j/segment.bin", b"\x00" * 16, True),
        ("work/c/j/scan.tif", b"MM\x00*rest", True),
    ],
    ids=["pmtiles", "torn-pmtiles", "other-kind", "big-endian-tiff"],
)
def test_happy_path_each_kind_is_checked_by_its_own_first_bytes(path: str, data: bytes, whole: bool) -> None:
    """Scenarios: S-P04-BAD-RESUME-TORN"""
    info = ObjectInfo(path, len(data), "1")

    assert output_intact(cast(ObjectStore, Bytes(data)), StepRecord("done"), info, local=True) is whole


def test_happy_path_a_json_output_too_large_to_read_is_checked_by_its_size_and_first_bytes() -> None:
    info = ObjectInfo(FRAME, JSON_READ_MAX + 1, "1")

    assert output_intact(cast(ObjectStore, Bytes(b'{"rows": [')), StepRecord("done"), info, local=True)
    assert not output_intact(cast(ObjectStore, Bytes(b"{}")), StepRecord("done", bytes=5), info, local=True)
    assert output_intact(cast(ObjectStore, Bytes(b"")), StepRecord("done"), info, local=False)
