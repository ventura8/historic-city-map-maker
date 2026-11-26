"""check_data_files.py: JSON, GeoJSON, TOML and XML/SVG parse; duplicate JSON keys fail; JSONC is left alone."""

import runpy
import sys
from pathlib import Path

import check_data_files as data
import pytest
from treeutil import write

SCRIPT = Path(data.__file__)


def test_happy_path_valid_files_of_every_kind_pass(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    write(tmp_path, "package.json", '{"name": "x"}')
    write(tmp_path, "seed.geojson", '{"type": "FeatureCollection", "features": []}')
    write(tmp_path, ".firebaserc", '{"projects": {"default": "demo-hcm"}}')
    write(tmp_path, "ruff.toml", 'line-length = 140\n[lint]\nselect = ["E"]')
    write(tmp_path, ".github/badges/coverage.svg", '<svg xmlns="http://www.w3.org/2000/svg"><title>x</title></svg>')
    write(tmp_path, "notes.txt", "{ not data")

    assert data.main(["--root", str(tmp_path)]) == 0
    assert caplog.messages == ["[data] OK: 3 JSON, 1 TOML, 1 XML files parse (no duplicate JSON keys)"]


@pytest.mark.parametrize(
    ("relative", "text", "problem"),
    [
        ("a.json", '{"key": 1, "key": 2}', "duplicate key 'key'"),
        ("b.geojson", '{"type": "Feature",}', "Illegal trailing comma before end of object"),
        ("c.toml", "key = ", "Invalid value"),
        ("d.svg", "<svg><g></svg>", "mismatched tag"),
        ("e.xml", '<!DOCTYPE x [<!ENTITY e "boom">]><x>&e;</x>', "EntitiesForbidden"),
        (".firebaserc", "{", "Expecting property name"),
    ],
)
def test_bad_path_broken_files_are_reported(tmp_path: Path, relative: str, text: str, problem: str) -> None:
    write(tmp_path, relative, text)

    errors, _ = data.check(tmp_path, [relative])

    assert len(errors) == 1
    assert errors[0].startswith(f"{relative}: ")
    assert problem in errors[0]


def test_bad_path_non_utf8_file_is_reported(tmp_path: Path) -> None:
    (tmp_path / "latin1.json").write_bytes(b'{"name": "Bucure\xbati"}')

    errors, _ = data.check(tmp_path, ["latin1.json"])

    assert errors[0].startswith("latin1.json: not UTF-8: ")


def test_happy_path_jsonc_and_missing_files_are_skipped(tmp_path: Path) -> None:
    write(tmp_path, "tsconfig.base.json", "{ // comments are allowed in JSONC\n}")
    write(tmp_path, ".markdownlint-cli2.jsonc", "{ /* JSONC */ }")

    assert data.check(tmp_path, ["tsconfig.base.json", ".markdownlint-cli2.jsonc", "gone.json"]) == ([], {"json": 0, "toml": 0, "xml": 0})


def test_bad_path_main_lists_every_problem(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    write(tmp_path, "a.json", "[1,]")
    write(tmp_path, "b.json", "[]")

    assert data.main(["--root", str(tmp_path), "a.json", "b.json"]) == 1
    assert caplog.messages[0].startswith("[data] FAILED:\n  - a.json: ")


def test_happy_path_script_entry_point_exits_with_main_status(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    write(tmp_path, "a.json", "{}")
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--root", str(tmp_path)])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(SCRIPT), run_name="__main__")

    assert exit_info.value.code == 0
