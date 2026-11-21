"""`/state`'s `machine` (`WorkerMachine` of @hcm/shared, docs/research/M26-governor.md §6): plain JSON, optional fields left out."""

from datetime import UTC, datetime

from hcm_pipeline.governor.backends import Backend
from hcm_pipeline.governor.budget import Budget
from hcm_pipeline.governor.policy import Choice, PolicyState
from hcm_pipeline.governor.signals import Gpu, Npu, Signals


def _some(**fields: object) -> dict[str, object]:
    return {key: value for key, value in fields.items() if value is not None}


def _gpu(gpu: Gpu) -> dict[str, object]:
    return _some(vendor=gpu.vendor, name=gpu.name, vramMb=gpu.vram_mb, why=gpu.why) | {"via": gpu.via}


def _npu(npu: Npu) -> dict[str, object]:
    return _some(vendor=npu.vendor, name=npu.name, why=npu.why) | {"via": npu.via}


def _usage(signals: Signals) -> dict[str, object]:
    usage, cards = signals.usage, signals.gpus
    busy = max((gpu.busy_pct for gpu in cards if gpu.busy_pct is not None), default=None)
    vram = sum(gpu.others_mb for gpu in cards) if cards else None
    return _some(
        cpuPct=usage.cpu_pct,
        othersCpuPct=usage.others_cpu_pct,
        memoryMb=usage.memory_mb,
        gpuPct=busy,
        vramMb=vram,
        tempC=signals.cpu.temp_c,
    )


def _iso(epoch: float | None) -> str | None:
    return None if epoch is None else datetime.fromtimestamp(epoch, UTC).isoformat().replace("+00:00", "Z")


def machine_record(signals: Signals, policy: PolicyState, choice: Choice, budget: Budget, backend: Backend) -> dict[str, object]:
    """The owner's `choice` says the profile chosen and, while paused for a while, when the pause ends (`until`)."""
    memory, power, chosen = signals.memory, signals.power, choice.chosen
    return {
        "cpu": {"cores": signals.cpu.cores},
        "memory": _some(totalMb=memory.total_mb, availableMb=memory.available_mb, limitMb=memory.limit_mb),
        "power": _some(source=power.source, percent=power.percent),
        "gpus": [_gpu(each) for each in signals.gpus],
        "npus": [_npu(each) for each in signals.npus],
        "backend": backend.as_record(),
        "profile": _some(chosen=chosen, active=budget.profile, why=policy.why, until=_iso(choice.until) if chosen == "paused" else None),
        "budget": budget.as_record(),
        "usage": _usage(signals),
    }
