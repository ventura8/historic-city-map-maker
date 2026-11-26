"""check_e2e_matrix.py: registry rows, happy/bad pairs, test tags in both directions, and the generated doc.

Scenario tags are assembled at run time (`tag("V01-BOOT")`) so this file names no scenario itself.
"""

import json
import runpy
import sys
from pathlib import Path
from typing import Any

import check_e2e_matrix as matrix
import pytest
from treeutil import write

SCRIPT = Path(matrix.__file__)


def tag(suffix: str) -> str:
    return "@" + "S-" + suffix


def row(scenario_id: str, path: str = "happy", status: str = "planned", **overrides: str) -> dict[str, str]:
    base = {
        "id": scenario_id,
        "behaviour": "V01",
        "area": "viewer",
        "path": path,
        "title": f"Boot ({path})",
        "asserts": "map | timeline visible",
        "tier": "e2e-viewer",
        "status": status,
    }
    return {**base, **overrides}


def registry(root: Path, rows: list[Any]) -> None:
    write(root, "e2e/scenarios.json", json.dumps({"scenarios": rows}, indent=4))


def pair(root: Path, status: str = "planned") -> None:
    registry(root, [row("S-V01-BOOT", "happy", status), row("S-V01-BROKEN-MANIFEST", "bad", status, notes="404 manifest")])


def run(root: Path, *command: str) -> int:
    return matrix.main([*command, "--root", str(root)])


# --- without a registry --------------------------------------------------------------------------


def test_happy_path_no_registry_and_no_tags_passes(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    assert run(tmp_path) == 0
    assert caplog.messages == ["[e2e-matrix] OK: e2e/scenarios.json does not exist yet and no test names a scenario"]


def test_bad_path_tags_without_a_registry_fail(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    write(tmp_path, "e2e/specs/viewer/boot.spec.ts", f"test('boots', {{ tag: '{tag('V01-BOOT')}' }}, async () => {{}});")

    assert run(tmp_path) == 1
    assert caplog.messages == ["[e2e-matrix] FAILED:\n  - e2e/scenarios.json does not exist, but tests name scenarios"]


def test_bad_path_doc_without_a_registry_fails(tmp_path: Path) -> None:
    write(tmp_path, "docs/E2E_SCENARIOS.md", "# E2E scenarios")

    assert matrix.run("check", tmp_path) == ["docs/E2E_SCENARIOS.md exists without e2e/scenarios.json"]
    assert matrix.run("write", tmp_path) == ["e2e/scenarios.json does not exist: nothing to render"]


# --- registry and tags ---------------------------------------------------------------------------


def test_happy_path_a_tour_file_names_scenarios_too(tmp_path: Path) -> None:
    pair(tmp_path, status="exists")
    write(
        tmp_path, "e2e/tour/viewer.tour.ts", f"test('tour', {{ tag: ['{tag('V01-BOOT')}', '{tag('V01-BROKEN-MANIFEST')}'] }}, () => {{}});"
    )

    assert matrix.run("write", tmp_path) == []
    assert matrix.run("check", tmp_path) == []
    assert "`e2e/tour/viewer.tour.ts`" in (tmp_path / "docs" / "E2E_SCENARIOS.md").read_text(encoding="utf-8")


def tagged_pair(root: Path) -> None:
    """Both rows `exists`, named by a Playwright spec and (the happy one) by a pytest docstring too."""
    pair(root, status="exists")
    spec = f"test('boots', {{ tag: ['{tag('V01-BOOT')}', '{tag('V01-BROKEN-MANIFEST')}'] }}, () => {{}});"
    write(root, "e2e/specs/viewer/boot.spec.ts", spec)
    write(root, "pipeline/tests/e2e/test_import.py", "def test_x() -> None:\n    " + '"""Scenarios: ' + "S-V01-BOOT" + '"""')


def test_happy_path_write_then_check_round_trips(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    tagged_pair(tmp_path)

    assert run(tmp_path, "check") == 1
    assert (run(tmp_path, "write"), run(tmp_path)) == (0, 0)
    assert caplog.messages[-3:] == ["[e2e-matrix] wrote docs/E2E_SCENARIOS.md", "[e2e-matrix] OK", "[e2e-matrix] OK"]


def test_happy_path_doc_lists_counts_areas_and_the_tests_of_each_scenario(tmp_path: Path) -> None:
    tagged_pair(tmp_path)

    assert matrix.run("write", tmp_path) == []
    doc = (tmp_path / "docs/E2E_SCENARIOS.md").read_text(encoding="utf-8").splitlines()
    assert {
        "| 1 | 2 | 1 | 1 | 2 | 0 | 2 |",
        "## Viewer",
        "| `S-V01-BOOT` | V01 | happy | Boot (happy) | map \\| timeline visible | e2e-viewer | exists | "
        "`e2e/specs/viewer/boot.spec.ts`<br>`pipeline/tests/e2e/test_import.py` |",
    } <= set(doc)
    assert "## Admin" not in doc


def test_happy_path_planned_rows_render_without_tests(tmp_path: Path) -> None:
    pair(tmp_path)

    assert matrix.run("write", tmp_path) == []
    assert "| `S-V01-BROKEN-MANIFEST` | V01 | bad | Boot (bad) | map \\| timeline visible | e2e-viewer | planned | - |" in (
        tmp_path / "docs/E2E_SCENARIOS.md"
    ).read_text(encoding="utf-8")


def test_bad_path_tag_directions_are_checked(tmp_path: Path) -> None:
    registry(
        tmp_path,
        [
            row("S-V01-BOOT", "happy", "exists"),
            row("S-V01-BAD", "bad", "planned"),
        ],
    )
    write(tmp_path, "e2e/specs/a.spec.ts", f"// {tag('V01-BAD')} {tag('UNKNOWN')}")

    assert matrix.run("check", tmp_path) == [
        "S-UNKNOWN: named by e2e/specs/a.spec.ts but not registered",
        "S-V01-BOOT: status exists, but no test names it",
        "S-V01-BAD: status planned, but e2e/specs/a.spec.ts names it (mark it exists)",
    ]


def test_bad_path_behaviour_rules_are_checked(tmp_path: Path) -> None:
    registry(
        tmp_path,
        [
            row("S-V01-BOOT"),
            row("S-V01-BOOT"),
            row("S-A01-SIGN-IN", behaviour="A01", area="admin"),
            row("S-A01-STRANGER", "bad", behaviour="A01", area="viewer"),
        ],
    )

    assert matrix.run("check", tmp_path) == [
        "S-V01-BOOT: registered 2 times",
        "behaviour A01: rows in several areas (admin, viewer)",
        "behaviour V01: no bad scenario",
    ]


@pytest.mark.parametrize(
    ("entry", "problem"),
    [
        ("not a row", "row 0: not an object"),
        ({**row("S-V01-X"), "title": ""}, "row 0 (S-V01-X): 'title' must be a non-empty string"),
        ({**row("S-V01-X"), "extra": "x"}, "row 0 (S-V01-X): unknown field 'extra'"),
        ({**row("S-V01-X"), "status": "done"}, "row 0 (S-V01-X): status 'done' is not one of exists, planned"),
        (row("v01-lower"), "row 0 (v01-lower): id must match ^S-[A-Z0-9]+(?:-[A-Z0-9]+)*$"),
        ({key: value for key, value in row("S-V01-X").items() if key != "id"}, "row 0 (?): 'id' must be a non-empty string"),
    ],
)
def test_bad_path_malformed_rows_are_reported(tmp_path: Path, entry: object, problem: str) -> None:
    registry(tmp_path, [entry])

    assert matrix.run("check", tmp_path)[0] == problem


@pytest.mark.parametrize("content", ["[1, 2]", '{"scenarios": {}}', "{broken"])
def test_bad_path_unreadable_registry_fails(tmp_path: Path, caplog: pytest.LogCaptureFixture, content: str) -> None:
    write(tmp_path, "e2e/scenarios.json", content)

    assert run(tmp_path) == 1
    assert caplog.messages[0].startswith("[e2e-matrix] FAILED:\n  - scenarios.json: ")


def test_happy_path_python_declarations_and_unrelated_files(tmp_path: Path) -> None:
    write(tmp_path, "pipeline/tests/test_a.py", '"""Scenarios: ' + "S-P01-A, 'S-P01-B'" + '"""')
    write(tmp_path, "e2e/support/helpers.ts", tag("IGNORED"))

    assert matrix.scan_tests(tmp_path) == {"S-P01-A": {"pipeline/tests/test_a.py"}, "S-P01-B": {"pipeline/tests/test_a.py"}}


def test_happy_path_script_entry_point_exits_with_main_status(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "check", "--root", str(tmp_path)])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(SCRIPT), run_name="__main__")

    assert exit_info.value.code == 0
