"""The Linux probe (docs/research/M26-governor.md §1): what the worker's container can read of the computer, plus the host hints.

- Cores (`os.cpu_count`, the host's: Docker's `--cpus` is a quota, not fewer cores) and the cgroup's `cpu.max` quota.
- Memory: `/proc/meminfo`'s MemTotal and MemAvailable, the cgroup's `memory.max` and `memory.current` (ours).
- Load: the host's `/proc/stat` between two ticks, minus our cgroup's `cpu.stat` usage: what everyone else uses. On Linux the
  container's `/proc/stat` is the host's; under Docker Desktop (Windows, macOS) it is only the VM's, which is all Docker's own work.
- `/sys/class/power_supply` (a battery discharging, its capacity) and `/sys/class/thermal` (the hottest processor zone).

Every file is optional: a missing or unreadable one reads as unknown, never as an error.
"""

import os
from collections.abc import Callable
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Final

from hcm_pipeline.governor.probe import HostHints, read_hints
from hcm_pipeline.governor.signals import MB, Cpu, Memory, Power, Signals, Usage

KB_PER_MB: Final = 1024
MILLI: Final = 1000.0
USEC: Final = 1_000_000.0
BUSY_FIELDS: Final = 8
IDLE_FIELDS: Final = (3, 4)
CPU_ZONES: Final = ("x86_pkg_temp", "cpu", "tcpu", "soc", "k10temp", "coretemp", "acpitz")
PERCENT: Final = 100.0
QUOTA_FIELDS: Final = 2
# USER_HZ: what `/proc/stat` counts in on every Linux the pipeline runs on.
TICKS_PER_S: Final = 100


def read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return None


def _int(text: str | None) -> int | None:
    """A whole number, or None."""
    try:
        return int(text) if text is not None else None
    except ValueError:
        return None


def meminfo(text: str | None) -> dict[str, int]:
    """`/proc/meminfo`'s fields in kB."""
    found: dict[str, int] = {}
    for line in (text or "").splitlines():
        name, _, rest = line.partition(":")
        value = _int(rest.split()[0]) if rest.split() else None
        if value is not None:
            found[name] = value
    return found


def cpu_quota(text: str | None) -> float | None:
    """`cpu.max` (`<quota> <period>` or `max <period>`) in cores."""
    parts = (text or "").split()
    quota, period = (_int(parts[0]), _int(parts[1])) if len(parts) == QUOTA_FIELDS else (None, None)
    return quota / period if quota and period else None


def _counts(words: list[str]) -> list[int]:
    try:
        return [int(each) for each in words]
    except ValueError:
        return []


def stat_jiffies(text: str | None) -> tuple[int, int] | None:
    """The host's (total, busy) jiffies from `/proc/stat`'s first line."""
    first = (text or "").partition("\n")[0]
    fields = _counts(first.split()[1 : BUSY_FIELDS + 1])
    if len(fields) < BUSY_FIELDS:
        return None
    total = sum(fields)
    return total, total - sum(fields[index] for index in IDLE_FIELDS)


def usage_usec(text: str | None) -> int | None:
    """Our cgroup's `cpu.stat` `usage_usec`."""
    for line in (text or "").splitlines():
        name, _, value = line.partition(" ")
        if name == "usage_usec":
            return _int(value)
    return None


def _battery(folder: Path) -> Power | None:
    if read_text(folder / "type") != "Battery" or read_text(folder / "status") != "Discharging":
        return None
    return Power("battery", _int(read_text(folder / "capacity")))


def power_of(root: Path) -> Power:
    """On battery when one discharges; on the mains when the computer has a supply; else unknown (a desktop VM, a server)."""
    supplies = sorted((root / "sys/class/power_supply").glob("*"))
    for folder in supplies:
        battery = _battery(folder)
        if battery is not None:
            return battery
    return Power("ac") if supplies else Power()


def _zone_temp(folder: Path) -> float | None:
    kind = (read_text(folder / "type") or "").lower()
    if not kind.startswith(CPU_ZONES):
        return None
    value = _int(read_text(folder / "temp"))
    return value / MILLI if value is not None else None


def cpu_temp(root: Path) -> float | None:
    """The hottest processor zone, in degrees Celsius."""
    temps = [each for each in map(_zone_temp, (root / "sys/class/thermal").glob("thermal_zone*")) if each is not None]
    return max(temps, default=None)


@dataclass(frozen=True)
class Sample:
    """One tick's counters: the host's jiffies (total, busy) and our cgroup's microseconds."""

    jiffies: tuple[int, int] | None
    ours_usec: int | None


def shares(before: Sample, now: Sample, ticks_per_s: int) -> tuple[float, float]:
    """(ours, others') percent of the whole machine between two samples; (0, 0) when either is unreadable."""
    total, busy = _delta(before.jiffies, now.jiffies)
    if total <= 0:
        return 0.0, 0.0
    host = PERCENT * busy / total
    ours_usec = max(0, (now.ours_usec or 0) - (before.ours_usec or 0))
    ours = min(host, PERCENT * ours_usec / USEC / (total / ticks_per_s))
    return round(ours, 1), round(host - ours, 1)


def _delta(before: tuple[int, int] | None, now: tuple[int, int] | None) -> tuple[int, int]:
    """(total, busy) jiffies between two readings; (0, 0) when either is missing."""
    if before is None or now is None:
        return 0, 0
    return now[0] - before[0], now[1] - before[1]


class LinuxProbe:
    """`Probe` over a root folder (`/`, or a test's fake tree) and the worker's volume, where the host hints are."""

    def __init__(self, root: Path, volume: Path, clock: Callable[[], float], cores: Callable[[], int | None] = os.cpu_count) -> None:
        self._root, self._volume, self._clock, self._cores = root, volume, clock, cores
        self.ticks_per_s = TICKS_PER_S
        self._sample = self.sample()

    def _file(self, name: str) -> str | None:
        return read_text(self._root / name)

    def sample(self) -> Sample:
        return Sample(stat_jiffies(self._file("proc/stat")), usage_usec(self._file("sys/fs/cgroup/cpu.stat")))

    def _memory(self) -> tuple[Memory, int]:
        info = meminfo(self._file("proc/meminfo"))
        limit = _int(self._file("sys/fs/cgroup/memory.max"))
        ours = _int(self._file("sys/fs/cgroup/memory.current")) or 0
        total = info.get("MemTotal", 0) // KB_PER_MB
        memory = Memory(total, info.get("MemAvailable", 0) // KB_PER_MB, limit // MB if limit else None)
        return memory, ours // MB

    def read(self) -> Signals:
        now = self.sample()
        ours_pct, others_pct = shares(self._sample, now, self.ticks_per_s)
        self._sample = now
        memory, ours_mb = self._memory()
        cpu = Cpu(self._cores() or 1, cpu_quota(self._file("sys/fs/cgroup/cpu.max")), cpu_temp(self._root))
        signals = Signals(cpu, memory, power_of(self._root), usage=Usage(ours_pct, others_pct, ours_mb))
        return merge(signals, read_hints(self._volume, self._clock))


def merge(signals: Signals, hints: HostHints) -> Signals:
    """The host's word where the container knows nothing: idle time, cards, NPUs, and the power of a computer it cannot see."""
    power = hints.power if hints.power is not None and signals.power.source == "unknown" else signals.power
    return replace(signals, power=power, gpus=hints.gpus, npus=hints.npus, idle_s=hints.idle_s)
