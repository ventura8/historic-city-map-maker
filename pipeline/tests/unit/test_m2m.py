"""The USGS M2M client against respx-mocked HTTP: envelope parsing, error mapping, session handling."""

import io
import json
from collections.abc import Iterator
from datetime import UTC, datetime
from email.utils import format_datetime

import httpx
import pytest
import respx
from hcm_pipeline.m2m import (
    AUTH_HEADER,
    DEFAULT_BASE_URL,
    RELOGIN_AFTER_SECONDS,
    AuthError,
    Credentials,
    M2MClient,
    M2MError,
    MaintenanceError,
    ProtocolError,
    RateLimitError,
    UnreachableError,
    http_client,
    parse_response,
    parse_retry_after,
)

NOW = 1_800_000_000.0
APP_TOKEN = "e2e-ok"
CREDENTIALS = Credentials("ers-user", APP_TOKEN)
HTML = {"content-type": "text/html; charset=utf-8"}


def envelope(data: object = None, error_code: str | None = None, error_message: str | None = None) -> dict[str, object]:
    return {"requestId": 7, "version": "stable", "data": data, "errorCode": error_code, "errorMessage": error_message}


def answer(status: int, *, json_body: object = None, text: str | None = None, headers: dict[str, str] | None = None) -> httpx.Response:
    request = httpx.Request("POST", f"{DEFAULT_BASE_URL}scene-search")
    if text is not None:
        return httpx.Response(status, text=text, headers=headers or HTML, request=request)
    return httpx.Response(status, json=json_body, headers=headers, request=request)


class FakeClock:
    def __init__(self) -> None:
        self.now = NOW

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def m2m_api() -> Iterator[respx.MockRouter]:
    """M2M with login-token issuing key-1, key-2, ... and a working logout (routes `login`, `logout`)."""
    with respx.mock(base_url=DEFAULT_BASE_URL, assert_all_called=False) as router:
        router.post("login-token", name="login").mock(side_effect=[httpx.Response(200, json=envelope(f"key-{n}")) for n in range(1, 6)])
        router.post("logout", name="logout").respond(json=envelope())
        yield router


# --- parse_retry_after -----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, None),
        ("120", 120.0),
        (" 7 ", 7.0),
        (format_datetime(datetime.fromtimestamp(NOW + 90, UTC), usegmt=True), 90.0),
        (format_datetime(datetime.fromtimestamp(NOW - 90, UTC), usegmt=True), 0.0),
        ("soon", None),
        ("-5", None),
    ],
)
def test_happy_path_retry_after_reads_seconds_and_http_dates(value: str | None, expected: float | None) -> None:
    assert parse_retry_after(value, NOW) == expected


# --- parse_response --------------------------------------------------------------------------


def test_happy_path_success_envelope_returns_data() -> None:
    assert parse_response(answer(200, json_body=envelope({"results": [1, 2]})), NOW) == {"results": [1, 2]}


def test_happy_path_success_envelope_with_null_data_returns_none() -> None:
    assert parse_response(answer(200, json_body=envelope()), NOW) is None


@pytest.mark.parametrize(
    ("response", "error_type", "error_code"),
    [
        (answer(500, json_body=envelope(error_code="AUTH_INVALID", error_message="bad credentials")), AuthError, "AUTH_INVALID"),
        (answer(500, json_body=envelope(error_code="AUTH_KEY_INVALID")), AuthError, "AUTH_KEY_INVALID"),
        (answer(500, json_body=envelope(error_code="RATE_LIMIT", error_message="slow down")), RateLimitError, "RATE_LIMIT"),
        (answer(200, json_body=envelope(error_code="RATE_LIMIT_USER_DL")), RateLimitError, "RATE_LIMIT_USER_DL"),
        (answer(429, json_body=envelope()), RateLimitError, None),
        (answer(500, json_body=envelope(error_code="DATASET_INVALID")), M2MError, "DATASET_INVALID"),
        (answer(502, json_body=envelope()), ProtocolError, None),
        (answer(200, json_body=[1, 2]), ProtocolError, None),
        (answer(403, text="<html>Forbidden</html>"), AuthError, None),
        (answer(503, text="<html>Application Offline</html>"), MaintenanceError, None),
        (answer(429, text="Too Many Requests", headers={"content-type": "text/plain"}), RateLimitError, None),
        (answer(200, text="<html>login</html>"), ProtocolError, None),
        (answer(500, text=""), ProtocolError, None),
    ],
)
def test_bad_path_error_answers_map_to_typed_errors(response: httpx.Response, error_type: type[M2MError], error_code: str | None) -> None:
    with pytest.raises(M2MError) as caught:
        parse_response(response, NOW)

    assert type(caught.value) is error_type
    assert caught.value.error_code == error_code


def test_bad_path_error_message_names_endpoint_code_and_usgs_message() -> None:
    with pytest.raises(AuthError, match=r"^USGS M2M /api/api/json/stable/scene-search AUTH_INVALID: bad credentials$"):
        parse_response(answer(500, json_body=envelope(error_code="AUTH_INVALID", error_message="bad credentials")), NOW)


def test_bad_path_error_without_usgs_message_says_so() -> None:
    with pytest.raises(ProtocolError, match="HTTP 502: no error message"):
        parse_response(answer(502, json_body=envelope()), NOW)


def test_bad_path_maintenance_page_carries_retry_after() -> None:
    with pytest.raises(MaintenanceError) as caught:
        parse_response(answer(503, text="<html>Application Offline</html>", headers={**HTML, "Retry-After": "1800"}), NOW)

    assert caught.value.retry_after == 1800.0
    assert "answered HTTP 503 with text/html; charset=utf-8 instead of JSON" in str(caught.value)


def test_bad_path_rate_limit_carries_retry_after() -> None:
    with pytest.raises(RateLimitError) as caught:
        parse_response(answer(429, json_body=envelope(error_code="RATE_LIMIT"), headers={"Retry-After": "30"}), NOW)

    assert caught.value.retry_after == 30.0


def test_bad_path_page_without_content_type_says_so() -> None:
    response = httpx.Response(503, content=b"offline", request=httpx.Request("POST", f"{DEFAULT_BASE_URL}logout"))

    with pytest.raises(MaintenanceError, match="with no content type instead of JSON"):
        parse_response(response, NOW)


# --- M2MClient -------------------------------------------------------------------------------


def test_happy_path_session_logs_in_requests_with_key_and_logs_out(m2m_api: respx.MockRouter) -> None:
    search = m2m_api.post("scene-search").respond(json=envelope({"totalHits": 1}))

    with http_client() as http, M2MClient(http, CREDENTIALS, clock=FakeClock()) as m2m:
        assert m2m.logged_in
        assert m2m.request("scene-search", {"datasetName": "corona2"}) == {"totalHits": 1}

    login = m2m_api["login"].calls.last.request
    assert json.loads(login.content) == {"username": "ers-user", "token": APP_TOKEN}
    assert AUTH_HEADER not in login.headers
    assert search.calls.last.request.headers[AUTH_HEADER] == "key-1"
    assert json.loads(search.calls.last.request.content) == {"datasetName": "corona2"}
    assert m2m_api["logout"].calls.last.request.headers[AUTH_HEADER] == "key-1"
    assert not m2m.logged_in


def test_happy_path_request_without_payload_sends_an_empty_object(m2m_api: respx.MockRouter) -> None:
    permissions = m2m_api.post("permissions").respond(json=envelope(["download"]))

    with http_client() as http:
        assert M2MClient(http, CREDENTIALS, clock=FakeClock()).request("permissions") == ["download"]

    assert json.loads(permissions.calls.last.request.content) == {}


def test_happy_path_key_is_renewed_after_100_minutes_not_before(m2m_api: respx.MockRouter) -> None:
    search = m2m_api.post("scene-search").respond(json=envelope([]))
    clock = FakeClock()

    with http_client() as http:
        m2m = M2MClient(http, CREDENTIALS, clock=clock)
        m2m.request("scene-search")
        clock.now += RELOGIN_AFTER_SECONDS - 1
        m2m.request("scene-search")
        clock.now += 1
        m2m.request("scene-search")

    assert [call.request.headers[AUTH_HEADER] for call in search.calls] == ["key-1", "key-1", "key-2"]


def test_happy_path_rejected_key_logs_in_once_more_and_retries(m2m_api: respx.MockRouter, log_stream: io.StringIO) -> None:
    search = m2m_api.post("scene-search").mock(
        side_effect=[httpx.Response(403, text="<html>Forbidden</html>", headers=HTML), httpx.Response(200, json=envelope("ok"))]
    )

    with http_client() as http:
        assert M2MClient(http, CREDENTIALS, clock=FakeClock()).request("scene-search") == "ok"

    assert [call.request.headers[AUTH_HEADER] for call in search.calls] == ["key-1", "key-2"]
    assert "rejected the API key on scene-search" in log_stream.getvalue()
    assert "key-1" not in log_stream.getvalue()


def test_bad_path_key_rejected_twice_raises_auth_error(m2m_api: respx.MockRouter) -> None:
    m2m_api.post("scene-search").respond(403, text="<html>Forbidden</html>", headers=HTML)

    with http_client() as http, pytest.raises(AuthError):
        M2MClient(http, CREDENTIALS, clock=FakeClock()).request("scene-search")


def test_bad_path_bad_credentials_raise_auth_error_without_retry() -> None:
    with respx.mock(base_url=DEFAULT_BASE_URL) as router:
        login = router.post("login-token").respond(500, json=envelope(error_code="AUTH_INVALID", error_message="Invalid credentials"))
        with http_client() as http, pytest.raises(AuthError, match="AUTH_INVALID"):
            M2MClient(http, Credentials("ers-user", "e2e-bad")).login()

    assert login.call_count == 1


@pytest.mark.parametrize("data", [None, "", 42])
def test_bad_path_login_without_api_key_is_a_protocol_error(data: object) -> None:
    with respx.mock(base_url=DEFAULT_BASE_URL) as router:
        router.post("login-token").respond(json=envelope(data))
        with http_client() as http, pytest.raises(ProtocolError, match="returned no API key"):
            M2MClient(http, CREDENTIALS).login()


def test_bad_path_network_failure_is_a_transport_failure() -> None:
    with respx.mock(base_url=DEFAULT_BASE_URL) as router:
        router.post("login-token").mock(side_effect=httpx.ConnectError("connection refused"))
        with http_client() as http, pytest.raises(UnreachableError, match="login-token: ConnectError"):
            M2MClient(http, CREDENTIALS).login()


def test_happy_path_logout_without_session_calls_nothing(m2m_api: respx.MockRouter) -> None:
    with http_client() as http:
        M2MClient(http, CREDENTIALS).logout()

    assert not m2m_api["logout"].called


def test_bad_path_failed_logout_is_logged_not_raised(m2m_api: respx.MockRouter, log_stream: io.StringIO) -> None:
    m2m_api["logout"].respond(503, text="<html>Application Offline</html>", headers=HTML)

    with http_client() as http:
        m2m = M2MClient(http, CREDENTIALS, clock=FakeClock())
        m2m.login()
        m2m.logout()

    assert not m2m.logged_in
    assert "logout failed (MaintenanceError)" in log_stream.getvalue()


def test_happy_path_credentials_repr_hides_the_token() -> None:
    assert APP_TOKEN not in repr(CREDENTIALS)
    assert "ers-user" in repr(CREDENTIALS)


def test_happy_path_http_client_targets_m2m_without_redirects() -> None:
    with http_client("http://127.0.0.1:9/api/", timeout=5.0) as http:
        assert str(http.base_url) == "http://127.0.0.1:9/api/"
        assert http.follow_redirects is False
        assert http.timeout.read == 5.0
        assert http.headers["User-Agent"] == "hcm-pipeline/0.0.0"
