#!/usr/bin/env python3
"""Static gate: the repository stays small enough to clone, build and serve from GitHub Pages.

The files git would commit (tracked plus untracked-but-not-ignored, as on disk now) are measured
against three budgets, so an accidental GeoTIFF, video or screenshot dump fails before it is
committed instead of living in the history forever:

* the whole tree, without the legacy `seed/` photos (migrated as is in M0, moved to Cloud
  Storage in M2), stays within `TREE_BUDGET` (60 MB);
* no single file outside `seed/` exceeds `FILE_BUDGET` (5 MB): rasters and tilesets live in
  Cloud Storage and Mapbox, never in git;
* the e2e screenshot baselines (`__screenshots__/` and Playwright `*-snapshots/` folders under
  `e2e/`) stay within `SCREENSHOT_BUDGET` (15 MB).

Usage: check_repo_budget.py [--root DIR]. Exit status: 0 OK, 1 over budget, 2 usage.
"""

import argparse
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from cilog import bullets, get_logger
from cirepo import ROOT, repository_files

LOG = get_logger("repo-budget")

MB = 1_000_000
TREE_BUDGET = 60 * MB
FILE_BUDGET = 5 * MB
SCREENSHOT_BUDGET = 15 * MB
UNBUDGETED_DIRS = ("seed/",)
SCREENSHOT_ROOT = "e2e/"
SNAPSHOT_SUFFIX = "-snapshots"
SCREENSHOT_DIR = "__screenshots__"


@dataclass(frozen=True)
class Sizes:
    """Bytes per repository-relative file."""

    files: dict[str, int]

    def total(self, names: Sequence[str]) -> int:
        return sum(self.files[name] for name in names)


def is_budgeted(name: str) -> bool:
    return not name.startswith(UNBUDGETED_DIRS)


def is_screenshot(name: str) -> bool:
    folders = PurePosixPath(name).parts[:-1]
    return name.startswith(SCREENSHOT_ROOT) and any(part == SCREENSHOT_DIR or part.endswith(SNAPSHOT_SUFFIX) for part in folders)


def megabytes(size: int) -> str:
    return f"{size / MB:.2f} MB"


def budgeted_names(sizes: Sizes) -> list[str]:
    return [name for name in sizes.files if is_budgeted(name)]


def oversized(sizes: Sizes, names: Sequence[str]) -> list[str]:
    return [
        f"{name}: {megabytes(sizes.files[name])} > {megabytes(FILE_BUDGET)} per file (keep rasters and media in Cloud Storage)"
        for name in sorted(names)
        if sizes.files[name] > FILE_BUDGET
    ]


def over_total(label: str, size: int, budget: int) -> list[str]:
    return [f"{label}: {megabytes(size)} > {megabytes(budget)}"] if size > budget else []


def problems(sizes: Sizes) -> list[str]:
    """Every budget the measured tree exceeds."""
    budgeted = budgeted_names(sizes)
    screenshots = [name for name in budgeted if is_screenshot(name)]
    return (
        oversized(sizes, budgeted)
        + over_total("tree without seed/", sizes.total(budgeted), TREE_BUDGET)
        + over_total("e2e screenshot baselines", sizes.total(screenshots), SCREENSHOT_BUDGET)
    )


def measure(root: Path) -> Sizes:
    return Sizes({name: (root / name).stat().st_size for name in repository_files(root, include_excluded=True)})


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check the repository size budgets (tree, single file, e2e screenshots).")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    sizes = measure(parser.parse_args(argv).root)
    found = problems(sizes)
    if found:
        LOG.error("[repo-budget] FAILED:\n%s", bullets(found))
        return 1
    budgeted = budgeted_names(sizes)
    LOG.info(
        "[repo-budget] OK: %d files, %s without seed/ (budget %s)", len(budgeted), megabytes(sizes.total(budgeted)), megabytes(TREE_BUDGET)
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
