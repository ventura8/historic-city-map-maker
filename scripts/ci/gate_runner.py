"""Concurrent gate execution: one stage's gates on a bounded pool of threads, printed as ordered blocks.

scripts/ci/pipeline.py turns every gate of a stage into a `Task`, in registry order, and calls `run_tasks`. A task
starts as soon as all of these hold:

- a worker is free: at most `jobs` tasks run at once;
- every task named in its `needs` has finished (it reads what they wrote; a need must come earlier in the list);
- no exclusive task is in the way: an `exclusive` task starts only when every task before it has finished and
  nothing else runs, and no task after it starts before it has finished (Playwright saturates the machine and
  binds fixed ports, so it runs alone).

Every task runs whatever another task's outcome, as in a serial run. Output is never interleaved: each task writes
into its own block, and the printer emits the blocks in task order, following the earliest unfinished task live,
so a log reads like a serial run's and lists its failures in the same order whichever task finished first. A task
that raises is reported as failed (exit 70, its traceback in its block) instead of hanging the run.
"""

import threading
import time
import traceback
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from functools import partial

Output = Callable[[str], None]
"""Receives a task's output, a chunk (usually one line, newline included) at a time."""

Work = Callable[[Output], int]
"""Runs a task, writing its output through the callable it is given; returns the exit status (0 passes)."""

INTERNAL_ERROR = 70
"""The exit status of a task whose work raised (EX_SOFTWARE)."""


@dataclass(frozen=True)
class Task:
    """One unit of work: `needs` names earlier tasks it waits for; `exclusive` makes it run alone."""

    name: str
    work: Work
    needs: tuple[str, ...] = ()
    exclusive: bool = False


@dataclass(frozen=True)
class Outcome:
    """How a task ended: its exit status and how long its own work took (not the time it waited)."""

    name: str
    code: int
    seconds: float


@dataclass(frozen=True)
class Console:
    """Where the blocks go: `opened(i)` before task i's output, `write` for each chunk, `closed(i, outcome)` after."""

    write: Output
    opened: Callable[[int], None]
    closed: Callable[[int, Outcome], None]


def order_problems(tasks: Sequence[Task]) -> list[str]:
    """Needs that do not name an earlier task (they could never be met, or would wait on a later block)."""
    problems: list[str] = []
    earlier: set[str] = set()
    for task in tasks:
        problems += [f"task '{task.name}' needs '{need}', which does not come before it" for need in task.needs if need not in earlier]
        earlier.add(task.name)
    return problems


@dataclass
class _Block:
    """A task's state and the output it wrote that the printer has not emitted yet."""

    chunks: list[str] = field(default_factory=list)
    started: bool = False
    outcome: Outcome | None = None


class _Pool:
    """Starts tasks under the rules of the module docstring; every state change happens under one condition."""

    def __init__(self, tasks: Sequence[Task], jobs: int) -> None:
        self._tasks = tuple(tasks)
        self._jobs = max(1, jobs)
        self._blocks = [_Block() for _ in self._tasks]
        self._running = 0
        self._changed = threading.Condition()

    def take_output(self, index: int) -> tuple[list[str], Outcome | None]:
        """Starts what may start, waits until task `index` wrote or finished, and hands over what it wrote."""
        with self._changed:
            self._start_ready()
            block = self._blocks[index]
            while not block.chunks and block.outcome is None:
                self._changed.wait()
                self._start_ready()
            chunks, block.chunks = block.chunks, []
            return chunks, block.outcome

    def _finished(self, index: int) -> bool:
        return self._blocks[index].outcome is not None

    def _needs_met(self, index: int) -> bool:
        done = {self._tasks[earlier].name for earlier in range(index) if self._finished(earlier)}
        return set(self._tasks[index].needs) <= done

    def _clear_of_exclusive(self, index: int) -> bool:
        if self._tasks[index].exclusive:
            return self._running == 0 and all(map(self._finished, range(index)))
        return all(self._finished(earlier) for earlier in range(index) if self._tasks[earlier].exclusive)

    def _may_start(self, index: int) -> bool:
        if self._blocks[index].started or self._running >= self._jobs:
            return False
        return self._needs_met(index) and self._clear_of_exclusive(index)

    def _start_ready(self) -> None:
        for index in range(len(self._tasks)):
            if self._may_start(index):
                self._blocks[index].started = True
                self._running += 1
                threading.Thread(target=self._work, args=(index,), name=f"gate-{self._tasks[index].name}", daemon=True).start()

    def _write(self, index: int, chunk: str) -> None:
        with self._changed:
            self._blocks[index].chunks.append(chunk)
            self._changed.notify_all()

    def _work(self, index: int) -> None:
        task = self._tasks[index]
        out = partial(self._write, index)
        started = time.monotonic()
        try:
            code = task.work(out)
        except Exception:
            out(traceback.format_exc())
            code = INTERNAL_ERROR
        outcome = Outcome(task.name, code, time.monotonic() - started)
        with self._changed:
            self._blocks[index].outcome = outcome
            self._running -= 1
            self._changed.notify_all()


def _print_block(pool: _Pool, index: int, console: Console) -> Outcome:
    console.opened(index)
    while True:
        chunks, outcome = pool.take_output(index)
        for chunk in chunks:
            console.write(chunk)
        if outcome is not None:
            console.closed(index, outcome)
            return outcome


def run_tasks(tasks: Sequence[Task], jobs: int, console: Console) -> list[Outcome]:
    """Runs every task, at most `jobs` at once, and returns their outcomes in task order (raises on a bad `needs`)."""
    problems = order_problems(tasks)
    if problems:
        raise ValueError("; ".join(problems))
    pool = _Pool(tasks, jobs)
    return [_print_block(pool, index, console) for index in range(len(tasks))]
