#!/usr/bin/env python3
"""Static gate: docs/ARCHITECTURE.md stays true to the tree.

* every backticked repository path it names (under packages/, functions/, pipeline/, scripts/, firebase/, infra/,
  sites/, templates/, docker/, e2e/, docs/) exists; a path with a placeholder (`<city>`, `*`, `{...}`) is skipped;
* every relative Markdown link it makes resolves to a file;
* it has at least one Mermaid diagram, and each ```mermaid block opens with a known diagram type, has a body and
  balanced brackets.

Usage: check_architecture.py [--root DIR]
"""

import argparse
import re
import sys
from collections.abc import Sequence
from pathlib import Path

from cilog import bullets, get_logger
from cirepo import ROOT

LOG = get_logger("architecture")

DOC = Path("docs", "ARCHITECTURE.md")
TOPS = ("packages", "functions", "pipeline", "scripts", "firebase", "infra", "sites", "templates", "docker", "e2e", "docs")
PATH_RE = re.compile(r"`((?:" + "|".join(TOPS) + r")/[^`\s]+)`")
LINK_RE = re.compile(r"\]\(([^)#\s:]+\.md)(?:#[^)]*)?\)")
MERMAID_RE = re.compile(r"```mermaid\n(.*?)```", re.S)
KINDS = ("flowchart", "graph", "sequenceDiagram", "stateDiagram-v2", "classDiagram", "erDiagram")
PAIRS = (("[", "]"), ("(", ")"), ("{", "}"))
MIN_LINES = 2  # the type line and at least one line of body
PLACEHOLDER = re.compile(r"[<>*{}]")


def missing_paths(text: str, root: Path) -> list[str]:
    """Named repository paths that do not exist (placeholders skipped)."""
    found = {m.rstrip(".,:;") for m in PATH_RE.findall(text)}
    return sorted(p for p in found if not PLACEHOLDER.search(p) and not (root / p).exists())


def broken_links(text: str, root: Path) -> list[str]:
    """Relative Markdown links from docs/ that resolve to no file."""
    return sorted({link for link in LINK_RE.findall(text) if not (root / "docs" / link).exists()})


def mermaid_problems(text: str) -> list[str]:
    """Each malformed Mermaid block, or the absence of any."""
    blocks = MERMAID_RE.findall(text)
    if not blocks:
        return ["no ```mermaid diagram"]
    problems = []
    for index, block in enumerate(blocks, 1):
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if len(lines) < MIN_LINES or not lines[0].startswith(KINDS):
            problems.append(f"diagram {index}: needs a known type ({', '.join(KINDS)}) and a body")
        problems.extend(f"diagram {index}: unbalanced {a}{b}" for a, b in PAIRS if block.count(a) != block.count(b))
    return problems


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    root = parser.parse_args(argv).root
    text = (root / DOC).read_text(encoding="utf-8")
    problems = [f"missing path: {p}" for p in missing_paths(text, root)]
    problems += [f"broken link: {p}" for p in broken_links(text, root)]
    problems += mermaid_problems(text)
    if problems:
        LOG.error("%s is out of date:\n%s", DOC, bullets(problems))
        return 1
    LOG.info("%s: paths, links and diagrams OK", DOC)
    return 0


if __name__ == "__main__":
    sys.exit(main())
