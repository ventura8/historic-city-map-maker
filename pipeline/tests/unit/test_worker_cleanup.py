"""What the worker's folder keeps and lets go (CLEANUP-BRIEF items 1, 2, 5, 6; docs/research/M7-local-worker.md *Disk: what the
worker keeps*): the sweep with the server's job states, the leftovers of a power cut, and the claim's disk duties."""

import os
from pathlib import Path

import pytest
from hcm_pipeline.worker.housekeeping import DISK_FLOOR_BYTES, FRESH_STATES_SECONDS, HELD_EVERY_SECONDS, Housekeeping
from hcm_pipeline.worker.local_store import LocalObjectStore
from hcm_pipeline.worker.sweep import DAY_SECONDS, HOUR_SECONDS, SweepRules, bytes_under, held_jobs

NOW = 1_792_000_000.0
CITY = "bucharest"
GB = 10**9


def aged(root: Path, relative: str, age_seconds: float, data: bytes = b"x") -> Path:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    os.utime(path, (NOW - age_seconds, NOW - age_seconds))
    return path


def job_file(root: Path, job: str, age_seconds: float) -> Path:
    return aged(root, f"work/{CITY}/{job}/segments/a.tif", age_seconds)


def test_happy_path_finished_jobs_go_after_their_two_days_and_unknown_ones_after_fourteen(tmp_path: Path) -> None:
    """Scenarios: S-P04-HAPPY-DISK-SWEPT"""
    done = job_file(tmp_path, "job-done", 49 * HOUR_SECONDS)
    failed = job_file(tmp_path, "job-failed", 49 * HOUR_SECONDS)
    gone = job_file(tmp_path, "job-gone", 49 * HOUR_SECONDS)
    unknown = job_file(tmp_path, "job-unknown", 15 * DAY_SECONDS)
    states = {"job-done": "succeeded", "job-failed": "failed", "job-gone": "gone"}

    swept = LocalObjectStore(tmp_path).sweep(NOW, None, SweepRules(states=states))

    assert not any(path.exists() for path in (done, failed, gone, unknown))
    assert sorted(swept) == [f"work/{CITY}/job-{name}" for name in ("done", "failed", "gone", "unknown")]


def test_bad_path_a_job_the_server_still_needs_is_never_deleted_however_old(tmp_path: Path) -> None:
    """Scenarios: S-P04-BAD-SWEEP-KEEPS-CLAIMED"""
    points = job_file(tmp_path, "job-points", 40 * DAY_SECONDS)
    approval = job_file(tmp_path, "job-approval", 40 * DAY_SECONDS)
    queued_film = aged(tmp_path, f"work/{CITY}/job-film/frame.json", 40 * DAY_SECONDS, b"{}")
    recent = job_file(tmp_path, "job-recent", 47 * HOUR_SECONDS)
    claimed = job_file(tmp_path, "job-claimed", 40 * DAY_SECONDS)
    states = {
        "job-points": "awaiting_gcps",
        "job-approval": "awaiting_approval",
        "job-film": "queued",
        "job-recent": "cancelled",
        "job-claimed": "succeeded",
    }

    LocalObjectStore(tmp_path).sweep(NOW, f"work/{CITY}/job-claimed/", SweepRules(states=states))

    assert all(path.exists() for path in (points, approval, queued_film, recent, claimed))


def test_happy_path_free_space_now_lets_finished_jobs_go_without_their_grace(tmp_path: Path) -> None:
    """Scenarios: S-P04-HAPPY-FREE-SPACE-NOW"""
    finished = job_file(tmp_path, "job-done", 60)
    running = job_file(tmp_path, "job-running", 60)

    LocalObjectStore(tmp_path).sweep(NOW, None, SweepRules(states={"job-done": "succeeded", "job-running": "running"}, now_mode=True))

    assert not finished.exists()
    assert running.exists()


def test_happy_path_a_power_cuts_leftovers_go_after_an_hour_but_a_live_write_and_a_session_stay(tmp_path: Path) -> None:
    """Scenarios: S-P04-HAPPY-LEFTOVERS"""
    old_tmp = aged(tmp_path, f"work/{CITY}/job-1/.frame.json.ab12cd34.tmp", 2 * HOUR_SECONDS)
    old_part = aged(tmp_path, "import/scan.zip.part", 2 * HOUR_SECONDS)
    live = aged(tmp_path, f"work/{CITY}/job-1/.warped.tif.0011aabb.tmp", 60)
    session = aged(tmp_path, ".sessions/0123.part", 2 * HOUR_SECONDS)

    removed = LocalObjectStore(tmp_path).sweep_leftovers(NOW)

    assert not old_tmp.exists()
    assert not old_part.exists()
    assert live.exists()
    assert session.exists()
    assert sorted(removed) == ["import/scan.zip.part", f"work/{CITY}/job-1/.frame.json.ab12cd34.tmp"]


def test_bad_path_a_hidden_leftover_does_not_keep_a_finished_job_young(tmp_path: Path) -> None:
    done = job_file(tmp_path, "job-done", 3 * DAY_SECONDS)
    aged(tmp_path, f"work/{CITY}/job-done/.x.tmp", 10)

    LocalObjectStore(tmp_path).sweep(NOW, None, SweepRules(states={"job-done": "succeeded"}))

    assert not done.parent.parent.exists()


def test_happy_path_deleting_a_delivery_takes_its_empty_folders_but_not_the_prefix(tmp_path: Path) -> None:
    """Scenarios: S-P04-HAPPY-DISK-SWEPT"""
    aged(tmp_path, "usgs-raw/corona2/E1/E1.tgz", 1)
    aged(tmp_path, "usgs-raw/corona2/E2/E2.tgz", 1)
    store = LocalObjectStore(tmp_path)

    store.delete("usgs-raw/corona2/E1/E1.tgz")
    assert (tmp_path / "usgs-raw" / "corona2").is_dir()
    store.delete("usgs-raw/corona2/E2/E2.tgz")

    assert (tmp_path / "usgs-raw").is_dir()
    assert not (tmp_path / "usgs-raw" / "corona2").exists()


def test_happy_path_held_jobs_are_the_longest_unwritten_first_and_the_size_counts_every_file(tmp_path: Path) -> None:
    job_file(tmp_path, "job-new", 10)
    job_file(tmp_path, "job-old", 100)
    os.utime(tmp_path / "work" / CITY / "job-new", (NOW - 10, NOW - 10))
    os.utime(tmp_path / "work" / CITY / "job-old", (NOW - 100, NOW - 100))
    (tmp_path / "work" / CITY / ".hidden").mkdir()

    assert held_jobs(tmp_path, CITY, 200) == ["job-old", "job-new"]
    assert held_jobs(tmp_path, CITY, 1) == ["job-old"]
    assert held_jobs(tmp_path, "bacau", 200) == []
    assert bytes_under(tmp_path) == 2


class Clock:
    def __init__(self) -> None:
        self.now = NOW

    def __call__(self) -> float:
        return self.now


def housekeeping(root: Path, free: list[int], clock: Clock) -> Housekeeping:
    """A keeper whose disk says `free[0]` bytes, and each later value in turn once read."""
    keeper = Housekeeping(root, CITY, clock)

    def said() -> int:
        return free.pop(0) if len(free) > 1 else free[0]

    keeper.free_bytes = said
    return keeper


def test_happy_path_each_claim_says_the_disk_and_once_an_hour_the_jobs_held_here(tmp_path: Path) -> None:
    """Scenarios: S-P04-HAPPY-DISK-REPORTED"""
    job_file(tmp_path, "job-1", 10)
    clock = Clock()
    keeper = housekeeping(tmp_path, [40 * GB], clock)

    first = keeper.claim_extra()
    clock.now += 60
    second = keeper.claim_extra()
    clock.now += HELD_EVERY_SECONDS
    third = keeper.claim_extra()

    assert first == {"disk": {"workBytes": 1, "freeBytes": 40 * GB, "floorBytes": DISK_FLOOR_BYTES}, "held": ["job-1"]}
    assert "held" not in second
    assert third["held"] == ["job-1"]


def test_happy_path_free_space_now_sweeps_at_once_and_says_what_it_freed(tmp_path: Path) -> None:
    """Scenarios: S-P04-HAPPY-FREE-SPACE-NOW"""
    finished = job_file(tmp_path, "job-done", 60)
    keeper = housekeeping(tmp_path, [37 * GB, 40 * GB], Clock())
    keeper.answered({"jobStates": {"job-done": "succeeded"}, "freeSpace": True})

    keeper.sweep(None)

    assert not finished.exists()
    assert keeper.claim_extra()["freed"] == {"bytes": 3 * GB, "at": "2026-10-14T17:46:40.000Z"}


def test_bad_path_free_space_now_with_old_states_asks_for_new_ones_before_deleting(tmp_path: Path) -> None:
    """Scenarios: S-P04-BAD-FREE-SPACE-STALE"""
    retried = job_file(tmp_path, "job-retried", 60)
    clock = Clock()
    keeper = housekeeping(tmp_path, [40 * GB], clock)
    keeper.answered({"jobStates": {"job-retried": "failed"}})
    clock.now += FRESH_STATES_SECONDS + 1
    keeper.claim_extra()
    keeper.answered({"freeSpace": True})

    keeper.sweep(None)
    extra = keeper.claim_extra()
    keeper.answered({"jobStates": {"job-retried": "queued"}, "freeSpace": True})
    keeper.sweep(None)

    assert retried.exists()
    assert extra["held"] == ["job-retried"]


def test_happy_path_a_disk_under_its_floor_frees_finished_jobs_without_being_asked(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    """Scenarios: S-P04-HAPPY-LOW-DISK"""
    finished = job_file(tmp_path, "job-done", 60)
    keeper = housekeeping(tmp_path, [DISK_FLOOR_BYTES - 1], Clock())

    keeper.answered({"jobStates": {"job-done": "cancelled"}, "lowDisk": True})
    keeper.sweep("job-other")

    assert not finished.exists()
    assert "no new job until there is room" in caplog.text
    assert "freed" not in keeper.claim_extra()


def test_bad_path_an_answer_without_states_keeps_what_the_server_said_before(tmp_path: Path) -> None:
    keeper = housekeeping(tmp_path, [40 * GB], Clock())
    kept = job_file(tmp_path, "job-points", 3 * DAY_SECONDS)
    keeper.answered({"jobStates": {"job-points": "awaiting_gcps", "bad": 3}})
    keeper.answered({"jobStates": "not a map"})

    keeper.sweep(None)

    assert kept.exists()
