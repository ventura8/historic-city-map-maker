"""Fake computers for the governor (docs/research/M26-governor.md §8): one `Signals` per system and vendor the product must meet.

The household machines prove the NVIDIA (laptop 3080), Intel Arc and NPU (NUC) and processor paths; the others exist here only: AMD
ROCm, WSL2 with an Intel or AMD card, Windows on ARM with Qualcomm, and Apple silicon are unproved on real hardware.
"""

from hcm_pipeline.governor.signals import Cpu, Gpu, Memory, Npu, Power, Signals

IDLE = 600.0


def machine(cores: int, total_mb: int, gpus: tuple[Gpu, ...] = (), npus: tuple[Npu, ...] = ()) -> Signals:
    """An idle computer on the mains, a quarter of its memory in use."""
    return Signals(Cpu(cores), Memory(total_mb, total_mb * 3 // 4, None), Power("ac"), gpus, npus, idle_s=IDLE)


RTX_3080 = Gpu("nvidia", "NVIDIA GeForce RTX 3080 Laptop GPU", 8192, via="cuda")
LINUX_NVIDIA_CDI = machine(16, 30_720, (RTX_3080,))
LINUX_AMD_ROCM = machine(12, 32_768, (Gpu("amd", "Radeon RX 7800 XT", 16_384, via="rocm"),))
# The NUC: an Arc 140T sharing the computer's memory (vram 0), a Core Ultra NPU.
LINUX_INTEL_ARC_NPU = machine(16, 30_720, (Gpu("intel", "Arc 140T", 0, via="openvino"),), (Npu("intel", "Core Ultra NPU", via="openvino"),))
SMALL_NO_GPU = machine(2, 4096)
WSL2_NVIDIA = machine(8, 16_384, (Gpu("nvidia", "RTX 4060", 8192, via="cuda"), Gpu("intel", "UHD 770", 0, why="no-passthrough")))
WINDOWS_ARM_QUALCOMM = machine(
    12, 16_384, (Gpu("qualcomm", "Adreno X1-85", 0, why="no-passthrough"),), (Npu("qualcomm", "Hexagon", why="no-passthrough"),)
)
MAC_APPLE_SILICON = machine(
    10, 16_384, (Gpu("apple", "M3", 0, why="no-passthrough"),), (Npu("apple", "Neural Engine", why="no-passthrough"),)
)
