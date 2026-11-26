#!/usr/bin/env python3
"""Static gate: every JSON, GeoJSON, TOML and XML/SVG file of the repository parses.

No other gate reads these files as data before a build, a deploy or the browser does:

* `*.json`, `*.geojson`, `*.webmanifest` and the suffix-less `.firebaserc` (JSON by content):
  package manifests, `firebase.json`, `.mcp.json`, `e2e/scenarios.json`, fixtures and manifests.
  A JSON object with a duplicate key is also an error: the parser keeps the last value silently,
  so a translation or a fixture field would vanish without a trace.
* `*.toml`: `ruff.toml`, `.taplo.toml`, `.gitleaks.toml`, later `pipeline/pyproject.toml`.
* `*.xml` and `*.svg`: well-formedness only (the coverage badges, icons), parsed with defusedxml.

JSONC files (`*.jsonc`, `tsconfig*.json`, which TypeScript reads with comments) are left to
their tool. The file set is git's minus the shared exclusions (`cirepo`): tracked plus
untracked-but-not-ignored, so build output, caches and local secrets are never read. The schema
checks (`firebase.json` against firebase-tools' schema, workflows against the GitHub schema) are
separate `check-jsonschema` gates in scripts/ci/pipeline.py.

Ported from the sibling Watch-GPS-Dashboard script. Usage: check_data_files.py [--root DIR] [FILE ...]
"""

import argparse
import json
import sys
import tomllib
from collections.abc import Callable, Sequence
from fnmatch import fnmatch
from pathlib import Path

from cilog import get_logger
from cirepo import ROOT, repository_files
from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException

LOG = get_logger("data")


class DuplicateKeyError(ValueError):
    """A JSON object names the same key twice."""


def reject_duplicates(pairs: list[tuple[str, object]]) -> dict[str, object]:
    seen: dict[str, object] = {}
    for key, value in pairs:
        if key in seen:
            raise DuplicateKeyError(f"duplicate key {key!r}")
        seen[key] = value
    return seen


def check_json(text: str) -> str | None:
    try:
        json.loads(text, object_pairs_hook=reject_duplicates)
    except ValueError as error:
        return str(error)
    return None


def check_toml(text: str) -> str | None:
    try:
        tomllib.loads(text)
    except tomllib.TOMLDecodeError as error:
        return str(error)
    return None


def check_xml(text: str) -> str | None:
    try:
        ElementTree.fromstring(text.encode("utf-8"))
    except (ElementTree.ParseError, DefusedXmlException) as error:
        return str(error)
    return None


Checker = Callable[[str], str | None]
CHECKERS: dict[str, Checker] = {"json": check_json, "toml": check_toml, "xml": check_xml}
KIND_BY_SUFFIX = {".json": "json", ".geojson": "json", ".webmanifest": "json", ".toml": "toml", ".xml": "xml", ".svg": "xml"}
# Data files without a telling suffix, by name.
KIND_BY_NAME = {".firebaserc": "json"}
# JSON with comments: read by their own tool, which fails on a broken file itself.
JSONC_NAMES = ("tsconfig*.json", "*.jsonc")


def kind_of(path: Path) -> str | None:
    """`json`, `toml` or `xml` for a data file, None for anything else (JSONC included)."""
    if any(fnmatch(path.name, pattern) for pattern in JSONC_NAMES):
        return None
    return KIND_BY_NAME.get(path.name) or KIND_BY_SUFFIX.get(path.suffix)


def check_file(path: Path, kind: str) -> str | None:
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as error:
        return f"not UTF-8: {error}"
    return CHECKERS[kind](text)


def check(root: Path, names: Sequence[str]) -> tuple[list[str], dict[str, int]]:
    """(problems, files checked per kind) for the data files among `names`."""
    errors: list[str] = []
    counts = dict.fromkeys(CHECKERS, 0)
    for name in names:
        kind = kind_of(Path(name))
        if kind is None or not (root / name).is_file():
            continue
        counts[kind] += 1
        problem = check_file(root / name, kind)
        if problem:
            errors.append(f"{name}: {problem}")
    return errors, counts


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check that every JSON, GeoJSON, TOML and XML/SVG file parses (no duplicate JSON keys).")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    parser.add_argument("files", nargs="*", help="files relative to the root (default: every repository file)")
    args = parser.parse_args(argv)
    root: Path = args.root
    errors, counts = check(root, args.files or repository_files(root))
    if errors:
        LOG.error("[data] FAILED:\n%s", "\n".join(f"  - {error}" for error in errors))
        return 1
    LOG.info("[data] OK: %s files parse (no duplicate JSON keys)", ", ".join(f"{count} {kind.upper()}" for kind, count in counts.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
