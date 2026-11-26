#!/usr/bin/env python3
"""Static gate: every text file follows .editorconfig.

The linters of each language check their own files (Prettier the TS/CSS/JSON/YAML, ruff the
Python, shfmt the shell, markdownlint the Markdown); nothing checked the rest: TOML comments,
plain text, `.properties`, extension-less configs, SVG. This gate resolves the .editorconfig
sections for every file exactly as an editor does (the EditorConfig core library, pinned in
scripts/ci/requirements.txt) and enforces the properties that can be checked without a formatter:

* `charset = utf-8`: the file decodes as UTF-8 and has no byte-order mark;
* `end_of_line = lf | crlf`: every line ends that way;
* `insert_final_newline = true`: a non-empty file ends with a newline;
* `trim_trailing_whitespace = true`: no line ends in a space or a tab;
* `indent_style = space`: no line is indented with a tab.

Indent size and line length stay with the language linters, which understand continuation lines
and string literals. Binary files (a NUL byte in the first 8 KiB) are skipped. The file set is
git's minus the shared exclusions (`cirepo`), like every other tree-walking gate.

Ported from the sibling Watch-GPS-Dashboard script. Usage: check_editorconfig.py [--root DIR] [FILE ...]
"""

import argparse
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path

import editorconfig
from cilog import bullets, get_logger
from cirepo import ROOT, repository_files

LOG = get_logger("editorconfig")

BINARY_PROBE = 8192
BOM = b"\xef\xbb\xbf"


def is_binary(data: bytes) -> bool:
    return b"\0" in data[:BINARY_PROBE]


def body_problems(number: int, body: str, *, trim: bool, spaces: bool) -> list[str]:
    """Trailing whitespace and tab indentation of one line (without its line ending)."""
    problems = [f"line {number}: trailing whitespace"] if trim and body != body.rstrip(" \t") else []
    if spaces and body.startswith("\t"):
        problems.append(f"line {number}: indented with a tab (indent_style = space)")
    return problems


def line_problems(text: str, props: Mapping[str, str]) -> list[str]:
    trim = props.get("trim_trailing_whitespace") == "true"
    spaces = props.get("indent_style") == "space"
    lines = enumerate(text.split("\n"), start=1)
    return [problem for number, line in lines for problem in body_problems(number, line.removesuffix("\r"), trim=trim, spaces=spaces)]


def eol_problem(data: bytes, style: str | None) -> str | None:
    if style == "lf" and b"\r" in data:
        return "CR line ending (end_of_line = lf)"
    if style == "crlf" and data.count(b"\n") != data.count(b"\r\n"):
        return "LF line ending without CR (end_of_line = crlf)"
    return None


def bom_problem(data: bytes, props: Mapping[str, str]) -> str | None:
    return "UTF-8 byte-order mark (charset = utf-8)" if props.get("charset") == "utf-8" and data.startswith(BOM) else None


def final_newline_problem(data: bytes, props: Mapping[str, str]) -> str | None:
    missing = props.get("insert_final_newline") == "true" and data and not data.endswith(b"\n")
    return "no final newline (insert_final_newline = true)" if missing else None


def byte_problems(data: bytes, props: Mapping[str, str]) -> list[str]:
    """Problems visible in the raw bytes: byte-order mark, line endings, final newline."""
    found = (bom_problem(data, props), eol_problem(data, props.get("end_of_line")), final_newline_problem(data, props))
    return [problem for problem in found if problem]


def check_bytes(data: bytes, props: Mapping[str, str]) -> list[str]:
    """Every .editorconfig violation of one file's content, given its resolved properties."""
    if is_binary(data):
        return []
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as error:
        return [f"not UTF-8: {error}"]
    return byte_problems(data, props) + line_problems(text, props)


def file_properties(path: Path) -> Mapping[str, str] | None:
    """The .editorconfig properties of a regular file, or None (symlink, missing, or no section applies)."""
    if not path.is_file() or path.is_symlink():
        return None
    return editorconfig.get_properties(str(path.resolve())) or None


def check(root: Path, names: Sequence[str]) -> tuple[list[str], int]:
    """(problems, files checked) for `names` (relative to root); symlinks and missing files are skipped."""
    errors: list[str] = []
    checked = 0
    for name in names:
        props = file_properties(root / name)
        if props is None:
            continue
        checked += 1
        errors.extend(f"{name}: {problem}" for problem in check_bytes((root / name).read_bytes(), props))
    return errors, checked


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check every text file against .editorconfig.")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    parser.add_argument("files", nargs="*", help="files relative to the root (default: every repository file)")
    args = parser.parse_args(argv)
    root: Path = args.root
    errors, checked = check(root, args.files or repository_files(root))
    if errors:
        LOG.error("[editorconfig] FAILED:\n%s", bullets(errors))
        return 1
    LOG.info("[editorconfig] OK: %d files follow .editorconfig", checked)
    return 0


if __name__ == "__main__":
    sys.exit(main())
