"""An import in two phases (finding 56 of 2026-11-01): the download on the small job, the processing on a larger one."""

from hcm_pipeline.runner import RunOutcome

from tests.fakes.world import ENTITY_ID, PipelineWorld, dig

DOWNLOAD = ("fetch", "extract")
PROCESS = ("stitch", "locate", "reference", "georef", "warp", "export", "pyramid", "register")


def statuses(world: PipelineWorld) -> dict[str, str]:
    steps = world.job()["steps"]
    assert isinstance(steps, dict)
    return {name: str(record["status"]) for name, record in steps.items()}


def deliveries(world: PipelineWorld) -> int:
    return sum(1 for request in world.http.requests if request.path.endswith(f"{ENTITY_ID}.tgz"))


def download_on_the_small_job(world: PipelineWorld) -> None:
    world.seed_import()
    world.store.update(world.job_path(), {"machine": "fetch"})
    assert world.run() is RunOutcome.DONE


def test_happy_path_the_small_job_downloads_then_hands_the_job_over_to_the_standard_one(world: PipelineWorld) -> None:
    """Scenarios: S-P01-HAPPY-PHASES"""
    download_on_the_small_job(world)

    job = world.job()
    assert (job["status"], "lease" in job, job["progress"]) == ("queued", False, 0.3)
    assert statuses(world) == dict.fromkeys(DOWNLOAD, "done")
    assert dig(world.version(), "machines") == {"download": "fetch"}
    assert "the scene is downloaded; its processing is queued for a larger machine" in world.log_lines()

    # The dispatcher sends it to the standard job, which goes on from the first step of the processing.
    world.store.update(world.job_path(), {"machine": "std", "status": "starting"})
    assert world.run() is RunOutcome.DONE

    assert world.job()["status"] == "awaiting_approval"
    assert statuses(world) == dict.fromkeys(DOWNLOAD + PROCESS, "done")
    assert dig(world.version(), "machines") == {"download": "fetch", "process": "std"}
    assert deliveries(world) == 1


def test_bad_path_processing_moved_to_the_large_job_never_downloads_again(world: PipelineWorld) -> None:
    """Scenarios: S-P01-BAD-PHASE-ESCALATED"""
    download_on_the_small_job(world)

    # The standard job ran out of memory: the tick queued the job on `xl`, which skips the download already done.
    world.store.update(world.job_path(), {"machine": "xl", "status": "starting"})
    assert world.run() is RunOutcome.DONE

    assert world.job()["status"] == "awaiting_approval"
    assert dig(world.version(), "machines") == {"download": "fetch", "process": "xl"}
    assert deliveries(world) == 1
