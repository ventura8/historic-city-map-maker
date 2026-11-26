"""check_repo_budget.py: tree, single-file and e2e screenshot budgets; seed/ is not budgeted."""

import runpy
import sys
from pathlib import Path

import check_repo_budget as budget
import pytest
from treeutil import init_repo, write

SCRIPT = Path(budget.__file__)


def sparse(root: Path, relative: str, size: int) -> None:
    """A file of `size` bytes that takes no disk space."""
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        handle.truncate(size)


def test_happy_path_small_repository_passes(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    init_repo(tmp_path)
    write(tmp_path, "README.md", "# x")
    sparse(tmp_path, "seed/bucharest/photos/huge.jpg", 80 * budget.MB)
    write(tmp_path, ".gitignore", "dist/")
    sparse(tmp_path, "dist/ignored.bin", 20 * budget.MB)

    assert budget.main(["--root", str(tmp_path)]) == 0
    assert caplog.messages == ["[repo-budget] OK: 2 files, 0.00 MB without seed/ (budget 60.00 MB)"]


def test_bad_path_every_budget_is_enforced() -> None:
    sizes = budget.Sizes(
        {
            "data/raster.tif": 6 * budget.MB,
            "e2e/specs/viewer.spec.ts-snapshots/a.png": 4 * budget.MB,
            "e2e/specs/viewer.spec.ts-snapshots/b.png": 4 * budget.MB,
            "e2e/__screenshots__/c.png": 4 * budget.MB,
            "e2e/__screenshots__/d.png": 4 * budget.MB,
            "docs/screenshots/e.png": 4 * budget.MB,
            "big/a.bin": 4 * budget.MB,
            "big/b.bin": 4 * budget.MB,
            "big/c.bin": 4 * budget.MB,
            "big/d.bin": 4 * budget.MB,
            "big/e.bin": 4 * budget.MB,
            "big/f.bin": 4 * budget.MB,
            "big/g.bin": 4 * budget.MB,
            "big/h.bin": 4 * budget.MB,
            "big/i.bin": 4 * budget.MB,
            "seed/x.jpg": 100 * budget.MB,
        }
    )

    assert budget.problems(sizes) == [
        "data/raster.tif: 6.00 MB > 5.00 MB per file (keep rasters and media in Cloud Storage)",
        "tree without seed/: 62.00 MB > 60.00 MB",
        "e2e screenshot baselines: 16.00 MB > 15.00 MB",
    ]


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("e2e/__screenshots__/a.png", True),
        ("e2e/specs/x.spec.ts-snapshots/a.png", True),
        ("docs/__screenshots__/a.png", False),
        ("e2e/snapshots.png", False),
    ],
)
def test_happy_path_screenshot_baselines_are_recognised(name: str, expected: bool) -> None:
    assert budget.is_screenshot(name) is expected


def test_bad_path_main_lists_the_offenders(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    sparse(tmp_path, "assets/video.mp4", 5 * budget.MB + 1)

    assert budget.main(["--root", str(tmp_path)]) == 1
    assert caplog.messages == [
        "[repo-budget] FAILED:\n  - assets/video.mp4: 5.00 MB > 5.00 MB per file (keep rasters and media in Cloud Storage)"
    ]


def test_happy_path_script_entry_point_exits_with_main_status(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    write(tmp_path, "a.txt", "x")
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--root", str(tmp_path)])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(SCRIPT), run_name="__main__")

    assert exit_info.value.code == 0
