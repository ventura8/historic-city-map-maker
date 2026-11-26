"""Pause (the owner's request of 2026-11-13): a job the owner paused stops before its next step; a paused computer hands its job back."""

import pytest
from hcm_pipeline.jobs import CancelledRunError, InterruptedRunError, JobContext, ReleasedRunError, RunFlags, RunStoppedError
from hcm_pipeline.lease import Heartbeat
from hcm_pipeline.model import Job, Timestamp
from hcm_pipeline.runner import JobRunner, RunOutcome, RunSettings

from tests.fakes.documents import MemoryStore
from tests.fakes.world import NOW, PipelineWorld, dig
from tests.unit.test_runner import JOB, Scripted, runner, scripted, seed, statuses

PAUSED = {"by": "owner-uid", "at": Timestamp.at(NOW)}
LEASED = "cities/bucharest/jobs/job-1"
ME = "worker:w-0123456789abcdef"


def test_happy_path_a_job_paused_during_a_step_stops_before_the_next_one_and_waits_queued(world: PipelineWorld) -> None:
    """Scenarios: S-P32-HAPPY-JOB-BOUNDARY"""

    def pause(_ctx: JobContext) -> None:
        world.store.update(world.job_path(JOB), {"paused": PAUSED})

    steps = scripted(warp=Scripted("warp", action=pause))

    outcome = runner(world, seed(world), steps).run()

    job = world.job(JOB)
    assert outcome is RunOutcome.PAUSED
    assert (job["status"], "lease" in job, "retryAt" in job) == ("queued", False, False)
    assert statuses(world) == {"georef": "done", "warp": "done"}
    assert (steps["warp"].runs, steps["export"].runs) == (1, 0)
    assert "paused by the owner after step warp; Resume puts it back in the queue and it goes on from there" in world.log_lines(JOB)
    assert world.version(JOB)["state"] == "processing"


def test_bad_path_a_job_paused_before_its_run_starts_no_step(world: PipelineWorld) -> None:
    """Scenarios: S-P32-BAD-JOB-BEFORE-RUN"""
    config = seed(world)
    world.store.update(world.job_path(JOB), {"paused": PAUSED, "retryAt": Timestamp.at(NOW)})
    steps = scripted()

    outcome = runner(world, config, steps).run()

    job = world.job(JOB)
    assert outcome is RunOutcome.PAUSED
    assert all(step.runs == 0 for step in steps.values())
    assert (job["status"], "retryAt" in job, "steps" in job) == ("queued", False, False)
    assert "paused by the owner before its first step; Resume puts it back in the queue and it goes on from there" in world.log_lines(JOB)


def test_happy_path_a_paused_computer_hands_the_job_back_with_its_step_pending(world: PipelineWorld) -> None:
    """Scenarios: S-P32-HAPPY-RELEASE-CHECKPOINT"""
    paused = {"now": False}

    def pause_mid_step(ctx: JobContext) -> None:
        paused["now"] = True
        ctx.checkpoint()

    steps = scripted(export=Scripted("export", action=pause_mid_step))
    settings = RunSettings(heartbeat_seconds=3600, asked_to_release=lambda: paused["now"])

    outcome = JobRunner(seed(world), world.services(), steps, settings).run()

    job = world.job(JOB)
    assert outcome is RunOutcome.RELEASED
    assert dig(job, "steps", "export") == {"status": "pending", "startedAt": Timestamp.at(NOW)}
    assert job["status"] == "running"
    assert steps["pyramid"].runs == 0
    assert "this computer was paused; the job goes back to the queue and resumes from this step" in world.log_lines(JOB)


def test_bad_path_a_computer_paused_between_steps_leaves_the_finished_step_done(world: PipelineWorld) -> None:
    """Scenarios: S-P32-BAD-RELEASE-BETWEEN-STEPS"""
    paused = {"now": False}

    def pause_after(_ctx: JobContext) -> None:
        paused["now"] = True

    steps = scripted(warp=Scripted("warp", action=pause_after))
    settings = RunSettings(heartbeat_seconds=3600, asked_to_release=lambda: paused["now"])

    outcome = JobRunner(seed(world), world.services(), steps, settings).run()

    assert outcome is RunOutcome.RELEASED
    assert statuses(world) == {"georef": "done", "warp": "done"}
    assert steps["export"].runs == 0


def test_happy_path_the_heartbeat_reads_a_release_and_a_cancel_still_wins() -> None:
    store = MemoryStore()
    lease = {"owner": ME, "until": Timestamp.at(NOW)}
    store.seed(LEASED, {"type": "usgs-import", "status": "running", "lease": lease, "releaseRequested": True})
    flags = RunFlags()
    Heartbeat(store, LEASED, ME, flags, lambda: 1792000060.0).beat()
    released: object = flags.stopping

    store.update(LEASED, {"cancelRequested": True})
    Heartbeat(store, LEASED, ME, flags, lambda: 1792000060.0).beat()

    assert (released, flags.stopping) == (ReleasedRunError, CancelledRunError)


@pytest.mark.parametrize(
    ("stop", "release", "expected"),
    [(False, True, ReleasedRunError), (False, False, None), (True, True, InterruptedRunError)],
)
def test_bad_path_the_run_flags_release_only_when_nothing_else_stops_the_run(
    stop: bool, release: bool, expected: type[RunStoppedError] | None
) -> None:
    flags = RunFlags(lambda: stop, lambda _waiting: 0.0, lambda: release)

    assert flags.stopping is expected
    if expected is not None:
        with pytest.raises(expected):
            flags.check()


def test_happy_path_the_job_model_reads_the_pause() -> None:
    assert Job.of("j", {"type": "usgs-import", "status": "running", "paused": PAUSED}).paused
    assert not Job.of("j", {"type": "usgs-import", "status": "running", "paused": True}).paused
