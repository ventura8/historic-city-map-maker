"""`python -m hcm_pipeline run` and the composition root that wires the real adapters."""

import logging
from collections.abc import Mapping

import httpx
import pytest
from hcm_pipeline.config import Config, load_config
from hcm_pipeline.contract import PIPELINE_STEPS
from hcm_pipeline.exit_codes import ExitCode
from hcm_pipeline.jobs import Done, JobContext, StepFailedError, StepResult
from hcm_pipeline.objects import GCS_BASE_URL, GcsObjectStore
from hcm_pipeline.runner import JobStep
from hcm_pipeline.secrets import EmulatorSecrets, SecretManager
from hcm_pipeline.services import _secrets, _storage_url, _tokens, build, default_steps, delivery_client, guarded, http
from hcm_pipeline.steps import Outcome, StepContext, StepError
from hcm_pipeline.steps.run import RunCommand
from hcm_pipeline.store import FirestoreStore
from hcm_pipeline.tokens import EmulatorTokens, GoogleTokens
from hcm_pipeline.urlguard import AddressRefusedError

from tests.fakes.environment import VALID_ENV
from tests.fakes.world import JOB_ID, PipelineWorld

EMULATED = {
    **VALID_ENV,
    "FIRESTORE_EMULATOR_HOST": "127.0.0.1:8080",
    "STORAGE_EMULATOR_HOST": "127.0.0.1:9199",
    "HCM_E2E_USGS_TOKEN": "e2e-ok",
    "USGS_M2M_BASE_URL": "http://127.0.0.1:4311/h/m2m.cr.usgs.gov/api/api/json/stable/",
    "HCM_STAC_URL": "http://127.0.0.1:4311/h/earth-search.aws.element84.com/v1",
    "HCM_OVERPASS_URL": "http://127.0.0.1:4311/h/overpass-api.de/api/interpreter",
}


class Failing:
    name = "fetch"

    def run(self, ctx: JobContext) -> StepResult:
        raise StepFailedError("apiError.imagery.notScanned", "not scanned")


class Passing:
    def __init__(self, name: str) -> None:
        self.name = name

    def run(self, ctx: JobContext) -> StepResult:
        return Done()


def command(world: PipelineWorld, steps: Mapping[str, JobStep]) -> RunCommand:
    return RunCommand("run", lambda _config: world.services(), lambda: steps)


def context(config: Config) -> StepContext:
    return StepContext(logging.getLogger("t"), config)


@pytest.fixture(autouse=True)
def one_gdal_thread(monkeypatch: pytest.MonkeyPatch) -> None:
    """The command configures GDAL from the environment: the tests keep it on one thread."""
    monkeypatch.setenv("GDAL_NUM_THREADS", "1")


def test_happy_path_a_job_that_reaches_approval_exits_ok(world: PipelineWorld) -> None:
    world.seed_import()
    steps = {name: Passing(name) for name in default_steps()}

    assert command(world, steps).run(context(world.config)) is Outcome.DONE
    assert world.job(JOB_ID)["status"] == "awaiting_approval"


def test_bad_path_a_failed_job_exits_with_the_failure_code(world: PipelineWorld) -> None:
    world.seed_import()

    with pytest.raises(StepError) as caught:
        command(world, {**{name: Passing(name) for name in default_steps()}, "fetch": Failing()}).run(context(world.config))

    assert caught.value.exit_code == ExitCode.FAILED


def test_happy_path_a_job_another_execution_holds_exits_ok(world: PipelineWorld) -> None:
    assert command(world, {}).run(context(world.config)) is Outcome.DONE


def test_happy_path_the_emulated_world_uses_the_emulators_and_test_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080")
    config = load_config(EMULATED)

    services = build(config)

    assert isinstance(services.store, FirestoreStore)
    assert isinstance(services.objects, GcsObjectStore)
    assert isinstance(services.secrets, EmulatorSecrets)
    assert services.m2m().__class__.__name__ == "M2MClient"
    assert _storage_url(config) == "http://127.0.0.1:9199"
    assert isinstance(_tokens(config), EmulatorTokens)


def test_happy_path_cloud_run_uses_secret_manager_and_default_credentials() -> None:
    config = load_config(VALID_ENV)
    with httpx.Client() as client:
        assert isinstance(_secrets(config, client), SecretManager)
    assert isinstance(_tokens(config), GoogleTokens)
    assert _storage_url(config) == GCS_BASE_URL
    assert set(default_steps()) == set(PIPELINE_STEPS)
    assert {"align", "merge", "warp", "export", "pyramid", "register"} <= set(default_steps())
    assert http().follow_redirects is False


def test_bad_path_under_the_emulators_the_delivery_client_stays_on_the_machine() -> None:
    client = delivery_client(load_config(EMULATED))
    hook = client.event_hooks["request"][0]

    hook(httpx.Request("GET", "http://127.0.0.1:4311/h/dds.cr.usgs.gov/e2e/download/1?sig=x"))
    with pytest.raises(AddressRefusedError, match="off this machine under the emulators"):
        hook(httpx.Request("GET", "https://dds.cr.usgs.gov/e2e/download/1?sig=x"))
    client.close()


def test_happy_path_the_delivery_client_follows_redirects_through_the_guard() -> None:
    hook = guarded(False, lambda _host: ["52.218.152.1"])
    client = delivery_client(load_config(VALID_ENV))

    hook(httpx.Request("GET", "https://dds.cr.usgs.gov/download/x.tgz"))

    assert client.follow_redirects is True
    with pytest.raises(AddressRefusedError, match="not public"):
        guarded(False, lambda _host: ["169.254.169.254"])(httpx.Request("GET", "https://redirect.example/x"))
    with pytest.raises(AddressRefusedError, match="not an https address"):
        hook(httpx.Request("GET", "http://dds.cr.usgs.gov/download/x.tgz"))
