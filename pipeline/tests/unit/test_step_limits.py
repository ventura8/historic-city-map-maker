"""A step held to its wall-time limit and `locate`'s search to its camera's budget, on a fake clock (live 2026-11-12: an hour in `locate`
on the KH-5 frame DS09065A089MC039 held the computer's queue): the step fails with one clear line, the search crops by the footprint."""

from collections.abc import Callable
from types import SimpleNamespace
from typing import cast

import pytest
from hcm_pipeline.calibrate.chain import Found, FrameSearch
from hcm_pipeline.contract import SENSOR_SPECS, Errors
from hcm_pipeline.jobs import JobContext, RunFlags, StepDeadline, StepTimeLimitError
from hcm_pipeline.runner import JobRunner, RunOutcome, RunSettings
from hcm_pipeline.steps import locate
from hcm_pipeline.steps.locate import SearchBudget

from tests.fakes.world import PipelineWorld, dig
from tests.unit.test_runner import JOB, Scripted, scripted, seed, statuses

# The chain is replaced in these tests: the search it is given is never read.
SEARCH = cast(FrameSearch, object())


def test_happy_path_a_step_within_its_limit_runs_on(world: PipelineWorld) -> None:
    """Scenarios: S-P01-HAPPY-STEP-LIMIT"""

    def quick(ctx: JobContext) -> None:
        world.clock.now += 59
        ctx.checkpoint()

    settings = RunSettings(heartbeat_seconds=3600, step_limits={"georef": 60})
    outcome = JobRunner(seed(world), world.services(), scripted(georef=Scripted("georef", action=quick)), settings).run()

    assert outcome is RunOutcome.DONE
    assert statuses(world)["georef"] == "done"


def test_bad_path_a_step_past_its_limit_fails_the_job_with_one_clear_line(world: PipelineWorld) -> None:
    """Scenarios: S-P01-BAD-STEP-LIMIT"""

    def stuck(ctx: JobContext) -> None:
        while True:
            world.clock.now += 600
            ctx.checkpoint()

    settings = RunSettings(heartbeat_seconds=3600, step_limits={"georef": 45 * 60})
    outcome = JobRunner(seed(world), world.services(), scripted(georef=Scripted("georef", action=stuck)), settings).run()

    assert outcome is RunOutcome.FAILED
    assert dig(world.job(JOB), "error", "code") == Errors.STEP_TIME_LIMIT
    assert dig(world.job(JOB), "error", "params") == {"step": "georef", "minutes": "45"}
    assert statuses(world)["georef"] == "failed"


def test_happy_path_every_step_has_a_limit_and_locate_the_shortest_of_the_long_ones() -> None:
    settings = RunSettings()

    assert settings.limit_of("locate") == 45 * 60
    assert settings.limit_of("export") == 3 * 3600
    assert RunSettings(step_limits={"locate": 5}).limit_of("locate") == 5
    assert SENSOR_SPECS["KH-5"].search_seconds < settings.limit_of("locate")


def test_bad_path_a_deadline_passed_stops_at_the_next_checkpoint_only() -> None:
    now = [0.0]
    flags = RunFlags()
    flags.enter("place", 0.0, 1.0, StepDeadline("place", 10.0, 10.0, lambda: now[0]))
    flags.check()
    now[0] = 11.0

    with pytest.raises(StepTimeLimitError) as stopped:
        flags.check()

    assert stopped.value.params == {"step": "place", "minutes": "1"}
    flags.enter("export", 0.0, 1.0)
    flags.check()


def _budget(world: PipelineWorld, seconds: float) -> tuple[SearchBudget, list[int]]:
    ticks: list[int] = []
    ctx = SimpleNamespace(services=SimpleNamespace(clock=world.clock), checkpoint=lambda: ticks.append(1))
    return SearchBudget(cast(JobContext, ctx), seconds), ticks


def test_happy_path_a_search_within_its_budget_answers_what_the_chain_found(world: PipelineWorld, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P06-HAPPY-SEARCH-BUDGET"""
    found = Found(None, "votes", None, (12, 20), None, ())

    def chain(_search: FrameSearch, tick: Callable[[], None], _say: object) -> Found:
        world.clock.now += 60
        tick()
        return found

    monkeypatch.setattr(locate, "find_frame", chain)
    budget, ticks = _budget(world, 600)

    assert budget.find(SEARCH, lambda _line: None) is found
    assert not budget.timed_out
    assert ticks == [1]


def test_bad_path_a_search_past_its_budget_ends_not_found_and_searches_no_more_windows(
    world: PipelineWorld, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P06-BAD-SEARCH-BUDGET"""
    calls: list[int] = []

    def endless(_search: FrameSearch, tick: Callable[[], None], _say: object) -> Found:
        calls.append(1)
        while True:
            world.clock.now += 120
            tick()

    monkeypatch.setattr(locate, "find_frame", endless)
    budget, _ticks = _budget(world, SENSOR_SPECS["KH-5"].search_seconds)
    said: list[str] = []

    first = budget.find(SEARCH, said.append)
    second = budget.find(SEARCH, said.append)

    assert budget.timed_out
    assert first.proof is None
    assert second.proof is None
    assert first.votes == (0, 0)
    assert calls == [1]
    assert said == ["the search ran out of its 10 min: the whole frame is offered, points are next"]
