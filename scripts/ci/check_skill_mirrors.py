#!/usr/bin/env python3
"""Static gate: the agent skills in .agents/skills and .claude/skills are one set.

Different agent tools read skills from different folders (.agents/skills for Codex-style agents,
.claude/skills for Claude Code). The two trees are byte-identical mirrors (edit the .agents copy,
then `cp` it over the mirror); this gate fails when they drift:

* a skill tree is missing;
* a file exists in one tree but not in the other, or differs in bytes between them;
* a skill folder has no SKILL.md;
* a SKILL.md lacks YAML front matter whose `name` equals its folder and whose `description` is
  non-empty (the fields every agent tool uses to decide when to load the skill).

Ported from the sibling Watch-GPS-Dashboard script. Usage: check_skill_mirrors.py [--root DIR]
"""

import argparse
import re
import sys
from collections.abc import Sequence
from pathlib import Path

from cilog import bullets, get_logger
from cirepo import ROOT

LOG = get_logger("skills")

MIRRORS = (Path(".agents", "skills"), Path(".claude", "skills"))
FIELD_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$")
FENCE = "---"


def closing_fence(lines: Sequence[str]) -> int | None:
    """Index of the `---` that closes a leading `---` block, or None when there is no such block."""
    stripped = [line.strip() for line in lines]
    if stripped[:1] != [FENCE]:
        return None
    return stripped.index(FENCE, 1) if FENCE in stripped[1:] else None


def front_matter(text: str) -> dict[str, str] | None:
    """Top-level scalar keys of the leading `---` block, or None when there is none (or it never closes)."""
    lines = text.splitlines()
    closing = closing_fence(lines)
    if closing is None:
        return None
    matches = (FIELD_RE.match(line) for line in lines[1:closing])
    return {match.group(1): match.group(2).strip().strip("\"'") for match in matches if match}


def relative_files(tree: Path) -> set[Path]:
    return {path.relative_to(tree) for path in tree.rglob("*") if path.is_file()}


def check_skill(folder: Path, root: Path) -> list[str]:
    """Front-matter problems of one skill folder (empty when it is well-formed)."""
    rel = folder.relative_to(root).as_posix()
    skill = folder / "SKILL.md"
    if not skill.is_file():
        return [f"{rel}: no SKILL.md"]
    fields = front_matter(skill.read_text(encoding="utf-8"))
    if fields is None:
        return [f"{rel}/SKILL.md: no YAML front matter (--- name / description ---)"]
    errors: list[str] = []
    if fields.get("name") != folder.name:
        errors.append(f"{rel}/SKILL.md: front matter name {fields.get('name')!r} must equal the folder name {folder.name!r}")
    if not fields.get("description"):
        errors.append(f"{rel}/SKILL.md: front matter has no description")
    return errors


def mirror_errors(left: Path, right: Path, root: Path) -> list[str]:
    """Files present on one side only, or different in bytes."""
    left_files, right_files = relative_files(left), relative_files(right)
    errors = [f"{(left / path).relative_to(root).as_posix()} has no mirror" for path in sorted(left_files - right_files)]
    errors += [f"{(right / path).relative_to(root).as_posix()} has no mirror" for path in sorted(right_files - left_files)]
    errors += [
        f"{path.as_posix()} differs between {MIRRORS[0].as_posix()} and {MIRRORS[1].as_posix()}"
        for path in sorted(left_files & right_files)
        if (left / path).read_bytes() != (right / path).read_bytes()
    ]
    return errors


def skill_folders(tree: Path) -> list[Path]:
    return sorted(path for path in tree.iterdir() if path.is_dir())


def missing_trees(root: Path) -> list[str]:
    return [mirror.as_posix() for mirror in MIRRORS if not (root / mirror).is_dir()]


def skill_errors(root: Path) -> list[str]:
    return [error for mirror in MIRRORS for folder in skill_folders(root / mirror) for error in check_skill(folder, root)]


def check(root: Path) -> list[str]:
    """Every problem of the two skill trees below `root`."""
    missing = missing_trees(root)
    if missing:
        return [f"missing skill tree(s): {', '.join(missing)}"]
    return mirror_errors(root / MIRRORS[0], root / MIRRORS[1], root) + skill_errors(root)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check that .agents/skills and .claude/skills are byte-identical mirrors.")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    root: Path = parser.parse_args(argv).root
    errors = check(root)
    if errors:
        LOG.error("[skills] FAILED:\n%s", bullets(errors))
        return 1
    tree = root / MIRRORS[0]
    LOG.info("[skills] OK: %d skills, %d files mirrored byte for byte", len(skill_folders(tree)), len(relative_files(tree)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
