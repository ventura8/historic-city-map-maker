"""Structured JSON logging for Cloud Logging, with every secret redacted before it is written.

Cloud Run turns each output line that is a JSON object into a structured entry: `severity`, `message`
and `time` are recognised, every other key lands in `jsonPayload`. Every record passes through
`redact()` (the message, the exception text and the values given with `extra=fields(...)`), so the
USGS app token and API key (`X-Auth-Token`), `access_token=` values, Mapbox tokens, JWTs (a Firebase ID token), refresh
tokens (the local worker's, M7) and the query strings of signed download URLs never reach the job logs or `jobs/{id}/logs`
(docs/research/design-review-security-cost.md §1.2 and §4.6). Over-redaction is the safe side.

    log = configure()                                   # once, in main
    LOG = get_logger("m2m")                             # per module: the `hcm_pipeline.m2m` logger
    LOG.info("scene ready", extra=fields(entityId="AR5840034165133"))
"""

import json
import logging
import re
import sys
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Final, TextIO

ROOT_LOGGER: Final = "hcm_pipeline"
REDACTED: Final = "[REDACTED]"
FIELDS_ATTRIBUTE: Final = "fields"

# A key whose value is a secret wherever it appears: JSON members, headers, query and form parameters,
# keyword arguments, structured fields. `tokenExpiresAt` is redacted too: over-redaction is the safe side.
_SENSITIVE = r"(?:token|secret|password|passwd|api[_-]?key|authorization|signature|credential)"
_SENSITIVE_KEY = re.compile(_SENSITIVE, re.IGNORECASE)
_NAME = rf"[\w.-]*{_SENSITIVE}[\w.-]*"
# A value: a double- or single-quoted string, or a bare run up to a separator.
_VALUE = r"""(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&"'<>)}\]]+)"""

_RULES: Final[tuple[tuple[re.Pattern[str], str], ...]] = (
    # Signed URLs (USGS downloads, GCS, S3): the whole query string goes; the path stays for debugging.
    (re.compile(r"(\bhttps?://[^\s?#\"'<>]+)\?[^\s#\"'<>]*", re.IGNORECASE), rf"\1?{REDACTED}"),
    # JSON or Python-repr members: "token": "value", 'apiKey': 'value'.
    (re.compile(rf"([\"']{_NAME}[\"']\s*:\s*)([\"'])(?:\\.|(?!\2).)*\2", re.IGNORECASE), rf"\1\2{REDACTED}\2"),
    # Headers, query/form parameters and assignments: X-Auth-Token: v, access_token=v, Authorization: Bearer v.
    (re.compile(rf"(\b{_NAME}\s*[:=]\s*)(?:(?:bearer|basic)\s+)?{_VALUE}", re.IGNORECASE), rf"\1{REDACTED}"),
    # Mapbox tokens in free text: sk./pk./tk. followed by a JWT-like body.
    (re.compile(r"\b([spt]k)\.[\w-]{20,}(?:\.[\w-]+){1,2}"), rf"\1.{REDACTED}"),
    # Any other JWT or base64-encoded JSON blob (`eyJ...`), e.g. inside a signed download path, and so a Firebase ID token.
    (re.compile(r"\beyJ[\w-]{16,}(?:\.[\w-]+)*"), REDACTED),
    # The local worker's Firebase refresh token (M7: `AMf-v...`), a Google OAuth refresh token (`1//0...`), and any other
    # run of 100 or more base64url characters (no word of a log line is that long; a token or a key is).
    (re.compile(r"\b(?:AMf-v|1//0)[\w/-]{20,}"), REDACTED),
    (re.compile(r"[\w-]{100,}"), REDACTED),
)

_SCALARS = (bool, int, float, type(None))


def redact(text: str) -> str:
    """`text` with every secret replaced by [REDACTED]."""
    for pattern, replacement in _RULES:
        text = pattern.sub(replacement, text)
    return text


def redact_fields(values: Mapping[str, object]) -> dict[str, object]:
    """Structured values, redacted: a secret-looking key hides its whole value, strings are redact()ed."""
    return {str(key): _redact_value(str(key), value) for key, value in values.items()}


def _redact_value(key: str, value: object) -> object:
    if _SENSITIVE_KEY.search(key):
        return REDACTED
    if isinstance(value, Mapping):
        return redact_fields(value)
    if isinstance(value, list | tuple):
        return _redact_items(key, value)
    # Anything that is not a JSON scalar is logged as its redacted text (a URL object, a Path, ...).
    return value if isinstance(value, _SCALARS) else redact(str(value))


def _redact_items(key: str, items: Sequence[object]) -> list[object]:
    return [_redact_value(key, item) for item in items]


def fields(**values: object) -> dict[str, object]:
    """`extra=` for a log call: structured values that become top-level keys of the JSON entry."""
    return {FIELDS_ATTRIBUTE: values}


def _record_fields(record: logging.LogRecord) -> Mapping[str, object]:
    values = getattr(record, FIELDS_ATTRIBUTE, None)
    return values if isinstance(values, Mapping) else {}


def _timestamp(created: float) -> str:
    return datetime.fromtimestamp(created, UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class JsonFormatter(logging.Formatter):
    """One redacted JSON object per line, in the Cloud Logging structured-log format."""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, object] = {
            **redact_fields(_record_fields(record)),
            "severity": record.levelname,
            "message": redact(record.getMessage()),
            "logger": record.name,
            "time": _timestamp(record.created),
        }
        if record.exc_info:
            entry["exception"] = redact(self.formatException(record.exc_info))
        return json.dumps(entry, ensure_ascii=False)


class _PipelineHandler(logging.StreamHandler[TextIO]):
    """The handler configure() installs; a second configure() replaces it instead of doubling every line."""


def configure(stream: TextIO | None = None, level: int = logging.INFO) -> logging.Logger:
    """Sends the `hcm_pipeline` loggers to `stream` (default: stderr) as redacted JSON lines; returns the root logger."""
    root = logging.getLogger(ROOT_LOGGER)
    for handler in list(root.handlers):
        if isinstance(handler, _PipelineHandler):
            root.removeHandler(handler)
    handler = _PipelineHandler(sys.stderr if stream is None else stream)
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    root.setLevel(level)
    return root


def get_logger(name: str) -> logging.Logger:
    """The `hcm_pipeline.<name>` logger."""
    return logging.getLogger(ROOT_LOGGER).getChild(name)


# Nothing leaves the `hcm_pipeline` loggers except through configure()'s redacting handler: no
# propagation to the root logger (another library's handler would print unredacted text), and a
# NullHandler so Python's last-resort stderr handler never prints a record before configure() runs.
logging.getLogger(ROOT_LOGGER).addHandler(logging.NullHandler())
logging.getLogger(ROOT_LOGGER).propagate = False
