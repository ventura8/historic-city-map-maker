"""Coverage reports as the per-file gate reads them: LCOV (TypeScript) and Cobertura (Python).

Both become one `Coverage` map, keyed by repository-relative posix path, of `FileCoverage`
(line -> covered, conditions, covered conditions), the units SonarQube scores with. A file
listed by several reports (or several LCOV records) is merged the way Sonar merges reports: a
line is covered when any report covers it, and the widest condition count wins.

Cobertura reading is ported from the sibling Fork-Linux check-coverage.py; the LCOV reader is new
(docs/research/design-review-testability.md §2). XML is parsed with defusedxml.
"""

import os
import re
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path
from xml.etree.ElementTree import Element

from defusedxml import ElementTree

HUNDRED = Fraction(100)
_CONDITIONS = re.compile(r"\((\d+)/(\d+)\)")
_NOT_TAKEN = ("-", "0")
# DA:<line>,<hits>[,<checksum>] and BRDA:<line>,<block>,<branch>,<taken or ->
DA_FIELDS = 2
BRDA_FIELDS = 4


class ReportError(ValueError):
    """A report cannot be read or is malformed (the gate exits 2)."""


def percent(part: int, whole: int) -> Fraction:
    """An exact percentage; nothing to cover counts as fully covered (Sonar shows no coverage, not 0%)."""
    return Fraction(100 * part, whole) if whole else HUNDRED


@dataclass
class FileCoverage:
    """Merged coverage of one file: line -> [covered, conditions, covered conditions]."""

    lines: dict[int, list[int]] = field(default_factory=dict)

    def add(self, number: int, covered: bool, conditions: int = 0, taken: int = 0) -> None:
        """Merges one line: covered by any report, the widest condition count wins."""
        entry = self.lines.setdefault(number, [0, 0, 0])
        entry[0] = max(entry[0], int(covered))
        entry[1] = max(entry[1], conditions)
        entry[2] = max(entry[2], taken)

    def merge(self, other: FileCoverage) -> None:
        for number, (covered, conditions, taken) in other.lines.items():
            self.add(number, bool(covered), conditions, taken)

    @property
    def line_counts(self) -> tuple[int, int]:
        """(covered lines, lines)."""
        return sum(entry[0] for entry in self.lines.values()), len(self.lines)

    @property
    def condition_counts(self) -> tuple[int, int]:
        """(covered conditions, conditions)."""
        return sum(entry[2] for entry in self.lines.values()), sum(entry[1] for entry in self.lines.values())

    @property
    def combined(self) -> Fraction:
        """SonarQube's coverage: (covered lines + covered conditions) / (lines + conditions)."""
        (lines_hit, lines), (conditions_hit, conditions) = self.line_counts, self.condition_counts
        return percent(lines_hit + conditions_hit, lines + conditions)

    @property
    def line_rate(self) -> Fraction:
        return percent(*self.line_counts)

    @property
    def branch_rate(self) -> Fraction:
        return percent(*self.condition_counts)

    def missing_lines(self) -> list[int]:
        """Lines not executed, or with a condition never taken."""
        return sorted(number for number, (covered, conditions, taken) in self.lines.items() if not covered or taken < conditions)


Coverage = dict[str, FileCoverage]


def report_key(candidate: Path, root: Path) -> str:
    """Repository-relative posix path, or the absolute path when it lies outside root."""
    resolved = Path(os.path.normpath(candidate))
    base = Path(os.path.normpath(root))
    return resolved.relative_to(base).as_posix() if resolved.is_relative_to(base) else resolved.as_posix()


def merge_reports(reports: list[Coverage]) -> Coverage:
    """One coverage per file across every report."""
    merged: Coverage = {}
    for report in reports:
        for name, cov in report.items():
            merged.setdefault(name, FileCoverage()).merge(cov)
    return merged


# --- LCOV (Vitest's v8 provider: reports/coverage/ts/lcov.info) -----------------------------------


@dataclass
class _LcovRecord:
    """One SF..end_of_record block: line hits (DA) and branch outcomes (BRDA) by line."""

    name: str
    hits: dict[int, int] = field(default_factory=dict)
    branches: dict[int, list[int]] = field(default_factory=dict)

    def coverage(self) -> FileCoverage:
        cov = FileCoverage()
        for number in sorted(set(self.hits) | set(self.branches)):
            conditions, taken = self.branches.get(number, [0, 0])
            covered = self.hits[number] > 0 if number in self.hits else taken > 0
            cov.add(number, covered, conditions, taken)
        return cov


def _lcov_int(value: str, where: str) -> int:
    if not value.isdigit():
        raise ReportError(f"{where}: expected a non-negative integer, got {value!r}")
    return int(value)


def _lcov_da(record: _LcovRecord, value: str, where: str) -> None:
    fields = value.split(",")
    if len(fields) < DA_FIELDS:
        raise ReportError(f"{where}: malformed DA:{value}")
    number, hits = _lcov_int(fields[0], where), _lcov_int(fields[1], where)
    record.hits[number] = max(record.hits.get(number, 0), hits)


def _lcov_brda(record: _LcovRecord, value: str, where: str) -> None:
    fields = value.split(",")
    if len(fields) != BRDA_FIELDS:
        raise ReportError(f"{where}: malformed BRDA:{value}")
    entry = record.branches.setdefault(_lcov_int(fields[0], where), [0, 0])
    entry[0] += 1
    entry[1] += int(fields[3] not in _NOT_TAKEN)


def _lcov_line(record: _LcovRecord | None, tag: str, value: str, where: str) -> None:
    """Applies one DA/BRDA line to the open record; other tags (FN, LF, BRF, ...) carry no per-line data."""
    if tag not in ("DA", "BRDA"):
        return
    if record is None:
        raise ReportError(f"{where}: {tag} outside an SF record")
    (_lcov_da if tag == "DA" else _lcov_brda)(record, value, where)


def _lcov_records(text: str, path: Path) -> list[_LcovRecord]:
    records: list[_LcovRecord] = []
    current: _LcovRecord | None = None
    for number, raw in enumerate(text.splitlines(), start=1):
        tag, _, value = raw.strip().partition(":")
        if tag == "SF":
            current = _LcovRecord(value)
            records.append(current)
        elif tag == "end_of_record":
            current = None
        else:
            _lcov_line(current, tag, value, f"{path}:{number}")
    return records


def read_lcov(path: Path, root: Path) -> Coverage:
    """An LCOV tracefile; relative SF paths are relative to the repository root (Vitest's)."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        raise ReportError(f"cannot read {path}: {error.strerror or error}") from error
    report: Coverage = {}
    for record in _lcov_records(text, path):
        name = Path(record.name)
        key = report_key(name if name.is_absolute() else root / name, root)
        report.setdefault(key, FileCoverage()).merge(record.coverage())
    return report


# --- Cobertura (coverage.py's --cov-report=xml: reports/coverage/scripts.xml) ---------------------


def _int_attr(node: Element, name: str, where: str) -> int:
    value = node.get(name)
    if value is None or not value.isdigit():
        raise ReportError(f"{where}: <{node.tag}> needs a non-negative integer '{name}', got {value!r}")
    return int(value)


def _load_xml(path: Path) -> Element:
    try:
        top: Element = ElementTree.fromstring(path.read_bytes())
    except OSError as error:
        raise ReportError(f"cannot read {path}: {error.strerror or error}") from error
    except ElementTree.ParseError as error:
        raise ReportError(f"{path} is not well-formed XML: {error}") from error
    if top.tag != "coverage":
        raise ReportError(f"{path}: the root element is <{top.tag}>, expected <coverage>")
    return top


def _cobertura_file(filename: str, sources: list[Path], root: Path) -> str:
    """Resolves a Cobertura class filename against the <source> entries, then the root (an absolute one stays as is)."""
    candidates = [source / filename for source in sources] + [root / filename]
    return report_key(next((candidate for candidate in candidates if candidate.is_file()), candidates[0]), root)


def _cobertura_line(cov: FileCoverage, line: Element, where: str) -> None:
    number, hits = _int_attr(line, "number", where), _int_attr(line, "hits", where)
    if line.get("branch") != "true":
        cov.add(number, hits > 0)
        return
    match = _CONDITIONS.search(line.get("condition-coverage", ""))
    if match is None:
        raise ReportError(f"{where}: branch line {number} has no 'condition-coverage' like '50% (1/2)'")
    taken, conditions = int(match.group(1)), int(match.group(2))
    if taken > conditions:
        raise ReportError(f"{where}: line {number} covers {taken} of {conditions} conditions")
    cov.add(number, hits > 0, conditions, taken)


def _source_texts(top: Element) -> list[str]:
    return [text for text in ((node.text or "").strip() for node in top.iter("source")) if text]


def _cobertura_sources(top: Element, root: Path) -> list[Path]:
    """The <source> folders (relative ones under root), or the root itself when there is none."""
    return [root / text for text in _source_texts(top)] or [root]


def read_cobertura(path: Path, root: Path) -> Coverage:
    """A Cobertura XML report; class filenames resolve against its <source> entries."""
    top = _load_xml(path)
    sources = _cobertura_sources(top, root)
    report: Coverage = {}
    for cls in top.iter("class"):
        filename = cls.get("filename")
        if not filename:
            raise ReportError(f"{path}: a <class> has no 'filename'")
        cov = report.setdefault(_cobertura_file(filename, sources, root), FileCoverage())
        for line in cls.findall("./lines/line"):
            _cobertura_line(cov, line, f"{path} ({filename})")
    return report
