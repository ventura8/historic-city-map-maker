"""Job configuration, read from the environment of the Cloud Run Job execution.

The job is deployed with plain environment variables (ids, project, buckets, the reference services); secrets
are never part of `Config`: the USGS credentials are read at run time from Secret Manager (`secrets.py`,
docs/research/design-review-security-cost.md §1.2). Every value that ends up in a Cloud Storage path or a Firestore
document id is validated here, so a malformed id cannot escape its prefix.

| Variable | Meaning |
| --- | --- |
| `JOB_ID`, `CITY_ID` | the `jobs/{id}` document and its city (letters, digits, `_`, `-`) |
| `GOOGLE_CLOUD_PROJECT` | the Google Cloud project id |
| `HCM_PRIVATE_BUCKET`, `HCM_PUBLIC_BUCKET` | Cloud Storage buckets (rasters and USGS files; public previews) |
| `USGS_M2M_BASE_URL` | optional; the M2M API root (https, or http on loopback for the test server) |
| `HCM_STAC_URL`, `HCM_OVERPASS_URL` | optional; the Sentinel-2 STAC API and the Overpass API (never a Mapbox host) |
| `HCM_DEM_URL` | optional; the Copernicus DEM GLO-30 tiles' root (`surface.py`); under the emulators only a loopback one is read |
| `FIRESTORE_EMULATOR_HOST`, `STORAGE_EMULATOR_HOST` | the e2e tier only: the emulators on loopback; then every service root too |
| `HCM_E2E_USGS_TOKEN` | with the emulators only: the scenario's USGS test token (`e2e-ok` by default) |
| `CLOUD_RUN_EXECUTION`, `CLOUD_RUN_TASK_ATTEMPT` | set by Cloud Run; together they name the job lease owner |
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final
from urllib.parse import SplitResult, urlsplit

ENV_JOB_ID: Final = "JOB_ID"
ENV_CITY_ID: Final = "CITY_ID"
ENV_PROJECT: Final = "GOOGLE_CLOUD_PROJECT"
ENV_PRIVATE_BUCKET: Final = "HCM_PRIVATE_BUCKET"
ENV_PUBLIC_BUCKET: Final = "HCM_PUBLIC_BUCKET"
ENV_M2M_BASE_URL: Final = "USGS_M2M_BASE_URL"
ENV_STAC_URL: Final = "HCM_STAC_URL"
ENV_OVERPASS_URL: Final = "HCM_OVERPASS_URL"
ENV_DEM_URL: Final = "HCM_DEM_URL"
ENV_FIRESTORE_EMULATOR: Final = "FIRESTORE_EMULATOR_HOST"
ENV_STORAGE_EMULATOR: Final = "STORAGE_EMULATOR_HOST"
ENV_E2E_USGS_SCENARIO: Final = "HCM_E2E_USGS_TOKEN"
ENV_EXECUTION: Final = "CLOUD_RUN_EXECUTION"
ENV_TASK_ATTEMPT: Final = "CLOUD_RUN_TASK_ATTEMPT"

DEFAULT_M2M_BASE_URL: Final = "https://m2m.cr.usgs.gov/api/api/json/stable/"
# Element 84's Earth Search (Sentinel-2 L2A COGs on AWS open data) and the main Overpass instance; both UNVERIFIED
# for availability and limits until the first real `reference` step (docs/research/M3-interfaces.md §14).
DEFAULT_STAC_URL: Final = "https://earth-search.aws.element84.com/v1"
DEFAULT_OVERPASS_URL: Final = "https://overpass-api.de/api/interpreter"
# Copernicus DEM GLO-30 on AWS open data (anonymous https; M15, *Terrain*). Not sealed under the emulators: a real address is refused
# there by the address guard and the frame is fitted flat.
DEFAULT_DEM_URL: Final = "https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com"
LOCAL_EXECUTION: Final = "local"
LOOPBACK_HOSTS: Final = frozenset({"127.0.0.1", "localhost", "::1"})
# The scenario test values the emulated USGS token may take (docs/research/design-review-testability.md §3.1).
E2E_USGS_SCENARIOS: Final = frozenset({"e2e-ok", "e2e-m2m-pending", "e2e-bad"})
DEFAULT_E2E_USGS_SCENARIO: Final = "e2e-ok"

_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}")
_CITY = re.compile(r"[a-z0-9-]{2,32}")
# Google Cloud project ids: 6-30 characters, lowercase letters, digits and hyphens, starting with a letter.
_PROJECT = re.compile(r"[a-z][a-z0-9-]{4,28}[a-z0-9]")
# Bucket names: lowercase letters, digits, '-', '_' and '.' (domain-named buckets such as
# `<project>.firebasestorage.app`), starting and ending with a letter or digit.
_BUCKET = re.compile(r"[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]")
# An emulator address: a loopback host and a port.
_EMULATOR = re.compile(r"(?:127\.0\.0\.1|localhost|\[::1\]):\d{1,5}")
# Mapbox Satellite is never a georeferencing reference (Mapbox terms): no Mapbox host may be configured as one.
_MAPBOX_HOST = re.compile(r"(?:^|\.)mapbox\.(?:com|cn)$")

_REQUIRED: Final[tuple[tuple[str, re.Pattern[str], str], ...]] = (
    (ENV_JOB_ID, _ID, "an id of letters, digits, '_' and '-'"),
    (ENV_CITY_ID, _CITY, "a city id of lowercase letters, digits and '-'"),
    (ENV_PROJECT, _PROJECT, "a Google Cloud project id"),
    (ENV_PRIVATE_BUCKET, _BUCKET, "a Cloud Storage bucket name"),
    (ENV_PUBLIC_BUCKET, _BUCKET, "a Cloud Storage bucket name"),
)


class ConfigError(ValueError):
    """The environment is incomplete or invalid; `problems` names every variable at fault (never its value)."""

    def __init__(self, problems: Sequence[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = tuple(problems)


@dataclass(frozen=True)
class Config:
    job_id: str
    city_id: str
    project_id: str
    private_bucket: str
    public_bucket: str
    m2m_base_url: str
    execution: str
    task_attempt: int
    stac_url: str = DEFAULT_STAC_URL
    overpass_url: str = DEFAULT_OVERPASS_URL
    dem_url: str = DEFAULT_DEM_URL
    firestore_emulator: str | None = None
    storage_emulator: str | None = None
    e2e_usgs_scenario: str = DEFAULT_E2E_USGS_SCENARIO
    # M7, the local worker (docs/research/M7-local-worker.md §1.2): the lease owner `worker:<workerId>` its claim wrote,
    # and `sealed` under `--emulators` (it talks to no Firestore or Storage of its own, yet must stay on this machine).
    owner: str | None = None
    sealed: bool = False

    @property
    def lease_owner(self) -> str:
        """`<execution>/<attempt>` (a local worker: `worker:<workerId>`): who holds the job lease, so a duplicate
        execution exits early."""
        return self.owner or f"{self.execution}/{self.task_attempt}"

    @property
    def emulated(self) -> bool:
        """True in the e2e pipeline tier: Firestore and Storage are the local emulators (or a worker run with `--emulators`)."""
        return self.sealed or (self.firestore_emulator is not None and self.storage_emulator is not None)


def is_mapbox_host(host: str | None) -> bool:
    """True for a Mapbox address (`api.mapbox.com`, `*.tiles.mapbox.com`, ...)."""
    return bool(host) and _MAPBOX_HOST.search(str(host).lower()) is not None


def _required_problem(env: Mapping[str, str], name: str, pattern: re.Pattern[str], expected: str) -> str | None:
    value = env.get(name, "")
    if not value:
        return f"{name} is not set"
    return None if pattern.fullmatch(value) else f"{name} must be {expected}"


def _parts(url: str) -> SplitResult:
    try:
        return urlsplit(url)
    except ValueError:
        return urlsplit("")


def _secure(parts: SplitResult) -> bool:
    allowed = {"https", "http"} if parts.hostname in LOOPBACK_HOSTS else {"https"}
    return parts.scheme in allowed and bool(parts.hostname)


def url_problem(name: str, url: str) -> str | None:
    """Why `url` cannot be a service root: https only (http for a loopback test server), never a Mapbox host."""
    parts = _parts(url)
    if is_mapbox_host(parts.hostname):
        return f"{name} must not be a Mapbox address (Mapbox imagery is never a georeferencing reference)"
    return None if _secure(parts) else f"{name} must be an https:// URL (http:// only for a loopback test server)"


def _attempt_problem(value: str) -> str | None:
    return None if value.isdecimal() else f"{ENV_TASK_ATTEMPT} must be a non-negative integer"


def _emulator_problem(env: Mapping[str, str], name: str) -> str | None:
    value = env.get(name)
    return None if value is None or _EMULATOR.fullmatch(value) else f"{name} must be a loopback host:port"


def _scenario_problem(env: Mapping[str, str]) -> str | None:
    value = env.get(ENV_E2E_USGS_SCENARIO, DEFAULT_E2E_USGS_SCENARIO)
    return None if value in E2E_USGS_SCENARIOS else f"{ENV_E2E_USGS_SCENARIO} must be one of the scenario test values"


def _m2m_base_url(env: Mapping[str, str]) -> str:
    url = env.get(ENV_M2M_BASE_URL) or DEFAULT_M2M_BASE_URL
    return url if url.endswith("/") else f"{url}/"


def _service_urls(env: Mapping[str, str]) -> dict[str, str]:
    return {
        ENV_M2M_BASE_URL: _m2m_base_url(env),
        ENV_STAC_URL: (env.get(ENV_STAC_URL) or DEFAULT_STAC_URL).rstrip("/"),
        ENV_OVERPASS_URL: env.get(ENV_OVERPASS_URL) or DEFAULT_OVERPASS_URL,
    }


def _required_problems(env: Mapping[str, str]) -> list[str | None]:
    return [_required_problem(env, name, pattern, expected) for name, pattern, expected in _REQUIRED]


def _dem_url(env: Mapping[str, str]) -> str:
    return (env.get(ENV_DEM_URL) or DEFAULT_DEM_URL).rstrip("/")


def _url_problems(env: Mapping[str, str]) -> list[str | None]:
    return [url_problem(name, url) for name, url in {**_service_urls(env), ENV_DEM_URL: _dem_url(env)}.items()]


def _emulator_problems(env: Mapping[str, str]) -> list[str | None]:
    return [_emulator_problem(env, name) for name in (ENV_FIRESTORE_EMULATOR, ENV_STORAGE_EMULATOR)]


def _sealed_problems(env: Mapping[str, str]) -> list[str | None]:
    """Under the emulators every service root is on this machine: the e2e tier never reaches a real USGS, STAC or OSM."""
    if env.get(ENV_FIRESTORE_EMULATOR) is None and env.get(ENV_STORAGE_EMULATOR) is None:
        return []
    return [_loopback_problem(name, url) for name, url in _service_urls(env).items()]


def _loopback_problem(name: str, url: str) -> str | None:
    return None if _parts(url).hostname in LOOPBACK_HOSTS else f"{name} must be a loopback address under the emulators"


def config_problems(env: Mapping[str, str]) -> list[str]:
    """Every problem with the environment, in a stable order (empty when the job can start)."""
    found = _required_problems(env) + _url_problems(env) + [_attempt_problem(env.get(ENV_TASK_ATTEMPT, "0")), _scenario_problem(env)]
    return [problem for problem in found + _emulator_problems(env) + _sealed_problems(env) if problem is not None]


def load_config(env: Mapping[str, str]) -> Config:
    """The job configuration; raises ConfigError listing every missing or invalid variable."""
    problems = config_problems(env)
    if problems:
        raise ConfigError(problems)
    urls = _service_urls(env)
    return Config(
        job_id=env[ENV_JOB_ID],
        city_id=env[ENV_CITY_ID],
        project_id=env[ENV_PROJECT],
        private_bucket=env[ENV_PRIVATE_BUCKET],
        public_bucket=env[ENV_PUBLIC_BUCKET],
        m2m_base_url=urls[ENV_M2M_BASE_URL],
        execution=env.get(ENV_EXECUTION) or LOCAL_EXECUTION,
        task_attempt=int(env.get(ENV_TASK_ATTEMPT, "0")),
        stac_url=urls[ENV_STAC_URL],
        overpass_url=urls[ENV_OVERPASS_URL],
        dem_url=_dem_url(env),
        firestore_emulator=env.get(ENV_FIRESTORE_EMULATOR),
        storage_emulator=env.get(ENV_STORAGE_EMULATOR),
        e2e_usgs_scenario=env.get(ENV_E2E_USGS_SCENARIO, DEFAULT_E2E_USGS_SCENARIO),
    )
