"""The sidecar's PyTorch side (M10), with a fake `torch` and a fake `lightglue`: no gate needs a graphics card or weights."""

import hashlib
import importlib
import json
import runpy
import sys
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any, cast

import numpy
import pytest
from hcm_pipeline.matcher.box import ANSWER_SUFFIX, MatcherBudget, Request, read_answer, read_status, write_request

GB = 1024**3


class FakeOutOfMemoryError(RuntimeError):
    """`torch.cuda.OutOfMemoryError`."""


class Tensor:
    def __init__(self, values: numpy.ndarray) -> None:
        self.values = values

    def to(self, _device: str) -> Tensor:
        return self

    def cpu(self) -> Tensor:
        return self

    def numpy(self) -> numpy.ndarray:
        return self.values

    def __getitem__(self, index: object) -> Tensor:
        key = index.values if isinstance(index, Tensor) else index
        return Tensor(self.values[cast(Any, key)])


class NoGradients:
    def __enter__(self) -> None:
        return None

    def __exit__(self, *_details: object) -> None:
        return None


@dataclass
class FakeTorch:
    """What a test's world holds: a card or none, what `load` saw, what threads it was told."""

    available: bool = True
    memory: int = 10 * GB
    loads: list[dict[str, object]] = field(default_factory=list)
    threads: list[int] = field(default_factory=list)
    fractions: list[float] = field(default_factory=list)
    emptied: int = 0

    def module(self) -> ModuleType:
        module = ModuleType("torch")
        attributes = {
            "cuda": SimpleNamespace(
                is_available=lambda: self.available,
                get_device_properties=lambda _index: SimpleNamespace(total_memory=self.memory),
                get_device_name=lambda _index: "NVIDIA RTX 3080",
                empty_cache=self._empty,
                set_per_process_memory_fraction=lambda fraction, _index: self.fractions.append(fraction),
                OutOfMemoryError=FakeOutOfMemoryError,
            ),
            "hub": SimpleNamespace(load_state_dict_from_url=self._no_network),
            "load": self._load,
            "set_num_threads": self.threads.append,
            "inference_mode": NoGradients,
            "from_numpy": Tensor,
            "tensor": lambda data, device, dtype: Tensor(numpy.array(data)),
            "float32": "float32",
        }
        module.__dict__.update(attributes)
        return module

    def _empty(self) -> None:
        self.emptied += 1

    def _no_network(self, url: str, **_options: object) -> object:
        raise AssertionError(f"the network was asked for {url}")

    def _load(self, path: Path, map_location: str, weights_only: bool) -> object:
        self.loads.append({"name": Path(path).name, "map_location": map_location, "weights_only": weights_only})
        return {}


class Network:
    """A fake of ALIKED and LightGlue: each asks torch's hub for its weights when built, as the real ones do."""

    def __init__(self, torch: ModuleType, url: str, fail: BaseException | None) -> None:
        torch.hub.load_state_dict_from_url(url, map_location="cpu")
        self.fail = fail
        self.where = ""

    def eval(self) -> Network:
        return self

    def to(self, device: str) -> Network:
        self.where = device
        return self

    def __call__(self, data: dict[str, Any]) -> dict[str, Any]:
        if self.fail is not None:
            raise self.fail
        if "image" in data:
            return {"keypoints": Tensor(numpy.array([[[1.0, 2.0], [3.0, 4.0]]]))}
        return {"matches": Tensor(numpy.array([[[0, 1]]]))}


def lightglue_module(torch: ModuleType, fail: BaseException | None = None) -> ModuleType:
    module = ModuleType("lightglue")

    def aliked(**options: object) -> Network:
        assert options["max_num_keypoints"] in {1024, 2048}
        module.__dict__.setdefault("asked", []).append(options["max_num_keypoints"])
        return Network(torch, "https://example.invalid/models/aliked-n16.pth", None)

    def lightglue(features: str) -> Network:
        assert features == "aliked"
        return Network(torch, "https://example.invalid/aliked_lightglue.pth", fail)

    module.__dict__.update({"ALIKED": aliked, "LightGlue": lightglue})
    return module


@dataclass
class World:
    fake: FakeTorch
    torch: ModuleType
    backend: Any
    child: Any
    weights: Path
    box: Path
    root: Path


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@pytest.fixture
def world(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[World]:
    fake = FakeTorch()
    torch = fake.module()
    monkeypatch.setitem(sys.modules, "torch", torch)
    monkeypatch.setitem(sys.modules, "lightglue", lightglue_module(torch))
    for name in ("hcm_pipeline.matcher.torch_backend", "hcm_pipeline.matcher.child"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    backend = importlib.import_module("hcm_pipeline.matcher.torch_backend")
    child = importlib.import_module("hcm_pipeline.matcher.child")
    weights, box = tmp_path / "files" / "weights", tmp_path / "box"
    weights.mkdir(parents=True)
    box.mkdir()
    pins: dict[str, str] = {}
    for name in ("aliked-n16.pth", "aliked_lightglue.pth"):
        (weights / name).write_bytes(name.encode())
        pins[name] = _sha(name.encode())
    monkeypatch.setattr(child, "weight_pins", lambda: pins)
    yield World(fake, torch, backend, child, weights, box, tmp_path)
    sys.modules.pop("hcm_pipeline.matcher.torch_backend", None)
    sys.modules.pop("hcm_pipeline.matcher.child", None)


def request_in(box: Path, budget: MatcherBudget | None = None) -> Path:
    grid = numpy.eye(3)
    film = numpy.zeros((64, 64), numpy.uint8)
    return write_request(box, "r001", Request(film, numpy.zeros((32, 32), numpy.uint8), grid, grid, 0.7, budget or MatcherBudget()))


def test_happy_path_the_graphics_card_comes_first(world: World) -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    assert world.child.main(["probe", "gpu", ""], {"HCM_AI_ROOT": str(world.root)}) == 0

    status = read_status(world.box)
    assert status is not None
    assert (status.device, status.device_name, status.fallback) == ("gpu", "NVIDIA RTX 3080", None)
    assert world.fake.threads == []


def test_bad_path_no_graphics_card_exits_77_and_small_one_76_so_a_silent_processor_run_is_impossible(world: World) -> None:
    """Scenarios: S-P07-HAPPY-CPU-FALLBACK"""
    world.fake.available = False
    with pytest.raises(SystemExit) as stopped:
        world.child.main(["probe", "gpu", ""], {"HCM_AI_ROOT": str(world.root)})
    assert stopped.value.code == 77

    world.fake.available = True
    world.fake.memory = 1 * GB
    with pytest.raises(SystemExit) as small:
        world.backend.device_for("gpu")
    assert small.value.code == 76
    assert read_status(world.box) is None


def test_happy_path_the_processor_runs_only_when_told_on_the_cores_but_one_niced_and_says_why(
    world: World, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Scenarios: S-P07-HAPPY-CPU-FALLBACK, S-P31-HAPPY-WORKER-POLITE"""
    monkeypatch.setattr(world.backend.os, "cpu_count", lambda: 8)
    niced: list[int] = []
    monkeypatch.setattr(world.backend.os, "nice", niced.append)

    assert world.child.main(["probe", "cpu", "no-gpu"], {"HCM_AI_ROOT": str(world.root)}) == 0

    assert world.fake.threads == [7]
    assert niced == [10]
    status = read_status(world.box)
    assert status is not None
    assert (status.device, status.fallback) == ("cpu", "no-gpu")
    assert "NO GRAPHICS CARD" in caplog.text


def test_happy_path_weights_load_from_the_volume_with_no_pickled_code_and_the_hub_is_put_back(world: World) -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    real = world.torch.hub.load_state_dict_from_url
    path = request_in(world.box)

    assert world.child.answer(path, world.weights, "gpu", "", lambda: None) == 0

    assert world.fake.loads == [
        {"name": "aliked-n16.pth", "map_location": "cpu", "weights_only": True},
        {"name": "aliked_lightglue.pth", "map_location": "cpu", "weights_only": True},
    ]
    assert world.torch.hub.load_state_dict_from_url == real
    answer = json.loads((world.box / "r001.answer.json").read_text(encoding="utf-8"))
    assert (answer["device"], answer["deviceName"], answer["proposals"]) == ("gpu", "NVIDIA RTX 3080", [])


def test_bad_path_tampered_weights_are_never_loaded(world: World) -> None:
    """Scenarios: S-P07-BAD-TAMPERED-FILE"""
    (world.weights / "aliked-n16.pth").write_bytes(b"something else")
    path = request_in(world.box)

    assert world.child.answer(path, world.weights, "gpu", "", lambda: None) == 1

    assert world.fake.loads == []
    assert "tampered" in (world.box / "r001.answer.json").read_text(encoding="utf-8")


def test_bad_path_out_of_memory_frees_the_card_and_says_75(world: World, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P07-BAD-OUT-OF-MEMORY"""
    monkeypatch.setitem(sys.modules, "lightglue", lightglue_module(world.torch, FakeOutOfMemoryError()))
    path = request_in(world.box)
    monkeypatch.setattr(
        world.child,
        "search",
        lambda _request, backend, _tick, _decimation: backend.match(({"keypoints": Tensor(numpy.zeros((1, 2, 2)))},) * 2, ((1, 1), (1, 1))),
    )

    assert world.child.answer(path, world.weights, "gpu", "", lambda: None) == world.backend.OUT_OF_MEMORY

    assert world.fake.emptied == 1
    assert not (world.box / "r001.answer.json").exists()


def test_happy_path_the_network_reads_a_tile_and_two_tiles_features(world: World) -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    device = world.backend.device_for("gpu")
    pins = {name: _sha(name.encode()) for name in ("aliked-n16.pth", "aliked_lightglue.pth")}
    network = world.backend.AlikedLightGlue(device, world.weights, pins)

    features = network.extract(numpy.zeros((8, 8), numpy.uint8))
    first, second = network.match((features, features), ((8, 8), (8, 8)))

    assert first.tolist() == [[1.0, 2.0]]
    assert second.tolist() == [[3.0, 4.0]]
    with pytest.raises(TypeError):
        world.backend._mapping("no mapping")


def test_bad_path_a_child_with_wrong_arguments_says_how(world: World) -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""
    assert world.child.main(["what"], {}) == 78


def test_bad_path_the_child_as_a_program_ends_with_mains_code(world: World, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""
    monkeypatch.setattr(sys, "argv", ["child", "what"])
    monkeypatch.delitem(sys.modules, "hcm_pipeline.matcher.child")

    with pytest.raises(SystemExit) as stopped:
        runpy.run_module("hcm_pipeline.matcher.child", run_name="__main__")

    assert stopped.value.code == world.child.USAGE


def test_happy_path_a_real_request_runs_through_main(world: World) -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    path = request_in(world.box)

    assert world.child.main(["run", str(path), "gpu", ""], {"HCM_AI_ROOT": str(world.root)}) == 0


def test_happy_path_the_weights_pins_are_read_from_pins_json(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    fake = FakeTorch()
    monkeypatch.setitem(sys.modules, "torch", fake.module())
    monkeypatch.delitem(sys.modules, "hcm_pipeline.matcher.torch_backend", raising=False)
    monkeypatch.delitem(sys.modules, "hcm_pipeline.matcher.child", raising=False)
    child = importlib.import_module("hcm_pipeline.matcher.child")

    pins = child.weight_pins()

    assert set(pins) == {"aliked-n16.pth", "aliked_lightglue.pth"}
    sys.modules.pop("hcm_pipeline.matcher.torch_backend", None)
    sys.modules.pop("hcm_pipeline.matcher.child", None)


def test_happy_path_the_governors_budget_caps_the_card_and_its_keypoints(world: World) -> None:
    """The governor's budget (docs/research/M26-governor.md §4).

    Scenarios: S-P07-HAPPY-GPU, S-A141-HAPPY
    """
    path = request_in(world.box, MatcherBudget(0, 1024, 0.4))

    assert world.child.main(["run", str(path), "gpu", ""], {"HCM_AI_ROOT": str(world.root)}) == 0
    assert world.fake.fractions == [0.4]
    assert read_answer(world.box / f"r001{ANSWER_SUFFIX}").device == "gpu"


def test_bad_path_a_card_others_hold_sends_the_request_to_the_processor_and_says_so(world: World, monkeypatch: pytest.MonkeyPatch) -> None:
    """The governor's yield (docs/research/M26-governor.md §5): on the processor, the budget's threads, niced as any processor run.

    Scenarios: S-P07-HAPPY-CPU-FALLBACK, S-A141-BAD-NO-GPU
    """
    niced: list[int] = []
    monkeypatch.setattr(world.backend.os, "nice", niced.append)
    path = request_in(world.box, MatcherBudget(3, 1024, 0.0, yield_gpu=True))

    assert world.child.main(["run", str(path), "gpu", ""], {"HCM_AI_ROOT": str(world.root)}) == 0
    answer = read_answer(world.box / f"r001{ANSWER_SUFFIX}")
    assert (answer.device, answer.fallback) == ("cpu", "gpu-busy")
    assert world.fake.threads == [3]
    assert niced == [10]
    assert world.fake.fractions == []


def test_happy_path_the_processor_searches_lighter_and_the_card_as_before(world: World, monkeypatch: pytest.MonkeyPatch) -> None:
    """M26 h2: on the processor, half the resolution with the budget's keypoints; the card keeps the full search.

    Scenarios: S-P07-HAPPY-CPU-FALLBACK, S-P07-HAPPY-GPU
    """
    monkeypatch.setattr(world.backend.os, "nice", lambda _steps: None)
    lightglue = lightglue_module(world.torch)
    monkeypatch.setitem(sys.modules, "lightglue", lightglue)
    asked: list[int] = []

    def search(_request: object, _backend: object, _tick: object, decimation: int) -> tuple[()]:
        asked.append(decimation)
        return ()

    monkeypatch.setattr(world.child, "search", search)

    assert world.child.answer(request_in(world.box, MatcherBudget(2, 2048)), world.weights, "cpu", "no-gpu", lambda: None) == 0
    assert world.child.answer(request_in(world.box, MatcherBudget(0, 2048)), world.weights, "gpu", "", lambda: None) == 0

    assert asked == [2, 1]
    assert lightglue.__dict__["asked"] == [2048, 2048]
