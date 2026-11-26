"""coverage_reports: LCOV and Cobertura become per-file line and condition coverage, merged like Sonar."""

from fractions import Fraction
from pathlib import Path

import pytest
from coverage_reports import FileCoverage, ReportError, merge_reports, percent, read_cobertura, read_lcov, report_key
from treeutil import write

LCOV = """TN:
SF:packages/a/src/x.ts
FN:1,f
DA:1,1
DA:2,0
BRDA:1,0,0,1
BRDA:1,0,1,-
BRDA:5,1,0,2
LF:2
LH:1
end_of_record
SF:packages/a/src/x.ts
DA:2,3
end_of_record
SF:{absolute}
DA:1,1
end_of_record
"""


def lcov_file(root: Path, text: str) -> Path:
    return write(root, "lcov.info", text, newline=False)


def test_happy_path_lcov_records_are_merged_per_file(tmp_path: Path) -> None:
    report = read_lcov(lcov_file(tmp_path, LCOV.format(absolute=tmp_path / "packages/b/y.ts")), tmp_path)
    x = report["packages/a/src/x.ts"]

    assert sorted(report) == ["packages/a/src/x.ts", "packages/b/y.ts"]
    assert x.lines == {1: [1, 2, 1], 2: [1, 0, 0], 5: [1, 1, 1]}
    assert (x.line_counts, x.condition_counts, x.combined, x.missing_lines()) == ((3, 3), (2, 3), Fraction(500, 6), [1])


def test_happy_path_lcov_path_outside_the_root_stays_absolute(tmp_path: Path) -> None:
    report = read_lcov(lcov_file(tmp_path, "SF:/elsewhere/z.ts\nDA:1,0\nend_of_record\n"), tmp_path)

    assert list(report) == ["/elsewhere/z.ts"]


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("DA:1,1\n", "DA outside an SF record"),
        ("SF:a.ts\nDA:1\n", "malformed DA:1"),
        ("SF:a.ts\nBRDA:1,0,1\n", "malformed BRDA:1,0,1"),
        ("SF:a.ts\nDA:x,1\n", "expected a non-negative integer, got 'x'"),
    ],
)
def test_bad_path_malformed_lcov_is_rejected(tmp_path: Path, text: str, message: str) -> None:
    with pytest.raises(ReportError, match=message):
        read_lcov(lcov_file(tmp_path, text), tmp_path)


def test_bad_path_unreadable_lcov_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(ReportError, match="cannot read"):
        read_lcov(tmp_path / "missing.info", tmp_path)


COBERTURA = """<?xml version="1.0" ?>
<coverage version="7.16.2">
    <sources><source>scripts/ci</source><source>   </source></sources>
    <packages><package name="."><classes>
        <class name="a.py" filename="a.py"><lines>
            <line number="1" hits="1"/>
            <line number="2" hits="0"/>
            <line number="3" hits="1" branch="true" condition-coverage="50% (1/2)"/>
        </lines></class>
        <class name="b.py" filename="{absolute}"><lines><line number="1" hits="1"/></lines></class>
        <class name="gone.py" filename="gone.py"><lines/></class>
    </classes></package></packages>
</coverage>
"""


def test_happy_path_cobertura_resolves_files_against_its_sources(tmp_path: Path) -> None:
    write(tmp_path, "scripts/ci/a.py")
    absolute = write(tmp_path, "pipeline/src/b.py")
    path = write(tmp_path, "cov.xml", COBERTURA.format(absolute=absolute))

    report = read_cobertura(path, tmp_path)

    assert sorted(report) == ["pipeline/src/b.py", "scripts/ci/a.py", "scripts/ci/gone.py"]
    assert report["scripts/ci/a.py"].lines == {1: [1, 0, 0], 2: [0, 0, 0], 3: [1, 2, 1]}
    assert report["scripts/ci/a.py"].missing_lines() == [2, 3]


def test_happy_path_cobertura_without_sources_resolves_against_the_root(tmp_path: Path) -> None:
    write(tmp_path, "x.py")
    path = write(tmp_path, "cov.xml", '<coverage><class filename="x.py"><lines><line number="4" hits="2"/></lines></class></coverage>')

    assert read_cobertura(path, tmp_path)["x.py"].lines == {4: [1, 0, 0]}


@pytest.mark.parametrize(
    ("xml", "message"),
    [
        ("<coverage>", "is not well-formed XML"),
        ("<report/>", "the root element is <report>, expected <coverage>"),
        ("<coverage><class/></coverage>", "a <class> has no 'filename'"),
        (
            '<coverage><class filename="x.py"><lines><line number="1" hits="1" branch="true"/></lines></class></coverage>',
            "has no 'condition-coverage'",
        ),
        (
            '<coverage><class filename="x.py"><lines>'
            '<line number="1" hits="1" branch="true" condition-coverage="(3/2)"/></lines></class></coverage>',
            "covers 3 of 2 conditions",
        ),
        (
            '<coverage><class filename="x.py"><lines><line number="1" hits="-1"/></lines></class></coverage>',
            "needs a non-negative integer 'hits'",
        ),
    ],
)
def test_bad_path_malformed_cobertura_is_rejected(tmp_path: Path, xml: str, message: str) -> None:
    path = write(tmp_path, "cov.xml", xml)

    with pytest.raises(ReportError, match=message):
        read_cobertura(path, tmp_path)


def test_bad_path_unreadable_cobertura_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(ReportError, match="cannot read"):
        read_cobertura(tmp_path / "missing.xml", tmp_path)


def test_happy_path_reports_merge_line_by_line() -> None:
    first, second = FileCoverage(), FileCoverage()
    first.add(1, covered=False, conditions=2, taken=1)
    second.add(1, covered=True, conditions=2, taken=2)
    second.add(2, covered=False)

    merged = merge_reports([{"a.ts": first}, {"a.ts": second, "b.ts": FileCoverage()}])

    assert merged["a.ts"].lines == {1: [1, 2, 2], 2: [0, 0, 0]}
    assert merged["a.ts"].line_rate == Fraction(50)
    assert merged["a.ts"].branch_rate == Fraction(100)
    assert merged["b.ts"].combined == Fraction(100)


def test_happy_path_nothing_to_cover_counts_as_covered() -> None:
    assert percent(0, 0) == Fraction(100)
    assert percent(1, 4) == Fraction(25)


def test_happy_path_report_key_is_relative_inside_the_root(tmp_path: Path) -> None:
    assert report_key(tmp_path / "a" / ".." / "b.ts", tmp_path) == "b.ts"
    assert report_key(Path("/elsewhere/b.ts"), tmp_path) == "/elsewhere/b.ts"
