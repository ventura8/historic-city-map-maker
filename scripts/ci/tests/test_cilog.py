"""cilog: message-only lines on the current stdout, one handler however often it is asked for."""

import logging

import pytest
from cilog import StdoutHandler, bullets, get_logger


def test_happy_path_logger_writes_message_lines_to_stdout(capsys: pytest.CaptureFixture[str]) -> None:
    get_logger("unit").info("static 1/2 %s", "prettier")

    assert capsys.readouterr().out == "static 1/2 prettier\n"


def test_happy_path_loggers_share_one_handler() -> None:
    first = get_logger("a")
    second = get_logger("b")

    assert first.parent is second.parent
    assert first.name == "hcm.a"
    assert len(logging.getLogger("hcm").handlers) == 1


def test_happy_path_debug_is_below_the_default_level(capsys: pytest.CaptureFixture[str]) -> None:
    get_logger("quiet").debug("hidden")

    assert capsys.readouterr().out == ""


class _BrokenStream:
    def write(self, _text: str) -> int:
        raise ValueError("I/O operation on closed file")

    def flush(self) -> None:
        raise AssertionError("not reached")


def test_bad_path_closed_stdout_is_reported_not_raised(monkeypatch: pytest.MonkeyPatch) -> None:
    handled: list[logging.LogRecord] = []
    handler = StdoutHandler()
    monkeypatch.setattr(handler, "handleError", handled.append)
    monkeypatch.setattr("sys.stdout", _BrokenStream())
    record = logging.LogRecord("hcm.test", logging.INFO, __file__, 1, "lost", None, None)

    handler.emit(record)

    assert handled == [record]


def test_happy_path_bullets_list_one_item_per_line() -> None:
    assert bullets(["a", "b"]) == "  - a\n  - b"
    assert bullets([]) == ""
