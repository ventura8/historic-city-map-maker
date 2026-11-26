"""The worker's half of the local matcher (M10), against a fake sidecar answering the box: each failure ends at the admin's points."""

import json
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Final

import numpy
import pytest
from hcm_pipeline.calibrate.ports import ProposalRequest
from hcm_pipeline.geo import Grid
from hcm_pipeline.matcher.box import Answer, Found, SidecarStatus, read_request, request_id_of, write_answer, write_status
from hcm_pipeline.worker.ai_files import AiFilesError
from hcm_pipeline.worker.ai_state import STARTER_VERSION, AiState, initial_state
from hcm_pipeline.worker.local_matcher import (
    CPU_ORIENTATIONS,
    FIRST_USE_WAIT_S,
    LocalMatcher,
    Ports,
)

from tests.unit.calibrate_scene import ArrayReader

STARTER: Final = {"HCM_STARTER": STARTER_VERSION}
GRID: Final = Grid(1000.0, 90000.0, 10.0, 1200, 900)
MOVE: Final = numpy.array([[1.0, 0.0, 300.0], [0.0, 1.0, -150.0], [0.0, 0.0, 1.0]])


@dataclass
class Files:
    """The files, as `AiFiles` answers: ready or not, and how `ensure` ends."""

    image: str = "pytorch/pytorch:x@sha256:" + "a" * 64
    is_ready: bool = True
    fails: AiFilesError | None = None
    ensured: int = 0

    def __post_init__(self) -> None:
        self.tick: Callable[[], None] = lambda: None

    def ready(self) -> bool:
        return self.is_ready

    def ensure(self) -> None:
        self.ensured += 1
        if self.fails is not None:
            raise self.fails


@dataclass
class Sidecar:
    """Called instead of `sleep`: time passes by a second, the sidecar beats if it lives, and a request gets `answer`'s reply."""

    box: Path
    device: str = "gpu"
    lives: bool = True
    reply: Callable[[Sidecar, str], object] | None = None
    now: float = 1000.0
    beat: int = 0
    seen: list[str] = field(default_factory=list)
    requests: list[object] = field(default_factory=list)

    def clock(self) -> float:
        return self.now

    def sleep(self, _seconds: float) -> None:
        self.now += 1.0
        if self.lives:
            self._pass()

    def _pass(self) -> None:
        self.beat += 1
        name = "NVIDIA RTX 3080" if self.device == "gpu" else None
        write_status(self.box, SidecarStatus(self.device, name, None if self.device == "gpu" else "no-gpu", self.beat))
        for path in sorted(self.box.glob("*.request.npz")):
            self._heard(request_id_of(path), path)

    def _heard(self, request_id: str, path: Path) -> None:
        if request_id not in self.seen and self.reply is not None:
            self.seen.append(request_id)
            self.requests.append(read_request(path))
            self.reply(self, request_id)


def right(sidecar: Sidecar, request_id: str) -> None:
    fallback = None if sidecar.device == "gpu" else "no-gpu"
    name = "NVIDIA RTX 3080" if sidecar.device == "gpu" else None
    write_answer(sidecar.box, request_id, Answer((Found(MOVE, 3, 46), Found(MOVE, 1, 20)), sidecar.device, name, 9.0, fallback))


def request_of(
    reader: ArrayReader, starts: int = 4, said: list[str] | None = None, tick: Callable[[], None] = lambda: None
) -> ProposalRequest:
    start = numpy.array([[10.0, 0.0, 1000.0], [0.0, -10.0, 90000.0], [0.0, 0.0, 1.0]])
    reference = numpy.full((GRID.height, GRID.width), 120, numpy.uint8)
    lines = [] if said is None else said
    return ProposalRequest(
        reference,
        1.0,
        reference,
        None,
        GRID,
        "KH-9-pan",
        tuple(start for _ in range(starts)),
        reader,
        (1200, 900, 0),
        300.0,
        tick,
        lines.append,
    )


@dataclass
class Rig:
    matcher: LocalMatcher
    sidecar: Sidecar
    files: Files
    reports: list[AiState]
    box: Path


def rig(
    tmp_path: Path,
    reply: Callable[[Sidecar, str], object] | None = right,
    device: str = "gpu",
    is_ready: bool = True,
    fails: AiFilesError | None = None,
) -> Rig:
    box = tmp_path / "box"
    box.mkdir(exist_ok=True)
    return _rigged(box, Sidecar(box, device, reply=reply), Files(is_ready=is_ready, fails=fails), STARTER)


def _rigged(box: Path, sidecar: Sidecar, files: Files, environment: dict[str, str], machine: str = "x86_64") -> Rig:
    reports: list[AiState] = []
    ports = Ports(box, files, reports.append, environment, sidecar.clock, sidecar.sleep, machine)
    return Rig(LocalMatcher(ports), sidecar, files, reports, box)


def film_reader() -> ArrayReader:
    return ArrayReader(numpy.full((900, 1200), 77, numpy.uint8))


def test_happy_path_the_sidecar_proposes_on_the_graphics_card_and_the_panel_hears(tmp_path: Path) -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    made = rig(tmp_path)
    said: list[str] = []

    proposals = made.matcher.propose(request_of(film_reader(), 2, said))

    assert len(proposals) == 4
    assert proposals[0].support == 46
    assert proposals[0].proposer is not None
    assert proposals[0].proposer.as_record()["deviceName"] == "NVIDIA RTX 3080"
    assert proposals[0].proposer.as_record()["device"] == "gpu"
    assert "fallback" not in proposals[0].proposer.as_record()
    # The map is the answer's on top of the start.
    assert proposals[0].matrix[0, 2] == pytest.approx(1300.0)
    assert any(line.startswith("local AI (aliked-lightglue, gpu, NVIDIA RTX 3080): 4 proposals in") for line in said)
    assert [each.state for each in made.reports] == ["preparing", "preparing", "ready", "ready"]
    assert made.reports[0].wanted
    assert made.reports[0].image == made.files.image
    assert made.reports[1].files
    assert made.reports[-1].as_record() == {"state": "ready", "device": "gpu", "deviceName": "NVIDIA RTX 3080"}
    assert [each.name for each in made.box.iterdir()] == ["sidecar.json"]


def test_happy_path_first_use_says_what_it_fetches(tmp_path: Path) -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    made = rig(tmp_path, is_ready=False)
    said: list[str] = []

    made.matcher.propose(request_of(film_reader(), 1, said))

    assert any("first use: about 10 GB" in line for line in said)
    assert made.files.ensured == 1


def test_happy_path_on_the_processor_it_says_so_and_looks_at_two_orientations(tmp_path: Path) -> None:
    """Scenarios: S-P07-HAPPY-CPU-FALLBACK"""
    made = rig(tmp_path, device="cpu")
    said: list[str] = []

    proposals = made.matcher.propose(request_of(film_reader(), 4, said))

    assert len(made.sidecar.seen) == CPU_ORIENTATIONS
    assert proposals[0].proposer is not None
    assert proposals[0].proposer.as_record()["fallback"] == "no-gpu"
    assert proposals[0].proposer.device == "cpu"
    assert any("cpu" in line for line in said)


def test_happy_path_on_the_processor_two_orientations_keep_each_of_their_scales(tmp_path: Path) -> None:
    """Scenarios: S-P07-HAPPY-CPU-FALLBACK"""
    made = rig(tmp_path, device="cpu")

    made.matcher.propose(replace(request_of(film_reader(), 8), starts_each=2))

    assert len(made.sidecar.seen) == CPU_ORIENTATIONS * 2


@pytest.mark.parametrize(
    ("environment", "machine", "why"),
    [({}, "x86_64", "old-starter"), ({"HCM_STARTER": "2"}, "x86_64", "old-starter"), (STARTER, "aarch64", "arm64")],
)
def test_bad_path_an_old_starter_or_an_arm_computer_never_waits(
    tmp_path: Path, environment: dict[str, str], machine: str, why: str
) -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""
    box = tmp_path / "box"
    box.mkdir()
    made = _rigged(box, Sidecar(box, reply=right), Files(), environment, machine)
    said: list[str] = []

    assert made.matcher.propose(request_of(film_reader(), 1, said)) == ()

    assert made.files.ensured == 0
    assert made.reports[-1].as_record() == {"state": "unavailable", "why": why}
    assert any(f"local AI unavailable ({why})" in line for line in said)
    assert initial_state(environment, machine).why == why


def test_happy_path_a_new_starter_begins_idle() -> None:
    """Scenarios: S-A68-HAPPY-DEVICE-SHOWN"""
    state = initial_state(STARTER, "x86_64")

    assert state.as_record() == {"state": "idle"}
    assert state.on_state() == {"state": "idle", "wanted": False, "image": None, "files": False}


def test_bad_path_a_tampered_file_stands_the_matcher_aside(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-TAMPERED-FILE"""
    made = rig(tmp_path, fails=AiFilesError("tampered", "w.pth does not match its pin, twice"))

    assert made.matcher.propose(request_of(film_reader())) == ()

    assert made.reports[-1].why == "tampered"


def test_bad_path_the_starters_word_ends_the_wait_at_once(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""
    made = rig(tmp_path)
    original = made.sidecar.sleep

    def said_no(seconds: float) -> None:
        original(seconds)
        (made.box / "starter.json").write_text(json.dumps({"state": "unavailable", "why": "disk"}), encoding="utf-8")

    made.matcher._ports = Ports(made.box, made.files, made.reports.append, STARTER, made.sidecar.clock, said_no, "x86_64")
    made.sidecar.lives = False

    assert made.matcher.propose(request_of(film_reader())) == ()

    assert made.reports[-1].why == "disk"
    assert made.sidecar.now - 1000.0 < 5


def test_bad_path_a_stale_status_with_no_sidecar_waits_30_minutes_and_stands_aside(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""
    made = rig(tmp_path)
    write_status(made.box, SidecarStatus("gpu", "old", None, 7))
    made.sidecar.lives = False

    assert made.matcher.propose(request_of(film_reader())) == ()

    assert made.reports[-1].why == "no-answer"
    assert made.sidecar.now - 1000.0 >= FIRST_USE_WAIT_S


def test_bad_path_what_an_earlier_run_left_in_the_box_is_cleared(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""
    made = rig(tmp_path)
    for name in ("r009.request.npz", "r009.answer.json", "r009.cancel", "r009.rerun", "starter.json"):
        (made.box / name).write_text("left", encoding="utf-8")

    made.matcher.propose(request_of(film_reader(), 1))

    assert [each.name for each in made.box.iterdir()] == ["sidecar.json"]
