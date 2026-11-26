"""The run loop with scripted steps: lease, step records, skips, waits, failures, crashes, cancels and resumes."""

import signal
from collections.abc import Callable
from dataclasses import dataclass, field

import pytest
from hcm_pipeline.config import Config
from hcm_pipeline.contract import Errors
from hcm_pipeline.jobs import Done, InterruptedRunError, JobContext, LeaseLostError, RunFlags, Skipped, StepFailedError, StepResult, Waiting
from hcm_pipeline.model import Timestamp
from hcm_pipeline.objects import ObjectInfo
from hcm_pipeline.runner import JobRunner, RunOutcome, RunSettings, sigterm_raises

from tests.fakes.world import CITY, NOW, PipelineWorld, dig

JOB = "job-regeoref-9"
STEPS = ("georef", "warp", "export", "pyramid", "register")


@dataclass
class Scripted:
    name: str
    result: StepResult = field(default_factory=Done)
    action: Callable[[JobContext], None] | None = None
    runs: int = 0

    def run(self, ctx: JobContext) -> StepResult:
        self.runs += 1
        if self.action is not None:
            self.action(ctx)
        return self.result


def scripted(**overrides: Scripted) -> dict[str, Scripted]:
    return {name: overrides.get(name, Scripted(name)) for name in STEPS}


def seed(world: PipelineWorld, params: dict[str, object] | None = None, version: bool = True) -> Config:
    world.seed_city()
    world.seed_job(JOB, "regeoref", params if params is not None else {"basedOn": "v0"})
    if version:
        world.store.seed(
            world.version_path(JOB),
            {"layerId": "layer-1", "jobId": JOB, "origin": "regeoref", "state": "processing", "label": {"ro": "x"}, "year": 1966},
        )
    return Config(**{**world.config.__dict__, "job_id": JOB})


def runner(world: PipelineWorld, config: Config, steps: dict[str, Scripted]) -> JobRunner:
    return JobRunner(config, world.services(), steps, RunSettings(heartbeat_seconds=3600))


def statuses(world: PipelineWorld) -> dict[str, str]:
    steps = world.job(JOB).get("steps", {})
    assert isinstance(steps, dict)
    return {name: str(record["status"]) for name, record in steps.items()}


def test_happy_path_every_step_runs_once_and_is_recorded(world: PipelineWorld) -> None:
    steps = scripted(georef=Scripted("georef", Skipped("nothing to fit")))

    outcome = runner(world, seed(world), steps).run()

    job = world.job(JOB)
    assert outcome is RunOutcome.DONE
    assert statuses(world) == {"georef": "skipped", "warp": "done", "export": "done", "pyramid": "done", "register": "done"}
    assert [step.runs for step in steps.values()] == [1, 1, 1, 1, 1]
    assert dig(job, "steps", "warp") == {"status": "done", "startedAt": Timestamp.at(NOW), "finishedAt": Timestamp.at(NOW)}
    assert "step georef skipped: nothing to fit" in world.log_lines(JOB)


def test_happy_path_a_done_step_whose_output_still_exists_is_not_run_again(world: PipelineWorld) -> None:
    config = seed(world)
    world.gcs.put("work/bucharest/job-regeoref-9/warped.tif", b"tif")
    generation = str(world.gcs.objects["work/bucharest/job-regeoref-9/warped.tif"].generation)
    world.store.update(
        world.job_path(JOB),
        {"steps.warp": {"status": "done", "gcsPath": "work/bucharest/job-regeoref-9/warped.tif", "generation": generation}},
    )
    world.store.update(world.job_path(JOB), {"steps.georef": {"status": "done", "gcsPath": "work/bucharest/job-regeoref-9/gone.tif"}})
    steps = scripted()

    runner(world, config, steps).run()

    assert (steps["georef"].runs, steps["warp"].runs) == (1, 0)


def test_happy_path_a_recorded_output_is_kept_with_its_generation(world: PipelineWorld) -> None:
    output = ObjectInfo("work/bucharest/job-regeoref-9/warped.tif", 3, "1792000000000009")
    steps = scripted(warp=Scripted("warp", Done(output, "a" * 64)))

    runner(world, seed(world), steps).run()

    assert dig(world.job(JOB), "steps", "warp", "generation") == "1792000000000009"
    assert dig(world.job(JOB), "steps", "warp", "bytes") == 3


def test_happy_path_one_step_on_its_own_leaves_the_job_queued(world: PipelineWorld) -> None:
    steps = scripted()

    outcome = runner(world, seed(world), steps).run("warp")

    assert outcome is RunOutcome.DONE
    assert [step.runs for step in steps.values()] == [0, 1, 0, 0, 0]
    assert world.job(JOB)["status"] == "queued"


def test_bad_path_an_invalid_job_fails_without_running_a_step(world: PipelineWorld) -> None:
    steps = scripted()

    outcome = runner(world, seed(world, {"basedOn": "../x"}), steps).run()

    job = world.job(JOB)
    assert outcome is RunOutcome.FAILED
    assert dig(job, "error", "code") == Errors.INVALID_REQUEST
    assert job["status"] == "failed"
    assert all(step.runs == 0 for step in steps.values())


def test_bad_path_a_job_type_this_image_does_not_run_fails_as_an_outdated_pipeline(world: PipelineWorld) -> None:
    """Scenarios: S-A12-HAPPY-RETRY-OUTDATED"""
    config = seed(world)
    world.store.update(world.job_path(JOB), {"type": "future-type", "versionId": JOB})

    assert runner(world, config, scripted()).run() is RunOutcome.FAILED

    assert dig(world.job(JOB), "error", "code") == Errors.PIPELINE_OUTDATED
    assert dig(world.version(JOB), "error", "code") == Errors.PIPELINE_OUTDATED


def test_bad_path_an_invalid_jobs_version_fails_with_it_so_a_retry_or_a_dismiss_finds_it_failed(world: PipelineWorld) -> None:
    """Scenarios: S-A12-BAD-STRANDED-VERSION"""
    config = seed(world, {"basedOn": "../x"})
    world.store.update(world.job_path(JOB), {"versionId": JOB})

    assert runner(world, config, scripted()).run() is RunOutcome.FAILED

    version = world.version(JOB)
    assert version["state"] == "failed"
    assert dig(version, "error", "code") == Errors.INVALID_REQUEST


def test_bad_path_a_job_without_its_version_is_invalid(world: PipelineWorld) -> None:
    outcome = runner(world, seed(world, version=False), scripted()).run()

    assert outcome is RunOutcome.FAILED
    assert "does not exist" in str(dig(world.job(JOB), "error", "message"))


def test_bad_path_a_job_naming_no_version_is_invalid(world: PipelineWorld) -> None:
    config = seed(world)
    world.store.update(world.job_path(JOB), {"versionId": __import__("hcm_pipeline.store", fromlist=["DELETE"]).DELETE})

    assert runner(world, config, scripted()).run() is RunOutcome.FAILED
    assert "names no layer version" in str(dig(world.job(JOB), "error", "message"))


def test_bad_path_a_step_failure_fails_the_job_and_the_version_with_its_params(world: PipelineWorld) -> None:
    """Scenarios: S-P01-BAD-WRITTEN-PARAMS"""

    def fail(_ctx: JobContext) -> None:
        raise StepFailedError(Errors.TOO_FEW_GCPS, "too few enabled points; token=abc", {"min": 6})

    outcome = runner(world, seed(world), scripted(georef=Scripted("georef", action=fail))).run()

    job, version = world.job(JOB), world.version(JOB)
    assert outcome is RunOutcome.FAILED
    # The params are texts, as `apiErrorParamsSchema` reads them (finding 62 of 2026-11-02: a number made both unreadable).
    assert job["error"] == {"code": Errors.TOO_FEW_GCPS, "message": "too few enabled points; token=[REDACTED]", "params": {"min": "6"}}
    assert job["finishedAt"] == Timestamp.at(NOW)
    assert statuses(world)["georef"] == "failed"
    assert version["state"] == "failed"
    assert version["error"] == {"code": Errors.TOO_FEW_GCPS, "params": {"min": "6"}}


def test_bad_path_a_crash_fails_the_job_as_internal(world: PipelineWorld) -> None:
    def crash(_ctx: JobContext) -> None:
        raise KeyError("boom")

    outcome = runner(world, seed(world), scripted(warp=Scripted("warp", action=crash))).run()

    assert outcome is RunOutcome.FAILED
    assert dig(world.job(JOB), "error", "code") == Errors.INTERNAL
    assert world.version(JOB)["error"] == {"code": Errors.INTERNAL}


def test_bad_path_a_lost_lease_stops_without_writing(world: PipelineWorld) -> None:
    def lose(ctx: JobContext) -> None:
        world.store.update(world.job_path(JOB), {"lease.owner": "raster-pipeline-z/0"})
        raise LeaseLostError("taken")

    outcome = runner(world, seed(world), scripted(warp=Scripted("warp", action=lose))).run()

    assert outcome is RunOutcome.UNTOUCHED
    assert world.job(JOB)["status"] == "running"


def test_bad_path_a_cancel_seen_between_steps_cancels_the_job(world: PipelineWorld) -> None:
    def ask_to_cancel(_ctx: JobContext) -> None:
        world.store.update(world.job_path(JOB), {"cancelRequested": True})

    world.gcs.put(f"work/{CITY}/{JOB}/warped.tif", b"x")
    steps = scripted(georef=Scripted("georef", action=ask_to_cancel))

    outcome = runner(world, seed(world), steps).run()

    assert outcome is RunOutcome.CANCELLED
    assert steps["warp"].runs == 0
    assert world.version(JOB)["state"] == "cancelled"
    assert world.gcs.names(f"work/{CITY}/{JOB}/") == []


def test_bad_path_an_interrupted_step_is_requeued_with_its_start_kept(world: PipelineWorld) -> None:
    def interrupt(ctx: JobContext) -> None:
        raise InterruptedRunError("SIGTERM")

    outcome = runner(world, seed(world), scripted(export=Scripted("export", action=interrupt))).run()

    job = world.job(JOB)
    assert outcome is RunOutcome.REQUEUED
    assert (job["status"], job["retryAt"]) == ("queued", Timestamp.at(NOW + 60))
    assert dig(job, "steps", "export") == {"status": "pending", "startedAt": Timestamp.at(NOW)}


@pytest.mark.parametrize(
    ("waiting", "status"),
    [
        (Waiting("awaiting_gcps", "gcps", "needs points"), "awaiting_gcps"),
        (Waiting("waiting_usgs", "rate-limited", "slow down", Timestamp.at(NOW + 900)), "waiting_usgs"),
    ],
)
def test_bad_path_a_waiting_step_releases_the_lease_and_waits(world: PipelineWorld, waiting: Waiting, status: str) -> None:
    steps = scripted(georef=Scripted("georef", waiting))

    outcome = runner(world, seed(world), steps).run()

    job = world.job(JOB)
    assert outcome is RunOutcome.WAITING
    assert (job["status"], job["waitReason"]) == (status, waiting.reason)
    assert job.get("retryAt") == waiting.retry_at
    assert "lease" not in job
    assert steps["warp"].runs == 0
    assert waiting.message in world.log_lines(JOB)


def test_bad_path_a_job_document_without_a_type_is_invalid(world: PipelineWorld) -> None:
    config = seed(world)
    world.store.update(world.job_path(JOB), {"type": ""})

    assert runner(world, config, scripted()).run() is RunOutcome.FAILED
    assert dig(world.job(JOB), "error", "code") == Errors.INVALID_REQUEST


def test_bad_path_a_transfer_of_unknown_size_reports_its_bytes_only_at_most_every_five_seconds(world: PipelineWorld) -> None:
    def transfer(ctx: JobContext) -> None:
        ctx.report_bytes(10, 0)
        ctx.report_bytes(20, 0)
        world.clock.now += 5
        ctx.report_bytes(30, 0)

    runner(world, seed(world), scripted(warp=Scripted("warp", action=transfer))).run()

    reports = [fields for path, fields in world.store.writes if path == world.job_path(JOB) and "steps.warp.bytes" in fields]
    assert [report["steps.warp.bytes"] for report in reports] == [10, 30]
    assert not any("steps.warp.totalBytes" in report for report in reports)


@pytest.mark.parametrize("number", [signal.SIGTERM, signal.SIGINT])
def test_bad_path_sigterm_or_ctrl_c_stops_the_run_at_its_next_checkpoint(number: signal.Signals) -> None:
    """Cloud Run's SIGTERM, or a local worker's Ctrl-C (M7): the flag the next checkpoint raises; the handlers come back after."""
    flags, before = RunFlags(), signal.getsignal(number)

    with sigterm_raises(flags):
        signal.raise_signal(number)

    assert flags.stopping is InterruptedRunError
    assert signal.getsignal(number) is before


def test_bad_path_a_signal_also_tells_the_python_handler_it_replaced_but_never_raises_ctrl_c() -> None:
    """The local worker's loop learns of a signal during a run, after its last checkpoint too (docs/LESSONS.md 342); Python's
    own Ctrl-C handler is not called, which would raise `KeyboardInterrupt` in the middle of the run."""
    told: list[int] = []
    flags, before = RunFlags(), signal.signal(signal.SIGTERM, lambda number, _frame: told.append(number))
    try:
        with sigterm_raises(flags):
            signal.raise_signal(signal.SIGTERM)
            signal.raise_signal(signal.SIGINT)
    finally:
        signal.signal(signal.SIGTERM, before)

    assert told == [signal.SIGTERM]
    assert flags.stopping is InterruptedRunError


def test_bad_path_a_stop_asked_before_the_run_requeues_the_job_before_its_first_step(world: PipelineWorld) -> None:
    """The local worker took a signal while it claimed the job: the run stops at its first checkpoint, no step started."""
    steps = scripted()
    settings = RunSettings(heartbeat_seconds=3600, asked_to_stop=lambda: True)

    outcome = JobRunner(seed(world), world.services(), steps, settings).run()

    job = world.job(JOB)
    assert outcome is RunOutcome.REQUEUED
    assert (job["status"], job["retryAt"]) == ("queued", Timestamp.at(NOW + 60))
    assert all(step.runs == 0 for step in steps.values())
    assert "steps" not in job


def _parked_import(world: PipelineWorld, steps: dict[str, object]) -> tuple[Config, dict[str, Scripted]]:
    """An import `imagery.locateAgain` queued again: what it fetched and unpacked recorded, `stitch` and after pending."""
    world.seed_city()
    params = {"entityId": "DS1035-1057DA023", "dataset": "corona2", "sensor": "KH-4A"}
    world.seed_job(JOB, "usgs-import", params)
    world.store.documents[world.job_path(JOB)]["steps"] = steps
    world.store.seed(
        world.version_path(JOB),
        {"layerId": "layer-1", "jobId": JOB, "origin": "usgs", "state": "processing", "label": {"ro": "x"}, "year": 1966},
    )
    names = ("fetch", "extract", "stitch", "locate", "reference", "georef", "warp", "export", "pyramid", "register")
    return Config(**{**world.config.__dict__, "job_id": JOB}), {name: Scripted(name) for name in names}


def _stored(world: PipelineWorld, path: str) -> dict[str, object]:
    world.gcs.put(path, b"x")
    return {"status": "done", "gcsPath": path}


def test_happy_path_locate_again_keeps_the_segments_and_joins_them_again(world: PipelineWorld) -> None:
    steps = {
        "fetch": {"status": "done", "gcsPath": "usgs-raw/corona2/x/a.tgz"},
        "extract": _stored(world, "work/c/j/segments/a.tif"),
        "stitch": {"status": "pending"},
    }
    config, scripts = _parked_import(world, steps)

    runner(world, config, scripts).run()

    assert [name for name, step in scripts.items() if step.runs] == [
        "stitch",
        "locate",
        "reference",
        "georef",
        "warp",
        "export",
        "pyramid",
        "register",
    ]


def test_happy_path_locate_again_unpacks_a_kept_delivery_when_the_segments_expired(world: PipelineWorld) -> None:
    steps = {
        "fetch": _stored(world, "usgs-raw/corona2/x/a.tgz"),
        "extract": {"status": "done", "gcsPath": "work/c/j/segments/a.tif"},
        "stitch": {"status": "pending"},
    }
    config, scripts = _parked_import(world, steps)

    runner(world, config, scripts).run()

    assert scripts["fetch"].runs == 0
    assert (scripts["extract"].runs, scripts["stitch"].runs, scripts["locate"].runs) == (1, 1, 1)


def _parked_landsat(world: PipelineWorld, steps: dict[str, object]) -> tuple[Config, dict[str, Scripted]]:
    """A Landsat import queued again on another computer: `locate` skipped (a scene needs none), `warp` and after pending."""
    world.seed_city()
    params = {"entityId": "LC81830292017243LGN00", "dataset": "landsat_ot_c2_l1", "sensor": "L8-OLI"}
    world.seed_job(JOB, "usgs-import", params)
    skipped = {"status": "skipped"}
    world.store.documents[world.job_path(JOB)]["steps"] = {"stitch": skipped, "locate": skipped, "warp": {"status": "pending"}, **steps}
    world.store.seed(
        world.version_path(JOB),
        {"layerId": "layer-1", "jobId": JOB, "origin": "usgs", "state": "processing", "label": {"ro": "x"}, "year": 2017},
    )
    names = ("fetch", "extract", "stitch", "locate", "reference", "georef", "warp", "export", "pyramid", "register")
    return Config(**{**world.config.__dict__, "job_id": JOB}), {name: Scripted(name) for name in names}


def test_happy_path_a_landsat_job_without_its_bands_here_extracts_them_again_from_the_kept_delivery(world: PipelineWorld) -> None:
    """Scenarios: S-P30-HAPPY-BANDS-AGAIN"""
    # Lesson 706: a skipped `locate` once passed the bands over, and `warp` failed missingBand on another computer.
    steps = {
        "fetch": _stored(world, "usgs-raw/landsat_ot_c2_l1/x/a.tar"),
        "extract": {"status": "done", "gcsPath": "work/c/j/bands/B4.tif"},
    }
    config, scripts = _parked_landsat(world, steps)

    runner(world, config, scripts).run()

    assert scripts["fetch"].runs == 0
    assert (scripts["extract"].runs, scripts["warp"].runs) == (1, 1)


def test_bad_path_a_landsat_job_without_its_bands_nor_its_delivery_downloads_the_scene_again(world: PipelineWorld) -> None:
    """Scenarios: S-P30-BAD-BANDS-AND-DELIVERY-GONE"""
    steps: dict[str, object] = {
        "fetch": {"status": "done", "gcsPath": "usgs-raw/landsat_ot_c2_l1/x/a.tar"},
        "extract": {"status": "done", "gcsPath": "work/c/j/bands/B4.tif"},
    }
    config, scripts = _parked_landsat(world, steps)

    runner(world, config, scripts).run()

    assert (scripts["fetch"].runs, scripts["extract"].runs, scripts["warp"].runs) == (1, 1, 1)


def test_happy_path_a_landsat_job_whose_warp_is_kept_needs_neither_its_bands_nor_its_delivery(world: PipelineWorld) -> None:
    """Scenarios: S-P30-HAPPY-BANDS-AGAIN"""
    steps = {
        "fetch": {"status": "done", "gcsPath": "usgs-raw/landsat_ot_c2_l1/x/a.tar"},
        "extract": {"status": "done", "gcsPath": "work/c/j/bands/B4.tif"},
        "warp": _stored(world, "work/c/j/warped.tif"),
    }
    config, scripts = _parked_landsat(world, steps)

    runner(world, config, scripts).run()

    assert (scripts["fetch"].runs, scripts["extract"].runs, scripts["warp"].runs) == (0, 0, 0)
    assert scripts["export"].runs == 1
