"""A profile turned into numbers (docs/research/M26-governor.md §4). Pure: the same signals and profile give the same budget.

| | full | quiet | paused |
| --- | --- | --- | --- |
| threads | max(1, cores - reserve) | max(1, cores // 4) | 0 (the step waits) |
| memory | 60 % of what is free to us | 35 % | 0 |
| GPU fraction | 0.7 | 0.4 | 0 |

The reserve is one core, two from 8 cores on: the person at the computer always keeps one. What is free to us is the machine's
available memory plus what the worker holds already (else the budget would shrink as the worker grows, and flap), within the container's
limit. GDAL's block cache and the warper's memory are `rasters.gdal_memory` of the budget (a sixteenth and an eighth, at most 1,024 and
2,048 MB: the measured savings of reports/resource-audit.md, never more); the tile processes are `steps/pyramid.tile_processes`'s rule,
a quarter of the budget at `TILE_PROCESS_MB` each, at most the threads.

Before the thermal limit (2026-11-13: the laptop's worker paused for hours at 93 to 96 °C beside a local model, pytest and Prettier),
the threads shrink smoothly: full share up to `WARM_C`, then in proportion to the degrees left to the policy's `CPU_HOT_C`, at least
one thread; and other programs' load takes its cores off the top (the person's own work counts as theirs, not ours). The memory is
counted in `MEMORY_STEP_MB` steps, so the few megabytes that come and go every tick never change the budget (nor log a line).
"""

import math
from dataclasses import dataclass
from typing import Final

from hcm_pipeline.governor.policy import CPU_HOT_C
from hcm_pipeline.governor.signals import Gpu, Profile, Signals
from hcm_pipeline.rasters import gdal_memory

MEMORY_SHARE: Final[dict[Profile, float]] = {"full": 0.60, "quiet": 0.35, "paused": 0.0}
GPU_FRACTION: Final[dict[Profile, float]] = {"full": 0.7, "quiet": 0.4, "paused": 0.0}
# Quiet keeps the full keypoints: 1,024 lost F006 on Fetești on the NUC (2026-11-13), so quiet is slower, never less accurate.
KEYPOINTS: Final[dict[Profile, int]] = {"full": 2048, "quiet": 2048, "paused": 0}
BIG_MACHINE_CORES: Final = 8
QUIET_DIVISOR: Final = 4
# `steps/pyramid.py`: a tile process holds about 170 MB; a quarter of the memory at 256 MB each.
TILE_SHARE_DIVISOR: Final = 4
TILE_PROCESS_MB: Final = 256
MATCHER_NEED_MB: Final = 2048
# Where the threads start to shrink with heat: 15 °C under the step-down, so the worker's own share falls before the limit.
WARM_C: Final = 80.0
MEMORY_STEP_MB: Final = 256


@dataclass(frozen=True)
class Budget:
    """What the worker may use under one profile."""

    profile: Profile
    threads: int
    memory_mb: int
    gpu_fraction: float
    gdal_cache_mb: int
    warp_mb: int
    tile_processes: int
    keypoints: int

    def as_record(self) -> dict[str, object]:
        """The part `/state` says (`budget` of `WorkerMachine`)."""
        return {"threads": self.threads, "memoryMb": self.memory_mb, "gpuFraction": self.gpu_fraction}


def reserve(cores: int) -> int:
    """The cores left to the person at the computer."""
    return 2 if cores >= BIG_MACHINE_CORES else 1


def threads_for(profile: Profile, cores: int) -> int:
    if profile == "paused":
        return 0
    if profile == "quiet":
        return max(1, cores // QUIET_DIVISOR)
    return max(1, cores - reserve(cores))


def thermal_share(temp_c: float | None) -> float:
    """1 up to `WARM_C`, then down to 0 at `CPU_HOT_C`: the share of the profile's threads heat leaves."""
    if temp_c is None or temp_c <= WARM_C:
        return 1.0
    return max(0.0, (CPU_HOT_C - temp_c) / (CPU_HOT_C - WARM_C))


def others_cores(signals: Signals) -> int:
    """The cores other programs keep busy now, rounded up."""
    return math.ceil(signals.cpu.cores * signals.usage.others_cpu_pct / 100)


def headroom_threads(profile: Profile, signals: Signals) -> int:
    """The profile's threads within the heat's share and beside other programs' load; one at least, unless paused."""
    base = threads_for(profile, signals.cpu.cores)
    if base == 0:
        return 0
    cores = signals.cpu.cores
    room = cores - reserve(cores) - others_cores(signals)
    return max(1, min(math.floor(base * thermal_share(signals.cpu.temp_c)), room))


def memory_for(profile: Profile, signals: Signals) -> int:
    """MiB: the profile's share of what is free to us in whole `MEMORY_STEP_MB` steps, never above the container's limit."""
    free = signals.memory.available_mb + signals.usage.memory_mb
    share = int(free * MEMORY_SHARE[profile])
    stepped = share - share % MEMORY_STEP_MB
    limit = signals.memory.limit_mb
    return stepped if limit is None else min(stepped, limit)


def budget_for(profile: Profile, signals: Signals) -> Budget:
    threads = headroom_threads(profile, signals)
    memory = memory_for(profile, signals)
    gdal = gdal_memory(memory) if memory else None
    tiles = max(1, min(threads, memory // TILE_SHARE_DIVISOR // TILE_PROCESS_MB)) if threads else 0
    cache, warp = (gdal.cache_mb, gdal.warp_mb) if gdal else (0, 0)
    return Budget(profile, threads, memory, GPU_FRACTION[profile], cache, warp, tiles, KEYPOINTS[profile])


def gpu_room(gpu: Gpu, fraction: float, need_mb: int = MATCHER_NEED_MB) -> bool:
    """Whether the matcher may use this card now: what other processes leave, and our fraction of it, both hold what it needs. A card
    that shares the computer's memory (an integrated one: `vram_mb` 0) is held by the memory budget instead."""
    if gpu.vram_mb == 0:
        return True
    free = gpu.vram_mb - gpu.others_mb
    return free >= need_mb and gpu.vram_mb * fraction >= need_mb
