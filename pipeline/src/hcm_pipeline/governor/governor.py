"""The governor's loop (docs/research/M26-governor.md): every `TICK_S` it reads the computer, picks the profile, sizes the budget,
applies it and keeps what `/state` says of this computer (`machine`, `WorkerMachine` of @hcm/shared).

The owner's choice (`POST /profile` from the admin's "This computer" card) is kept in the worker's volume, `governor.json`: it stays on
this computer, never in Firestore, and survives a restart or an update of the worker. Pause this computer (the owner's request of
2026-11-13; `worker/pausing.py`) makes the choice `paused`, with when it ends on its own (`until`) and the profile it goes back to
(`resumeTo`); a tick past `until` resumes by itself. The pause itself is the server's (`cities/{city}/workers/{id}.paused`): the worker
mirrors it here so the processor, memory and card are freed and `/state` says so.
"""

import json
import math
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Final

from hcm_pipeline.durable import write_json_atomic
from hcm_pipeline.governor.actuate import Actuators, apply_budget
from hcm_pipeline.governor.backends import IMAGES, Backend, Matcher, choose
from hcm_pipeline.governor.budget import Budget, budget_for, thermal_share
from hcm_pipeline.governor.policy import TICK_S, Choice, PolicyState, decide, effective
from hcm_pipeline.governor.probe import Probe
from hcm_pipeline.governor.record import machine_record
from hcm_pipeline.governor.signals import Chosen, Signals, Why
from hcm_pipeline.log import get_logger
from hcm_pipeline.matcher.box import MatcherBudget

LOG = get_logger("governor")
CHOICE_FILE: Final = "governor.json"
CHOICES: Final[dict[object, Chosen]] = {"auto": "auto", "quiet": "quiet", "full": "full"}
# What `governor.json` may say: the three profiles, and the owner's pause (never chosen through `choose`).
KEPT: Final[dict[object, Chosen]] = {**CHOICES, "paused": "paused"}
# The owner's own thread count (the starter's `HCM_WORKER_THREADS`, passed as `GDAL_NUM_THREADS`): no profile goes above it.
THREADS_ENV: Final = "GDAL_NUM_THREADS"


def owner_threads(env: Mapping[str, str]) -> int | None:
    """The threads the owner set for the worker (a positive number), else None."""
    text = env.get(THREADS_ENV, "")
    return int(text) if text.isdigit() and int(text) > 0 else None


def load_choice(volume: Path) -> Choice:
    """The owner's last choice; auto when there is none (or it is unreadable)."""
    try:
        raw = json.loads((volume / CHOICE_FILE).read_text(encoding="utf-8"))
    except OSError, ValueError:
        return Choice()
    if not isinstance(raw, dict):
        return Choice()
    until = raw.get("until")
    return Choice(
        KEPT.get(raw.get("chosen"), "auto"),
        raw.get("batteryAllowed") is True,
        float(until) if isinstance(until, int | float) else None,
        CHOICES.get(raw.get("resumeTo"), "auto"),
    )


def _kept(choice: Choice) -> dict[str, object]:
    """`governor.json`'s content: the choice, and while paused its end and the profile it goes back to."""
    kept: dict[str, object] = {"chosen": choice.chosen, "batteryAllowed": choice.battery_allowed}
    if choice.chosen == "paused":
        kept |= {"resumeTo": choice.resume_to, **({"until": choice.until} if choice.until is not None else {})}
    return kept


@dataclass(frozen=True)
class Reading:
    """One tick's outcome."""

    signals: Signals
    policy: PolicyState
    why: Why
    budget: Budget
    backend: Backend


def _said(reading: Reading) -> tuple[str, str, int]:
    """What changes a log line: the profile, its reason and the threads (lesson of 2026-11-13: a line every 5 s, for ever, because the
    memory budget moved by a few megabytes each tick; the line still says the memory)."""
    return reading.budget.profile, reading.why, reading.budget.threads


# The threads the heat and others' load leave move by a degree's worth almost every tick (the laptop, 2026-11-13: 1, 2, 3, 4 threads
# in turn, a log line and a `docker update` each): within one profile a change of fewer than `THREAD_STEP` threads is not made.
THREAD_STEP: Final = 2


def steady(before: Budget | None, budget: Budget) -> Budget:
    """`budget`, keeping the last budget's threads while the profile is the same and they moved by less than `THREAD_STEP`."""
    if before is None or before.profile != budget.profile or abs(budget.threads - before.threads) >= THREAD_STEP:
        return budget
    return replace(budget, threads=before.threads, tile_processes=min(budget.tile_processes, before.threads))


def headroom_of(reading: Reading) -> float:
    """0 to 1: how much room this computer has for another job now, by its heat and other programs' load (0 while paused)."""
    if reading.budget.profile == "paused":
        return 0.0
    signals = reading.signals
    return min(thermal_share(signals.cpu.temp_c), max(0.0, 1 - signals.usage.others_cpu_pct / 100))


class Governor:
    def __init__(
        self,
        probe: Probe,
        volume: Path,
        actuators: Actuators,
        max_threads: int | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._probe, self._volume, self._actuators, self._clock = probe, volume, actuators, clock
        # The wall clock a timed pause ends by (`Choice.until`); the tests set their own.
        self.wall: Callable[[], float] = time.time
        self._max_threads = max_threads
        self._lock = threading.Lock()
        self._choice = load_choice(volume)
        self._reading: Reading | None = None
        self.images: frozenset[Matcher] = IMAGES
        self.tick_s = TICK_S
        self._cap: float | None = None

    @property
    def choice(self) -> Choice:
        with self._lock:
            return self._choice

    @property
    def budget(self) -> Budget | None:
        with self._lock:
            return None if self._reading is None else self._reading.budget

    def choose(self, chosen: object, battery_allowed: object = None) -> bool:
        """The owner's profile (and, when given, work on a low battery), kept in the volume; False for anything else."""
        found = CHOICES.get(chosen)
        if found is None:
            return False
        with self._lock:
            before = self._choice
        allowed = battery_allowed if isinstance(battery_allowed, bool) else before.battery_allowed
        # While paused, the profile chosen is the one the computer goes back to on Resume.
        paused = before.chosen == "paused"
        self._set(replace(before, battery_allowed=allowed, resume_to=found) if paused else Choice(found, allowed))
        LOG.info("the owner chose the %s profile for this computer", found)
        self.tick()
        return True

    @property
    def owner_paused(self) -> bool:
        """True while the owner's pause holds this computer (Pause this computer)."""
        return self.choice.chosen == "paused"

    def pause(self, until: float | None) -> None:
        """Pause this computer: no processor, memory or card for the worker, until Resume or `until` (wall-clock epoch seconds)."""
        with self._lock:
            before = self._choice
        resume_to = before.resume_to if before.chosen == "paused" else before.chosen
        self._set(Choice("paused", before.battery_allowed, until, resume_to))
        LOG.info("this computer is paused by its owner%s", "" if until is None else " for a while")
        self.tick()

    def resume(self) -> None:
        """The profile chosen before the pause again; nothing when it is not paused."""
        if self._resumed():
            self.tick()

    def _resumed(self) -> bool:
        with self._lock:
            before = self._choice
        if before.chosen != "paused":
            return False
        self._set(Choice(before.resume_to, before.battery_allowed))
        LOG.info("this computer is resumed: back to the %s profile", before.resume_to)
        return True

    def _expire(self) -> None:
        """A timed pause past its end resumes by itself."""
        until = self.choice.until
        if self.owner_paused and until is not None and self.wall() >= until:
            self._resumed()

    def _set(self, choice: Choice) -> None:
        with self._lock:
            self._choice = choice
        write_json_atomic(self._volume / CHOICE_FILE, _kept(choice))

    def _capped(self, signals: Signals) -> Signals:
        """The cores within the quota the container started with (the slot of a shared machine, a `--cpus` the owner set): the starter's
        own `docker update` comes later and only lowers it, so the first quota read is the cap, never one of ours."""
        if self._cap is None:
            self._cap = signals.cpu.quota or float(signals.cpu.cores)
        cores = max(1, min(signals.cpu.cores, math.floor(self._cap)))
        return replace(signals, cpu=replace(signals.cpu, cores=cores))

    def _owners(self, budget: Budget) -> Budget:
        """The budget within the owner's own thread count, when there is one."""
        cap = self._max_threads
        if cap is None or budget.threads <= cap:
            return budget
        return replace(budget, threads=cap, tile_processes=min(budget.tile_processes, cap))

    def _read(self, before: Reading | None) -> Reading:
        signals = self._capped(self._probe.read())
        policy = decide(signals, self.choice, PolicyState() if before is None else before.policy, self._clock())
        profile, why = effective(policy)
        budget = steady(None if before is None else before.budget, self._owners(budget_for(profile, signals)))
        backend = choose(signals, budget, self.images)
        return Reading(signals, policy, "gpu-busy" if why == "idle" and backend.why == "gpu-busy" else why, budget, backend)

    def tick(self) -> Reading:
        """One reading, applied (a timed pause past its end resumed first)."""
        self._expire()
        with self._lock:
            before = self._reading
        reading = self._read(before)
        self._changed(before, reading)
        self._gate(reading.budget.profile == "paused")
        with self._lock:
            self._reading = reading
        return reading

    def _changed(self, before: Reading | None, reading: Reading) -> None:
        """A log line when the state changed; the budget applied when it changed."""
        if before is None or _said(before) != _said(reading):
            LOG.info("this computer: %s (%s), %d threads, %d MB", *_said(reading), reading.budget.memory_mb)
        if before is None or before.budget != reading.budget:
            apply_budget(reading.budget, self._actuators)

    def _gate(self, paused: bool) -> None:
        gate = self._actuators.gate
        if paused:
            gate.pause()
        else:
            gate.resume()

    def matcher_budget(self) -> MatcherBudget:
        """Each matcher request's budget: the profile's threads and keypoints, the card's share, or the card left alone."""
        with self._lock:
            reading = self._reading
        if reading is None:
            return MatcherBudget()
        budget, backend = reading.budget, reading.backend
        held = backend.matcher == "cpu" and backend.why == "gpu-busy"
        return MatcherBudget(budget.threads, budget.keypoints or 1, backend.gpu_fraction, held)

    def headroom(self) -> float:
        """The last reading's headroom (`headroom_of`); 1 before the first tick. The claim's pace reads it (`worker/pace.py`)."""
        with self._lock:
            reading = self._reading
        return 1.0 if reading is None else headroom_of(reading)

    def machine(self) -> dict[str, object] | None:
        """`/state`'s `machine`; None before the first tick."""
        with self._lock:
            reading, choice = self._reading, self._choice
        if reading is None:
            return None
        policy = replace(reading.policy, why=reading.why)
        return machine_record(reading.signals, policy, choice, reading.budget, reading.backend)

    def run(self, stop: threading.Event) -> None:
        """Ticks until `stop`; a fault in one tick is logged and the next one tries again."""
        while not stop.is_set():
            try:
                self.tick()
            except (OSError, ValueError) as error:
                LOG.warning("the governor's tick failed: %s", error)
            stop.wait(self.tick_s)
