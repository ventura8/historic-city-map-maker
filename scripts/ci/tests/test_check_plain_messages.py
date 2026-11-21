"""check_plain_messages.py: generic, jargon and code messages on screen, and generic log lines."""

import runpy
import sys
from pathlib import Path

import check_plain_messages as plain
import pytest
from treeutil import write

SCRIPT = Path(plain.__file__)


def catalogue(root: Path, entries: str, folder: str = "i18n", package: str = "shared") -> None:
    for locale in ("ro", "en"):
        write(root, f"packages/{package}/src/{folder}/{locale}.ts", f"export const {locale} = {{\n{entries}}} as const;\n", newline=False)


GOOD = """    'photo.tooLarge': 'The photo is over 40 MB, the limit. Make it smaller and add it again.',
    'jobs.status.failed': 'Failed',
"""


def test_happy_path_plain_messages_and_status_labels_pass(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    catalogue(tmp_path, GOOD)
    catalogue(tmp_path, "    'setup.token': 'Create the token in Mapbox.',\n", folder="i18n/admin-setup")
    write(tmp_path, "functions/src/a.ts", "log.warn('photo refused: over the size limit', { photoId });\n")

    assert plain.main(["--root", str(tmp_path)]) == 0
    assert caplog.messages[-1].endswith("every message says what happened in plain words")


def test_bad_path_generic_jargon_and_codes_are_reported(tmp_path: Path) -> None:
    catalogue(
        tmp_path,
        """    'error.generic': 'Something went wrong.',
    'save.error': 'Error',
    'tiles.missing': 'No tiles here (404).',
    'server.refused': 'Refused: apiError.internal',
    'viewer.token': 'The map token is missing.',
    'limit.hit': 'Quota exceeded',
""",
    )
    write(tmp_path, "packages/ui/src/b.ts", "    this.#log.error('Unknown error');\n")

    problems = [*plain.catalogue_problems(tmp_path), *plain.logger_problems(tmp_path)]

    keys = [problem.split(": ")[1].split(" ")[0] for problem in problems if "the log says" not in problem]
    assert "error.generic" in keys
    assert "save.error" in keys
    assert keys.count("tiles.missing") == 2
    assert keys.count("server.refused") == 2
    assert keys.count("viewer.token") == 2
    assert keys.count("limit.hit") == 2
    assert problems[-1].startswith("packages/ui/src/b.ts:1: the log says only 'Unknown error'")
    assert plain.main(["--root", str(tmp_path)]) == 1


def test_bad_path_a_missing_locale_file_is_left_to_the_i18n_gate(tmp_path: Path) -> None:
    write(tmp_path, "packages/shared/src/i18n/ro.ts", "export const ro = {\n    'a.b': 'Error',\n} as const;\n", newline=False)

    assert list(plain.catalogue_problems(tmp_path)) == [
        "packages/shared/src/i18n/ro.ts: a.b is only a generic phrase ('Error'): say what happened, why and the fix"
    ]


def test_happy_path_script_entry_point_exits_with_main_status(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    catalogue(tmp_path, GOOD)
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--root", str(tmp_path)])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(SCRIPT), run_name="__main__")

    assert exit_info.value.code == 0
