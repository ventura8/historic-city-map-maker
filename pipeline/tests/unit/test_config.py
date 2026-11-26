"""Job configuration from the environment: complete, validated, and never echoing a value back."""

import pytest
from hcm_pipeline.config import DEFAULT_M2M_BASE_URL, Config, ConfigError, config_problems, load_config

from tests.fakes.environment import VALID_ENV


def env_with(**overrides: str) -> dict[str, str]:
    return {**VALID_ENV, **overrides}


def test_happy_path_complete_environment_loads_with_defaults() -> None:
    config = load_config(VALID_ENV)

    assert config == Config(
        job_id="job-2026-10-11_a",
        city_id="bucharest",
        project_id="demo-hcm",
        private_bucket="demo-hcm.firebasestorage.app",
        public_bucket="demo-hcm-public",
        m2m_base_url=DEFAULT_M2M_BASE_URL,
        execution="local",
        task_attempt=0,
    )
    assert config.lease_owner == "local/0"


def test_happy_path_cloud_run_variables_name_the_lease_owner() -> None:
    config = load_config(env_with(CLOUD_RUN_EXECUTION="raster-pipeline-x7k2p", CLOUD_RUN_TASK_ATTEMPT="2"))

    assert config.lease_owner == "raster-pipeline-x7k2p/2"


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://m2m.cr.usgs.gov/api/api/json/stable", "https://m2m.cr.usgs.gov/api/api/json/stable/"),
        ("http://127.0.0.1:8123/api/api/json/stable/", "http://127.0.0.1:8123/api/api/json/stable/"),
        ("http://localhost:8123/m2m", "http://localhost:8123/m2m/"),
    ],
)
def test_happy_path_m2m_base_url_is_normalised(url: str, expected: str) -> None:
    assert load_config(env_with(USGS_M2M_BASE_URL=url)).m2m_base_url == expected


def test_bad_path_empty_environment_lists_every_missing_variable() -> None:
    with pytest.raises(ConfigError) as caught:
        load_config({})

    assert caught.value.problems == (
        "JOB_ID is not set",
        "CITY_ID is not set",
        "GOOGLE_CLOUD_PROJECT is not set",
        "HCM_PRIVATE_BUCKET is not set",
        "HCM_PUBLIC_BUCKET is not set",
    )
    assert str(caught.value).startswith("JOB_ID is not set; CITY_ID is not set")


@pytest.mark.parametrize(
    ("name", "value", "problem"),
    [
        ("JOB_ID", "../../etc", "JOB_ID must be an id of letters, digits, '_' and '-'"),
        ("CITY_ID", "bucharest/../x", "CITY_ID must be a city id of lowercase letters, digits and '-'"),
        ("CITY_ID", "Bucharest", "CITY_ID must be a city id of lowercase letters, digits and '-'"),
        ("HCM_E2E_USGS_TOKEN", "real-looking-value", "HCM_E2E_USGS_TOKEN must be one of the scenario test values"),
        ("GOOGLE_CLOUD_PROJECT", "Demo_Project", "GOOGLE_CLOUD_PROJECT must be a Google Cloud project id"),
        ("HCM_PRIVATE_BUCKET", "gs://bucket", "HCM_PRIVATE_BUCKET must be a Cloud Storage bucket name"),
        ("HCM_PUBLIC_BUCKET", "UPPER", "HCM_PUBLIC_BUCKET must be a Cloud Storage bucket name"),
        ("CLOUD_RUN_TASK_ATTEMPT", "-1", "CLOUD_RUN_TASK_ATTEMPT must be a non-negative integer"),
        ("CLOUD_RUN_TASK_ATTEMPT", "²", "CLOUD_RUN_TASK_ATTEMPT must be a non-negative integer"),
    ],
)
def test_bad_path_invalid_value_is_named_but_not_echoed(name: str, value: str, problem: str) -> None:
    problems = config_problems(env_with(**{name: value}))

    assert problems == [problem]
    assert value not in problem


@pytest.mark.parametrize(
    "url",
    [
        "http://m2m.cr.usgs.gov/api/api/json/stable/",
        "ftp://127.0.0.1/",
        "https:///no-host",
        "https://[::1",
        "m2m.cr.usgs.gov",
    ],
)
def test_bad_path_m2m_base_url_must_be_https_or_loopback_http(url: str) -> None:
    assert config_problems(env_with(USGS_M2M_BASE_URL=url)) == [
        "USGS_M2M_BASE_URL must be an https:// URL (http:// only for a loopback test server)"
    ]


def test_happy_path_reference_services_default_to_earth_search_and_overpass() -> None:
    config = load_config(VALID_ENV)

    assert config.stac_url == "https://earth-search.aws.element84.com/v1"
    assert config.overpass_url == "https://overpass-api.de/api/interpreter"
    assert not config.emulated
    assert config.e2e_usgs_scenario == "e2e-ok"


LOOPBACK_SERVICES = {
    "USGS_M2M_BASE_URL": "http://127.0.0.1:9000/api/api/json/stable/",
    "HCM_STAC_URL": "http://127.0.0.1:9001/stac/",
    "HCM_OVERPASS_URL": "http://127.0.0.1:9002/api/interpreter",
}


@pytest.mark.parametrize(
    ("name", "value", "problem"),
    [
        ("FIRESTORE_EMULATOR_HOST", "10.0.0.5:8080", "FIRESTORE_EMULATOR_HOST must be a loopback host:port"),
        ("STORAGE_EMULATOR_HOST", "storage.example:9199", "STORAGE_EMULATOR_HOST must be a loopback host:port"),
    ],
)
def test_bad_path_an_emulator_off_the_machine_is_named(name: str, value: str, problem: str) -> None:
    assert config_problems(env_with(**LOOPBACK_SERVICES, **{name: value})) == [problem]


def test_bad_path_under_the_emulators_every_service_root_must_be_on_loopback() -> None:
    """The e2e tier's pipeline never reaches a real USGS, STAC or Overpass: with an emulator, the defaults are refused."""
    problems = config_problems(env_with(STORAGE_EMULATOR_HOST="127.0.0.1:9199", HCM_STAC_URL="http://127.0.0.1:9001/stac/"))

    assert problems == [
        "USGS_M2M_BASE_URL must be a loopback address under the emulators",
        "HCM_OVERPASS_URL must be a loopback address under the emulators",
    ]


def test_happy_path_loopback_test_servers_and_emulators_are_accepted() -> None:
    config = load_config(
        env_with(
            USGS_M2M_BASE_URL="http://127.0.0.1:9000/api/api/json/stable/",
            HCM_STAC_URL="http://127.0.0.1:9001/stac/",
            HCM_OVERPASS_URL="http://127.0.0.1:9002/api/interpreter",
            FIRESTORE_EMULATOR_HOST="127.0.0.1:8080",
            STORAGE_EMULATOR_HOST="localhost:9199",
            HCM_E2E_USGS_TOKEN="e2e-m2m-pending",
        )
    )

    assert config.stac_url == "http://127.0.0.1:9001/stac"
    assert config.emulated
    assert (config.firestore_emulator, config.storage_emulator) == ("127.0.0.1:8080", "localhost:9199")
    assert config.e2e_usgs_scenario == "e2e-m2m-pending"


@pytest.mark.parametrize(
    ("name", "url"),
    [
        ("HCM_STAC_URL", "https://api.mapbox.com/v4/mapbox.satellite"),
        ("HCM_OVERPASS_URL", "https://a.tiles.mapbox.com/v4"),
        ("HCM_STAC_URL", "https://studio.MAPBOX.cn/"),
    ],
)
def test_bad_path_a_mapbox_address_is_never_a_reference(name: str, url: str) -> None:
    """Mapbox Satellite is never used to align imagery (Mapbox terms): a Mapbox host is refused outright."""
    assert config_problems(env_with(**{name: url})) == [
        f"{name} must not be a Mapbox address (Mapbox imagery is never a georeferencing reference)"
    ]


@pytest.mark.parametrize(("name", "url"), [("HCM_STAC_URL", "http://earth-search.example/v1"), ("HCM_OVERPASS_URL", "ftp://127.0.0.1/")])
def test_bad_path_reference_services_must_be_https_or_loopback_http(name: str, url: str) -> None:
    assert config_problems(env_with(**{name: url})) == [f"{name} must be an https:// URL (http:// only for a loopback test server)"]
