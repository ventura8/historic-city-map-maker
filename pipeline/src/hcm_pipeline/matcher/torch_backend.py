"""ALIKED + LightGlue on PyTorch, graphics card first (`docs/research/M10-local-ai.md`).

Imported only by the short-lived child that answers one request, so an idle sidecar holds no graphics memory. **A silent processor run
is impossible:** a process told to use the graphics card that finds none exits with `NO_GPU`, and the starter file probes again; the
processor runs only when the starter or an out-of-memory rerun says so, with the reason in the log.
"""

import hashlib
import importlib
import logging
import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Self

import numpy
import torch

from .box import UInt8Array

LOG = logging.getLogger("hcm-matcher")
NAME: Final = "aliked-lightglue"
NO_GPU: Final = 77
SMALL_GPU: Final = 76
OUT_OF_MEMORY: Final = 75
MATCHER_MIN_VRAM_GB: Final = 2
BYTES_PER_GB: Final = 1024**3
MAX_KEYPOINTS: Final = 2048
DETECTION_THRESHOLD: Final = 0.05
NMS_RADIUS: Final = 2
HASH_CHUNK: Final = 1024 * 1024
FULL: Final = 255.0
# Niceness of a processor run (the graphics card's needs none: the processor only feeds it).
CPU_NICE: Final = 10


class TamperedWeightsError(RuntimeError):
    """Weights whose hash is not their pin's."""


@dataclass(frozen=True)
class Device:
    """Where a run goes: PyTorch's name for it, the words for the admin."""

    kind: str
    torch_name: str
    name: str | None


def gpu_exit() -> int:
    """0 when PyTorch sees a graphics card with memory enough, else the exit code that says why not."""
    if not torch.cuda.is_available():
        return NO_GPU
    return 0 if torch.cuda.get_device_properties(0).total_memory >= MATCHER_MIN_VRAM_GB * BYTES_PER_GB else SMALL_GPU


def device_for(kind: str, threads: int = 0) -> Device:
    """The device asked for (on the processor, the governor's `threads`, else the cores but one); for the graphics card, `SystemExit`
    with `NO_GPU` or `SMALL_GPU` when there is none to use."""
    if kind == "cpu":
        # The governor's threads, else the cores but one, below the owner's own programs: the computer stays usable for the hour a
        # frame may take.
        threads = threads or max(1, (os.cpu_count() or 2) - 1)
        torch.set_num_threads(threads)
        os.nice(CPU_NICE)
        LOG.info("local AI: running on the processor, on %d threads, below the computer's other programs", threads)
        return Device("cpu", "cpu", None)
    code = gpu_exit()
    if code:
        LOG.error("local AI: told to use the graphics card, and PyTorch finds none it can use: exiting so the starter probes again")
        raise SystemExit(code)
    return Device("gpu", "cuda", torch.cuda.get_device_name(0))


def cap_gpu(fraction: float) -> None:
    """The governor's share of the card's memory for this process (docs/research/M26-governor.md §4); 0 leaves it uncapped."""
    if fraction > 0:
        torch.cuda.set_per_process_memory_fraction(fraction, 0)
        LOG.info("local AI: at most %d %% of the graphics card's memory", round(fraction * 100))


def checked_load(path: Path, pin: str) -> object:
    """Weights hashed against their pin, then loaded with no pickled code."""
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(HASH_CHUNK):
            digest.update(chunk)
    if digest.hexdigest() != pin:
        raise TamperedWeightsError(f"{path.name} does not match its pin")
    return torch.load(path, map_location="cpu", weights_only=True)


class Local:
    """`torch.hub.load_state_dict_from_url` answered from the volume: the sidecar has no network, and this is the only way in."""

    def __init__(self, weights: Path, pins: Mapping[str, str]) -> None:
        self._weights, self._pins = weights, pins
        self._real: object = None

    def __enter__(self) -> Self:
        self._real = torch.hub.load_state_dict_from_url
        torch.hub.load_state_dict_from_url = self._answer
        return self

    def __exit__(self, *_details: object) -> None:
        torch.hub.load_state_dict_from_url = self._real

    def _answer(self, url: str, **_options: object) -> object:
        name = url.rsplit("/", 1)[1]
        return checked_load(self._weights / name, self._pins[name])


class AlikedLightGlue:
    """The two networks, in evaluation mode, on one device."""

    def __init__(self, device: Device, weights: Path, pins: Mapping[str, str], keypoints: int = MAX_KEYPOINTS) -> None:
        # Only the sidecar's path holds it (`hcm-ai-files`, our own `__init__.py`, never upstream's: `docs/research/M10-local-ai.md`).
        lightglue = importlib.import_module("lightglue")
        self.device = device
        with Local(weights, pins):
            options = {
                "max_num_keypoints": min(keypoints, MAX_KEYPOINTS),
                "detection_threshold": DETECTION_THRESHOLD,
                "nms_radius": NMS_RADIUS,
            }
            self._extractor = lightglue.ALIKED(**options).eval().to(device.torch_name)
            self._matcher = lightglue.LightGlue(features="aliked").eval().to(device.torch_name)

    def extract(self, tile: UInt8Array) -> object:
        grey = numpy.repeat(tile[None], 3, 0).astype(numpy.float32) / FULL
        with torch.inference_mode():
            return self._extractor({"image": torch.from_numpy(grey).to(self.device.torch_name)[None]})

    def match(self, features: tuple[object, object], sizes: tuple[tuple[int, int], tuple[int, int]]) -> tuple[numpy.ndarray, numpy.ndarray]:
        first, second = features
        with torch.inference_mode():
            out = self._matcher({"image0": self._input(first, sizes[0]), "image1": self._input(second, sizes[1])})
        matches = out["matches"][0]
        return self._points(first, matches[:, 0]), self._points(second, matches[:, 1])

    def _input(self, features: object, size: tuple[int, int]) -> dict[str, object]:
        wide = torch.tensor([size[::-1]], device=self.device.torch_name, dtype=torch.float32)
        return {**_mapping(features), "image_size": wide}

    def _points(self, features: object, indices: object) -> numpy.ndarray:
        return numpy.asarray(_mapping(features)["keypoints"][0][indices].cpu().numpy(), numpy.float64)


def _mapping(features: object) -> dict[str, torch.Tensor]:
    if not isinstance(features, dict):
        raise TypeError("features that are no mapping")
    return features


def out_of_memory() -> type[BaseException]:
    """What PyTorch raises when the graphics card is full."""
    return torch.cuda.OutOfMemoryError


def free_memory() -> None:
    torch.cuda.empty_cache()
