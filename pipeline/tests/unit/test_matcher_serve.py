"""The sidecar's loop (M10), its children faked: a silent processor run is impossible, and an out-of-memory request reruns once."""

import multiprocessing
import signal
import subprocess
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace

import numpy
import pytest
from hcm_pipeline.matcher import serve
from hcm_pipeline.matcher.box import Answer as BoxAnswer
from hcm_pipeline.matcher.box import (
    BadAnswerError,
    Request,
    SidecarStatus,
    read_answer,
    read_status,
    write_answer,
    write_failure,
    write_request,
    write_status,
)
from hcm_pipeline.matcher.serve import (
    NO_GPU,
    OUT_OF_MEMORY,
    USAGE,
    ChildProcess,
    Settings,
    Sidecar,
    _child_main,
    leave_at_sigterm,
    main,
    settings_from,
)


def request_in(box: Path, request_id: str = "r001") -> Path:
    grid = numpy.eye(3)
    return write_request(box, request_id, Request(numpy.ones((4, 4), numpy.uint8), numpy.ones((2, 2), numpy.uint8), grid, grid, 0.7))


@dataclass
class Child:
    """A child that ends with `code` after `polls` looks, doing `work` first."""

    code: int
    polls: int = 0
    killed: bool = False

    def poll(self) -> int | None:
        if self.killed or self.polls <= 0:
            return self.code
        self.polls -= 1
        return None

    def kill(self) -> None:
        self.killed = True

    def wait(self) -> int:
        return self.code


@dataclass
class Spawner:
    """Answers each child: `probe` writes the status; `run` ends with the next of `codes`, 0 writing the answer as a real child does."""

    box: Path
    codes: list[int] = field(default_factory=list)
    polls: int = 0
    probe_code: int = 0
    calls: list[list[str]] = field(default_factory=list)
    children: list[Child] = field(default_factory=list)

    def __call__(self, arguments: Sequence[str]) -> Child:
        self.calls.append(list(arguments))
        return self._probe(arguments) if arguments[0] == "probe" else self._run(arguments)

    def _probe(self, arguments: Sequence[str]) -> Child:
        if self.probe_code == 0:
            write_status(self.box, SidecarStatus(arguments[1], "RTX" if arguments[1] == "gpu" else None, None, 0))
        return Child(self.probe_code)

    def _run(self, arguments: Sequence[str]) -> Child:
        code = self.codes.pop(0)
        if code == 0:
            write_answer(self.box, Path(arguments[1]).name.removesuffix(".request.npz"), BoxAnswer((), arguments[2], None, 1.0))
        child = Child(code, self.polls)
        self.children.append(child)
        return child


def sidecar(box: Path, spawner: Spawner, device: str = "gpu", passes: int = 1) -> Sidecar:
    made = Sidecar(Settings(box.parent, device, "" if device == "gpu" else "no-gpu"), spawner, lambda _seconds: None)
    left = [passes]

    def alive() -> bool:
        left[0] -= 1
        return left[0] >= 0

    made.alive = alive
    return made


@pytest.fixture
def box(tmp_path: Path) -> Path:
    folder = tmp_path / "box"
    folder.mkdir()
    return folder


def test_happy_path_a_request_is_answered_by_a_child_that_exits(box: Path) -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    path = request_in(box)
    spawner = Spawner(box, [0], polls=2)

    assert sidecar(box, spawner, passes=2).run() == 0

    assert spawner.calls == [["probe", "gpu", ""], ["run", str(path), "gpu", ""]]
    assert (box / "r001.answer.json").exists()
    # It beat while the child worked.
    status = read_status(box)
    assert status is not None
    assert status.beat >= 3


def test_bad_path_told_to_use_a_graphics_card_it_has_not_got_it_exits_77_and_never_runs_on_the_processor(box: Path) -> None:
    """Scenarios: S-P07-HAPPY-CPU-FALLBACK"""
    spawner = Spawner(box, probe_code=NO_GPU)

    assert sidecar(box, spawner).run() == NO_GPU

    assert spawner.calls == [["probe", "gpu", ""]]


@pytest.mark.parametrize("environment", [{}, {"HCM_AI_DEVICE": "cpu"}, {"HCM_AI_DEVICE": "tpu", "HCM_AI_WHY": "no-gpu"}])
def test_bad_path_a_processor_run_nobody_explained_is_refused(environment: dict[str, str], monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P07-HAPPY-CPU-FALLBACK"""
    monkeypatch.setattr("hcm_pipeline.matcher.serve.signal.signal", lambda _number, _handler: None)
    assert settings_from(environment) is None
    assert main(environment) == USAGE


def test_happy_path_settings_name_the_device_and_the_reason() -> None:
    """Scenarios: S-P07-HAPPY-CPU-FALLBACK"""
    assert settings_from({"HCM_AI_DEVICE": "gpu"}) == Settings(Path("/ai"), "gpu", "")
    settings = settings_from({"HCM_AI_DEVICE": "cpu", "HCM_AI_WHY": "no-gpu", "HCM_AI_ROOT": "/x"})
    assert settings == Settings(Path("/x"), "cpu", "no-gpu")
    assert settings is not None
    assert settings.box == Path("/x/box")


def test_bad_path_out_of_memory_reruns_the_request_once_on_the_processor(box: Path) -> None:
    """Scenarios: S-P07-BAD-OUT-OF-MEMORY"""
    path = request_in(box)
    spawner = Spawner(box, [OUT_OF_MEMORY, 0])

    assert sidecar(box, spawner).run() == 0

    assert spawner.calls[1:] == [["run", str(path), "gpu", ""], ["run", str(path), "cpu", "out-of-memory"]]
    assert (box / "r001.rerun").exists()
    assert (box / "r001.answer.json").exists()


def test_bad_path_out_of_memory_twice_answers_with_a_failure(box: Path) -> None:
    """Scenarios: S-P07-BAD-OUT-OF-MEMORY"""
    request_in(box)
    spawner = Spawner(box, [OUT_OF_MEMORY, OUT_OF_MEMORY])

    assert sidecar(box, spawner).run() == 0

    assert "failed" in (box / "r001.answer.json").read_text(encoding="utf-8")


def test_bad_path_a_graphics_card_lost_midway_ends_the_sidecar_so_the_starter_probes_again(box: Path) -> None:
    """Scenarios: S-P07-HAPPY-CPU-FALLBACK"""
    request_in(box)
    spawner = Spawner(box, [NO_GPU])

    assert sidecar(box, spawner).run() == NO_GPU

    assert "failed" in (box / "r001.answer.json").read_text(encoding="utf-8")


def test_bad_path_a_crashed_child_answers_with_a_failure_and_the_sidecar_goes_on(box: Path) -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""
    request_in(box)
    spawner = Spawner(box, [139])

    assert sidecar(box, spawner).run() == 0

    assert "exit 139" in (box / "r001.answer.json").read_text(encoding="utf-8")


def test_bad_path_a_cancel_kills_the_child_and_clears_the_request(box: Path) -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""
    request_in(box)
    (box / "r001.cancel").touch()
    spawner = Spawner(box, [139], polls=5)

    assert sidecar(box, spawner).run() == 0

    assert spawner.children[0].killed
    assert sorted(each.name for each in box.iterdir()) == ["sidecar.json"]


def test_bad_path_with_no_status_it_does_not_beat(box: Path) -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""
    made = Sidecar(Settings(box.parent, "gpu", ""), Spawner(box), lambda _seconds: None)

    assert made._pass() is None

    assert read_status(box) is None


def test_happy_path_a_child_runs_in_a_fresh_process_and_says_its_exit_code(monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    monkeypatch.setitem(sys.modules, "hcm_pipeline.matcher.child", SimpleNamespace(main=lambda arguments, _environment: len(arguments)))

    with pytest.raises(SystemExit) as ended:
        _child_main(("a", "b", "c"))

    assert ended.value.code == 3


def test_happy_path_the_child_process_wraps_a_spawned_process(monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P07-HAPPY-GPU"""

    @dataclass
    class Process:
        target: object
        args: tuple[object, ...]
        exitcode: int | None = None
        killed: bool = False

        def start(self) -> None:
            self.exitcode = None

        def kill(self) -> None:
            self.killed = True

        def join(self) -> None:
            self.exitcode = 77

    monkeypatch.setattr(multiprocessing, "get_context", lambda method: SimpleNamespace(Process=Process, method=method))
    child = ChildProcess(["probe", "gpu", ""])

    assert child.poll() is None
    child.kill()
    assert child.wait() == 77


def test_happy_path_main_runs_the_sidecar(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    monkeypatch.setattr("hcm_pipeline.matcher.serve.Sidecar.run", lambda _self: 0)
    installed: list[int] = []
    monkeypatch.setattr("hcm_pipeline.matcher.serve.signal.signal", lambda number, _handler: installed.append(number))

    assert main({"HCM_AI_DEVICE": "gpu", "HCM_AI_ROOT": str(tmp_path)}) == 0
    assert installed == [signal.SIGTERM]


def test_bad_path_a_child_whose_request_is_gone_is_stopped_and_the_sidecar_goes_on(box: Path) -> None:
    """A worker that died left no cancel; the next one cleared the box and waits behind this child. Scenarios: S-P07-BAD-STALE-ANSWER"""
    path = request_in(box)
    spawner = Spawner(box, [0, 0], polls=5)
    made = sidecar(box, spawner, passes=1)
    made._sleep = lambda _seconds: path.unlink(missing_ok=True)

    assert made.run() == 0

    assert spawner.children[0].killed
    assert sorted(each.name for each in box.iterdir()) == ["sidecar.json"]


def test_bad_path_a_child_that_ends_after_its_request_is_gone_leaves_no_answer(box: Path) -> None:
    """Its late word, even a failure, is nobody's answer. Scenarios: S-P07-BAD-STALE-ANSWER"""
    path = request_in(box)

    class EndsLate(Spawner):
        def _run(self, arguments: Sequence[str]) -> Child:
            child = super()._run(arguments)
            path.unlink()
            return child

    assert sidecar(box, EndsLate(box, [0])).run() == 0

    assert sorted(each.name for each in box.iterdir()) == ["sidecar.json"]


def test_bad_path_a_childs_own_word_is_not_overwritten_by_its_exit_code(box: Path) -> None:
    """Scenarios: S-P07-BAD-TAMPERED-FILE"""
    request_in(box)

    class SaysTampered(Spawner):
        def _run(self, arguments: Sequence[str]) -> Child:
            write_failure(box, "r001", "tampered")
            return super()._run(arguments)

    assert sidecar(box, SaysTampered(box, [1])).run() == 0

    with pytest.raises(BadAnswerError) as raised:
        read_answer(box / "r001.answer.json")
    assert raised.value.word == "tampered"


def test_happy_path_sigterm_ends_the_sidecar_at_once() -> None:
    """As a container's PID 1 with no handler the kernel ignores it. Scenarios: S-P07-HAPPY-SIDECAR-WHILE-WANTED"""
    left: list[int] = []
    earlier = signal.getsignal(signal.SIGTERM)
    try:
        leave_at_sigterm(left.append)
        signal.raise_signal(signal.SIGTERM)
    finally:
        signal.signal(signal.SIGTERM, earlier)

    assert left == [0]


def test_happy_path_a_real_process_leaves_with_code_0_at_sigterm() -> None:
    """Scenarios: S-P07-HAPPY-SIDECAR-WHILE-WANTED"""
    code = (
        "import sys, time\n"
        "from hcm_pipeline.matcher.serve import leave_at_sigterm\n"
        "leave_at_sigterm()\n"
        "print('up', flush=True)\n"
        "time.sleep(60)\n"
    )
    source = str(Path(serve.__file__).parents[2])
    with subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, text=True, env={"PYTHONPATH": source}) as process:
        assert process.stdout is not None
        assert process.stdout.readline().strip() == "up"

        process.terminate()

        assert process.wait(timeout=10) == 0
