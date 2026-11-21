"""The command line: arguments, configuration, dispatch and exit codes."""

import importlib
import io
import json
import runpy
import sys

import pytest
from hcm_pipeline.exit_codes import ExitCode
from hcm_pipeline.main import default_registry, main
from hcm_pipeline.steps import Outcome, StepContext, StepError, StepRegistry

from tests.fakes.environment import VALID_ENV


class ScriptedStep:
    """A step that needs the configuration and does what the test scripts."""

    name = "scripted"
    requires_config = True

    def __init__(self, outcome: Outcome = Outcome.DONE, error: Exception | None = None) -> None:
        self.outcome = outcome
        self.error = error
        self.seen_job_id: str | None = None

    def run(self, ctx: StepContext) -> Outcome:
        self.seen_job_id = ctx.require_config().job_id
        if self.error is not None:
            raise self.error
        return self.outcome


def run(argv: list[str], step: ScriptedStep, env: dict[str, str] | None = None) -> tuple[int, list[dict[str, object]]]:
    stream = io.StringIO()
    code = main(argv, VALID_ENV if env is None else env, StepRegistry((step,)), stream)
    return code, [json.loads(line) for line in stream.getvalue().splitlines()]


def test_happy_path_step_runs_with_the_job_configuration() -> None:
    step = ScriptedStep()

    code, entries = run(["scripted"], step)

    assert code == ExitCode.OK
    assert step.seen_job_id == VALID_ENV["JOB_ID"]
    assert entries[-1]["message"] == "step scripted done"


def test_happy_path_waiting_step_exits_ok_so_cloud_run_does_not_retry() -> None:
    code, entries = run(["scripted"], ScriptedStep(Outcome.WAITING))

    assert code == ExitCode.OK
    assert entries[-1]["message"] == "step scripted waiting"


def test_happy_path_list_names_every_step() -> None:
    code, entries = run(["--list"], ScriptedStep())

    assert code == ExitCode.OK
    assert entries[-1]["message"] == "steps: scripted"


def test_happy_path_environment_defaults_to_the_process_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name, value in VALID_ENV.items():
        monkeypatch.setenv(name, value)
    step = ScriptedStep()

    code = main(["scripted"], None, StepRegistry((step,)), io.StringIO())

    assert (code, step.seen_job_id) == (ExitCode.OK, VALID_ENV["JOB_ID"])


def test_happy_path_default_registry_offers_doctor_run_each_pipeline_step_and_the_worker() -> None:
    assert default_registry().names() == (
        "doctor",
        "run",
        "gather",
        "fetch",
        "extract",
        "stitch",
        "inspect",
        "locate",
        "place",
        "reference",
        "georef",
        "align",
        "merge",
        "warp",
        "export",
        "pyramid",
        "register",
        "worker",
    )


@pytest.mark.parametrize("argv", [[], ["warp"], ["--bogus"]])
def test_bad_path_missing_or_unknown_step_is_a_usage_error(argv: list[str]) -> None:
    code, entries = run(argv, ScriptedStep())

    assert code == ExitCode.USAGE
    assert str(entries[-1]["message"]).startswith("usage: ")
    assert str(entries[-1]["message"]).endswith("(steps: scripted)")


def test_bad_path_incomplete_environment_exits_with_config_code() -> None:
    step = ScriptedStep()

    code, entries = run(["scripted"], step, env={"JOB_ID": "job-1"})

    assert code == ExitCode.CONFIG
    assert step.seen_job_id is None
    assert "CITY_ID is not set" in str(entries[-1]["message"])


def test_bad_path_step_error_exits_with_its_code() -> None:
    code, entries = run(["scripted"], ScriptedStep(error=StepError("no reference coverage", ExitCode.CONFIG)))

    assert code == ExitCode.CONFIG
    assert entries[-1]["message"] == "step scripted failed: no reference coverage"
    assert entries[-1]["severity"] == "ERROR"


def test_bad_path_crash_is_logged_redacted_and_fails() -> None:
    code, entries = run(["scripted"], ScriptedStep(error=RuntimeError("upstream said X-Auth-Token: leaked-key-123")))

    assert code == ExitCode.FAILED
    assert entries[-1]["message"] == "step scripted crashed"
    assert "leaked-key-123" not in json.dumps(entries)
    assert "RuntimeError" in str(entries[-1]["exception"])


def test_happy_path_module_entry_point_exits_with_main_code(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delitem(sys.modules, "hcm_pipeline.__main__", raising=False)
    monkeypatch.setattr(sys, "argv", ["hcm_pipeline", "--list"])

    with pytest.raises(SystemExit) as caught:
        runpy.run_module("hcm_pipeline", run_name="__main__")

    assert caught.value.code == ExitCode.OK


def test_happy_path_importing_the_entry_module_runs_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delitem(sys.modules, "hcm_pipeline.__main__", raising=False)

    module = importlib.import_module("hcm_pipeline.__main__")

    assert module.main is main
