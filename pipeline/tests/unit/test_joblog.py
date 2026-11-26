"""Unit tests for the job log: scrubbed messages, bounded lines, and Firestore persistence."""

import logging
from typing import Final

import pytest
from hcm_pipeline.documents import log_id
from hcm_pipeline.joblog import CREATE_ATTEMPTS, MAX_LINES, JobLog, scrub
from hcm_pipeline.model import Timestamp

from tests.fakes.documents import MemoryStore

LOGS: Final = "cities/bucharest/jobs/job-1/logs"
EPOCH: Final = 1792000000.0
NOW: Final = Timestamp(1792000000)


class LogSpy(logging.Handler):
    """A test logging handler that records emitted LogRecords in memory."""

    def __init__(self) -> None:
        super().__init__()
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


def make_logger(name: str) -> tuple[logging.Logger, LogSpy]:
    logger = logging.getLogger(name)
    logger.setLevel(logging.DEBUG)
    logger.propagate = False
    spy = LogSpy()
    logger.handlers = [spy]
    return logger, spy


def test_happy_path_scrub_redacts_secrets_and_masks_emails() -> None:
    raw = "GET https://dds.cr.usgs.gov/download.tgz?sig=secret123&id=1 by user.name+tag@example.com with X-Auth-Token: secret-token-456"
    scrubbed = scrub(raw)
    assert scrubbed == ("GET https://dds.cr.usgs.gov/download.tgz?[REDACTED] by [EMAIL] with X-Auth-Token: [REDACTED]")


def test_bad_path_scrub_leaves_unmatched_symbols_and_plain_text_untouched() -> None:
    assert scrub("status ok without secrets or emails") == "status ok without secrets or emails"
    assert scrub("mention @moderator on localhost or server:8080") == "mention @moderator on localhost or server:8080"
    assert scrub("") == ""


def test_happy_path_write_stores_entry_and_forwards_to_logger() -> None:
    store = MemoryStore()
    store.seed(f"{LOGS}/000000", {"seq": 0, "message": "prior line"})
    logger, spy = make_logger("test.joblog.write.happy")
    log = JobLog(store, LOGS, lambda: EPOCH, logger)

    log.write("info", "Starting step for user@example.com with token=abc", step="fetch")

    expected_message = "Starting step for [EMAIL] with token=[REDACTED]"
    assert store.get(f"{LOGS}/000001") == {
        "seq": 1,
        "level": "info",
        "step": "fetch",
        "message": expected_message,
        "updatedBy": "system:pipeline",
        "updatedAt": NOW,
    }
    assert len(spy.records) == 1
    assert spy.records[0].levelno == logging.INFO
    assert spy.records[0].getMessage() == expected_message
    assert spy.records[0].__dict__["fields"] == {"step": "fetch"}


def test_bad_path_write_refuses_unknown_log_level() -> None:
    store = MemoryStore()
    logger, spy = make_logger("test.joblog.write.bad")
    log = JobLog(store, LOGS, lambda: EPOCH, logger)

    with pytest.raises(KeyError):
        log.write("fatal", "unsupported level message")

    assert len(store.list_ids(LOGS)) == 0
    assert len(spy.records) == 0


def test_happy_path_info_writes_info_level_record_with_step() -> None:
    store = MemoryStore()
    logger, spy = make_logger("test.joblog.info.happy")
    log = JobLog(store, LOGS, lambda: EPOCH, logger)

    log.info("scene ready", step="prepare")

    assert store.get(f"{LOGS}/000000") == {
        "seq": 0,
        "level": "info",
        "step": "prepare",
        "message": "scene ready",
        "updatedBy": "system:pipeline",
        "updatedAt": NOW,
    }
    assert len(spy.records) == 1
    assert spy.records[0].levelno == logging.INFO
    assert spy.records[0].__dict__["fields"] == {"step": "prepare"}


def test_bad_path_info_drops_line_when_max_lines_limit_reached() -> None:
    store = MemoryStore()
    for seq in range(MAX_LINES):
        store.seed(f"{LOGS}/{log_id(seq)}", {"seq": seq})
    logger, spy = make_logger("test.joblog.info.bad")
    log = JobLog(store, LOGS, lambda: EPOCH, logger)

    log.info("overflow entry", step="overflow")

    assert len(store.list_ids(LOGS)) == MAX_LINES
    assert store.get(f"{LOGS}/{log_id(MAX_LINES)}") is None
    assert len(spy.records) == 1
    assert spy.records[0].getMessage() == "overflow entry"


def test_happy_path_warn_writes_warning_level_record() -> None:
    store = MemoryStore()
    logger, spy = make_logger("test.joblog.warn.happy")
    log = JobLog(store, LOGS, lambda: EPOCH, logger)

    log.warn("disk space low")

    assert store.get(f"{LOGS}/000000") == {
        "seq": 0,
        "level": "warn",
        "message": "disk space low",
        "updatedBy": "system:pipeline",
        "updatedAt": NOW,
    }
    assert len(spy.records) == 1
    assert spy.records[0].levelno == logging.WARNING
    assert spy.records[0].__dict__["fields"] == {"step": None}


def test_bad_path_warn_retries_and_skips_occupied_sequence_slots() -> None:
    store = MemoryStore()
    store.seed(f"{LOGS}/000000", {"seq": 0, "message": "occupied slot 0"})
    store.seed(f"{LOGS}/000001", {"seq": 1, "message": "occupied slot 1"})
    logger, _ = make_logger("test.joblog.warn.bad")
    log = JobLog(store, LOGS, lambda: EPOCH, logger)
    log._next = 0

    log.warn("contended write")

    assert (store.get(f"{LOGS}/000000") or {}).get("message") == "occupied slot 0"
    assert (store.get(f"{LOGS}/000001") or {}).get("message") == "occupied slot 1"
    assert store.get(f"{LOGS}/000002") == {
        "seq": 2,
        "level": "warn",
        "message": "contended write",
        "updatedBy": "system:pipeline",
        "updatedAt": NOW,
    }


def test_happy_path_error_writes_error_level_record() -> None:
    store = MemoryStore()
    logger, spy = make_logger("test.joblog.error.happy")
    log = JobLog(store, LOGS, lambda: EPOCH, logger)

    log.error("georeferencing failed", step="align")

    assert store.get(f"{LOGS}/000000") == {
        "seq": 0,
        "level": "error",
        "step": "align",
        "message": "georeferencing failed",
        "updatedBy": "system:pipeline",
        "updatedAt": NOW,
    }
    assert len(spy.records) == 1
    assert spy.records[0].levelno == logging.ERROR
    assert spy.records[0].__dict__["fields"] == {"step": "align"}


def test_bad_path_error_drops_line_when_all_create_attempts_fail() -> None:
    store = MemoryStore()
    for seq in range(CREATE_ATTEMPTS):
        store.seed(f"{LOGS}/{log_id(seq)}", {"seq": seq, "message": f"existing {seq}"})
    logger, spy = make_logger("test.joblog.error.bad")
    log = JobLog(store, LOGS, lambda: EPOCH, logger)
    log._next = 0

    log.error("lost message", step="fatal")

    assert [(store.get(f"{LOGS}/{log_id(seq)}") or {}).get("message") for seq in range(CREATE_ATTEMPTS)] == [
        f"existing {seq}" for seq in range(CREATE_ATTEMPTS)
    ]
    assert store.get(f"{LOGS}/{log_id(CREATE_ATTEMPTS)}") is None
    assert len(spy.records) == 1
    assert spy.records[0].getMessage() == "lost message"
