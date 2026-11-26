"""sonar_report.py: configuration, CE-task polling, the clean bar and the exit codes, against a fake HTTPS server.

No request leaves the process: `sonar_report.CONNECT` is replaced by FakeConnection, which answers
from a table keyed by API path and records every request (method, target and headers).
"""

import json
import runpy
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
import sonar_report as sonar
from treeutil import write

SCRIPT = Path(sonar.__file__)
PROPERTIES = "sonar.organization=ventura8\nsonar.projectKey=ventura8_x\nsonar.host.url=https://sonar.example.invalid/sq/\n"
FAKE_TOKEN = "fake-token"
CLEAN_MEASURES = {"coverage": "97.5", "line_coverage": "98", "branch_coverage": "95", "duplicated_blocks": "0", "bugs": "0"}

Answer = tuple[int, str] | OSError


def ok(body: dict[str, Any]) -> tuple[int, str]:
    return 200, json.dumps(body)


def measures_body(values: dict[str, str]) -> dict[str, Any]:
    return {"component": {"measures": [{"metric": metric, "value": value} for metric, value in values.items()]}}


def clean_answers() -> dict[str, list[Answer]]:
    return {
        "ce/task": [ok({"task": {"status": "IN_PROGRESS"}}), ok({"task": {"status": "SUCCESS", "analysisId": "AX1"}})],
        "qualitygates/project_status": [ok({"projectStatus": {"status": "OK"}})],
        "measures/component": [ok(measures_body(CLEAN_MEASURES))],
        "issues/search": [ok({"issues": [], "paging": {"total": 0}})],
        "hotspots/search": [ok({"hotspots": [], "paging": {"total": 0}})],
    }


class FakeServer:
    """Answers by API path (each list is consumed in order, its last answer repeats); records requests."""

    def __init__(self, answers: dict[str, list[Answer]]) -> None:
        self.answers = answers
        self.requests: list[tuple[str, str, str, dict[str, str]]] = []

    def connect(self, host: str, timeout: float) -> FakeConnection:
        assert timeout == sonar.TIMEOUT_S
        return FakeConnection(self, host)

    def answer(self, target: str) -> Answer:
        path = target.split("/api/", 1)[1].split("?", 1)[0]
        queue = self.answers[path]
        return queue.pop(0) if len(queue) > 1 else queue[0]


class FakeResponse:
    def __init__(self, status: int, payload: str) -> None:
        self.status = status
        self.payload = payload

    def read(self) -> bytes:
        return self.payload.encode("utf-8")


class FakeConnection:
    def __init__(self, server: FakeServer, host: str) -> None:
        self.server = server
        self.host = host
        self.target = ""
        self.closed = False

    def request(self, method: str, target: str, headers: dict[str, str]) -> None:
        self.target = target
        self.server.requests.append((self.host, method, target, headers))

    def getresponse(self) -> FakeResponse:
        answer = self.server.answer(self.target)
        if isinstance(answer, OSError):
            raise answer
        return FakeResponse(*answer)

    def close(self) -> None:
        self.closed = True


@pytest.fixture
def server(monkeypatch: pytest.MonkeyPatch) -> Callable[[dict[str, list[Answer]]], FakeServer]:
    def install(answers: dict[str, list[Answer]]) -> FakeServer:
        fake = FakeServer(answers)
        monkeypatch.setattr(sonar, "CONNECT", fake.connect)
        return fake

    monkeypatch.setattr(sonar, "SLEEP", lambda _seconds: None)
    for name in ("SONAR_TOKEN", "SONAR_ORGANIZATION", "SONAR_PROJECT_KEY", "SONAR_HOST_URL"):
        monkeypatch.delenv(name, raising=False)
    return install


def project(root: Path, *, token: str | None = FAKE_TOKEN, task: bool = True) -> Path:
    write(root, "sonar-project.properties", PROPERTIES)
    if token is not None:
        write(root, ".sonar-token", f"  {token}  ")
    if task:
        write(root, ".scannerwork/report-task.txt", "projectKey=ventura8_x\nceTaskId=TASK1\n")
    return root


def run(root: Path, *extra: str) -> int:
    return sonar.main(["--root", str(root), *extra])


def targets(fake: FakeServer) -> list[str]:
    return [target for _, _, target, _ in fake.requests]


def api_paths(fake: FakeServer) -> set[str]:
    return {target.split("/api/", 1)[1].split("?", 1)[0] for target in targets(fake)}


def sent(fake: FakeServer) -> dict[str, set[str]]:
    """Hosts, methods and Authorization headers of every request."""
    return {
        "hosts": {host for host, _, _, _ in fake.requests},
        "methods": {method for _, method, _, _ in fake.requests},
        "auth": {headers["Authorization"] for _, _, _, headers in fake.requests},
    }


# --- happy paths ---------------------------------------------------------------------------------


def test_happy_path_clean_analysis_exits_0(tmp_path: Path, server: Callable[..., FakeServer], caplog: pytest.LogCaptureFixture) -> None:
    fake = server(clean_answers())

    assert run(project(tmp_path)) == 0
    assert sent(fake) == {"hosts": {"sonar.example.invalid"}, "methods": {"GET"}, "auth": {"Bearer fake-token"}}
    assert {"/sq/api/ce/task?id=TASK1", "/sq/api/qualitygates/project_status?analysisId=AX1"} <= set(targets(fake))
    assert (caplog.messages[-1], FAKE_TOKEN in caplog.text) == (
        "[sonar] clean: quality gate OK, no open issues, hotspots or duplications, coverage at the bar",
        False,
    )


def test_happy_path_branch_scope_and_environment_overrides(
    tmp_path: Path, server: Callable[..., FakeServer], monkeypatch: pytest.MonkeyPatch
) -> None:
    answers = clean_answers()
    answers["ce/task"] = [ok({"task": {"status": "SUCCESS"}})]
    fake = server(answers)
    monkeypatch.setenv("SONAR_TOKEN", " env-token ")
    monkeypatch.setenv("SONAR_PROJECT_KEY", "other_key")
    monkeypatch.setenv("SONAR_HOST_URL", "https://other.example.invalid")

    assert run(project(tmp_path, token=None), "--branch", "feat/x") == 0
    assert {
        "/api/qualitygates/project_status?projectKey=other_key&branch=feat%2Fx",
        "/api/issues/search?componentKeys=other_key&organization=ventura8&resolved=false&branch=feat%2Fx&ps=100",
    } <= set(targets(fake))
    assert sent(fake)["auth"] == {"Bearer env-token"}


def test_happy_path_pull_request_scope_without_a_task_file(
    tmp_path: Path, server: Callable[..., FakeServer], caplog: pytest.LogCaptureFixture
) -> None:
    fake = server(clean_answers())

    assert run(project(tmp_path, task=False), "--pull-request", "42", "--branch", "ignored") == 0
    assert "ce/task" not in api_paths(fake)
    assert "/sq/api/measures/component?component=ventura8_x&metricKeys=" + "%2C".join(sonar.METRICS) + "&pullRequest=42" in targets(fake)
    assert caplog.messages[0].startswith("[sonar] no ")


def test_happy_path_task_file_without_an_id_reads_the_latest_analysis(
    tmp_path: Path, server: Callable[..., FakeServer], caplog: pytest.LogCaptureFixture
) -> None:
    fake = server(clean_answers())
    root = project(tmp_path, task=False)
    write(root, ".scannerwork/report-task.txt", "projectKey=ventura8_x")

    assert run(root) == 0
    assert "ce/task" not in api_paths(fake)
    assert caplog.messages[2].startswith(
        "[sonar] coverage 97.5 % (lines 98 %, branches 95 %), duplicated blocks 0, bugs 0, vulnerabilities ?"
    )


# --- not clean -----------------------------------------------------------------------------------


def test_bad_path_every_reason_is_listed(tmp_path: Path, server: Callable[..., FakeServer], caplog: pytest.LogCaptureFixture) -> None:
    answers = clean_answers()
    answers["qualitygates/project_status"] = [ok({"projectStatus": {"status": "ERROR"}})]
    answers["measures/component"] = [ok(measures_body({"coverage": "80.0", "duplicated_blocks": "3"}))]
    issue = {"type": "BUG", "severity": "MAJOR", "rule": "ts:S1", "component": "ventura8_x:packages/a.ts", "line": 3, "message": "Fix"}
    answers["issues/search"] = [ok({"issues": [issue, {"component": "ventura8_x:docker"}], "paging": {"total": 120}})]
    answers["hotspots/search"] = [
        ok({"hotspots": [{"vulnerabilityProbability": "HIGH", "component": "ventura8_x:a.py", "message": "Check"}]})
    ]
    server(answers)

    assert run(project(tmp_path)) == 1
    assert caplog.messages[-1] == (
        "[sonar] NOT CLEAN: quality gate ERROR; 120 open issue(s); 1 hotspot(s) to review; 3 duplicated block(s); coverage 80.0 % < 90.0 %"
    )
    assert {"  - BUG MAJOR ts:S1 packages/a.ts:3: Fix", "  - ? ? ? docker: ", "  - HOTSPOT HIGH a.py: Check"} <= set(caplog.messages)


def test_bad_path_missing_coverage_is_not_clean(
    tmp_path: Path, server: Callable[..., FakeServer], caplog: pytest.LogCaptureFixture
) -> None:
    answers = clean_answers()
    answers["measures/component"] = [ok({})]
    server(answers)

    assert run(project(tmp_path), "--min-coverage", "0") == 1
    assert caplog.messages[-1] == "[sonar] NOT CLEAN: no coverage reported (did the LCOV and Cobertura reports reach the scanner?)"


# --- not configured or refused (exit 2) ----------------------------------------------------------


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda root: (root / ".sonar-token").unlink(), "not configured: set SONAR_TOKEN or create .sonar-token"),
        (
            lambda root: write(root, "sonar-project.properties", "sonar.projectKey=x"),
            "not configured: sonar.organization and sonar.projectKey",
        ),
        (lambda root: (root / "sonar-project.properties").unlink(), "cannot read"),
        (
            lambda root: write(root, "sonar-project.properties", PROPERTIES.replace("https://", "http://")),
            "the host must be an https:// URL",
        ),
    ],
)
def test_bad_path_unconfigured_project_exits_2(
    tmp_path: Path, server: Callable[..., FakeServer], caplog: pytest.LogCaptureFixture, change: Callable[[Path], object], message: str
) -> None:
    fake = server(clean_answers())
    root = project(tmp_path)
    change(root)

    assert run(root) == 2
    assert message in caplog.messages[-1]
    assert fake.requests == []


@pytest.mark.parametrize(
    ("answer", "message"),
    [
        ((401, ""), "refused the token (401)"),
        ((500, "boom"), "answered 500 for ce/task: boom"),
        ((200, "<html>"), "with a body that is not JSON"),
        ((200, "[]"), "with JSON that is not an object"),
        (OSError("no route"), "is unreachable: no route"),
        (ok({"task": {"status": "FAILED"}}), "analysis task TASK1 ended FAILED"),
    ],
)
def test_bad_path_server_failures_exit_2(
    tmp_path: Path, server: Callable[..., FakeServer], caplog: pytest.LogCaptureFixture, answer: Answer, message: str
) -> None:
    answers = clean_answers()
    answers["ce/task"] = [answer]
    server(answers)

    assert run(project(tmp_path)) == 2
    assert message in caplog.messages[-1]


def test_bad_path_slow_analysis_times_out(
    tmp_path: Path, server: Callable[..., FakeServer], monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    answers = clean_answers()
    answers["ce/task"] = [ok({"task": {"status": "PENDING"}})]
    server(answers)
    clock = iter([0.0, 10.0, sonar.TASK_TIMEOUT_S + 1.0])
    monkeypatch.setattr(sonar, "MONOTONIC", lambda: next(clock))

    assert run(project(tmp_path)) == 2
    assert caplog.messages[-1] == f"[sonar] analysis task TASK1 still PENDING after {sonar.TASK_TIMEOUT_S} s"


def test_happy_path_empty_body_is_an_empty_object() -> None:
    assert sonar.parse_response("https://h", "x", 204, "  ") == {}


def test_bad_path_script_entry_point_exits_2_without_a_token(
    tmp_path: Path, server: Callable[..., FakeServer], monkeypatch: pytest.MonkeyPatch
) -> None:
    # runpy re-imports the module, so its own seams are the real ones: it must stop before any request.
    server(clean_answers())
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--root", str(project(tmp_path, token=None))])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(SCRIPT), run_name="__main__")

    assert exit_info.value.code == 2


# --- --check-reports (before a scan) ------------------------------------------------------------------

REPORTS = (
    "sonar.javascript.lcov.reportPaths=reports/coverage/ts/lcov.info\n"
    "sonar.python.coverage.reportPaths=reports/coverage/scripts.xml, reports/coverage/pipeline.xml\n"
    "sonar.python.xunit.reportPath=reports/junit/pytest.xml\n"
)
REPORT_FILES = (
    "reports/coverage/ts/lcov.info",
    "reports/coverage/scripts.xml",
    "reports/coverage/pipeline.xml",
    "reports/junit/pytest.xml",
)


def reports_project(root: Path, properties: str = PROPERTIES + REPORTS) -> Path:
    write(root, "sonar-project.properties", properties)
    for report in REPORT_FILES:
        write(root, report, "<coverage/>")
    return root


def test_happy_path_check_reports_needs_no_token_and_no_server(
    tmp_path: Path, server: Callable[..., FakeServer], caplog: pytest.LogCaptureFixture
) -> None:
    fake = server(clean_answers())

    assert run(reports_project(tmp_path), "--check-reports") == 0
    assert caplog.messages[-1] == "[sonar] 4 coverage and test reports present"
    assert fake.requests == []


def test_bad_path_check_reports_lists_missing_and_empty_reports(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    root = reports_project(tmp_path)
    (root / "reports/coverage/pipeline.xml").unlink()
    (root / "reports/junit/pytest.xml").write_text("", encoding="utf-8")

    assert run(root, "--check-reports") == 2
    assert caplog.messages[-1] == "[sonar] missing or empty reports: reports/coverage/pipeline.xml, reports/junit/pytest.xml"


@pytest.mark.parametrize(
    ("properties", "message"),
    [(PROPERTIES, "[sonar] missing or empty reports: (none configured)"), (None, "[sonar] cannot read ")],
)
def test_bad_path_check_reports_without_report_settings_exits_2(
    tmp_path: Path, caplog: pytest.LogCaptureFixture, properties: str | None, message: str
) -> None:
    if properties is not None:
        write(tmp_path, "sonar-project.properties", properties)

    assert run(tmp_path, "--check-reports") == 2
    assert caplog.messages[-1].startswith(message)
