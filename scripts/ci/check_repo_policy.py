#!/usr/bin/env python3
"""Static gate: the repository rules of AGENTS.md that no linter checks.

* **No secret-bearing file** in git's view of the tree (tracked, or untracked and not ignored):
  `.env*` (except `.env.example`), `.sonar-token`, `*.secret.local`, service-account JSON, `*.p12`.
  The pre-commit hook refuses to stage them, but a hook is local and optional; this gate is what
  CI sees. Keep the list in step with `refuse_secret_files` in scripts/git-hooks/pre-commit.
* **Exact pins**: every npm dependency and override in a `package.json`, every line of a
  `requirements*.txt`, and the `[project]`, `[build-system]` and Poetry dependencies of a
  `pyproject.toml` name one exact version (AGENTS.md -> Latest stable dependencies). A range lets
  the next install pick different code than the one that passed the pipeline.
* **Pinned images**: every Dockerfile `FROM` (other than an earlier stage) and `# syntax=` line,
  and every YAML `image:`, names an `@sha256:` digest; no Dockerfile, shell script or YAML file
  uses a `:latest` tag (AGENTS.md -> Boundaries).
* **No resource of the banned Mapbox account** (`FORBIDDEN_ACCOUNT`; AGENTS.md -> Project hard
  constraints): its name may appear only where the ban itself is written down: Markdown, `docs/`
  and the review instructions in `.coderabbit.yaml`. Legacy data (`seed/`) is excluded like
  everywhere else, and this file spells the name in two pieces so it does not match itself.

The file set is git's minus the shared exclusions (`cirepo`), so dependencies, build output and
third-party code (`vendor/`) are not read. Usage: check_repo_policy.py [--root DIR].
Exit status: 0 OK, 1 problems found, 2 usage.
"""

import argparse
import json
import re
import sys
import tomllib
from collections.abc import Callable, Mapping, Sequence
from fnmatch import fnmatch
from pathlib import Path, PurePosixPath

from cilog import bullets, get_logger
from cirepo import ROOT, repository_files

LOG = get_logger("repo-policy")

SECRET_NAMES = (".env", ".env.*", ".sonar-token", ".secret.local", "*.secret.local", "*service-account*.json", "*.p12")
SECRET_EXCEPTIONS = frozenset({".env.example"})

NPM_FIELDS = ("dependencies", "devDependencies", "optionalDependencies")
# An exact semver, a vendored `file:` package, or an override that points at a direct dependency (`$name`).
EXACT_NPM = re.compile(r"^(\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?|file:\S+|\$[\w@/.-]+)$")
# `name==version`, optionally with extras and an environment marker.
EXACT_PEP508 = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*(\[[^\]]*\])?\s*==\s*[^\s=<>!~*,;]+\s*(;.*)?$")
# A bare Poetry version is an exact pin (`"9.1.1"` means `==9.1.1`).
EXACT_POETRY = re.compile(r"^\d+(\.\d+)*$")

FROM_RE = re.compile(r"^\s*FROM\s+(--platform=\S+\s+)?(?P<image>\S+)(\s+AS\s+(?P<stage>\S+))?", re.IGNORECASE)
SYNTAX_RE = re.compile(r"^#\s*syntax\s*=\s*(?P<image>\S+)")
IMAGE_KEY_RE = re.compile(r"^\s*-?\s*image:\s*['\"]?(?P<image>[^\s'\"#]+)")
LATEST_RE = re.compile(r"[\w./-]+:latest\b")
DIGEST = "@sha256:"

FORBIDDEN_ACCOUNT = "fostul" + "bucuresti"
# Where the ban is written down rather than broken.
ACCOUNT_DOCS = ("*.md", "docs/*", ".coderabbit.yaml")

Check = Callable[[str, str], list[str]]


# --- secrets ---------------------------------------------------------------------------------------


def is_secret_file(name: str) -> bool:
    base = PurePosixPath(name).name
    return base not in SECRET_EXCEPTIONS and any(fnmatch(base, pattern) for pattern in SECRET_NAMES)


def secret_problems(names: Sequence[str]) -> list[str]:
    return [
        f"{name}: holds secrets and is never committed (AGENTS.md -> Secrets): git rm --cached -- {name}"
        for name in names
        if is_secret_file(name)
    ]


# --- exact pins ------------------------------------------------------------------------------------


def override_specs(overrides: object) -> list[str]:
    """Every version string of an npm `overrides` tree (nested objects are per-parent overrides)."""
    if isinstance(overrides, Mapping):
        return [spec for value in overrides.values() for spec in override_specs(value)]
    return [str(overrides)]


def dependency_pairs(manifest: Mapping[str, object]) -> list[tuple[str, str]]:
    """(name, spec) of the `dependencies`, `devDependencies` and `optionalDependencies` fields."""
    fields = [manifest.get(field) for field in NPM_FIELDS]
    return [(str(name), str(spec)) for field in fields if isinstance(field, Mapping) for name, spec in field.items()]


def npm_specs(manifest: Mapping[str, object]) -> list[tuple[str, str]]:
    """(name, spec) of every dependency field; overrides are listed under `overrides`."""
    return dependency_pairs(manifest) + [("overrides", spec) for spec in override_specs(manifest.get("overrides", {}))]


def package_json_problems(relative: str, text: str) -> list[str]:
    manifest = json.loads(text)
    pairs = npm_specs(manifest) if isinstance(manifest, Mapping) else []
    return [f"{relative}: {name} {spec!r} is not an exact version" for name, spec in pairs if not EXACT_NPM.match(spec)]


def requirement_lines(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip() and not line.lstrip().startswith("#")]


def requirements_problems(relative: str, text: str) -> list[str]:
    return [f"{relative}: {line!r} is not pinned with ==" for line in requirement_lines(text) if not EXACT_PEP508.match(line)]


def table(data: Mapping[str, object], *keys: str) -> Mapping[str, object]:
    """The nested TOML table at `keys`, or an empty one."""
    current: object = data
    for key in keys:
        current = current.get(key, {}) if isinstance(current, Mapping) else {}
    return current if isinstance(current, Mapping) else {}


def string_list(value: object) -> list[str]:
    return [str(item) for item in value] if isinstance(value, list) else []


def poetry_version(spec: object) -> str:
    """The version of a Poetry dependency, written as `"1.2.3"` or `{version = "1.2.3", ...}`."""
    return str(spec.get("version", "")) if isinstance(spec, Mapping) else str(spec)


def poetry_tables(data: Mapping[str, object]) -> list[Mapping[str, object]]:
    """`[tool.poetry.dependencies]` and the `dependencies` table of every Poetry group."""
    groups = table(data, "tool", "poetry", "group")
    return [
        table(data, "tool", "poetry", "dependencies"),
        *(table(group, "dependencies") for group in groups.values() if isinstance(group, Mapping)),
    ]


def poetry_specs(data: Mapping[str, object]) -> list[tuple[str, str]]:
    """(name, version) of every Poetry dependency; `python` is the interpreter range, not a package."""
    return [(str(name), poetry_version(spec)) for deps in poetry_tables(data) for name, spec in deps.items() if name != "python"]


def pep508_problems(relative: str, data: Mapping[str, object]) -> list[str]:
    """`[project] dependencies` and `[build-system] requires` entries that are not `name==version`."""
    specs = [*string_list(table(data, "project").get("dependencies")), *string_list(table(data, "build-system").get("requires"))]
    return [f"{relative}: {spec!r} is not pinned with ==" for spec in specs if not EXACT_PEP508.match(spec)]


def poetry_problems(relative: str, data: Mapping[str, object]) -> list[str]:
    loose = [(name, spec) for name, spec in poetry_specs(data) if not EXACT_POETRY.match(spec)]
    return [f"{relative}: Poetry dependency {name} {spec!r} is not an exact version" for name, spec in loose]


def pyproject_problems(relative: str, text: str) -> list[str]:
    data = tomllib.loads(text)
    return pep508_problems(relative, data) + poetry_problems(relative, data)


# --- images ----------------------------------------------------------------------------------------


def is_pinned_base(image: str, stages: set[str]) -> bool:
    """A digest, an earlier stage of the same Dockerfile, or the empty `scratch` image."""
    return DIGEST in image or image.lower() in stages or image == "scratch"


def from_problem(line: str, stages: set[str]) -> str | None:
    """Why a Dockerfile line pulls an unpinned image (None when it pins one or is not a FROM); records stage names."""
    match = FROM_RE.match(line)
    if match is None:
        return None
    image = match.group("image")
    problem = None if is_pinned_base(image, stages) else f"FROM {image} has no @sha256: digest"
    stages.add((match.group("stage") or "").lower())
    return problem


def syntax_problem(line: str) -> str | None:
    match = SYNTAX_RE.match(line)
    return None if match is None or DIGEST in match.group("image") else f"# syntax={match.group('image')} has no @sha256: digest"


def dockerfile_problems(relative: str, text: str) -> list[str]:
    stages: set[str] = set()
    found = [(number, syntax_problem(line) or from_problem(line, stages)) for number, line in enumerate(text.splitlines(), start=1)]
    return [f"{relative}:{number}: {problem}" for number, problem in found if problem]


def yaml_image_problems(relative: str, text: str) -> list[str]:
    images = [(number, IMAGE_KEY_RE.match(line)) for number, line in enumerate(text.splitlines(), start=1)]
    return [
        f"{relative}:{number}: image {match.group('image')} has no @sha256: digest"
        for number, match in images
        if match and DIGEST not in match.group("image")
    ]


def latest_problems(relative: str, text: str) -> list[str]:
    tags = [(number, LATEST_RE.search(line)) for number, line in enumerate(text.splitlines(), start=1)]
    return [f"{relative}:{number}: {match.group(0)} is a moving tag: pin a version and its digest" for number, match in tags if match]


# --- forbidden account -----------------------------------------------------------------------------


def account_problems(relative: str, text: str) -> list[str]:
    if FORBIDDEN_ACCOUNT not in text.lower():
        return []
    return [f"{relative}: references the {FORBIDDEN_ACCOUNT} account, whose resources are never used (AGENTS.md)"]


# --- file routing ----------------------------------------------------------------------------------


def is_shell(relative: str) -> bool:
    return relative.endswith(".sh") or PurePosixPath(relative).parent.name == "git-hooks"


def is_named(relative: str, *patterns: str) -> bool:
    return any(fnmatch(PurePosixPath(relative).name, pattern) for pattern in patterns)


# File predicate -> the content checks for such a file (a file can match several rows).
ROUTES: tuple[tuple[Callable[[str], bool], tuple[Check, ...]], ...] = (
    (lambda relative: is_named(relative, "package.json"), (package_json_problems,)),
    (lambda relative: is_named(relative, "requirements*.txt"), (requirements_problems,)),
    (lambda relative: is_named(relative, "pyproject.toml"), (pyproject_problems,)),
    (lambda relative: is_named(relative, "Dockerfile", "Dockerfile.*"), (dockerfile_problems, latest_problems)),
    (lambda relative: is_named(relative, "*.yml", "*.yaml"), (yaml_image_problems, latest_problems)),
    (is_shell, (latest_problems,)),
)


def documents_the_ban(relative: str) -> bool:
    return any(fnmatch(relative, pattern) for pattern in ACCOUNT_DOCS)


def content_checks(relative: str) -> list[Check]:
    """The content checks that apply to one file, chosen by its path."""
    checks = [check for matches, found in ROUTES if matches(relative) for check in found]
    return checks if documents_the_ban(relative) else [*checks, account_problems]


def file_problems(root: Path, relative: str) -> list[str]:
    try:
        text = (root / relative).read_text(encoding="utf-8")
    except UnicodeDecodeError, OSError:
        return []
    try:
        return [problem for check in content_checks(relative) for problem in check(relative, text)]
    except ValueError as error:
        return [f"{relative}: cannot be read as data ({error}); the data-files gate shows the details"]


def check_tree(root: Path) -> list[str]:
    names = repository_files(root, include_excluded=True)
    scanned = repository_files(root)
    return secret_problems(names) + [problem for relative in scanned for problem in file_problems(root, relative)]


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check the repository rules no linter covers: secrets, pins, images, banned account.")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    problems = check_tree(parser.parse_args(argv).root)
    if problems:
        LOG.error("[repo-policy] FAILED:\n%s", bullets(problems))
        return 1
    LOG.info("[repo-policy] OK: no secret file, every dependency and image pinned exactly, no banned account")
    return 0


if __name__ == "__main__":
    sys.exit(main())
