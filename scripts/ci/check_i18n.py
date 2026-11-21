#!/usr/bin/env python3
"""Static gate: every UI catalogue holds the same messages as the Romanian source.

Every UI string exists in `ro` (the default locale and the source of truth for keys) and in every
other locale of its folder: `en` for the admin's, the API's and the start page's, and the sixteen languages
the public viewer is complete in (`VIEWER_COMPLETE`) for `packages/shared/src/i18n` and its `map-labels/`.
TypeScript already rejects a missing key (each catalogue is typed against `ro`); this gate also
catches what the type system cannot see, in every `packages/*/src/i18n/` folder and every folder
directly inside one (`packages/shared/src/i18n/api/`: the backend's error messages, kept apart so
the public viewer never ships them):

* each folder has one catalogue per locale (`ro.ts`, `en.ts`, …);
* every locale defines exactly the source's keys, none of them twice;
* every message is non-empty and uses the same `{placeholder}` names as the source (a translated
  placeholder name would stay visible on screen).

The viewer's catalogues, which Claude translates (DECISIONS-for-review.md §218), are also checked for
what a translation gets wrong (`viewer_problems`; a viewer language still being translated, every check but the
plural forms):

* a counted family (a key ending `.one`) has all six plural forms, `zero` to `other`, as
  `Intl.PluralRules` may select any of them;
* a placeholder is only `{word}` with balanced braces: no ICU syntax, which no runtime reads;
* no message starts or ends with whitespace, and none holds a bidi control (the engine isolates
  values itself);
* outside English, a message equal to the English one is untranslated, unless it has no letter
  outside its placeholders, names a licence (`license.*`) or is a word both languages spell alike
  (`COGNATES`);
* at least 80 % of a catalogue's letters are in its script (`SCRIPTS`): a catalogue pasted into
  the wrong file fails;
* Romanian writes ș and ț with a comma below, never ş and ţ with a cedilla.

The interface's other languages (`UI_LOCALES`, the list of packages/shared/src/i18n/locales.ts: 25 in all)
arrive one family at a time, translated by a local model and imported with
scripts/i18n/import_translations.py (docs/I18N.md). Where a folder does not require a language, its file is
optional; when it is there, it is checked for shape (`translation_problems`), as every language but `ro` and `en` is,
required or not:

* no key the source lacks, and every message non-empty;
* the same `{placeholder}` names as the source, braces only around them, no edge whitespace, no bidi control;
* no HTML tag the source does not have (a model that answers with markup).

A key the file lacks shows in English at run time; the gate reports each language's completeness
(`completeness`, an info line per language) instead of failing. `--strict` (or `HCM_I18N_STRICT=1`) keeps every
check of the default mode and adds one: every language of `UI_LOCALES` required in every folder with every key
(the viewer's folders then check all six plural forms of each). The owner switches it on once the translations
are complete. The strictness of `ro` and `en` never changes.

A language with nothing translated yet may be an empty literal (`export const nl: … = {};`).

A catalogue is a flat object literal of one-line entries, the shape Prettier keeps (a translation's
text too long for one line is wrapped by Prettier after its key, and read as one entry):

    export const ro = {
        'app.title': 'București dispărut',
        'hello.greeting': 'Salut, {name}!',
    } as const;

Any other line inside the literal (a computed key, a nested object, a value split over lines)
is reported rather than skipped, so the parity check never passes on a catalogue it misread.

Usage: check_i18n.py [--root DIR] [--strict]. Exit status: 0 OK, 1 problems found, 2 usage.
"""

import argparse
import os
import re
import sys
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass, field
from itertools import chain
from pathlib import Path

from cilog import bullets, get_logger
from cirepo import ROOT

LOG = get_logger("i18n")

LOCALES = ("ro", "en")
SOURCE_LOCALE = LOCALES[0]
# The languages the public viewer is complete in, required in its folders (its other languages are being translated).
VIEWER_COMPLETE = ("ro", "en", "es", "fr", "de", "it", "pt", "ru", "uk", "pl", "tr", "ar", "hi", "zh", "ja", "ko")
# Every language of the interface (`UI_LOCALES` of packages/shared/src/i18n/locales.ts; test_check_i18n.py keeps them equal).
UI_LOCALES = (
    *("ro", "en", "fr", "de", "es", "it", "pt", "pl", "ru", "uk", "tr", "ja", "zh", "ko", "ar", "hi"),
    *("nl", "hu", "id", "vi", "bn", "bg", "el", "fa", "ur"),
)
STRICT_ENV = "HCM_I18N_STRICT"
HTML_TAG_RE = re.compile(r"<\s*/?\s*[A-Za-z][^<>]*>")
VIEWER_FOLDERS = frozenset({"packages/shared/src/i18n", "packages/shared/src/i18n/map-labels"})
PLURAL_FORMS = ("zero", "one", "two", "few", "many", "other")
# The letters of a catalogue's script, by the start of their Unicode name; Latin for every other locale.
SCRIPTS = {
    "ru": ("CYRILLIC",),
    "uk": ("CYRILLIC",),
    "ar": ("ARABIC",),
    "hi": ("DEVANAGARI",),
    "zh": ("CJK",),
    "ja": ("CJK", "HIRAGANA", "KATAKANA"),
    "ko": ("HANGUL",),
    "bn": ("BENGALI",),
    "bg": ("CYRILLIC",),
    "el": ("GREEK",),
    "fa": ("ARABIC",),
    "ur": ("ARABIC",),
}
MIN_SCRIPT_SHARE = 0.8
# Words a language spells as English does, checked by a translator: the only messages equal to English allowed.
COGNATES = {
    "ro": frozenset({"consent.accept", "photoVersion.original"}),
    "fr": frozenset({"action.menu", "photos.count.one", "photos.count.two", "photos.count.few", "photos.count.other"}),
    "de": frozenset({"photo.links", "poi.links", "about.engine", "theme.system", "photoVersion.original"}),
    "pt": frozenset({"action.menu", "photo.links", "poi.links", "photoVersion.original"}),
    "pl": frozenset({"action.menu"}),
    "es": frozenset({"photoVersion.original"}),
}
BIDI_CONTROLS = re.compile("[\u200e\u200f\u202a-\u202e\u2066-\u2069]")
CEDILLA = re.compile("[şţŞŢ]")
LETTER_RE = re.compile(r"[^\W\d_]")
# The UI catalogues, and the catalogues one level below them (the API error messages).
CATALOGUE_GLOBS = ("packages/*/src/i18n", "packages/*/src/i18n/*")
_STRING = r"'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\""
ENTRY_RE = re.compile(rf"^\s*(?P<key>{_STRING}|[A-Za-z_$][\w$]*)\s*:\s*(?P<value>{_STRING}|`[^`$]*`)\s*,?\s*$")
KEY_ONLY_RE = re.compile(rf"^\s*(?:{_STRING}|[A-Za-z_$][\w$]*)\s*:\s*$")
EMPTY_RE = r"^export\s+const\s+{name}\b[^=]*=\s*\{{\s*\}};?\s*$"
OPEN_RE = re.compile(r"^export\s+const\s+(?P<name>\w+)\b[^=]*=\s*\{\s*$")
CLOSE_RE = re.compile(r"^\}")
COMMENT_RE = re.compile(r"^\s*(//|/\*|\*)")
PLACEHOLDER_RE = re.compile(r"\{(\w+)\}")


@dataclass
class Catalogue:
    """One locale's messages, and what could not be read."""

    messages: dict[str, str] = field(default_factory=dict)
    problems: list[str] = field(default_factory=list)


def unquote(token: str) -> str:
    return token[1:-1] if token[:1] in "'\"`" else token


def opens(line: str, locale: str) -> bool:
    """True for the `export const <locale> ... = {` line."""
    match = OPEN_RE.match(line)
    return match is not None and match.group("name") == locale


def literal_start(lines: Sequence[str], locale: str) -> int | None:
    return next((index for index, line in enumerate(lines) if opens(line, locale)), None)


def literal_end(lines: Sequence[str], start: int) -> int:
    return next((index for index in range(start, len(lines)) if CLOSE_RE.match(lines[index])), len(lines))


def literal_lines(text: str, locale: str) -> list[tuple[int, str]]:
    """(line number, line) inside `export const <locale> = {` ... `}` (empty without that literal)."""
    lines = text.splitlines()
    start = literal_start(lines, locale)
    if start is None:
        return []
    end = literal_end(lines, start + 1)
    numbered = list(enumerate(lines[start + 1 : end], start=start + 2))
    return numbered if locale in LOCALES else unwrapped(numbered)


def unwrapped(numbered: list[tuple[int, str]]) -> list[tuple[int, str]]:
    """A translation's entry Prettier wrapped after its key (a text longer than the line) as one line again; Romanian
    and English stay one line per entry, so their catalogues never wrap."""
    joined: list[tuple[int, str]] = []
    for number, line in numbered:
        if joined and KEY_ONLY_RE.match(joined[-1][1]):
            joined[-1] = (joined[-1][0], f"{joined[-1][1]} {line.strip()}")
        else:
            joined.append((number, line))
    return joined


def read_entry(catalogue: Catalogue, where: str, line: str) -> None:
    match = ENTRY_RE.match(line)
    if match is None:
        catalogue.problems.append(f"{where}: not a one-line `'key': 'message',` entry")
        return
    key, value = unquote(match.group("key")), unquote(match.group("value"))
    if key in catalogue.messages:
        catalogue.problems.append(f"{where}: key {key!r} defined twice")
    catalogue.messages[key] = value


def is_entry_candidate(line: str) -> bool:
    """Every non-blank, non-comment line inside the literal must be an entry."""
    return bool(line.strip()) and not COMMENT_RE.match(line)


def is_empty_translation(path: Path, locale: str) -> bool:
    """A language other than `ro` and `en` with nothing translated yet: `export const <locale>: … = {};`."""
    pattern = re.compile(EMPTY_RE.format(name=re.escape(locale)), re.M)
    return locale not in LOCALES and pattern.search(path.read_text(encoding="utf-8")) is not None


def read_catalogue(path: Path, rel: str, locale: str) -> Catalogue:
    catalogue = Catalogue()
    for number, line in literal_lines(path.read_text(encoding="utf-8"), locale):
        if is_entry_candidate(line):
            read_entry(catalogue, f"{rel}:{number}", line)
    if lacks_literal(catalogue, path, locale):
        catalogue.problems.append(f"{rel}: no `export const {locale} = {{ ... }}` catalogue")
    return catalogue


def lacks_literal(catalogue: Catalogue, path: Path, locale: str) -> bool:
    """Nothing read, nothing wrong, and not a language's deliberately empty literal: the file holds no catalogue."""
    return not catalogue.messages and not catalogue.problems and not is_empty_translation(path, locale)


def message_problems(rel: str, source: dict[str, str], other: dict[str, str]) -> list[str]:
    """Empty messages of `other`, and placeholders that differ from the source locale's."""
    problems = [f"{rel}: {key!r} is empty" for key, value in other.items() if not value.strip()]
    for key in sorted(set(source) & set(other)):
        expected, found = set(PLACEHOLDER_RE.findall(source[key])), set(PLACEHOLDER_RE.findall(other[key]))
        if expected != found:
            problems.append(f"{rel}: {key!r} uses placeholders {sorted(found)}, {SOURCE_LOCALE} uses {sorted(expected)}")
    return problems


def key_problems(rel: str, source: dict[str, str], other: dict[str, str]) -> list[str]:
    missing = [f"{rel}: missing key {key!r} (defined in {SOURCE_LOCALE})" for key in sorted(set(source) - set(other))]
    return missing + [f"{rel}: extra key {key!r} (not in {SOURCE_LOCALE})" for key in sorted(set(other) - set(source))]


def relative(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def parity_problems(root: Path, files: dict[str, Path], catalogues: dict[str, Catalogue]) -> list[str]:
    """Every other locale against the source locale: keys, placeholders and empty messages."""
    source = catalogues[SOURCE_LOCALE].messages
    problems = message_problems(relative(root, files[SOURCE_LOCALE]), {}, source)
    for locale in list(files)[1:]:
        rel, other = relative(root, files[locale]), catalogues[locale].messages
        problems += key_problems(rel, source, other) + message_problems(rel, source, other)
    return problems


def missing_forms(family: str, messages: dict[str, str]) -> list[str]:
    """The plural forms `family` lacks."""
    return [form for form in PLURAL_FORMS if f"{family}.{form}" not in messages]


def plural_problems(rel: str, messages: dict[str, str]) -> list[str]:
    """Every counted family (a `.one` key) with all six plural forms."""
    families = sorted(key.removesuffix(".one") for key in messages if key.endswith(".one"))
    return [f"{rel}: {family!r} has no {form!r} plural form" for family in families for form in missing_forms(family, messages)]


def braces_balanced(value: str) -> bool:
    """Every brace is part of a `{word}` placeholder: no ICU syntax (`{count, plural, …}`), no stray brace."""
    return "{" not in PLACEHOLDER_RE.sub("", value) and "}" not in PLACEHOLDER_RE.sub("", value)


def text_problems(rel: str, key: str, value: str) -> list[str]:
    """What one message of a viewer catalogue may not hold."""
    found = [] if braces_balanced(value) else [f"{rel}: {key!r} has a brace outside a {{word}} placeholder"]
    found += [f"{rel}: {key!r} starts or ends with whitespace"] if value != value.strip() else []
    return found + ([f"{rel}: {key!r} holds a bidi control"] if BIDI_CONTROLS.search(value) else [])


def is_untranslated(locale: str, key: str, value: str, english: str | None) -> bool:
    """A message equal to English that has letters of its own, is no licence's name and no known cognate."""
    if value != english or key.startswith("license.") or key in COGNATES.get(locale, frozenset()):
        return False
    return LETTER_RE.search(PLACEHOLDER_RE.sub("", value)) is not None


def letters_of(messages: dict[str, str]) -> list[str]:
    """Every letter of the messages outside their placeholders."""
    return [char for value in messages.values() for char in PLACEHOLDER_RE.sub("", value) if LETTER_RE.match(char)]


def script_share(locale: str, messages: dict[str, str]) -> float:
    """The share of the letters outside placeholders that are in the locale's script (1 without letters)."""
    letters = letters_of(messages)
    scripts = SCRIPTS.get(locale, ("LATIN",))
    inside = sum(1 for char in letters if unicodedata.name(char, "").startswith(scripts))
    return inside / len(letters) if letters else 1.0


def untranslated_problems(rel: str, locale: str, messages: dict[str, str], english: dict[str, str]) -> list[str]:
    """Outside English, every message equal to the English one (`is_untranslated`)."""
    if locale == "en":
        return []
    untranslated = [key for key, value in messages.items() if is_untranslated(locale, key, value, english.get(key))]
    return [f"{rel}: {key!r} is the English text" for key in untranslated]


def script_problems(rel: str, locale: str, messages: dict[str, str]) -> list[str]:
    """Too few letters in the catalogue's script, and Romanian's cedillas."""
    found = [] if script_share(locale, messages) >= MIN_SCRIPT_SHARE else [f"{rel}: fewer than 80 % of its letters are in its script"]
    cedillas = locale == "ro" and any(CEDILLA.search(value) for value in messages.values())
    return found + ([f"{rel}: Romanian writes ș and ț with a comma below"] if cedillas else [])


def catalogue_problems(rel: str, locale: str, messages: dict[str, str], english: dict[str, str], plurals: bool = True) -> list[str]:
    """One viewer catalogue's own problems (`viewer_problems`); `plurals`: every counted family complete too."""
    texts = chain.from_iterable(text_problems(rel, key, value) for key, value in messages.items())
    untranslated = untranslated_problems(rel, locale, messages, english)
    counted = plural_problems(rel, messages) if plurals else []
    return [*counted, *texts, *untranslated, *script_problems(rel, locale, messages)]


def viewer_problems(root: Path, files: dict[str, Path], catalogues: dict[str, Catalogue]) -> list[str]:
    """What a translation of the viewer's catalogues gets wrong (the module docstring's list)."""
    english = catalogues.get("en", Catalogue()).messages
    found = (catalogue_problems(relative(root, path), locale, catalogues[locale].messages, english) for locale, path in files.items())
    return list(chain.from_iterable(found))


def compare(root: Path, files: dict[str, Path], viewer: bool = False) -> tuple[list[str], int]:
    catalogues = {locale: read_catalogue(path, relative(root, path), locale) for locale, path in files.items()}
    problems = list(chain.from_iterable(catalogue.problems for catalogue in catalogues.values()))
    problems += parity_problems(root, files, catalogues)
    return problems + (viewer_problems(root, files, catalogues) if viewer else []), len(catalogues[SOURCE_LOCALE].messages)


def is_viewer_folder(root: Path, folder: Path) -> bool:
    return relative(root, folder) in VIEWER_FOLDERS


def locales_of(root: Path, folder: Path) -> tuple[str, ...]:
    """The languages a folder requires: the viewer's sixteen complete ones in its folders, Romanian and English elsewhere."""
    return VIEWER_COMPLETE if is_viewer_folder(root, folder) else LOCALES


def html_problems(rel: str, source: dict[str, str], other: dict[str, str]) -> list[str]:
    """A tag the source's message does not have (a model that answered with markup)."""
    found = []
    for key in sorted(set(source) & set(other)):
        if set(HTML_TAG_RE.findall(other[key])) - set(HTML_TAG_RE.findall(source[key])):
            found.append(f"{rel}: {key!r} holds an HTML tag")
    return found


def translation_problems(rel: str, source: dict[str, str], other: dict[str, str]) -> list[str]:
    """An optional language's file: its shape only (the module docstring's list); a missing key is no problem."""
    extra = [f"{rel}: extra key {key!r} (not in {SOURCE_LOCALE})" for key in sorted(set(other) - set(source))]
    texts = chain.from_iterable(text_problems(rel, key, value) for key, value in other.items())
    return [*extra, *message_problems(rel, source, other), *texts, *html_problems(rel, source, other)]


def optional_locales(required: tuple[str, ...]) -> tuple[str, ...]:
    """The interface's languages a folder does not require."""
    return tuple(locale for locale in UI_LOCALES if locale not in required)


def shape_problems(root: Path, folder: Path, locale: str, required: bool) -> list[str]:
    """One file of a language other than `ro` and `en`, required or not: its shape (`translation_problems`), in the
    viewer's folders its translation too (`catalogue_problems`; the plural forms only where the language is required,
    which `viewer_problems` checks), and for an optional file what could not be read."""
    path, source_path = folder / f"{locale}.ts", folder / f"{SOURCE_LOCALE}.ts"
    rel = relative(root, path)
    source = read_catalogue(source_path, relative(root, source_path), SOURCE_LOCALE).messages
    catalogue = read_catalogue(path, rel, locale)
    found = ([] if required else catalogue.problems) + translation_problems(rel, source, catalogue.messages)
    if is_viewer_folder(root, folder) and not required:
        english = read_catalogue(folder / "en.ts", "", "en").messages
        found += catalogue_problems(rel, locale, catalogue.messages, english, plurals=False)
    return found


def translations_problems(root: Path, folder: Path, required: tuple[str, ...]) -> list[str]:
    """Every file of a language other than `ro` and `en` that is there (`shape_problems`)."""
    present = (locale for locale in UI_LOCALES if locale not in LOCALES and (folder / f"{locale}.ts").is_file())
    return list(chain.from_iterable(shape_problems(root, folder, locale, locale in required) for locale in present))


def check_folder(root: Path, folder: Path, strict: bool = False) -> tuple[list[str], int]:
    """(problems, keys of the source locale) for one i18n folder; `strict`: every check of the default mode, and every
    interface language required."""
    required = UI_LOCALES if strict else locales_of(root, folder)
    files = {locale: folder / f"{locale}.ts" for locale in required}
    absent = absent_catalogues(root, files)
    present = files_present(files)
    if SOURCE_LOCALE not in present:
        return absent, 0
    return folder_problems(root, folder, present, required, absent)


def files_present(files: dict[str, Path]) -> dict[str, Path]:
    """The catalogue files that are there."""
    return {locale: path for locale, path in files.items() if path.is_file()}


def folder_problems(
    root: Path, folder: Path, present: dict[str, Path], required: tuple[str, ...], absent: list[str]
) -> tuple[list[str], int]:
    """`check_folder` once the source catalogue is there: the comparison, then every translation's shape."""
    problems, keys = compare(root, present, viewer=is_viewer_folder(root, folder))
    return list(dict.fromkeys(absent + problems + translations_problems(root, folder, required))), keys


def absent_catalogues(root: Path, files: dict[str, Path]) -> list[str]:
    """A required catalogue file that is not there."""
    return [f"{relative(root, path)}: missing catalogue" for path in files.values() if not path.is_file()]


def catalogue_folders(root: Path) -> list[Path]:
    return sorted(path for pattern in CATALOGUE_GLOBS for path in root.glob(pattern) if path.is_dir())


def merge(results: Sequence[tuple[list[str], int]]) -> tuple[list[str], int]:
    return list(chain.from_iterable(problems for problems, _ in results)), sum(keys for _, keys in results)


def check(root: Path, strict: bool = False) -> tuple[list[str], int, int]:
    """(problems, catalogue folders, keys) for every catalogue folder (`CATALOGUE_GLOBS`)."""
    folders = catalogue_folders(root)
    if not folders:
        return [f"no catalogue folder matches {' or '.join(CATALOGUE_GLOBS)}"], 0, 0
    problems, keys = merge([check_folder(root, folder, strict) for folder in folders])
    return problems, len(folders), keys


def folder_counts(folder: Path, locale: str) -> tuple[int, int]:
    """(keys `locale` has that the source has, keys of the source) in one folder."""
    source = read_catalogue(folder / f"{SOURCE_LOCALE}.ts", "", SOURCE_LOCALE).messages
    path = folder / f"{locale}.ts"
    other = read_catalogue(path, "", locale).messages if path.is_file() else {}
    return len(set(source) & set(other)), len(source)


def completeness(root: Path) -> dict[str, tuple[int, int]]:
    """Each interface language: (keys translated, keys in all) over every catalogue folder."""
    folders = [folder for folder in catalogue_folders(root) if (folder / f"{SOURCE_LOCALE}.ts").is_file()]
    return {locale: locale_counts(folders, locale) for locale in UI_LOCALES}


def locale_counts(folders: Sequence[Path], locale: str) -> tuple[int, int]:
    """(keys translated, keys in all) of one language over `folders`."""
    counts = [folder_counts(folder, locale) for folder in folders]
    return sum(have for have, _ in counts), sum(total for _, total in counts)


def translating(root: Path) -> bool:
    """True once a folder holds a language it does not require: a translation is under way."""
    folders = catalogue_folders(root)
    optional = ((folder, optional_locales(locales_of(root, folder))) for folder in folders)
    return any((folder / f"{locale}.ts").is_file() for folder, locales in optional for locale in locales)


def report_lines(report: dict[str, tuple[int, int]]) -> list[str]:
    """`fr 412/2804 (14 %)` for every language short of complete."""
    short = [(locale, have, total) for locale, (have, total) in report.items() if have < total]
    return [f"{locale} {have}/{total} ({have * 100 // max(total, 1)} %)" for locale, have, total in short]


def is_strict(flag: bool) -> bool:
    """The flag, or `HCM_I18N_STRICT=1` (the owner's switch once the translations are complete)."""
    return flag or os.environ.get(STRICT_ENV, "") == "1"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check that every UI catalogue holds the Romanian source's messages.")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    parser.add_argument("--strict", action="store_true", help=f"every interface language complete (or {STRICT_ENV}=1)")
    args = parser.parse_args(argv)
    problems, folders, keys = check(args.root, is_strict(args.strict))
    if problems:
        LOG.error("[i18n] FAILED:\n%s", bullets(problems))
        return 1
    incomplete = report_lines(completeness(args.root)) if translating(args.root) else []
    if incomplete:
        LOG.info("[i18n] languages still translating (their missing keys show in English):\n%s", bullets(incomplete))
    languages = " and ".join(LOCALES)
    viewer = len(VIEWER_COMPLETE)
    LOG.info("[i18n] OK: %d catalogue folder(s), %d keys, identical in %s (the viewer's in %d languages)", folders, keys, languages, viewer)
    return 0


if __name__ == "__main__":
    sys.exit(main())
