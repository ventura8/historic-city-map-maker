"""Archive maps joined into one layer, each part on its own fit (finding of 2026-11-14; docs/research/M8-join-interfaces.md §20)."""

import json
from dataclasses import replace
from pathlib import Path

import pytest
from hcm_pipeline.contract import Errors
from hcm_pipeline.runner import RunOutcome

from tests.contracts_loader import record, records
from tests.fakes.world import CITY, PipelineWorld, dig
from tests.integration.joining import GROUND_PX, JOB, Frame, run_join, seed_join, seed_parts
from tests.synthetic.scenes import World, render_world

CITY_HALF = (10000.0, 5000.0)
TALL = (1600, 1400)
WEST = Frame("west", (-5000.0, 0.0), (30.0, 0.0), size=TALL, checkpoint_rmse_m=20.0)
EAST = Frame("east", (5000.0, 0.0), (-30.0, 0.0), gain=1.25, size=TALL, checkpoint_rmse_m=40.0)
WORK = f"work/{CITY}/{JOB}"


@pytest.fixture(scope="module")
def ground() -> World:
    return render_world(11, GROUND_PX)


def plan_of(world: PipelineWorld) -> dict[str, object]:
    """Only `align` run: the plan it wrote."""
    assert world.runner(replace(world.config, job_id=JOB)).run("align") is RunOutcome.DONE
    return record(json.loads(world.gcs.objects[f"{WORK}/join-plan.json"].data))


def nodes_of(plan: dict[str, object], frame: Frame) -> object:
    return next(part["nodes"] for part in records(plan["parts"]) if part["versionId"] == frame.version_id)


def seams_of(world: PipelineWorld) -> list[dict[str, object]]:
    return records(dig(world.version(JOB), "join", "seams"))


def error_code(world: PipelineWorld) -> object:
    return dig(world.job(JOB), "error", "code")


def test_happy_path_archive_maps_join_measures_the_seam_and_keeps_each_fit(world: PipelineWorld, ground: World, tmp_path: Path) -> None:
    """Scenarios: S-P05-HAPPY-ARCHIVE

    Finding of 2026-11-14 (n and S 1978, 1974-01 and -02): an archive maps' join keeps each part on its own fit."""
    seed_parts(world, tmp_path, ground, [WEST, EAST], CITY_HALF)
    seed_join(world, [WEST, EAST], archive=True)

    plan = plan_of(world)
    assert run_join(world) is RunOutcome.DONE

    assert all(nodes_of(plan, frame) == [] for frame in (WEST, EAST))
    seam = seams_of(world)[0]
    assert (seam["measured"], seam["applied"]) == (True, False)
    assert record(world.version(JOB)["join"])["maxShiftM"] == 0
    assert world.version(JOB)["state"] == "awaiting_approval"


def test_bad_path_archive_maps_that_never_meet_say_so(world: PipelineWorld, ground: World, tmp_path: Path) -> None:
    """Scenarios: S-P05-BAD-ARCHIVE-APART"""
    size = (1300, 1000)
    frames = [Frame("west", (-8500.0, 0.0), size=size), Frame("east", (8500.0, 0.0), size=size)]
    seed_parts(world, tmp_path, ground, frames, CITY_HALF)
    seed_join(world, frames, archive=True)

    assert run_join(world) is RunOutcome.FAILED

    assert error_code(world) == Errors.JOIN_MAPS_APART
