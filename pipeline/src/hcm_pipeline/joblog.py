"""The job log: `cities/{city}/jobs/{job}/logs/{seq}` and Cloud Logging, both redacted (M3-interfaces §4.4).

One line per step start and end, every wait and failure, at most 500 per job (`seq` zero-padded to 6 digits). Each
message passes through the pipeline's redactor first (signed URLs, tokens, keys, URL queries), and an e-mail address
is masked too, so the same text reaches Firestore and Cloud Logging. A later run of the same job (a resume)
continues after the lines already there; a line that finds its number taken moves to the next one.
"""

import logging
import re
from collections.abc import Callable
from typing import Final

from hcm_pipeline.documents import log_id, log_line
from hcm_pipeline.log import fields, redact
from hcm_pipeline.model import Timestamp
from hcm_pipeline.store import DocumentStore

MAX_LINES: Final = 500
CREATE_ATTEMPTS: Final = 3
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_LEVELS: Final = {"info": logging.INFO, "warn": logging.WARNING, "error": logging.ERROR}


def scrub(message: str) -> str:
    """`message` redacted for a job log: secrets, signed-URL queries and e-mail addresses removed."""
    return _EMAIL.sub("[EMAIL]", redact(message))


class JobLog:
    def __init__(self, store: DocumentStore, collection: str, clock: Callable[[], float], logger: logging.Logger) -> None:
        self._store = store
        self._collection = collection
        self._clock = clock
        self._logger = logger
        self._next: int | None = None

    def _sequence(self) -> int:
        if self._next is None:
            self._next = len(self._store.list_ids(self._collection))
        return self._next

    def write(self, level: str, message: str, step: str | None = None) -> None:
        text = scrub(message)
        self._logger.log(_LEVELS[level], text, extra=fields(step=step))
        for _ in range(CREATE_ATTEMPTS):
            seq = self._sequence()
            if seq >= MAX_LINES:
                return
            self._next = seq + 1
            if self._store.create(f"{self._collection}/{log_id(seq)}", log_line(seq, level, text, Timestamp.at(self._clock()), step)):
                return

    def info(self, message: str, step: str | None = None) -> None:
        self.write("info", message, step)

    def warn(self, message: str, step: str | None = None) -> None:
        self.write("warn", message, step)

    def error(self, message: str, step: str | None = None) -> None:
        self.write("error", message, step)
