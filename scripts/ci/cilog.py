"""Logging for the CI scripts: plain message lines on stdout.

The repository bans `print` (ruff T20) as it bans `console.*` in TypeScript: every script logs
through `get_logger(name)`. Lines carry no timestamp or level prefix because the verdict lines
(`[SUCCESS] stage 'static' passed`) are parsed by people, agents and CI logs as they are.
"""

import logging
import sys
from collections.abc import Iterable

_ROOT_NAME = "hcm"


class StdoutHandler(logging.Handler):
    """Writes each record to the *current* `sys.stdout`, so redirection and test capture both work."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            sys.stdout.write(self.format(record) + "\n")
            sys.stdout.flush()
        except OSError, ValueError:
            self.handleError(record)


def get_logger(name: str) -> logging.Logger:
    """The `hcm.<name>` logger; the shared `hcm` parent prints INFO and above, message only."""
    parent = logging.getLogger(_ROOT_NAME)
    if not parent.handlers:
        handler = StdoutHandler()
        handler.setFormatter(logging.Formatter("%(message)s"))
        parent.addHandler(handler)
        parent.setLevel(logging.INFO)
    return parent.getChild(name)


def bullets(items: Iterable[str]) -> str:
    """`items` as an indented `  - item` list, one per line: the body of every gate's FAILED report."""
    return "\n".join(map("  - {}".format, items))
