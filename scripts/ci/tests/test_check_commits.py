"""check_commits.py: the Conventional Commits rule, the message mode of the commit-msg hook and the range mode
of the `commits` gate, the latter against real commits in throwaway repositories.

The hook itself (scripts/git-hooks/commit-msg) is driven through real `git commit` runs in test_git_hooks.py.
"""

import io
import logging
import runpy
import sys
from pathlib import Path

import check_commits
import pytest
from treeutil import git, init_repo, write

COMMITS_PY = Path(check_commits.__file__)


@pytest.fixture
def log(caplog: pytest.LogCaptureFixture) -> pytest.LogCaptureFixture:
    caplog.set_level(logging.INFO, logger="hcm")
    return caplog


def commit(root: Path, message: str) -> str:
    """An empty commit with this message (no hooks run); returns its hash."""
    git(root, "commit", "--quiet", "--allow-empty", "--no-verify", "--cleanup=verbatim", "-m", message)
    return git(root, "rev-parse", "HEAD").strip()


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    root = init_repo(tmp_path / "repo")
    write(root, "README.md", "# Fixture")
    git(root, "add", "README.md")
    git(root, "commit", "--quiet", "--no-verify", "-m", "Initial import, before the rule")
    return root


def gate(root: Path, **environ: str) -> int:
    return check_commits.main(["--root", str(root)], environ)


def hook(message: str) -> int:
    return check_commits.main(["--message-file", "-"], {}, io.StringIO(message))


# --- the rule -----------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "message",
    [
        "feat(engine): timeline slider",
        "fix(ci): quote the shard variable\n\nThe body explains why.\n\nCo-Authored-By: Someone <someone@example.invalid>",
        "chore(wip): M0 build-out in progress (agent assets, ci checks)",
        "feat(engine)!: drop the v1 config",
        "revert(admin): restore the setup card",
        "build(deps): bump vite to 8.3.5",
        "docs(research/m0): hand-off addendum",
        "perf(engine): " + "a" * 86,
    ],
)
def test_happy_path_conventional_messages_pass(message: str) -> None:
    assert check_commits.problems(message) == []


@pytest.mark.parametrize(
    ("message", "problem"),
    [
        ("Delete CNAME", f"`Delete CNAME`: {check_commits.EXPECTED}"),
        ("feat: no scope", f"`feat: no scope`: {check_commits.EXPECTED}"),
        ("feature(engine): unknown type", f"`feature(engine): unknown type`: {check_commits.EXPECTED}"),
        ("feat(Engine): upper-case scope", f"`feat(Engine): upper-case scope`: {check_commits.EXPECTED}"),
        ("feat(engine):no space", f"`feat(engine):no space`: {check_commits.EXPECTED}"),
        ("feat(engine): ", f"`feat(engine): `: {check_commits.EXPECTED}"),
        ('Revert "feat(engine): timeline"', f'`Revert "feat(engine): timeline"`: {check_commits.EXPECTED}'),
        ("", "the commit message is empty"),
        ("feat(engine): x\nglued body", "the body must be separated from the subject by a blank line"),
        ("fix(engine): " + "a" * 88, "the subject is 101 characters long (at most 100)"),
    ],
)
def test_bad_path_unconventional_messages_are_explained(message: str, problem: str) -> None:
    assert check_commits.problems(message) == [problem]


def test_happy_path_cleanup_drops_comments_and_the_scissors_section() -> None:
    raw = f"\n# Please enter the commit message\nfeat(ui): button\n\nBody.\n{check_commits.SCISSORS}\ndiff --git a b\n"

    assert check_commits.cleanup(raw) == "feat(ui): button\n\nBody."


# --- message mode -------------------------------------------------------------------------------------


def test_happy_path_hook_message_from_stdin_passes_silently(log: pytest.LogCaptureFixture) -> None:
    assert hook("# git's template\nfeat(ui): button\n") == 0
    assert log.messages == []


@pytest.mark.parametrize("message", ["Merge branch 'feat/x' into master", "fixup! feat(ui): button", "squash! x", "amend! y"])
def test_happy_path_hook_lets_git_generated_subjects_through(message: str) -> None:
    assert hook(message) == 0


def test_bad_path_hook_refuses_an_unconventional_message(log: pytest.LogCaptureFixture) -> None:
    assert hook("Add stuff\n") == 1
    assert log.messages == [f"[commits] not a Conventional Commits message:\n  - `Add stuff`: {check_commits.EXPECTED}"]


def test_happy_path_hook_reads_a_message_file(tmp_path: Path) -> None:
    message = write(tmp_path, "COMMIT_EDITMSG", "test(ci): cover the hook")

    assert check_commits.main(["--message-file", str(message)]) == 0


def test_bad_path_missing_message_file_is_a_usage_error(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    assert check_commits.main(["--message-file", str(tmp_path / "missing")]) == check_commits.EXIT_USAGE
    assert log.messages[-1].startswith("[commits] cannot read the commit message: ")


# --- range mode ---------------------------------------------------------------------------------------


def test_happy_path_without_a_range_the_gate_passes_with_a_notice(repo: Path, log: pytest.LogCaptureFixture) -> None:
    assert gate(repo) == 0
    assert gate(repo, COMMIT_RANGE="  ") == 0
    assert log.messages == ["[commits] COMMIT_RANGE and GITLEAKS_LOG_OPTS unset (set by CI); nothing to check"] * 2


def test_happy_path_conventional_range_passes(repo: Path, log: pytest.LogCaptureFixture) -> None:
    base = git(repo, "rev-parse", "HEAD").strip()
    commit(repo, "feat(engine): timeline")
    head = commit(repo, "fix(engine): off-by-one\n\nBody.")

    assert gate(repo, COMMIT_RANGE=f"{base}..{head}") == 0
    assert log.messages[-1] == f"[commits] OK: 2 commit(s) in {base}..{head} follow Conventional Commits"


def test_bad_path_range_lists_every_offending_commit(repo: Path, log: pytest.LogCaptureFixture) -> None:
    base = git(repo, "rev-parse", "HEAD").strip()
    good = commit(repo, "feat(engine): timeline")
    bad = commit(repo, "WIP")
    fixup = commit(repo, "fixup! feat(engine): timeline")
    spec = f"{base}..{fixup}"

    assert gate(repo, COMMIT_RANGE=spec) == 1
    assert log.messages[-1].splitlines() == [
        f"[commits] {spec}: commits that do not follow Conventional Commits:",
        f"  - {fixup[:12]} an autosquash commit: squash it (git rebase --autosquash) before the pull request",
        f"  - {fixup[:12]} `fixup! feat(engine): timeline`: {check_commits.EXPECTED}",
        f"  - {bad[:12]} `WIP`: {check_commits.EXPECTED}",
    ]
    assert good[:12] not in log.messages[-1]


def test_happy_path_merge_commits_are_left_out_of_the_range(repo: Path) -> None:
    base = git(repo, "rev-parse", "HEAD").strip()
    git(repo, "switch", "--quiet", "-c", "topic")
    commit(repo, "feat(ui): button")
    git(repo, "switch", "--quiet", "master")
    git(repo, "merge", "--quiet", "--no-ff", "--no-verify", "-m", "Merge branch 'topic'", "topic")

    assert gate(repo, COMMIT_RANGE=f"{base}..HEAD") == 0


def test_happy_path_single_revision_checks_that_commit_only(repo: Path, log: pytest.LogCaptureFixture) -> None:
    head = commit(repo, "ci(repo): first commit under the rule")

    assert gate(repo, GITLEAKS_LOG_OPTS=head) == 0
    assert log.messages[-1] == f"[commits] OK: 1 commit(s) in {head} follow Conventional Commits"


def test_happy_path_commit_range_wins_over_the_gitleaks_range(repo: Path, log: pytest.LogCaptureFixture) -> None:
    head = commit(repo, "ci(repo): checked")

    assert gate(repo, COMMIT_RANGE=head, GITLEAKS_LOG_OPTS="HEAD~1") == 0
    assert log.messages[-1].endswith(f"in {head} follow Conventional Commits")


@pytest.mark.parametrize("spec", ["--output=/tmp/x", "a b", "HEAD;rm"])
def test_bad_path_range_that_is_not_a_revision_is_refused(repo: Path, log: pytest.LogCaptureFixture, spec: str) -> None:
    assert gate(repo, COMMIT_RANGE=spec) == check_commits.EXIT_USAGE
    assert log.messages[-1] == f"[commits] cannot list the commit range {spec!r}: it is not `base..head` or one revision"


def test_bad_path_unknown_revision_is_a_git_error(repo: Path, log: pytest.LogCaptureFixture) -> None:
    assert gate(repo, COMMIT_RANGE="0123abc..HEAD") == check_commits.EXIT_USAGE
    assert log.messages[-1].startswith("[commits] cannot list the commit range '0123abc..HEAD': fatal: ")


def test_happy_path_parse_log_skips_empty_records() -> None:
    output = "aaa\x1ffeat(x): y\n\x1e\n\x1e"

    assert check_commits.parse_log(output) == [check_commits.Commit("aaa", "feat(x): y")]


def test_happy_path_script_entry_point_exits_with_main_status(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("COMMIT_RANGE", raising=False)
    monkeypatch.delenv("GITLEAKS_LOG_OPTS", raising=False)
    monkeypatch.setattr(sys, "argv", [str(COMMITS_PY)])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(COMMITS_PY), run_name="__main__")

    assert exit_info.value.code == 0
