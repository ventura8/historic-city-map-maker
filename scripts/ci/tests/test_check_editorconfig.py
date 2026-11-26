"""check_editorconfig.py: charset, line endings, final newline, trailing whitespace and tab indents."""

import runpy
import sys
from pathlib import Path

import check_editorconfig as ec
import pytest
from treeutil import write

SCRIPT = Path(ec.__file__)
EDITORCONFIG = """root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false

[*.sh]
indent_style = tab

[*.bat]
end_of_line = crlf
"""
LF_PROPS = {
    "charset": "utf-8",
    "end_of_line": "lf",
    "insert_final_newline": "true",
    "trim_trailing_whitespace": "true",
    "indent_style": "space",
}


def tree(root: Path) -> Path:
    write(root, ".editorconfig", EDITORCONFIG, newline=False)
    return root


def test_happy_path_conforming_files_pass(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    tree(tmp_path)
    write(tmp_path, "a.toml", 'key = "value"')
    write(tmp_path, "notes.md", "Hard break  \nnext line")
    write(tmp_path, "run.sh", "main() {\n\ttrue\n}")
    (tmp_path / "win.bat").write_bytes(b"echo off\r\n")
    (tmp_path / "image.png").write_bytes(b"\x89PNG\0\0\0 \t")
    (tmp_path / "empty.txt").write_bytes(b"")

    assert ec.main(["--root", str(tmp_path)]) == 0
    assert caplog.messages == ["[editorconfig] OK: 7 files follow .editorconfig"]


@pytest.mark.parametrize(
    ("data", "problems"),
    [
        (b"\xef\xbb\xbfkey = 1\n", ["UTF-8 byte-order mark (charset = utf-8)"]),
        (b"key = 1\r\n", ["CR line ending (end_of_line = lf)"]),
        (b"key = 1", ["no final newline (insert_final_newline = true)"]),
        (b"key = 1 \n\tother = 2\n", ["line 1: trailing whitespace", "line 2: indented with a tab (indent_style = space)"]),
        (b"caf\xe9\n", ["not UTF-8: 'utf-8' codec can't decode byte 0xe9 in position 3: invalid continuation byte"]),
    ],
)
def test_bad_path_violations_are_reported(data: bytes, problems: list[str]) -> None:
    assert ec.check_bytes(data, LF_PROPS) == problems


def test_bad_path_crlf_file_with_a_bare_lf_is_reported() -> None:
    assert ec.check_bytes(b"a\r\nb\n", {"end_of_line": "crlf"}) == ["LF line ending without CR (end_of_line = crlf)"]


def test_happy_path_symlinks_missing_files_and_unconfigured_files_are_skipped(tmp_path: Path) -> None:
    write(tmp_path, "target.txt", "x")
    (tmp_path / "link.txt").symlink_to(tmp_path / "target.txt")

    assert ec.check(tmp_path, ["link.txt", "gone.txt", "target.txt"]) == ([], 0)


def test_bad_path_main_lists_every_problem(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    tree(tmp_path)
    write(tmp_path, "a.txt", "trailing ")

    assert ec.main(["--root", str(tmp_path), "a.txt"]) == 1
    assert caplog.messages == ["[editorconfig] FAILED:\n  - a.txt: line 1: trailing whitespace"]


def test_happy_path_script_entry_point_exits_with_main_status(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    tree(tmp_path)
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--root", str(tmp_path)])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(SCRIPT), run_name="__main__")

    assert exit_info.value.code == 0
