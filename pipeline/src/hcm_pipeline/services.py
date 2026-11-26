"""The composition root: the real adapters a run uses, built from the configuration (docs/research/M3-interfaces.md §5.1).

On Cloud Run: Firestore and Cloud Storage with the job's own credentials, Secret Manager for the USGS credentials,
the M2M client, the STAC and Overpass clients. Under the emulators (`FIRESTORE_EMULATOR_HOST` and
`STORAGE_EMULATOR_HOST`, loopback only, the e2e pipeline tier) the same adapters talk to the emulators with the
emulators' token, and the USGS credentials are the scenario's test values.
"""

import time
from collections.abc import Callable, Mapping
from typing import Final
from urllib.parse import urlsplit

import httpx
from google.cloud import firestore

from hcm_pipeline import __version__
from hcm_pipeline.config import LOOPBACK_HOSTS, Config
from hcm_pipeline.jobs import Services
from hcm_pipeline.landsat.bands import LandsatBandsStep
from hcm_pipeline.landsat.compose import LandsatComposeStep
from hcm_pipeline.landsat.route import AlreadyGeoreferenced, ForLandsat
from hcm_pipeline.m2m import M2MClient, http_client
from hcm_pipeline.objects import GCS_BASE_URL, GcsObjectStore
from hcm_pipeline.osm import OverpassClient
from hcm_pipeline.runner import JobStep
from hcm_pipeline.secrets import EmulatorSecrets, SecretManager, SecretSource, usgs_credentials
from hcm_pipeline.stac import StacClient
from hcm_pipeline.steps.align import AlignStep
from hcm_pipeline.steps.export import ExportStep
from hcm_pipeline.steps.extract import ExtractStep
from hcm_pipeline.steps.fetch import FetchStep
from hcm_pipeline.steps.gather import GatherStep
from hcm_pipeline.steps.inspect import InspectStep
from hcm_pipeline.steps.locate import LocateStep
from hcm_pipeline.steps.merge import MergeStep
from hcm_pipeline.steps.place import PlaceStep
from hcm_pipeline.steps.pyramid import PyramidStep
from hcm_pipeline.steps.recalibrate import RecalibratedGeorefStep
from hcm_pipeline.steps.reference import ReferenceStep
from hcm_pipeline.steps.register import RegisterStep
from hcm_pipeline.steps.stitch import StitchStep
from hcm_pipeline.steps.warp import WarpStep
from hcm_pipeline.store import FirestoreStore
from hcm_pipeline.tokens import EmulatorTokens, GoogleTokens, TokenSource
from hcm_pipeline.urlguard import Resolver, check_data_url, check_emulated_url, resolve

TIMEOUT_SECONDS: Final = 60.0
DOWNLOAD_TIMEOUT: Final = httpx.Timeout(60.0, read=300.0)


def default_steps() -> Mapping[str, JobStep]:
    """Every pipeline step by name (`PIPELINE_STEPS`)."""
    steps: tuple[JobStep, ...] = (
        GatherStep(),
        FetchStep(),
        # M25 (docs/research/M25-landsat.md §3): a Landsat scene keeps its bands, skips what georeferences, and composes in `warp`.
        ForLandsat(ExtractStep(), LandsatBandsStep()),
        ForLandsat(StitchStep(), AlreadyGeoreferenced("stitch")),
        InspectStep(),
        ForLandsat(LocateStep(), AlreadyGeoreferenced("locate")),
        PlaceStep(),
        ReferenceStep(),
        ForLandsat(RecalibratedGeorefStep(), AlreadyGeoreferenced("georef")),
        AlignStep(),
        MergeStep(),
        ForLandsat(WarpStep(), LandsatComposeStep()),
        ExportStep(),
        PyramidStep(),
        RegisterStep(),
    )
    return {step.name: step for step in steps}


def http(timeout: httpx.Timeout | float = TIMEOUT_SECONDS) -> httpx.Client:
    """A client that follows no redirect (an address from data must not lead elsewhere) and names the pipeline."""
    return httpx.Client(timeout=timeout, follow_redirects=False, headers={"User-Agent": f"hcm-pipeline/{__version__}"})


def guarded(allow_loopback: bool, resolver: Resolver = resolve) -> Callable[[httpx.Request], None]:
    """A request hook that refuses any address the guard refuses (`urlguard.py`): every hop of a redirect included."""

    def hook(request: httpx.Request) -> None:
        check_data_url(str(request.url), allow_loopback, resolver)

    return hook


def emulated_guard() -> Callable[[httpx.Request], None]:
    """Under the emulators: a request hook that refuses every address off this machine (`check_emulated_url`)."""

    def hook(request: httpx.Request) -> None:
        check_emulated_url(str(request.url))

    return hook


def delivery_client(config: Config) -> httpx.Client:
    """The USGS delivery's client: it follows the delivery host's redirects (**UNVERIFIED** whether USGS sends any),
    each hop through the address guard, so a redirect can never reach a private or metadata address; under the
    emulators, never an address off this machine."""
    loopback = urlsplit(config.m2m_base_url).hostname in LOOPBACK_HOSTS
    hooks = {"request": [emulated_guard() if config.emulated else guarded(loopback)]}
    return httpx.Client(
        timeout=DOWNLOAD_TIMEOUT, follow_redirects=True, event_hooks=hooks, headers={"User-Agent": f"hcm-pipeline/{__version__}"}
    )


def _tokens(config: Config) -> TokenSource:
    return EmulatorTokens() if config.emulated else GoogleTokens()


def _secrets(config: Config, client: httpx.Client) -> SecretSource:
    if config.emulated:
        return EmulatorSecrets(config.e2e_usgs_scenario)
    return SecretManager(client, config.project_id, _tokens(config))


def _storage_url(config: Config) -> str:
    return f"http://{config.storage_emulator}" if config.storage_emulator else GCS_BASE_URL


def build(config: Config) -> Services:
    """The real adapters for `config`."""
    client = http()
    secrets = _secrets(config, client)
    database = firestore.Client(project=config.project_id)

    def m2m() -> M2MClient:
        return M2MClient(http_client(config.m2m_base_url), usgs_credentials(secrets))

    return Services(
        store=FirestoreStore(database, firestore.Client.write_option, firestore.DELETE_FIELD),
        objects=GcsObjectStore(client, config.private_bucket, _tokens(config), _storage_url(config)),
        secrets=secrets,
        m2m=m2m,
        downloads=delivery_client(config),
        stac=StacClient(client, config.stac_url, time.sleep),
        overpass=OverpassClient(client, config.overpass_url, time.sleep),
        clock=time.time,
        sleep=time.sleep,
        resolver=resolve,
    )
