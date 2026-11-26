"""Pause this computer (the owner's request of 2026-11-13; docs/research/M7-local-worker.md, *Pause*).

The pause is the server's (`cities/{city}/workers/{id}.paused`): the admin sets it with `imagery.pause`, and a person at this computer
with its own page (`POST /pause`), whose command travels with the worker's next `worker.claim` or `worker.end` (`pause`). The worker
mirrors what the claim's answer says (`paused`, or none) into the governor (`Governor.pause` / `resume`), which frees the processor,
memory and graphics card, and into `/state` (`paused`). While paused the loop claims every `pollSeconds` (a Resume in the admin is seen
within one poll) and a running job hands itself back at its next checkpoint (`asked_to_release`, `worker.end` `released`).

A command from the page applies here at once, before the server knows it: the claim that was already on its way when it came is not
mirrored (its answer predates the command), the next one carries it.
"""

import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Final, Protocol

# The longest a timed pause may last (`PAUSE_UNTIL_MAX_HOURS` of @hcm/shared): Until tomorrow at the latest.
PAUSE_UNTIL_MAX_S: Final = 48 * 3600
# Who paused it, as `/state` says: the person at this computer (`PAUSED_BY_COMPUTER` of @hcm/shared), or someone in the admin.
BY_COMPUTER: Final = "computer"
BY_ADMIN: Final = "admin"


class PauseTarget(Protocol):
    """What holds the computer while paused (`Governor`)."""

    def pause(self, until: float | None) -> None: ...

    def resume(self) -> None: ...


class NoTarget:
    """A worker without a governor (`HCM_GOVERNOR=off`, the tests): nothing to free."""

    def pause(self, until: float | None) -> None:
        return None

    def resume(self) -> None:
        return None


def iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, UTC).isoformat().replace("+00:00", "Z")


def epoch_of(value: object) -> float | None:
    """An ISO time with its zone as epoch seconds, else None."""
    if not isinstance(value, str):
        return None
    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        return None
    return moment.timestamp() if moment.tzinfo is not None else None


@dataclass(frozen=True)
class Command:
    """The page's command: `pause` (until `until`, epoch seconds, or Resume) or `resume`."""

    action: str
    until: float | None = None

    def wire(self) -> dict[str, object]:
        """`workerPauseCommandSchema` of @hcm/shared."""
        if self.action == "pause" and self.until is not None:
            return {"action": "pause", "until": iso(self.until)}
        return {"action": self.action}


def _until_ok(until: float | None, now: float) -> bool:
    return until is not None and now < until <= now + PAUSE_UNTIL_MAX_S


def parse_command(body: Mapping[str, object], now: float) -> Command | None:
    """`{action: 'pause', until?}` or `{action: 'resume'}`; None for anything else (an `until` not ISO, past, or over 48 h ahead)."""
    action = body.get("action")
    if action == "resume":
        return Command("resume")
    if action != "pause":
        return None
    if body.get("until") is None:
        return Command("pause")
    until = epoch_of(body.get("until"))
    return Command("pause", until) if _until_ok(until, now) else None


def _server_pause(answer: Mapping[str, object]) -> tuple[str, float | None] | None:
    """The claim's pause as (who, until): its `pause` (who, when, until when), else W5's bare `paused: true`; None when it says none."""
    value = answer.get("pause")
    if isinstance(value, dict):
        return BY_COMPUTER if value.get("by") == BY_COMPUTER else BY_ADMIN, epoch_of(value.get("until"))
    return (BY_ADMIN, None) if answer.get("paused") is True else None


class PauseControl:
    """The computer's pause as this worker knows it: the page's command not yet sent, and the server's pause mirrored."""

    def __init__(self, target: PauseTarget | None = None, clock: Callable[[], float] = time.time) -> None:
        self._lock = threading.Lock()
        self._clock = clock
        self._pending: Command | None = None
        self._paused: tuple[str, float | None] | None = None
        self.target: PauseTarget = target or NoTarget()
        # What a command from the page does besides: the loop's wait ends, so the server hears it now (`WorkerLoop.nudge`).
        self.woken: Callable[[], None] = lambda: None

    @property
    def paused(self) -> bool:
        """True while paused (a timed pause past its end no longer counts: the server clears it at the next claim)."""
        with self._lock:
            found = self._paused
        return found is not None and (found[1] is None or self._clock() < found[1])

    def pending(self) -> Command | None:
        """The page's command the next `worker.claim` or `worker.end` carries."""
        with self._lock:
            return self._pending

    def local(self, command: Command) -> None:
        """The page's command: applied here at once, and sent with the next call."""
        with self._lock:
            self._pending = command
            self._paused = (BY_COMPUTER, command.until) if command.action == "pause" else None
        if command.action == "pause":
            self.target.pause(command.until)
        else:
            self.target.resume()
        self.woken()

    def delivered(self, sent: Command | None) -> bool:
        """The server took `sent`: no longer pending, unless a newer command came meanwhile. False when one did."""
        with self._lock:
            if self._pending is not sent:
                return False
            self._pending = None
            return True

    def answered(self, sent: Command | None, answer: Mapping[str, object]) -> None:
        """A claim's answer: its `paused` mirrored, unless a newer command came while it was on its way."""
        if self.delivered(sent):
            self._mirror(_server_pause(answer))

    def _mirror(self, found: tuple[str, float | None] | None) -> None:
        with self._lock:
            before, self._paused = self._paused, found
        # Not paused: the governor resumes even with nothing mirrored before (a pause kept in `governor.json` the server since lifted).
        if found is None:
            self.target.resume()
        elif found != before:
            self.target.pause(found[1])

    def snapshot(self) -> dict[str, object] | None:
        """`/state`'s `paused`: `{by, until?}`, or None."""
        with self._lock:
            found = self._paused
        if found is None or not self.paused:
            return None
        by, until = found
        return {"by": by} if until is None else {"by": by, "until": iso(until)}
