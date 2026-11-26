"""The worker's command line and the addresses it talks to (docs/research/M7-local-worker.md §1.1).

`worker --city <id> --project <id> [--pair <code>] [--port 8765] [--work /work] [--emulators]`: the project gives the
callables' origin (`https://us-central1-<project>.cloudfunctions.net`), the Hosting origin of the web configuration
(`https://<project>.web.app/__/firebase/init.json`, also the `Referer` of the worker's calls to Google's token services:
the project's browser key accepts only its Hosting origins) and nothing else is configured. `--pair` is the admin
command's one-time code (finding 67 of 2026-11-02, `pairing.py`): 26 base32 characters. Finding 72 (the starter file, M7
§1.5): `--supervised` (the starter's supervisor runs it: an outdated image exits with `ExitCode.OUTDATED`, so the
supervisor pulls the installed one) and `--image sha256:<digest>` (the image it runs, which `worker.hello` compares with
the installed one); the project's Hosting origins (`hosting_origins`: the public map's site and, since §210, the admin's own
`<project>-admin`) are where the admin's auto-pair comes from. Under
`--emulators` (the e2e tier)
the same code talks to this machine only, from the variables below, each a loopback `host:port`:

| Variable | What |
| --- | --- |
| `FIREBASE_AUTH_EMULATOR_HOST` | the Auth emulator: the page signs in there, the worker refreshes its token there |
| `FUNCTIONS_EMULATOR_HOST` | the Functions emulator: `http://<host>/<project>/us-central1/worker-*` |
| `HCM_HOSTING_HOST` | the host that serves `/__/firebase/init.json` (the e2e admin server) |
| `HCM_STAC_URL`, `HCM_OVERPASS_URL` | the references' roots, as for `run` (loopback under the emulators) |
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final
from urllib.parse import urlsplit

from hcm_pipeline.config import (
    DEFAULT_OVERPASS_URL,
    DEFAULT_STAC_URL,
    ENV_OVERPASS_URL,
    ENV_STAC_URL,
    LOOPBACK_HOSTS,
    ConfigError,
    url_problem,
)
from hcm_pipeline.paths import CITY_ID

ENV_AUTH_EMULATOR: Final = "FIREBASE_AUTH_EMULATOR_HOST"
ENV_FUNCTIONS_EMULATOR: Final = "FUNCTIONS_EMULATOR_HOST"
ENV_HOSTING: Final = "HCM_HOSTING_HOST"
EMULATOR_VARIABLES: Final = (ENV_AUTH_EMULATOR, ENV_FUNCTIONS_EMULATOR, ENV_HOSTING)
DEFAULT_PORT: Final = 8765
DEFAULT_WORK: Final = "/work"
REGION: Final = "us-central1"
MAX_PORT: Final = 65535
SECURETOKEN_PATH: Final = "securetoken.googleapis.com/v1/token"
CUSTOM_SIGN_IN_PATH: Final = "identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken"
# The admin command's one-time pairing code (`WORKER_PAIR_CODE_PATTERN` of @hcm/shared).
PAIR_CODE: Final = re.compile(r"[a-z2-7]{26}")
# The pipeline image's digest the supervisor pulled (`--image`).
DIGEST: Final = re.compile(r"sha256:[0-9a-f]{64}")
INIT_JSON_PATH: Final = "/__/firebase/init.json"
# Google Cloud project ids: 6-30 characters, lowercase letters, digits and hyphens, starting with a letter.
PROJECT_ID: Final = re.compile(r"[a-z][a-z0-9-]{4,28}[a-z0-9]")
EMULATOR_HOST: Final = re.compile(r"(?:127\.0\.0\.1|localhost|\[::1\]):\d{1,5}")


# The admin's own Hosting site (DECISIONS-for-review.md §210): `adminSiteId` of @hcm/shared, the same cases pinned by both.
ADMIN_SITE_SUFFIX: Final = "-admin"
ADMIN_SITE_MAX_LENGTH: Final = 30


def admin_site_id(project: str) -> str:
    """`<project>-admin`, or the project id's first 24 characters (trailing hyphens dropped) and the suffix."""
    room = ADMIN_SITE_MAX_LENGTH - len(ADMIN_SITE_SUFFIX)
    head = project[:room].rstrip("-") if len(project) > room else project
    return f"{head}{ADMIN_SITE_SUFFIX}"


@dataclass(frozen=True)
class Endpoints:
    """Where the worker's calls go: the callables, Google's token refresh, the web configuration (and, under the
    emulators, the Auth emulator the page connects to)."""

    functions: str
    securetoken: str
    init_json: str
    custom_token: str
    # The Hosting origin the worker names as its `Referer` to Google's token services (the browser key's restriction).
    referer: str
    auth_emulator: str | None = None
    # Finding 72: the origins the admin runs on, whose auto-pair the page's server answers (CORS, `POST /pair`).
    hosting_origins: tuple[str, ...] = ()

    def function(self, name: str) -> str:
        """The address of the deployed callable `name` (`worker-claim`, ...)."""
        return f"{self.functions}{name}"

    @classmethod
    def cloud(cls, project: str) -> Endpoints:
        return cls(
            functions=f"https://{REGION}-{project}.cloudfunctions.net/",
            securetoken=f"https://{SECURETOKEN_PATH}",
            init_json=f"https://{project}.web.app{INIT_JSON_PATH}",
            custom_token=f"https://{CUSTOM_SIGN_IN_PATH}",
            referer=f"https://{project}.web.app/",
            # §210: the admin runs on its own site (`<project>-admin`) once the project has it, else on the public map's.
            hosting_origins=tuple(
                f"https://{site}.{domain}" for site in (project, admin_site_id(project)) for domain in ("web.app", "firebaseapp.com")
            ),
        )

    @classmethod
    def emulated(cls, project: str, env: Mapping[str, str]) -> Endpoints:
        auth = env[ENV_AUTH_EMULATOR]
        return cls(
            functions=f"http://{env[ENV_FUNCTIONS_EMULATOR]}/{project}/{REGION}/",
            securetoken=f"http://{auth}/{SECURETOKEN_PATH}",
            init_json=f"http://{env[ENV_HOSTING]}{INIT_JSON_PATH}",
            custom_token=f"http://{auth}/{CUSTOM_SIGN_IN_PATH}",
            referer=f"http://{env[ENV_HOSTING]}/",
            auth_emulator=auth,
            hosting_origins=(f"http://{env[ENV_HOSTING]}",),
        )


@dataclass(frozen=True)
class WorkerArgs:
    """The validated command line (`WorkerArgs` of the contract) and what follows from it."""

    city: str
    project: str
    port: int
    work: Path
    emulators: bool
    endpoints: Endpoints
    pair: str | None = None
    supervised: bool = False
    image: str | None = None
    stac_url: str = DEFAULT_STAC_URL
    overpass_url: str = DEFAULT_OVERPASS_URL


def _text(options: Mapping[str, object], key: str) -> str:
    value = options.get(key)
    return value if isinstance(value, str) else ""


def _pattern_problem(value: str, pattern: re.Pattern[str], what: str) -> str | None:
    return None if pattern.fullmatch(value) else what


def _port_of(options: Mapping[str, object]) -> int | None:
    """The port (0 lets the system choose one: the tests), None when it is not a port."""
    value = options.get("port")
    port = DEFAULT_PORT if value is None else value
    return port if isinstance(port, int) and 0 <= port <= MAX_PORT else None


def _emulator_problem(env: Mapping[str, str], name: str) -> str | None:
    return None if EMULATOR_HOST.fullmatch(env.get(name, "")) else f"{name} must be a loopback host:port"


def _emulator_problems(env: Mapping[str, str]) -> list[str | None]:
    return [_emulator_problem(env, name) for name in EMULATOR_VARIABLES]


def _reference_urls(env: Mapping[str, str]) -> dict[str, str]:
    return {
        ENV_STAC_URL: (env.get(ENV_STAC_URL) or DEFAULT_STAC_URL).rstrip("/"),
        ENV_OVERPASS_URL: env.get(ENV_OVERPASS_URL) or DEFAULT_OVERPASS_URL,
    }


def _loopback_problem(name: str, url: str) -> str | None:
    return None if _loopback(url) else f"{name} must be a loopback address under the emulators"


def _url_problems(urls: Mapping[str, str], emulators: bool) -> list[str | None]:
    sealed = [_loopback_problem(name, url) for name, url in urls.items()] if emulators else []
    return [url_problem(name, url) for name, url in urls.items()] + sealed


def _loopback(url: str) -> bool:
    try:
        return urlsplit(url).hostname in LOOPBACK_HOSTS
    except ValueError:
        return False


def _pair_problem(options: Mapping[str, object]) -> str | None:
    """`--pair` is optional, but when given it is a pairing code (never echoed: it is a credential for ten minutes)."""
    return None if options.get("pair") is None or PAIR_CODE.fullmatch(_text(options, "pair")) else "--pair must be the admin's pairing code"


def _pair_of(options: Mapping[str, object]) -> str | None:
    return _text(options, "pair") or None


def _image_problem(options: Mapping[str, object]) -> str | None:
    """`--image` is optional, but when given it is a pipeline image's digest."""
    return None if options.get("image") is None or DIGEST.fullmatch(_text(options, "image")) else "--image must be sha256:<digest>"


def _supervision_of(options: Mapping[str, object]) -> dict[str, Any]:
    """The pairing code, and the starter's supervisor's flag and image (finding 72), when given."""
    return {"pair": _pair_of(options), "supervised": options.get("supervised") is True, "image": _text(options, "image") or None}


def _work_problem(options: Mapping[str, object]) -> str | None:
    """`--work` is optional (`/work`), but when given it names a folder."""
    return None if options.get("work") is None or _text(options, "work") else "--work must name a folder"


def _option_problems(options: Mapping[str, object]) -> list[str | None]:
    return [
        _pattern_problem(_text(options, "city"), CITY_ID, "--city must be a city id of lowercase letters, digits and '-'"),
        _pattern_problem(_text(options, "project"), PROJECT_ID, "--project must be a Google Cloud project id"),
        None if _port_of(options) is not None else "--port must be a port number",
        _work_problem(options),
        _pair_problem(options),
        _image_problem(options),
    ]


def _problems(options: Mapping[str, object], env: Mapping[str, str], emulators: bool) -> Sequence[str]:
    emulator = _emulator_problems(env) if emulators else []
    found = _option_problems(options) + emulator + _url_problems(_reference_urls(env), emulators)
    return [problem for problem in found if problem is not None]


def parse_worker_args(options: Mapping[str, object], env: Mapping[str, str]) -> WorkerArgs:
    """The worker's arguments; raises ConfigError naming every option or variable at fault (never a value)."""
    emulators = options.get("emulators") is True
    problems = _problems(options, env, emulators)
    if problems:
        raise ConfigError(problems)
    project = _text(options, "project")
    urls = _reference_urls(env)
    return WorkerArgs(
        city=_text(options, "city"),
        project=project,
        port=_port_of(options) or 0,
        work=Path(_text(options, "work") or DEFAULT_WORK),
        emulators=emulators,
        endpoints=Endpoints.emulated(project, env) if emulators else Endpoints.cloud(project),
        **_supervision_of(options),
        stac_url=urls[ENV_STAC_URL],
        overpass_url=urls[ENV_OVERPASS_URL],
    )
