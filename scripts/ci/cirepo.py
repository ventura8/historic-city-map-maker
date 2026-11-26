"""The repository file set every tree-walking gate shares.

One exclusion list for every tool (Whisper rule, docs/research/quality-conventions.md §4): the same
directories are pruned by the suppression scan, the data-file and EditorConfig gates, the scenario
and i18n checks, and mirrored in .prettierignore, .yamllint, .markdownlint-cli2.jsonc, .taplo.toml
and .gitleaks.toml. A gate asks git for the files (tracked plus untracked-but-not-ignored, so local
secrets and build output are never read) and falls back to walking the tree when there is no
repository (the pre-commit hook scans a `git checkout-index` copy of the staged files).
"""

import os
import shutil
import subprocess
from collections.abc import Callable, Iterator, Sequence
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# The absolute path of git, so no call depends on a partial executable name.
GIT = shutil.which("git") or "git"

# Never ours to lint: dependency caches, build output, pipeline output, tool scratch space,
# legacy seed data (migrated as is) and third-party code vendored only to patch an advisory.
EXCLUDED_DIRS = frozenset(
    {
        ".git",
        "node_modules",
        "dist",
        ".tsbuild",
        "reports",
        "coverage",
        "playwright-report",
        "test-results",
        ".venv",
        ".mypy_cache",
        ".ruff_cache",
        ".pytest_cache",
        "__pycache__",
        ".scannerwork",
        ".firebase",
        "seed",
        "vendor",
    }
)
# Agent worktrees are whole checkouts of the repository: their files are another branch's.
EXCLUDED_PREFIXES = ((".claude", "worktrees"),)
DOCKER_BUILD_CACHE = ".docker-build-cache"


def excluded_parts(parts: Sequence[str]) -> bool:
    """True when a sequence of directory names lies in (or is) an excluded directory."""
    in_excluded_dir = any(part in EXCLUDED_DIRS or part.startswith(DOCKER_BUILD_CACHE) for part in parts)
    return in_excluded_dir or any(tuple(parts[: len(prefix)]) == prefix for prefix in EXCLUDED_PREFIXES)


def is_excluded(relative: Path | str) -> bool:
    """True when a file (path relative to the root) lives under an excluded directory."""
    return excluded_parts(Path(relative).parts[:-1])


def only_git_dir(parts: Sequence[str]) -> bool:
    """The pruning rule of a walk that keeps the excluded directories: only `.git` is skipped."""
    return ".git" in parts


def walk(root: Path, prune: Callable[[Sequence[str]], bool] = excluded_parts) -> Iterator[Path]:
    """Every file below root (relative paths), pruning the directories `prune` rejects before descending."""
    for current, dirs, files in os.walk(root):
        here = Path(current).relative_to(root)
        dirs[:] = sorted(name for name in dirs if not prune((*here.parts, name)))
        yield from (here / name for name in sorted(files))


def _ls_files(root: Path) -> bytes | None:
    """`git ls-files` output (NUL-separated), or None when git is missing or root is not a repository."""
    try:
        result = subprocess.run(
            [GIT, "-C", str(root), "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            capture_output=True,
            check=False,
        )
    except OSError:
        return None
    return result.stdout if result.returncode == 0 else None


def git_files(root: Path) -> list[str] | None:
    """Tracked and untracked-but-not-ignored files that exist (posix, relative), or None outside a repository."""
    output = _ls_files(root)
    if output is None:
        return None
    names = set(output.decode("utf-8", "surrogateescape").split("\0")) - {""}
    return sorted(filter(lambda name: (root / name).is_file(), names))


def walked_files(root: Path, *, include_excluded: bool) -> list[str]:
    """The tree as a walk sees it, for a root outside any repository."""
    prune = only_git_dir if include_excluded else excluded_parts
    return [path.as_posix() for path in walk(root, prune)]


def without_excluded(names: Sequence[str]) -> list[str]:
    return [name for name in names if not is_excluded(name)]


def repository_files(root: Path, *, include_excluded: bool = False) -> list[str]:
    """The files a gate reads: git's view (or the walked tree), without the excluded directories unless asked."""
    names = git_files(root)
    if names is None:
        return walked_files(root, include_excluded=include_excluded)
    return names if include_excluded else without_excluded(names)
