"""check_architecture.py: docs/ARCHITECTURE.md names real paths and links and has well-formed Mermaid diagrams."""

import runpy
import sys
from pathlib import Path

import check_architecture as arch
import pytest
from treeutil import write

GOOD = "# A\n\nSee `scripts/x.py` and [B](B.md) and `sites/<city>/`.\n\n```mermaid\nflowchart LR\n    a[A] --> b(B)\n```\n"


def test_happy_path_a_true_document_passes(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    write(tmp_path, "docs/ARCHITECTURE.md", GOOD)
    write(tmp_path, "docs/B.md", "# B")
    write(tmp_path, "scripts/x.py", "")

    assert arch.main(["--root", str(tmp_path)]) == 0
    assert caplog.messages == ["docs/ARCHITECTURE.md: paths, links and diagrams OK"]


def test_bad_path_missing_paths_links_and_diagrams_fail(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    write(tmp_path, "docs/ARCHITECTURE.md", "See `scripts/gone.py`, [C](C.md).\n")

    assert arch.main(["--root", str(tmp_path)]) == 1
    message = caplog.messages[0]
    assert "missing path: scripts/gone.py" in message
    assert "broken link: C.md" in message
    assert "no ```mermaid diagram" in message


def test_bad_path_malformed_diagrams_are_named() -> None:
    text = "```mermaid\npie\n    a\n```\n```mermaid\nflowchart LR\n    a[A --> b\n```\n"
    assert arch.mermaid_problems(text) == [
        "diagram 1: needs a known type (flowchart, graph, sequenceDiagram, stateDiagram-v2, classDiagram, erDiagram) and a body",
        "diagram 2: unbalanced []",
    ]


def test_entry_point_runs_main(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    write(tmp_path, "docs/ARCHITECTURE.md", GOOD)
    write(tmp_path, "docs/B.md", "# B")
    write(tmp_path, "scripts/x.py", "")
    monkeypatch.setattr(sys, "argv", ["check_architecture.py", "--root", str(tmp_path)])
    with pytest.raises(SystemExit) as stop:
        runpy.run_path(str(Path(arch.__file__)), run_name="__main__")
    assert stop.value.code == 0
