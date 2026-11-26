"""The worker's disk: what each claim says of it and what the worker does with the server's answer (the owner, 2026-11-14:
"workers must not leave behind temp or unnecessary data"; docs/research/M7-local-worker.md *Disk: what the worker keeps*,
docs/research/M26-governor.md *Disk*).

Each `worker.claim` carries `disk` (the bytes of the work folder, the free bytes of its disk, and `DISK_FLOOR_BYTES`, under
which the server gives no job: `lowDisk`), once an hour `held` (the jobs whose scratch is here; the answer's `jobStates`
says which are finished for good), and `freed` (what the last Free space now gave back). Each pass then sweeps the work
folder (`sweep.py`) with the server's states. Free space now (the admin's button: `freeSpace`) and a disk under its floor
sweep at once, without the finished jobs' grace, but only with states the server gave within `FRESH_STATES_SECONDS`: a
failed job the owner retries since must not lose its scratch, so older states are first asked again.
"""

import shutil
import time
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

from hcm_pipeline import paths
from hcm_pipeline.log import get_logger
from hcm_pipeline.worker.local_store import LocalObjectStore
from hcm_pipeline.worker.sweep import HOUR_SECONDS, SweepRules, bytes_under, held_jobs

LOG = get_logger("worker.housekeeping")
GIGABYTE: Final = 1_000_000_000
# Under this many free bytes the worker takes no job (`lowDisk`) and frees what it can: a frame's scratch takes 6 to 12 GB.
DISK_FLOOR_BYTES: Final = 15 * GIGABYTE
# The most job ids one claim names (`held`, max 200 on the server).
HELD_MAX: Final = 200
HELD_EVERY_SECONDS: Final = HOUR_SECONDS
# Walking the work folder for its size is slow on a large one: once in this long.
MEASURE_EVERY_SECONDS: Final = 10 * 60
FRESH_STATES_SECONDS: Final = 10 * 60


def _iso(moment: float) -> str:
    return datetime.fromtimestamp(moment, UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _states_of(answer: Mapping[str, object]) -> dict[str, str] | None:
    raw = answer.get("jobStates")
    if not isinstance(raw, Mapping):
        return None
    return {str(job): state for job, state in raw.items() if isinstance(state, str)}


class Housekeeping:
    """One worker's disk duties; `claim_extra`, `answered` and `sweep` are the loop's hooks."""

    def __init__(self, root: Path, city_id: str, clock: Callable[[], float] = time.time) -> None:
        self._root, self._city, self._clock = root, city_id, clock
        self.floor_bytes = DISK_FLOOR_BYTES
        self.free_bytes: Callable[[], int] = lambda: shutil.disk_usage(root).free
        self._states: dict[str, str] = {}
        self._states_at = float("-inf")
        self._held_at = float("-inf")
        self._measured: tuple[float, int] | None = None
        self._asked_now = False
        self._freed: dict[str, object] | None = None

    def claim_extra(self) -> dict[str, object]:
        """`disk` always; `held` when the server's states are an hour old (or wanted now); `freed` once there is one."""
        now = self._clock()
        extra: dict[str, object] = {
            "disk": {"workBytes": self._work_bytes(now), "freeBytes": self.free_bytes(), "floorBytes": self.floor_bytes}
        }
        if now - self._held_at >= HELD_EVERY_SECONDS or self._wants_states(now):
            extra["held"] = held_jobs(self._root, self._city, HELD_MAX)
            self._held_at = now
        return extra if self._freed is None else {**extra, "freed": self._freed}

    def answered(self, answer: Mapping[str, object]) -> None:
        """The server's states of the jobs named, and Free space now when the admin asked for it."""
        states = _states_of(answer)
        if states is not None:
            self._states, self._states_at = states, self._clock()
        if answer.get("freeSpace") is True and not self._asked_now:
            LOG.info("the admin asked to free space now: finished jobs' files go at once")
            self._asked_now, self._held_at = True, float("-inf")
        if answer.get("lowDisk") is True:
            LOG.warning("less than %.0f GB is free on this computer's disk: no new job until there is room", self.floor_bytes / GIGABYTE)

    def sweep(self, claimed_job: str | None) -> None:
        """The pass's sweep; at once (no grace) for Free space now or a disk under its floor, with fresh states."""
        now = self._clock()
        before = self.free_bytes()
        now_mode = (self._asked_now or before < self.floor_bytes) and self._fresh(now)
        claimed = None if claimed_job is None else paths.work_prefix(self._city, claimed_job)
        LocalObjectStore(self._root).sweep(now, claimed, SweepRules(None, self._states, now_mode))
        if now_mode:
            self._swept_now(now, before)

    def _swept_now(self, now: float, before: int) -> None:
        """After a sweep without grace: the size is measured again, and an asked Free space now says what it freed."""
        self._measured = None
        if self._asked_now:
            freed = max(0, self.free_bytes() - before)
            self._freed, self._asked_now = {"bytes": freed, "at": _iso(now)}, False
            LOG.info("free space now: %.1f GB freed", freed / GIGABYTE)

    def _fresh(self, now: float) -> bool:
        return now - self._states_at < FRESH_STATES_SECONDS

    def _wants_states(self, now: float) -> bool:
        """Free space now, or a disk under its floor, with states too old to delete by: the next claim asks for them."""
        return (self._asked_now or self.free_bytes() < self.floor_bytes) and not self._fresh(now)

    def _work_bytes(self, now: float) -> int:
        if self._measured is None or now - self._measured[0] >= MEASURE_EVERY_SECONDS:
            self._measured = (now, bytes_under(self._root))
        return self._measured[1]
