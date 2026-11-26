#!/usr/bin/env python3
"""Static gate: the zero-inline-suppression rule.

Every tool used here can be silenced from inside a file, and every one of those escape hatches
is banned. A finding is fixed in the code, or the rule is relaxed in that tool's single
repository-wide configuration (eslint.config.js, stylelint.config.js, ruff.toml, mypy.ini,
.yamllint, .markdownlint-cli2.jsonc, .htmlvalidate.json, vitest.config.ts, ...) with a comment
saying why, where the decision is reviewable.

Ported from the sibling Watch-GPS-Dashboard script and extended with the TypeScript, Vitest,
Playwright, CSS, HTML and Dockerfile directives (docs/research/design-review-testability.md §2).
Markdown is documentation that *mentions* the directives, so it is checked only for live
markdownlint/prettier HTML comments, never inside code spans or fenced blocks. The excluded
directories are the list every gate shares (`cirepo.EXCLUDED_DIRS`).

Usage: check_no_inline_suppressions.py [--root DIR] [FILE ...]
"""

import re
import sys
from collections.abc import Iterable, Iterator, Sequence
from pathlib import Path

from cilog import get_logger
from cirepo import ROOT, is_excluded, walk

LOG = get_logger("suppressions")

Rule = tuple[re.Pattern[str], str]


def _rules(*pairs: tuple[str, str]) -> tuple[Rule, ...]:
    return tuple((re.compile(pattern), label) for pattern, label in pairs)


# Matched in every scanned source file (not in Markdown, which documents them): these markers
# silence repository-wide tools.
EVERYWHERE = _rules(
    (r"\bNOSONAR\b", "NOSONAR marker"),
    (r"gitleaks:allow", "gitleaks:allow marker"),
)

TS_JS = _rules(
    (r"eslint-(disable|enable)", "eslint-disable/enable directive"),
    (r"/\*\s*(eslint|global|globals|exported)\s", "inline ESLint configuration comment"),
    (r"@ts-(ignore|expect-error|nocheck)", "TypeScript suppression"),
    (r"\b(istanbul|c8|v8)\s+ignore\b", "coverage ignore hint"),
    (r"prettier-ignore", "prettier-ignore"),
    (r"stylelint-(disable|enable)", "stylelint directive"),
    # Also behind chained modifiers: `it.concurrent.only`, `test.describe.serial.skip`, `test.step.skip`, Playwright's `test.fail(`.
    (r"\b(it|test|describe|suite|bench)(\.\w+)*?\.(only|skip|todo|fails|fail|skipIf|runIf|fixme)\b", "focused/skipped/conditional test"),
    (r"(?<![.\w$])(xit|xtest|xdescribe|fit|fdescribe)\s*\(", "focused/skipped test alias"),
    (r"\b(testInfo|test\.info\(\))\.(skip|fixme|fail)\(", "runtime skip/fixme/fail"),
    (r"knip-ignore|dependency-cruiser-ignore|jscpd:ignore|lit-analyzer-disable", "tool ignore marker"),
)

CSS = _rules(
    (r"stylelint-(disable|enable)", "stylelint directive"),
    (r"prettier-ignore", "prettier-ignore"),
)

HTML = _rules(
    (r"html-validate-(disable|enable)", "html-validate directive"),
    (r"<!--\s*htmlhint\b", "htmlhint inline configuration"),
    (r"prettier-ignore", "prettier-ignore"),
)

PYTHON = _rules(
    (r"#\s*noqa\b", "noqa comment"),
    (r"#\s*type:\s*ignore\b", "type-ignore comment"),
    (r"#\s*(pylint|ruff|mypy|xenon|pyright)\s*:", "inline linter directive"),
    (r"#\s*(fmt|isort)\s*:\s*(off|skip|skip_file)\b", "formatter/import-sort directive"),
    (r"#\s*nosec\b", "nosec comment"),
    (r"#\s*pragma[:\s]\s*no\s*(cover|branch)\b", "coverage pragma"),
    (r"pytest\.mark\.(skip|skipif|xfail)\b", "skip/xfail marker"),
    (r"pytest\.(skip|xfail|importorskip)\(", "runtime skip/xfail"),
    (r"\bunittest\.(skip|skipIf|skipUnless|expectedFailure)\b|\.skipTest\(", "unittest skip/expected failure"),
)

SHELLCHECK = (r"#\s*shellcheck\s+(disable|source)=", "shellcheck directive")

SHELL = _rules(SHELLCHECK)

DOCKERFILE = _rules(
    (r"#\s*hadolint\s+(global\s+)?ignore", "hadolint ignore pragma"),
    (r"^\s*#\s*check\s*=.*\bskip\s*=", "BuildKit check skip directive"),
)

YAML = _rules(
    (r"#\s*yamllint\s+(disable|enable)", "yamllint directive"),
    (r"#\s*zizmor:\s*ignore", "zizmor ignore"),
    (r"#\s*prettier-ignore", "prettier-ignore"),
    # actionlint runs shellcheck over every `run:` script, so a directive there silences it too.
    SHELLCHECK,
)

MARKDOWN = _rules(
    (r"<!--\s*markdownlint-(disable|enable|capture|restore|configure-file)", "markdownlint directive"),
    (r"<!--\s*prettier-ignore", "prettier-ignore"),
)

RULES_BY_SUFFIX: dict[str, tuple[Rule, ...]] = {
    **dict.fromkeys((".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"), TS_JS),
    ".css": CSS,
    ".html": HTML,
    # Type stubs too (pipeline/typings): mypy reads them, so an ignore comment there silences it.
    **dict.fromkeys((".py", ".pyi"), PYTHON),
    ".sh": SHELL,
    "Dockerfile": DOCKERFILE,
    **dict.fromkeys((".yml", ".yaml"), YAML),
    ".rules": (),
}

# This file spells out every directive as a pattern, so it must not scan itself.
SELF_RELATIVE = Path("scripts", "ci", Path(__file__).name)

FENCE = re.compile(r"^\s*(```|~~~)")
INLINE_CODE = re.compile(r"(`+)(?:(?!\1).)+?\1")


def _rule_key(path: Path) -> str:
    """The `RULES_BY_SUFFIX` key of a file: its suffix, or `Dockerfile` / `.sh` for the files named by convention."""
    if path.name.startswith("Dockerfile"):
        return "Dockerfile"
    is_hook = path.parent.name == "git-hooks" and path.suffix == ""
    return ".sh" if is_hook else path.suffix


def rules_for(path: Path) -> tuple[Rule, ...]:
    """Directive patterns for one file, chosen by suffix (Dockerfiles and git hooks by name)."""
    key = _rule_key(path)
    if key == ".md":
        return MARKDOWN
    specific = RULES_BY_SUFFIX.get(key)
    return () if specific is None else specific + EVERYWHERE


def markdown_lines(text: str) -> Iterator[tuple[int, str]]:
    """(line number, prose) of Markdown: fenced blocks dropped, inline code spans blanked."""
    in_fence = False
    for number, line in enumerate(text.splitlines(), start=1):
        if FENCE.match(line):
            in_fence = not in_fence
        elif not in_fence:
            yield number, INLINE_CODE.sub("", line)


def scan_text(relative: Path, text: str, rules: Sequence[Rule]) -> list[str]:
    lines: Iterable[tuple[int, str]] = markdown_lines(text) if relative.suffix == ".md" else enumerate(text.splitlines(), start=1)
    return [
        f"  {relative}:{number}: forbidden {label} -> {line.strip()}"
        for number, line in lines
        for pattern, label in rules
        if pattern.search(line)
    ]


def scan_file(root: Path, relative: Path) -> list[str]:
    rules = rules_for(relative)
    if not rules or relative == SELF_RELATIVE:
        return []
    try:
        text = (root / relative).read_text(encoding="utf-8")
    except UnicodeDecodeError, OSError:
        return []
    return scan_text(relative, text, rules)


def is_scannable(root: Path, relative: Path) -> bool:
    return not is_excluded(relative) and (root / relative).is_file()


def candidates(root: Path, names: Sequence[str]) -> list[Path]:
    """The files to scan: `names` (relative to root) when given, else the whole tree; excluded and missing ones dropped."""
    paths = [Path(name) for name in names] if names else list(walk(root))
    return [relative for relative in paths if is_scannable(root, relative)]


def scan(root: Path, names: Sequence[str] = ()) -> list[str]:
    """Violations in the whole tree, or only in `names` (the pre-commit hook passes the staged files)."""
    return [violation for relative in candidates(root, names) for violation in scan_file(root, relative)]


def parse_args(argv: Sequence[str]) -> tuple[Path, list[str]] | None:
    """(root, file names) from `[--root DIR] [FILE ...]`; None when --root has no value."""
    if argv[:1] != ["--root"]:
        return ROOT, list(argv)
    rest = list(argv[1:])
    return (Path(rest[0]), rest[1:]) if rest else None


def main(argv: Sequence[str] | None = None) -> int:
    parsed = parse_args(sys.argv[1:] if argv is None else argv)
    if parsed is None:
        LOG.error("[ERROR] --root needs a directory")
        return 2
    root, names = parsed
    violations = scan(root, names)
    if violations:
        LOG.error("[ERROR] Inline suppressions are banned in this repository:\n%s", "\n".join(violations))
        LOG.error("Fix the finding, or relax the rule in the tool's repository-wide configuration with a why-comment.")
        return 1
    LOG.info("[CI] no inline suppressions found")
    return 0


if __name__ == "__main__":
    sys.exit(main())
