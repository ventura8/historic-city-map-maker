#!/usr/bin/env python3
"""Tests-stage gate: every source file SonarQube measures reaches the per-file coverage bar.

    check_coverage.py [--root DIR] [--properties FILE] [--lcov FILE ...] [--cobertura FILE ...]
                      [--min PCT] [--min-line PCT] [--min-branch PCT]
                      [--summary FILE] [--badge-dir DIR] [--verbose]

The scope is read from sonar-project.properties itself (Java .properties rules, SonarQube
wildcards): `sonar.sources`, `sonar.inclusions`, `sonar.exclusions`, `sonar.coverage.exclusions`
and both report keys (`sonar.javascript.lcov.reportPaths` for the TypeScript LCOV,
`sonar.python.coverage.reportPaths` for the Python Cobertura XML), so the gate can never drift
from Sonar's own view. Like the scanner, files git ignores are not analysed, and a missing
`sonar.sources` folder is an error.

Each file is scored the way Sonar scores it: (covered lines + covered conditions) / (lines +
conditions), with line and branch coverage held to their own floors too. A file with nothing to
cover (a re-export-only `index.ts`) counts as covered. The gate fails on a file below a bar, on a
measured file missing from the reports (Sonar would count it uncovered) and on a stale report
entry (the file no longer exists).

It logs a `FILE | COVERAGE | LINES | BRANCHES | STATUS` table, writes the Markdown summary
(`--summary`, also appended to `$GITHUB_STEP_SUMMARY` in Actions) and the README badges
`coverage.svg` and `branches.svg` (`--badge-dir`) with the shields colour ramp.

Ported from the sibling Fork-Linux check-coverage.py (scope, Sonar scoring, missing and stale
files) with an LCOV reader, per-language line and branch floors, summary and badges added.
Exit status: 0 every file passes, 1 the gate failed, 2 bad input (report, properties or option).
"""

import argparse
import math
import os
import posixpath
import re
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path

import sonar_properties
from cilog import get_logger
from cirepo import ROOT, repository_files
from coverage_reports import HUNDRED, Coverage, FileCoverage, ReportError, merge_reports, percent, read_cobertura, read_lcov
from sonar_properties import PropertiesError, split_list

LOG = get_logger("coverage")

# Languages whose coverage SonarQube imports here, by suffix: every measured file must be in a report.
MEASURED_SUFFIXES = frozenset({".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".py"})
LCOV_KEYS = ("sonar.javascript.lcov.reportPaths", "sonar.typescript.lcov.reportPaths")
COBERTURA_KEY = "sonar.python.coverage.reportPaths"
DEFAULT_FLOOR = Fraction(90)
# Characters SonarQube's WildcardPattern escapes before building its regular expression.
_REGEX_SPECIAL = "()[]^$.{}+|"
# Shields.io colour ramp (README badges), highest bar first.
BADGE_COLOURS = ((Fraction(95), "#4c1"), (Fraction(90), "#97ca00"), (Fraction(75), "#dfb317"), (Fraction(50), "#fe7d37"))
BADGE_LOW_COLOUR = "#e05d44"
STEP_SUMMARY = "GITHUB_STEP_SUMMARY"


class InputError(Exception):
    """A report, the properties file or an option cannot be used (exit status 2)."""


# --- SonarQube WildcardPattern (Ant style: *, **, ?) ---------------------------------------------


def _wildcard_char(char: str) -> str:
    if char == "*":
        return "[^/]*?"
    if char == "?":
        return "[^/]"
    return "\\" + char if char in _REGEX_SPECIAL else char


def _wildcard_token(pattern: str, index: int) -> tuple[str, int]:
    """The regular expression for the pattern token at `index`, and the index after it."""
    if pattern.startswith("**/", index):
        return "(?:.*/|)", index + 3
    if pattern.startswith("**", index):
        return ".*", index + 2
    return _wildcard_char(pattern[index]), index + 1


def wildcard_regex(pattern: str) -> re.Pattern[str]:
    """A SonarQube path pattern as the regular expression WildcardPattern builds.

    `*` matches within one path segment, `**` any number of segments, `?` one character other
    than `/`. A leading `/` is ignored and a trailing `/` means `/**` (Ant's rule).
    """
    pattern = pattern.strip().replace("\\", "/")
    if pattern.endswith("/"):
        pattern += "**"
    index = 1 if pattern.startswith("/") else 0
    parts = ["^"]
    while index < len(pattern):
        token, index = _wildcard_token(pattern, index)
        parts.append(token)
    return re.compile("".join(parts) + "$")


def matches_any(path: str, patterns: Sequence[re.Pattern[str]]) -> bool:
    return any(pattern.match(path) for pattern in patterns)


# --- scope ---------------------------------------------------------------------------------------


def _patterns(props: dict[str, str], key: str) -> list[re.Pattern[str]]:
    items = split_list(props.get(key, ""))
    if any(item.startswith("file:") for item in items):
        raise InputError(f"{key}: absolute 'file:' patterns are not supported")
    return [wildcard_regex(item) for item in items]


@dataclass
class Scope:
    """The analysis scope from sonar-project.properties."""

    sources: list[str]
    inclusions: list[re.Pattern[str]]
    exclusions: list[re.Pattern[str]]
    coverage_exclusions: list[re.Pattern[str]]
    lcov_reports: list[str]
    cobertura_reports: list[str]

    @classmethod
    def from_properties(cls, props: dict[str, str]) -> Scope:
        """The scope; unset keys take SonarQube's defaults (sources `.`, no patterns)."""
        return cls(
            sources=[posixpath.normpath(item) for item in split_list(props.get("sonar.sources", "."))],
            inclusions=_patterns(props, "sonar.inclusions"),
            exclusions=_patterns(props, "sonar.exclusions"),
            coverage_exclusions=_patterns(props, "sonar.coverage.exclusions"),
            lcov_reports=[item for key in LCOV_KEYS for item in split_list(props.get(key, ""))],
            cobertura_reports=split_list(props.get(COBERTURA_KEY, "")),
        )

    def in_sources(self, path: str) -> bool:
        return any(source in {".", path} or path.startswith(source + "/") for source in self.sources)

    def reason(self, path: str) -> str | None:
        """Why SonarQube does not measure this path's coverage, or None when it does."""
        checks = (
            (Path(path).suffix not in MEASURED_SUFFIXES, "not a measured language"),
            (not self.in_sources(path), "outside sonar.sources"),
            (bool(self.inclusions) and not matches_any(path, self.inclusions), "not in sonar.inclusions"),
            (matches_any(path, self.exclusions), "sonar.exclusions"),
            (matches_any(path, self.coverage_exclusions), "sonar.coverage.exclusions"),
        )
        return next((why for failed, why in checks if failed), None)

    def missing_sources(self, root: Path) -> list[str]:
        """sonar.sources entries that do not exist (the scanner refuses to start then)."""
        return [source for source in self.sources if not (root / source).exists()]


# --- the gate ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Floors:
    """The per-file bars: Sonar's combined score, and line and branch coverage on their own."""

    combined: Fraction = DEFAULT_FLOOR
    line: Fraction = DEFAULT_FLOOR
    branch: Fraction = DEFAULT_FLOOR


@dataclass
class Result:
    """What the gate found."""

    scored: dict[str, FileCoverage] = field(default_factory=dict)
    offenders: dict[str, list[str]] = field(default_factory=dict)
    missing: list[str] = field(default_factory=list)
    stale: list[str] = field(default_factory=list)
    skipped: int = 0

    @property
    def failed(self) -> bool:
        """True when a file fails, one is missing or stale, or nothing was measured at all."""
        return bool(self.offenders or self.missing or self.stale or not self.scored)

    def totals(self) -> tuple[Fraction, Fraction]:
        """(Sonar coverage, branch coverage) of every measured file together: the README badges."""
        rows = [(*cov.line_counts, *cov.condition_counts) for cov in self.scored.values()] + [(0, 0, 0, 0)]
        lines_hit, lines, conditions_hit, conditions = map(sum, zip(*rows, strict=True))
        return percent(lines_hit + conditions_hit, lines + conditions), percent(conditions_hit, conditions)

    def status(self, name: str, separator: str = " ") -> str:
        """`PASS`, or `FAIL` and the bars a scored file misses."""
        return "FAIL" + separator + "; ".join(self.offenders[name]) if name in self.offenders else "PASS"


def pct_text(value: Fraction) -> str:
    """A percentage truncated (never rounded up) to two decimals."""
    return f"{math.floor(value * 100) / 100:.2f}%"


def file_problems(cov: FileCoverage, floors: Floors) -> list[str]:
    """Every bar this file misses (empty when it passes)."""
    bars = (("coverage", cov.combined, floors.combined), ("line", cov.line_rate, floors.line), ("branch", cov.branch_rate, floors.branch))
    return [f"{label} {pct_text(value)} < {pct_text(floor)}" for label, value, floor in bars if value < floor]


def classify(root: Path, name: str, measured: set[str]) -> str:
    """`scored` (Sonar measures it), `stale` (the file is gone) or `skipped` (out of scope)."""
    if name in measured:
        return "scored"
    return "stale" if Path(name).is_absolute() or not (root / name).is_file() else "skipped"


def score(result: Result, name: str, cov: FileCoverage, floors: Floors) -> None:
    result.scored[name] = cov
    problems = file_problems(cov, floors)
    if problems:
        result.offenders[name] = problems


def record(result: Result, name: str, cov: FileCoverage, kind: str, floors: Floors) -> None:
    if kind == "scored":
        score(result, name, cov, floors)
    elif kind == "stale":
        result.stale.append(name)
    else:
        result.skipped += 1


def evaluate(root: Path, measured: set[str], coverage: Coverage, floors: Floors) -> Result:
    """Scores every measured file; collects offenders, missing sources and stale entries."""
    result = Result()
    for name in sorted(coverage):
        record(result, name, coverage[name], classify(root, name, measured), floors)
    result.missing = sorted(measured - set(coverage))
    return result


# --- output --------------------------------------------------------------------------------------


def runs(numbers: Sequence[int]) -> list[list[int]]:
    """Consecutive numbers as [first, last] pairs."""
    found: list[list[int]] = []
    for number in numbers:
        if found and number == found[-1][1] + 1:
            found[-1][1] = number
        else:
            found.append([number, number])
    return found


def run_text(start: int, end: int) -> str:
    return str(start) if start == end else f"{start}-{end}"


def line_ranges(numbers: Sequence[int]) -> str:
    """`3-5, 9` for [3, 4, 5, 9]."""
    return ", ".join(run_text(start, end) for start, end in runs(numbers))


def counts_text(hit: int, total: int) -> str:
    return f"{hit}/{total}"


def table_line(result: Result, name: str, width: int) -> str:
    cov = result.scored[name]
    line_counts, condition_counts = counts_text(*cov.line_counts), counts_text(*cov.condition_counts)
    return f"{name:<{width}} | {pct_text(cov.combined):>8} | {line_counts:<9} | {condition_counts:<9} | {result.status(name)}"


def table_lines(result: Result, verbose: bool) -> list[str]:
    """The `FILE | COVERAGE | LINES | BRANCHES | STATUS` table: offenders always, every file with --verbose."""
    rows = list(result.scored) if verbose else list(result.offenders)
    if not rows:
        return []
    width = max(map(len, rows))
    return [f"{'FILE':<{width}} | COVERAGE | LINES     | BRANCHES  | STATUS", *(table_line(result, name, width) for name in rows)]


def listing(header: str, names: Sequence[str]) -> list[str]:
    return [header, *(f"  {name}" for name in names)] if names else []


def problem_lines(result: Result) -> list[str]:
    missing = listing(
        f"{len(result.missing)} measured file(s) missing from the reports (SonarQube counts them as uncovered):", result.missing
    )
    stale = listing(f"{len(result.stale)} stale report entr(y/ies): the file does not exist (regenerate the reports):", result.stale)
    return missing + stale + ([] if result.scored else ["the reports measure no file SonarQube analyses"])


def verdict_line(result: Result, floors: Floors) -> str:
    overall, branches = result.totals()
    verdict = "FAIL" if result.failed else "OK"
    return (
        f"[coverage] {verdict}: {len(result.scored)} files measured at >= {pct_text(floors.combined)} per file "
        f"(overall {pct_text(overall)}, branches {pct_text(branches)}), {result.skipped} report entries out of scope"
    )


def _cell(text: str) -> str:
    return text.replace("|", "\\|")


def summary_row(result: Result, name: str) -> str:
    cov = result.scored[name]
    missing = line_ranges(cov.missing_lines()) or "-"
    return (
        f"| `{_cell(name)}` | {pct_text(cov.combined)} | {counts_text(*cov.line_counts)} | "
        f"{counts_text(*cov.condition_counts)} | {missing} | {_cell(result.status(name, ': '))} |"
    )


def summary_markdown(result: Result, floors: Floors) -> str:
    """The Markdown summary (reports/coverage/summary.md and the Actions step summary)."""
    overall, branches = result.totals()
    lines = [
        "## Code Coverage Summary",
        "",
        f"Per-file bar {pct_text(floors.combined)} (Sonar scoring: covered lines and conditions over lines and conditions), "
        f"line {pct_text(floors.line)}, branch {pct_text(floors.branch)}. "
        f"Result: **{'FAIL' if result.failed else 'PASS'}**, {len(result.scored)} files, "
        f"overall {pct_text(overall)}, branches {pct_text(branches)}.",
        "",
        "| File | Coverage | Lines | Branches | Missing Lines | Status |",
        "| --- | --- | --- | --- | --- | --- |",
        *(summary_row(result, name) for name in result.scored),
        *(f"| `{_cell(name)}` | - | - | - | - | FAIL: missing from the reports |" for name in result.missing),
        *(f"| `{_cell(name)}` | - | - | - | - | FAIL: stale report entry |" for name in result.stale),
    ]
    return "\n".join(lines) + "\n"


def badge_colour(value: Fraction) -> str:
    return next((colour for floor, colour in BADGE_COLOURS if value >= floor), BADGE_LOW_COLOUR)


def badge_value(value: Fraction) -> str:
    """`100%`, or the percentage truncated to one decimal (`97.3%`)."""
    tenths = math.floor(value * 10)
    return f"{tenths // 10}%" if tenths % 10 == 0 else f"{tenths / 10:.1f}%"


def _text_width(text: str) -> int:
    """Approximate rendered width of 11 px Verdana, as shields.io sizes a flat badge."""
    return 7 * len(text) + 10


def badge_svg(label: str, value: Fraction) -> str:
    """A flat shields.io-style badge, deterministic so an unchanged figure leaves the file unchanged."""
    text, colour = badge_value(value), badge_colour(value)
    left, right = _text_width(label), _text_width(text)
    width = left + right
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="20" role="img" aria-label="{label}: {text}">\n'
        f"    <title>{label}: {text}</title>\n"
        f'    <clipPath id="r"><rect width="{width}" height="20" rx="3" fill="#fff"/></clipPath>\n'
        f'    <g clip-path="url(#r)"><rect width="{left}" height="20" fill="#555"/>'
        f'<rect x="{left}" width="{right}" height="20" fill="{colour}"/></g>\n'
        f'    <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">'
        f'<text x="{left / 2}" y="14">{label}</text><text x="{left + right / 2}" y="14">{text}</text></g>\n'
        "</svg>\n"
    )


def write_outputs(result: Result, floors: Floors, summary: Path | None, badge_dir: Path | None) -> None:
    """The summary file (plus the Actions step summary) and the two README badges."""
    text = summary_markdown(result, floors)
    if summary is not None:
        summary.parent.mkdir(parents=True, exist_ok=True)
        summary.write_text(text, encoding="utf-8")
    step_summary = os.environ.get(STEP_SUMMARY)
    if step_summary:
        with Path(step_summary).open("a", encoding="utf-8") as handle:
            handle.write(text)
    if badge_dir is not None:
        overall, branches = result.totals()
        badge_dir.mkdir(parents=True, exist_ok=True)
        (badge_dir / "coverage.svg").write_text(badge_svg("coverage", overall), encoding="utf-8")
        (badge_dir / "branches.svg").write_text(badge_svg("branches", branches), encoding="utf-8")


# --- command line --------------------------------------------------------------------------------


def floor_arg(text: str) -> Fraction:
    """An argparse type: a percentage from 0 to 100."""
    try:
        value = Fraction(text)
    except (ValueError, ZeroDivisionError) as error:
        raise argparse.ArgumentTypeError(f"not a number: {text!r}") from error
    if not 0 <= value <= HUNDRED:
        raise argparse.ArgumentTypeError(f"must be a percentage from 0 to 100, got {text}")
    return value


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Per-file coverage gate, scoped and scored like SonarQube.")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    parser.add_argument("--properties", type=Path, help="default: <root>/sonar-project.properties")
    parser.add_argument("--lcov", action="append", type=Path, help=f"LCOV tracefile (default: {LCOV_KEYS[0]})")
    parser.add_argument("--cobertura", action="append", type=Path, help=f"Cobertura XML (default: {COBERTURA_KEY})")
    parser.add_argument("--min", type=floor_arg, default=DEFAULT_FLOOR, help="per-file Sonar coverage floor (90)")
    parser.add_argument("--min-line", type=floor_arg, help="per-file line coverage floor (default: --min)")
    parser.add_argument("--min-branch", type=floor_arg, help="per-file branch coverage floor (default: --min)")
    parser.add_argument("--summary", type=Path, help="write the Markdown summary here")
    parser.add_argument("--badge-dir", type=Path, help="write coverage.svg and branches.svg here")
    parser.add_argument("-v", "--verbose", action="store_true", help="list every measured file, not only the offenders")
    return parser.parse_args(argv)


def report_paths(given: list[Path] | None, configured: list[str], root: Path) -> list[Path]:
    paths = given if given is not None else [Path(item) for item in configured]
    return [path if path.is_absolute() else root / path for path in paths]


def load_scope(root: Path, properties: Path) -> Scope:
    try:
        scope = Scope.from_properties(sonar_properties.read(properties))
    except PropertiesError as error:
        raise InputError(str(error)) from error
    missing = scope.missing_sources(root)
    if missing:
        raise InputError(f"sonar.sources names missing folder(s): {', '.join(missing)} (the scanner refuses to start)")
    return scope


def load_reports(args: argparse.Namespace, scope: Scope, root: Path) -> Coverage:
    try:
        reports = [read_lcov(path, root) for path in report_paths(args.lcov, scope.lcov_reports, root)]
        reports += [read_cobertura(path, root) for path in report_paths(args.cobertura, scope.cobertura_reports, root)]
    except ReportError as error:
        raise InputError(str(error)) from error
    if not reports:
        raise InputError(f"no coverage report: set {LCOV_KEYS[0]} / {COBERTURA_KEY} or pass --lcov / --cobertura")
    return merge_reports(reports)


def under(root: Path, path: Path | None) -> Path | None:
    """An output path relative to the repository root (an absolute one stays as given)."""
    return None if path is None else root / path


def floors_from(args: argparse.Namespace) -> Floors:
    """--min for every bar unless --min-line / --min-branch say otherwise."""
    line: Fraction = args.min if args.min_line is None else args.min_line
    branch: Fraction = args.min if args.min_branch is None else args.min_branch
    return Floors(args.min, line, branch)


def run(args: argparse.Namespace) -> tuple[Result, Floors]:
    """Loads the scope and the reports, then runs the gate."""
    root = args.root.resolve()
    scope = load_scope(root, args.properties or root / sonar_properties.PROPERTIES_FILE)
    coverage = load_reports(args, scope, root)
    measured = {name for name in repository_files(root, include_excluded=True) if scope.reason(name) is None}
    floors = floors_from(args)
    return evaluate(root, measured, coverage, floors), floors


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        result, floors = run(args)
    except InputError as error:
        LOG.error("[coverage] error: %s", error)
        return 2
    lines = [*table_lines(result, args.verbose), *problem_lines(result), verdict_line(result, floors)]
    (LOG.error if result.failed else LOG.info)("%s", "\n".join(lines))
    root = args.root.resolve()
    write_outputs(result, floors, under(root, args.summary), under(root, args.badge_dir))
    return 1 if result.failed else 0


if __name__ == "__main__":
    sys.exit(main())
