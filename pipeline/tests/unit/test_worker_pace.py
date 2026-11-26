"""An idle worker asks for a job less and less often, and often again after a job or the admin's look (resource audit §4)."""

import pytest
from hcm_pipeline.worker.pace import AWAKE_SECONDS, Pace

POLL = 30.0
SLOWEST = 60.0


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def idle_waits(pace: Pace, passes: int, slowest: float | None = SLOWEST) -> list[float]:
    waits = []
    for _ in range(passes):
        pace.idle_pass()
        waits.append(pace.wait(POLL, slowest))
    return waits


def test_happy_path_a_worker_idle_past_its_awake_time_waits_twice_as_long_each_pass_up_to_the_servers_longest() -> None:
    """Scenarios: S-P31-HAPPY-CLAIM-BACKOFF"""
    clock = Clock()
    pace = Pace(clock, lambda: 0.0)

    assert idle_waits(pace, 3) == [POLL, POLL, POLL]
    clock.now += AWAKE_SECONDS
    assert idle_waits(pace, 4) == [60.0, SLOWEST, SLOWEST, SLOWEST]
    # A month of such waits: 43,200 claims, not the 86,400 of one every 30 s, and a new job starts within a minute.
    assert 30 * 86_400 / SLOWEST == 43_200
    # Idle for days: the count of doublings stops, so no float overflows.
    assert idle_waits(pace, 3000)[-1] == SLOWEST


def test_happy_path_a_job_or_the_admins_look_makes_it_ask_often_again_and_the_jitter_spreads_the_workers() -> None:
    """Scenarios: S-P31-HAPPY-CLAIM-BACKOFF"""
    clock = Clock()
    spreads = iter([0.1, -0.1, 0.05, 0.0, 0.0])
    pace = Pace(clock, lambda: next(spreads))
    clock.now += AWAKE_SECONDS

    assert idle_waits(pace, 2) == [pytest.approx(66.0), pytest.approx(54.0)]
    pace.wake()
    assert pace.awake
    # A wake in the middle of a long wait: the wait is the poll's from then on.
    assert pace.wait(POLL, SLOWEST) == POLL
    assert idle_waits(pace, 1) == [POLL]
    clock.now += AWAKE_SECONDS
    assert idle_waits(pace, 2) == [60.0, SLOWEST]


def test_bad_path_a_server_that_names_no_longest_wait_is_asked_every_poll_and_a_longest_under_the_poll_changes_nothing() -> None:
    """Scenarios: S-P31-BAD-CLAIM-BACKOFF-OLD-SERVER"""
    clock = Clock()
    pace = Pace(clock, lambda: 0.0)
    clock.now += 10 * AWAKE_SECONDS

    assert idle_waits(pace, 4, None) == [POLL, POLL, POLL, POLL]
    assert idle_waits(pace, 2, 10.0) == [POLL, POLL]
    # The real jitter stays within a tenth.
    real = Pace(clock)
    clock.now += AWAKE_SECONDS
    assert 54.0 <= idle_waits(real, 1)[0] <= 66.0


def test_happy_path_a_computer_with_room_asks_first_and_a_hot_or_busy_one_up_to_four_times_later() -> None:
    """Scenarios: S-P31-HAPPY-CLAIM-HEADROOM"""
    clock = Clock()
    pace = Pace(clock, lambda: 0.0)
    room = iter([1.0, 0.5, 0.0, 1.0])
    pace.headroom = lambda: next(room)

    # Awake: the cool one every 30 s, a half-busy one every 75 s, a paused or hot one every 120 s; then room again.
    assert [pace.wait(POLL, SLOWEST) for _ in range(4)] == [POLL, 75.0, 120.0, POLL]
    clock.now += AWAKE_SECONDS
    pace.idle_pass()
    pace.headroom = lambda: 0.0
    assert pace.wait(POLL, SLOWEST) == 240.0


def test_bad_path_a_headroom_out_of_range_is_held_within_zero_and_one() -> None:
    """Scenarios: S-P31-BAD-CLAIM-HEADROOM-RANGE"""
    pace = Pace(Clock(), lambda: 0.0)
    pace.headroom = lambda: 7.0
    assert pace.wait(POLL, SLOWEST) == POLL
    pace.headroom = lambda: -3.0
    assert pace.wait(POLL, SLOWEST) == 4 * POLL
