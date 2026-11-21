#!/usr/bin/env python3
"""Static gate: production copy never tells how the app was built or tested.

The owner's report of 2026-11-09: the viewer's gamepad line read "Standard gamepad (tried only simulated)", a note
of the developers shown to every visitor. This gate reads every i18n catalogue value (each `ro.ts` / `en.ts` under
`packages/*/src/i18n`, read as `check_i18n.py` reads them) and the other user-facing sources its configuration
names (the starter kit's page and data, the worker starter's messages, the export's README), and refuses a term of
its denylist: test doubles and runners (mock, fake, emulator, Playwright, e2e), unfinished work (TODO, FIXME),
milestone and design-note references (M5, CR-M3-47, §, DECISIONS, lessons), raw IAM role ids, and English words
inside Romanian ("pipeline"). The terms, the sources and the few allowed uses, each with its reason, live in
`scripts/ci/check_copy.toml`; an allowed use that no longer matches is reported, so the list never goes stale.

Usage: check_copy.py [--root DIR] [--config FILE]. Exit status: 0 OK, 1 problems found, 2 usage.
"""

import argparse
import json
import re
import sys
import tomllib
from collections.abc import Callable, Iterable, Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from check_i18n import LOCALES, catalogue_folders, read_catalogue, relative
from cilog import bullets, get_logger
from cirepo import ROOT

LOG = get_logger("copy")

CONFIG = Path(__file__).with_name("check_copy.toml")
_HIDDEN_HTML = re.compile(r"<!--.*?-->|<script\b.*?</script>|<style\b.*?</style>", re.DOTALL | re.IGNORECASE)
_SAY = re.compile(r"^\s*(?:say|Write-Host)\s+(?P<text>.+)$")
_STRING = re.compile(r"'(?:[^'\\\n]|\\.)*'|\"(?:[^\"\\\n]|\\.)*\"|`[^`]*`")
_COMMENT = re.compile(r"^\s*(//|/\*|\*)")


@dataclass(frozen=True)
class Term:
    """One denied term: a regular expression matched as a whole word."""

    regex: re.Pattern[str]
    why: str
    locales: tuple[str, ...]


@dataclass(frozen=True)
class Text:
    """One piece of copy: where it lives (`file` and a catalogue key or line), its locale ('' outside a catalogue)."""

    file: str
    where: str
    locale: str
    value: str


def term_of(entry: dict[str, Any]) -> Term:
    flags = re.IGNORECASE if entry.get("ignore_case", True) else 0
    regex = re.compile(rf"(?<![\w/])(?:{entry['pattern']})(?!\w)", flags)
    return Term(regex, str(entry["why"]), tuple(entry.get("locales", ())))


def catalogue_texts(root: Path) -> Iterator[Text]:
    """Every value of every catalogue, keyed by its message key."""
    for folder in catalogue_folders(root):
        for locale in LOCALES:
            path = folder / f"{locale}.ts"
            if path.is_file():
                rel = relative(root, path)
                for key, value in read_catalogue(path, rel, locale).messages.items():
                    yield Text(rel, key, locale, value)


def json_strings(node: object) -> Iterator[str]:
    """Every string value of a JSON document, keys left out."""
    if isinstance(node, str):
        yield node
        return
    children = node.values() if isinstance(node, dict) else node if isinstance(node, list) else ()
    for child in children:
        yield from json_strings(child)


def numbered(values: Iterable[str]) -> list[tuple[str, str]]:
    return [(f"line {number}", value) for number, value in enumerate(values, start=1)]


def html_values(text: str) -> list[tuple[str, str]]:
    """The page's lines with its comments, scripts and styles left out (a removed block keeps no line of its own)."""
    return numbered(_HIDDEN_HTML.sub("", text).splitlines())


def json_values(text: str) -> list[tuple[str, str]]:
    return [("a string value", value) for value in json_strings(json.loads(text))]


def matched_values(text: str, pattern: re.Pattern[str], group: int | str) -> list[tuple[str, str]]:
    """What `pattern` captures on each line that is not a comment, numbered by its line."""
    lines = enumerate(text.splitlines(), start=1)
    return [
        (f"line {number}", match.group(group)) for number, line in lines if not _COMMENT.match(line) for match in pattern.finditer(line)
    ]


EXTRACTORS: dict[str, Callable[[str], list[tuple[str, str]]]] = {
    "html": html_values,
    "json": json_values,
    "text": lambda text: numbered(text.splitlines()),
    "say": lambda text: matched_values(text, _SAY, "text"),
    "strings": lambda text: matched_values(text, _STRING, 0),
}


def source_texts(root: Path, sources: Sequence[dict[str, Any]]) -> Iterator[Text]:
    for source in sources:
        path = root / source["path"]
        if not path.is_file():
            yield Text(source["path"], "missing", "", "")
            continue
        for where, value in EXTRACTORS[source["kind"]](path.read_text(encoding="utf-8")):
            yield Text(source["path"], where, "", value)


def applies(term: Term, text: Text) -> bool:
    return not term.locales or text.locale in term.locales


def hits(texts: Sequence[Text], terms: Sequence[Term]) -> Iterator[tuple[Text, Term, str]]:
    for text in texts:
        for term in filter(lambda candidate: applies(candidate, text), terms):
            yield from ((text, term, match.group(0)) for match in term.regex.finditer(text.value))


def allowed_key(where: str, term: str) -> tuple[str, str]:
    return where, term.casefold()


def denials(texts: Sequence[Text], terms: Sequence[Term], allowed: set[tuple[str, str]]) -> tuple[list[str], set[tuple[str, str]]]:
    """(each denied term found outside the allowed uses, the allowed uses that matched)."""
    problems: list[str] = []
    used: set[tuple[str, str]] = set()
    for text, term, found in hits(texts, terms):
        keys = {allowed_key(text.where, found), allowed_key(text.file, found)} & allowed
        used |= keys
        problems += [] if keys else [f"{text.file}: {text.where}: {found!r} ({term.why}): {text.value.strip()[:120]}"]
    return problems, used


def missing_sources(texts: Sequence[Text]) -> list[str]:
    return [f"{text.file}: the source is missing" for text in texts if text.where == "missing"]


def stale_allowances(allowed: set[tuple[str, str]], used: set[tuple[str, str]]) -> list[str]:
    return [f"check_copy.toml: the allowed use {where!r} / {term!r} no longer matches" for where, term in sorted(allowed - used)]


def check(root: Path, config: dict[str, Any]) -> tuple[list[str], int]:
    """(problems, texts read): every denied term outside the allowed uses, every source missing, every stale allowance."""
    terms = [term_of(entry) for entry in config.get("term", [])]
    texts = [*catalogue_texts(root), *source_texts(root, config.get("source", []))]
    allowed = {allowed_key(entry["where"], entry["term"]) for entry in config.get("allow", [])}
    found, used = denials(texts, terms, allowed)
    return missing_sources(texts) + found + stale_allowances(allowed, used), len(texts)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Refuse developer and test words in the user-facing copy.")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    parser.add_argument("--config", type=Path, default=CONFIG, help="terms, sources and allowed uses (default: check_copy.toml)")
    args = parser.parse_args(argv)
    problems, count = check(args.root, tomllib.loads(args.config.read_text(encoding="utf-8")))
    if problems:
        LOG.error("[copy] FAILED:\n%s", bullets(problems))
        return 1
    LOG.info("[copy] OK: %d texts, no developer or test words", count)
    return 0


if __name__ == "__main__":
    sys.exit(main())
