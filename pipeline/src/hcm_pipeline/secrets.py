"""The USGS credentials, read at run time (docs/research/M3-interfaces.md §5.7; security review §1.2).

`SecretManager` reads `usgs-username` and `usgs-app-token` from Secret Manager over REST with the job's own
credentials (`job-raster@` has accessor on these two only: the pipeline holds no Mapbox secret). Never
`--set-secrets`, never an argument, never logged. Under the emulators (loopback only, the e2e pipeline tier)
`EmulatorSecrets` answers the scenario's test values and nothing else.
"""

import base64
from typing import Final, Protocol

import httpx

from hcm_pipeline.m2m import Credentials
from hcm_pipeline.tokens import TokenSource

SECRETMANAGER_URL: Final = "https://secretmanager.googleapis.com/v1"
USGS_USER_NAME_ID: Final = "usgs-username"
USGS_APP_KEY_ID: Final = "usgs-app-token"
PIPELINE_SECRETS: Final = frozenset({USGS_USER_NAME_ID, USGS_APP_KEY_ID})
# The e2e scenario names the USGS user of the shared fakes (`USGS_CREDENTIALS` of @hcm/test-support: `e2e-ok`,
# `e2e-m2m-pending`, `e2e-bad`), whose application token is `e2e-usgs-app-token-<ok|pending|bad>`.
E2E_APP_KEY_PREFIX: Final = "e2e-usgs-app-token-"


class SecretUnavailableError(RuntimeError):
    """A secret could not be read (missing, no access, Secret Manager down): USGS is then not configured."""


class SecretSource(Protocol):
    def read(self, name: str) -> str: ...


def _allowed(name: str) -> str:
    if name not in PIPELINE_SECRETS:
        raise SecretUnavailableError(f"the pipeline reads no secret called {name}")
    return name


class SecretManager:
    """`projects/{project}/secrets/{name}/versions/latest:access`, the payload decoded as UTF-8."""

    def __init__(self, http: httpx.Client, project_id: str, tokens: TokenSource, base_url: str = SECRETMANAGER_URL) -> None:
        self._http = http
        self._project = project_id
        self._tokens = tokens
        self._base = base_url.rstrip("/")

    def read(self, name: str) -> str:
        url = f"{self._base}/projects/{self._project}/secrets/{_allowed(name)}/versions/latest:access"
        try:
            response = self._http.get(url, headers={"Authorization": f"Bearer {self._tokens.token()}"})
        except httpx.TransportError as error:
            raise SecretUnavailableError(f"Secret Manager unreachable reading {name}: {type(error).__name__}") from error
        if not response.is_success:
            raise SecretUnavailableError(f"Secret Manager answered HTTP {response.status_code} for {name}")
        return _payload(response, name)


def _payload(response: httpx.Response, name: str) -> str:
    try:
        data = response.json()["payload"]["data"]
        value = base64.b64decode(str(data), validate=True).decode("utf-8").strip()
    except (ValueError, KeyError, TypeError) as error:
        raise SecretUnavailableError(f"Secret Manager returned no readable value for {name}") from error
    if not value:
        raise SecretUnavailableError(f"the secret {name} is empty")
    return value


def e2e_usgs_token(usgs_scenario: str) -> str:
    """The shared fakes' application token of a scenario's user (`e2e-ok` → `e2e-usgs-app-token-ok`)."""
    return E2E_APP_KEY_PREFIX + usgs_scenario.removeprefix("e2e-").removeprefix("m2m-")


class EmulatorSecrets:
    """The e2e tier's USGS test credentials: the scenario's user of the shared fakes and its token."""

    def __init__(self, usgs_scenario: str) -> None:
        self._values = {USGS_USER_NAME_ID: usgs_scenario, USGS_APP_KEY_ID: e2e_usgs_token(usgs_scenario)}

    def read(self, name: str) -> str:
        return self._values[_allowed(name)]


def usgs_credentials(secrets: SecretSource) -> Credentials:
    """The ERS username and M2M application token."""
    return Credentials(secrets.read(USGS_USER_NAME_ID), secrets.read(USGS_APP_KEY_ID))
