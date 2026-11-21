#!/usr/bin/env python3
"""Conventional Commits: the `commits` gate (static stage) and the check behind scripts/git-hooks/commit-msg.

A commit subject is `type(scope): summary` (.agent/skills/workflow/git_and_pr_skill.md):

- type: feat, fix, docs, refactor, test, build, ci, perf, chore or revert;
- scope: required, lower case (`engine`, `ci`, `deps`, ...; `chore(wip): ...` for work in progress);
- a `!` before the colon marks a breaking change: `feat(engine)!: drop the v1 config`;
- the summary is not empty, and the whole subject line is at most 100 characters;
- a body is separated from the subject by one blank line.

Two modes:

- Range (the gate): every non-merge commit of COMMIT_RANGE (`base..head`, or one revision for that commit
  alone). Without it, the range CI computes for gitleaks-history (GITLEAKS_LOG_OPTS) is used; with neither
  (a local run) the gate passes with a notice, because the commit-msg hook checks each commit as it is made.
  Autosquash subjects (`fixup! `, `squash! `, `amend! `) fail here: squash them before the pull request.
- `--message-file FILE` (`-` reads stdin; the commit-msg hook): one message as git hands it to the hook.
  Comment lines and everything below the scissors line are ignored, as git's default cleanup drops them;
  git's own `Merge ...` subjects and autosquash subjects pass (they are rewritten before a pull request).

Exit status: 0 conventional (or nothing to check), 1 a subject breaks the rule, 2 usage or git error.
"""

import argparse
import os
import re
import subprocess
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO

from cilog import bullets, get_logger
from cirepo import GIT, ROOT

LOG = get_logger("commits")

TYPES = ("feat", "fix", "docs", "refactor", "test", "build", "ci", "perf", "chore", "revert")
SUBJECT = re.compile(rf"^(?:{'|'.join(TYPES)})\([a-z0-9][a-z0-9._/-]*\)!?: \S")
MAX_SUBJECT = 100
AUTOSQUASH = ("fixup! ", "squash! ", "amend! ")
GIT_MERGE = "Merge "
SCISSORS = "# ------------------------ >8 ------------------------"
COMMENT = "#"
RANGE_VARIABLES = ("COMMIT_RANGE", "GITLEAKS_LOG_OPTS")
REVISION = r"[A-Za-z0-9_][A-Za-z0-9_./~^@{}-]*"
RANGE = re.compile(rf"^{REVISION}(?:\.\.\.?{REVISION})?$")
# One record per commit: the hash and the raw message, split by ASCII unit and record separators.
LOG_FORMAT = "--format=%H%x1f%B%x1e"
UNIT, RECORD = "\x1f", "\x1e"
SHORT_SHA = 12
EXIT_USAGE = 2
EXPECTED = f"expected `type(scope): summary`, type one of {', '.join(TYPES)}, scope in lower case (e.g. `engine`, `ci`, `wip`)"


class GitError(Exception):
    """git could not list the range (exit 2)."""


@dataclass(frozen=True)
class Commit:
    sha: str
    message: str

    @property
    def subject(self) -> str:
        return first_line(self.message)


def first_line(message: str) -> str:
    lines = message.splitlines()
    return lines[0] if lines else ""


# --- the rule -----------------------------------------------------------------------------------------


def body_problem(message: str) -> list[str]:
    """A subject alone, or a blank second line; anything else glues the body to the subject."""
    second = message.splitlines()[1:2]
    return ["the body must be separated from the subject by a blank line"] if second and second[0].strip() else []


def problems(message: str) -> list[str]:
    """Why a cleaned-up message breaks the rule (empty when it follows it)."""
    subject = first_line(message)
    if not subject.strip():
        return ["the commit message is empty"]
    found = [] if SUBJECT.match(subject) else [f"`{subject}`: {EXPECTED}"]
    if len(subject) > MAX_SUBJECT:
        found.append(f"the subject is {len(subject)} characters long (at most {MAX_SUBJECT})")
    return found + body_problem(message)


def is_git_generated(subject: str) -> bool:
    """git's own merge subjects and the autosquash markers that `git rebase --autosquash` consumes."""
    return subject.startswith((GIT_MERGE, *AUTOSQUASH))


def cleanup(raw: str) -> str:
    """The message git will record by default: no comment lines, nothing below the scissors line."""
    kept = raw.split(SCISSORS, 1)[0].splitlines()
    return "\n".join(line for line in kept if not line.startswith(COMMENT)).strip()


# --- message mode (the commit-msg hook) ---------------------------------------------------------------


def read_message(source: str, stdin: TextIO) -> str:
    if source == "-":
        return stdin.read()
    return Path(source).read_text(encoding="utf-8")


def check_message(source: str, stdin: TextIO) -> int:
    try:
        message = cleanup(read_message(source, stdin))
    except OSError as error:
        LOG.error("[commits] cannot read the commit message: %s", error)
        return EXIT_USAGE
    found = [] if is_git_generated(first_line(message)) else problems(message)
    if found:
        LOG.error("[commits] not a Conventional Commits message:\n%s", bullets(found))
        return 1
    return 0


# --- range mode (the gate) ----------------------------------------------------------------------------


def commit_range(environ: Mapping[str, str]) -> str | None:
    """COMMIT_RANGE, else the gitleaks range CI computes; None in a local run."""
    return next((environ[name].strip() for name in RANGE_VARIABLES if environ.get(name, "").strip()), None)


def log_command(root: Path, spec: str) -> list[str]:
    limit = [] if ".." in spec else ["--max-count=1"]
    return [GIT, "-C", str(root), "log", "--no-merges", LOG_FORMAT, *limit, "--end-of-options", spec]


def parse_log(output: str) -> list[Commit]:
    records = [record.strip("\n") for record in output.split(RECORD)]
    return [Commit(*record.split(UNIT, 1)) for record in records if UNIT in record]


def commits_in(root: Path, spec: str) -> list[Commit]:
    result = subprocess.run(log_command(root, spec), capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise GitError(result.stderr.strip() or f"git log exited {result.returncode}")
    return parse_log(result.stdout)


def commit_problems(commit: Commit) -> list[str]:
    """Range mode: an autosquash subject is a problem too (it never belongs in a pull request)."""
    found = problems(commit.message.strip())
    if commit.subject.startswith(AUTOSQUASH):
        found.insert(0, "an autosquash commit: squash it (git rebase --autosquash) before the pull request")
    return [f"{commit.sha[:SHORT_SHA]} {problem}" for problem in found]


def listed_commits(root: Path, spec: str) -> list[Commit]:
    """The commits of a range as git lists them; GitError for a spec that is not a range or one revision."""
    if not RANGE.match(spec):
        raise GitError("it is not `base..head` or one revision")
    return commits_in(root, spec)


def check_range(root: Path, spec: str) -> int:
    try:
        commits = listed_commits(root, spec)
    except GitError as error:
        LOG.error("[commits] cannot list the commit range %r: %s", spec, error)
        return EXIT_USAGE
    found = [problem for commit in commits for problem in commit_problems(commit)]
    if found:
        LOG.error("[commits] %s: commits that do not follow Conventional Commits:\n%s", spec, bullets(found))
        return 1
    LOG.info("[commits] OK: %d commit(s) in %s follow Conventional Commits", len(commits), spec)
    return 0


# --- entry point --------------------------------------------------------------------------------------


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check commit messages against Conventional Commits.")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    parser.add_argument("--message-file", help="check one message (the commit-msg hook); `-` reads stdin")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None, environ: Mapping[str, str] | None = None, stdin: TextIO | None = None) -> int:
    args = parse_args(argv)
    if args.message_file is not None:
        return check_message(args.message_file, stdin or sys.stdin)
    spec = commit_range(os.environ if environ is None else environ)
    if spec is None:
        LOG.info("[commits] COMMIT_RANGE and GITLEAKS_LOG_OPTS unset (set by CI); nothing to check")
        return 0
    return check_range(args.root, spec)


if __name__ == "__main__":
    sys.exit(main())
