"""The budget applied (docs/research/M26-governor.md §4): inside the worker's process; the starter applies the container's CPU quota.

- At start, `idle_io`: the idle I/O class; the worker's command has niced the process already (`HCM_WORKER_NICE`, 10), so the
  person's programs always go first, whatever the budget. `lower_priority` does both, for a process nothing niced (the load test).
- At each change, `apply_budget`: GDAL's thread count (also the tile step's `num-threads` and the rim's compression), its block cache
  and the warp's memory (`rasters.warp_memory_mb` takes the least of it and the machine's), and OpenCV's threads.
- `Gate`: paused, a running step's next checkpoint or GDAL progress call waits until the profile allows work again. Its memory stays
  held, its processor time drops to nothing, and the time it waited is added to the step's time limit (`jobs.RunFlags`).
- Outside: the starter (`hcm-worker.sh`, `.bat`) runs `docker update --cpus <threads>` when the budget's threads change; the cgroup's
  `cpu.max` the probe reads back is the proof it took.
"""

import ctypes
import os
import platform
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Final

from hcm_pipeline.governor.budget import Budget
from hcm_pipeline.log import get_logger

LOG = get_logger("governor.actuate")
NICENESS: Final = 10
# `ioprio_set(IOPRIO_WHO_PROCESS, 0, IOPRIO_PRIO_VALUE(IOPRIO_CLASS_IDLE, 0))`: the class sits above bit 13; the call's number per
# architecture (the kernel's syscall tables).
IOPRIO_SET: Final = {"x86_64": 251, "aarch64": 30}
IOPRIO_WHO_PROCESS: Final = 1
IDLE_IO_PRIORITY: Final = 3 << 13
WAIT_S: Final = 1.0
THREADS_OPTION: Final = "GDAL_NUM_THREADS"
CACHE_OPTION: Final = "GDAL_CACHEMAX"
WARP_OPTION: Final = "HCM_GOVERNED_WARP_MB"


def libc_syscall(number: int, *arguments: int) -> int:
    """libc's `syscall`; -1 where there is no libc to call."""
    try:
        return int(ctypes.CDLL(None, use_errno=True).syscall(number, *arguments))
    except OSError, AttributeError:
        return -1


def idle_io(syscall: Callable[..., int] = libc_syscall, machine: str = platform.machine()) -> None:
    """The idle I/O class (`ioprio_set`, as `ionice -c 3` does), a priority only: nothing fails without it."""
    number = IOPRIO_SET.get(machine)
    if number is None or syscall(number, IOPRIO_WHO_PROCESS, 0, IDLE_IO_PRIORITY) != 0:
        LOG.info("the worker keeps the usual I/O priority (no idle class on this system)")


def lower_priority(
    nice: Callable[[int], int] = os.nice, syscall: Callable[..., int] = libc_syscall, machine: str = platform.machine()
) -> None:
    """Nice 10 and the idle I/O class: a process the worker's command did not nice already (the load test's)."""
    try:
        nice(NICENESS)
    except OSError as error:
        LOG.warning("the worker could not lower its priority: %s", error)
    idle_io(syscall, machine)


def apply_gdal(budget: Budget, set_option: Callable[[str, str], None]) -> None:
    """GDAL's threads and cache under the budget; a paused budget leaves them (the step waits at the gate instead)."""
    if budget.threads == 0:
        return
    set_option(THREADS_OPTION, str(budget.threads))
    set_option(CACHE_OPTION, str(budget.gdal_cache_mb))
    set_option(WARP_OPTION, str(budget.warp_mb))


def apply_budget(budget: Budget, actuators: Actuators) -> None:
    """GDAL's settings and OpenCV's threads under the budget; a paused one leaves them."""
    apply_gdal(budget, actuators.set_option)
    if budget.threads:
        actuators.set_threads(budget.threads)


class Gate:
    """Open while work is allowed; `hold` waits while it is closed, unless the run must stop."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._open = threading.Event()
        self._open.set()
        self._clock = clock

    @property
    def paused(self) -> bool:
        return not self._open.is_set()

    def pause(self) -> None:
        if not self.paused:
            LOG.info("the worker pauses: the running step waits until this computer has room again")
        self._open.clear()

    def resume(self) -> None:
        if self.paused:
            LOG.info("the worker resumes")
        self._open.set()

    def hold(self, stopping: Callable[[], bool]) -> float:
        """Seconds waited at the gate (0 when it was open)."""
        started = self._clock()
        while self.paused and not stopping():
            self._open.wait(WAIT_S)
        return self._clock() - started


# The process's gate: the worker's governor closes it, every run's checkpoints wait at it.
GATE: Final = Gate()


@dataclass(frozen=True)
class Actuators:
    """Where the budget goes: GDAL's settings, OpenCV's threads (`cv2.setNumThreads`) and the process's gate."""

    set_option: Callable[[str, str], None]
    gate: Gate = GATE
    set_threads: Callable[[int], None] = lambda _threads: None
