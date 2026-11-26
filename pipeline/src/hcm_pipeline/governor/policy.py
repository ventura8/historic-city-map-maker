"""Signals to a profile, with hysteresis (docs/research/M26-governor.md §3). One pure function, `decide`, and its small helpers.

- The owner's choice wins over the user's activity: Quiet is always quiet, Full is full while the user works. Auto goes quiet within one
  tick of input on the host (`idle_s` under `ACTIVE_IDLE_S`), of other processes using more than `OTHERS_BUSY_PCT` of the machine, or
  of a switch to battery; it returns to full only after `CALM_S` with none of those.
- Below `LOW_BATTERY_PCT` on battery it pauses, unless the owner allowed work on battery.
- The owner's `paused` (Pause this computer, 2026-11-13) is a choice like the others and a claim block (`worker/pausing.py`): paused,
  `why: owner`, whatever the heat or the battery say (nothing makes it less paused).
- Thermal: at `CPU_HOT_C` on the processor or `GPU_HOT_C` on a graphics card it steps down one level (full to quiet, quiet to paused),
  and steps back up only `COOL_MARGIN_C` below both. Before that the budget's threads already shrink with the heat (`budget.py`,
  from `WARM_C`), so the worker's own load seldom takes the processor there.
"""

from dataclasses import dataclass, replace
from typing import Final

from hcm_pipeline.governor.signals import Chosen, Profile, Signals, Why

TICK_S: Final = 5.0
ACTIVE_IDLE_S: Final = 2 * TICK_S
CALM_S: Final = 120.0
OTHERS_BUSY_PCT: Final = 40.0
LOW_BATTERY_PCT: Final = 30
# 95, not 90 (measured 2026-11-13): the laptop's package sat at 90 °C with only a local model running and the NUC at 82 to 86 under a
# matcher run; their trip points are 100 to 110. At 90 the governor would step down on every mobile processor at work, all day.
CPU_HOT_C: Final = 95.0
GPU_HOT_C: Final = 83.0
# 5, not 10 (2026-11-13): with other programs holding the laptop's processor at 88 to 93 °C, a resume at 85 never came and the worker
# paused for hours; at 90 it resumes on the one thread the heat's share leaves it (budget.py), not on a full profile.
COOL_MARGIN_C: Final = 5.0
# Once hot, at least this long (2026-11-13: the laptop on battery at 90 to 95 °C paused and resumed about once a minute, a pause,
# a resume and two log lines each time): a step down holds two minutes, as the calm timer does for the way back to full.
HOT_HOLD_S: Final = 120.0
STEP_DOWN: Final[dict[Profile, Profile]] = {"full": "quiet", "quiet": "paused", "paused": "paused"}


@dataclass(frozen=True)
class Choice:
    """The owner's: the profile they chose in the admin's card, and whether work on a low battery is allowed. While `paused`: when the
    pause ends on its own (`until`, wall-clock epoch seconds; None: until Resume) and the profile it goes back to (`resume_to`)."""

    chosen: Chosen = "auto"
    battery_allowed: bool = False
    until: float | None = None
    resume_to: Chosen = "auto"


@dataclass(frozen=True)
class PolicyState:
    """The profile in force and why, when the last pressure ended (None: under pressure, or never was), and whether it runs hot."""

    active: Profile = "full"
    why: Why = "idle"
    calm_since: float | None = None
    hot: bool = False
    hot_since: float | None = None


def _hottest_gpu(signals: Signals) -> float:
    return max((gpu.temp_c for gpu in signals.gpus if gpu.temp_c is not None), default=0.0)


def is_hot(signals: Signals, was_hot: bool) -> bool:
    """Hot at the limits; once hot, until `COOL_MARGIN_C` below both."""
    cpu, gpu = signals.cpu.temp_c or 0.0, _hottest_gpu(signals)
    if was_hot:
        return cpu > CPU_HOT_C - COOL_MARGIN_C or gpu > GPU_HOT_C - COOL_MARGIN_C
    return cpu >= CPU_HOT_C or gpu >= GPU_HOT_C


def pressure(signals: Signals) -> Why | None:
    """Why auto must be quiet now, or None."""
    if signals.power.source == "battery":
        return "battery"
    if signals.idle_s is not None and signals.idle_s < ACTIVE_IDLE_S:
        return "user-active"
    return "others-busy" if signals.usage.others_cpu_pct > OTHERS_BUSY_PCT else None


def _auto(signals: Signals, before: PolicyState, now: float) -> PolicyState:
    why = pressure(signals)
    if why is not None:
        return replace(before, active="quiet", why=why, calm_since=None)
    if before.active == "full":
        return replace(before, why="idle", calm_since=None)
    return _calming(before, now)


def _calming(before: PolicyState, now: float) -> PolicyState:
    """No pressure after some: quiet (a pause lifts to quiet) until `CALM_S` have passed, then full."""
    calm_since = now if before.calm_since is None else before.calm_since
    if now - calm_since >= CALM_S:
        return replace(before, active="full", why="idle", calm_since=None)
    return replace(before, active="quiet", calm_since=calm_since)


def _chosen(signals: Signals, choice: Choice, before: PolicyState, now: float) -> PolicyState:
    if choice.chosen == "auto":
        return _auto(signals, before, now)
    return replace(before, active=choice.chosen, why="owner", calm_since=None)


def _battery_low(signals: Signals, choice: Choice) -> bool:
    power = signals.power
    low = power.source == "battery" and power.percent is not None and power.percent < LOW_BATTERY_PCT
    return low and not choice.battery_allowed


def _held_hot(signals: Signals, before: PolicyState, now: float) -> tuple[bool, float | None]:
    """Hot (`is_hot`), or still within `HOT_HOLD_S` of becoming hot; with when it became hot."""
    since = before.hot_since if before.hot else None
    if is_hot(signals, before.hot) or _holding(since, now):
        return True, now if since is None else since
    return False, None


def _holding(since: float | None, now: float) -> bool:
    return since is not None and now - since < HOT_HOLD_S


def decide(signals: Signals, choice: Choice, before: PolicyState, now: float) -> PolicyState:
    """The profile for this tick. `before` is the last tick's answer (its `active` excludes the thermal step, kept in `hot`)."""
    hot, hot_since = _held_hot(signals, before, now)
    state = replace(_chosen(signals, choice, before, now), hot=hot, hot_since=hot_since)
    if _battery_low(signals, choice) and choice.chosen != "paused":
        return replace(state, active="paused", why="battery")
    return state


def effective(state: PolicyState) -> tuple[Profile, Why]:
    """The profile in force: one level lower while hot (a pause stays a pause, with its own reason)."""
    if state.hot and (state.active, state.why) != ("paused", "owner"):
        return STEP_DOWN[state.active], "thermal"
    return state.active, state.why
