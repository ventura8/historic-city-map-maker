"""pipeline.py: how a stage runs its gates through gate_runner.py, and how `quality` and `all` reuse a gate's outcome.

Commands never really run: a FakeShell (fakeshell.py) records argv, prints `ran <argv>` and returns
programmed exit codes.
"""

import logging
from pathlib import Path

import pytest
from fakeshell import FakeShell
from gate_runner import Outcome

import pipeline
from pipeline import GATES, STAGES, Context, Gate, Ran, Step


@pytest.fixture
def shell(tmp_path: Path) -> FakeShell:
    return FakeShell(tmp_path)


@pytest.fixture
def log(caplog: pytest.LogCaptureFixture) -> pytest.LogCaptureFixture:
    caplog.set_level(logging.INFO, logger="hcm")
    return caplog


# --- gates ----------------------------------------------------------------------------------------


def run_one(gate: Gate, shell: FakeShell, monkeypatch: pytest.MonkeyPatch) -> list[str]:
    monkeypatch.setitem(GATES, gate.name, gate)
    monkeypatch.setitem(STAGES, "deps", (gate.name,))
    return pipeline.run_stage("deps", shell.context())


def test_happy_path_gate_runs_its_command(shell: FakeShell, log: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch) -> None:
    assert run_one(Gate("ruff-check", ("ruff", "check", ".")), shell, monkeypatch) == []
    assert shell.calls == [["ruff", "check", "."]]
    assert shell.printed == ["ran ruff check .\n"]
    assert log.messages[0] == "deps 1/1 ruff-check"
    assert log.messages[1].startswith("  ruff-check passed in ")


def test_bad_path_failing_gate_reports_its_exit_code(
    tmp_path: Path, log: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    shell = FakeShell(tmp_path, failing=["mypy"])

    assert run_one(Gate("mypy", ("mypy",)), shell, monkeypatch) == ["deps/mypy"]
    assert log.messages[1].startswith("  mypy FAILED (exit 1) in ")


def test_happy_path_file_gate_appends_matching_existing_files(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / "docker").mkdir()
    (tmp_path / "docker" / "Dockerfile.quality").write_text("FROM scratch\n", encoding="utf-8")
    (tmp_path / "a.sh").write_text("true\n", encoding="utf-8")
    shell = FakeShell(tmp_path, ls_files=["a.sh", "docker/Dockerfile.quality", "a.sh", "deleted.sh"])
    gate = Gate("lint-files", ("tool", "--flag"), files=("*.sh", "docker/Dockerfile*"))

    assert run_one(gate, shell, monkeypatch) == []
    assert shell.captured == [["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "*.sh", "docker/Dockerfile*"]]
    assert shell.calls == [["tool", "--flag", "a.sh", "docker/Dockerfile.quality"]]


def test_happy_path_file_gate_without_files_is_skipped(
    shell: FakeShell, log: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert run_one(Gate("htmlhint", ("htmlhint",), files=("*.html",)), shell, monkeypatch) == []
    assert shell.calls == []
    assert shell.printed == []
    assert log.messages[1] == "  htmlhint skipped: no files match *.html"


def test_happy_path_stage_prints_each_gate_as_one_block_in_registry_order(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    # Five gates at once: whatever order they finish in, the log reads like a serial run.
    shell = FakeShell(tmp_path)
    ctx = Context(root=tmp_path, run=shell.run, capture=shell.capture, jobs=5)

    assert pipeline.run_stage("tests", ctx) == []
    lines = capsys.readouterr().out.splitlines()
    assert [line for line in lines if not line.startswith(" ")][:-1] == [
        "tests 1/5 vitest",
        "ran npm run --silent test",
        "tests 2/5 rules-coverage",
        "ran python3 scripts/ci/check_rules_coverage.py check",
        "tests 3/5 pytest",
        "ran python3 -m pytest",
        "tests 4/5 pipeline-pytest",
        "ran " + " ".join(pipeline.PIPELINE_PYTEST),
        "tests 5/5 coverage",
        "ran python3 " + " ".join(pipeline.COVERAGE_GATE),
    ]
    assert lines[-1].startswith("tests finished in ")
    assert lines[-1].endswith(", 5 gates, up to 5 at once)")
    assert sorted(" ".join(call) for call in shell.calls) == sorted(line[4:] for line in lines if line.startswith("ran "))


def test_bad_path_stage_keeps_going_after_a_failure(tmp_path: Path) -> None:
    # A gate early in the stage fails; every later gate still runs.
    shell = FakeShell(tmp_path, failing=["check_rules_coverage.py"])

    assert pipeline.run_stage("tests", shell.context(jobs=3)) == ["tests/rules-coverage"]
    assert len(shell.calls) == 5


def test_bad_path_failures_are_listed_in_registry_order(tmp_path: Path) -> None:
    shell = FakeShell(tmp_path, failing=["check_bundle_budget.py", "check_notices.py", "npm run --silent build"])

    assert pipeline.run_stage("build", shell.context(jobs=3)) == [
        "build/vite-build",
        "build/bundle-budget",
        "build/notices",
        "build/site-build",
        "build/install-budget",
        # "npm run --silent build" is also the start of "npm run --silent build:start" (M14)
        "build/start-build",
    ]


def test_bad_path_empty_stage_fails(shell: FakeShell, log: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(STAGES, "deps", ())

    assert pipeline.run_stage("deps", shell.context()) == ["deps (no gates registered)"]
    assert log.messages == ["deps: no gates registered yet (docs/research/M0-handoff.md)"]
    assert shell.calls == []


def test_happy_path_a_task_waits_only_for_the_needs_of_its_own_stage(shell: FakeShell) -> None:
    # bundle-budget needs vite-build: within `release` it waits for it; a stage without vite-build drops the need.
    gate = GATES["bundle-budget"]

    assert pipeline._task(Step(gate, gate.command), shell.context(), STAGES["release"]).needs == ("vite-build",)
    assert pipeline._task(Step(gate, gate.command), shell.context(), ("bundle-budget",)).needs == ()


def test_happy_path_the_cli_is_packed_after_its_self_host_bundle(shell: FakeShell) -> None:
    # docs/LESSONS.md 247: the CLI's vite build empties dist/, so the bundle is assembled after it and before the pack.
    gate = GATES["release-pack"]
    release = STAGES["release"]

    assert pipeline._task(Step(gate, gate.command), shell.context(), release).needs == ("vite-build", "self-host-bundle")
    assert release.index("vite-build") < release.index("self-host-bundle") < release.index("release-pack")


def test_happy_path_playwright_runs_as_an_exclusive_task(shell: FakeShell) -> None:
    gate = GATES["playwright"]

    task = pipeline._task(Step(gate, gate.command), shell.context(), STAGES["e2e"])

    assert task.exclusive is True
    assert task.needs == ("e2e-build",)


def test_happy_path_a_gate_an_earlier_stage_ran_is_reported_not_run(shell: FakeShell) -> None:
    gate = GATES["pytest"]
    step = pipeline.plan_step(gate, shell.context(), {"pytest": Ran("static", Outcome("pytest", 0, 8.25))})

    assert pipeline.step_work(step, shell.context())(shell.printed.append) == 0
    assert shell.calls == []
    assert shell.printed == []
    assert pipeline.closing_line(step, Outcome("pytest", 0, 0.0)) == "  pytest passed in stage 'static' of this run (8.2s); not run again"


def test_bad_path_a_gate_that_failed_earlier_in_the_run_fails_again_without_running(shell: FakeShell) -> None:
    step = pipeline.plan_step(GATES["e2e-matrix"], shell.context(), {"e2e-matrix": Ran("static", Outcome("e2e-matrix", 1, 0.1))})

    assert pipeline.step_work(step, shell.context())(shell.printed.append) == 1
    assert pipeline.closing_line(step, Outcome("e2e-matrix", 1, 0.0)) == (
        "  e2e-matrix FAILED (exit 1) in stage 'static' of this run (0.1s); not run again"
    )


# --- composite stages ----------------------------------------------------------------------------


def test_bad_path_composite_stage_reports_every_failed_part(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    shell = FakeShell(tmp_path, failing=["check_bundle_budget.py", "sonar_scan.sh"])

    assert pipeline.run_pipeline("all", shell.context(jobs=8)) == 1
    assert log.messages[-1] == "[FAILURE] stage 'all' failed: build/bundle-budget, build/install-budget, sonar/sonar"
    assert [" ".join(call) for call in shell.calls].count(" ".join(GATES["e2e-build"].command)) == 1
    assert "e2e 3/3 playwright" in log.messages
    assert "build 1/8 vite-build" in log.messages
    assert "sonar 1/1 sonar" in log.messages


def test_happy_path_quality_runs_each_gate_once(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    # pytest is in `static` and `tests`, e2e-matrix in `static` and `e2e`: one run of `quality` runs each once.
    shell = FakeShell(tmp_path)

    assert pipeline.run_pipeline("quality", shell.context(jobs=8)) == 0
    commands = [" ".join(call) for call in shell.calls]
    assert commands.count("python3 -m pytest") == 1
    assert commands.count("python3 scripts/ci/check_e2e_matrix.py check") == 1
    assert len(commands) == len(set(commands))
    reused = [message for message in log.messages if message.endswith("not run again")]
    assert [message.split(" in stage ")[0] for message in reused] == ["  pytest passed", "  e2e-matrix passed"]


def test_bad_path_a_failure_reused_in_a_later_stage_is_listed_for_both(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    shell = FakeShell(tmp_path, failing=["python3 -m pytest"])

    assert pipeline.run_pipeline("quality", shell.context(jobs=8)) == 1
    assert [" ".join(call) for call in shell.calls].count("python3 -m pytest") == 1
    assert log.messages[-1] == "[FAILURE] stage 'quality' failed: static/pytest, tests/pytest"
