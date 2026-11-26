"""`locate`'s deletion of the raw USGS delivery, at its edges (M7, docs/research/M7-local-worker.md §5)."""

from pathlib import Path

from hcm_pipeline.documents import Version
from hcm_pipeline.joblog import JobLog
from hcm_pipeline.jobs import JobContext, RunFlags
from hcm_pipeline.log import get_logger
from hcm_pipeline.model import Job
from hcm_pipeline.steps.locate import delete_delivery

from tests.fakes.world import ENTITY_ID, JOB_ID, PipelineWorld

RAW = f"usgs-raw/corona2/{ENTITY_ID}/{ENTITY_ID}.tgz"


def context(world: PipelineWorld, workdir: Path, fetched: str | None) -> JobContext:
    world.seed_import()
    if fetched is not None:
        world.store.update(world.job_path(), {"steps.fetch": {"status": "done", "gcsPath": fetched}})
    log = JobLog(world.store, f"{world.job_path()}/logs", world.clock, get_logger("test"))
    job, version = Job.of(JOB_ID, world.job()), Version.of(JOB_ID, world.version())
    return JobContext(world.config, world.services(), job, version, workdir, RunFlags(), log)


def test_happy_path_a_delivery_already_gone_is_fine(world: PipelineWorld, tmp_path: Path) -> None:
    delete_delivery(context(world, tmp_path, RAW))

    assert world.log_lines() == [f"the USGS delivery {RAW} is deleted: the city crop is recorded"]


def test_bad_path_only_a_usgs_raw_object_is_ever_deleted(world: PipelineWorld, tmp_path: Path) -> None:
    upload = "uploads/rasters/bucharest/uid-owner/up-1/abcdefgh12.tif"
    world.gcs.put(upload, b"an admin's upload")

    delete_delivery(context(world, tmp_path, upload))
    delete_delivery(context(world, tmp_path, None))

    assert world.gcs.names("uploads/") == [upload]
    assert world.log_lines() == []
