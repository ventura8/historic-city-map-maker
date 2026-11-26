#!/usr/bin/env python3
"""Static gate: the agent assets stay loadable, small and pointed at files that exist.

Every agent tool reads these files, and each one has limits that fail silently:

* **AGENTS.md budgets.** Antigravity truncates a rule file over 24,000 bytes and Codex stops
  reading the AGENTS.md chain (root down to the working directory) after 32 KiB: the rest is
  dropped without a warning. The root AGENTS.md must stay within `ROOT_AGENTS_MAX_BYTES` and every
  root-to-leaf chain of AGENTS.md files within `CHAIN_MAX_BYTES`.
* **Skills.** Each `SKILL.md` (`.agents/skills/*` and its `.claude/skills` mirror) has front
  matter whose `name` equals its folder and matches `^[a-z0-9-]{1,64}$` (without "claude" or
  "anthropic"), a `description` of at most 1,024 characters without angle brackets, and at most
  500 lines; so does every `.agent/skills/**` document (line budget only).
* **Subagents.** Each `.claude/agents/*.md` has front matter with `name` equal to the file name,
  a `description` and a `tools` list.
* **Paths.** Every repository path written in back-ticks, or as a relative Markdown link, in
  AGENTS.md, CLAUDE.md, README.md, `.agent/`, `.agents/`, `.claude/` and `docs/` exists, or is
  git-ignored (`reports/`, `.sonar-token`, and build output such as `functions/dist` that a fresh clone has not built
  yet: a missing path is also asked as a folder), or is listed under *Planned paths* in
  `docs/research/M0-handoff.md` (`PLANNED_PATHS_DOC`). A moved or deleted file then fails here
  instead of sending the next agent to a file that is not there. `docs/research/` itself is the
  verbatim record of the research (alternative layouts included), so its own references are not
  checked.

Ported from the sibling Watch-GPS-Dashboard script. Usage: check_agent_assets.py [--root DIR]
"""

import argparse
import re
import subprocess
import sys
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path

from check_skill_mirrors import front_matter
from cilog import bullets, get_logger
from cirepo import GIT, ROOT, excluded_parts

LOG = get_logger("agents")

ROOT_AGENTS_MAX_BYTES = 24_000
CHAIN_MAX_BYTES = 32_768
SKILL_MAX_LINES = 500
DESCRIPTION_MAX_CHARS = 1024
NAME_RE = re.compile(r"^[a-z0-9-]{1,64}$")
RESERVED_NAME_WORDS = ("claude", "anthropic")
GIT_CHECK_IGNORE_OK = (0, 1)

SKILL_TREES = (".agents/skills", ".claude/skills")
SKILL_DOCS = ".agent/skills"
SUBAGENT_DIR = ".claude/agents"

# Markdown whose path references are checked (globs relative to the root), and what is skipped.
DOC_GLOBS = (
    "AGENTS.md",
    "CLAUDE.md",
    "README.md",
    "*/AGENTS.md",
    "*/CLAUDE.md",
    ".agent/**/*.md",
    ".agents/**/*.md",
    ".claude/**/*.md",
    "docs/**/*.md",
)
UNCHECKED_DOC_DIRS = ("docs/research/",)
PLANNED_PATHS_DOC = Path("docs", "research", "M0-handoff.md")
PLANNED_HEADING_RE = re.compile(r"^#{1,6}\s+(?:\d+(?:\.\d+)*\.?\s+)?Planned paths\b", re.IGNORECASE)

# A back-ticked token is a repository path when it starts with one of these folders or is one of
# the root files; anything else in back-ticks is code, a command, a package or a class name.
PATH_ROOTS = (
    ".agent/",
    ".agents/",
    ".claude/",
    ".github/",
    "docker/",
    "docs/",
    "e2e/",
    "firebase/",
    "functions/",
    "infra/",
    "packages/",
    "pipeline/",
    "reports/",
    "scripts/",
    "seed/",
    "sites/",
    "starter-kit/",
    "templates/",
    "typings/",
    "vendor/",
)
ROOT_FILES = frozenset(
    {
        "AGENTS.md",
        "CLAUDE.md",
        "README.md",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        "tsconfig.base.json",
        "tsconfig.tools.json",
        "vitest.config.ts",
        "eslint.config.js",
        "stylelint.config.js",
        "knip.json",
        "ruff.toml",
        "mypy.ini",
        "pytest.ini",
        "sonar-project.properties",
        "firebase.json",
        ".firebaserc",
        ".mcp.json",
        ".coderabbit.yaml",
        ".coveragerc",
        ".dependency-cruiser.cjs",
        ".dockerignore",
        ".editorconfig",
        ".gitattributes",
        ".gitignore",
        ".gitleaks.toml",
        ".gitleaks-history.toml",
        ".gitleaksignore",
        ".htmlhintrc",
        ".htmlvalidate.json",
        ".markdownlint-cli2.jsonc",
        ".npmrc",
        ".nvmrc",
        ".prettierignore",
        ".prettierrc.json",
        ".taplo.toml",
        ".yamllint",
    }
)
# `.agent` documents name their siblings relative to `.agent/skills` (`quality/pipeline_skill.md`).
SKILL_RELATIVE_RE = re.compile(r"^[a-z0-9_-]+/[a-z0-9_]+_skill\.md$")

BACKTICK_RE = re.compile(r"`([^`\n]+)`")
LINK_RE = re.compile(r"\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
FENCE_RE = re.compile(r"^\s*(```|~~~)")
URL_SCHEME_RE = re.compile(r"^[a-z][a-z0-9+.-]*:")
# Placeholders and patterns, not paths: globs, <angle> / {brace} placeholders, ellipses, versions, spaces.
NOT_A_PATH_RE = re.compile(r"[*?<>{}$|\[\]=]|\.\.\.|…|X\.Y\.Z|\s")


@dataclass(frozen=True)
class Reference:
    """A path a document names: where, as written, and the locations it may resolve to."""

    doc: str
    line: int
    written: str
    candidates: tuple[Path, ...]


# --- AGENTS.md budgets ---------------------------------------------------------------------------


def agents_files(root: Path) -> list[Path]:
    return sorted(path for path in root.rglob("AGENTS.md") if not excluded_parts(path.relative_to(root).parts[:-1]))


def chain_bytes(root: Path, leaf: Path) -> int:
    """Bytes of every AGENTS.md from the root down to `leaf`'s folder."""
    parts = leaf.relative_to(root).parts[:-1]
    chain = [root.joinpath(*parts[:depth], "AGENTS.md") for depth in range(len(parts) + 1)]
    return sum(path.stat().st_size for path in chain if path.is_file())


def check_budgets(root: Path) -> list[str]:
    top = root / "AGENTS.md"
    if not top.is_file():
        return ["AGENTS.md: missing at the repository root"]
    errors: list[str] = []
    size = top.stat().st_size
    if size > ROOT_AGENTS_MAX_BYTES:
        errors.append(f"AGENTS.md: {size} bytes > {ROOT_AGENTS_MAX_BYTES} (Antigravity truncates the rest; move detail into a skill)")
    for leaf in agents_files(root):
        total = chain_bytes(root, leaf)
        if total > CHAIN_MAX_BYTES:
            rel = leaf.relative_to(root).as_posix()
            errors.append(f"{rel}: the AGENTS.md chain from the root is {total} bytes > {CHAIN_MAX_BYTES} (Codex drops the rest)")
    return errors


# --- skills and subagents ------------------------------------------------------------------------


def line_budget(path: Path, root: Path) -> list[str]:
    lines = len(path.read_text(encoding="utf-8").splitlines())
    if lines <= SKILL_MAX_LINES:
        return []
    return [f"{path.relative_to(root).as_posix()}: {lines} lines > {SKILL_MAX_LINES} (move detail into a reference file)"]


def name_errors(rel: str, name: str, folder: str) -> list[str]:
    errors = [] if name == folder else [f"{rel}: name {name!r} must equal the folder name {folder!r}"]
    if not NAME_RE.match(name) or any(word in name for word in RESERVED_NAME_WORDS):
        errors.append(f"{rel}: name {name!r} must match {NAME_RE.pattern} without 'claude' / 'anthropic'")
    return errors


def description_errors(rel: str, description: str) -> list[str]:
    if not description:
        return [f"{rel}: no description"]
    errors = (
        [f"{rel}: description is {len(description)} characters > {DESCRIPTION_MAX_CHARS}"]
        if len(description) > DESCRIPTION_MAX_CHARS
        else []
    )
    if "<" in description or ">" in description:
        errors.append(f"{rel}: description contains an angle bracket")
    return errors


def check_skill(folder: Path, root: Path) -> list[str]:
    skill = folder / "SKILL.md"
    rel = skill.relative_to(root).as_posix()
    if not skill.is_file():
        return [f"{folder.relative_to(root).as_posix()}: no SKILL.md"]
    fields = front_matter(skill.read_text(encoding="utf-8"))
    if fields is None:
        return [f"{rel}: no YAML front matter (--- name / description ---)"]
    errors = name_errors(rel, fields.get("name", ""), folder.name)
    return errors + description_errors(rel, fields.get("description", "")) + line_budget(skill, root)


def folders_of(base: Path) -> list[Path]:
    return sorted(path for path in base.iterdir() if path.is_dir()) if base.is_dir() else []


def check_skills(root: Path) -> list[str]:
    folders = [folder for tree in SKILL_TREES for folder in folders_of(root / tree)]
    return [error for folder in folders for error in check_skill(folder, root)] + skill_doc_errors(root)


def skill_doc_errors(root: Path) -> list[str]:
    return [error for doc in sorted((root / SKILL_DOCS).rglob("*.md")) for error in line_budget(doc, root)]


def check_subagent(agent: Path, root: Path) -> list[str]:
    rel = agent.relative_to(root).as_posix()
    fields = front_matter(agent.read_text(encoding="utf-8"))
    if fields is None:
        return [f"{rel}: no YAML front matter"]
    errors = [] if fields.get("name") == agent.stem else [f"{rel}: name {fields.get('name')!r} must equal the file name {agent.stem!r}"]
    return errors + [f"{rel}: front matter has no {key}" for key in ("description", "tools") if not fields.get(key)]


def check_subagents(root: Path) -> list[str]:
    return [error for agent in sorted((root / SUBAGENT_DIR).glob("*.md")) for error in check_subagent(agent, root)]


# --- path references -----------------------------------------------------------------------------


def is_checked_doc(rel: str) -> bool:
    return not rel.startswith(UNCHECKED_DOC_DIRS) and not excluded_parts(Path(rel).parts[:-1])


def globbed_docs(root: Path) -> list[Path]:
    return [path for pattern in DOC_GLOBS for path in root.glob(pattern) if path.is_file()]


def doc_files(root: Path) -> list[str]:
    found = {path.relative_to(root).as_posix() for path in globbed_docs(root)}
    return sorted(filter(is_checked_doc, found))


def prose_lines(text: str) -> Iterator[tuple[int, str]]:
    """(line number, line) outside fenced code blocks: commands there are examples, not references."""
    in_fence = False
    for number, line in enumerate(text.splitlines(), start=1):
        if FENCE_RE.match(line):
            in_fence = not in_fence
        elif not in_fence:
            yield number, line


def clean(token: str) -> str:
    """A path without a trailing `#anchor`, `:line` or punctuation."""
    token = re.sub(r"#.*$", "", token.strip())
    token = re.sub(r":\d+(-\d+)?$", "", token)
    return token.rstrip(".,;:)")


def is_path_text(token: str) -> bool:
    """Non-empty and free of glob, placeholder, version-template and whitespace characters."""
    return bool(token) and not NOT_A_PATH_RE.search(token)


def names_a_path(token: str) -> bool:
    return SKILL_RELATIVE_RE.match(token) is not None or (token.startswith(PATH_ROOTS) and "/" in token)


def is_repository_path(token: str) -> bool:
    if not is_path_text(token):
        return False
    return token in ROOT_FILES or names_a_path(token)


def backtick_paths(line: str) -> list[str]:
    return [token for token in (clean(raw) for raw in BACKTICK_RE.findall(line)) if is_repository_path(token)]


def is_relative_link(target: str) -> bool:
    return not URL_SCHEME_RE.match(target) and not target.startswith("#")


def link_paths(line: str) -> list[str]:
    targets = [clean(target) for target in LINK_RE.findall(line) if is_relative_link(target)]
    return [target for target in targets if is_path_text(target)]


def references(root: Path, rel: str) -> list[Reference]:
    """Every repository path one document names, with the places it may resolve to."""
    doc = root / rel
    found: list[Reference] = []
    for number, line in prose_lines(doc.read_text(encoding="utf-8")):
        found += [Reference(rel, number, token, (root / token, root / SKILL_DOCS / token)) for token in backtick_paths(line)]
        found += [Reference(rel, number, target, (doc.parent / target,)) for target in link_paths(line)]
    return found


def planned_section(text: str) -> Iterator[str]:
    """The prose lines of the *Planned paths* section (up to the next heading)."""
    in_section = False
    for _, line in prose_lines(text):
        if line.startswith("#"):
            in_section = PLANNED_HEADING_RE.match(line) is not None
        elif in_section:
            yield line


def is_list_line(line: str) -> bool:
    return line.lstrip().startswith(("- ", "* ", "| "))


def planned_paths(root: Path) -> set[str]:
    """Back-ticked paths in the list items and table rows of the *Planned paths* section of `PLANNED_PATHS_DOC`."""
    path = root / PLANNED_PATHS_DOC
    if not path.is_file():
        return set()
    lines = filter(is_list_line, planned_section(path.read_text(encoding="utf-8")))
    return {clean(raw).rstrip("/") for line in lines for raw in BACKTICK_RE.findall(line)}


def repository_relative(root: Path, target: Path, written: str) -> str:
    """The target relative to the root, keeping a trailing slash (git matches `dir/` patterns only then)."""
    resolved, base = target.resolve(), root.resolve()
    rel = resolved.relative_to(base).as_posix() if resolved.is_relative_to(base) else written
    return f"{rel}/" if written.endswith("/") else rel


def check_ignore(root: Path, paths: Sequence[str]) -> str:
    """`git check-ignore` output for `paths`: empty without git or a repository."""
    try:
        result = subprocess.run(
            [GIT, "-C", str(root), "check-ignore", "--no-index", "--stdin"],
            input="\n".join(paths),
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return ""
    return result.stdout if result.returncode in GIT_CHECK_IGNORE_OK else ""


def ignore_queries(paths: Sequence[str]) -> list[str]:
    """What `git check-ignore` is asked: every path, and the folder form of each one written without a trailing slash.

    A build output that was never built (`functions/dist` in a fresh clone) does not exist, so git cannot tell that it is
    a folder, and a folder pattern (`dist/`) does not match it; asked as `functions/dist/` it matches like the built one.
    """
    return sorted({*paths, *(f"{path}/" for path in paths if not path.endswith("/"))})


def answered_as_file_or_folder(path: str, answered: set[str]) -> bool:
    return path in answered or f"{path}/" in answered


def git_ignored(root: Path, paths: Sequence[str]) -> set[str]:
    """The subset of repository-relative paths git ignores, as a file or as a folder (empty without paths, git or a repository)."""
    output = check_ignore(root, ignore_queries(paths)) if paths else ""
    answered = {line.strip() for line in output.splitlines()}
    return {path for path in paths if answered_as_file_or_folder(path, answered)}


def resolves(ref: Reference) -> bool:
    return any(candidate.exists() for candidate in ref.candidates)


def unresolved(root: Path, refs: Sequence[Reference]) -> list[tuple[str, Reference]]:
    """(repository-relative target, reference) of every reference that resolves nowhere and is not planned."""
    planned = planned_paths(root)
    missing = [(repository_relative(root, ref.candidates[0], ref.written), ref) for ref in refs if not resolves(ref)]
    return [(target, ref) for target, ref in missing if target.rstrip("/") not in planned]


def all_references(root: Path) -> list[Reference]:
    return [ref for rel in doc_files(root) for ref in references(root, rel)]


def check_paths(root: Path) -> tuple[list[str], int]:
    refs = all_references(root)
    missing = unresolved(root, refs)
    ignored = git_ignored(root, sorted({target for target, _ in missing}))
    errors = [f"{ref.doc}:{ref.line}: `{ref.written}` does not exist" for target, ref in missing if target not in ignored]
    return errors, len(refs)


# --- CLI -----------------------------------------------------------------------------------------


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check agent-asset budgets, skill and subagent front matter, and documented paths.")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    root: Path = parser.parse_args(argv).root
    path_errors, checked = check_paths(root)
    errors = check_budgets(root) + check_skills(root) + check_subagents(root) + path_errors
    if errors:
        LOG.error("[agents] FAILED:\n%s", bullets(errors))
        return 1
    size = (root / "AGENTS.md").stat().st_size
    LOG.info(
        "[agents] OK: AGENTS.md %d/%d bytes, chains within %d, skills and subagents well-formed, %d path references resolve",
        size,
        ROOT_AGENTS_MAX_BYTES,
        CHAIN_MAX_BYTES,
        checked,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
