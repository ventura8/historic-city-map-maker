"""check_agent_assets.py: AGENTS.md budgets, skill and subagent front matter, and documented paths."""

import runpy
import subprocess
import sys
from pathlib import Path

import check_agent_assets as assets
import pytest
from treeutil import init_repo, write

SCRIPT = Path(assets.__file__)
SKILL = "---\nname: {name}\ndescription: {description}\n---\n\n# Skill"
AGENT = "---\nname: {name}\ndescription: Runs one pipeline stage.\ntools: Bash, Read\n---\n\n# Agent"


def minimal_tree(root: Path) -> Path:
    write(root, "AGENTS.md", "# AI Instructions\n\nRead `docs/SETUP.md` first.")
    write(root, "docs/SETUP.md", "# Setup")
    return root


# --- budgets -------------------------------------------------------------------------------------


def test_happy_path_small_tree_passes(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    minimal_tree(tmp_path)

    assert assets.main(["--root", str(tmp_path)]) == 0
    assert caplog.messages[-1].startswith("[agents] OK: AGENTS.md 47/24000 bytes, chains within 32768, skills and subagents")
    assert caplog.messages[-1].endswith(", 1 path references resolve")


def test_bad_path_missing_root_agents_md(tmp_path: Path) -> None:
    assert assets.check_budgets(tmp_path) == ["AGENTS.md: missing at the repository root"]


def test_bad_path_oversized_root_agents_md(tmp_path: Path) -> None:
    write(tmp_path, "AGENTS.md", "x" * assets.ROOT_AGENTS_MAX_BYTES)

    assert assets.check_budgets(tmp_path) == [
        "AGENTS.md: 24001 bytes > 24000 (Antigravity truncates the rest; move detail into a skill)",
    ]


def test_bad_path_oversized_chain_names_the_leaf(tmp_path: Path) -> None:
    write(tmp_path, "AGENTS.md", "x" * 20_000)
    write(tmp_path, "packages/AGENTS.md", "x" * 10_000)
    write(tmp_path, "packages/engine/AGENTS.md", "x" * 5_000)
    write(tmp_path, "node_modules/pkg/AGENTS.md", "x" * 40_000)

    assert assets.check_budgets(tmp_path) == [
        "packages/engine/AGENTS.md: the AGENTS.md chain from the root is 35003 bytes > 32768 (Codex drops the rest)",
    ]


# --- skills and subagents ------------------------------------------------------------------------


def test_happy_path_well_formed_skill_passes(tmp_path: Path) -> None:
    write(tmp_path, ".agents/skills/quality-pipeline/SKILL.md", SKILL.format(name="quality-pipeline", description="Use when a gate fails."))

    assert assets.check_skills(tmp_path) == []


@pytest.mark.parametrize(
    ("folder", "name", "description", "problems"),
    [
        ("my-skill", "other", "x", ["name 'other' must equal the folder name 'my-skill'"]),
        ("Bad_Name", "Bad_Name", "x", ["name 'Bad_Name' must match ^[a-z0-9-]{1,64}$ without 'claude' / 'anthropic'"]),
        ("claude-helper", "claude-helper", "x", ["name 'claude-helper' must match ^[a-z0-9-]{1,64}$ without 'claude' / 'anthropic'"]),
        ("my-skill", "my-skill", "", ["no description"]),
        ("my-skill", "my-skill", "y" * 1025, ["description is 1025 characters > 1024"]),
        ("my-skill", "my-skill", "Use <this>", ["description contains an angle bracket"]),
    ],
)
def test_bad_path_skill_front_matter_problems(tmp_path: Path, folder: str, name: str, description: str, problems: list[str]) -> None:
    write(tmp_path, f".claude/skills/{folder}/SKILL.md", SKILL.format(name=name, description=description))

    assert assets.check_skills(tmp_path) == [f".claude/skills/{folder}/SKILL.md: {problem}" for problem in problems]


def test_bad_path_skill_without_skill_md_or_front_matter(tmp_path: Path) -> None:
    write(tmp_path, ".agents/skills/empty/notes.md", "x")
    write(tmp_path, ".agents/skills/plain/SKILL.md", "# no front matter")

    assert assets.check_skills(tmp_path) == [
        ".agents/skills/empty: no SKILL.md",
        ".agents/skills/plain/SKILL.md: no YAML front matter (--- name / description ---)",
    ]


def test_bad_path_long_skill_documents_exceed_the_line_budget(tmp_path: Path) -> None:
    body = "\n".join(["line"] * 500)
    write(tmp_path, ".agents/skills/big/SKILL.md", SKILL.format(name="big", description="x") + "\n" + body)
    write(tmp_path, ".agent/skills/quality/pipeline_skill.md", body + "\nline")
    write(tmp_path, ".agent/skills/quality/short_skill.md", body)

    assert assets.check_skills(tmp_path) == [
        ".agents/skills/big/SKILL.md: 506 lines > 500 (move detail into a reference file)",
        ".agent/skills/quality/pipeline_skill.md: 501 lines > 500 (move detail into a reference file)",
    ]


def test_happy_and_bad_path_subagents(tmp_path: Path) -> None:
    write(tmp_path, ".claude/agents/pipeline-runner.md", AGENT.format(name="pipeline-runner"))
    write(tmp_path, ".claude/agents/renamed.md", AGENT.format(name="old-name"))
    write(tmp_path, ".claude/agents/bare.md", "# no front matter")
    write(tmp_path, ".claude/agents/thin.md", "---\nname: thin\n---")

    assert assets.check_subagents(tmp_path) == [
        ".claude/agents/bare.md: no YAML front matter",
        ".claude/agents/renamed.md: name 'old-name' must equal the file name 'renamed'",
        ".claude/agents/thin.md: front matter has no description",
        ".claude/agents/thin.md: front matter has no tools",
    ]


# --- paths ---------------------------------------------------------------------------------------


def test_happy_path_existing_planned_and_ignored_paths_resolve(tmp_path: Path) -> None:
    init_repo(tmp_path)
    write(tmp_path, ".gitignore", "reports/\n.sonar-token")
    write(tmp_path, ".agent/skills/quality/pipeline_skill.md", "# Pipeline")
    write(
        tmp_path,
        "docs/research/M0-handoff.md",
        "# Hand-off\n\n## 9. Planned paths\n\n- `scripts/ci/check_dependency_updates.py`: the deps stage\n"
        "| `e2e/playwright.config.ts` | M1 |\n\n## 10. Other\n\n- `docs/not-planned.md`",
    )
    write(
        tmp_path,
        "AGENTS.md",
        "Read `.agent/skills/quality/pipeline_skill.md` and `quality/pipeline_skill.md:12`.\n"
        "Planned: `scripts/ci/check_dependency_updates.py`, `e2e/playwright.config.ts`.\n"
        "Ignored: `reports/pipeline/green-all.json`, `.sonar-token`.\n"
        "Not paths: `packages/*/src`, `<dir>/package.json`, `npm run lint`, `docs/releases/vX.Y.Z.md`, `@hcm/shared`.\n"
        "```bash\ncat docs/inside-a-fence.md\n```\n"
        "Links: [web](https://example.invalid/x), [anchor](#top), [skill](.agent/skills/quality/pipeline_skill.md#stages).",
    )

    errors, checked = assets.check_paths(tmp_path)

    assert errors == []
    assert checked == 6


def test_happy_path_unbuilt_output_folders_count_as_ignored_in_a_fresh_clone(tmp_path: Path) -> None:
    # A fresh clone has no build output yet: `functions/dist` does not exist, so git only matches `dist/` when asked as
    # a folder. A missing path that no pattern ignores, as a file or as a folder, still fails.
    init_repo(tmp_path)
    write(tmp_path, ".gitignore", "dist/\n")
    write(
        tmp_path,
        "docs/TESTING.md",
        "Built: `functions/dist`, `functions/dist/`, `packages/admin/dist/`, `functions/dist/index.js`,"
        " [bundle](../packages/engine/dist).\n"
        "Gone: `functions/gone`, `docs/distant.md`.",
    )

    errors, checked = assets.check_paths(tmp_path)

    assert errors == [
        "docs/TESTING.md:2: `functions/gone` does not exist",
        "docs/TESTING.md:2: `docs/distant.md` does not exist",
    ]
    assert checked == 7
    assert assets.ignore_queries(["functions/dist/", "reports/", "functions/dist"]) == ["functions/dist", "functions/dist/", "reports/"]


def test_bad_path_missing_paths_are_reported_with_their_line(tmp_path: Path) -> None:
    init_repo(tmp_path)
    write(tmp_path, "docs/research/M0-handoff.md", "# Hand-off\n\n## Other\n\n- `docs/not-planned.md`")
    write(tmp_path, "CLAUDE.md", "See `docs/not-planned.md`, `README.md`\nand [the guide](docs/GUIDE.md) and `docs/gone/`.")
    write(tmp_path, "docs/research/PLAN.md", "Research names `src/engine/old.ts` and `docs/never.md`.")

    errors, checked = assets.check_paths(tmp_path)

    assert errors == [
        "CLAUDE.md:1: `docs/not-planned.md` does not exist",
        "CLAUDE.md:1: `README.md` does not exist",
        "CLAUDE.md:2: `docs/gone/` does not exist",
        "CLAUDE.md:2: `docs/GUIDE.md` does not exist",
    ]
    assert checked == 4


def test_bad_path_without_git_nothing_counts_as_ignored(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    write(tmp_path, "README.md", "`reports/x.json`")

    assert assets.check_paths(tmp_path)[0] == ["README.md:1: `reports/x.json` does not exist"]

    def no_git(*_args: object, **_kwargs: object) -> subprocess.CompletedProcess[str]:
        raise FileNotFoundError("git")

    monkeypatch.setattr(subprocess, "run", no_git)

    assert assets.git_ignored(tmp_path, ["reports/x.json"]) == set()


def test_happy_path_link_outside_the_root_keeps_its_written_form(tmp_path: Path) -> None:
    write(tmp_path, "docs/a.md", "[up](../../outside.md)")

    assert assets.check_paths(tmp_path)[0] == ["docs/a.md:1: `../../outside.md` does not exist"]


def test_bad_path_main_lists_every_problem(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    write(tmp_path, "README.md", "`docs/missing.md`")

    assert assets.main(["--root", str(tmp_path)]) == 1
    assert caplog.messages == [
        "[agents] FAILED:\n  - AGENTS.md: missing at the repository root\n  - README.md:1: `docs/missing.md` does not exist",
    ]


def test_happy_path_script_entry_point_exits_with_main_status(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    minimal_tree(tmp_path)
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--root", str(tmp_path)])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(SCRIPT), run_name="__main__")

    assert exit_info.value.code == 0
