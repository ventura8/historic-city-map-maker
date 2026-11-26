"""e2e_build.py: the e2e build runs again only when an input changed or an output was touched."""

import json
import runpy
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path

import e2e_build
import pytest
from treeutil import git, init_repo, write

SCRIPT = Path(e2e_build.__file__)


class FakeBuild:
    """Stands in for `npm run build:site:e2e`: writes an output per run and exits with `code`."""

    def __init__(self, code: int = 0) -> None:
        self.code = code
        self.runs = 0

    def __call__(self, root: Path) -> int:
        self.runs += 1
        write(root, "dist/e2e-site/bucharest/index.html", f"build {self.runs}")
        write(root, "packages/admin/dist/index.html", "e2e admin")
        return self.code


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    root = init_repo(tmp_path / "repo")
    write(root, ".gitignore", "dist/\nnode_modules/")
    write(root, "packages/engine/src/index.ts", "export {};")
    write(root, "docs/TESTING.md", "# Testing")
    git(root, "add", ".")
    git(root, "commit", "--quiet", "-m", "seed")
    return root


def run(root: Path, build: FakeBuild) -> int:
    return e2e_build.main(["--root", str(root)], build=build)


def test_happy_path_an_unchanged_tree_is_built_once(repo: Path, caplog: pytest.LogCaptureFixture) -> None:
    build = FakeBuild()

    assert run(repo, build) == 0
    assert run(repo, build) == 0

    assert build.runs == 1
    assert caplog.messages[-1].startswith("  e2e build current: no input changed and no output was touched")
    stamp = json.loads((repo / e2e_build.STAMP).read_text(encoding="utf-8"))
    assert sorted(stamp) == ["inputs", "outputs"]


def test_happy_path_documentation_specs_and_ci_files_are_not_inputs(repo: Path) -> None:
    build = FakeBuild()
    run(repo, build)
    write(repo, "docs/TESTING.md", "# Testing, edited")
    write(repo, "e2e/specs/viewer/boot.spec.ts", "// a new spec")
    write(repo, "scripts/ci/pipeline.py", "# tooling")
    write(repo, "README.md", "# Readme")

    assert run(repo, build) == 0
    assert build.runs == 1


@pytest.mark.parametrize(
    ("path", "is_input"),
    [
        ("packages/engine/src/index.ts", True),
        ("packages/admin/src/main.ts", True),
        ("sites/bucharest/site.json", True),
        ("e2e/fixtures/manifest.ts", True),
        ("e2e/admin/world.ts", True),
        ("e2e/projects.ts", True),
        ("e2e/scripts/build-site.ts", True),
        ("packages/ui/README.md", True),
        ("docs/TESTING.md", False),
        ("README.md", False),
        (".github/workflows/ci.yml", False),
        (".agents/skills/x/SKILL.md", False),
        ("e2e/tour/viewer.tour.ts", False),
        ("e2e/admin/specs/journey.spec.ts", False),
        ("e2e/stack/main.ts", False),
        ("scripts/dev/dev-stack.sh", False),
        ("e2e/playwright.config.ts", False),
        ("packages/ui/test/sheet.test.ts", False),
        ("packages/ui/scripts/test/fonts.test.ts", False),
        ("functions/test/deps.test.ts", False),
    ],
)
def test_happy_path_the_inputs_are_every_file_but_the_listed_ones(path: str, is_input: bool) -> None:
    assert (e2e_build.NOT_INPUTS.match(path) is None) is is_input


def test_bad_path_an_edited_input_is_built_again(repo: Path) -> None:
    build = FakeBuild()
    run(repo, build)
    write(repo, "packages/engine/src/index.ts", "export const changed = true;")

    assert run(repo, build) == 0
    assert build.runs == 2


def test_bad_path_a_new_untracked_input_is_built_again(repo: Path) -> None:
    build = FakeBuild()
    run(repo, build)
    write(repo, "packages/engine/src/new.ts", "export {};")

    assert run(repo, build) == 0
    assert build.runs == 2


def test_bad_path_a_deleted_input_is_built_again(repo: Path) -> None:
    build = FakeBuild()
    run(repo, build)
    (repo / "packages/engine/src/index.ts").unlink()

    assert run(repo, build) == 0
    assert build.runs == 2


def test_bad_path_an_output_another_build_rewrote_is_built_again(repo: Path) -> None:
    build = FakeBuild()
    run(repo, build)
    write(repo, "packages/admin/dist/index.html", "the production admin of the build stage")

    assert run(repo, build) == 0
    assert build.runs == 2


def test_bad_path_another_tier_selection_is_built_again(repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    build = FakeBuild()
    run(repo, build)
    monkeypatch.setenv("E2E_TIER", "fn")

    assert run(repo, build) == 0
    assert build.runs == 2


def test_bad_path_a_failed_build_drops_the_stamp(repo: Path, caplog: pytest.LogCaptureFixture) -> None:
    run(repo, FakeBuild())
    write(repo, "packages/engine/src/index.ts", "export const broken = ;")

    assert run(repo, FakeBuild(code=2)) == 2

    assert not (repo / e2e_build.STAMP).exists()
    assert caplog.messages[-1] == "  e2e build failed: npm run --silent build:site:e2e (exit 2)"


@pytest.mark.parametrize("stamp", ["not json", "[]", '{"inputs": 1}'])
def test_bad_path_an_unreadable_or_foreign_stamp_is_built_again(repo: Path, stamp: str) -> None:
    write(repo, e2e_build.STAMP.as_posix(), stamp)
    build = FakeBuild()

    assert run(repo, build) == 0
    assert build.runs == 1


def test_happy_path_the_real_build_runs_npm_from_the_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[Sequence[str], Path, bool]] = []

    def fake_run(argv: Sequence[str], *, cwd: Path, check: bool) -> subprocess.CompletedProcess[str]:
        calls.append((argv, cwd, check))
        return subprocess.CompletedProcess(argv, 4)

    monkeypatch.setattr(subprocess, "run", fake_run)

    assert e2e_build.run_build(tmp_path) == 4
    assert calls == [(("npm", "run", "--silent", "build:site:e2e"), tmp_path, False)]


def test_happy_path_script_entry_point_exits_with_main_status(repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    run(repo, FakeBuild())
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--root", str(repo)])

    with pytest.raises(SystemExit) as raised:
        runpy.run_path(str(SCRIPT), run_name="__main__")

    assert raised.value.code == 0
