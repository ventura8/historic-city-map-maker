"""The project's Firebase web configuration, read from Hosting at run time (docs/research/M7-local-worker.md §2.1).

`https://<project>.web.app/__/firebase/init.json` (under the emulators the loopback host that serves it): the web API
key the token refresh needs and what the local page initialises the Firebase JS SDK with. It is fetched by the worker
(the page reads it from the worker, same origin), checked to name the project of the command line, kept in memory and
never stored or logged.
"""

import re
import threading
from collections.abc import Mapping
from typing import Final

import httpx

# The keys the page needs; every value a short text of safe characters.
KEYS: Final = ("apiKey", "authDomain", "projectId", "appId")
_VALUE: Final = re.compile(r"[A-Za-z0-9_.:-]{1,200}")


class WebConfigError(RuntimeError):
    """The web configuration could not be read, or it is not this project's."""


def _usable(value: object) -> bool:
    return isinstance(value, str) and _VALUE.fullmatch(value) is not None


def _usable_values(record: Mapping[str, object]) -> dict[str, str]:
    return {key: str(record[key]) for key in KEYS if _usable(record.get(key))}


def _checked(body: object, project: str) -> dict[str, str]:
    record = body if isinstance(body, dict) else {}
    if record.get("projectId") != project:
        raise WebConfigError("the web configuration does not name this project")
    config = _usable_values(record)
    if not {"apiKey", "authDomain"} <= set(config):
        raise WebConfigError("the web configuration has no usable apiKey or authDomain")
    return config


class WebConfig:
    """Fetched once, on first use; a failed fetch is tried again on the next use."""

    def __init__(self, http: httpx.Client, url: str, project: str) -> None:
        self._http = http
        self._url = url
        self._project = project
        self._lock = threading.Lock()
        self._config: dict[str, str] | None = None

    def get(self) -> Mapping[str, str]:
        with self._lock:
            if self._config is None:
                self._config = self._fetch()
            return dict(self._config)

    def api_key(self) -> str:
        return self.get()["apiKey"]

    def _fetch(self) -> dict[str, str]:
        try:
            response = self._http.get(self._url)
        except httpx.TransportError as error:
            raise WebConfigError(f"the web configuration is unreachable: {type(error).__name__}") from error
        if not response.is_success:
            raise WebConfigError(f"the web configuration answered HTTP {response.status_code}")
        try:
            body = response.json()
        except ValueError as error:
            raise WebConfigError("the web configuration is not JSON") from error
        return _checked(body, self._project)
