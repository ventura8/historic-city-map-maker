"""What reads the computer (docs/research/M26-governor.md §1): the `Probe` protocol, and the starter's host hints.

A container cannot see some of the host: the keyboard and mouse (how long the person has been away), the battery of a Windows or macOS
computer (Docker runs in a VM there), the graphics cards and NPUs Docker could pass to the sidecar. The starter file, which runs on the
host, writes those as `host-hints.json` in the worker's volume every few seconds (Linux: `loginctl`'s IdleSinceHint; Windows:
`GetLastInputInfo`; macOS: `HIDIdleTime`). Hints older than `HINTS_STALE_S` are ignored: a starter that stopped says nothing.
"""

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Protocol

from hcm_pipeline.governor.signals import Gpu, Npu, Power, PowerSource, Signals, Via

HINTS_FILE: Final = "host-hints.json"
HINTS_STALE_S: Final = 60.0


class Probe(Protocol):
    """One reading of the computer, at each tick."""

    def read(self) -> Signals: ...


@dataclass(frozen=True)
class HostHints:
    """What only the host can say; empty when the starter said nothing (recently)."""

    idle_s: float | None = None
    power: Power | None = None
    gpus: tuple[Gpu, ...] = ()
    npus: tuple[Npu, ...] = ()


def _number(value: object) -> float | None:
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) and value >= 0 else None


def _text(record: Mapping[str, object], key: str, default: str = "") -> str:
    value = record.get(key)
    return value if isinstance(value, str) else default


# A card's name is a model's, one short line: a longer text, an empty one or one with a line break is a command's message (lesson of
# 2026-11-13: an older starter put nvidia-smi's failure on a computer without NVIDIA's driver in `name`), so the card is dropped.
NAME_MAX: Final = 120


def _named(record: Mapping[str, object]) -> bool:
    name = record.get("name")
    return isinstance(name, str) and 0 < len(name) <= NAME_MAX and "\n" not in name


VIAS: Final[dict[object, Via]] = {"cuda": "cuda", "rocm": "rocm", "openvino": "openvino"}
SOURCES: Final[dict[object, PowerSource]] = {"ac": "ac", "battery": "battery", "unknown": "unknown"}


def _via(record: Mapping[str, object]) -> Via | None:
    return VIAS.get(record.get("via"))


def _power(value: object) -> Power | None:
    if not isinstance(value, dict):
        return None
    source = SOURCES.get(value.get("source"))
    percent = _number(value.get("percent"))
    if source is None:
        return None
    return Power(source, None if percent is None else int(percent))


def _gpu(record: Mapping[str, object]) -> Gpu:
    vram, others, busy = (int(_number(record.get(key)) or 0) for key in ("vramMb", "othersMb", "busyPct"))
    return Gpu(
        _text(record, "vendor", "unknown"),
        _text(record, "name", "unknown"),
        vram,
        others,
        _via(record),
        _text(record, "why") or None,
        busy if "busyPct" in record else None,
        _number(record.get("tempC")),
    )


def _npu(record: Mapping[str, object]) -> Npu:
    return Npu(_text(record, "vendor", "unknown"), _text(record, "name", "unknown"), _via(record), _text(record, "why") or None)


def _records(value: object) -> list[Mapping[str, object]]:
    return [each for each in value if isinstance(each, dict)] if isinstance(value, list) else []


def parse_hints(raw: Mapping[str, object], now: float) -> HostHints:
    """The hints of one file, or none when they are stale."""
    at = _number(raw.get("at"))
    if at is None or now - at > HINTS_STALE_S:
        return HostHints()
    gpus = tuple(_gpu(each) for each in filter(_named, _records(raw.get("gpus"))))
    npus = tuple(_npu(each) for each in _records(raw.get("npus")))
    return HostHints(_number(raw.get("idleS")), _power(raw.get("power")), gpus, npus)


def read_hints(folder: Path, clock: Callable[[], float]) -> HostHints:
    """`host-hints.json` of the worker's volume; any fault reads as no hints."""
    try:
        raw = json.loads((folder / HINTS_FILE).read_text(encoding="utf-8"))
    except OSError, ValueError:
        return HostHints()
    return parse_hints(raw, clock()) if isinstance(raw, dict) else HostHints()
