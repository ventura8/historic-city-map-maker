"""The worker's callables over HTTP and USGS through the server (M7, docs/research/M7-local-worker.md §2.4, §2.5)."""

import json
from collections.abc import Callable

import httpx
import pytest
from hcm_pipeline.jobs import LeaseLostError
from hcm_pipeline.m2m import AuthError, M2MError, MaintenanceError, RateLimitError
from hcm_pipeline.secrets import SecretUnavailableError
from hcm_pipeline.worker.api import WorkerApi, WorkerApiError
from hcm_pipeline.worker.documents import JobIds
from hcm_pipeline.worker.m2m_proxy import ProxyM2MSession

IDS = JobIds("bucharest", "w-0123456789abcdef", "job-1")
Handler = Callable[[httpx.Request], httpx.Response]


def coded(code: str, status: int = 400, name: str = "FAILED_PRECONDITION") -> httpx.Response:
    return httpx.Response(status, json={"error": {"message": f"refused {code}", "status": name, "details": {"code": code}}})


def api(handler: Handler, sleeps: list[float] | None = None) -> WorkerApi:
    client = httpx.Client(transport=httpx.MockTransport(handler))
    record: list[float] = [] if sleeps is None else sleeps
    return WorkerApi(client, lambda name: f"https://us-central1-demo-hcm.cloudfunctions.net/{name}", lambda: "session-token", record.append)


def test_happy_path_a_call_posts_the_callable_envelope_with_the_session_token() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"result": {"pollSeconds": 30}})

    worker_api = api(handler)

    assert worker_api.call("worker-hello", {"cityId": "bucharest"}) == {"pollSeconds": 30}
    assert worker_api.call("worker-hello", {}, token="checked-token") == {"pollSeconds": 30}
    assert str(seen[0].url) == "https://us-central1-demo-hcm.cloudfunctions.net/worker-hello"
    assert json.loads(seen[0].content) == {"data": {"cityId": "bucharest"}}
    assert [request.headers["authorization"] for request in seen] == ["Bearer session-token", "Bearer checked-token"]


@pytest.mark.parametrize(
    ("answer", "code"),
    [
        (coded("apiError.worker.refused"), "apiError.worker.refused"),
        (httpx.Response(401, json={"error": {"message": "no", "status": "UNAUTHENTICATED"}}), "apiError.unauthenticated"),
        (httpx.Response(500, text="<html>oops</html>"), "apiError.internal"),
        (httpx.Response(200, json={"no": "result"}), "apiError.internal"),
    ],
)
def test_bad_path_a_refusal_carries_its_code(answer: httpx.Response, code: str) -> None:
    with pytest.raises(WorkerApiError) as caught:
        api(lambda _request: answer).call("worker-step", {})

    assert caught.value.code == code


def test_bad_path_an_invalid_request_names_the_fields_the_server_refused() -> None:
    """Scenarios: S-A62-BAD-NAMED-FIELD"""
    issues = [{"path": f"help.stitched.leftOut.{index}.name", "code": "validation.tooBig"} for index in range(7)]
    details = {"code": "apiError.invalidRequest", "params": {"count": "7"}, "issues": issues}
    answer = httpx.Response(400, json={"error": {"message": "apiError.invalidRequest", "status": "INVALID_ARGUMENT", "details": details}})

    with pytest.raises(WorkerApiError) as caught:
        api(lambda _request: answer).call("worker-step", {})

    assert caught.value.code == "apiError.invalidRequest"
    assert "help.stitched.leftOut.0.name (validation.tooBig)" in str(caught.value)
    assert "leftOut.4.name" in str(caught.value)
    assert "leftOut.5.name" not in str(caught.value)


def test_bad_path_a_refusal_of_the_whole_value_says_so() -> None:
    details = {"code": "apiError.invalidRequest", "issues": [{"path": "", "code": "validation.value"}, "not a record"]}
    answer = httpx.Response(400, json={"error": {"message": "apiError.invalidRequest", "status": "INVALID_ARGUMENT", "details": details}})

    with pytest.raises(WorkerApiError, match=r"\(the value\) \(validation.value\), \(the value\) \(None\)"):
        api(lambda _request: answer).call("worker-step", {})


def test_bad_path_not_holder_is_a_lost_lease() -> None:
    with pytest.raises(LeaseLostError, match="no longer holds the job"):
        api(lambda _request: coded("apiError.worker.notHolder")).call("worker-step", {})


def test_happy_path_an_unreachable_server_is_tried_again() -> None:
    answers: list[httpx.Response | None] = [None, httpx.Response(503, text="busy"), httpx.Response(200, json={"result": {"ok": True}})]
    sleeps: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        answer = answers.pop(0)
        if answer is None:
            raise httpx.ConnectError("down", request=request)
        return answer

    assert api(handler, sleeps).call("worker-step", {}) == {"ok": True}
    assert sleeps == [2.0, 4.0]


def test_bad_path_a_server_that_never_answers_is_unavailable() -> None:
    sleeps: list[float] = []

    with pytest.raises(WorkerApiError) as caught:
        api(lambda _request: httpx.Response(502, text="bad gateway"), sleeps).call("worker-claim", {})

    assert caught.value.code == "apiError.unavailable"
    assert sleeps == [2.0, 4.0]


def test_bad_path_a_coded_unavailable_is_the_callables_own_answer_and_not_tried_again() -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return coded("apiError.usgs.maintenance", 503, "UNAVAILABLE")

    with pytest.raises(WorkerApiError):
        api(handler).call("worker-urls", {})

    assert len(calls) == 1


def test_happy_path_usgs_goes_through_the_server_bound_to_the_job() -> None:
    seen: list[object] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content)["data"])
        return httpx.Response(200, json={"result": {"usgs": [{"id": "p1", "available": True}]}})

    with ProxyM2MSession(api(handler), IDS) as m2m:
        answer = m2m.request("download-options", {"datasetName": "corona2", "entityIds": ["E1"]})
        m2m.request("download-retrieve")

    assert answer == [{"id": "p1", "available": True}]
    assert seen[0] == {
        **IDS.body(),
        "request": {"kind": "usgs", "endpoint": "download-options", "payload": {"datasetName": "corona2", "entityIds": ["E1"]}},
    }
    assert seen[1] == {**IDS.body(), "request": {"kind": "usgs", "endpoint": "download-retrieve", "payload": {}}}


@pytest.mark.parametrize(
    ("code", "raised"),
    [
        ("apiError.usgs.maintenance", MaintenanceError),
        ("apiError.rateLimited", RateLimitError),
        ("apiError.usgs.credentials", AuthError),
        ("apiError.worker.refused", M2MError),
        ("apiError.usgs.notConfigured", SecretUnavailableError),
    ],
)
def test_bad_path_the_servers_usgs_refusals_are_what_fetch_understands(code: str, raised: type[Exception]) -> None:
    with pytest.raises(raised) as caught:
        ProxyM2MSession(api(lambda _request: coded(code)), IDS).request("download-request", {"label": "hcm-job-1"})

    assert type(caught.value) is raised
