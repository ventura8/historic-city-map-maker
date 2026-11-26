"""gate_runner.py: the pool runs tasks at once within `jobs`, honours `needs` and exclusive tasks, prints ordered blocks.

Tasks are plain Python callables. Where a test must show that two tasks overlapped, one waits on an event the
other sets (with a long timeout as a safety net); where it must show that they did not, each task holds its slot
for a short window and records which tasks were running when it started.
"""

import threading
from collections.abc import Callable, Sequence

import pytest
from gate_runner import INTERNAL_ERROR, Console, Outcome, Output, Task, order_problems, run_tasks

SAFETY_NET = 10.0  # seconds; only reached when the behaviour under test is broken
WINDOW = 0.05  # seconds a probe holds its slot, long enough for a wrongly started task to show up


class Recorder:
    """A console that keeps every line it is given, and a log of task events."""

    def __init__(self, tasks: Sequence[Task]) -> None:
        self.tasks = tasks
        self.lines: list[str] = []
        self.events: list[str] = []
        self.running: set[str] = set()
        self.seen_running: dict[str, set[str]] = {}
        self.lock = threading.Lock()

    def console(self) -> Console:
        return Console(write=self.lines.append, opened=self.opened, closed=self.closed)

    def opened(self, index: int) -> None:
        self.lines.append(f"<{self.tasks[index].name}>")

    def closed(self, index: int, outcome: Outcome) -> None:
        self.lines.append(f"</{outcome.name} {outcome.code}>")

    def probe(self, name: str, code: int = 0) -> Callable[[Output], int]:
        """Work that records its start and end and what ran beside it, holding its slot for WINDOW seconds."""

        def work(out: Output) -> int:
            with self.lock:
                self.running.add(name)
                self.seen_running[name] = set(self.running)
                self.events.append(f"{name} start")
            threading.Event().wait(WINDOW)
            with self.lock:
                self.running.discard(name)
                self.events.append(f"{name} end")
            out(f"{name} done\n")
            return code

        return work


def test_happy_path_tasks_run_at_once_and_print_in_task_order() -> None:
    # `first` can only finish after `second` ran, so they overlap; the console still shows `first` first.
    second_ran = threading.Event()

    def first(out: Output) -> int:
        out("first starts\n")
        out("first saw second\n" if second_ran.wait(SAFETY_NET) else "first ran alone\n")
        return 0

    def second(out: Output) -> int:
        out("second done\n")
        second_ran.set()
        return 1

    tasks = [Task("first", first), Task("second", second)]
    recorder = Recorder(tasks)

    outcomes = run_tasks(tasks, 2, recorder.console())

    assert recorder.lines == ["<first>", "first starts\n", "first saw second\n", "</first 0>", "<second>", "second done\n", "</second 1>"]
    assert [(outcome.name, outcome.code) for outcome in outcomes] == [("first", 0), ("second", 1)]
    assert all(outcome.seconds >= 0 for outcome in outcomes)


def test_happy_path_jobs_bounds_how_many_tasks_run_at_once() -> None:
    tasks: list[Task] = []
    recorder = Recorder(tasks)
    for name in "abcd":
        tasks.append(Task(name, recorder.probe(name)))

    outcomes = run_tasks(tasks, 2, recorder.console())

    assert [outcome.code for outcome in outcomes] == [0, 0, 0, 0]
    assert max(len(running) for running in recorder.seen_running.values()) <= 2
    assert recorder.lines == [
        "<a>",
        "a done\n",
        "</a 0>",
        "<b>",
        "b done\n",
        "</b 0>",
        "<c>",
        "c done\n",
        "</c 0>",
        "<d>",
        "d done\n",
        "</d 0>",
    ]


@pytest.mark.parametrize("jobs", [1, 0, -3])
def test_bad_path_jobs_below_one_still_runs_every_task_one_at_a_time(jobs: int) -> None:
    tasks: list[Task] = []
    recorder = Recorder(tasks)
    for name in "abc":
        tasks.append(Task(name, recorder.probe(name)))

    run_tasks(tasks, jobs, recorder.console())

    assert recorder.events == ["a start", "a end", "b start", "b end", "c start", "c end"]


def test_happy_path_a_task_starts_after_its_needs_finish() -> None:
    tasks: list[Task] = []
    recorder = Recorder(tasks)
    tasks.extend([Task("build", recorder.probe("build")), Task("budget", recorder.probe("budget"), needs=("build",))])

    run_tasks(tasks, 4, recorder.console())

    assert recorder.events == ["build start", "build end", "budget start", "budget end"]


def test_happy_path_a_task_runs_after_a_failed_need() -> None:
    tasks: list[Task] = []
    recorder = Recorder(tasks)
    tasks.extend([Task("build", recorder.probe("build", code=2)), Task("budget", recorder.probe("budget"), needs=("build",))])

    outcomes = run_tasks(tasks, 4, recorder.console())

    assert [(outcome.name, outcome.code) for outcome in outcomes] == [("build", 2), ("budget", 0)]


def test_happy_path_an_exclusive_task_runs_alone_between_the_others() -> None:
    tasks: list[Task] = []
    recorder = Recorder(tasks)
    tasks.extend(
        [
            Task("a", recorder.probe("a")),
            Task("b", recorder.probe("b")),
            Task("x", recorder.probe("x"), exclusive=True),
            Task("c", recorder.probe("c")),
        ]
    )

    run_tasks(tasks, 4, recorder.console())

    assert recorder.seen_running["x"] == {"x"}
    assert recorder.events.index("x start") > max(recorder.events.index("a end"), recorder.events.index("b end"))
    assert recorder.events.index("c start") > recorder.events.index("x end")


def test_bad_path_a_need_that_does_not_come_first_is_refused() -> None:
    tasks = [Task("budget", lambda _out: 0, needs=("build",)), Task("build", lambda _out: 0), Task("site", lambda _out: 0, needs=("cdn",))]

    assert order_problems(tasks) == [
        "task 'budget' needs 'build', which does not come before it",
        "task 'site' needs 'cdn', which does not come before it",
    ]
    with pytest.raises(ValueError, match="task 'budget' needs 'build'"):
        run_tasks(tasks, 2, Recorder(tasks).console())


def test_bad_path_a_task_that_raises_fails_with_its_traceback_and_the_others_still_run() -> None:
    def broken(_out: Output) -> int:
        raise RuntimeError("the gate's work broke")

    tasks: list[Task] = [Task("broken", broken)]
    recorder = Recorder(tasks)
    tasks.append(Task("after", recorder.probe("after")))

    outcomes = run_tasks(tasks, 2, recorder.console())

    assert [(outcome.name, outcome.code) for outcome in outcomes] == [("broken", INTERNAL_ERROR), ("after", 0)]
    traceback_block = recorder.lines[1]
    assert traceback_block.startswith("Traceback (most recent call last):")
    assert traceback_block.endswith("RuntimeError: the gate's work broke\n")
    assert recorder.lines[2:] == ["</broken 70>", "<after>", "after done\n", "</after 0>"]


def test_happy_path_no_tasks_print_nothing() -> None:
    recorder = Recorder([])

    assert run_tasks([], 3, recorder.console()) == []
    assert recorder.lines == []
