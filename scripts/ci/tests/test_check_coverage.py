"""check_coverage.py: Sonar scope and scoring per file, missing and stale files, summary and badges."""

import argparse
import runpy
import sys
from collections.abc import Callable
from fractions import Fraction
from pathlib import Path

import check_coverage as gate
import pytest
from coverage_reports import FileCoverage
from defusedxml import ElementTree
from treeutil import init_repo, write

SCRIPT = Path(gate.__file__)
PROPERTIES = """sonar.sources=packages/a/src,scripts/ci
sonar.tests=scripts/ci/tests
sonar.exclusions=scripts/ci/tests/**,**/*.d.ts
sonar.coverage.exclusions=packages/a/src/generated/**
sonar.javascript.lcov.reportPaths=reports/lcov.info
sonar.python.coverage.reportPaths=reports/py.xml
"""
FULL_LCOV = "SF:packages/a/src/x.ts\nDA:1,1\nDA:2,1\nBRDA:2,0,0,1\nBRDA:2,0,1,1\nend_of_record\nSF:packages/a/src/index.ts\nend_of_record\n"
FULL_PY = (
    "<coverage><sources><source>scripts/ci</source></sources>"
    '<class filename="tool.py"><lines><line number="1" hits="1"/></lines></class></coverage>'
)


@pytest.fixture(autouse=True)
def no_step_summary(monkeypatch: pytest.MonkeyPatch) -> None:
    """The Actions step summary is only written where a test sets it."""
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)


def repo(root: Path, lcov: str = FULL_LCOV, cobertura: str = FULL_PY) -> Path:
    """A git repository with two TS sources, one Python source and their reports."""
    init_repo(root)
    write(root, ".gitignore", "reports/\nignored/")
    write(root, "sonar-project.properties", PROPERTIES)
    write(root, "packages/a/src/x.ts", "export const x = 1;")
    write(root, "packages/a/src/index.ts", "export { x } from './x.js';")
    write(root, "packages/a/src/types.d.ts", "export type T = string;")
    write(root, "packages/a/src/generated/table.ts", "export const t = [];")
    write(root, "packages/a/src/theme.css", ":root {}")
    write(root, "scripts/ci/tool.py", "VALUE = 1")
    write(root, "scripts/ci/tests/test_tool.py", "def test_x() -> None: ...")
    write(root, "reports/lcov.info", lcov)
    write(root, "reports/py.xml", cobertura)
    return root


def run_gate(root: Path, *extra: str) -> int:
    return gate.main(["--root", str(root), *extra])


# --- wildcards and scope -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("pattern", "path", "expected"),
    [
        ("**/node_modules/**", "node_modules/a/b.js", True),
        ("**/node_modules/**", "packages/x/node_modules/a.js", True),
        ("**/*.d.ts", "packages/a/src/types.d.ts", True),
        ("scripts/ci/tests/**", "scripts/ci/tests/test_a.py", True),
        ("scripts/ci/tests/**", "scripts/ci/tool.py", False),
        ("src/*.ts", "src/a/b.ts", False),
        ("src/?.ts", "src/a.ts", True),
        ("src/?.ts", "src/ab.ts", False),
        ("/docs/", "docs/a/b.md", True),
        ("file(1).ts", "file(1).ts", True),
        ("a\\b.ts", "a/b.ts", True),
    ],
)
def test_happy_path_sonar_wildcards(pattern: str, path: str, expected: bool) -> None:
    assert bool(gate.wildcard_regex(pattern).match(path)) is expected


SCOPE = {
    "sonar.sources": "src,lib/",
    "sonar.inclusions": "src/**,lib/**",
    "sonar.exclusions": "src/vendor/**",
    "sonar.coverage.exclusions": "src/gen/**",
}


@pytest.mark.parametrize(
    ("path", "reason"),
    [
        ("src/a.ts", None),
        ("src/a.css", "not a measured language"),
        ("tests/a.ts", "outside sonar.sources"),
        ("src/vendor/a.ts", "sonar.exclusions"),
        ("src/gen/a.ts", "sonar.coverage.exclusions"),
    ],
)
def test_happy_path_scope_gives_the_reason_a_file_is_not_measured(path: str, reason: str | None) -> None:
    assert gate.Scope.from_properties(SCOPE).reason(path) == reason


def test_happy_path_scope_sources_are_normalised() -> None:
    assert gate.Scope.from_properties(SCOPE).sources == ["src", "lib"]


def test_happy_path_default_scope_is_the_whole_tree() -> None:
    scope = gate.Scope.from_properties({"sonar.inclusions": "keep/**"})

    assert scope.reason("any/where.py") == "not in sonar.inclusions"
    assert scope.reason("keep/x.py") is None


def test_bad_path_absolute_file_patterns_are_rejected() -> None:
    with pytest.raises(gate.InputError, match="absolute 'file:' patterns"):
        gate.Scope.from_properties({"sonar.exclusions": "file:/abs/**"})


# --- the gate end to end -------------------------------------------------------------------------


def test_happy_path_fully_covered_repository_passes(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    root = repo(tmp_path)

    assert run_gate(root, "--verbose") == 0
    lines = caplog.messages[-1].splitlines()
    assert (lines[0].split()[0], lines[-1]) == (
        "FILE",
        "[coverage] OK: 3 files measured at >= 90.00% per file (overall 100.00%, branches 100.00%), 0 report entries out of scope",
    )
    assert [line.split()[0] for line in lines[1:-1]] == ["packages/a/src/index.ts", "packages/a/src/x.ts", "scripts/ci/tool.py"]


def test_happy_path_summary_goes_to_its_file_and_the_actions_step_summary(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = repo(tmp_path / "repo")
    step_summary = tmp_path / "step-summary.md"
    step_summary.write_text("# Earlier step\n", encoding="utf-8")
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(step_summary))

    assert run_gate(root, "--summary", "reports/out/summary.md") == 0
    assert (root / "reports/out/summary.md").read_text(encoding="utf-8").startswith("## Code Coverage Summary\n")
    assert step_summary.read_text(encoding="utf-8").startswith("# Earlier step\n## Code Coverage Summary")


def test_happy_path_badges_are_well_formed_svg(tmp_path: Path) -> None:
    root = repo(tmp_path)

    assert run_gate(root, "--badge-dir", "badges") == 0
    coverage_badge = (root / "badges/coverage.svg").read_text(encoding="utf-8")
    assert (ElementTree.fromstring(coverage_badge).get("aria-label"), 'fill="#4c1"' in coverage_badge) == ("coverage: 100%", True)
    assert ElementTree.fromstring((root / "badges/branches.svg").read_text(encoding="utf-8")).get("aria-label") == "branches: 100%"


def test_bad_path_file_below_the_bar_fails(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    lcov = FULL_LCOV.replace("BRDA:2,0,1,1", "BRDA:2,0,1,-").replace("DA:2,1", "DA:2,0")
    root = repo(tmp_path, lcov=lcov)

    assert run_gate(root) == 1
    assert caplog.messages[-1].splitlines() == [
        "FILE                | COVERAGE | LINES     | BRANCHES  | STATUS",
        "packages/a/src/x.ts |   50.00% | 1/2       | 1/2       | "
        "FAIL coverage 50.00% < 90.00%; line 50.00% < 90.00%; branch 50.00% < 90.00%",
        "[coverage] FAIL: 3 files measured at >= 90.00% per file (overall 60.00%, branches 50.00%), 0 report entries out of scope",
    ]


def test_bad_path_summary_marks_the_offender(tmp_path: Path) -> None:
    root = repo(tmp_path, lcov=FULL_LCOV.replace("BRDA:2,0,1,1", "BRDA:2,0,1,-").replace("DA:2,1", "DA:2,0"))
    summary = tmp_path / "summary.md"

    assert run_gate(root, "--summary", str(summary)) == 1
    assert {
        "| `packages/a/src/x.ts` | 50.00% | 1/2 | 1/2 | 2 | FAIL: coverage 50.00% < 90.00%; line 50.00% < 90.00%; branch 50.00% < 90.00% |",
        "| `scripts/ci/tool.py` | 100.00% | 1/1 | 0/0 | - | PASS |",
    } <= set(summary.read_text(encoding="utf-8").splitlines())


def test_bad_path_separate_line_and_branch_floors_apply(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    lcov = FULL_LCOV.replace("BRDA:2,0,1,1", "BRDA:2,0,1,-")
    root = repo(tmp_path, lcov=lcov)

    assert run_gate(root, "--min", "70", "--min-line", "100", "--min-branch", "60") == 1
    assert "FAIL branch 50.00% < 60.00%" in caplog.messages[-1]
    assert run_gate(root, "--min", "70", "--min-branch", "50") == 0


def test_bad_path_missing_and_stale_files_fail(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    lcov = FULL_LCOV + "SF:packages/a/src/deleted.ts\nDA:1,1\nend_of_record\nSF:packages/a/src/theme.css\nDA:1,1\nend_of_record\n"
    root = repo(tmp_path, lcov=lcov.replace("SF:packages/a/src/index.ts\nend_of_record\n", ""))
    summary = tmp_path / "summary.md"

    assert run_gate(root, "--summary", str(summary)) == 1
    assert caplog.messages[-1].splitlines()[:-1] == [
        "1 measured file(s) missing from the reports (SonarQube counts them as uncovered):",
        "  packages/a/src/index.ts",
        "1 stale report entr(y/ies): the file does not exist (regenerate the reports):",
        "  packages/a/src/deleted.ts",
    ]
    assert caplog.messages[-1].endswith("1 report entries out of scope")
    assert {
        "| `packages/a/src/index.ts` | - | - | - | - | FAIL: missing from the reports |",
        "| `packages/a/src/deleted.ts` | - | - | - | - | FAIL: stale report entry |",
    } <= set(summary.read_text(encoding="utf-8").splitlines())


def test_bad_path_reports_that_measure_nothing_fail(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    root = repo(tmp_path, lcov="", cobertura="<coverage/>")
    write(root, "sonar-project.properties", PROPERTIES.replace("packages/a/src,scripts/ci", "docs"))
    write(root, "docs/x.md", "# x")

    assert run_gate(root) == 1
    assert "the reports measure no file SonarQube analyses" in caplog.messages[-1]


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda root: (root / "sonar-project.properties").unlink(), "cannot read"),
        (lambda root: write(root, "reports/py.xml", "<broken"), "is not well-formed XML"),
        (lambda root: write(root, "sonar-project.properties", "sonar.sources=packages/a/src"), "no coverage report"),
        (
            lambda root: write(root, "sonar-project.properties", "sonar.sources=functions/src,x\nsonar.python.coverage.reportPaths=r.xml"),
            "functions/src, x",
        ),
    ],
)
def test_bad_path_unusable_input_exits_2(
    tmp_path: Path, caplog: pytest.LogCaptureFixture, change: Callable[[Path], object], message: str
) -> None:
    root = repo(tmp_path)
    change(root)

    assert run_gate(root) == 2
    assert caplog.messages[-1].startswith("[coverage] error: ")
    assert message in caplog.messages[-1]


def test_happy_path_explicit_report_options_override_the_properties(tmp_path: Path) -> None:
    root = repo(tmp_path)
    write(root, "other.info", FULL_LCOV)

    assert (
        run_gate(
            root,
            "--lcov",
            "other.info",
            "--cobertura",
            str(root / "reports/py.xml"),
            "--properties",
            str(root / "sonar-project.properties"),
        )
        == 0
    )


@pytest.mark.parametrize("value", ["abc", "101", "-1", "1/0"])
def test_bad_path_invalid_floor_is_a_usage_error(value: str) -> None:
    with pytest.raises(SystemExit) as exit_info:
        gate.parse_args(["--min", value])

    assert exit_info.value.code == 2


def test_happy_path_floors_default_to_min() -> None:
    args = argparse.Namespace(min=Fraction(80), min_line=None, min_branch=Fraction(0))

    assert gate.floors_from(args) == gate.Floors(Fraction(80), Fraction(80), Fraction(0))


# --- output helpers ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "colour", "text"),
    [
        (Fraction(100), "#4c1", "100%"),
        (Fraction(95), "#4c1", "95%"),
        (Fraction(9499, 100), "#97ca00", "94.9%"),
        (Fraction(80), "#dfb317", "80%"),
        (Fraction(50), "#fe7d37", "50%"),
        (Fraction(4999, 100), "#e05d44", "49.9%"),
    ],
)
def test_happy_path_badge_colour_ramp(value: Fraction, colour: str, text: str) -> None:
    assert gate.badge_colour(value) == colour
    assert gate.badge_value(value) == text


def test_happy_path_line_ranges_compress_runs() -> None:
    assert gate.line_ranges([3, 4, 5, 9, 11, 12]) == "3-5, 9, 11-12"
    assert gate.line_ranges([]) == ""


def test_happy_path_percentages_are_truncated_never_rounded_up() -> None:
    assert gate.pct_text(Fraction(8999, 100) + Fraction(9, 1000)) == "89.99%"


def test_happy_path_table_escapes_nothing_but_summary_escapes_pipes() -> None:
    cov = FileCoverage()
    cov.add(1, covered=True)
    result = gate.Result(scored={"a|b.ts": cov})

    assert "| `a\\|b.ts` |" in gate.summary_markdown(result, gate.Floors())
    assert gate.table_lines(result, verbose=False) == []


def test_happy_path_script_entry_point_exits_with_main_status(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = repo(tmp_path)
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--root", str(root)])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(SCRIPT), run_name="__main__")

    assert exit_info.value.code == 0
