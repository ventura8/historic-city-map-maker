#!/usr/bin/env python3
"""Tests-stage gate: every Firestore rule expression was exercised by the rules tests.

Sonar and v8 cannot measure security rules, so the Firestore emulator's own rule-coverage report is
the measure (docs/research/design-review-testability.md §3.5). Two subcommands:

* `save` runs INSIDE `firebase emulators:exec`, right after Vitest (scripts/ci/run-emulated-tests.sh):
  it fetches `/emulator/v1/projects/<project>:ruleCoverage` (JSON) from FIRESTORE_EMULATOR_HOST and
  streams it into reports/rules/firestore-coverage.json. The emulator builds the answer in its heap from
  every evaluation of the run (about 290 MB of JSON), so only the JSON is asked for: the HTML view of the
  same report doubled that work and, asked at once, ran the emulator out of memory
  (docs/research/DECISIONS-for-review.md §180g). While the emulators run, `curl` gives it by hand.
* `check` (the `rules-coverage` gate) reads the saved JSON report and fails when
  1. an expression was never evaluated (an operand skipped by `&&`/`||` short-circuiting does not
     count as evaluated), or
  2. an `allow ...: if <condition>` never allowed a request or never denied one (a constant
     condition such as `if false` can only go one way, so it only has to be evaluated), or
  3. the report was produced from a different firebase/firestore.rules (stale report).

The Storage emulator has no coverage report; firebase/rules-tests covers storage.rules explicitly.

Usage: check_rules_coverage.py {save,check} [--root DIR]
"""

import argparse
import http.client
import json
import os
import re
import shutil
import sys
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from http import HTTPStatus
from pathlib import Path

from cilog import get_logger

LOG = get_logger("rules-coverage")
ROOT = Path(__file__).resolve().parents[2]

RULES = Path("firebase", "firestore.rules")
JSON_REPORT = Path("reports", "rules", "firestore-coverage.json")
DEFAULT_PROJECT = "demo-hcm"
TIMEOUT_SECONDS = 30
CHUNK_BYTES = 1 << 20
# The keys of one `values` entry of the report: the evaluated value and how often it was seen.
ENTRY_KEYS = frozenset({"value", "count"})
EXIT_FAILURE = 1
SNIPPET_LENGTH = 72

# The text right before a condition: `allow read, write: if `. Function bodies follow `return`.
ALLOW_PREFIX = re.compile(r"allow\s+\w+(?:\s*,\s*\w+)*\s*:\s*if\s*$")
PREFIX_WINDOW = 160
CONSTANT_CONDITIONS = frozenset({"true", "false"})

Fetch = Callable[[str, str, Path], None]


class CoverageError(RuntimeError):
    """The report cannot be fetched, read or matched to the rules."""


@dataclass(frozen=True)
class Expression:
    """One expression of the report with the outcomes the emulator recorded for it."""

    line: int
    column: int
    text: str
    outcomes: frozenset[str]
    condition: bool

    def where(self) -> str:
        return f"{RULES}:{self.line}:{self.column}"


def fetch_http(host: str, path: str, target: Path) -> None:
    """GET http://<host><path> from the local emulator, streamed into `target`; raises CoverageError unless it answers 200.

    The body goes to `<target>.part` in 1 MiB pieces and replaces `target` once complete (as long as its `Content-Length`): the
    report is never held whole here, and a broken transfer leaves no truncated report behind.
    """
    connection = http.client.HTTPConnection(host, timeout=TIMEOUT_SECONDS)
    part = target.with_name(f"{target.name}.part")
    try:
        connection.request("GET", path)
        response = connection.getresponse()
        if response.status != HTTPStatus.OK:
            raise CoverageError(f"GET {path} from {host} returned HTTP {response.status}")
        target.parent.mkdir(parents=True, exist_ok=True)
        with part.open("wb") as out:
            shutil.copyfileobj(response, out, CHUNK_BYTES)
        # A body cut short ends a read of a given size quietly: what the emulator announced and never sent is left over.
        if response.length:
            raise CoverageError(f"GET {path} from {host} ended {response.length} bytes early")
        part.replace(target)
    except (OSError, http.client.HTTPException) as error:
        raise CoverageError(f"cannot reach the Firestore emulator at {host}: {error!r}") from error
    finally:
        connection.close()
        part.unlink(missing_ok=True)


def save_report(root: Path, env: Mapping[str, str], fetch: Fetch) -> Path:
    """Fetches the JSON coverage report from the running emulator into reports/rules/firestore-coverage.json."""
    host = env.get("FIRESTORE_EMULATOR_HOST")
    if not host:
        raise CoverageError("FIRESTORE_EMULATOR_HOST is not set: run inside `firebase emulators:exec`")
    project = env.get("GCLOUD_PROJECT") or DEFAULT_PROJECT
    target = root / JSON_REPORT
    fetch(host, f"/emulator/v1/projects/{project}:ruleCoverage", target)
    return target


def compact_entry(entry: dict[str, object]) -> dict[str, object]:
    """`json.load`'s object_hook: a `values` entry keeps only what `outcome` reads of its value.

    An evaluated value can be a whole request or document (a `mapValue` of every field): kept, the report's ~290 MB took
    gigabytes of Python objects. Hooks run innermost first, so each entry's value is dropped as soon as it is read.
    """
    value = entry.get("value")
    if not isinstance(value, dict) or not entry.keys() <= ENTRY_KEYS:
        return entry
    return {"value": essence(value)}


def essence(value: Mapping[str, object]) -> dict[str, object]:
    """What `outcome` tells apart: skipped (`{}`), an error, a boolean and its value, or any other value."""
    if not value:
        return {}
    if "undefined" in value:
        return {"undefined": True}
    if "boolValue" in value:
        return {"boolValue": value["boolValue"]}
    return {"value": True}


def outcome(value: Mapping[str, object]) -> str | None:
    """`true`/`false` for booleans, `error`, `value` for anything else; None when short-circuited."""
    if not value:
        return None
    if "undefined" in value:
        return "error"
    if "boolValue" in value:
        return str(value["boolValue"] is True).lower()
    return "value"


def evaluated_values(node: Mapping[str, object]) -> list[Mapping[str, object]]:
    """The `value` of each `values` entry of a report node (none when it was never evaluated)."""
    entries = node.get("values")
    values = entries if isinstance(entries, list) else []
    return [entry.get("value") or {} for entry in values if isinstance(entry, dict)]


def outcomes_of(node: Mapping[str, object]) -> frozenset[str]:
    found = {outcome(value) for value in evaluated_values(node)}
    return frozenset(name for name in found if name is not None)


def children_of(node: Mapping[str, object]) -> list[Mapping[str, object]]:
    children = node.get("children")
    return [child for child in children if isinstance(child, dict)] if isinstance(children, list) else []


def walk(nodes: Sequence[Mapping[str, object]], root_level: bool) -> Iterator[tuple[Mapping[str, object], bool]]:
    """Every node of the expression trees, depth first, with whether it is a tree root."""
    for node in nodes:
        yield node, root_level
        yield from walk(children_of(node), root_level=False)


def position(node: Mapping[str, object]) -> tuple[int, int, int, int]:
    source = node.get("sourcePosition")
    if not isinstance(source, dict):
        raise CoverageError("an expression of the report has no sourcePosition")
    return (int(source["line"]), int(source["column"]), int(source["currentOffset"]), int(source["endOffset"]))


def to_expression(node: Mapping[str, object], is_root: bool, content: str) -> Expression:
    line, column, start, end = position(node)
    text = " ".join(content[start : end + 1].split())
    condition = is_root and ALLOW_PREFIX.search(content[max(0, start - PREFIX_WINDOW) : start]) is not None
    return Expression(line=line, column=column, text=text, outcomes=outcomes_of(node), condition=condition)


def expressions(report: Mapping[str, object], content: str) -> list[Expression]:
    roots = report.get("report")
    if not isinstance(roots, list):
        raise CoverageError("the report has no expression list (were the rules tests run?)")
    nodes = [node for node in roots if isinstance(node, dict)]
    return [to_expression(node, is_root, content) for node, is_root in walk(nodes, root_level=True)]


def condition_problem(outcomes: frozenset[str]) -> str | None:
    """Why an `allow` condition with these outcomes is not covered: it must both allow and deny."""
    if "true" not in outcomes:
        return "condition never allowed a request"
    if outcomes.isdisjoint({"false", "error"}):
        return "condition never denied a request"
    return None


def problem(expression: Expression) -> str | None:
    """Why `expression` is not covered, or None when it is."""
    if not expression.outcomes:
        return "never evaluated"
    if not expression.condition or expression.text in CONSTANT_CONDITIONS:
        return None
    return condition_problem(expression.outcomes)


def report_rules(report: Mapping[str, object]) -> str:
    rules = report.get("rules")
    files = rules.get("files") if isinstance(rules, dict) else None
    if not isinstance(files, list) or len(files) != 1 or not isinstance(files[0], dict):
        raise CoverageError("the report must contain exactly one rules file")
    return str(files[0].get("content", ""))


def load_report(path: Path) -> Mapping[str, object]:
    try:
        with path.open(encoding="utf-8") as report:
            data = json.load(report, object_hook=compact_entry)
    except FileNotFoundError as error:
        raise CoverageError(f"{path} not found: run the tests stage (Vitest under `firebase emulators:exec`) first") from error
    except json.JSONDecodeError as error:
        raise CoverageError(f"{path} is not JSON: {error}") from error
    if not isinstance(data, dict):
        raise CoverageError(f"{path} is not a coverage report object")
    return data


def check_report(root: Path) -> list[str]:
    """Every coverage problem of the saved report, as `firebase/firestore.rules:LINE:COL reason: snippet`."""
    report = load_report(root / JSON_REPORT)
    content = report_rules(report)
    if content != (root / RULES).read_text(encoding="utf-8"):
        raise CoverageError(f"{JSON_REPORT} was produced from different rules than {RULES}: rerun the tests stage")
    found = [(expression, problem(expression)) for expression in expressions(report, content)]
    return [f"{item.where()} {reason}: {item.text[:SNIPPET_LENGTH]}" for item, reason in found if reason is not None]


def run_check(root: Path) -> int:
    problems = check_report(root)
    for line in problems:
        LOG.error("  %s", line)
    if problems:
        LOG.error("[FAILURE] rules coverage: %d uncovered expression(s) in %s", len(problems), RULES)
        return EXIT_FAILURE
    LOG.info("[SUCCESS] rules coverage: every expression of %s evaluated, every condition allowed and denied", RULES)
    return 0


def run_save(root: Path, env: Mapping[str, str], fetch: Fetch) -> int:
    LOG.info("rules coverage report saved: %s", save_report(root, env, fetch).relative_to(root))
    return 0


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Save or check the Firestore emulator's rule-coverage report.")
    parser.add_argument("command", choices=("save", "check"), help="save: fetch from the emulator; check: gate on the saved report")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None, env: Mapping[str, str] | None = None, fetch: Fetch = fetch_http) -> int:
    args = parse_args(argv)
    try:
        if args.command == "save":
            return run_save(args.root, os.environ if env is None else env, fetch)
        return run_check(args.root)
    except CoverageError as error:
        LOG.error("[FAILURE] rules coverage: %s", error)
        return EXIT_FAILURE


if __name__ == "__main__":
    sys.exit(main())
