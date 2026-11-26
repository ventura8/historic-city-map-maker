"""sonar_properties: java.util.Properties parsing (comments, separators, continuations, escapes)."""

from pathlib import Path

import pytest
import sonar_properties as props


def test_happy_path_properties_document_is_parsed_like_java() -> None:
    text = (
        "# comment\n"
        "! also a comment\n"
        "\n"
        "sonar.projectKey=ventura8_x\n"
        "  sonar.sources = a,\\\n"
        "      b , c\n"
        "key\\ with\\ spaces : value\n"
        "tab\\tkey value with \\u0103 and \\n\n"
        "empty=\n"
        "sonar.projectKey=later wins\n"
        "trailing=ends with \\\\\n"
        "dangling=last line \\"
    )

    assert props.parse(text) == {
        "sonar.projectKey": "later wins",
        "sonar.sources": "a,b , c",
        "key with spaces": "value",
        "tab\tkey": "value with \u0103 and \n",
        "empty": "",
        "trailing": "ends with \\",
        "dangling": "last line ",
    }


def test_happy_path_lone_trailing_backslash_is_kept() -> None:
    assert props.unescape("a\\") == "a\\"


def test_happy_path_split_list_trims_and_drops_empty_items() -> None:
    assert props.split_list(" a, ,b ,") == ["a", "b"]


def test_bad_path_malformed_unicode_escape_is_rejected() -> None:
    with pytest.raises(props.PropertiesError, match="malformed"):
        props.parse("key=\\u12")


def test_happy_path_read_parses_a_file(tmp_path: Path) -> None:
    path = tmp_path / "sonar-project.properties"
    path.write_text("a=1\n", encoding="utf-8")

    assert props.read(path) == {"a": "1"}


def test_bad_path_read_reports_a_missing_file(tmp_path: Path) -> None:
    with pytest.raises(props.PropertiesError, match="cannot read"):
        props.read(tmp_path / "missing.properties")
