"""The sidecar's long-lived process (`docs/research/M10-local-ai.md`): `python -m matcher.serve`, with no network.

It holds no PyTorch: each request, and the first look at the device, is a child that imports it and exits, so an idle sidecar holds no
graphics memory. It beats in `sidecar.json` while it lives, stops a child when the worker cancels, and reruns once on the processor a
request the graphics card ran out of memory on. **A silent processor run is impossible:** `HCM_AI_DEVICE=cpu` without `HCM_AI_WHY` is
refused, and `HCM_AI_DEVICE=gpu` with no graphics card ends this process with the child's 77, so the starter file probes again. A
request whose file is gone stops its child too: a worker that died left no cancel, and the next one cleared the box. It leaves at SIGTERM:
as the container's PID 1 with no handler, the kernel would ignore it, and a stopped service would wait out systemd's 90 seconds.
"""

import importlib
import logging
import multiprocessing
import os
import signal
import sys
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Protocol

from .box import (
    ANSWER_SUFFIX,
    CANCEL_SUFFIX,
    RERUN_SUFFIX,
    SidecarStatus,
    clear_request,
    pending,
    read_status,
    request_id_of,
    write_failure,
    write_status,
)

LOG = logging.getLogger("hcm-matcher")
USAGE: Final = 78
NO_GPU: Final = 77
SMALL_GPU: Final = 76
OUT_OF_MEMORY: Final = 75
ROOT: Final = "/ai"
POLL_SECONDS: Final = 1.0
FALLBACK_OOM: Final = "out-of-memory"


class Running(Protocol):
    """A child at work (`subprocess.Popen`)."""

    def poll(self) -> int | None: ...

    def kill(self) -> None: ...

    def wait(self) -> int: ...


Spawn = Callable[[Sequence[str]], Running]


def _child_main(arguments: Sequence[str]) -> None:
    """The new process's body: only here does PyTorch get imported, and it goes when the process ends."""
    child = importlib.import_module(f"{__package__}.child")
    sys.exit(child.main(arguments, os.environ))


class ChildProcess:
    """`child.py` in a fresh interpreter (spawn, never fork: a process that loaded CUDA must not be copied)."""

    def __init__(self, arguments: Sequence[str]) -> None:
        self._process = multiprocessing.get_context("spawn").Process(target=_child_main, args=(tuple(arguments),))
        self._process.start()

    def poll(self) -> int | None:
        return self._process.exitcode

    def kill(self) -> None:
        self._process.kill()

    def wait(self) -> int:
        self._process.join()
        return self._process.exitcode or 0


@dataclass(frozen=True)
class Settings:
    """Where the volumes lie, the device the starter chose, and why when it is the processor."""

    root: Path
    device: str
    why: str

    @property
    def box(self) -> Path:
        return self.root / "box"


def settings_from(environment: Mapping[str, str]) -> Settings | None:
    """The sidecar's settings; None when they would allow a processor run nobody explained."""
    device, why = environment.get("HCM_AI_DEVICE", ""), environment.get("HCM_AI_WHY", "")
    if device not in {"gpu", "cpu"} or (device == "cpu" and not why):
        return None
    return Settings(Path(environment.get("HCM_AI_ROOT", ROOT)), device, why)


class Sidecar:
    """The loop over the box."""

    def __init__(self, settings: Settings, spawn: Spawn = ChildProcess, sleep: Callable[[float], None] = time.sleep) -> None:
        self._settings = settings
        self._spawn = spawn
        self._sleep = sleep
        self._beats = 0
        self.alive: Callable[[], bool] = lambda: True

    def run(self) -> int:
        """Until the container stops; the exit code that says why it ended otherwise."""
        code = self._spawn(["probe", self._settings.device, self._settings.why]).wait()
        if code != 0:
            LOG.error("local AI: the device look ended with %d", code)
            return code
        while self.alive():
            ended = self._pass()
            if ended is not None:
                return ended
            self._sleep(POLL_SECONDS)
        return 0

    def _pass(self) -> int | None:
        self._beat()
        waiting = pending(self._settings.box)
        return self._answer(waiting[0]) if waiting else None

    def _beat(self) -> None:
        status = read_status(self._settings.box)
        if status is not None:
            self._beats += 1
            write_status(self._settings.box, SidecarStatus(status.device, status.device_name, status.fallback, self._beats))

    def _answer(self, path: Path) -> int | None:
        """One request answered; the exit code when the sidecar must end for it."""
        request_id = request_id_of(path)
        code = self._child(path, ["run", str(path), self._settings.device, self._settings.why])
        if code == OUT_OF_MEMORY and self._settings.device == "gpu":
            LOG.warning("local AI: the graphics card ran out of memory on %s: this request runs once on the processor", request_id)
            (self._settings.box / f"{request_id}{RERUN_SUFFIX}").touch()
            code = self._child(path, ["run", str(path), "cpu", FALLBACK_OOM])
        return self._ended(path, code)

    def _ended(self, path: Path, code: int | None) -> int | None:
        request_id = request_id_of(path)
        if code is None or not path.exists():
            clear_request(self._settings.box, request_id)
        elif code != 0:
            self._failed(request_id, code)
        return code if code in {NO_GPU, SMALL_GPU} else None

    def _failed(self, request_id: str, code: int) -> None:
        """A failure the child did not say itself: what it said (`tampered`) is the worker's to read, not this exit code's to overwrite."""
        if not (self._settings.box / f"{request_id}{ANSWER_SUFFIX}").exists():
            write_failure(self._settings.box, request_id, f"exit {code}")

    def _child(self, path: Path, arguments: Sequence[str]) -> int | None:
        """A child's exit code; None when the worker cancelled it, or its request is gone (a worker that died, a box cleared since)."""
        request_id = request_id_of(path)
        running = self._spawn(arguments)
        cancel = self._settings.box / f"{request_id}{CANCEL_SUFFIX}"
        while (code := running.poll()) is None:
            if cancel.exists() or not path.exists():
                running.kill()
                running.wait()
                LOG.info("local AI: stopped %s: cancelled, or its request is gone", request_id)
                return None
            self._beat()
            self._sleep(POLL_SECONDS)
        return code


def leave_at_sigterm(leave: Callable[[int], object] = os._exit) -> None:
    """A stopped container ends at once: PID 1 going takes its children with it, whatever they hold."""
    signal.signal(signal.SIGTERM, lambda _signal, _frame: leave(0))


def main(environment: Mapping[str, str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    leave_at_sigterm()
    settings = settings_from(os.environ if environment is None else environment)
    if settings is None:
        LOG.error(
            "local AI: refused: HCM_AI_DEVICE must be gpu, or cpu with the reason in HCM_AI_WHY; a silent processor run is not allowed"
        )
        return USAGE
    return Sidecar(settings).run()


if __name__ == "__main__":
    sys.exit(main())
