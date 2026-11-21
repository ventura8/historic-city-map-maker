#!/usr/bin/env python3
"""Static gate: the e2e scenario registry, the tests and the generated scenario doc agree.

`e2e/scenarios.json` lists every user-visible scenario: `{"scenarios": [row, ...]}` where a row is

    {"id": "S-V01-BOOT", "behaviour": "V01", "area": "viewer", "path": "happy" | "bad",
     "title": "...", "asserts": "what the user sees", "tier": "e2e-viewer", "status": "exists" | "planned"}

plus an optional `"notes"`. Tests name the scenarios they cover: a Playwright test (a `*.spec.ts`, or a `*.tour.ts` of the
tour) carries the tag `@S-…` (`test('…', { tag: '@S-V01-BOOT' }, …)`), a pytest test a docstring line
`Scenarios: S-P01-IMPORT, S-P01-CORRUPT`. Checked in both directions:

* every row is well-formed, ids are unique, and every behaviour has at least one happy and at
  least one bad row (all in one area);
* every scenario a test names is registered;
* every `exists` row is named by at least one test, and no `planned` row is (mark it `exists`).

`write` renders `docs/E2E_SCENARIOS.md` from the registry and the tests; `check` (the static
gate) fails when that file is out of date. Its `## Counts` section is the only place in the
repository that states test counts. Until the registry exists (M1), a tree without tagged tests
passes with a notice. Ported from the sibling Fork-Linux gen-scenarios-doc.py (registry and doc)
with Watch-GPS's happy/bad rule.

Usage: check_e2e_matrix.py [check|write] [--root DIR]. Exit status: 0 OK, 1 problems found, 2 usage.
"""

import argparse
import json
import re
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from fnmatch import fnmatch
from itertools import chain
from pathlib import Path

from cilog import bullets, get_logger
from cirepo import ROOT, repository_files

LOG = get_logger("e2e-matrix")

REGISTRY = Path("e2e", "scenarios.json")
DOC = Path("docs", "E2E_SCENARIOS.md")
ID_PATTERN = r"S-[A-Z0-9]+(?:-[A-Z0-9]+)*"
ID_RE = re.compile(rf"^{ID_PATTERN}$")
TAG_RE = re.compile(rf"@({ID_PATTERN})\b")
# `Scenarios: S-A, S-B` on its own docstring line, or as a one-line docstring between triple quotes.
DECLARATION_RE = re.compile(r"^\s*(?:\"{3}|'{3})?\s*Scenarios:\s*(?P<ids>.+?)\s*(?:\"{3}|'{3})?\s*$", re.MULTILINE)
# Test files that may name scenarios (repository-relative globs; fnmatch's `*` crosses folders).
TEST_GLOBS = (
    "e2e/*.spec.ts",
    # The layout and accessibility tour (e2e/tour/*.tour.ts) backs V15 and V18.
    "e2e/*.tour.ts",
    "e2e/*.test.ts",
    "e2e/test_*.py",
    "e2e/*/test_*.py",
    "pipeline/tests/test_*.py",
    "pipeline/tests/*/test_*.py",
    "functions/test/*.test.ts",
    "firebase/rules-tests/*.test.ts",
    # Admin georef Undo (A131) and related matrix tags live in Vitest, not Playwright.
    "packages/admin/test/georef/*.test.ts",
    # Shared poly2 inverse parity (A16 / DECISIONS §144) lives in Vitest, not Playwright.
    "packages/shared/test/georef/*.test.ts",
)
# Area -> section title, in the doc's order.
AREAS = {
    "viewer": "Viewer",
    "admin": "Admin",
    "starter-kit": "Starter kit",
    "pipeline": "Raster pipeline",
    "functions": "Cloud Functions",
    "rules": "Firestore and Storage rules",
}
TIERS = ("e2e-viewer", "e2e-admin", "e2e-starter-kit", "e2e-pipeline", "functions", "rules")
PATHS = ("happy", "bad")
STATUSES = ("exists", "planned")
REQUIRED = ("id", "behaviour", "area", "path", "title", "asserts", "tier", "status")
OPTIONAL = ("notes",)
ENUMS: Mapping[str, Sequence[str]] = {"area": tuple(AREAS), "path": PATHS, "tier": TIERS, "status": STATUSES}


class RegistryError(Exception):
    """The registry file cannot be read as a list of rows at all."""


@dataclass(frozen=True)
class Scenario:
    id: str
    behaviour: str
    area: str
    path: str
    title: str
    asserts: str
    tier: str
    status: str
    notes: str = ""


@dataclass
class Matrix:
    """The registry rows and, per scenario id, the test files that name it."""

    scenarios: list[Scenario] = field(default_factory=list)
    tagged: dict[str, set[str]] = field(default_factory=dict)


# --- reading -------------------------------------------------------------------------------------


def is_text(value: object) -> bool:
    return isinstance(value, str) and bool(value)


def missing_fields(where: str, row: Mapping[str, object]) -> list[str]:
    return [f"{where}: '{key}' must be a non-empty string" for key in REQUIRED if not is_text(row.get(key))]


def unknown_fields(where: str, row: Mapping[str, object]) -> list[str]:
    return [f"{where}: unknown field '{key}'" for key in sorted(set(row) - set(REQUIRED) - set(OPTIONAL))]


def enum_problems(where: str, row: Mapping[str, object]) -> list[str]:
    return [
        f"{where}: {key} {row.get(key)!r} is not one of {', '.join(allowed)}"
        for key, allowed in ENUMS.items()
        if row.get(key) not in allowed
    ]


def id_problems(where: str, row: Mapping[str, object]) -> list[str]:
    value = row.get("id")
    return [f"{where}: id must match {ID_RE.pattern}"] if isinstance(value, str) and not ID_RE.match(value) else []


def row_problems(index: int, row: object) -> list[str]:
    """Why one registry row is malformed (empty when it is well-formed)."""
    if not isinstance(row, dict):
        return [f"row {index}: not an object"]
    where = f"row {index} ({row.get('id', '?')})"
    return missing_fields(where, row) + unknown_fields(where, row) + enum_problems(where, row) + id_problems(where, row)


def load_rows(path: Path) -> list[object]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise RegistryError(f"{path.name}: cannot read: {error}") from error
    rows = data.get("scenarios") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        raise RegistryError(f"{path.name}: expected an object with a 'scenarios' list")
    return rows


def parse_registry(rows: Sequence[object]) -> tuple[list[Scenario], list[str]]:
    """The well-formed rows as scenarios, and the problems of the others."""
    problems = [row_problems(index, row) for index, row in enumerate(rows)]
    scenarios = [Scenario(**row) for row, found in zip(rows, problems, strict=True) if isinstance(row, dict) and not found]
    return scenarios, list(chain.from_iterable(problems))


def declared_ids(text: str) -> list[str]:
    """Scenario ids a test file names: Playwright `@S-…` tags and `Scenarios:` docstring lines."""
    ids = TAG_RE.findall(text)
    for match in DECLARATION_RE.finditer(text):
        ids += [token.strip(" '\"") for token in re.split(r"[,\s]+", match.group("ids")) if token.strip(" '\"")]
    return ids


def is_test_file(name: str) -> bool:
    return any(fnmatch(name, pattern) for pattern in TEST_GLOBS)


def scan_tests(root: Path) -> dict[str, set[str]]:
    """Scenario id -> the test files (repository-relative) that name it."""
    tagged: dict[str, set[str]] = {}
    for name in filter(is_test_file, repository_files(root)):
        for scenario_id in declared_ids((root / name).read_text(encoding="utf-8")):
            tagged.setdefault(scenario_id, set()).add(name)
    return tagged


# --- checks --------------------------------------------------------------------------------------


def duplicate_ids(scenarios: Sequence[Scenario]) -> list[str]:
    ids = [scenario.id for scenario in scenarios]
    return [f"{scenario_id}: registered {ids.count(scenario_id)} times" for scenario_id in sorted(set(ids)) if ids.count(scenario_id) > 1]


def by_behaviour(scenarios: Sequence[Scenario]) -> dict[str, list[Scenario]]:
    groups: dict[str, list[Scenario]] = {}
    for scenario in scenarios:
        groups.setdefault(scenario.behaviour, []).append(scenario)
    return groups


def path_problems(behaviour: str, rows: Sequence[Scenario]) -> list[str]:
    paths = {row.path for row in rows}
    return [f"behaviour {behaviour}: no {path} scenario" for path in PATHS if path not in paths]


def area_problems(behaviour: str, rows: Sequence[Scenario]) -> list[str]:
    areas = sorted({row.area for row in rows})
    return [f"behaviour {behaviour}: rows in several areas ({', '.join(areas)})"] if len(areas) > 1 else []


def behaviour_problems(scenarios: Sequence[Scenario]) -> list[str]:
    """Behaviours without a happy or a bad row, or spread over several areas."""
    groups = by_behaviour(scenarios)
    return [problem for name in sorted(groups) for problem in path_problems(name, groups[name]) + area_problems(name, groups[name])]


def unknown_tags(matrix: Matrix) -> list[str]:
    known = {scenario.id for scenario in matrix.scenarios}
    return [
        f"{tag}: named by {', '.join(sorted(files))} but not registered" for tag, files in sorted(matrix.tagged.items()) if tag not in known
    ]


def status_problems(scenario: Scenario, files: set[str] | None) -> list[str]:
    """An `exists` row needs a test that names it; a `planned` row must not have one yet."""
    if scenario.status == "exists" and not files:
        return [f"{scenario.id}: status exists, but no test names it"]
    if scenario.status == "planned" and files:
        return [f"{scenario.id}: status planned, but {', '.join(sorted(files))} names it (mark it exists)"]
    return []


def tag_problems(matrix: Matrix) -> list[str]:
    """Both directions: unknown ids in tests, `exists` rows without a test, `planned` rows with one."""
    statuses = [problem for scenario in matrix.scenarios for problem in status_problems(scenario, matrix.tagged.get(scenario.id))]
    return unknown_tags(matrix) + statuses


def validate(matrix: Matrix) -> list[str]:
    return duplicate_ids(matrix.scenarios) + behaviour_problems(matrix.scenarios) + tag_problems(matrix)


# --- the generated doc ---------------------------------------------------------------------------


def _cell(text: str) -> str:
    return " ".join(text.split()).replace("|", "\\|") or "-"


def _tests_cell(files: set[str] | None) -> str:
    return "<br>".join(f"`{name}`" for name in sorted(files or ())) or "-"


def count(rows: Sequence[Scenario], field_name: str, value: str) -> int:
    return sum(getattr(row, field_name) == value for row in rows)


def counts_section(matrix: Matrix) -> list[str]:
    rows = matrix.scenarios
    values = (
        len({row.behaviour for row in rows}),
        len(rows),
        count(rows, "path", "happy"),
        count(rows, "path", "bad"),
        count(rows, "status", "exists"),
        count(rows, "status", "planned"),
        len(set(chain.from_iterable(matrix.tagged.values()))),
    )
    return [
        "## Counts",
        "",
        "| Behaviours | Scenarios | Happy | Bad | Exists | Planned | Test files |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| " + " | ".join(map(str, values)) + " |",
    ]


def area_section(area: str, matrix: Matrix) -> list[str]:
    rows = sorted((row for row in matrix.scenarios if row.area == area), key=lambda row: (row.behaviour, PATHS.index(row.path), row.id))
    if not rows:
        return []
    lines = [
        "",
        f"## {AREAS[area]}",
        "",
        "| ID | Behaviour | Path | Scenario | Asserts | Tier | Status | Tests |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    return lines + [table_row(row, matrix.tagged.get(row.id)) for row in rows]


def table_row(row: Scenario, files: set[str] | None) -> str:
    cells = (f"`{row.id}`", _cell(row.behaviour), row.path, _cell(row.title), _cell(row.asserts), row.tier, row.status, _tests_cell(files))
    return "| " + " | ".join(cells) + " |"


def render(matrix: Matrix) -> str:
    """docs/E2E_SCENARIOS.md: the counts, then one table per area."""
    lines = [
        "# E2E scenarios",
        "",
        f"<!-- Generated by scripts/ci/check_e2e_matrix.py from {REGISTRY.as_posix()}: do not edit; "
        "run `python3 scripts/ci/check_e2e_matrix.py write`. -->",
        "",
        "Every user-visible behaviour has at least one happy and one bad scenario. The registry is `e2e/scenarios.json`; "
        "a test names the scenarios it covers with a Playwright tag `@S-…` or a `Scenarios: S-…` docstring line, and "
        "`scripts/ci/check_e2e_matrix.py` (static gate) checks both directions.",
        "",
        *counts_section(matrix),
    ]
    for area in AREAS:
        lines += area_section(area, matrix)
    return "\n".join(lines) + "\n"


# --- command line --------------------------------------------------------------------------------


def load(root: Path) -> tuple[Matrix | None, list[str]]:
    """The matrix (None without a registry) and the registry's row problems."""
    tagged = scan_tests(root)
    if not (root / REGISTRY).is_file():
        return None, [f"{REGISTRY.as_posix()} does not exist, but tests name scenarios"] if tagged else []
    scenarios, problems = parse_registry(load_rows(root / REGISTRY))
    return Matrix(scenarios, tagged), problems


def doc_problems(root: Path, matrix: Matrix | None) -> list[str]:
    """`check`: the generated doc matches the registry (and does not exist without one)."""
    doc = root / DOC
    if matrix is None:
        return [f"{DOC.as_posix()} exists without {REGISTRY.as_posix()}"] if doc.exists() else []
    current = doc.read_text(encoding="utf-8") if doc.is_file() else None
    return [] if current == render(matrix) else [f"{DOC.as_posix()} is out of date: run python3 scripts/ci/check_e2e_matrix.py write"]


def write_doc(root: Path, matrix: Matrix | None) -> list[str]:
    if matrix is None:
        return [f"{REGISTRY.as_posix()} does not exist: nothing to render"]
    (root / DOC).parent.mkdir(parents=True, exist_ok=True)
    (root / DOC).write_text(render(matrix), encoding="utf-8")
    LOG.info("[e2e-matrix] wrote %s", DOC.as_posix())
    return []


def run(command: str, root: Path) -> list[str]:
    matrix, problems = load(root)
    if matrix is not None:
        problems += validate(matrix)
    if problems:
        return problems
    return write_doc(root, matrix) if command == "write" else doc_problems(root, matrix)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check the e2e scenario registry against the tests; render docs/E2E_SCENARIOS.md.")
    parser.add_argument("command", nargs="?", choices=("check", "write"), default="check")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    args = parser.parse_args(argv)
    root: Path = args.root
    try:
        problems = run(args.command, root)
    except RegistryError as error:
        problems = [str(error)]
    if problems:
        LOG.error("[e2e-matrix] FAILED:\n%s", bullets(problems))
        return 1
    present = (root / REGISTRY).is_file()
    LOG.info("[e2e-matrix] OK%s", "" if present else f": {REGISTRY.as_posix()} does not exist yet and no test names a scenario")
    return 0


if __name__ == "__main__":
    sys.exit(main())
