"""The governor's policy: profiles, hysteresis, battery and heat (docs/research/M26-governor.md §3)."""

from dataclasses import replace

import pytest
from hcm_pipeline.governor.policy import CALM_S, HOT_HOLD_S, TICK_S, Choice, PolicyState, decide, effective, is_hot, pressure
from hcm_pipeline.governor.signals import Cpu, Gpu, Power, Usage
from hypothesis import given, settings
from hypothesis import strategies as st

from tests.fakes.machines import LINUX_NVIDIA_CDI, SMALL_NO_GPU

AUTO = Choice()


def test_an_idle_computer_runs_full() -> None:
    state = decide(LINUX_NVIDIA_CDI, AUTO, PolicyState(), 0.0)
    assert effective(state) == ("full", "idle")


def test_the_user_active_goes_quiet_within_one_tick_and_back_only_after_calm() -> None:
    active = replace(LINUX_NVIDIA_CDI, idle_s=1.0)
    state = decide(active, AUTO, PolicyState(), 0.0)
    assert effective(state) == ("quiet", "user-active")
    state = decide(LINUX_NVIDIA_CDI, AUTO, state, TICK_S)
    assert effective(state) == ("quiet", "user-active")
    state = decide(LINUX_NVIDIA_CDI, AUTO, state, TICK_S + CALM_S - 1)
    assert effective(state)[0] == "quiet"
    state = decide(LINUX_NVIDIA_CDI, AUTO, state, TICK_S + CALM_S)
    assert effective(state) == ("full", "idle")


def test_other_programs_busy_make_it_quiet() -> None:
    busy = replace(SMALL_NO_GPU, usage=Usage(10.0, 55.0, 100))
    assert pressure(busy) == "others-busy"
    assert effective(decide(busy, AUTO, PolicyState(), 0.0)) == ("quiet", "others-busy")


def test_the_owners_choice_wins_over_activity() -> None:
    active = replace(LINUX_NVIDIA_CDI, idle_s=0.0)
    assert effective(decide(active, Choice("full"), PolicyState(), 0.0)) == ("full", "owner")
    assert effective(decide(LINUX_NVIDIA_CDI, Choice("quiet"), PolicyState(), 0.0)) == ("quiet", "owner")


def test_on_battery_it_is_quiet_and_pauses_low_unless_allowed() -> None:
    """Scenarios: S-A141-BAD-BATTERY"""
    battery = replace(LINUX_NVIDIA_CDI, power=Power("battery", 60))
    assert effective(decide(battery, AUTO, PolicyState(), 0.0)) == ("quiet", "battery")
    low = replace(battery, power=Power("battery", 20))
    assert effective(decide(low, AUTO, PolicyState(), 0.0)) == ("paused", "battery")
    assert effective(decide(low, Choice(battery_allowed=True), PolicyState(), 0.0)) == ("quiet", "battery")
    # Back on the mains: quiet through the calm, then full.
    paused = decide(low, AUTO, PolicyState(), 0.0)
    calm = decide(LINUX_NVIDIA_CDI, AUTO, paused, 1.0)
    assert effective(calm)[0] == "quiet"
    assert effective(decide(LINUX_NVIDIA_CDI, AUTO, calm, 1.0 + CALM_S))[0] == "full"


def test_heat_steps_down_one_level_and_back_five_degrees_below() -> None:
    # A mobile processor at work reads 90 °C (the laptop, 2026-11-13): no step down there.
    assert not is_hot(replace(LINUX_NVIDIA_CDI, cpu=Cpu(16, temp_c=90.0)), was_hot=False)
    hot = replace(LINUX_NVIDIA_CDI, cpu=Cpu(16, temp_c=96.0))
    state = decide(hot, AUTO, PolicyState(), 0.0)
    assert effective(state) == ("quiet", "thermal")
    assert effective(decide(hot, Choice("quiet"), PolicyState(), 0.0)) == ("paused", "thermal")
    warm = replace(hot, cpu=Cpu(16, temp_c=92.0))
    state = decide(warm, AUTO, state, 1.0)
    assert state.hot
    # Back at 90, not 85: other programs held the laptop at 88 to 93 °C for hours (2026-11-13), and the worker never resumed.
    cool = replace(hot, cpu=Cpu(16, temp_c=90.0))
    # Held for two minutes once hot: no pause and resume every minute at 90 to 95 °C (the laptop on battery, 2026-11-13).
    assert decide(cool, AUTO, state, 2.0).hot
    assert not decide(cool, AUTO, state, HOT_HOLD_S).hot


def test_a_hot_graphics_card_counts() -> None:
    card = replace(LINUX_NVIDIA_CDI.gpus[0], temp_c=84.0)
    assert is_hot(replace(LINUX_NVIDIA_CDI, gpus=(card, Gpu("x", "y", 0))), was_hot=False)


@settings(max_examples=60, deadline=None)
@given(st.lists(st.tuples(st.floats(0, 300), st.floats(0, 100)), min_size=2, max_size=40))
def test_the_hysteresis_never_flaps(ticks: list[tuple[float, float]]) -> None:
    """Under any sequence of activity, full never follows quiet sooner than `CALM_S` after the last pressure."""
    state, now, last_pressure = PolicyState(), 0.0, None
    for idle, others in ticks:
        signals = replace(SMALL_NO_GPU, idle_s=idle, usage=Usage(0.0, others, 0))
        state = decide(signals, AUTO, state, now)
        if pressure(signals) is not None:
            last_pressure = now
            assert state.active == "quiet"
        elif state.active == "full" and last_pressure is not None:
            assert now - last_pressure >= CALM_S
        now += TICK_S


@pytest.mark.parametrize("idle", [None, 30.0])
def test_unknown_or_old_input_is_not_activity(idle: float | None) -> None:
    assert pressure(replace(SMALL_NO_GPU, idle_s=idle)) is None
