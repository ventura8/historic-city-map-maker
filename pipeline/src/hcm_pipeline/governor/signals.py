"""What the governor reads of the computer at one tick (docs/research/M26-governor.md §2): plain values, no I/O."""

from dataclasses import dataclass, field
from typing import Final, Literal

PowerSource = Literal["ac", "battery", "unknown"]
Via = Literal["cuda", "rocm", "openvino"]
Profile = Literal["full", "quiet", "paused"]
# `paused` (the owner's request of 2026-11-13): Pause this computer, from the admin or its own page; never from the profile switch.
Chosen = Literal["auto", "quiet", "full", "paused"]
Why = Literal["idle", "user-active", "others-busy", "battery", "thermal", "gpu-busy", "owner"]

MB: Final = 1024 * 1024


@dataclass(frozen=True)
class Power:
    """On the mains or on battery (and how full), or unknown: a desktop, or a container that cannot see it."""

    source: PowerSource = "unknown"
    percent: int | None = None


@dataclass(frozen=True)
class Gpu:
    """A graphics card: its memory, what other processes use of it now, and the runtime that can reach it (None: none can, `why`)."""

    vendor: str
    name: str
    vram_mb: int
    others_mb: int = 0
    via: Via | None = None
    why: str | None = None
    busy_pct: int | None = None
    temp_c: float | None = None


@dataclass(frozen=True)
class Npu:
    """A neural processor (Intel's NPU, Qualcomm's Hexagon, Apple's ANE) and the runtime that can reach it."""

    vendor: str
    name: str
    via: Via | None = None
    why: str | None = None


@dataclass(frozen=True)
class Cpu:
    """The processor: its logical cores, the cgroup's quota in cores (None: no quota), its hottest sensor."""

    cores: int
    quota: float | None = None
    temp_c: float | None = None


@dataclass(frozen=True)
class Memory:
    """MiB: the machine's, what it has free now, and the container's limit (None: none)."""

    total_mb: int
    available_mb: int
    limit_mb: int | None = None


@dataclass(frozen=True)
class Usage:
    """Busy shares in percent of the whole machine: ours (the worker's cgroup) and every other process's; our memory in MiB."""

    cpu_pct: float = 0.0
    others_cpu_pct: float = 0.0
    memory_mb: int = 0


@dataclass(frozen=True)
class Signals:
    """One tick's reading. `idle_s`: seconds since the last keyboard or mouse input on the host (None: unknown, never "active")."""

    cpu: Cpu
    memory: Memory
    power: Power = field(default_factory=Power)
    gpus: tuple[Gpu, ...] = ()
    npus: tuple[Npu, ...] = ()
    usage: Usage = field(default_factory=Usage)
    idle_s: float | None = None
