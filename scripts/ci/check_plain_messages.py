#!/usr/bin/env python3
"""Static gate: messages say what happened, plainly (the owner's rule of 2026-11-13).

Every message tells the reader what happened, why and what to do next; the reader on screen is not
technical, so no jargon and no codes (they go to the logs and analytics). This gate catches what a
reader can never act on (`.agent/skills/web/i18n_skill.md` → rule 12):

* a catalogue message (every `packages/*/src/i18n/` folder and the folders inside one, read by
  `check_i18n.py`'s parser) that is only a generic phrase: "Something went wrong", "An error
  occurred", "Unknown error", "A apărut o eroare", ... A lone "Error" or "Failed" is a generic
  message too, unless its key names a label (a status, state, step, level, filter, column or
  version chip: `adminContent.jobs.status.failed`), where one word is the whole point;
* a catalogue message that shows the reader a code or jargon: an `apiError.` code, "HTTP", a
  status code in parentheses ("(404)") or after "HTTP"/"status"/"error", "quota exceeded"; and
  the word "token" outside the owner's own onboarding (Setup, the start page, the city creator and
  the Mapbox and USGS refusals: their consoles call it a token, and the owner pastes one);
* a logger call (`log.warn('…')`, `.error`, `.info`) in `packages/*/src` or `functions/src` whose
  message is only a generic phrase: the log names what failed, with ids, step and numbers.

Usage: check_plain_messages.py [--root DIR]. Exit status: 0 OK, 1 problems found, 2 usage.
"""

import argparse
import re
import sys
from collections.abc import Iterator
from pathlib import Path

from check_i18n import LOCALES, catalogue_folders, read_catalogue
from cilog import bullets, get_logger
from cirepo import ROOT

LOG = get_logger("plain-messages")

GENERIC_PHRASES = frozenset(
    {
        "something went wrong",
        "something unexpected went wrong",
        "an error occurred",
        "an unexpected error occurred",
        "unknown error",
        "oops",
        "a apărut o eroare",
        "a apărut o eroare neașteptată",
        "ceva nu a mers bine",
        "eroare necunoscută",
    }
)
LONE_WORDS = frozenset({"error", "failed", "failure", "eroare", "eșuat", "eșuată", "eșec"})
LABEL_SEGMENTS = frozenset({"status", "state", "step", "level", "filter", "column", "version"})
JARGON = (
    (re.compile(r"\bapiError\."), "an apiError code"),
    (re.compile(r"\bHTTP\b"), "HTTP"),
    (re.compile(r"\(\s*[45]\d\d\s*\)|\b(?:HTTP|status|error|eroare)\s+[45]\d\d\b", re.IGNORECASE), "a status code"),
    (re.compile(r"quota[ _]exceeded", re.IGNORECASE), "quota exceeded"),
)
TOKEN = re.compile(r"\btoken", re.IGNORECASE)
# Where the owner handles tokens by that name: Setup, the start page, the city creator; Mapbox's and USGS's refusals.
TOKEN_FOLDERS = frozenset({"admin-setup", "admin-install", "start"})
TOKEN_PACKAGES = frozenset({"create-historic-city"})
TOKEN_KEYS = ("apiError.mapbox.", "apiError.usgs.", "apiError.setup.")
LOGGER_CALL = re.compile(r"\b(?:log|logger)\w*\.(?:warn|error|info)\(\s*'([^']*)'")
SOURCE_GLOBS = ("packages/*/src/**/*.ts", "functions/src/**/*.ts")


def normalised(message: str) -> str:
    return re.sub(r"[\s.!:…]+$", "", message.strip()).lower()


def generic(key: str, message: str) -> bool:
    text = normalised(message)
    if text in GENERIC_PHRASES:
        return True
    segments = key.split(".")
    return text in LONE_WORDS and not LABEL_SEGMENTS.intersection(segments[:-1])


def token_allowed(folder: Path, key: str) -> bool:
    package = folder.parts[folder.parts.index("packages") + 1] if "packages" in folder.parts else ""
    return folder.name in TOKEN_FOLDERS or package in TOKEN_PACKAGES or key.startswith(TOKEN_KEYS)


def jargon(folder: Path, key: str, message: str) -> Iterator[str]:
    for pattern, name in JARGON:
        if pattern.search(message):
            yield name
    if TOKEN.search(message) and not token_allowed(folder, key):
        yield '"token"'


def message_problems(label: str, folder: Path, key: str, message: str) -> Iterator[str]:
    if generic(key, message):
        yield f"{label}: {key} is only a generic phrase ({message!r}): say what happened, why and the fix"
    for name in jargon(folder, key, message):
        yield f"{label}: {key} shows the reader {name}: say it in plain words (codes go to the logs)"


def catalogue_files(root: Path) -> Iterator[tuple[Path, Path, str]]:
    """(folder, catalogue file, locale) of every catalogue that exists."""
    for folder in catalogue_folders(root):
        for locale in LOCALES:
            path = folder / f"{locale}.ts"
            if path.is_file():
                yield folder, path, locale


def catalogue_problems(root: Path) -> Iterator[str]:
    for folder, path, locale in catalogue_files(root):
        label = str(path.relative_to(root))
        for key, message in read_catalogue(path, label, locale).messages.items():
            yield from message_problems(label, folder, key, message)


def source_files(root: Path) -> Iterator[Path]:
    for pattern in SOURCE_GLOBS:
        yield from sorted(root.glob(pattern))


def generic_log_line(line: str) -> str | None:
    """The message of a logger call that is only a generic phrase, else None."""
    match = LOGGER_CALL.search(line)
    return match.group(1) if match is not None and generic("log", match.group(1)) else None


def logger_problems(root: Path) -> Iterator[str]:
    for path in source_files(root):
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            message = generic_log_line(line)
            if message is not None:
                yield f"{path.relative_to(root)}:{number}: the log says only {message!r}: name what failed, with ids and numbers"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args(argv)
    problems = [*catalogue_problems(args.root), *logger_problems(args.root)]
    if problems:
        LOG.error("messages that do not say what happened plainly:\n%s", bullets(problems))
        return 1
    LOG.info("every message says what happened in plain words")
    return 0


if __name__ == "__main__":
    sys.exit(main())
