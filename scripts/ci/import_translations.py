#!/usr/bin/env python3
"""Imports translated catalogues into packages/shared/src/i18n, keeping only what passes the gate's checks.

A local model writes one file per catalogue family and language, in the catalogues' own layout
(`<folder>/<locale>.ts`, `<folder>` relative to packages/shared/src/i18n, `.` for the viewer's main family) and
format (one `'key': 'message',` entry per line, docs/I18N.md). Each entry is checked against the family's
Romanian source with check_i18n.py's own rules for an optional language (`translation_problems`): a key
the source lacks, a different `{placeholder}`, an empty message, a brace outside a placeholder, edge
whitespace, a bidi control or an HTML tag. A passing entry is written; a failing one is left out and
reported, so its key shows in English until a better translation comes.

QA is mandatory (the owner, 2026-11-12): a translated file is imported only with its passing QA report beside it,
`<locale>.ts.qa.json`, written by the local translation tool (`ltrans.py`: the validators and a back-translation check on
local models). The report must say `status: pass` under a `validators+back-translation/` policy and carry the file's
SHA-256; a file without one, or edited after its QA, is refused whole. Within a passing file, an entry is imported only
when the report lists it as passed (or as having no words to translate) with that very text.

The written file merges the language's file already there with the new entries (a new text wins, counted as
replaced), in the source's key order, typed `Readonly<Partial<Record<Key, string>>>` against the family's key type,
its strings quoted as Prettier quotes them. The entries already there are checked again against today's source: one
whose key is gone or whose placeholders changed since its import is dropped and reported as stale (its key shows in
English until translated again). The viewer's complete languages in its folders (`VIEWER_COMPLETE`) are never
touched; its other languages are imported like any family.

Usage: import_translations.py SOURCE_DIR [--locale CODE ...] [--root DIR] [--dry-run]. Exit status: 0 imported (every
rejection is listed), 1 nothing to import or an unreadable file, 2 usage.
"""

import argparse
import ast
import hashlib
import json
import re
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import check_i18n as i18n
from cilog import bullets, get_logger
from cirepo import ROOT

LOG = get_logger("i18n-import")

CATALOGUES = Path("packages/shared/src/i18n")
KEY_TYPE_RE = re.compile(r"^export type (\w+) = keyof typeof ro;$", re.M)
ENTRY_TOKENS_RE = re.compile(rf"^\s*(?P<key>{i18n._STRING}|[A-Za-z_$][\w$]*)\s*:\s*(?P<value>{i18n._STRING}|`[^`$]*`)\s*,?\s*$")


@dataclass
class Outcome:
    """What one import did: files written, new entries, texts replaced, entries rejected or dropped as stale, with the reason."""

    written: list[str] = field(default_factory=list)
    kept: int = 0
    replaced: int = 0
    rejected: list[str] = field(default_factory=list)
    stale: list[str] = field(default_factory=list)
    refused: list[str] = field(default_factory=list)


def decode(token: str) -> str:
    """A JavaScript string literal's text (`'…'`, `"…"`: the escapes Python reads alike; a template literal as it is)."""
    return token[1:-1] if token.startswith("`") else str(ast.literal_eval(token))


def encode(text: str) -> str:
    """`text` quoted as Prettier quotes it: single quotes unless double ones need fewer escapes."""
    quote = '"' if text.count("'") > text.count('"') else "'"
    escaped = text.replace("\\", "\\\\").replace("\n", "\\n").replace(quote, "\\" + quote)
    return f"{quote}{escaped}{quote}"


def read_texts(path: Path, locale: str) -> tuple[dict[str, str], list[str]]:
    """(key → text, unreadable lines) of `export const <locale> … = { … }` in `path`."""
    texts: dict[str, str] = {}
    unreadable: list[str] = []
    for number, line in i18n.literal_lines(path.read_text(encoding="utf-8"), locale):
        match = ENTRY_TOKENS_RE.match(line) if i18n.is_entry_candidate(line) else None
        if match is not None:
            texts[decode(match.group("key"))] = decode(match.group("value"))
        elif i18n.is_entry_candidate(line):
            unreadable.append(f"{path.name}:{number}: not a one-line entry")
    return texts, unreadable


QA_POLICY = "validators+back-translation/"
QA_PASSED = ("passed", "no-words")


def report_matches(report: object, file: Path) -> bool:
    """A passing QA report of this very file: status pass, the mandatory policy, the file's hash and a verdict per entry."""
    if not isinstance(report, dict) or not isinstance(report.get("entries"), dict):
        return False
    passing = report.get("status") == "pass" and str(report.get("policy", "")).startswith(QA_POLICY)
    return passing and report.get("fileSha256") == hashlib.sha256(file.read_bytes()).hexdigest()


def qa_report(file: Path) -> dict[str, Any] | None:
    """The QA report beside a translated file (`<locale>.ts.qa.json`) when it passes and matches the file, else None."""
    try:
        report = json.loads(file.with_name(file.name + ".qa.json").read_text(encoding="utf-8"))
    except OSError, ValueError:
        return None
    return report if report_matches(report, file) else None


def qa_passed(rel: str, texts: dict[str, str], report: dict[str, Any], outcome: Outcome) -> dict[str, str]:
    """The entries the QA report passed with this very text; the others join the outcome's rejections."""
    kept: dict[str, str] = {}
    for key, text in texts.items():
        entry = report["entries"].get(key)
        if isinstance(entry, dict) and entry.get("status") in QA_PASSED and entry.get("tr") == text:
            kept[key] = text
        else:
            outcome.rejected.append(f"{rel}: '{key}' has not passed QA")
    return kept


def entry_problems(rel: str, key: str, text: str, source: dict[str, str]) -> list[str]:
    """Why one translated entry cannot be imported (empty when it can)."""
    return i18n.translation_problems(rel, source, {key: text})


def accepted(rel: str, texts: dict[str, str], source: dict[str, str], outcome: Outcome) -> dict[str, str]:
    """The entries that pass; the others join the outcome's rejections."""
    kept: dict[str, str] = {}
    for key, text in texts.items():
        problems = entry_problems(rel, key, text, source)
        outcome.rejected.extend(problems)
        if not problems:
            kept[key] = text
    return kept


def key_type(folder: Path) -> str | None:
    """The family's key type, named in its `ro.ts` (`export type AdminShellKey = keyof typeof ro;`)."""
    match = KEY_TYPE_RE.search((folder / "ro.ts").read_text(encoding="utf-8"))
    return match.group(1) if match else None


def render(folder_name: str, locale: str, key_name: str, texts: dict[str, str], order: Sequence[str]) -> str:
    """The catalogue file: its header, the key type's import and one entry per line in the source's order."""
    entries = "".join(f"    '{key}': {encode(texts[key])},\n" for key in order if key in texts)
    return (
        f"import type {{ {key_name} }} from './ro.js';\n\n"
        f"/**\n * The `{folder_name}` family's texts in `{locale}`, imported by scripts/i18n/import_translations.py (docs/I18N.md).\n"
        f" * Partial while the translation goes on: a key not here shows in English.\n */\n"
        f"export const {locale}: Readonly<Partial<Record<{key_name}, string>>> = {{\n{entries}}};\n"
    )


def is_viewer_file(root: Path, folder: Path, locale: str) -> bool:
    """A complete viewer language in the viewer's folders: never overwritten."""
    return i18n.relative(root, folder) in i18n.VIEWER_FOLDERS and locale in i18n.VIEWER_COMPLETE


def target_of(root: Path, source_dir: Path, file: Path) -> tuple[Path, str] | None:
    """(catalogue folder, locale) of a translated file, or None when it names no family or no importable language."""
    locale, folder = file.stem, root / CATALOGUES / file.parent.relative_to(source_dir)
    importable = locale in i18n.UI_LOCALES and locale not in i18n.LOCALES and (folder / "ro.ts").is_file()
    return (folder, locale) if importable and not is_viewer_file(root, folder, locale) else None


def existing_texts(path: Path, locale: str, rel: str, source: dict[str, str], outcome: Outcome) -> dict[str, str]:
    """The language's texts already in the catalogue (none before its first import) that still pass against today's
    source; the others join the outcome's stale entries."""
    texts = read_texts(path, locale)[0] if path.is_file() else {}
    current: dict[str, str] = {}
    for key, text in texts.items():
        problems = entry_problems(rel, key, text, source)
        outcome.stale.extend(problems)
        if not problems:
            current[key] = text
    return current


def translated_texts(file: Path, locale: str, rel: str, outcome: Outcome) -> dict[str, str]:
    """A translated file's entries; a line that is no entry joins the outcome's rejections."""
    texts, unreadable = read_texts(file, locale)
    outcome.rejected.extend(f"{rel} (from {line})" for line in unreadable)
    return texts


def import_file(root: Path, file: Path, target: tuple[Path, str], outcome: Outcome, dry_run: bool) -> None:
    """Checks one translated file and merges what passes into the catalogue."""
    folder, locale = target
    path = folder / f"{locale}.ts"
    rel = i18n.relative(root, path)
    report = qa_report(file)
    if report is None:
        outcome.refused.append(f"{rel} (from {file.name}): no passing QA report {file.name}.qa.json matching the file")
        return
    source = i18n.read_catalogue(folder / "ro.ts", rel, "ro").messages
    existing = existing_texts(path, locale, rel, source, outcome)
    new = accepted(rel, qa_passed(rel, translated_texts(file, locale, rel, outcome), report, outcome), source, outcome)
    write_merged(root, target, (source, existing, new), outcome, dry_run)


def count_merged(rel: str, existing: dict[str, str], new: dict[str, str], outcome: Outcome) -> None:
    """The outcome counts the texts kept and replaced, and names the file written."""
    outcome.kept += len({**existing, **new}) - len(existing)
    outcome.replaced += sum(1 for key, text in new.items() if key in existing and existing[key] != text)
    outcome.written.append(rel)


def write_merged(
    root: Path, target: tuple[Path, str], texts: tuple[dict[str, str], dict[str, str], dict[str, str]], outcome: Outcome, dry_run: bool
) -> None:
    """Writes the catalogue's kept texts with the accepted new ones (`texts`: the source's, the existing, the new), counted."""
    folder, locale = target
    source, existing, new = texts
    merged = {**existing, **new}
    key_name = key_type(folder)
    if key_name is None or not merged:
        return
    count_merged(i18n.relative(root, folder / f"{locale}.ts"), existing, new, outcome)
    if not dry_run:
        (folder / f"{locale}.ts").write_text(render(i18n.relative(root, folder), locale, key_name, merged, list(source)), encoding="utf-8")


def translated_files(source_dir: Path, locales: Sequence[str]) -> list[Path]:
    """Every `<locale>.ts` below `source_dir`, the wanted languages only when named."""
    files = sorted(source_dir.rglob("*.ts"))
    return [file for file in files if not locales or file.stem in locales]


def run(root: Path, source_dir: Path, locales: Sequence[str], dry_run: bool) -> Outcome:
    outcome = Outcome()
    for file in translated_files(source_dir, locales):
        target = target_of(root, source_dir, file)
        if target is not None:
            import_file(root, file, target, outcome, dry_run)
    return outcome


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import translated catalogues, keeping only the entries that pass the i18n gate.")
    parser.add_argument("source", type=Path, help="the translations' folder (<folder>/<locale>.ts)")
    parser.add_argument("--locale", action="append", default=[], help="only this language (repeatable)")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    parser.add_argument("--dry-run", action="store_true", help="check and report, write nothing")
    args = parser.parse_args(argv)
    outcome = run(args.root, args.source, args.locale, args.dry_run)
    if outcome.refused:
        LOG.warning("[i18n-import] %d file(s) refused, QA is mandatory:\n%s", len(outcome.refused), bullets(outcome.refused))
    if outcome.rejected:
        LOG.warning(
            "[i18n-import] %d entr(ies) rejected, shown in English until translated again:\n%s",
            len(outcome.rejected),
            bullets(outcome.rejected),
        )
    if outcome.stale:
        LOG.warning(
            "[i18n-import] %d entr(ies) already imported no longer match the source, dropped (shown in English):\n%s",
            len(outcome.stale),
            bullets(outcome.stale),
        )
    if not outcome.written:
        LOG.error("[i18n-import] nothing to import from %s", args.source)
        return 1
    LOG.info(
        "[i18n-import] %d new text(s), %d replaced, in %d file(s):\n%s",
        outcome.kept,
        outcome.replaced,
        len(outcome.written),
        bullets(outcome.written),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
