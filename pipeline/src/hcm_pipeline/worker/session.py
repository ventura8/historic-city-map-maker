"""The owner's session: a Firebase ID token and its refresh token, in memory only (docs/research/M7-local-worker.md §2.2).

The local page hands both over after Google's sign-in; the worker keeps them only after `worker.hello` accepted the ID
token (`app.py`). An ID token lives an hour: five minutes before it expires (its `exp`, read without verifying: the
server verifies it) the next call refreshes it through `securetoken.googleapis.com/v1/token?key=<web API key>` (the Auth
emulator's under `--emulators`). A refused refresh (the refresh token revoked or expired) ends the session: the run in
progress stops writing (`SessionEndedError` is a lost lease to the runner), claiming stops and the page asks the owner
to sign in again. Neither token is ever logged (the pipeline's logger redacts both shapes). Finding 67 of 2026-11-02: a
session made by pairing (`pairing.py`) is kept (`keep`) each time its refresh token changes, so a restart of the container
resumes it (`renew`) without a new code; a session from the local page's Google sign-in is never written down. Every call
to Google's token service names the project's Hosting origin as its `Referer` (the project's browser key accepts no other).
"""

import base64
import json
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Final

import httpx

from hcm_pipeline.jobs import LeaseLostError
from hcm_pipeline.log import get_logger

LOG = get_logger("worker.session")
REFRESH_MARGIN_SECONDS: Final = 300
TOKEN_MAX_LENGTH: Final = 4096
# A JWT is a header, a payload and a signature (the Auth emulator's signature is empty).
JWT_PARTS: Final = 3
# Why a session ended, as the page shows it (`page.py`).
SIGNED_OUT: Final = "signedOut"
SIGN_IN_AGAIN: Final = "signInAgain"


class SessionEndedError(LeaseLostError):
    """There is no session (never signed in, signed out, or a refused refresh): the run must stop writing."""


class RefreshUnavailableError(RuntimeError):
    """Google's token service could not be reached: the session stays, the next call tries again."""

    code: Final = "apiError.unavailable"


def token_claims(id_token: str) -> dict[str, object] | None:
    """The claims of a JWT, decoded without verifying it (the server verifies every call's token)."""
    parts = id_token.split(".")
    if len(parts) != JWT_PARTS:
        return None
    try:
        claims = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
    except ValueError:
        return None
    return claims if isinstance(claims, dict) else None


@dataclass(frozen=True)
class Tokens:
    """An ID token, its refresh token, when the ID token expires (epoch seconds) and the account's e-mail."""

    id_token: str = field(repr=False)
    refresh_token: str = field(repr=False)
    expires_at: float
    email: str | None = None

    @classmethod
    def of(cls, id_token: object, refresh_token: object) -> Tokens:
        """Both tokens as the page or Google's token service gave them; ValueError when they are not usable."""
        if not all(map(_token_text, (id_token, refresh_token))):
            raise ValueError("the session needs an ID token and a refresh token")
        claims = _claims(str(id_token))
        expires = claims.get("exp")
        if not isinstance(expires, int | float):
            raise ValueError("the ID token carries no expiry")
        return cls(str(id_token), str(refresh_token), float(expires), _email(claims))


def _claims(id_token: str) -> Mapping[str, object]:
    return token_claims(id_token) or {}


def _email(claims: Mapping[str, object]) -> str | None:
    email = claims.get("email")
    return email if isinstance(email, str) else None


def _token_text(value: object) -> bool:
    return isinstance(value, str) and 0 < len(value) <= TOKEN_MAX_LENGTH and value.isprintable() and " " not in value


class Session:
    """The tokens of the signed-in owner, refreshed on use; thread-safe (the page's server and the loop share it)."""

    def __init__(
        self,
        http: httpx.Client,
        refresh_url: Callable[[], str],
        clock: Callable[[], float],
        headers: Mapping[str, str] = MappingProxyType({}),
    ) -> None:
        self._http = http
        self._refresh_url = refresh_url
        self._clock = clock
        self._headers = dict(headers)
        self._lock = threading.RLock()
        self._tokens: Tokens | None = None
        self._keep: Callable[[Tokens], None] | None = None
        self.ended_because: str | None = None

    @property
    def active(self) -> bool:
        with self._lock:
            return self._tokens is not None

    @property
    def email(self) -> str | None:
        with self._lock:
            return self._tokens.email if self._tokens else None

    def begin(self, tokens: Tokens, keep: Callable[[Tokens], None] | None = None) -> None:
        """The session's tokens; `keep` (a paired session) hears them now and after every refresh."""
        with self._lock:
            self._tokens, self._keep, self.ended_because = tokens, keep, None
            if keep is not None:
                keep(tokens)

    def end(self, why: str) -> None:
        """The tokens forgotten; `why` is what the page tells the owner."""
        with self._lock:
            self._tokens, self._keep, self.ended_because = None, None, why

    def renew(self, refresh_token: str) -> Tokens:
        """Fresh tokens from a kept refresh token (a paired worker's restart); SessionEndedError when Google refuses it."""
        with self._lock:
            return self._exchange(refresh_token, None)

    def bearer(self) -> str:
        """The ID token for the next call, refreshed first when it expires within five minutes."""
        with self._lock:
            if self._tokens is None:
                raise SessionEndedError("no session: sign in on the local page")
            if self._clock() >= self._tokens.expires_at - REFRESH_MARGIN_SECONDS:
                self._tokens = self._exchange(self._tokens.refresh_token, self._tokens.email)
                if self._keep is not None:
                    self._keep(self._tokens)
            return self._tokens.id_token

    def _exchange(self, refresh_token: str, email: str | None) -> Tokens:
        form = {"grant_type": "refresh_token", "refresh_token": refresh_token}
        try:
            response = self._http.post(self._refresh_url(), data=form, headers=self._headers)
        except httpx.TransportError as error:
            raise RefreshUnavailableError(f"the token service is unreachable: {type(error).__name__}") from error
        if response.is_success:
            return _answered(response, email)
        LOG.warning("the token service refused the refresh (HTTP %s); the session ends", response.status_code)
        self.end(SIGN_IN_AGAIN)
        raise SessionEndedError("the refresh was refused: sign in again on the local page")


def _answered(response: httpx.Response, email: str | None) -> Tokens:
    """The refreshed tokens (Google's answer keeps the e-mail out of a refresh: the previous one stays)."""
    try:
        body = response.json()
        tokens = Tokens.of(body.get("id_token"), body.get("refresh_token"))
    except (ValueError, AttributeError) as error:
        raise RefreshUnavailableError("the token service answered without tokens") from error
    return Tokens(tokens.id_token, tokens.refresh_token, tokens.expires_at, tokens.email or email)
