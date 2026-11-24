#!/usr/bin/env python3
"""Build-stage gate: the shipped bundles stay within their gzip budgets.

Every city page downloads the engine before it can show a map (the city pages load the ES module
build, a third-party embed may load the IIFE from jsDelivr), so their compressed size is a product
property, measured the way a CDN serves it (gzip, level 9). Mapbox GL is not part of it (it is
loaded from api.mapbox.com as the global `mapboxgl`, never bundled), which is exactly what a
sudden jump here would reveal.

The engine's ES module build has lazy chunks too (swipe compare, the consented Firebase SDK), and its IIFE build loads the
same code as extras beside it (`extra-<name>-<hash>.js`, DECISIONS-for-review.md §186): each has its own budget in
`ENGINE_CHUNK_BUDGETS`, and a chunk without one fails.

The admin is an ES module entry with lazy chunks (DECISIONS-for-review.md §34b): each editor area,
Terra Draw, the colour library and the analytics SDK are fetched when first needed. Its budget has
three parts:

- the entry: `admin.mjs` and every chunk it imports statically, which the browser loads before the
  admin shows anything (`ADMIN_ENTRY_KB`);
- every other chunk, by its name without the content hash, against its own budget
  (`ADMIN_CHUNK_BUDGETS`); a chunk without a budget fails, so a new chunk is a reviewed decision;
- everything together (`ADMIN_TOTAL_KB`), so many small chunks cannot grow unnoticed.

The in-app installer's bundle (M6, docs/research/M6-interfaces.md §1.3) is checked apart, with `--install`, once
`build:install` has written it into the Hosting tree (`dist/hosting/admin/install/<slug>/`): its four tarballs are gzip
already, so each is measured as it is served, against `INSTALL_BUDGETS` (KB).

`BUDGETS` holds the budget of each single-file bundle; `--budget FILE=KB` overrides or adds one for
a run. Raising a budget is a reviewed change to these tables, with the reason in the commit, never
a way to get a build green. A missing bundle is an error: the gate runs after `vite-build`.

Usage: check_bundle_budget.py [--root DIR] [--budget FILE=KB ...] [--install]. Exit status: 0 OK, 1 over
budget or missing, 2 usage.
"""

import argparse
import gzip
import re
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from bundle_budgets import (
    ADMIN_CHUNK_BUDGETS,
    ADMIN_DIR,
    ADMIN_ENTRY,
    ADMIN_ENTRY_KB,
    ADMIN_TOTAL_KB,
    BUDGETS,
    ENGINE_CHUNK_BUDGETS,
    ENGINE_DIR,
    ENGINE_ENTRIES,
    INSTALL_BUDGETS,
    INSTALL_DIR,
)
from cilog import get_logger
from cirepo import ROOT

__all__ = [
    "ADMIN_BUDGETS",
    "ADMIN_CHUNK_BUDGETS",
    "ADMIN_DIR",
    "ADMIN_ENTRY",
    "ADMIN_ENTRY_KB",
    "ADMIN_TOTAL_KB",
    "BUDGETS",
    "CHUNK_NAME",
    "ENGINE_CHUNK_BUDGETS",
    "ENGINE_DIR",
    "ENGINE_ENTRIES",
    "GZIP_LEVEL",
    "INSTALL_BUDGETS",
    "INSTALL_DIR",
    "KB",
    "LOG",
    "STATIC_IMPORT",
    "AdminBudgets",
    "ChunkTable",
    "admin_sizes",
    "budget_arg",
    "check",
    "check_admin",
    "check_engine_chunks",
    "check_install",
    "chunk_name",
    "chunk_report",
    "entry_files",
    "entry_report",
    "gzip_size",
    "install_report",
    "main",
    "report",
    "report_line",
    "within",
]

LOG = get_logger("bundle-budget")

KB = 1000
GZIP_LEVEL = 9

# A chunk's file name: its name, a dash and the content hash (Rolldown's `[name]-[hash].js`).
CHUNK_NAME = re.compile(r"^(?P<name>.+)-[\w-]{8}\.js$")
# A static import or re-export of a sibling chunk (`import{…}from"./x.js"`, `import"./x.js"`); `import("…")` is lazy.
STATIC_IMPORT = re.compile(r"""(?:\bfrom|\bimport)\s*["']\./(?P<file>[\w.-]+\.m?js)["']""")


def gzip_size(data: bytes) -> int:
    """Bytes after gzip at the CDN's level; `mtime=0` keeps the figure reproducible."""
    return len(gzip.compress(data, compresslevel=GZIP_LEVEL, mtime=0))


def budget_arg(text: str) -> tuple[str, int]:
    """An argparse type: `FILE=KB` with a positive whole number of KB."""
    name, separator, value = text.rpartition("=")
    if not separator or not name or not value.isdigit() or int(value) == 0:
        raise argparse.ArgumentTypeError(f"expected FILE=KB with a positive whole number of KB, got {text!r}")
    return name, int(value)


def report_line(name: str, size: int, budget: int) -> str:
    return f"{name}: {size / KB:.1f} KB gzip (budget {budget} KB)"


def check(root: Path, budgets: Mapping[str, int]) -> tuple[list[str], list[str]]:
    """(problems, one report line per bundle)."""
    problems: list[str] = []
    lines: list[str] = []
    for name, budget in sorted(budgets.items()):
        path = root / name
        if not path.is_file():
            problems.append(f"{name}: missing (run the build stage first)")
            continue
        size = gzip_size(path.read_bytes())
        line = report_line(name, size, budget)
        lines.append(line)
        if size > budget * KB:
            problems.append(line)
    return problems, lines


def chunk_name(file: str) -> str:
    """`photos-Ab3_x9Yz.js` -> `photos`; a file without a hash keeps its own name."""
    match = CHUNK_NAME.match(file)
    return match.group("name") if match else file


def entry_files(folder: Path, entry: str) -> list[str]:
    """The entry and every chunk it imports statically, transitively, in the order found."""
    found = [entry]
    for file in found:
        path = folder / file
        text = path.read_text(encoding="utf-8", errors="replace") if path.is_file() else ""
        found.extend(match["file"] for match in STATIC_IMPORT.finditer(text) if match["file"] not in found)
    return found


@dataclass(frozen=True)
class AdminBudgets:
    entry_kb: int
    chunks: Mapping[str, int]
    total_kb: int


ADMIN_BUDGETS = AdminBudgets(ADMIN_ENTRY_KB, ADMIN_CHUNK_BUDGETS, ADMIN_TOTAL_KB)


def within(line: str, size: int, budget: int) -> list[str]:
    """[line] when `size` is over `budget` KB, else []."""
    return [line] if size > budget * KB else []


@dataclass(frozen=True)
class ChunkTable:
    """Where a build's lazy chunks are and the table that budgets them (its name for the message)."""

    folder: str
    name: str
    budgets: Mapping[str, int]


def chunk_report(file: str, size: int, table: ChunkTable) -> tuple[list[str], str]:
    """(problems, the report line) of one lazy chunk."""
    name = chunk_name(file)
    budget = table.budgets.get(name)
    if budget is None:
        line = f"{table.folder}/{file}: {size / KB:.1f} KB gzip, a chunk without a budget (add `{name}` to {table.name})"
        return [line], line
    line = report_line(f"{table.folder}/{file}", size, budget)
    return within(line, size, budget), line


def check_engine_chunks(root: Path, budgets: Mapping[str, int] = ENGINE_CHUNK_BUDGETS) -> tuple[list[str], list[str]]:
    """(problems, report lines) of every lazy chunk of the engine's ES module build (its entries are in BUDGETS)."""
    table = ChunkTable(ENGINE_DIR, "ENGINE_CHUNK_BUDGETS", budgets)
    problems: list[str] = []
    lines: list[str] = []
    for path in sorted((root / ENGINE_DIR).glob("*.js")):
        if path.name not in ENGINE_ENTRIES:
            chunk_problems, line = chunk_report(path.name, gzip_size(path.read_bytes()), table)
            problems += chunk_problems
            lines.append(line)
    return problems, lines


def admin_sizes(folder: Path) -> dict[str, int]:
    """The gzip size of every script of the admin's build, by file name."""
    return {path.name: gzip_size(path.read_bytes()) for path in sorted([*folder.glob("*.js"), *folder.glob("*.mjs")])}


def entry_report(entry: Sequence[str], sizes: Mapping[str, int], budget: int) -> tuple[list[str], list[str]]:
    """(problems, [the report line]) of the entry and the chunks it imports statically."""
    size = sum(sizes[file] for file in entry)
    line = report_line(f"{ADMIN_DIR}/{ADMIN_ENTRY} with {len(entry) - 1} static chunk(s)", size, budget)
    return within(line, size, budget), [line]


def check_admin(root: Path, budgets: AdminBudgets = ADMIN_BUDGETS) -> tuple[list[str], list[str]]:
    """(problems, report lines) of the admin's entry, each lazy chunk and the whole."""
    folder = root / ADMIN_DIR
    if not (folder / ADMIN_ENTRY).is_file():
        return [f"{ADMIN_DIR}/{ADMIN_ENTRY}: missing (run the build stage first)"], []
    sizes = admin_sizes(folder)
    entry = [file for file in entry_files(folder, ADMIN_ENTRY) if file in sizes]
    problems, lines = entry_report(entry, sizes, budgets.entry_kb)
    table = ChunkTable(ADMIN_DIR, "ADMIN_CHUNK_BUDGETS", budgets.chunks)
    for file in sorted(set(sizes) - set(entry)):
        chunk_problems, line = chunk_report(file, sizes[file], table)
        problems += chunk_problems
        lines.append(line)
    total = sum(sizes.values())
    lines.append(report_line(f"{ADMIN_DIR} in all", total, budgets.total_kb))
    return problems + within(lines[-1], total, budgets.total_kb), lines


def install_report(folder: Path, budgets: Mapping[str, int]) -> tuple[list[str], list[str]]:
    """(problems, report lines) of one release's install bundle folder."""
    problems: list[str] = []
    lines: list[str] = []
    for name, budget in sorted(budgets.items()):
        path = folder / name
        label = f"{INSTALL_DIR}/{folder.name}/{name}"
        if not path.is_file():
            problems.append(f"{label}: missing (run build:install first)")
            continue
        size = path.stat().st_size
        line = f"{label}: {size / KB:.1f} KB as served (budget {budget} KB)"
        lines.append(line)
        problems += within(line, size, budget)
    return problems, lines


def check_install(root: Path, budgets: Mapping[str, int] = INSTALL_BUDGETS) -> tuple[list[str], list[str]]:
    """(problems, report lines) of every release folder of the install bundle (none is a problem)."""
    folders = sorted(path for path in (root / INSTALL_DIR).glob("*") if path.is_dir())
    if not folders:
        return [f"{INSTALL_DIR}: no install bundle (run build:install first)"], []
    problems: list[str] = []
    lines: list[str] = []
    for folder in folders:
        more_problems, more_lines = install_report(folder, budgets)
        problems += more_problems
        lines += more_lines
    return problems, lines


def report(problems: list[str], lines: list[str]) -> int:
    """Logs the verdict: 1 with the problems, else 0 with every line."""
    if problems:
        LOG.error("[bundle-budget] FAILED:\n%s", "\n".join(f"  - {problem}" for problem in problems))
        return 1
    LOG.info("[bundle-budget] OK:\n%s", "\n".join(f"  {line}" for line in lines))
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check the gzip size of the shipped bundles against their budgets.")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    parser.add_argument("--budget", action="append", type=budget_arg, default=[], metavar="FILE=KB", help="override or add a budget")
    parser.add_argument("--install", action="store_true", help="check only the in-app installer's bundle (after build:install)")
    args = parser.parse_args(argv)
    if args.install:
        return report(*check_install(args.root))
    problems, lines = check(args.root, {**BUDGETS, **dict(args.budget)})
    for more_problems, more_lines in (check_engine_chunks(args.root), check_admin(args.root)):
        problems += more_problems
        lines += more_lines
    return report(problems, lines)


if __name__ == "__main__":
    sys.exit(main())
