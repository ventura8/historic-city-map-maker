"""The worker's five callables over HTTP (docs/research/M7-local-worker.md §2.4).

Each call is a Firebase callable request: `POST https://us-central1-<project>.cloudfunctions.net/<name>` (under the
emulators `http://<FUNCTIONS_EMULATOR_HOST>/<project>/us-central1/<name>`) with the JSON body `{"data": ...}` and
`Authorization: Bearer <ID token>`; the answer is `{"result": ...}`, or `{"error": {"message", "status", "details":
{"code", "params"}}}` whose `details.code` is the `apiError.*` code. `apiError.worker.notHolder` (the job is no longer
this worker's) is raised as `LeaseLostError`, so a run stops where it is and writes nothing more, as a lost lease does;
every other refusal is `WorkerApiError`. An unreachable server, or a 502-504 without a code, is tried again twice.
Finding 67 of 2026-11-02: `worker-pair` is called with no sign-in at all (`anonymous`); `apiError.worker.revoked` (the
owner pressed Disconnect this computer) is `RevokedError`, a lost lease too, so a run stops and the loop forgets the
session.
"""

from collections.abc import Callable, Mapping
from http import HTTPStatus
from typing import Final

import httpx

from hcm_pipeline.contract import Errors
from hcm_pipeline.jobs import LeaseLostError
from hcm_pipeline.log import get_logger

LOG = get_logger("worker.api")
HELLO: Final = "worker-hello"
CLAIM: Final = "worker-claim"
STEP: Final = "worker-step"
URLS: Final = "worker-urls"
END: Final = "worker-end"
PAIR: Final = "worker-pair"
# M20 (docs/research/M20-import-local.md §2.4): a local archive's scan report.
ARCHIVE_REPORT: Final = "worker-archiveReport"
ARCHIVE_COPY: Final = "worker-archiveCopy"
NOT_HOLDER: Final = "apiError.worker.notHolder"
REFUSED: Final = "apiError.worker.refused"
REVOKED: Final = "apiError.worker.revoked"
ATTEMPTS: Final = 3
RETRY_SECONDS: Final = 2.0
_RETRIED: Final = frozenset({HTTPStatus.BAD_GATEWAY, HTTPStatus.SERVICE_UNAVAILABLE, HTTPStatus.GATEWAY_TIMEOUT})
# The code of a refusal without readable details, by the callable's status (`FALLBACK_BY_STATUS` of @hcm/shared).
_BY_STATUS: Final = {
    "UNAUTHENTICATED": "apiError.unauthenticated",
    "PERMISSION_DENIED": "apiError.notAdmin",
    "NOT_FOUND": Errors.NOT_FOUND,
    "RESOURCE_EXHAUSTED": Errors.RATE_LIMITED,
    "UNAVAILABLE": Errors.UNAVAILABLE,
    "INVALID_ARGUMENT": Errors.INVALID_REQUEST,
}


class WorkerApiError(RuntimeError):
    """A callable refused the request: `code` is its `apiError.*` code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code


class RevokedError(LeaseLostError):
    """The computer was disconnected in the admin: the run stops and the session is forgotten."""

    code: Final = REVOKED


def _body(response: httpx.Response) -> dict[str, object]:
    try:
        body = response.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


def _record(value: object) -> dict[str, object]:
    return value if isinstance(value, dict) else {}


def _code(body: Mapping[str, object]) -> object:
    return _record(_record(body.get("error")).get("details")).get("code")


def _transient(response: httpx.Response) -> bool:
    """A 502-504 of the infrastructure (a callable's own refusal, such as USGS's maintenance, carries its code)."""
    return response.status_code in _RETRIED and not isinstance(_code(_body(response)), str)


# At most this many refused fields are named in the error's message.
ISSUES_NAMED: Final = 5


def _issues(body: Mapping[str, object]) -> str:
    """The fields a validation refused, as `path (code)`: where to look, never a value (the server sends none)."""
    named = [_issue(_record(item)) for item in _list(_record(_record(body.get("error")).get("details")).get("issues"))[:ISSUES_NAMED]]
    return f": {', '.join(named)}" if named else ""


def _list(value: object) -> list[object]:
    return value if isinstance(value, list) else []


def _issue(issue: Mapping[str, object]) -> str:
    return f"{issue.get('path') or '(the value)'} ({issue.get('code')})"


def refusal(status: int, body: Mapping[str, object]) -> Exception:
    """The exception of a refused call: `LeaseLostError` for notHolder, else `WorkerApiError` with its code and, for a validation,
    the fields it refused (`apiError.invalidRequest: help.stitched.leftOut.0.name (validation.tooBig)`)."""
    error = _record(body.get("error"))
    code = _code(body)
    if not isinstance(code, str):
        code = _BY_STATUS.get(str(error.get("status")), Errors.INTERNAL)
    message = str(error.get("message") or f"HTTP {status}") + _issues(body)
    if code == NOT_HOLDER:
        return LeaseLostError(f"the server says this worker no longer holds the job: {message}")
    if code == REVOKED:
        return RevokedError(f"this computer was disconnected in the admin: {message}")
    return WorkerApiError(code, message)


class WorkerApi:
    """The callables, with the session's ID token (or an explicit one: the token `worker.hello` checks before it is kept)."""

    def __init__(
        self, http: httpx.Client, address: Callable[[str], str], bearer: Callable[[], str], sleep: Callable[[float], None]
    ) -> None:
        self._http = http
        self._address = address
        self._bearer = bearer
        self._sleep = sleep

    def call(self, name: str, data: Mapping[str, object], token: str | None = None, anonymous: bool = False) -> dict[str, object]:
        """The callable's `result`; raises `WorkerApiError` (or `LeaseLostError` for notHolder) when it refuses."""
        response = self._send(name, data, None if anonymous else (token or self._bearer))
        body = _body(response)
        if response.is_success and "result" in body:
            return _record(body["result"])
        raise refusal(response.status_code, body)

    def _send(self, name: str, data: Mapping[str, object], token: str | Callable[[], str] | None) -> httpx.Response:
        for attempt in range(ATTEMPTS):
            if attempt:
                LOG.warning("the server did not answer %s; trying again (attempt %d of %d)", name, attempt + 1, ATTEMPTS)
                self._sleep(RETRY_SECONDS * attempt)
            response = self._post(name, data, token)
            if response is not None and not _transient(response):
                return response
        raise WorkerApiError(Errors.UNAVAILABLE, f"the server did not answer {name}")

    def _post(self, name: str, data: Mapping[str, object], token: str | Callable[[], str] | None) -> httpx.Response | None:
        """`token`: the ID token, the session's (called per attempt: a refresh may come between), or none at all."""
        headers = {} if token is None else {"Authorization": f"Bearer {token if isinstance(token, str) else token()}"}
        try:
            return self._http.post(self._address(name), json={"data": dict(data)}, headers=headers)
        except httpx.TransportError:
            return None
