#!/usr/bin/env python3
"""What SonarQube Cloud says about the last analysis, and whether it is clean enough to ship.

    python3 scripts/ci/sonar_report.py --report-task .scannerwork/report-task.txt [--min-coverage 90]
    python3 scripts/ci/sonar_report.py --check-reports   # before a scan: every report the scan reads is there

Clean means (the sibling repositories' release bar): the quality gate is OK, no open issue of any
type, no security hotspot left to review, no duplicated block, and overall coverage as the server
reports it at or above `--min-coverage`. The `sonar` stage runs this after
scripts/ci/sonar_scan.sh, and the CI Sonar job after the scan action.

The scanner uploads and leaves; the server processes the analysis afterwards (a "CE task"). The
report first waits for that task (`ceTaskId` in the scanner's report-task.txt, polled every 5 s for
up to 10 min), then reads the quality gate of exactly that analysis.

Organisation, project key and host come from sonar-project.properties (overridable with
SONAR_ORGANIZATION, SONAR_PROJECT_KEY, SONAR_HOST_URL). The token comes from SONAR_TOKEN or the
git-ignored `.sonar-token`; it is only ever sent as a Bearer header over HTTPS
(`http.client.HTTPSConnection` speaks nothing else) and never printed, logged or put on a
command line. Ported from the sibling Watch-GPS-Dashboard script.

`--check-reports` needs no token and no network: it only checks that every coverage and test report
named in sonar-project.properties exists and is not empty, so scripts/ci/sonar_scan.sh never uploads
an analysis without coverage (which would then fail the coverage bar for a reason nobody can see).

Exit status: 0 clean, 1 not clean, 2 not configured, or the server refused or failed (and, with
`--check-reports`: 0 every report present, 2 one missing).
"""

import argparse
import http.client
import json
import os
import sys
import time
import urllib.parse
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import sonar_properties
from cilog import get_logger
from cirepo import ROOT
from sonar_properties import PropertiesError

LOG = get_logger("sonar")

DEFAULT_HOST = "https://sonarcloud.io"
DEFAULT_MIN_COVERAGE = 90.0
TOKEN_FILE = Path(".sonar-token")
DEFAULT_REPORT_TASK = Path(".scannerwork", "report-task.txt")
TASK_POLL_S = 5
TASK_TIMEOUT_S = 600
TIMEOUT_S = 30
PAGE_SIZE = 100
HTTP_BAD_REQUEST = 400
REFUSED = (401, 403)
PAYLOAD_EXCERPT = 200
METRICS = (
    "coverage",
    "line_coverage",
    "branch_coverage",
    "duplicated_blocks",
    "bugs",
    "vulnerabilities",
    "code_smells",
    "security_hotspots",
)
# The analysis reads these reports (written by the tests stage); --check-reports requires each of them.
REPORT_KEYS = ("sonar.javascript.lcov.reportPaths", "sonar.python.coverage.reportPaths", "sonar.python.xunit.reportPath")
TASK_DONE = "SUCCESS"
TASK_FAILED = ("FAILED", "CANCELED")

Json = dict[str, Any]
# Seams for the tests: the HTTPS connection class, the clock and the sleep.
Connect = Callable[..., http.client.HTTPSConnection]
CONNECT: Connect = http.client.HTTPSConnection
MONOTONIC: Callable[[], float] = time.monotonic
SLEEP: Callable[[float], None] = time.sleep


class SonarError(RuntimeError):
    """Sonar is not configured, or the server refused or failed: exit 2."""


@dataclass(frozen=True)
class Config:
    host: str
    token: str
    organization: str
    project_key: str
    branch: str | None = None
    pull_request: str | None = None

    def scope(self) -> dict[str, str]:
        """The branch or pull-request parameter every per-analysis endpoint takes."""
        if self.pull_request:
            return {"pullRequest": self.pull_request}
        return {"branch": self.branch} if self.branch else {}


def call(cfg: Config, path: str, params: Mapping[str, str]) -> Json:
    """GETs `/api/<path>` and returns the parsed body ({} when empty).

    HTTPS is structural, not a convention: the connection class speaks nothing else, so a host
    typed with `http://` is refused before a byte leaves the machine.
    """
    parsed = urllib.parse.urlsplit(cfg.host)
    if parsed.scheme != "https" or not parsed.netloc:
        raise SonarError(f"the host must be an https:// URL, got {cfg.host!r}")
    target = f"{parsed.path.rstrip('/')}/api/{path}?{urllib.parse.urlencode(params)}"
    connection = CONNECT(parsed.netloc, timeout=TIMEOUT_S)
    try:
        # Bearer, never credentials in the URL or argv: the token stays out of logs and the process table.
        connection.request("GET", target, headers={"Authorization": f"Bearer {cfg.token}"})
        response = connection.getresponse()
        status, payload = response.status, response.read().decode("utf-8", "replace")
    except OSError as error:
        raise SonarError(f"{cfg.host} is unreachable: {error}") from error
    finally:
        connection.close()
    return parse_response(cfg.host, path, status, payload)


def check_status(host: str, path: str, status: int, payload: str) -> None:
    if status in REFUSED:
        raise SonarError(f"{host} refused the token ({status}): create a new one at {host}/account/security")
    if status >= HTTP_BAD_REQUEST:
        raise SonarError(f"{host} answered {status} for {path}: {payload[:PAYLOAD_EXCERPT]}")


def parse_body(host: str, path: str, payload: str) -> Json:
    try:
        body = json.loads(payload) if payload.strip() else {}
    except ValueError as error:
        raise SonarError(f"{host} answered {path} with a body that is not JSON") from error
    if not isinstance(body, dict):
        raise SonarError(f"{host} answered {path} with JSON that is not an object")
    return body


def parse_response(host: str, path: str, status: int, payload: str) -> Json:
    check_status(host, path, status, payload)
    return parse_body(host, path, payload)


# --- configuration -------------------------------------------------------------------------------


def read_token(root: Path) -> str:
    """SONAR_TOKEN, else the git-ignored .sonar-token; never logged."""
    token = os.environ.get("SONAR_TOKEN", "").strip()
    path = root / TOKEN_FILE
    if not token and path.is_file():
        token = path.read_text(encoding="utf-8").strip()
    if not token:
        raise SonarError(f"not configured: set SONAR_TOKEN or create {TOKEN_FILE} (docs/SETUP.md)")
    return token


def load_properties(root: Path) -> dict[str, str]:
    try:
        return sonar_properties.read(root / sonar_properties.PROPERTIES_FILE)
    except PropertiesError as error:
        raise SonarError(str(error)) from error


def setting(props: Mapping[str, str], variable: str, key: str, default: str = "") -> str:
    """An environment override, else the sonar-project.properties value, else the default."""
    return os.environ.get(variable) or props.get(key) or default


def config(root: Path, args: argparse.Namespace) -> Config:
    props = load_properties(root)
    organization = setting(props, "SONAR_ORGANIZATION", "sonar.organization")
    project_key = setting(props, "SONAR_PROJECT_KEY", "sonar.projectKey")
    if not (organization and project_key):
        raise SonarError("not configured: sonar.organization and sonar.projectKey belong in sonar-project.properties")
    host = setting(props, "SONAR_HOST_URL", "sonar.host.url", DEFAULT_HOST)
    return Config(host, read_token(root), organization, project_key, args.branch, args.pull_request)


# --- the reports a scan reads --------------------------------------------------------------------


def report_paths(props: Mapping[str, str]) -> list[str]:
    return [path for key in REPORT_KEYS for path in sonar_properties.split_list(props.get(key, ""))]


def is_missing(path: Path) -> bool:
    return not path.is_file() or path.stat().st_size == 0


def missing_reports(root: Path, paths: Sequence[str]) -> list[str]:
    if not paths:
        return ["(none configured)"]
    return [path for path in paths if is_missing(root / path)]


def check_reports(root: Path) -> int:
    """0 when every coverage and test report of sonar-project.properties exists and is not empty, else 2."""
    try:
        paths = report_paths(load_properties(root))
    except SonarError as error:
        LOG.error("[sonar] %s", error)
        return 2
    missing = missing_reports(root, paths)
    if missing:
        LOG.error("[sonar] missing or empty reports: %s", ", ".join(missing))
        return 2
    LOG.info("[sonar] %d coverage and test reports present", len(paths))
    return 0


# --- the analysis --------------------------------------------------------------------------------


def task_id(report_task: Path) -> str | None:
    """`ceTaskId` of the scanner's report-task.txt, or None without one."""
    if not report_task.is_file():
        return None
    props = sonar_properties.parse(report_task.read_text(encoding="utf-8"))
    return props.get("ceTaskId") or None


def task_status(cfg: Config, ce_task: str) -> tuple[str, str | None]:
    task = call(cfg, "ce/task", {"id": ce_task}).get("task") or {}
    return str(task.get("status", "")), task.get("analysisId")


def check_progress(ce_task: str, status: str, deadline: float) -> None:
    """Raises when the analysis task failed, or is still unfinished past the deadline."""
    if status in TASK_FAILED:
        raise SonarError(f"the server's processing of analysis task {ce_task} ended {status}")
    if MONOTONIC() > deadline:
        raise SonarError(f"analysis task {ce_task} still {status or 'unknown'} after {TASK_TIMEOUT_S} s")


def wait_for_analysis(cfg: Config, report_task: Path) -> str | None:
    """Waits until the server has processed the uploaded analysis; returns its analysis id (None without a task file)."""
    ce_task = task_id(report_task)
    if ce_task is None:
        LOG.info("[sonar] no %s: reading the latest analysis", report_task)
        return None
    deadline = MONOTONIC() + TASK_TIMEOUT_S
    status, analysis = task_status(cfg, ce_task)
    while status != TASK_DONE:
        check_progress(ce_task, status, deadline)
        SLEEP(TASK_POLL_S)
        status, analysis = task_status(cfg, ce_task)
    return analysis


def gate_status(cfg: Config, analysis: str | None) -> str:
    params = {"analysisId": analysis} if analysis else {"projectKey": cfg.project_key, **cfg.scope()}
    return str((call(cfg, "qualitygates/project_status", params).get("projectStatus") or {}).get("status", "NONE"))


def measures(cfg: Config) -> dict[str, str]:
    params = {"component": cfg.project_key, "metricKeys": ",".join(METRICS), **cfg.scope()}
    found = (call(cfg, "measures/component", params).get("component") or {}).get("measures") or []
    return {str(item["metric"]): str(item.get("value", "")) for item in found}


def search(cfg: Config, path: str, params: Mapping[str, str], key: str) -> tuple[int, list[Json]]:
    """(total, first page) of an issues or hotspots search."""
    body = call(cfg, path, {**params, **cfg.scope(), "ps": str(PAGE_SIZE)})
    items = list(body.get(key) or [])
    return int((body.get("paging") or {}).get("total", len(items))), items


def where(item: Json, key: str) -> str:
    component = str(item.get("component", "")).removeprefix(f"{key}:")
    line = item.get("line")
    return f"{component}:{line}" if line else component


# --- the verdict ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class Findings:
    status: str
    values: dict[str, str]
    issues: tuple[int, list[Json]]
    hotspots: tuple[int, list[Json]]


def collect(cfg: Config, analysis: str | None) -> Findings:
    issues = search(
        cfg, "issues/search", {"componentKeys": cfg.project_key, "organization": cfg.organization, "resolved": "false"}, "issues"
    )
    hotspots = search(cfg, "hotspots/search", {"projectKey": cfg.project_key, "status": "TO_REVIEW"}, "hotspots")
    return Findings(gate_status(cfg, analysis), measures(cfg), issues, hotspots)


def log_findings(cfg: Config, found: Findings) -> None:
    values = {metric: found.values.get(metric, "?") for metric in METRICS}
    LOG.info("[sonar] %s: quality gate %s", cfg.project_key, found.status)
    LOG.info(
        "[sonar] coverage %s %% (lines %s %%, branches %s %%), duplicated blocks %s, bugs %s, "
        "vulnerabilities %s, code smells %s, hotspots %s",
        *values.values(),
    )
    for issue in found.issues[1]:
        LOG.info(
            "  - %s %s %s %s: %s",
            issue.get("type", "?"),
            issue.get("severity", "?"),
            issue.get("rule", "?"),
            where(issue, cfg.project_key),
            issue.get("message", ""),
        )
    for spot in found.hotspots[1]:
        LOG.info("  - HOTSPOT %s %s: %s", spot.get("vulnerabilityProbability", "?"), where(spot, cfg.project_key), spot.get("message", ""))


def number(values: Mapping[str, str], metric: str) -> float | None:
    try:
        return float(values.get(metric, ""))
    except ValueError:
        return None


def coverage_reason(values: Mapping[str, str], min_coverage: float) -> list[str]:
    coverage = number(values, "coverage")
    if coverage is None:
        return ["no coverage reported (did the LCOV and Cobertura reports reach the scanner?)"]
    return [f"coverage {coverage} % < {min_coverage} %"] if coverage < min_coverage else []


def reasons(found: Findings, min_coverage: float) -> list[str]:
    """Why the analysis is not clean (empty when it is)."""
    duplicated = number(found.values, "duplicated_blocks")
    checks = (
        (found.status != "OK", f"quality gate {found.status}"),
        (found.issues[0] > 0, f"{found.issues[0]} open issue(s)"),
        (found.hotspots[0] > 0, f"{found.hotspots[0]} hotspot(s) to review"),
        (bool(duplicated), f"{duplicated or 0:.0f} duplicated block(s)"),
    )
    return [reason for failed, reason in checks if failed] + coverage_reason(found.values, min_coverage)


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Report the SonarQube Cloud analysis and decide whether it is clean.")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    parser.add_argument("--report-task", type=Path, help=f"the scanner's report-task.txt (default: <root>/{DEFAULT_REPORT_TASK})")
    parser.add_argument("--min-coverage", type=float, default=DEFAULT_MIN_COVERAGE, help="the coverage bar in percent (default 90)")
    parser.add_argument("--branch", help="the analysed branch (default: the main branch)")
    parser.add_argument("--pull-request", help="the analysed pull request number")
    parser.add_argument("--check-reports", action="store_true", help="only check the reports a scan reads exist (no token needed)")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    root: Path = args.root
    if args.check_reports:
        return check_reports(root)
    try:
        cfg = config(root, args)
        found = collect(cfg, wait_for_analysis(cfg, args.report_task or root / DEFAULT_REPORT_TASK))
    except SonarError as error:
        LOG.error("[sonar] %s", error)
        return 2
    log_findings(cfg, found)
    problems = reasons(found, args.min_coverage)
    if problems:
        LOG.error("[sonar] NOT CLEAN: %s", "; ".join(problems))
        return 1
    LOG.info("[sonar] clean: quality gate OK, no open issues, hotspots or duplications, coverage at the bar")
    return 0


if __name__ == "__main__":
    sys.exit(main())
