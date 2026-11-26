"""Redacted JSON logging: what reaches Cloud Logging never contains a secret."""

import io
import json
import logging
import string

import pytest
from hcm_pipeline.log import REDACTED, ROOT_LOGGER, configure, fields, get_logger, redact, redact_fields
from hypothesis import given
from hypothesis import strategies as st

SECRET = "s3cr3tVALUE"
# Base64 of {"u":"redaction-test","a":" - a fake Mapbox payload, kept apart from the "sk." prefix so no
# token-shaped literal sits in the source for secret scanners to flag.
FAKE_MAPBOX_PAYLOAD = "eyJ1IjoicmVkYWN0aW9uLXRlc3QiLCJhIjoi"
TOKENS = st.text(alphabet=string.ascii_letters + string.digits + "._-", min_size=12, max_size=64)


def read_entries(stream: io.StringIO, logger: str) -> list[dict[str, object]]:
    """The entries `logger` wrote. Only its own: a daemon thread an earlier test left running (a worker's local page, a
    fake server) may still log through the same configured handler while this test runs, which once made a test that
    expected exactly one line see two."""
    entries = [json.loads(line) for line in stream.getvalue().splitlines()]
    return [entry for entry in entries if entry["logger"] == logger]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (f"X-Auth-Token: {SECRET}", f"X-Auth-Token: {REDACTED}"),
        (f"x-auth-token={SECRET}", f"x-auth-token={REDACTED}"),
        (f"POST body access_token={SECRET}&expires_in=3599", f"POST body access_token={REDACTED}&expires_in=3599"),
        (f"Authorization: Bearer {SECRET}", f"Authorization: {REDACTED}"),
        (f'{{"username": "ers-user", "token": "{SECRET}"}}', f'{{"username": "ers-user", "token": "{REDACTED}"}}'),
        (f"{{'apiKey': '{SECRET}'}}", f"{{'apiKey': '{REDACTED}'}}"),
        (f"Credentials(token='{SECRET}')", f"Credentials(token={REDACTED})"),
        (f'password="{SECRET} with spaces"', f"password={REDACTED}"),
        (
            f"GET https://dds.cr.usgs.gov/download/AR5840034165133.tgz?X-Amz-Signature={SECRET}&id=1 done",
            f"GET https://dds.cr.usgs.gov/download/AR5840034165133.tgz?{REDACTED} done",
        ),
        (f"token sk.{FAKE_MAPBOX_PAYLOAD}.{SECRET}x in prose", f"token sk.{REDACTED} in prose"),
        (f"path /download-staging/eyJpZCI6MTIzLCJ0eXAiOiJkbCJ9.{SECRET} ok", f"path /download-staging/{REDACTED} ok"),
    ],
)
def test_happy_path_redact_hides_every_secret_shape(text: str, expected: str) -> None:
    assert redact(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "the login token expired after 2 hours",
        "scene AR5840034165133 has 4 segments",
        "https://m2m.cr.usgs.gov/api/api/json/stable/scene-search",
        '{"tokenCount": 3}',
    ],
)
def test_happy_path_redact_leaves_ordinary_text_alone(text: str) -> None:
    assert redact(text) == text


@given(token=TOKENS)
def test_happy_path_redact_never_leaks_a_header_query_or_json_secret(token: str) -> None:
    samples = [
        f"X-Auth-Token: {token}",
        f"https://storage.googleapis.com/bucket/raw.tgz?X-Goog-Signature={token}",
        json.dumps({"username": "ers-user", "token": token}),
        f"retrying with access_token={token};",
    ]

    for sample in samples:
        assert token not in redact(sample)


def test_happy_path_redact_fields_hides_secret_keys_and_redacts_values() -> None:
    class SignedUrl:
        def __str__(self) -> str:
            return f"https://example.invalid/file?sig={SECRET}"

    redacted = redact_fields(
        {
            "apiKey": SECRET,
            "nested": {"usgsToken": SECRET, "entityId": "AR5840034165133"},
            "urls": [f"https://example.invalid/a?sig={SECRET}", 3],
            "url": SignedUrl(),
            "count": 4,
            "ratio": 0.5,
            "done": True,
            "missing": None,
        }
    )

    assert redacted == {
        "apiKey": REDACTED,
        "nested": {"usgsToken": REDACTED, "entityId": "AR5840034165133"},
        "urls": [f"https://example.invalid/a?{REDACTED}", 3],
        "url": f"https://example.invalid/file?{REDACTED}",
        "count": 4,
        "ratio": 0.5,
        "done": True,
        "missing": None,
    }


def test_happy_path_log_lines_are_cloud_logging_json() -> None:
    stream = io.StringIO()
    configure(stream)

    get_logger("m2m").warning("retry %s", f"X-Auth-Token: {SECRET}", extra=fields(entityId="AR1", message="ignored"))

    [entry] = read_entries(stream, f"{ROOT_LOGGER}.m2m")
    assert entry["severity"] == "WARNING"
    assert entry["message"] == f"retry X-Auth-Token: {REDACTED}"
    assert entry["logger"] == f"{ROOT_LOGGER}.m2m"
    assert entry["entityId"] == "AR1"
    assert str(entry["time"]).endswith("Z")


def test_happy_path_exception_text_is_redacted() -> None:
    stream = io.StringIO()
    log = configure(stream)

    try:
        raise RuntimeError(f"login failed with token={SECRET}")
    except RuntimeError:
        log.exception("step crashed")

    [entry] = read_entries(stream, ROOT_LOGGER)
    assert "RuntimeError" in str(entry["exception"])
    assert SECRET not in stream.getvalue()


def test_happy_path_configure_twice_does_not_double_lines() -> None:
    stream = io.StringIO()
    configure(io.StringIO())
    log = configure(stream, logging.DEBUG)

    log.debug("once")

    assert [entry["message"] for entry in read_entries(stream, ROOT_LOGGER)] == ["once"]


def test_happy_path_configure_defaults_to_stderr(capsys: pytest.CaptureFixture[str]) -> None:
    configure()

    get_logger("main").info("hello")

    entries = [json.loads(line) for line in capsys.readouterr().err.splitlines()]
    assert [entry["message"] for entry in entries if entry["logger"] == f"{ROOT_LOGGER}.main"] == ["hello"]


def test_bad_path_fields_that_are_not_a_mapping_are_ignored() -> None:
    stream = io.StringIO()
    configure(stream)

    get_logger("main").info("plain", extra={"fields": "not a mapping"})

    [entry] = read_entries(stream, f"{ROOT_LOGGER}.main")
    assert set(entry) == {"severity", "message", "logger", "time"}


def test_bad_path_records_never_reach_the_root_loggers_handlers() -> None:
    received: list[logging.LogRecord] = []

    class Collector(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            received.append(record)

    collector = Collector()
    logging.getLogger().addHandler(collector)
    try:
        configure(io.StringIO())
        get_logger("main").warning(f"X-Auth-Token: {SECRET}")
    finally:
        logging.getLogger().removeHandler(collector)

    assert received == []
    assert logging.getLogger(ROOT_LOGGER).propagate is False


def test_happy_path_redact_hides_the_local_workers_refresh_and_id_tokens() -> None:
    """M7: the worker holds a Firebase refresh token (`AMf-v...`) and ID token (a JWT); neither shape survives a log line."""
    refresh = "AMf-vBz" + "Q1w2E3r4T5y6" * 10
    oauth = "1//0g" + "abcDEF123_-" * 4
    long_key = "k" * 120

    text = redact(f"refresh {refresh} oauth {oauth} other {long_key} step fetch done")

    assert refresh[:12] not in text
    assert oauth[:8] not in text
    assert long_key not in text
    assert text == f"refresh {REDACTED} oauth {REDACTED} other {REDACTED} step fetch done"
