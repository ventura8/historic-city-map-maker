"""USGS Machine-to-Machine (M2M) API client: login-token, logout and every other endpoint.

Every M2M endpoint is a POST of a JSON object that answers with the envelope
`{"requestId", "version", "data", "errorCode", "errorMessage"}`. Errors usually come back as HTTP
500 WITH that JSON body, so the body is parsed on any status. Outside JSON, the USGS front end
answers with HTML: 403 for a rejected API key, 503 "Application Offline" during the monthly
maintenance (docs/research/design-review-security-cost.md §4.2):

| Answer | Raised |
| --- | --- |
| JSON, `errorCode` null, 2xx | nothing: `data` is returned |
| HTTP 429, or `errorCode` `RATE_LIMIT*` | RateLimitError (`retry_after` from the Retry-After header) |
| `errorCode` `AUTH_*`, or non-JSON 403 | AuthError |
| non-JSON 503 | MaintenanceError (the step records `waiting_usgs` and exits) |
| any other `errorCode` | M2MError |
| anything else | ProtocolError |

The API key from login-token lives 2 hours: the client logs in again after 100 minutes (the clock
is injected, so tests need no waiting) and once more when the key is rejected. The key travels only
in the X-Auth-Token header; the app token only in the login-token body. Neither is ever logged.
"""

import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime
from http import HTTPStatus
from typing import Final, Self

import httpx

from hcm_pipeline import __version__
from hcm_pipeline.log import get_logger

LOG = get_logger("m2m")

DEFAULT_BASE_URL: Final = "https://m2m.cr.usgs.gov/api/api/json/stable/"
AUTH_HEADER: Final = "X-Auth-Token"
RELOGIN_AFTER_SECONDS: Final = 100 * 60
DEFAULT_TIMEOUT_SECONDS: Final = 60.0

Clock = Callable[[], float]


class M2MError(Exception):
    """An M2M call failed; `error_code` is the M2M `errorCode` when the answer had one."""

    def __init__(self, message: str, error_code: str | None = None, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.retry_after = retry_after


class AuthError(M2MError):
    """The credentials or the API key were rejected (an AUTH_* errorCode, or a non-JSON 403)."""


class MaintenanceError(M2MError):
    """USGS is offline for maintenance (non-JSON 503): wait, then resume the job."""


class RateLimitError(M2MError):
    """Too many requests (HTTP 429 or RATE_LIMIT*); honour `retry_after` seconds when it is known."""


class ProtocolError(M2MError):
    """An answer that is neither the M2M JSON envelope nor a known USGS error page."""


class UnreachableError(M2MError):
    """The request never got an answer (DNS, connection, timeout)."""


_HTML_ERRORS: Final[Mapping[int, type[M2MError]]] = {
    HTTPStatus.FORBIDDEN: AuthError,
    HTTPStatus.TOO_MANY_REQUESTS: RateLimitError,
    HTTPStatus.SERVICE_UNAVAILABLE: MaintenanceError,
}
_CODE_PREFIXES: Final[tuple[tuple[str, type[M2MError]], ...]] = (("RATE_LIMIT", RateLimitError), ("AUTH_", AuthError))


@dataclass(frozen=True)
class Credentials:
    """An ERS username and its M2M application token (never part of repr or logs)."""

    username: str
    token: str = field(repr=False)


def parse_retry_after(value: str | None, now: float) -> float | None:
    """Seconds to wait from a Retry-After header (delta-seconds or an HTTP date), or None when unknown."""
    if value is None:
        return None
    text = value.strip()
    if text.isdecimal():
        return float(text)
    return _seconds_until(text, now)


def _seconds_until(http_date: str, now: float) -> float | None:
    try:
        when = parsedate_to_datetime(http_date)
    except TypeError, ValueError:
        return None
    return max(0.0, when.timestamp() - now)


def _envelope(response: httpx.Response) -> dict[str, object] | None:
    try:
        body = response.json()
    except ValueError:
        return None
    return body if isinstance(body, dict) else None


def _error_class(code: str, status: int) -> type[M2MError]:
    if status == HTTPStatus.TOO_MANY_REQUESTS:
        return RateLimitError
    fallback = M2MError if code else ProtocolError
    return next((cls for prefix, cls in _CODE_PREFIXES if code.startswith(prefix)), fallback)


def _envelope_error(response: httpx.Response, envelope: Mapping[str, object], retry_after: float | None) -> M2MError:
    code = str(envelope.get("errorCode") or "")
    label = code or f"HTTP {response.status_code}"
    message = f"USGS M2M {response.request.url.path} {label}: {envelope.get('errorMessage') or 'no error message'}"
    return _error_class(code, response.status_code)(message, code or None, retry_after)


def _page_error(response: httpx.Response, retry_after: float | None) -> M2MError:
    kind = response.headers.get("content-type", "no content type")
    message = f"USGS M2M {response.request.url.path} answered HTTP {response.status_code} with {kind} instead of JSON"
    return _HTML_ERRORS.get(response.status_code, ProtocolError)(message, None, retry_after)


def parse_response(response: httpx.Response, now: float) -> object:
    """The `data` of a successful M2M answer; raises the M2MError subclass that matches any other answer."""
    retry_after = parse_retry_after(response.headers.get("retry-after"), now)
    envelope = _envelope(response)
    if envelope is None:
        raise _page_error(response, retry_after)
    if envelope.get("errorCode") is None and response.is_success:
        return envelope.get("data")
    raise _envelope_error(response, envelope, retry_after)


def http_client(base_url: str = DEFAULT_BASE_URL, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> httpx.Client:
    """An httpx client for the M2M API root (no redirects: an M2M redirect is an error page)."""
    return httpx.Client(
        base_url=base_url,
        timeout=timeout,
        follow_redirects=False,
        headers={"User-Agent": f"hcm-pipeline/{__version__}"},
    )


class M2MClient:
    """An M2M session: `with M2MClient(http, credentials) as m2m: m2m.request("scene-search", {...})`.

    Leaving the block logs out (best effort: the key expires on its own after 2 hours).
    """

    def __init__(
        self,
        http: httpx.Client,
        credentials: Credentials,
        clock: Clock = time.time,
        relogin_after: float = RELOGIN_AFTER_SECONDS,
    ) -> None:
        self._http = http
        self._credentials = credentials
        self._clock = clock
        self._relogin_after = relogin_after
        self._api_key: str | None = None
        self._logged_in_at = 0.0

    @property
    def logged_in(self) -> bool:
        return self._api_key is not None

    def login(self) -> None:
        """login-token: exchanges the username and application token for a 2-hour API key."""
        api_key = self._post("login-token", {"username": self._credentials.username, "token": self._credentials.token}, None)
        if not isinstance(api_key, str) or not api_key:
            raise ProtocolError("USGS M2M login-token returned no API key")
        self._api_key = api_key
        self._logged_in_at = self._clock()
        LOG.info("USGS M2M login ok")

    def logout(self) -> None:
        """Ends the session; a failure is logged, not raised (the key expires on its own)."""
        api_key, self._api_key = self._api_key, None
        if api_key is None:
            return
        try:
            self._post("logout", {}, api_key)
        except M2MError as error:
            LOG.warning("USGS M2M logout failed (%s); the API key expires on its own", type(error).__name__)

    def request(self, endpoint: str, payload: Mapping[str, object] | None = None) -> object:
        """The `data` of an M2M call; logs in first when there is no key or it is 100 minutes old,
        and once more when USGS rejects the key."""
        self._ensure_fresh_key()
        try:
            return self._post(endpoint, payload or {}, self._api_key)
        except AuthError:
            LOG.warning("USGS M2M rejected the API key on %s; logging in again", endpoint)
            self.login()
            return self._post(endpoint, payload or {}, self._api_key)

    def _ensure_fresh_key(self) -> None:
        if self._api_key is None or self._clock() - self._logged_in_at >= self._relogin_after:
            self.login()

    def _post(self, endpoint: str, payload: Mapping[str, object], api_key: str | None) -> object:
        headers = {AUTH_HEADER: api_key} if api_key else {}
        try:
            response = self._http.post(endpoint, json=dict(payload), headers=headers)
        except httpx.TransportError as error:
            raise UnreachableError(f"USGS M2M {endpoint}: {type(error).__name__}") from error
        return parse_response(response, self._clock())

    def __enter__(self) -> Self:
        self.login()
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.logout()
