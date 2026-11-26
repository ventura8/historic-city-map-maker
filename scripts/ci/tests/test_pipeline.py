"""pipeline.py: registry consistency, stage expansion, gate execution, setup, verdicts and the CLI.

Commands never really run here: a FakeShell (fakeshell.py) records argv, prints one line per command
and returns programmed exit codes, except in the few tests that exercise the subprocess-backed defaults
with the Python interpreter. How a stage runs its gates is in test_pipeline_stages.py; the scheduling
rules themselves (jobs, needs, exclusive gates) are pinned by test_gate_runner.py.
"""

import hashlib
import json
import logging
import os
import runpy
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path

import pytest
from fakeshell import FakeShell
from parallel import Machine

import pipeline
from pipeline import COMPOSITE_STAGES, GATES, STAGES, Context, Gate

PIPELINE_PY = Path(pipeline.__file__)


@pytest.fixture
def shell(tmp_path: Path) -> FakeShell:
    return FakeShell(tmp_path)


@pytest.fixture
def log(caplog: pytest.LogCaptureFixture) -> pytest.LogCaptureFixture:
    caplog.set_level(logging.INFO, logger="hcm")
    return caplog


def gate_commands(shell: FakeShell) -> list[str]:
    return [" ".join(call) for call in shell.calls]


# --- registry -------------------------------------------------------------------------------------


def test_happy_path_registry_is_consistent() -> None:
    assert pipeline.validate_registry() == []


def test_happy_path_every_gate_belongs_to_a_stage() -> None:
    used = {gate for gates in STAGES.values() for gate in gates}

    assert set(GATES) == used


def test_happy_path_stage_names_cover_the_documented_stages() -> None:
    stages = ["all", "build", "contract", "deps", "e2e", "quality", "release", "sonar", "static", "tests", "tour-matrix"]
    assert pipeline.all_stage_names() == stages


def test_bad_path_unknown_and_duplicated_gates_are_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(STAGES, "static", ("prettier", "prettier", "no-such-gate"))

    assert pipeline.validate_registry() == [
        "stage 'static' uses unknown gate 'no-such-gate'",
        "stage 'static' lists gate 'prettier' twice",
    ]


def test_happy_path_every_need_names_a_gate_listed_before_it() -> None:
    for stage, gates in STAGES.items():
        for name in gates:
            assert all(gates.index(need) < gates.index(name) for need in GATES[name].needs if need in gates), (stage, name)


def test_bad_path_unknown_and_late_needs_are_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(GATES, "coverage", Gate("coverage", ("true",), needs=("vitest", "jest")))
    monkeypatch.setitem(STAGES, "tests", ("coverage", "vitest", "no-such-gate"))

    assert pipeline.validate_registry() == [
        "stage 'tests' uses unknown gate 'no-such-gate'",
        "gate 'coverage' needs unknown gate 'jest'",
        "stage 'tests' lists gate 'vitest' after 'coverage', which needs it",
    ]


def test_happy_path_gates_that_read_other_gates_output_wait_for_them() -> None:
    assert GATES["coverage"].needs == ("vitest", "pytest", "pipeline-pytest")
    assert GATES["rules-coverage"].needs == ("vitest",)
    assert GATES["bundle-budget"].needs == ("vite-build",)
    assert GATES["notices"].needs == ("vite-build",)
    assert GATES["site-build"].needs == ("vite-build",)
    assert GATES["hosting-build"].needs == ("vite-build",)
    assert GATES["install-build"].needs == ("hosting-build",)
    assert GATES["install-budget"].needs == ("install-build",)
    assert GATES["start-build"].needs == ("hosting-build",)
    assert GATES["playwright"].needs == ("e2e-build",)
    assert GATES["playwright-tour-matrix"].needs == ("e2e-build",)
    assert [name for name, gate in GATES.items() if gate.exclusive] == ["playwright", "playwright-tour-matrix"]


def test_bad_path_composite_problems_are_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(COMPOSITE_STAGES, "static", ("tests",))
    monkeypatch.setitem(COMPOSITE_STAGES, "nightly", ("static", "fuzz"))

    assert pipeline.validate_registry() == [
        "stage name 'static' is both simple and composite",
        "composite 'nightly' uses unknown stage 'fuzz'",
    ]


@pytest.mark.parametrize(
    ("stage", "expected"),
    [
        ("static", ["static"]),
        ("quality", ["static", "tests", "e2e", "build"]),
        ("all", ["static", "tests", "e2e", "tour-matrix", "build", "sonar"]),
    ],
)
def test_happy_path_stages_expand_in_run_order(stage: str, expected: list[str]) -> None:
    assert pipeline.expand_stage(stage) == expected


def test_happy_path_sonar_and_deps_stages_run_their_scripts(shell: FakeShell) -> None:
    assert pipeline.run_stage("sonar", shell.context()) == []
    assert pipeline.run_stage("deps", shell.context()) == []
    assert gate_commands(shell) == ["bash scripts/ci/sonar_scan.sh", "python3 scripts/ci/check_dependency_updates.py"]


def test_happy_path_fonts_gate_checks_the_kit_subset_after_i18n() -> None:
    static = STAGES["static"]

    assert static.index("fonts") == static.index("i18n") + 1
    assert GATES["fonts"].command == ("npm", "run", "--silent", "fonts:check", "--workspace", "@hcm/ui")


def test_happy_path_commits_gate_runs_after_the_history_scan() -> None:
    static = STAGES["static"]

    assert static.index("commits") == static.index("gitleaks-history") + 1
    assert GATES["commits"].command == ("python3", "scripts/ci/check_commits.py")


# --- setup: node_modules --------------------------------------------------------------------------


def write_lockfile(root: Path, content: str = '{"lockfileVersion": 3}\n') -> str:
    (root / "package-lock.json").write_text(content, encoding="utf-8")
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def test_happy_path_no_lockfile_needs_no_install(shell: FakeShell) -> None:
    assert pipeline.ensure_node_modules(shell.context()) is True
    assert shell.calls == []


def test_happy_path_missing_node_modules_are_installed_and_stamped(shell: FakeShell) -> None:
    digest = write_lockfile(shell.root)
    (shell.root / "node_modules").mkdir()

    assert pipeline.ensure_node_modules(shell.context()) is True
    assert shell.calls == [list(pipeline.NPM_CI)]
    assert (shell.root / pipeline.INSTALL_STAMP).read_text(encoding="utf-8") == digest + "\n"


def test_happy_path_current_stamp_skips_the_install(shell: FakeShell) -> None:
    digest = write_lockfile(shell.root)
    (shell.root / "node_modules").mkdir()
    (shell.root / pipeline.INSTALL_STAMP).write_text(digest + "\n", encoding="utf-8")

    assert pipeline.ensure_node_modules(shell.context()) is True
    assert shell.calls == []


def test_bad_path_stale_stamp_reinstalls(shell: FakeShell) -> None:
    write_lockfile(shell.root, '{"lockfileVersion": 3, "changed": true}\n')
    (shell.root / "node_modules").mkdir()
    (shell.root / pipeline.INSTALL_STAMP).write_text("old-digest\n", encoding="utf-8")

    assert pipeline.ensure_node_modules(shell.context()) is True
    assert shell.calls == [list(pipeline.NPM_CI)]


def test_bad_path_failed_install_fails_the_whole_run(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    write_lockfile(tmp_path)
    shell = FakeShell(tmp_path, failing=["npm ci"])

    assert pipeline.run_pipeline("tests", shell.context()) == 1
    assert shell.calls == [list(pipeline.NPM_CI)]
    assert shell.printed == ["ran " + " ".join(pipeline.NPM_CI) + "\n"]
    assert log.messages[-1] == "[FAILURE] stage 'tests' failed: setup/npm-ci"
    assert not (tmp_path / pipeline.INSTALL_STAMP).exists()


# --- verdicts and green markers -------------------------------------------------------------------


def test_happy_path_passing_stage_writes_green_marker(shell: FakeShell, log: pytest.LogCaptureFixture) -> None:
    assert pipeline.run_pipeline("build", shell.context()) == 0

    marker = json.loads((shell.root / "reports" / "pipeline" / "green-build.json").read_text(encoding="utf-8"))
    assert marker == {"stage": "build", "head": "0123abcd", "status_sha256": hashlib.sha256(b"?? new-file.ts\n").hexdigest()}
    assert log.messages[-1] == "[SUCCESS] stage 'build' passed (reports/pipeline/green-build.json)"


def test_bad_path_failing_stage_writes_no_marker(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    shell = FakeShell(tmp_path, failing=["python3 -m pytest"])

    assert pipeline.run_pipeline("tests", shell.context()) == 1
    assert log.messages[-1] == "[FAILURE] stage 'tests' failed: tests/pytest"
    assert not (tmp_path / "reports").exists()


def test_bad_path_unborn_head_is_recorded(tmp_path: Path) -> None:
    def capture(argv: Sequence[str]) -> str:
        if argv[1] == "rev-parse":
            raise subprocess.CalledProcessError(128, list(argv))
        return ""

    ctx = Context(root=tmp_path, run=lambda _argv, _out: 0, capture=capture)

    marker = pipeline.write_green_marker("static", ctx)

    assert json.loads(marker.read_text(encoding="utf-8"))["head"] == "unborn"


# --- subprocess-backed defaults -------------------------------------------------------------------


def test_happy_path_run_command_returns_the_exit_code(tmp_path: Path) -> None:
    lines: list[str] = []

    assert pipeline.run_command([sys.executable, "-c", "raise SystemExit(3)"], lines.append, tmp_path) == 3
    assert lines == []


def test_happy_path_run_command_hands_over_stdout_and_stderr_line_by_line(tmp_path: Path) -> None:
    lines: list[str] = []
    script = "import sys; print('out', flush=True); print('err', file=sys.stderr, flush=True); sys.stdout.buffer.write(b'\\xff')"

    assert pipeline.run_command([sys.executable, "-c", script], lines.append, tmp_path) == 0
    assert lines == ["out\n", "err\n", "\ufffd"]


def test_happy_path_run_command_gives_the_command_no_stdin(tmp_path: Path) -> None:
    lines: list[str] = []

    assert pipeline.run_command([sys.executable, "-c", "import sys; print(repr(sys.stdin.read()))"], lines.append, tmp_path) == 0
    assert lines == ["''\n"]


def test_bad_path_missing_executable_exits_127(tmp_path: Path) -> None:
    lines: list[str] = []

    assert pipeline.run_command(["hcm-no-such-tool"], lines.append, tmp_path) == pipeline.COMMAND_NOT_FOUND
    assert lines == ["  command not found: hcm-no-such-tool\n"]


def test_happy_path_write_stdout_prints_at_once(capsys: pytest.CaptureFixture[str]) -> None:
    pipeline.write_stdout("a line\n")

    assert capsys.readouterr().out == "a line\n"


@pytest.mark.parametrize(("value", "expected"), [("3", 3), (" 12 ", 12), ("1", 1)])
def test_happy_path_pipeline_jobs_sets_how_many_gates_run_at_once(value: str, expected: int) -> None:
    assert pipeline.default_jobs({pipeline.JOBS_VARIABLE: value}) == expected


@pytest.mark.parametrize("value", ["", "0", "-2", "many", "2.5"])
def test_bad_path_an_unusable_pipeline_jobs_falls_back_to_the_cpu_count(value: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pipeline, "this_machine", lambda: Machine(6, 64))

    assert pipeline.default_jobs({pipeline.JOBS_VARIABLE: value}) == 6
    assert pipeline.default_jobs({}) == 6


def test_happy_path_little_free_memory_runs_fewer_gates_at_once_and_the_low_memory_mode_one(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pipeline, "this_machine", lambda: Machine(16, 9))

    assert pipeline.default_jobs({}) == 4
    assert pipeline.default_jobs({"HCM_MAX_PARALLEL": "2"}) == 2
    assert pipeline.default_jobs({"HCM_LOW_MEM": "1"}) == 1
    assert pipeline.default_jobs({"HCM_LOW_MEM": "1", pipeline.JOBS_VARIABLE: "5"}) == 5


def test_bad_path_an_unknown_cpu_count_runs_one_gate_at_a_time(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(os, "process_cpu_count", lambda: None)

    assert pipeline.default_jobs({}) == 1


def test_happy_path_capture_output_returns_stdout(tmp_path: Path) -> None:
    assert pipeline.capture_output([sys.executable, "-c", "import sys; sys.stdout.write('ok')"], tmp_path) == "ok"


def test_bad_path_capture_output_raises_on_failure(tmp_path: Path) -> None:
    with pytest.raises(subprocess.CalledProcessError):
        pipeline.capture_output([sys.executable, "-c", "raise SystemExit(1)"], tmp_path)


def test_happy_path_default_context_runs_from_the_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(pipeline.JOBS_VARIABLE, "5")
    ctx = pipeline.default_context(tmp_path)
    lines: list[str] = []

    assert ctx.root == tmp_path
    assert ctx.jobs == 5
    assert ctx.write is pipeline.write_stdout
    assert ctx.run([sys.executable, "-c", "import os; print(os.getcwd())"], lines.append) == 0
    assert lines == [f"{tmp_path}\n"]
    assert ctx.capture([sys.executable, "-c", "import os, sys; sys.stdout.write(os.getcwd())"]) == str(tmp_path)


def test_happy_path_default_context_takes_an_explicit_job_count(tmp_path: Path) -> None:
    assert pipeline.default_context(tmp_path, jobs=2).jobs == 2


# --- CLI ------------------------------------------------------------------------------------------


def test_happy_path_list_prints_the_registry(log: pytest.LogCaptureFixture) -> None:
    assert pipeline.main(["--list"]) == 0
    assert "e2e      e2e-matrix e2e-build playwright" in log.messages
    assert "sonar    sonar" in log.messages
    assert "deps     dependency-updates" in log.messages
    assert "all      static tests e2e tour-matrix build sonar" in log.messages
    assert "tour-matrix e2e-matrix e2e-build playwright-tour-matrix" in log.messages
    assert "tests    vitest rules-coverage pytest pipeline-pytest coverage" in log.messages


def test_bad_path_inconsistent_registry_refuses_to_run(monkeypatch: pytest.MonkeyPatch, log: pytest.LogCaptureFixture) -> None:
    monkeypatch.setitem(STAGES, "tests", ("vitest", "jest"))

    assert pipeline.main(["--stage", "tests"]) == pipeline.EXIT_USAGE
    assert log.messages[0] == "[ERROR] pipeline registry: stage 'tests' uses unknown gate 'jest'"


def test_bad_path_missing_stage_is_a_usage_error(monkeypatch: pytest.MonkeyPatch, log: pytest.LogCaptureFixture) -> None:
    monkeypatch.setenv(pipeline.IMAGE_MARKER, "1")

    assert pipeline.main([]) == pipeline.EXIT_USAGE
    assert log.messages[-1].startswith("[ERROR] run `PIPELINE_STAGE=<stage> bash scripts/ci/run-all-checks.sh`")


def test_bad_path_refuses_to_run_outside_the_quality_image(monkeypatch: pytest.MonkeyPatch, shell: FakeShell) -> None:
    monkeypatch.delenv(pipeline.IMAGE_MARKER, raising=False)

    assert pipeline.main(["--stage", "build"], shell.context()) == pipeline.EXIT_USAGE
    assert shell.calls == []


def test_bad_path_unknown_stage_is_rejected_by_argparse() -> None:
    with pytest.raises(SystemExit) as exit_info:
        pipeline.main(["--stage", "deploy"])

    assert exit_info.value.code == pipeline.EXIT_USAGE


def test_happy_path_main_runs_the_stage_inside_the_image(monkeypatch: pytest.MonkeyPatch, shell: FakeShell) -> None:
    monkeypatch.setenv(pipeline.IMAGE_MARKER, "1")

    assert pipeline.main(["--stage", "build"], shell.context()) == 0
    assert gate_commands(shell) == [
        "npm run --silent build",
        "python3 scripts/ci/check_bundle_budget.py",
        "python3 scripts/ci/check_notices.py",
        "npm run --silent build:site",
        "node --import ./scripts/site/register-ts.mjs scripts/site/build-hosting.ts",
        "node --import ./scripts/site/register-ts.mjs scripts/site/build-install.ts",
        "python3 scripts/ci/check_bundle_budget.py --install",
        "npm run --silent build:start",
    ]


def test_happy_path_main_defaults_to_the_real_repository(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[Path] = []

    def fake_run_pipeline(_stage: str, ctx: Context) -> int:
        seen.append(ctx.root)
        return 0

    monkeypatch.setenv(pipeline.IMAGE_MARKER, "1")
    monkeypatch.setattr(pipeline, "run_pipeline", fake_run_pipeline)

    assert pipeline.main(["--stage", "static"]) == 0
    assert seen == [pipeline.ROOT]


def test_happy_path_script_entry_point_exits_with_main_status(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "argv", [str(PIPELINE_PY), "--list"])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(PIPELINE_PY), run_name="__main__")

    assert exit_info.value.code == 0
