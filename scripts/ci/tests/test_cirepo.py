"""cirepo: the shared exclusion list and the file set every tree-walking gate reads."""

import subprocess
from pathlib import Path

import cirepo
import pytest
from treeutil import init_repo, write


@pytest.mark.parametrize(
    "relative",
    [
        "node_modules/a/index.js",
        "packages/ui/dist/x.js",
        "seed/bucharest/a.json",
        "vendor/npm/x.js",
        ".claude/worktrees/b/x.ts",
        ".docker-build-cache.new/x",
    ],
)
def test_happy_path_excluded_directories_are_recognised(relative: str) -> None:
    assert cirepo.is_excluded(relative) is True


@pytest.mark.parametrize("relative", ["packages/ui/src/x.ts", ".claude/skills/a/SKILL.md", "seed.json", "docs/vendor.md"])
def test_happy_path_product_paths_are_not_excluded(relative: str) -> None:
    assert cirepo.is_excluded(relative) is False


def test_happy_path_git_view_lists_tracked_and_untracked_files_without_ignored_ones(tmp_path: Path) -> None:
    init_repo(tmp_path)
    write(tmp_path, ".gitignore", "secret.local")
    write(tmp_path, "a.ts")
    write(tmp_path, "secret.local")
    write(tmp_path, "seed/x.json")

    assert cirepo.repository_files(tmp_path) == [".gitignore", "a.ts"]
    assert cirepo.repository_files(tmp_path, include_excluded=True) == [".gitignore", "a.ts", "seed/x.json"]


def test_bad_path_outside_a_repository_the_tree_is_walked(tmp_path: Path) -> None:
    write(tmp_path, "b/z.ts")
    write(tmp_path, "a.ts")
    write(tmp_path, "node_modules/m.js")
    write(tmp_path, ".git/config")

    assert cirepo.git_files(tmp_path) is None
    assert cirepo.repository_files(tmp_path) == ["a.ts", "b/z.ts"]
    assert cirepo.repository_files(tmp_path, include_excluded=True) == ["a.ts", "b/z.ts", "node_modules/m.js"]


def test_bad_path_missing_git_executable_falls_back_to_the_walk(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    write(tmp_path, "a.ts")

    def no_git(*_args: object, **_kwargs: object) -> subprocess.CompletedProcess[bytes]:
        raise FileNotFoundError("git")

    monkeypatch.setattr(subprocess, "run", no_git)

    assert cirepo.git_files(tmp_path) is None
    assert cirepo.repository_files(tmp_path) == ["a.ts"]
