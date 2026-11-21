"""The Linux probe over a fake tree, and the starter's host hints (docs/research/M26-governor.md §1)."""

import json
from pathlib import Path

from hcm_pipeline.governor.probe import HINTS_FILE, HINTS_STALE_S, HostHints, parse_hints, read_hints
from hcm_pipeline.governor.probe_linux import LinuxProbe, Sample, cpu_quota, meminfo, power_of, shares, stat_jiffies, usage_usec
from hcm_pipeline.governor.signals import Gpu, Npu, Power

from tests.fakes.world import FakeClock

GIB_KB = 1024 * 1024


def _write(root: Path, name: str, text: str) -> None:
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _tree(root: Path, busy: int, ours_usec: int) -> None:
    _write(root, "proc/stat", f"cpu  {busy} 0 0 {10_000 - busy} 0 0 0 0 0 0\ncpu0 1 2 3 4\n")
    _write(root, "sys/fs/cgroup/cpu.stat", f"usage_usec {ours_usec}\nuser_usec 1\n")


def _laptop(root: Path) -> None:
    _write(root, "proc/meminfo", f"MemTotal: {30 * GIB_KB} kB\nMemAvailable: {12 * GIB_KB} kB\nHugePages_Total: 0\nBroken:\n")
    _write(root, "sys/fs/cgroup/cpu.max", "400000 100000")
    _write(root, "sys/fs/cgroup/memory.max", str(18 * 1024**3))
    _write(root, "sys/fs/cgroup/memory.current", str(512 * 1024**2))
    _write(root, "sys/class/power_supply/AC/type", "Mains")
    _write(root, "sys/class/power_supply/BAT0/type", "Battery")
    _write(root, "sys/class/power_supply/BAT0/status", "Discharging")
    _write(root, "sys/class/power_supply/BAT0/capacity", "20")
    _write(root, "sys/class/thermal/thermal_zone0/type", "x86_pkg_temp")
    _write(root, "sys/class/thermal/thermal_zone0/temp", "91000")
    _write(root, "sys/class/thermal/thermal_zone1/type", "iwlwifi_1")
    _write(root, "sys/class/thermal/thermal_zone1/temp", "99000")


def test_the_laptop_on_battery_hot_and_shared(tmp_path: Path) -> None:
    root, volume = tmp_path / "root", tmp_path / "work"
    volume.mkdir()
    _laptop(root)
    _tree(root, 1000, 0)
    clock = FakeClock()
    probe = LinuxProbe(root, volume, clock, lambda: 16)
    # 10 000 jiffies later (100 core-seconds): the host 50 % busy, of which ours 16 s.
    _write(root, "proc/stat", "cpu  6000 0 0 14000 0 0 0 0\n")
    _write(root, "sys/fs/cgroup/cpu.stat", "usage_usec 16000000\n")
    _write(volume, HINTS_FILE, json.dumps({"at": clock.now, "idleS": 3, "gpus": [{"vendor": "nvidia", "name": "3080", "vramMb": 8192}]}))
    signals = probe.read()
    assert (signals.cpu.cores, signals.cpu.quota, signals.cpu.temp_c) == (16, 4.0, 91.0)
    assert (signals.memory.total_mb, signals.memory.available_mb, signals.memory.limit_mb) == (30_720, 12_288, 18_432)
    assert signals.power == Power("battery", 20)
    assert (signals.usage.cpu_pct, signals.usage.others_cpu_pct, signals.usage.memory_mb) == (16.0, 34.0, 512)
    assert signals.idle_s == 3.0
    assert signals.gpus == (Gpu("nvidia", "3080", 8192),)


def test_a_container_that_sees_nothing_reads_unknown(tmp_path: Path) -> None:
    signals = LinuxProbe(tmp_path, tmp_path, FakeClock(), lambda: None).read()
    assert (signals.cpu.cores, signals.cpu.quota, signals.cpu.temp_c) == (1, None, None)
    assert (signals.memory.total_mb, signals.memory.limit_mb) == (0, None)
    assert signals.power == Power()
    assert signals.idle_s is None


def test_the_mains_alone_reads_as_ac_and_hints_say_the_power_of_a_vm(tmp_path: Path) -> None:
    _write(tmp_path, "sys/class/power_supply/AC/type", "Mains")
    assert power_of(tmp_path) == Power("ac")
    vm = tmp_path / "vm"
    vm.mkdir()
    _write(vm, HINTS_FILE, json.dumps({"at": 0, "power": {"source": "battery", "percent": 55}}))
    clock = FakeClock()
    clock.now = 10.0
    assert LinuxProbe(vm, vm, clock).read().power == Power("battery", 55)


def test_the_counters_parse_and_guard() -> None:
    assert cpu_quota("max 100000") is None
    assert cpu_quota("50000 100000") == 0.5
    assert cpu_quota("") is None
    assert cpu_quota("x y") is None
    assert stat_jiffies("cpu 1 2") is None
    assert stat_jiffies(None) is None
    assert stat_jiffies("cpu 1 2 3 4 5 6 7 x") is None
    assert usage_usec("user_usec 3") is None
    assert meminfo("MemTotal: 10 kB\nOdd") == {"MemTotal": 10}
    assert shares(Sample(None, None), Sample((1, 1), 1), 100) == (0.0, 0.0)
    assert shares(Sample((5, 1), 1), Sample((5, 1), 1), 100) == (0.0, 0.0)
    assert shares(Sample((0, 0), None), Sample((100, 50), None), 100) == (0.0, 50.0)


def test_hints_parse_and_go_stale(tmp_path: Path) -> None:
    raw = {
        "at": 100,
        "idleS": 42,
        "power": {"source": "ac"},
        "gpus": [{"vendor": "intel", "name": "Arc", "vramMb": 0, "via": "openvino", "busyPct": 12, "tempC": 60}, "junk"],
        "npus": [{"vendor": "intel", "name": "NPU", "via": "openvino"}, {"via": "directml", "why": "no-passthrough"}],
    }
    hints = parse_hints(raw, 120)
    assert hints.idle_s == 42.0
    assert hints.power == Power("ac")
    assert hints.gpus == (Gpu("intel", "Arc", 0, 0, "openvino", None, 12, 60.0),)
    assert hints.npus == (Npu("intel", "NPU", "openvino"), Npu("unknown", "unknown", None, "no-passthrough"))
    assert parse_hints(raw, 100 + HINTS_STALE_S + 1) == HostHints()
    assert parse_hints({"at": True}, 0) == HostHints()
    assert parse_hints({"at": 0, "power": {"source": "solar"}}, 0).power is None
    assert parse_hints({"at": 0, "power": "ac"}, 0).power is None
    (tmp_path / HINTS_FILE).write_text("[1]", encoding="utf-8")
    assert read_hints(tmp_path, FakeClock()) == HostHints()
    (tmp_path / HINTS_FILE).write_text("{", encoding="utf-8")
    assert read_hints(tmp_path, FakeClock()) == HostHints()


def test_a_command_s_message_is_never_a_card_s_name() -> None:
    """The NUC (2026-11-13): an older starter wrote nvidia-smi's failure, and an empty second row, as two NVIDIA cards."""
    failure = "NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver. Make sure that the latest NVIDIA driver is"
    raw = {
        "at": 0,
        "gpus": [
            {"vendor": "nvidia", "name": failure + " installed and running.", "vramMb": 0, "via": None},
            {"vendor": "nvidia", "name": "", "vramMb": 0, "via": None},
            {"vendor": "nvidia", "name": "two\nlines", "vramMb": 0, "via": None},
            {"vendor": "nvidia", "vramMb": 0},
            {"vendor": "nvidia", "name": "GA104M [GeForce RTX 3080 Mobile]", "vramMb": 0, "via": None, "why": "no-driver"},
            {"vendor": "intel", "name": "Arrow Lake-P [Arc Pro 130T/140T]", "vramMb": 0, "via": "openvino"},
        ],
    }
    hints = parse_hints(raw, 0)
    assert [gpu.name for gpu in hints.gpus] == ["GA104M [GeForce RTX 3080 Mobile]", "Arrow Lake-P [Arc Pro 130T/140T]"]
    assert hints.gpus[0].why == "no-driver"
