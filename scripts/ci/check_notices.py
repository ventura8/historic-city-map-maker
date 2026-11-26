#!/usr/bin/env python3
"""Build-stage gate: each build's THIRD_PARTY_NOTICES.txt lists exactly what the build ships, under a permissive licence.

The engine, the admin and the create-historic-city CLI builds write THIRD_PARTY_NOTICES.txt beside their entry
(scripts/site/src/notices.ts, a Vite plugin; the user's decision of 2026-10-23, docs/research/DECISIONS-for-review.md
§52d). This gate checks the file against evidence the generator does not write, the build's source maps
(`sourcemap: true` in every Vite config) and the installed packages:

- every npm package a source map names (a source under `node_modules/`; the package is the folder under the last one,
  named by its own package.json) has an entry with its exact version, the licence id its package.json declares and a
  licence text;
- every entry is either such a package or names the files it was copied for (`File:` lines, the self-hosted fonts), and
  those files exist with the package installed at that version and licence; every font file the build ships is named;
- every licence is on `ALLOWED_LICENCES`, the permissive licences reviewed for the engine (which cities embed) and the
  admin (served from Firebase Hosting); anything else fails until it is reviewed and added here.

Mapbox GL JS is external to both builds (pages load it from api.mapbox.com), so it is in no source map and needs no
entry. The site build copies the engine's folder, notices included, next to each city page.

Usage: check_notices.py [--root DIR]. Exit status: 0 complete, 1 a problem (or a build missing), 2 usage.
"""

import argparse
import json
import os
import sys
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from cilog import get_logger
from cirepo import ROOT

LOG = get_logger("notices")

# The builds whose output ships, repository-relative (packages/*/vite.config.ts); each holds its notices file. The
# create-historic-city CLI bundles @hcm/shared, zod and the colour library into dist/cli.mjs (M5-interfaces §4.1).
BUILDS = ("packages/engine/dist", "packages/admin/dist", "packages/create-historic-city/dist")
NOTICES = "THIRD_PARTY_NOTICES.txt"
# Files a build copies from npm packages rather than bundling them (the kit's fonts, packages/ui/fonts): each must be
# named by an entry's `File:` line.
COPIED = ("fonts/*.woff2",)
# Permissive licences (SPDX ids), the M4 contract's list (docs/research/M4-interfaces.md §6.4): OFL-1.1 for the fonts.
ALLOWED_LICENCES = frozenset({"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "OFL-1.1", "0BSD", "CC0-1.0"})

RULE = "=" * 80
DIVIDER = "-" * 80
NODE_MODULES = "/node_modules/"
FIELDS = ("Package", "Version", "Licence")


@dataclass(frozen=True)
class Installed:
    """A package as its own package.json describes it."""

    name: str
    version: str
    licence: str

    @property
    def key(self) -> str:
        return f"{self.name}@{self.version}"


@dataclass(frozen=True)
class Entry:
    """One package of the notices file."""

    name: str
    version: str
    licence: str
    files: tuple[str, ...]
    text: str

    @property
    def key(self) -> str:
        return f"{self.name}@{self.version}"


def package_root(source: str) -> str | None:
    """`/r/node_modules/a/node_modules/@s/b/x.js` -> `/r/node_modules/a/node_modules/@s/b`; None outside node_modules."""
    path = source.replace("\\", "/")
    at = path.rfind(NODE_MODULES)
    if at < 0:
        return None
    start = at + len(NODE_MODULES)
    segments = path[start:].split("/")
    length = 2 if segments[0].startswith("@") else 1
    return path[:start] + "/".join(segments[:length])


def read_json(path: Path) -> object:
    """The JSON document at `path`, or None when it cannot be read or parsed."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except OSError, ValueError:
        return None


def text_fields(data: object, keys: Sequence[str]) -> list[str]:
    """The non-empty string values of `keys` in a JSON object ([] for anything else)."""
    if not isinstance(data, dict):
        return []
    return [value for key in keys if isinstance(value := data.get(key), str) and value]


def read_installed(root: Path) -> Installed | None:
    """The package at `root`, or None when its package.json is missing or names no package, version or licence id."""
    values = text_fields(read_json(root / "package.json"), ("name", "version", "license"))
    return Installed(*values) if len(values) == len(FIELDS) else None


def as_list(value: object) -> list[object]:
    return value if isinstance(value, list) else []


def map_sources(path: Path) -> list[str]:
    """The absolute sources of one source map (its `sourceRoot` applied), [] when it is not a source map."""
    data = read_json(path)
    if not isinstance(data, dict):
        return []
    base = path.parent / str(data.get("sourceRoot") or "")
    return [os.path.normpath(base / source) for source in as_list(data.get("sources")) if isinstance(source, str)]


def bundled_roots(maps: Iterable[Path]) -> list[str]:
    """The package folders the source maps' sources are in, sorted."""
    return sorted({root for path in maps for source in map_sources(path) if (root := package_root(source)) is not None})


def bundled(folder: Path) -> tuple[dict[str, Installed], list[str]]:
    """(the packages the build's source maps name, by name@version; problems)."""
    maps = sorted(folder.rglob("*.map"))
    if not maps:
        return {}, ["no source map (both Vite configs set `sourcemap: true`: the gate reads the module graph from them)"]
    packages: dict[str, Installed] = {}
    problems: list[str] = []
    for root in bundled_roots(maps):
        installed = read_installed(Path(root))
        if installed is None:
            problems.append(f"{root}: bundled, but its package.json names no package, version or licence id")
        else:
            packages[installed.key] = installed
    return packages, problems


def header_fields(header: Sequence[str]) -> dict[str, list[str]]:
    """`Name: value` lines -> {Name: [values]} (a name may repeat, as `File:` and `Notice:` do)."""
    fields: dict[str, list[str]] = {}
    for line in header:
        name, _, value = line.partition(": ")
        fields.setdefault(name, []).append(value.strip())
    return fields


def parse_entry(block: str) -> Entry | str:
    """One entry (the text after a rule), or the problem with it."""
    header, divider, text = block.partition("\n" + DIVIDER + "\n")
    fields = header_fields(header.strip("\n").splitlines())
    if not divider or any(len(fields.get(name, [])) != 1 for name in FIELDS):
        return f"an entry without one each of {', '.join(FIELDS)} and a `-` rule: {header.strip()[:80]!r}"
    name, version, licence = (fields[field][0] for field in FIELDS)
    return Entry(name, version, licence, tuple(fields.get("File", [])), text.strip())


def parse_notices(text: str) -> tuple[dict[str, Entry], list[str]]:
    """(the entries by name@version; problems): the blocks between rules of `=` after the introduction."""
    entries: dict[str, Entry] = {}
    problems: list[str] = []
    for block in text.split("\n" + RULE + "\n")[1:]:
        entry = parse_entry(block)
        if isinstance(entry, str):
            problems.append(entry)
        elif entry.key in entries:
            problems.append(f"{entry.key}: two entries")
        else:
            entries[entry.key] = entry
    return entries, problems


def licence_problems(label: str, entry: Entry, installed: Installed) -> list[str]:
    """The entry against its installed package: the same licence id, an allowed licence, a licence text."""
    problems = []
    if entry.licence != installed.licence:
        problems.append(f"{label}: the entry says {entry.licence}, the package declares {installed.licence}")
    if installed.licence not in ALLOWED_LICENCES:
        problems.append(f"{label}: {installed.licence} is not an allowed licence (review it, then add it to ALLOWED_LICENCES)")
    if not entry.text:
        problems.append(f"{label}: the entry has no licence text")
    return problems


def check_bundled(packages: Mapping[str, Installed], entries: Mapping[str, Entry]) -> list[str]:
    """Every bundled package has its entry, and the entry agrees with it."""
    problems: list[str] = []
    for key, installed in sorted(packages.items()):
        entry = entries.get(key)
        if entry is None:
            problems.append(f"{key}: bundled ({installed.licence}) but not in {NOTICES}")
        else:
            problems += licence_problems(key, entry, installed)
    return problems


def check_copied(folder: Path, root: Path, entry: Entry) -> list[str]:
    """An entry for copied files: the files are in the build, its package is installed as the entry says."""
    problems = [f"{entry.key}: names {file}, which the build does not ship" for file in entry.files if not (folder / file).is_file()]
    installed = read_installed(root / "node_modules" / entry.name)
    if installed is None or installed.version != entry.version:
        return [*problems, f"{entry.key}: names copied files, but {entry.key} is not the installed package"]
    return problems + licence_problems(entry.key, entry, installed)


def check_entries(folder: Path, root: Path, packages: Mapping[str, Installed], entries: Mapping[str, Entry]) -> list[str]:
    """No entry without a bundled module or a copied file."""
    problems: list[str] = []
    for key, entry in sorted(entries.items()):
        if entry.files:
            problems += check_copied(folder, root, entry)
        elif key not in packages:
            problems.append(f"{key}: in {NOTICES} but no module of it is bundled")
    return problems


def named_files(entries: Mapping[str, Entry]) -> set[str]:
    return {file for entry in entries.values() for file in entry.files}


def shipped_files(folder: Path) -> list[str]:
    """The files of `COPIED` the build ships, relative to its folder."""
    return sorted(path.relative_to(folder).as_posix() for pattern in COPIED for path in folder.glob(pattern))


def check_shipped(folder: Path, entries: Mapping[str, Entry]) -> list[str]:
    """Every copied file the build ships is named by an entry."""
    named = named_files(entries)
    return [f"{file}: shipped without an entry naming it" for file in shipped_files(folder) if file not in named]


def check_build(root: Path, build: str) -> tuple[list[str], str]:
    """(problems, the report line) of one build folder."""
    folder = root / build
    notices = folder / NOTICES
    if not notices.is_file():
        return [f"{build}/{NOTICES}: missing (run the build stage first)"], ""
    packages, problems = bundled(folder)
    entries, parse_problems = parse_notices(notices.read_text(encoding="utf-8"))
    problems += parse_problems + check_bundled(packages, entries) + check_entries(folder, root, packages, entries)
    problems += check_shipped(folder, entries)
    copied = sum(1 for entry in entries.values() if entry.files)
    line = f"{build}/{NOTICES}: {len(packages)} bundled package(s) and {copied} for copied files, each with its licence"
    return [f"{build}: {problem}" for problem in problems], line


def check(root: Path, builds: Iterable[str] = BUILDS) -> tuple[list[str], list[str]]:
    """(problems, report lines) of every build."""
    problems: list[str] = []
    lines: list[str] = []
    for build in builds:
        build_problems, line = check_build(root, build)
        problems += build_problems
        lines += [line] if line else []
    return problems, lines


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check each build's third-party notices against its source maps.")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    args = parser.parse_args(argv)
    problems, lines = check(args.root)
    if problems:
        LOG.error("[notices] FAILED:\n%s", "\n".join(f"  - {problem}" for problem in problems))
        return 1
    LOG.info("[notices] OK:\n%s", "\n".join(f"  {line}" for line in lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
