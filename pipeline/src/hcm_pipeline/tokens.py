"""Access tokens for the Google REST APIs the pipeline calls (Cloud Storage JSON API, Secret Manager).

On Cloud Run the job's own service account (`job-raster@`) answers through Application Default Credentials;
under the Firebase emulators (loopback only, the e2e pipeline tier) every request carries `Bearer owner`, which
the emulators accept. A token is never logged.
"""

from collections.abc import Callable
from typing import Any, Final, Protocol

import google.auth
from google.auth.transport.requests import Request

CLOUD_PLATFORM_SCOPE: Final = "https://www.googleapis.com/auth/cloud-platform"
EMULATOR_BEARER: Final = "owner"


class TokenSource(Protocol):
    def token(self) -> str: ...


class EmulatorTokens:
    """The emulators' token."""

    def token(self) -> str:
        return EMULATOR_BEARER


class _Credentials(Protocol):
    @property
    def valid(self) -> bool: ...

    @property
    def token(self) -> str | None: ...

    def refresh(self, request: Any) -> None: ...


CredentialsLoader = Callable[[], _Credentials]


def _default_credentials() -> _Credentials:
    credentials, _project = google.auth.default(scopes=[CLOUD_PLATFORM_SCOPE])
    return credentials


class GoogleTokens:
    """Application Default Credentials, refreshed when they expire."""

    def __init__(self, load: CredentialsLoader = _default_credentials, request: Callable[[], object] = Request) -> None:
        self._load = load
        self._request = request
        self._credentials: _Credentials | None = None

    def token(self) -> str:
        credentials = self._credentials or self._load()
        self._credentials = credentials
        if not credentials.valid:
            credentials.refresh(self._request())
        if not credentials.token:
            raise RuntimeError("the default credentials gave no access token")
        return credentials.token
