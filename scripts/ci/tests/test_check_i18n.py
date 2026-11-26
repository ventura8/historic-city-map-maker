"""check_i18n.py: key parity, placeholders, empty messages, unreadable lines and the viewer's sixteen catalogues."""

import runpy
import sys
from pathlib import Path

import check_i18n as i18n
import pytest
from cirepo import ROOT
from treeutil import write

SCRIPT = Path(i18n.__file__)
RO = """/** Romanian catalogue. */
export const ro = {
    // Application
    'app.title': 'București dispărut',
    "hello.greeting": "Salut, {name}!",
    plain: `fără`,
} as const;

export type MessageKey = keyof typeof ro;
"""
EN = """import type { Messages } from './ro.js';

export const en: Messages = {
    'app.title': 'Vanished Bucharest',
    'hello.greeting': 'Hello, {name}!',
    plain: 'plain',
};
"""


def catalogues(root: Path, ro: str = RO, en: str = EN, package: str = "admin", folder: str = "i18n") -> None:
    write(root, f"packages/{package}/src/{folder}/ro.ts", ro, newline=False)
    write(root, f"packages/{package}/src/{folder}/en.ts", en, newline=False)


def test_happy_path_matching_catalogues_pass(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    catalogues(tmp_path)
    catalogues(tmp_path, package="ui")

    assert i18n.main(["--root", str(tmp_path)]) == 0
    assert caplog.messages == ["[i18n] OK: 2 catalogue folder(s), 6 keys, identical in ro and en (the viewer's in 16 languages)"]


def test_bad_path_key_and_placeholder_drift_is_reported(tmp_path: Path) -> None:
    en = EN.replace("'Hello, {name}!'", "'Hello, {nume}!'").replace("plain: 'plain',", "'extra.key': 'Extra',\n    'empty': ' ',")
    catalogues(tmp_path, en=en)

    problems, _, _ = i18n.check(tmp_path)

    assert problems == [
        "packages/admin/src/i18n/en.ts: missing key 'plain' (defined in ro)",
        "packages/admin/src/i18n/en.ts: extra key 'empty' (not in ro)",
        "packages/admin/src/i18n/en.ts: extra key 'extra.key' (not in ro)",
        "packages/admin/src/i18n/en.ts: 'empty' is empty",
        "packages/admin/src/i18n/en.ts: 'hello.greeting' uses placeholders ['nume'], ro uses ['name']",
    ]


def test_bad_path_unreadable_lines_duplicates_and_empty_source_messages(tmp_path: Path) -> None:
    ro = RO.replace("plain: `fără`,", "plain: '',\n    'app.title': 'Again',\n    [computed]: 'x',\n    'split':\n        'value',")
    catalogues(tmp_path, ro=ro)

    problems, _, _ = i18n.check(tmp_path)

    assert problems == [
        "packages/admin/src/i18n/ro.ts:7: key 'app.title' defined twice",
        "packages/admin/src/i18n/ro.ts:8: not a one-line `'key': 'message',` entry",
        "packages/admin/src/i18n/ro.ts:9: not a one-line `'key': 'message',` entry",
        "packages/admin/src/i18n/ro.ts:10: not a one-line `'key': 'message',` entry",
        "packages/admin/src/i18n/ro.ts: 'plain' is empty",
    ]


def test_bad_path_missing_catalogue_file_or_literal(tmp_path: Path) -> None:
    write(tmp_path, "packages/ui/src/i18n/ro.ts", RO)
    catalogues(tmp_path, en="export const english = {\n};\n")

    problems, folders, _ = i18n.check(tmp_path)

    assert folders == 2
    assert problems == [
        "packages/admin/src/i18n/en.ts: no `export const en = { ... }` catalogue",
        "packages/admin/src/i18n/en.ts: missing key 'app.title' (defined in ro)",
        "packages/admin/src/i18n/en.ts: missing key 'hello.greeting' (defined in ro)",
        "packages/admin/src/i18n/en.ts: missing key 'plain' (defined in ro)",
        "packages/ui/src/i18n/en.ts: missing catalogue",
    ]


def test_bad_path_no_catalogue_folder(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    assert i18n.main(["--root", str(tmp_path)]) == 1
    assert caplog.messages == ["[i18n] FAILED:\n  - no catalogue folder matches packages/*/src/i18n or packages/*/src/i18n/*"]


def test_happy_path_a_nested_catalogue_folder_is_checked_too(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    catalogues(tmp_path)
    catalogues(tmp_path, folder="i18n/api")

    assert i18n.main(["--root", str(tmp_path)]) == 0
    assert caplog.messages == ["[i18n] OK: 2 catalogue folder(s), 6 keys, identical in ro and en (the viewer's in 16 languages)"]


def test_bad_path_a_nested_catalogue_folder_drifts(tmp_path: Path) -> None:
    catalogues(tmp_path)
    catalogues(tmp_path, en=EN.replace("plain: 'plain',", ""), folder="i18n/api")

    problems, folders, _ = i18n.check(tmp_path)

    assert (problems, folders) == (["packages/admin/src/i18n/api/en.ts: missing key 'plain' (defined in ro)"], 2)


def test_happy_path_script_entry_point_exits_with_main_status(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    catalogues(tmp_path)
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--root", str(tmp_path)])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(SCRIPT), run_name="__main__")

    assert exit_info.value.code == 0


# The viewer's sixteen catalogues: one word in each language's script, and the six forms of a counted family.
WORDS = {
    "ro": "Straturi",
    "en": "Layers",
    "es": "Capas",
    "fr": "Calques",
    "de": "Ebenen",
    "it": "Livelli",
    "pt": "Camadas",
    "ru": "Слои",
    "uk": "Шари",
    "pl": "Warstwy",
    "tr": "Katmanlar",
    "ar": "الطبقات",
    "hi": "परतें",
    "zh": "图层",
    "ja": "レイヤー",
    "ko": "레이어",
}


def viewer_catalogue(locale: str, change: dict[str, str] | None = None) -> str:
    word = WORDS[locale]
    messages = {"layers.title": word, **{f"photos.count.{form}": f"{{count}} {word}" for form in i18n.PLURAL_FORMS}, **(change or {})}
    entries = "\n".join(f"    '{key}': '{value}'," for key, value in messages.items())
    return f"export const {locale} = {{\n{entries}\n}};\n"


def viewer_tree(root: Path, changes: dict[str, dict[str, str]] | None = None) -> None:
    for locale in i18n.VIEWER_COMPLETE:
        write(root, f"packages/shared/src/i18n/{locale}.ts", viewer_catalogue(locale, (changes or {}).get(locale)), newline=False)


def test_happy_path_the_viewers_sixteen_catalogues_pass(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    viewer_tree(tmp_path)

    assert i18n.main(["--root", str(tmp_path)]) == 0
    assert caplog.messages == ["[i18n] OK: 1 catalogue folder(s), 7 keys, identical in ro and en (the viewer's in 16 languages)"]


def test_bad_path_a_viewer_language_without_its_catalogue(tmp_path: Path) -> None:
    viewer_tree(tmp_path)
    (tmp_path / "packages/shared/src/i18n/ko.ts").unlink()

    problems, _, _ = i18n.check(tmp_path)

    assert problems == ["packages/shared/src/i18n/ko.ts: missing catalogue"]


def test_bad_path_what_a_translation_gets_wrong_is_reported(tmp_path: Path) -> None:
    viewer_tree(
        tmp_path,
        {
            "fr": {"layers.title": "{count, plural, one {Calque}}"},
            "es": {"layers.title": " Capas"},
            "it": {"layers.title": "Livelli\u202b"},
            "de": {"layers.title": "Layers"},
            "ru": {"layers.title": "Sloi", **{f"photos.count.{form}": "{count} Sloi" for form in i18n.PLURAL_FORMS}},
            "ro": {"layers.title": "Ştraturi"},
        },
    )

    problems, _, _ = i18n.check(tmp_path)

    assert problems == [
        "packages/shared/src/i18n/fr.ts: 'layers.title' uses placeholders ['Calque'], ro uses []",
        "packages/shared/src/i18n/ro.ts: Romanian writes ș and ț with a comma below",
        "packages/shared/src/i18n/es.ts: 'layers.title' starts or ends with whitespace",
        "packages/shared/src/i18n/fr.ts: 'layers.title' has a brace outside a {word} placeholder",
        "packages/shared/src/i18n/de.ts: 'layers.title' is the English text",
        "packages/shared/src/i18n/it.ts: 'layers.title' holds a bidi control",
        "packages/shared/src/i18n/ru.ts: fewer than 80 % of its letters are in its script",
    ]


def test_bad_path_a_counted_family_without_all_six_forms(tmp_path: Path) -> None:
    viewer_tree(tmp_path)
    source = tmp_path / "packages/shared/src/i18n/ro.ts"
    source.write_text(source.read_text(encoding="utf-8").replace("    'photos.count.two': '{count} Straturi',\n", ""), encoding="utf-8")

    problems, _, _ = i18n.check(tmp_path)

    assert "packages/shared/src/i18n/ro.ts: 'photos.count' has no 'two' plural form" in problems


@pytest.mark.parametrize(
    ("locale", "key", "value", "english", "untranslated"),
    [
        ("de", "layers.title", "Layers", "Layers", True),
        ("de", "layers.title", "Ebenen", "Layers", False),
        ("pl", "action.menu", "Menu", "Menu", False),
        ("fr", "license.CC-BY-4.0", "CC BY 4.0", "CC BY 4.0", False),
        ("ar", "layers.opacityValue", "{percent}%", "{percent}%", False),
        ("ja", "layers.title", "Layers", None, False),
    ],
)
def test_untranslated_is_english_with_letters_of_its_own(
    locale: str, key: str, value: str, english: str | None, untranslated: bool
) -> None:
    assert i18n.is_untranslated(locale, key, value, english) is untranslated


def test_happy_path_a_catalogue_without_letters_is_in_its_script() -> None:
    assert i18n.script_share("ar", {"value": "{percent}%"}) == 1.0


# The interface's other languages (docs/I18N.md): optional files checked for shape, a completeness report, a strict mode.
FR = """import type { Key } from './ro.js';

export const fr: Readonly<Partial<Record<Key, string>>> = {
    'hello.greeting': 'Bonjour, {name} !',
    'app.title':
        'Bucarest disparue',
};
"""


def test_happy_path_ui_locales_are_the_ones_of_locales_ts() -> None:
    text = (ROOT / "packages/shared/src/i18n/locales.ts").read_text(encoding="utf-8")
    listed = text.split("export const UI_LOCALES = [", 1)[1].split("]", 1)[0]

    assert tuple(code.strip().strip("',") for code in listed.split() if code.strip()) == i18n.UI_LOCALES


def test_happy_path_a_partial_translation_passes_and_is_reported(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    catalogues(tmp_path)
    write(tmp_path, "packages/admin/src/i18n/fr.ts", FR, newline=False)

    assert i18n.main(["--root", str(tmp_path)]) == 0
    assert caplog.messages[0].startswith(
        "[i18n] languages still translating (their missing keys show in English):\n  - fr 2/3 (66 %)\n  - de 0/3 (0 %)"
    )
    assert caplog.messages[-1].startswith("[i18n] OK: 1 catalogue folder(s), 3 keys")


def test_bad_path_what_an_imported_translation_may_not_hold(tmp_path: Path) -> None:
    broken = FR.replace("'Bonjour, {name} !'", "'<b>Bonjour</b>, {nom} '").replace(
        "'app.title':", "'gone.key': 'x',\n    'plain': '{count, plural}',\n    'app.title':"
    )
    catalogues(tmp_path)
    write(tmp_path, "packages/admin/src/i18n/fr.ts", broken, newline=False)

    problems, _, _ = i18n.check(tmp_path)

    assert problems == [
        "packages/admin/src/i18n/fr.ts: extra key 'gone.key' (not in ro)",
        "packages/admin/src/i18n/fr.ts: 'hello.greeting' uses placeholders ['nom'], ro uses ['name']",
        "packages/admin/src/i18n/fr.ts: 'hello.greeting' starts or ends with whitespace",
        "packages/admin/src/i18n/fr.ts: 'plain' has a brace outside a {word} placeholder",
        "packages/admin/src/i18n/fr.ts: 'hello.greeting' holds an HTML tag",
    ]


def test_bad_path_strict_mode_requires_every_language_complete(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    catalogues(tmp_path)
    write(tmp_path, "packages/admin/src/i18n/fr.ts", FR, newline=False)
    monkeypatch.setenv(i18n.STRICT_ENV, "1")

    assert i18n.main(["--root", str(tmp_path)]) == 1
    problems, _, _ = i18n.check(tmp_path, strict=True)
    assert "packages/admin/src/i18n/de.ts: missing catalogue" in problems
    assert i18n.is_strict(False) is True
    monkeypatch.delenv(i18n.STRICT_ENV)
    assert i18n.is_strict(False) is False
    assert i18n.is_strict(True) is True


def test_bad_path_strict_rejects_everything_the_default_mode_rejects(tmp_path: Path) -> None:
    viewer_tree(tmp_path, {"de": {"layers.title": " Ebenen"}, "fr": {"layers.title": "<b>Calques</b>"}})
    write(tmp_path, "packages/shared/src/i18n/nl.ts", "export const nl = {\n    'layers.title': 'Layers',\n};\n", newline=False)

    default, _, _ = i18n.check(tmp_path)
    strict, _, _ = i18n.check(tmp_path, strict=True)

    assert set(default) <= set(strict)
    assert "packages/shared/src/i18n/de.ts: 'layers.title' starts or ends with whitespace" in default
    assert "packages/shared/src/i18n/fr.ts: 'layers.title' holds an HTML tag" in default
    assert "packages/shared/src/i18n/nl.ts: 'layers.title' is the English text" in default
    assert "packages/shared/src/i18n/ur.ts: missing catalogue" in strict
    assert "packages/shared/src/i18n/nl.ts: missing key 'photos.count.one' (defined in ro)" in strict


def test_happy_path_a_viewer_language_being_translated_is_optional_and_may_be_empty(tmp_path: Path) -> None:
    viewer_tree(tmp_path)
    write(
        tmp_path, "packages/shared/src/i18n/fa.ts", "export const fa: Readonly<Partial<Record<MessageKey, string>>> = {};\n", newline=False
    )
    write(tmp_path, "packages/shared/src/i18n/ur.ts", "export const ur = {\n    'photos.count.one': '{count} پرتیں',\n};\n", newline=False)

    problems, _, _ = i18n.check(tmp_path)

    assert problems == []
    assert i18n.completeness(tmp_path)["fa"] == (0, 7)


def test_bad_path_romanian_and_english_never_wrap(tmp_path: Path) -> None:
    catalogues(tmp_path, ro=RO.replace("'app.title': 'București dispărut',", "'app.title':\n        'București dispărut',"))

    problems, _, _ = i18n.check(tmp_path)

    assert "packages/admin/src/i18n/ro.ts:4: not a one-line `'key': 'message',` entry" in problems


def test_bad_path_a_folder_without_its_romanian_source(tmp_path: Path) -> None:
    viewer_tree(tmp_path)
    (tmp_path / "packages/shared/src/i18n/ro.ts").unlink()

    problems, _, _ = i18n.check(tmp_path)

    assert problems == ["packages/shared/src/i18n/ro.ts: missing catalogue"]
