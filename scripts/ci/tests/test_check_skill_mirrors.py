"""check_skill_mirrors.py: the two skill trees are byte-identical and every SKILL.md is loadable."""

import runpy
import sys
from pathlib import Path

import check_skill_mirrors as mirrors
import pytest
from treeutil import write

SCRIPT = Path(mirrors.__file__)
SKILL = "---\nname: {name}\ndescription: Use when the pipeline fails.\nallowed-tools:\n  - Bash\n---\n\n# {name}"


def add_skill(root: Path, name: str, text: str | None = None) -> None:
    for tree in (".agents/skills", ".claude/skills"):
        write(root, f"{tree}/{name}/SKILL.md", SKILL.format(name=name) if text is None else text)


def test_happy_path_identical_trees_pass(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    add_skill(tmp_path, "quality-pipeline")
    write(tmp_path, ".agents/skills/quality-pipeline/references/stages.md", "# Stages")
    write(tmp_path, ".claude/skills/quality-pipeline/references/stages.md", "# Stages")

    assert mirrors.main(["--root", str(tmp_path)]) == 0
    assert caplog.messages == ["[skills] OK: 1 skills, 2 files mirrored byte for byte"]


def test_bad_path_missing_trees_are_reported(tmp_path: Path) -> None:
    assert mirrors.check(tmp_path) == ["missing skill tree(s): .agents/skills, .claude/skills"]


def test_bad_path_drift_between_the_trees_is_reported(tmp_path: Path) -> None:
    add_skill(tmp_path, "sonarqube")
    write(tmp_path, ".agents/skills/sonarqube/only-left.md", "x")
    write(tmp_path, ".claude/skills/sonarqube/only-right.md", "x")
    write(tmp_path, ".claude/skills/sonarqube/SKILL.md", SKILL.format(name="sonarqube") + "\nedited in the mirror")

    assert mirrors.check(tmp_path) == [
        ".agents/skills/sonarqube/only-left.md has no mirror",
        ".claude/skills/sonarqube/only-right.md has no mirror",
        "sonarqube/SKILL.md differs between .agents/skills and .claude/skills",
    ]


@pytest.mark.parametrize(
    ("text", "problem"),
    [
        ("# no front matter", "no YAML front matter (--- name / description ---)"),
        ("---\nname: release\ndescription: never closed", "no YAML front matter (--- name / description ---)"),
        ("---\nname: other\ndescription: x\n---", "front matter name 'other' must equal the folder name 'release'"),
        ("---\nname: 'release'\ndescription: \"\"\n---", "front matter has no description"),
    ],
)
def test_bad_path_malformed_front_matter_is_reported(tmp_path: Path, text: str, problem: str) -> None:
    add_skill(tmp_path, "release", text)

    assert mirrors.check(tmp_path) == [f"{tree}/release/SKILL.md: {problem}" for tree in (".agents/skills", ".claude/skills")]


def test_bad_path_skill_folder_without_skill_md_is_reported(tmp_path: Path) -> None:
    for tree in (".agents/skills", ".claude/skills"):
        write(tmp_path, f"{tree}/empty/notes.md", "x")

    assert mirrors.check(tmp_path) == [".agents/skills/empty: no SKILL.md", ".claude/skills/empty: no SKILL.md"]


def test_bad_path_main_fails_and_lists_every_problem(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    assert mirrors.main(["--root", str(tmp_path)]) == 1
    assert caplog.messages == ["[skills] FAILED:\n  - missing skill tree(s): .agents/skills, .claude/skills"]


def test_happy_path_script_entry_point_exits_with_main_status(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--root", str(tmp_path)])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(SCRIPT), run_name="__main__")

    assert exit_info.value.code == 1
