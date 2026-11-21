"""scripts/git-hooks/pre-commit, commit-msg and pre-push, exercised by real git in throwaway repositories.

Each test builds a repository under tmp_path holding copies of the hooks, the CI scripts they call
and .gitleaks.toml, installs the hooks with `core.hooksPath` exactly as docs/SETUP.md says, then
commits and pushes (to a bare repository next to it) as a developer would. Inside the quality image
(HCM_TEST_IMAGE=1) the hooks run the real suppression scanner, the real gitleaks and the real
Conventional Commits check; the Docker path is checked with a fake `docker` that records its arguments
and runs the command it wraps.

Banned directives and the fake credential are assembled from fragments at run time, so this file
contains neither (the suppression scan and gitleaks scan it too).
"""

import hashlib
import os
import shutil
import string
import subprocess
from dataclasses import dataclass
from pathlib import Path

import pytest

import pipeline

REPO_ROOT = Path(__file__).resolve().parents[3]
HOOKS_DIR = REPO_ROOT / "scripts" / "git-hooks"
CI_DIR = REPO_ROOT / "scripts" / "ci"
IMAGE = "hcm-quality:local"
ZERO_SHA = "0" * 40

# Records every docker call, answers `docker image inspect` (unless told the image is missing) and
# runs the command that follows the image name of a `docker run`, like the real image would.
FAKE_DOCKER = """#!/usr/bin/env bash
printf '%s\\n' "$*" >>"$DOCKER_LOG"
if [[ "$1" == "image" ]]; then
    [[ "${FAKE_IMAGE_MISSING:-}" != "1" ]]
    exit
fi
while [[ $# -gt 0 && "$1" != "$FAKE_IMAGE" ]]; do
    shift
done
shift
exec "$@"
"""


def d(*parts: str) -> str:
    return "".join(parts)


def fake_github_token() -> str:
    """A token shaped like a GitHub personal access token (high entropy, deterministic, never real)."""
    alphabet = string.ascii_letters + string.digits
    body = "".join(alphabet[byte % len(alphabet)] for byte in hashlib.sha512(b"hcm-hook-test").digest())
    return d("gh", "p_", body[:36])


@dataclass
class Repo:
    root: Path
    env: dict[str, str]

    def git(self, *args: str, stdin: str | None = None) -> subprocess.CompletedProcess[str]:
        return subprocess.run(["git", *args], cwd=self.root, env=self.env, input=stdin, capture_output=True, text=True, check=False)

    def write(self, relative: str, text: str) -> None:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text + "\n", encoding="utf-8")

    def commit(self, *relatives: str, message: str = "feat(test): change") -> subprocess.CompletedProcess[str]:
        added = self.git("add", "--", *relatives)
        assert added.returncode == 0, added.stderr
        return self.git("commit", "-m", message)

    def head(self) -> str:
        return self.git("rev-parse", "HEAD").stdout.strip()

    def commit_count(self) -> int:
        return int(self.git("rev-list", "--count", "HEAD").stdout)

    def mark_green(self) -> None:
        """reports/pipeline/green-all.json, written by the pipeline's own code for this tree."""
        pipeline.write_green_marker("all", pipeline.default_context(self.root))

    def pre_push(self, line: str) -> subprocess.CompletedProcess[str]:
        """The pre-push hook fed one ref line on stdin, as git does."""
        hook = str(self.root / "scripts" / "git-hooks" / "pre-push")
        return subprocess.run(
            ["bash", hook, "origin", "fake-url"], cwd=self.root, env=self.env, input=line, capture_output=True, text=True, check=False
        )


def copy_tree_files(repo_root: Path) -> None:
    for hook in ("pre-commit", "commit-msg", "pre-push"):
        target = repo_root / "scripts" / "git-hooks" / hook
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(HOOKS_DIR / hook, target)
    (repo_root / "scripts" / "ci").mkdir(parents=True, exist_ok=True)
    for script in CI_DIR.glob("*.py"):
        shutil.copy2(script, repo_root / "scripts" / "ci" / script.name)
    shutil.copy2(REPO_ROOT / ".gitleaks.toml", repo_root / ".gitleaks.toml")
    (repo_root / ".gitignore").write_text("reports/\n__pycache__/\n", encoding="utf-8")


@pytest.fixture
def repo(tmp_path: Path) -> Repo:
    root = tmp_path / "work"
    root.mkdir()
    copy_tree_files(root)
    global_config = tmp_path / "gitconfig"
    global_config.write_text("", encoding="utf-8")
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "Hook Test",
        "GIT_AUTHOR_EMAIL": "hooks@example.invalid",
        "GIT_COMMITTER_NAME": "Hook Test",
        "GIT_COMMITTER_EMAIL": "hooks@example.invalid",
        "GIT_CONFIG_GLOBAL": str(global_config),
        "HCM_TEST_IMAGE": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    created = Repo(root, env)
    for args in (("init", "-q", "-b", "master"), ("config", "core.hooksPath", "scripts/git-hooks"), ("add", "-A")):
        assert created.git(*args).returncode == 0
    assert created.git("commit", "-q", "--no-verify", "-m", "chore: fixture").returncode == 0
    remote = tmp_path / "remote.git"
    assert subprocess.run(["git", "init", "-q", "--bare", str(remote)], env=env, check=False).returncode == 0
    assert created.git("remote", "add", "origin", str(remote)).returncode == 0
    return created


def use_fake_docker(repo: Repo, tmp_path: Path, *, image_missing: bool = False) -> Path:
    """Puts a recording `docker` first on PATH and leaves the image (HCM_TEST_IMAGE unset); returns its log."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    docker = bin_dir / "docker"
    docker.write_text(FAKE_DOCKER, encoding="utf-8")
    docker.chmod(0o755)
    log = tmp_path / "docker.log"
    repo.env.pop("HCM_TEST_IMAGE")
    repo.env.update(
        PATH=f"{bin_dir}{os.pathsep}{repo.env['PATH']}",
        DOCKER_LOG=str(log),
        FAKE_IMAGE=IMAGE,
        FAKE_IMAGE_MISSING="1" if image_missing else "0",
    )
    return log


def output(result: subprocess.CompletedProcess[str]) -> str:
    """Everything a hook printed: git sends a hook's stdout to stderr, a direct run keeps them apart."""
    return result.stdout + result.stderr


def path_without(tool: str, path: str) -> str:
    return os.pathsep.join(entry for entry in path.split(os.pathsep) if not (Path(entry) / tool).exists())


# --- pre-commit -------------------------------------------------------------------------------------


def test_happy_path_clean_commit_passes_both_scans(repo: Repo) -> None:
    repo.write("packages/app/src/main.ts", "export const answer = 42;")

    result = repo.commit("packages/app/src/main.ts")

    assert result.returncode == 0, result.stderr
    assert "inline-suppression scan on 1 staged file(s)" in output(result)
    assert "gitleaks on the staged changes" in output(result)
    assert repo.commit_count() == 2


def test_happy_path_empty_commit_runs_no_scan(repo: Repo) -> None:
    result = repo.git("commit", "--allow-empty", "-m", "chore(test): empty")

    assert result.returncode == 0, result.stderr
    assert "scan" not in output(result)


@pytest.mark.parametrize(
    "relative",
    [".env", "config/.env.production", ".sonar-token", "functions/.secret.local", "keys/ci-service-account.json", "certs/deploy.p12"],
)
def test_bad_path_secret_bearing_file_is_refused(repo: Repo, relative: str) -> None:
    repo.write(relative, "placeholder")

    result = repo.commit(relative)

    assert result.returncode == 1
    assert f"[pre-commit] refused: {relative} holds secrets" in result.stderr
    assert repo.commit_count() == 1


def test_happy_path_env_example_is_committed(repo: Repo) -> None:
    repo.write(".env.example", "MAPBOX_TOKEN=")

    result = repo.commit(".env.example")

    assert result.returncode == 0, result.stderr


def test_bad_path_staged_suppression_is_refused_even_when_the_worktree_is_clean(repo: Repo) -> None:
    repo.write("packages/app/src/main.ts", d("// es", "lint-dis", "able-next-line no-console"))
    assert repo.git("add", "packages/app/src/main.ts").returncode == 0
    repo.write("packages/app/src/main.ts", "export const clean = true;")

    result = repo.git("commit", "-m", "feat(app): sneaky")

    assert result.returncode == 1
    assert "packages/app/src/main.ts:1: forbidden eslint-disable/enable directive" in output(result)
    assert "[pre-commit] refused: inline suppressions are banned" in result.stderr
    assert repo.commit_count() == 1


def test_happy_path_unstaged_suppression_does_not_block_a_clean_commit(repo: Repo) -> None:
    repo.write("tool.py", "VALUE = 1")
    assert repo.git("add", "tool.py").returncode == 0
    repo.write("tool.py", d("VALUE = 1  # no", "qa: E501"))

    result = repo.git("commit", "-m", "feat(tool): value")

    assert result.returncode == 0, result.stderr


def test_bad_path_staged_secret_is_refused_by_gitleaks(repo: Repo) -> None:
    repo.write("packages/app/src/config.ts", f"export const token = '{fake_github_token()}';")

    result = repo.commit("packages/app/src/config.ts")

    assert result.returncode == 1
    assert "[pre-commit] refused: gitleaks found a secret" in result.stderr
    assert repo.commit_count() == 1


def test_happy_path_outside_the_image_tools_run_in_the_quality_image(repo: Repo, tmp_path: Path) -> None:
    log = use_fake_docker(repo, tmp_path)
    repo.write("README.md", "# Fixture")

    result = repo.commit("README.md")

    assert result.returncode == 0, result.stderr
    runs = [line for line in log.read_text(encoding="utf-8").splitlines() if line.startswith("run ")]
    assert len(runs) == 3
    assert all(f"--network none --user {os.getuid()}:{os.getgid()}" in line for line in runs)
    assert all(f"--volume={repo.root}:{repo.root} " in line and f"--workdir {repo.root} {IMAGE} " in line for line in runs)
    assert "python3 scripts/ci/check_no_inline_suppressions.py --root " in runs[0]
    assert runs[1].endswith(f"gitleaks git --pre-commit --staged --redact --no-banner --config .gitleaks.toml {repo.root}")
    assert runs[2].startswith("run --rm --interactive --network none ")
    assert runs[2].endswith(f"{IMAGE} python3 scripts/ci/check_commits.py --message-file -")


def test_bad_path_missing_quality_image_is_reported(repo: Repo, tmp_path: Path) -> None:
    use_fake_docker(repo, tmp_path, image_missing=True)
    repo.write("README.md", "# Fixture")

    result = repo.commit("README.md")

    assert result.returncode == 1
    assert "the quality image hcm-quality:local is missing; build it once with: bash scripts/ci/build-and-test.sh" in result.stderr


def test_bad_path_missing_docker_is_reported(repo: Repo) -> None:
    repo.env.pop("HCM_TEST_IMAGE")
    repo.env["PATH"] = path_without("docker", repo.env["PATH"])
    repo.write("README.md", "# Fixture")

    result = repo.commit("README.md")

    assert result.returncode == 1
    assert "[pre-commit] refused: docker is required" in result.stderr


# --- commit-msg -------------------------------------------------------------------------------------


@pytest.mark.parametrize("message", ["Add stuff", "feat: no scope", "update(engine): unknown type"])
def test_bad_path_unconventional_message_is_refused(repo: Repo, message: str) -> None:
    repo.write("README.md", "# Fixture")

    result = repo.commit("README.md", message=message)

    assert result.returncode == 1
    assert f"`{message}`: expected `type(scope): summary`" in output(result)
    assert "[commit-msg] refused: write the subject as type(scope): summary" in result.stderr
    assert repo.commit_count() == 1


def test_happy_path_editor_template_comments_are_ignored(repo: Repo) -> None:
    repo.write("README.md", "# Fixture")
    assert repo.git("add", "README.md").returncode == 0
    repo.env["GIT_EDITOR"] = "true"
    template = repo.root.parent / "message.txt"
    template.write_text("docs(repo): readme\n\n# Please enter the commit message for your changes.\n", encoding="utf-8")

    result = repo.git("commit", "--edit", "-F", str(template))

    assert result.returncode == 0, result.stderr
    assert repo.git("log", "-1", "--format=%B").stdout.strip() == "docs(repo): readme"


def test_happy_path_git_generated_subjects_pass_the_hook(repo: Repo) -> None:
    assert repo.git("switch", "-q", "-c", "topic").returncode == 0
    repo.write("README.md", "# Topic")
    assert repo.commit("README.md", message="docs(repo): topic readme").returncode == 0
    assert repo.git("commit", "--allow-empty", "--fixup", "HEAD").returncode == 0
    assert repo.git("switch", "-q", "master").returncode == 0

    result = repo.git("merge", "--no-ff", "--no-edit", "topic")

    assert result.returncode == 0, result.stderr
    assert repo.git("log", "-1", "--format=%s").stdout.strip() == "Merge branch 'topic'"


def test_bad_path_commit_msg_without_docker_is_reported(repo: Repo, tmp_path: Path) -> None:
    hook = str(repo.root / "scripts" / "git-hooks" / "commit-msg")
    message = tmp_path / "COMMIT_EDITMSG"
    message.write_text("feat(test): change\n", encoding="utf-8")
    repo.env.pop("HCM_TEST_IMAGE")
    repo.env["PATH"] = path_without("docker", repo.env["PATH"])

    result = subprocess.run(["bash", hook, str(message)], cwd=repo.root, env=repo.env, capture_output=True, text=True, check=False)

    assert result.returncode == 1
    assert "[commit-msg] refused: docker is required" in result.stderr


def test_bad_path_commit_msg_with_a_missing_image_or_message_file_is_refused(repo: Repo, tmp_path: Path) -> None:
    hook = str(repo.root / "scripts" / "git-hooks" / "commit-msg")
    message = tmp_path / "COMMIT_EDITMSG"
    message.write_text("feat(test): change\n", encoding="utf-8")
    use_fake_docker(repo, tmp_path, image_missing=True)

    def run(*args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(["bash", hook, *args], cwd=repo.root, env=repo.env, capture_output=True, text=True, check=False)

    assert "the quality image hcm-quality:local is missing" in run(str(message)).stderr
    assert "expected the commit message file as the only argument" in run(str(tmp_path / "missing")).stderr


# --- pre-push ---------------------------------------------------------------------------------------


def test_happy_path_work_branch_is_pushed_without_a_marker(repo: Repo) -> None:
    result = repo.git("push", "origin", "HEAD:refs/heads/feat/engine-rewrite")

    assert result.returncode == 0, result.stderr


def test_bad_path_master_without_marker_is_refused(repo: Repo) -> None:
    result = repo.git("push", "origin", "master")

    assert result.returncode != 0
    assert "[pre-push] refused: no reports/pipeline/green-all.json" in result.stderr
    assert "PIPELINE_STAGE=all bash scripts/ci/run-all-checks.sh" in result.stderr


def test_happy_path_master_with_green_marker_is_pushed(repo: Repo) -> None:
    repo.mark_green()

    result = repo.git("push", "origin", "master")

    assert result.returncode == 0, result.stderr
    assert f"[pre-push] PIPELINE_STAGE=all passed on {repo.head()[:12]} with a clean tree" in output(result)


def test_bad_path_marker_of_an_older_commit_is_refused(repo: Repo) -> None:
    repo.mark_green()
    repo.write("README.md", "# Newer")
    assert repo.commit("README.md").returncode == 0

    result = repo.git("push", "origin", "master")

    assert result.returncode != 0
    assert f"commit {repo.head()[:12]} is not the one PIPELINE_STAGE=all passed on" in result.stderr


def test_bad_path_dirty_tree_is_refused(repo: Repo) -> None:
    repo.mark_green()
    repo.write("notes.txt", "untracked")

    result = repo.git("push", "origin", "master")

    assert result.returncode != 0
    assert "the working tree has uncommitted or untracked changes" in result.stderr


def test_bad_path_marker_of_a_dirty_tree_is_refused(repo: Repo) -> None:
    repo.write("notes.txt", "untracked")
    repo.mark_green()
    (repo.root / "notes.txt").unlink()

    result = repo.git("push", "origin", "master")

    assert result.returncode != 0
    assert "the green run validated a tree with uncommitted changes" in result.stderr


def test_happy_path_release_tag_on_the_green_commit_is_pushed(repo: Repo) -> None:
    repo.mark_green()
    assert repo.git("tag", "-a", "v1.2.3", "-m", "v1.2.3").returncode == 0

    result = repo.git("push", "origin", "v1.2.3")

    assert result.returncode == 0, result.stderr


def test_bad_path_release_tag_on_another_commit_is_refused(repo: Repo) -> None:
    assert repo.git("tag", "v1.0.0").returncode == 0
    repo.write("README.md", "# Newer")
    assert repo.commit("README.md").returncode == 0
    repo.mark_green()

    result = repo.git("push", "origin", "v1.0.0")

    assert result.returncode != 0
    assert "is not the one PIPELINE_STAGE=all passed on" in result.stderr


def test_happy_path_other_tags_need_no_marker(repo: Repo) -> None:
    assert repo.git("tag", "legacy-2022").returncode == 0

    result = repo.git("push", "origin", "legacy-2022")

    assert result.returncode == 0, result.stderr


def test_happy_path_deleting_master_needs_no_marker(repo: Repo) -> None:
    result = repo.pre_push(f"(delete) {ZERO_SHA} refs/heads/master {repo.head()}\n")

    assert result.returncode == 0, result.stderr


def test_happy_path_nothing_to_push_needs_no_marker(repo: Repo) -> None:
    result = repo.pre_push("")

    assert result.returncode == 0, result.stderr


def test_bad_path_unknown_local_commit_is_refused(repo: Repo) -> None:
    result = repo.pre_push(f"refs/heads/master {'1' * 40} refs/heads/master {ZERO_SHA}\n")

    assert result.returncode == 1
    assert "cannot resolve refs/heads/master (111111111111) to a commit" in result.stderr
