"""The governor's loop, the owner's choice, the gate and `/state`'s machine (docs/research/M26-governor.md §4, §6)."""

import json
import threading
from dataclasses import dataclass, field, replace
from pathlib import Path

import pytest
from hcm_pipeline.governor.actuate import Actuators, Gate, apply_gdal, idle_io, libc_syscall, lower_priority
from hcm_pipeline.governor.budget import budget_for
from hcm_pipeline.governor.governor import CHOICE_FILE, Governor, load_choice, owner_threads, steady
from hcm_pipeline.governor.policy import Choice
from hcm_pipeline.governor.signals import Cpu, Power, Signals, Usage
from hcm_pipeline.matcher.box import MatcherBudget

from tests.fakes.machines import LINUX_INTEL_ARC_NPU, LINUX_NVIDIA_CDI, SMALL_NO_GPU
from tests.fakes.world import FakeClock


@dataclass
class FakeProbe:
    signals: Signals
    fail: bool = False

    def read(self) -> Signals:
        if self.fail:
            raise OSError("gone")
        return self.signals


@dataclass
class Options:
    set: dict[str, str] = field(default_factory=dict)

    def __call__(self, key: str, value: str) -> None:
        self.set[key] = value


def _governor(tmp_path: Path, signals: Signals, clock: FakeClock | None = None) -> tuple[Governor, FakeProbe, Options, Gate]:
    probe, options, gate = FakeProbe(signals), Options(), Gate()
    return Governor(probe, tmp_path, Actuators(options, gate), clock=clock or FakeClock()), probe, options, gate


def test_a_tick_applies_the_budget_and_says_the_machine(tmp_path: Path) -> None:
    clock = FakeClock()
    governor, probe, options, _gate = _governor(tmp_path, LINUX_NVIDIA_CDI, clock)
    assert governor.machine() is None
    assert governor.budget is None
    governor.tick()
    options.set.clear()
    governor.tick()
    assert options.set == {}
    governor.tick()
    probe.signals = replace(LINUX_NVIDIA_CDI, idle_s=0.0)
    governor.tick()
    assert options.set == {"GDAL_NUM_THREADS": "4", "GDAL_CACHEMAX": "496", "HCM_GOVERNED_WARP_MB": "992"}
    probe.signals = LINUX_NVIDIA_CDI
    governor.tick()
    clock.now += 1000.0
    governor.tick()
    assert options.set == {"GDAL_NUM_THREADS": "14", "GDAL_CACHEMAX": "864", "HCM_GOVERNED_WARP_MB": "1728"}
    assert governor.machine() == {
        "cpu": {"cores": 16},
        "memory": {"totalMb": 30_720, "availableMb": 23_040},
        "power": {"source": "ac"},
        "gpus": [{"vendor": "nvidia", "name": "NVIDIA GeForce RTX 3080 Laptop GPU", "vramMb": 8192, "via": "cuda"}],
        "npus": [],
        "backend": {"matcher": "cuda"},
        "profile": {"chosen": "auto", "active": "full", "why": "idle"},
        "budget": {"threads": 14, "memoryMb": 13_824, "gpuFraction": 0.7},
        "usage": {"cpuPct": 0.0, "othersCpuPct": 0.0, "memoryMb": 0, "vramMb": 0},
    }


def test_the_quota_the_container_started_with_caps_the_cores_and_ours_never_does(tmp_path: Path) -> None:
    """The NUC's test slot: 16 cores, a quota of 8; the starter's own later `docker update --cpus 6` changes nothing."""
    slot = replace(LINUX_NVIDIA_CDI, cpu=Cpu(16, quota=8.0))
    governor, probe, *_ = _governor(tmp_path, slot)
    assert governor.tick().budget.threads == 6
    probe.signals = replace(slot, cpu=Cpu(16, quota=6.0))
    assert governor.tick().budget.threads == 6


def test_the_nuc_says_its_npu(tmp_path: Path) -> None:
    governor, *_ = _governor(tmp_path, LINUX_INTEL_ARC_NPU)
    governor.tick()
    machine = governor.machine()
    assert machine is not None
    assert machine["npus"] == [{"vendor": "intel", "name": "Core Ultra NPU", "via": "openvino"}]
    assert machine["backend"] == {"matcher": "cpu", "why": "no-image"}


def test_the_owners_choice_is_kept_in_the_volume(tmp_path: Path) -> None:
    governor, *_ = _governor(tmp_path, SMALL_NO_GPU)
    assert not governor.choose("turbo")
    assert governor.choose("quiet", battery_allowed=True)
    assert json.loads((tmp_path / CHOICE_FILE).read_text(encoding="utf-8")) == {"chosen": "quiet", "batteryAllowed": True}
    assert governor.choose("full")
    assert load_choice(tmp_path) == Choice("full", battery_allowed=True)
    machine = governor.machine()
    assert machine is not None
    assert machine["profile"] == {"chosen": "full", "active": "full", "why": "owner"}


def test_a_crash_mid_choice_write_leaves_the_old_governor_json_intact(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    governor, *_ = _governor(tmp_path, SMALL_NO_GPU)
    assert governor.choose("quiet", battery_allowed=True)

    def crash(_fd: int) -> None:
        raise OSError("power cut")

    monkeypatch.setattr("hcm_pipeline.durable.os.fsync", crash)
    with pytest.raises(OSError, match="power cut"):
        governor.choose("full", battery_allowed=False)

    assert json.loads((tmp_path / CHOICE_FILE).read_text(encoding="utf-8")) == {"chosen": "quiet", "batteryAllowed": True}
    assert load_choice(tmp_path) == Choice("quiet", battery_allowed=True)
    assert [item.name for item in tmp_path.iterdir()] == [CHOICE_FILE]


@pytest.mark.parametrize("text", ["{", "[]", '{"chosen": "x"}'])
def test_an_unreadable_choice_is_auto(tmp_path: Path, text: str) -> None:
    (tmp_path / CHOICE_FILE).write_text(text, encoding="utf-8")
    assert load_choice(tmp_path) == Choice()


def test_a_low_battery_closes_the_gate_and_the_mains_opens_it(tmp_path: Path) -> None:
    low = replace(LINUX_NVIDIA_CDI, power=Power("battery", 10))
    governor, probe, _options, gate = _governor(tmp_path, low)
    governor.tick()
    assert gate.paused
    machine = governor.machine()
    assert machine is not None
    assert machine["backend"] == {"matcher": "off", "why": "paused"}
    probe.signals = LINUX_NVIDIA_CDI
    governor.tick()
    assert not gate.paused


def test_a_busy_card_says_why_and_the_matcher_leaves_it(tmp_path: Path) -> None:
    busy = replace(LINUX_NVIDIA_CDI, gpus=(replace(LINUX_NVIDIA_CDI.gpus[0], others_mb=7000, busy_pct=83, temp_c=81.0),))
    governor, *_ = _governor(tmp_path, busy)
    assert governor.matcher_budget() == MatcherBudget()
    governor.tick()
    assert governor.matcher_budget() == MatcherBudget(14, 2048, 0.0, yield_gpu=True)
    machine = governor.machine()
    assert machine is not None
    assert machine["profile"] == {"chosen": "auto", "active": "full", "why": "gpu-busy"}
    assert machine["usage"] == {"cpuPct": 0.0, "othersCpuPct": 0.0, "memoryMb": 0, "gpuPct": 83, "vramMb": 7000}


@dataclass
class StoppingProbe:
    """Fails once, then reads and stops the loop."""

    stop: threading.Event
    reads: int = 0

    def read(self) -> Signals:
        self.reads += 1
        if self.reads == 1:
            raise OSError("gone")
        self.stop.set()
        return SMALL_NO_GPU


def test_the_loop_ticks_until_stopped_and_survives_a_fault(tmp_path: Path) -> None:
    stop = threading.Event()
    probe = StoppingProbe(stop)
    governor = Governor(probe, tmp_path, Actuators(Options(), Gate()), clock=lambda: 0.0)
    governor.tick_s = 0.0
    governor.run(stop)
    assert probe.reads == 2
    assert governor.machine() is not None


def test_the_gate_holds_until_resumed_or_stopped() -> None:
    times = iter([0.0, 7.0])
    gate = Gate(lambda: next(times))
    assert gate.hold(lambda: False) == 7.0
    gate.pause()
    gate.pause()
    stops = iter([False, True])
    assert Gate().hold(lambda: True) >= 0.0
    waited = Gate()
    waited.pause()
    assert waited.hold(lambda: next(stops)) >= 0.0
    threading.Timer(0.05, waited.resume).start()
    waited.hold(lambda: False)
    assert not waited.paused
    waited.resume()


def test_priority_and_gdal_settings() -> None:
    calls: list[tuple[int, ...]] = []

    def refused(_value: int) -> int:
        raise OSError("not permitted")

    def syscall(*arguments: int) -> int:
        calls.append(arguments)
        return 0

    lower_priority(refused, syscall, "x86_64")
    assert calls == [(251, 1, 0, 3 << 13)]
    lower_priority(lambda value: value, syscall, "riscv64")
    idle_io(lambda *_arguments: -1, "aarch64")
    assert len(calls) == 1
    assert libc_syscall(-1) == -1
    options = Options()
    apply_gdal(budget_for("paused", SMALL_NO_GPU), options)
    assert options.set == {}


def test_the_owners_thread_count_caps_every_profile(tmp_path: Path) -> None:
    """`HCM_WORKER_THREADS` (as `GDAL_NUM_THREADS`) stays the most the worker uses; anything else is no cap.

    Scenarios: S-A141-HAPPY
    """
    assert owner_threads({"GDAL_NUM_THREADS": "3"}) == 3
    assert owner_threads({"GDAL_NUM_THREADS": "ALL_CPUS"}) is None
    assert owner_threads({"GDAL_NUM_THREADS": "0"}) is None
    assert owner_threads({}) is None
    options = Options()
    threads: list[int] = []
    governor = Governor(FakeProbe(LINUX_NVIDIA_CDI), tmp_path, Actuators(options, Gate(), threads.append), 3, clock=FakeClock())
    governor.tick()
    assert options.set["GDAL_NUM_THREADS"] == "3"
    assert threads == [3]
    assert governor.matcher_budget().threads == 3
    roomy = Governor(FakeProbe(SMALL_NO_GPU), tmp_path, Actuators(Options(), Gate()), 3, clock=FakeClock())
    assert roomy.tick().budget.threads == 1


def test_the_log_says_a_change_of_state_only(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    """The laptop's worker logged "this computer: quiet (user-active), 4 threads, 5880 MB" every 5 s, the megabytes moving by tens."""
    governor, probe, _options, _gate = _governor(tmp_path, replace(LINUX_NVIDIA_CDI, idle_s=0.0))
    with caplog.at_level("INFO", logger="hcm_pipeline.governor"):
        for available in (23_040, 23_000, 22_950, 23_080, 22_990):
            probe.signals = replace(LINUX_NVIDIA_CDI, idle_s=0.0, memory=replace(LINUX_NVIDIA_CDI.memory, available_mb=available))
            governor.tick()
        probe.signals = replace(LINUX_NVIDIA_CDI, idle_s=0.0, cpu=Cpu(16, temp_c=96.0))
        governor.tick()
    said = [record.getMessage() for record in caplog.records if record.name == "hcm_pipeline.governor"]
    assert said == ["this computer: quiet (user-active), 4 threads, 7936 MB", "this computer: paused (thermal), 0 threads, 0 MB"]


def test_the_headroom_follows_heat_load_and_the_pause(tmp_path: Path) -> None:
    governor, probe, _options, _gate = _governor(tmp_path, LINUX_NVIDIA_CDI)
    assert governor.headroom() == 1.0
    governor.tick()
    assert governor.headroom() == 1.0
    probe.signals = replace(LINUX_NVIDIA_CDI, cpu=Cpu(16, temp_c=86.0), usage=Usage(others_cpu_pct=20.0))
    governor.tick()
    assert governor.headroom() == pytest.approx(0.6)
    probe.signals = replace(LINUX_NVIDIA_CDI, usage=Usage(others_cpu_pct=70.0))
    governor.tick()
    assert governor.headroom() == pytest.approx(0.3)
    probe.signals = replace(LINUX_NVIDIA_CDI, power=Power("battery", 10))
    governor.tick()
    assert governor.headroom() == 0.0


def test_a_thread_more_or_less_within_a_profile_is_not_a_change(tmp_path: Path) -> None:
    """The laptop (2026-11-13): 88 to 92 °C moved quiet's threads 1, 2, 3, 4 in turn, one log line and one quota change each."""
    governor, probe, _options, _gate = _governor(tmp_path, replace(LINUX_NVIDIA_CDI, cpu=Cpu(16, temp_c=85.0)))
    assert governor.tick().budget.threads == 9
    for temp, threads in ((84.0, 9), (86.0, 9), (83.0, 11), (87.0, 7), (86.5, 7)):
        probe.signals = replace(LINUX_NVIDIA_CDI, cpu=Cpu(16, temp_c=temp))
        assert governor.tick().budget.threads == threads
    probe.signals = replace(LINUX_NVIDIA_CDI, idle_s=0.0)
    assert governor.tick().budget.threads == 4
    assert steady(None, budget_for("full", LINUX_NVIDIA_CDI)).threads == 14
