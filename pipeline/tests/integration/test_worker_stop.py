"""One SIGTERM or Ctrl-C stops the local worker, whatever it is doing (M7, docs/research/M7-local-worker.md §1.2 step 6).

Each test starts `tests/fakes/stopping_worker.py` in a process of its own (signals reach a process's main thread, which
pytest's own process keeps for itself), waits until the worker's main thread is held at the moment named, sends one
signal, lets the thread go on, and expects exit 0 within `STOP_SECONDS`, the job where that moment leaves it. The worker
claims every 30 s, so a signal it lost is a timeout here. The moment right after a run's last checkpoint is repeated: the
first stop signal was lost there in three of five e2e runs (DECISIONS-for-review.md §83j, docs/LESSONS.md 342).
"""

import os
import signal
import subprocess
import sys
from pathlib import Path
from typing import Final

import pytest

PIPELINE: Final = Path(__file__).resolve().parents[2]
STOP_SECONDS: Final = 10.0
START_SECONDS: Final = 60.0


def started(moment: str) -> subprocess.Popen[str]:
    env = {**os.environ, "PYTHONPATH": os.pathsep.join((str(PIPELINE / "src"), str(PIPELINE)))}
    command = (sys.executable, "-m", "tests.fakes.stopping_worker", moment)
    return subprocess.Popen(command, cwd=PIPELINE, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)


def stopped_at(moment: str, number: signal.Signals) -> tuple[int, str]:
    """The worker held at `moment`, one `number` signal, then the line that lets it go on: its exit code and its output."""
    with started(moment) as worker:
        assert worker.stdout is not None
        line = worker.stdout.readline()
        assert line == f"AT {moment}\n", line
        worker.send_signal(number)
        try:
            output, _ = worker.communicate("go\n", timeout=STOP_SECONDS)
        except subprocess.TimeoutExpired:
            worker.kill()
            worker.communicate()
            pytest.fail(f"the worker still ran {STOP_SECONDS} s after one {number.name} at {moment}")
        return worker.returncode, output


@pytest.mark.parametrize("attempt", range(5))
def test_bad_path_one_sigterm_right_after_the_runs_last_checkpoint_stops_the_worker(attempt: int) -> None:
    """Scenarios: S-P04-BAD-ONE-SIGNAL"""
    code, output = stopped_at("tail", signal.SIGTERM)

    assert (code, output.splitlines()[-1]) == (0, 'JOB "awaiting_approval"')


@pytest.mark.parametrize(
    ("moment", "number", "status"),
    [
        # Ctrl-C in the same place, as the admin guide stops it.
        ("tail", signal.SIGINT, "awaiting_approval"),
        # During a step: the run goes back to `queued` at its next checkpoint.
        ("step", signal.SIGTERM, "queued"),
        # While the job is being claimed, before the run's own handler: no step runs, the job goes back to `queued`.
        ("claim", signal.SIGTERM, "queued"),
        # Between jobs, in the loop's wait.
        ("idle", signal.SIGINT, "awaiting_approval"),
    ],
)
def test_bad_path_one_signal_at_any_moment_stops_the_worker(moment: str, number: signal.Signals, status: str) -> None:
    """Scenarios: S-P04-BAD-ONE-SIGNAL"""
    code, output = stopped_at(moment, number)

    assert (code, output.splitlines()[-1]) == (0, f'JOB "{status}"')
