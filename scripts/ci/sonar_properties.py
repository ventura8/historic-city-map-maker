"""sonar-project.properties, read the way the scanner reads it.

The file is the single source of the analysis scope: the per-file coverage gate
(check_coverage.py) takes its sources, exclusions and report paths from it, and the Sonar report
(sonar_report.py) its organisation, project key and host. Parsing follows
`java.util.Properties.load()`: `#`/`!` comments, `=`/`:`/whitespace separators, backslash line
continuations and escapes (ported from the sibling Fork-Linux check-coverage.py).
"""

import re
from pathlib import Path

PROPERTIES_FILE = "sonar-project.properties"

_ESCAPES = {"t": "\t", "n": "\n", "r": "\r", "f": "\f"}
# Whitespace of the .properties format (space, tab, form feed); line breaks end a line.
_BLANKS = " \t\f"
_UNICODE_ESCAPE = re.compile(r"[0-9a-fA-F]{4}")
_COMMENT_MARKERS = "#!"


class PropertiesError(ValueError):
    """The properties file cannot be read or holds a malformed escape."""


def _continues(line: str) -> bool:
    """True when a physical line ends with an odd number of backslashes."""
    return (len(line) - len(line.rstrip("\\"))) % 2 == 1


def _skippable(stripped: str) -> bool:
    """A blank or comment line, outside a continuation."""
    return not stripped or stripped[0] in _COMMENT_MARKERS


def _accumulate(lines: list[str], pending: str | None, stripped: str) -> str | None:
    """Adds one physical line; returns the logical line still being continued (None when it is complete)."""
    if pending is None and _skippable(stripped):
        return None
    prefix = pending or ""
    if _continues(stripped):
        return prefix + stripped[:-1]
    lines.append(prefix + stripped)
    return None


def logical_lines(text: str) -> list[str]:
    """Continuation lines joined; blank and comment lines dropped."""
    lines: list[str] = []
    pending: str | None = None
    for raw in re.split(r"\r\n|\r|\n", text):
        pending = _accumulate(lines, pending, raw.lstrip(_BLANKS))
    return lines if pending is None else [*lines, pending]


def _escape(text: str, index: int) -> tuple[str, int]:
    """The character an escape starting after the backslash at `index - 1` stands for, and the next index."""
    char = text[index]
    if char != "u":
        return _ESCAPES.get(char, char), index + 1
    digits = text[index + 1 : index + 5]
    if not _UNICODE_ESCAPE.fullmatch(digits):
        raise PropertiesError(f"malformed \\uXXXX escape in {text!r}")
    return chr(int(digits, 16)), index + 5


def unescape(text: str) -> str:
    """Resolves `\\t`, `\\n`, `\\r`, `\\f`, `\\uXXXX` and `\\<char>` escapes."""
    out: list[str] = []
    index = 0
    while index < len(text):
        char = text[index]
        if char == "\\" and index + 1 < len(text):
            char, index = _escape(text, index + 1)
        else:
            index += 1
        out.append(char)
    return "".join(out)


def split_key_value(line: str) -> tuple[str, str]:
    """One logical line split at the first unescaped `=`, `:` or whitespace."""
    index = 0
    while index < len(line) and line[index] not in "=:" + _BLANKS:
        index += 2 if line[index] == "\\" else 1
    rest = line[index:].lstrip(_BLANKS)
    if rest[:1] in ("=", ":"):
        rest = rest[1:].lstrip(_BLANKS)
    return unescape(line[:index]), unescape(rest)


def parse(text: str) -> dict[str, str]:
    """A .properties document as a dict; a later key replaces an earlier one, as in Java."""
    return dict(split_key_value(line) for line in logical_lines(text))


def split_list(value: str) -> list[str]:
    """A comma-separated property value, trimmed, without empty items."""
    return [item.strip() for item in value.split(",") if item.strip()]


def read(path: Path) -> dict[str, str]:
    """The properties of `path`; PropertiesError when it cannot be read."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        raise PropertiesError(f"cannot read {path}: {error.strerror or error}") from error
    return parse(text)
