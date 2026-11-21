"""USGS M2M through the server (docs/research/M7-local-worker.md §1.3, §2.5, §10.7).

The worker never holds the USGS application token or an API key: each `request(endpoint, payload)` of the `fetch` step
is `worker.urls {kind: 'usgs', endpoint, payload}`, which the server makes with its own key (login and logout are the
server's) for the four download endpoints bound to the claimed job's scene and label, and answers with M2M's `data`.
The server's refusals come back as the exceptions `fetch` already understands, so the waits are the same as on Cloud
Run: maintenance and rate limits wait, rejected credentials fail with `apiError.usgs.credentials`, USGS not configured
on the server fails with `apiError.usgs.notConfigured`.
"""

from collections.abc import Mapping
from typing import Final, Self

from hcm_pipeline.m2m import AuthError, M2MError, MaintenanceError, RateLimitError
from hcm_pipeline.secrets import SecretUnavailableError
from hcm_pipeline.worker.api import URLS, WorkerApi, WorkerApiError
from hcm_pipeline.worker.documents import JobIds

NOT_CONFIGURED: Final = "apiError.usgs.notConfigured"
_ERRORS: Final[Mapping[str, type[M2MError]]] = {
    "apiError.usgs.maintenance": MaintenanceError,
    "apiError.rateLimited": RateLimitError,
    "apiError.usgs.credentials": AuthError,
}


def m2m_error(error: WorkerApiError) -> Exception:
    """The exception `fetch` handles for a refusal of the server's USGS call."""
    if error.code == NOT_CONFIGURED:
        return SecretUnavailableError(f"USGS is not configured on the server ({error.code})")
    return _ERRORS.get(error.code, M2MError)(f"USGS through the server: {error}", error.code)


class ProxyM2MSession:
    """`with ctx.services.m2m() as m2m:` on a local worker: nothing to log in to or out of."""

    def __init__(self, api: WorkerApi, ids: JobIds) -> None:
        self._api = api
        self._ids = ids

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc_info: object) -> None:
        return

    def request(self, endpoint: str, payload: Mapping[str, object] | None = None) -> object:
        request = {"kind": "usgs", "endpoint": endpoint, "payload": dict(payload or {})}
        try:
            answer = self._api.call(URLS, {**self._ids.body(), "request": request})
        except WorkerApiError as error:
            raise m2m_error(error) from error
        return answer.get("usgs")
