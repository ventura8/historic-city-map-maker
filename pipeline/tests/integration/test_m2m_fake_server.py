"""The M2M client over real HTTP against the fake USGS M2M server (loopback only)."""

import httpx
import pytest
from hcm_pipeline.m2m import RELOGIN_AFTER_SECONDS, AuthError, Credentials, M2MClient, MaintenanceError, RateLimitError, http_client

from tests.fakes.usgs_m2m import FORBIDDEN_PAGE, GOOD_TOKEN, MAINTENANCE_PAGE, FakeM2MServer, Reply

GOOD = Credentials("ers-user", GOOD_TOKEN)


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_happy_path_search_inside_a_session(fake_m2m: FakeM2MServer) -> None:
    fake_m2m.set_data("scene-search", {"totalHits": 1, "results": [{"entityId": "DS1105-1057DA024"}]})

    with http_client(fake_m2m.base_url) as http, M2MClient(http, GOOD) as m2m:
        data = m2m.request("scene-search", {"datasetName": "corona2"})

    login, search, logout = fake_m2m.calls
    assert data == {"totalHits": 1, "results": [{"entityId": "DS1105-1057DA024"}]}
    assert (login.endpoint, login.api_key, login.body) == ("login-token", None, {"username": "ers-user", "token": GOOD_TOKEN})
    assert (search.endpoint, search.api_key, search.body) == ("scene-search", "fake-key-1", {"datasetName": "corona2"})
    assert (logout.endpoint, logout.api_key) == ("logout", "fake-key-1")


def test_bad_path_wrong_application_token_is_an_auth_error(fake_m2m: FakeM2MServer) -> None:
    with http_client(fake_m2m.base_url) as http, pytest.raises(AuthError) as caught:
        M2MClient(http, Credentials("ers-user", "e2e-bad")).login()

    assert caught.value.error_code == "AUTH_INVALID"
    assert fake_m2m.endpoints() == ["login-token"]


def test_bad_path_maintenance_page_is_a_maintenance_error_with_retry_after(fake_m2m: FakeM2MServer) -> None:
    fake_m2m.enqueue("scene-search", Reply.page(503, MAINTENANCE_PAGE, {"Retry-After": "1800"}))

    with http_client(fake_m2m.base_url) as http, M2MClient(http, GOOD) as m2m, pytest.raises(MaintenanceError) as caught:
        m2m.request("scene-search")

    assert caught.value.retry_after == 1800.0
    assert fake_m2m.endpoints() == ["login-token", "scene-search", "logout"]


def test_bad_path_rate_limit_is_rate_limited_with_retry_after(fake_m2m: FakeM2MServer) -> None:
    fake_m2m.enqueue("download-options", Reply.envelope(error_code="RATE_LIMIT", status=429, headers={"Retry-After": "5"}))

    with http_client(fake_m2m.base_url) as http, M2MClient(http, GOOD) as m2m, pytest.raises(RateLimitError) as caught:
        m2m.request("download-options", {"entityIds": ["DS1105-1057DA024"]})

    assert caught.value.retry_after == 5.0


def test_happy_path_expired_key_gets_the_403_page_then_a_fresh_login(fake_m2m: FakeM2MServer) -> None:
    with http_client(fake_m2m.base_url) as http, M2MClient(http, GOOD) as m2m:
        m2m.request("scene-search")
        fake_m2m.expire_keys()
        m2m.request("scene-search")

    keys = [(call.endpoint, call.api_key) for call in fake_m2m.calls]
    assert keys == [
        ("login-token", None),
        ("scene-search", "fake-key-1"),
        ("scene-search", "fake-key-1"),
        ("login-token", None),
        ("scene-search", "fake-key-2"),
        ("logout", "fake-key-2"),
    ]


def test_happy_path_key_older_than_100_minutes_is_renewed_before_the_call(fake_m2m: FakeM2MServer) -> None:
    clock = FakeClock()

    with http_client(fake_m2m.base_url) as http, M2MClient(http, GOOD, clock=clock) as m2m:
        clock.now = RELOGIN_AFTER_SECONDS
        m2m.request("scene-search")

    assert fake_m2m.endpoints() == ["login-token", "login-token", "scene-search", "logout"]


def test_bad_path_call_without_key_gets_the_usgs_403_page(fake_m2m: FakeM2MServer) -> None:
    with http_client(fake_m2m.base_url) as http:
        response = http.post("scene-search", json={})

    assert response.status_code == 403
    assert response.text == FORBIDDEN_PAGE


def test_happy_path_reset_endpoint_forgets_everything(fake_m2m: FakeM2MServer) -> None:
    fake_m2m.enqueue("scene-search", Reply.page(503, MAINTENANCE_PAGE))
    with http_client(fake_m2m.base_url) as http, M2MClient(http, GOOD):
        pass

    reset = httpx.post(f"{fake_m2m.root_url}/__reset")

    assert reset.status_code == 200
    assert fake_m2m.calls == []
    with http_client(fake_m2m.base_url) as http, M2MClient(http, GOOD) as m2m:
        assert m2m.request("scene-search") is None
