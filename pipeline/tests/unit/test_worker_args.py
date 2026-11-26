"""The worker's command line and its addresses (M7, docs/research/M7-local-worker.md §1.1)."""

from pathlib import Path

import pytest
from hcm_pipeline.config import DEFAULT_OVERPASS_URL, DEFAULT_STAC_URL, ConfigError
from hcm_pipeline.worker.args import DEFAULT_PORT, Endpoints, admin_site_id, parse_worker_args

LOOPBACK = {
    "FIREBASE_AUTH_EMULATOR_HOST": "127.0.0.1:9099",
    "FUNCTIONS_EMULATOR_HOST": "127.0.0.1:5001",
    "HCM_HOSTING_HOST": "127.0.0.1:4312",
    "HCM_STAC_URL": "http://127.0.0.1:4311/h/earth-search.aws.element84.com/v1/",
    "HCM_OVERPASS_URL": "http://127.0.0.1:4311/h/overpass-api.de/api/interpreter",
}


def test_happy_path_the_city_and_the_project_are_all_the_cloud_worker_needs() -> None:
    args = parse_worker_args({"city": "bucharest", "project": "demo-hcm"}, {})

    assert (args.city, args.project, args.port, args.work, args.emulators) == ("bucharest", "demo-hcm", DEFAULT_PORT, Path("/work"), False)
    assert (args.stac_url, args.overpass_url) == (DEFAULT_STAC_URL, DEFAULT_OVERPASS_URL)
    assert args.endpoints == Endpoints(
        functions="https://us-central1-demo-hcm.cloudfunctions.net/",
        securetoken="https://securetoken.googleapis.com/v1/token",
        init_json="https://demo-hcm.web.app/__/firebase/init.json",
        custom_token="https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken",
        referer="https://demo-hcm.web.app/",
        hosting_origins=(
            "https://demo-hcm.web.app",
            "https://demo-hcm.firebaseapp.com",
            "https://demo-hcm-admin.web.app",
            "https://demo-hcm-admin.firebaseapp.com",
        ),
    )
    assert args.pair is None
    assert (args.supervised, args.image) == (False, None)
    assert args.endpoints.function("worker-claim") == "https://us-central1-demo-hcm.cloudfunctions.net/worker-claim"


def test_happy_path_the_admins_command_carries_its_pairing_code() -> None:
    args = parse_worker_args({"city": "bucharest", "project": "demo-hcm", "pair": "abcdefghijklmnopqrstuvwxyz"}, {})

    assert args.pair == "abcdefghijklmnopqrstuvwxyz"


def test_happy_path_the_starters_supervisor_names_the_image_it_runs() -> None:
    digest = "sha256:" + "e7" * 32
    args = parse_worker_args({"city": "bucharest", "project": "demo-hcm", "supervised": True, "image": digest}, {})

    assert (args.supervised, args.image, args.pair) == (True, digest, None)


def test_happy_path_under_the_emulators_every_address_is_this_machine() -> None:
    options = {"city": "bacau", "project": "demo-hcm", "port": 0, "work": "/tmp/hcm-work", "emulators": True}

    args = parse_worker_args(options, LOOPBACK)

    assert (args.port, args.work, args.emulators) == (0, Path("/tmp/hcm-work"), True)
    assert args.endpoints == Endpoints(
        functions="http://127.0.0.1:5001/demo-hcm/us-central1/",
        securetoken="http://127.0.0.1:9099/securetoken.googleapis.com/v1/token",
        init_json="http://127.0.0.1:4312/__/firebase/init.json",
        custom_token="http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken",
        referer="http://127.0.0.1:4312/",
        auth_emulator="127.0.0.1:9099",
        hosting_origins=("http://127.0.0.1:4312",),
    )
    assert args.stac_url == "http://127.0.0.1:4311/h/earth-search.aws.element84.com/v1"


@pytest.mark.parametrize(
    ("options", "problem"),
    [
        ({"project": "demo-hcm"}, "--city must be a city id"),
        ({"city": "Bucharest!", "project": "demo-hcm"}, "--city must be a city id"),
        ({"city": "bucharest"}, "--project must be a Google Cloud project id"),
        ({"city": "bucharest", "project": "demo-hcm", "port": 70000}, "--port must be a port number"),
        ({"city": "bucharest", "project": "demo-hcm", "work": ""}, "--work must name a folder"),
        ({"city": "bucharest", "project": "demo-hcm", "pair": "ABC"}, "--pair must be the admin's pairing code"),
        ({"city": "bucharest", "project": "demo-hcm", "image": "latest"}, "--image must be sha256:<digest>"),
    ],
)
def test_bad_path_a_bad_option_is_named(options: dict[str, object], problem: str) -> None:
    with pytest.raises(ConfigError) as caught:
        parse_worker_args(options, {})

    assert any(found.startswith(problem) for found in caught.value.problems)


def test_bad_path_under_the_emulators_every_variable_must_be_a_loopback_address() -> None:
    env = {**LOOPBACK, "FUNCTIONS_EMULATOR_HOST": "functions.example:5001", "HCM_STAC_URL": "https://earth-search.aws.element84.com/v1"}
    del env["HCM_HOSTING_HOST"]

    with pytest.raises(ConfigError) as caught:
        parse_worker_args({"city": "bucharest", "project": "demo-hcm", "emulators": True}, env)

    assert caught.value.problems == (
        "FUNCTIONS_EMULATOR_HOST must be a loopback host:port",
        "HCM_HOSTING_HOST must be a loopback host:port",
        "HCM_STAC_URL must be a loopback address under the emulators",
    )


def test_bad_path_a_malformed_or_mapbox_reference_is_refused() -> None:
    env = {"HCM_STAC_URL": "http://[::1", "HCM_OVERPASS_URL": "https://api.mapbox.com/v4"}

    with pytest.raises(ConfigError) as caught:
        parse_worker_args({"city": "bucharest", "project": "demo-hcm", "emulators": True}, {**LOOPBACK, **env})

    assert "HCM_STAC_URL must be a loopback address under the emulators" in caught.value.problems
    assert any("Mapbox" in problem for problem in caught.value.problems)


@pytest.mark.parametrize(
    ("project", "site"),
    [
        ("bucurestiul-disparut", "bucurestiul-disparut-admin"),
        ("demo-hcm", "demo-hcm-admin"),
        ("a-project-id-of-24-chars", "a-project-id-of-24-chars-admin"),
        ("a-project-id-of-twenty-five", "a-project-id-of-twenty-f-admin"),
        ("project-with-hyphen-at-24-x", "project-with-hyphen-at-2-admin"),
        ("abcdefghijklmnopqrstuvw--xyz0", "abcdefghijklmnopqrstuvw-admin"),
    ],
)
def test_admin_site_id_names_the_same_site_as_the_admin(project: str, site: str) -> None:
    """§210: the twin of `adminSiteId` (`packages/shared/test/schemas/admin-site.test.ts`), case for case."""
    assert admin_site_id(project) == site
