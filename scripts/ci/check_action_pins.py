#!/usr/bin/env python3
"""Static gate: every GitHub Action is pinned to a full commit SHA with its version beside it.

A tag (`@v4`) or a branch (`@main`) can be moved by whoever controls the action's repository, so
a workflow pinned that way runs whatever code is there today. Every `uses:` in
`.github/workflows/*.yml|yaml` and `.github/actions/**/action.yml|yaml` must therefore be

    uses: owner/repo[/path]@<40 hex characters>  # vX.Y.Z

where the comment names the release the SHA belongs to (read by people and by the `deps` stage).
A local action (`./.github/actions/x`) needs no pin; a `docker://` image needs an `@sha256:` digest.

Usage: check_action_pins.py [--root DIR]. Exit status: 0 OK, 1 problems found, 2 usage.
"""

import argparse
import re
import sys
from collections.abc import Sequence
from itertools import chain
from pathlib import Path

from cilog import bullets, get_logger
from cirepo import ROOT

LOG = get_logger("action-pins")

WORKFLOW_GLOBS = (".github/workflows/*.yml", ".github/workflows/*.yaml", ".github/actions/**/action.yml", ".github/actions/**/action.yaml")
USES_RE = re.compile(r"^\s*(?:-\s+)?uses:\s*(?P<quote>['\"]?)(?P<ref>[^\s'\"#]+)(?P=quote)\s*(?:#\s*(?P<comment>.*?))?\s*$")
SHA_RE = re.compile(r"^[^@\s]+/[^@\s]+@[0-9a-f]{40}$")
VERSION_COMMENT_RE = re.compile(r"^v\d+\.\d+\.\d+\b")
DOCKER_DIGEST_RE = re.compile(r"^docker://[^@\s]+@sha256:[0-9a-f]{64}$")


def docker_problem(ref: str) -> str | None:
    return None if DOCKER_DIGEST_RE.match(ref) else f"{ref}: a docker:// image must be pinned by @sha256 digest"


def action_problem(ref: str, comment: str | None) -> str | None:
    if not SHA_RE.match(ref):
        return f"{ref}: pin the action to a full 40-character commit SHA"
    if comment is None or not VERSION_COMMENT_RE.match(comment):
        return f"{ref}: add the release as a trailing `# vX.Y.Z` comment"
    return None


def ref_problem(ref: str, comment: str | None) -> str | None:
    """Why one `uses:` reference is not acceptably pinned (None when it is)."""
    if ref.startswith("./"):
        return None
    if ref.startswith("docker://"):
        return docker_problem(ref)
    return action_problem(ref, comment)


def check_file(path: Path, rel: str) -> tuple[list[str], int]:
    """(problems, `uses:` references) of one workflow or action file."""
    problems: list[str] = []
    count = 0
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        match = USES_RE.match(line)
        if match is None:
            continue
        count += 1
        problem = ref_problem(match.group("ref"), match.group("comment"))
        if problem:
            problems.append(f"{rel}:{number}: {problem}")
    return problems, count


def workflow_files(root: Path) -> list[Path]:
    return sorted({path for pattern in WORKFLOW_GLOBS for path in root.glob(pattern) if path.is_file()})


def check_files(root: Path) -> tuple[list[str], int, int]:
    """(problems, `uses:` references, files) of every workflow and action file below root."""
    files = workflow_files(root)
    results = [check_file(path, path.relative_to(root).as_posix()) for path in files]
    return list(chain.from_iterable(found for found, _ in results)), sum(count for _, count in results), len(files)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check that every GitHub Action is pinned to a full commit SHA with a # vX.Y.Z comment.")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    problems, references, files = check_files(parser.parse_args(argv).root)
    if problems:
        LOG.error("[action-pins] FAILED:\n%s", bullets(problems))
        return 1
    LOG.info("[action-pins] OK: %d uses: reference(s) in %d file(s), every one SHA-pinned", references, files)
    return 0


if __name__ == "__main__":
    sys.exit(main())
