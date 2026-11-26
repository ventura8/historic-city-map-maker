"""check_action_pins.py: every `uses:` is a 40-hex commit SHA with a `# vX.Y.Z` comment."""

import runpy
import sys
from pathlib import Path

import check_action_pins as pins
import pytest
from treeutil import write

SCRIPT = Path(pins.__file__)
SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1"
DIGEST = "a" * 64


def test_happy_path_pinned_workflows_pass(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    write(
        tmp_path,
        ".github/workflows/ci.yml",
        "jobs:\n    a:\n        steps:\n"
        f"            - uses: actions/checkout@{SHA} # v7.0.1\n"
        f"            - name: x\n              uses: 'github/codeql-action/init@{SHA}'  # v4.31.2 (init)\n"
        "            - uses: ./.github/actions/setup\n"
        f"            - uses: docker://alpine@sha256:{DIGEST}\n",
    )
    write(tmp_path, ".github/actions/setup/action.yaml", f"runs:\n    steps:\n        - uses: actions/cache@{SHA} # v6.1.0\n")

    assert pins.main(["--root", str(tmp_path)]) == 0
    assert caplog.messages == ["[action-pins] OK: 5 uses: reference(s) in 2 file(s), every one SHA-pinned"]


def test_happy_path_no_workflows_pass(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    assert pins.main(["--root", str(tmp_path)]) == 0
    assert caplog.messages == ["[action-pins] OK: 0 uses: reference(s) in 0 file(s), every one SHA-pinned"]


@pytest.mark.parametrize(
    ("line", "problem"),
    [
        ("- uses: actions/checkout@v7", "actions/checkout@v7: pin the action to a full 40-character commit SHA"),
        ("- uses: actions/checkout@main # v7.0.1", "actions/checkout@main: pin the action to a full 40-character commit SHA"),
        (f"- uses: actions/checkout@{SHA}", f"actions/checkout@{SHA}: add the release as a trailing `# vX.Y.Z` comment"),
        (f"- uses: actions/checkout@{SHA} # latest", f"actions/checkout@{SHA}: add the release as a trailing `# vX.Y.Z` comment"),
        ("- uses: docker://alpine:3.22", "docker://alpine:3.22: a docker:// image must be pinned by @sha256 digest"),
    ],
)
def test_bad_path_unpinned_references_are_reported(tmp_path: Path, caplog: pytest.LogCaptureFixture, line: str, problem: str) -> None:
    write(tmp_path, ".github/workflows/deploy.yaml", f"steps:\n    {line}")

    assert pins.main(["--root", str(tmp_path)]) == 1
    assert caplog.messages == [f"[action-pins] FAILED:\n  - .github/workflows/deploy.yaml:2: {problem}"]


def test_happy_path_script_entry_point_exits_with_main_status(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--root", str(tmp_path)])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(SCRIPT), run_name="__main__")

    assert exit_info.value.code == 0
