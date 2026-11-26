"""Where the matcher runs (docs/research/M26-governor.md §5): CUDA, then ROCm, then OpenVINO on an Intel graphics card, then OpenVINO on
an NPU (ALIKED's extractor only, at a fixed size), then the light processor matcher.

A runtime counts only when the sidecar's image for it exists (`IMAGES`): a card the release has no image for says `no-image`, never a
promise. A card whose free memory (after other processes') or whose share under the budget cannot hold the matcher says `gpu-busy`: the
next request goes to the processor, or waits for the card (the yield rule). DirectML (Windows) and Core ML (macOS) need a native helper
Docker cannot host; on those computers the card says `no-passthrough`.
"""

from dataclasses import dataclass
from typing import Final, Literal

from hcm_pipeline.governor.budget import Budget, gpu_room
from hcm_pipeline.governor.signals import Gpu, Signals

Matcher = Literal["cuda", "rocm", "openvino-gpu", "openvino-npu", "cpu", "off"]
# The sidecar images this release ships (`matcher/images.json`): PyTorch with CUDA, and its processor path.
IMAGES: Final[frozenset[Matcher]] = frozenset({"cuda", "cpu"})
GPU_KIND: Final[dict[str, Matcher]] = {"cuda": "cuda", "rocm": "rocm", "openvino": "openvino-gpu"}
ORDER: Final[tuple[Matcher, ...]] = ("cuda", "rocm", "openvino-gpu")


@dataclass(frozen=True)
class Backend:
    """The matcher's place, why not a better one (None: the best there is), and the card's memory share for it."""

    matcher: Matcher
    why: str | None = None
    gpu_fraction: float = 0.0

    def as_record(self) -> dict[str, object]:
        return {"matcher": self.matcher, **({"why": self.why} if self.why else {})}


def _kind(gpu: Gpu) -> Matcher | None:
    return None if gpu.via is None else GPU_KIND[gpu.via]


def _rank(gpu: Gpu) -> int:
    kind = _kind(gpu)
    return ORDER.index(kind) if kind is not None else len(ORDER)


def _on_gpu(gpu: Gpu, budget: Budget, images: frozenset[Matcher]) -> Backend | str:
    """The card as the matcher's place, or why not."""
    kind = _kind(gpu)
    if kind is None:
        return gpu.why or "no-passthrough"
    if kind not in images:
        return "no-image"
    if not gpu_room(gpu, budget.gpu_fraction):
        return "gpu-busy"
    return Backend(kind, None, _share(gpu, budget.gpu_fraction))


def _share(gpu: Gpu, fraction: float) -> float:
    """The budget's fraction, never more than what other processes leave of the card (a shared-memory card: the fraction)."""
    if not gpu.vram_mb:
        return fraction
    return round(min(fraction, (gpu.vram_mb - gpu.others_mb) / gpu.vram_mb), 2)


def _on_npu(signals: Signals, images: frozenset[Matcher]) -> Backend | None:
    usable = any(npu.via == "openvino" for npu in signals.npus)
    return Backend("openvino-npu") if usable and "openvino-npu" in images else None


def choose(signals: Signals, budget: Budget, images: frozenset[Matcher] = IMAGES) -> Backend:
    """The best place the budget allows now."""
    if budget.profile == "paused":
        return Backend("off", "paused")
    why = "no-gpu"
    for gpu in sorted(signals.gpus, key=_rank):
        found = _on_gpu(gpu, budget, images)
        if isinstance(found, Backend):
            return found
        why = found
    return _on_npu(signals, images) or Backend("cpu", why)
