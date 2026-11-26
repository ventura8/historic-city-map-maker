"""A fake of the server side of the local worker (M7, docs/research/M7-local-worker.md §2), on a loopback HTTP server.

It answers what the worker calls, as the emulators would lay them out (`Endpoints.emulated`): the five callables
`/{project}/us-central1/worker-*` (the callable envelope, `Authorization: Bearer <ID token>`), Google's token refresh
`/securetoken.googleapis.com/v1/token`, Hosting's `/__/firebase/init.json`, and the signed URLs it hands out
(`/signed/<path>`, GET and PUT, like Cloud Storage's with `x-goog-generation`). The callables keep the allow-list's
essentials over an in-memory Firestore (`MemoryStore`): `worker.claim` leases the oldest queued local job, `worker.step`
and `worker.urls` answer `apiError.worker.notHolder` unless the caller's worker holds the job (or once `revoke_when`
matched a request), refuse a document of another job and any object but the city's `rasters/`, and `worker.urls`'s
USGS calls are made with the server's own M2M client. Every call, every signed URL and every request sent to one is
recorded; ID and refresh tokens are generated test values. Finding 67: `worker-pair` (no sign-in) exchanges a code of
`pair_codes` once for a custom token, which Identity Toolkit's `accounts:signInWithCustomToken` turns into tokens; the
`Referer` of every call to Google's token services is recorded.
"""

import base64
import hashlib
import itertools
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from http import HTTPStatus
from typing import Final
from urllib.parse import parse_qs

from hcm_pipeline.m2m import M2MClient, M2MError, MaintenanceError, RateLimitError
from hcm_pipeline.model import Timestamp, contract_json
from hcm_pipeline.store import DELETE

from tests.fakes.documents import MemoryStore
from tests.fakes.http import FakeHttpServer, Reply, Request

PROJECT: Final = "demo-hcm"
REGION: Final = "us-central1"
API_KEY: Final = "demo-web-api-key"
OWNER_UID: Final = "uid-owner"
OWNER_EMAIL: Final = "owner@example.test"
LEASE_SECONDS: Final = 600
NOT_HOLDER: Final = "apiError.worker.notHolder"
REFUSED: Final = "apiError.worker.refused"
_USGS_CODES: Final[Mapping[type[M2MError], str]] = {
    MaintenanceError: "apiError.usgs.maintenance",
    RateLimitError: "apiError.rateLimited",
}


def _b64(value: Mapping[str, object]) -> str:
    return base64.urlsafe_b64encode(json.dumps(value).encode("utf-8")).decode("ascii").rstrip("=")


def fake_id_token(expires_at: float, email: str = OWNER_EMAIL, uid: str = OWNER_UID) -> str:
    """An unsigned JWT as the Auth emulator issues one (empty signature): the claims the worker reads."""
    return f"{_b64({'alg': 'none', 'typ': 'JWT'})}.{_b64({'sub': uid, 'email': email, 'exp': int(expires_at)})}."


class RefusedError(Exception):
    """A callable's refusal: its `apiError.*` code and HTTP status."""

    def __init__(self, code: str, status: int = HTTPStatus.BAD_REQUEST, name: str = "FAILED_PRECONDITION") -> None:
        super().__init__(code)
        self.code, self.status, self.name = code, status, name


def refusal(error: RefusedError) -> Reply:
    body = {"error": {"message": f"refused: {error.code}", "status": error.name, "details": {"code": error.code}}}
    return Reply.json(json.dumps(body), error.status)


def _from_record(value: Mapping[str, object]) -> object:
    if dict(value) == {"__hcmDelete": True}:
        return DELETE
    if set(value) == {"seconds", "nanoseconds"}:
        return Timestamp(int(str(value["seconds"])), int(str(value["nanoseconds"])))
    return {key: from_json(item) for key, item in value.items()}


def from_json(value: object) -> object:
    """What the server reads from a worker's JSON: timestamps and the delete marker."""
    if isinstance(value, dict):
        return _from_record(value)
    return [from_json(item) for item in value] if isinstance(value, list) else value


@dataclass(frozen=True)
class Call:
    name: str
    data: dict[str, object]
    token: str


@dataclass
class StoredObject:
    data: bytes
    generation: int

    def metadata(self) -> dict[str, object]:
        md5 = base64.b64encode(hashlib.md5(self.data, usedforsecurity=False).digest()).decode("ascii")
        return {"exists": True, "size": len(self.data), "generation": str(self.generation), "md5": md5}


@dataclass
class FakeWorkerApi:
    """The server side; `install` routes it on `server`."""

    store: MemoryStore
    server: FakeHttpServer
    clock: Callable[[], float]
    city: str = "bucharest"
    id_tokens: set[str] = field(default_factory=set)
    refresh_tokens: set[str] = field(default_factory=set)
    calls: list[Call] = field(default_factory=list)
    objects: dict[str, StoredObject] = field(default_factory=dict)
    signed: list[tuple[str, str]] = field(default_factory=list)
    sent: list[tuple[str, str]] = field(default_factory=list)
    revoke_when: Callable[[Mapping[str, object]], bool] | None = None
    revoked: bool = False
    m2m: Callable[[], M2MClient] | None = None
    hello_answer: dict[str, object] = field(default_factory=lambda: {"pollSeconds": 30, "heartbeatSeconds": 3600})
    hello_refusal: str | None = None
    claim_extra: dict[str, object] = field(default_factory=dict)
    claim_refusal: str | None = None
    custom_sign_in_refused: bool = False
    pair_codes: dict[str, str] = field(default_factory=dict)
    pair_refusal: str | None = None
    custom_tokens: set[str] = field(default_factory=set)
    referers: list[str] = field(default_factory=list)
    refreshes: int = 0
    versions: dict[str, int] = field(default_factory=dict)
    # Documents the server cannot read (one that fails its schema answered `apiError.internal` before 2026-11-08).
    unreadable: set[str] = field(default_factory=set)
    # Documents that fail their schema: since 2026-11-08 a list leaves them out and counts them (`skipped`).
    invalid: set[str] = field(default_factory=set)
    generations: itertools.count[int] = field(default_factory=lambda: itertools.count(1_793_000_000_000_001))

    @property
    def host(self) -> str:
        return self.server.root_url.removeprefix("http://")

    def env(self) -> dict[str, str]:
        """The emulator variables that point a worker here."""
        return {"FIREBASE_AUTH_EMULATOR_HOST": self.host, "FUNCTIONS_EMULATOR_HOST": self.host, "HCM_HOSTING_HOST": self.host}

    def install(self) -> FakeWorkerApi:
        handlers = {"hello": self._hello, "claim": self._claim, "step": self._step, "urls": self._urls, "end": self._end}
        for name, handler in handlers.items():
            self.server.route("POST", f"/{PROJECT}/{REGION}/worker-{name}", self._callable(f"worker-{name}", handler))
        self.server.route("POST", "/securetoken.googleapis.com/v1/token", self._refresh)
        self.server.route("GET", "/__/firebase/init.json", self._init_json)
        self.server.route("POST", f"/{PROJECT}/{REGION}/worker-pair", self._pair)
        self.server.route("POST", "/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken", self._custom_sign_in)
        return self

    def _pair(self, request: Request) -> Reply:
        """`worker.pair`: no sign-in; a code of `pair_codes` once, for a custom token."""
        data = json.loads(request.body)["data"]
        self.calls.append(Call("worker-pair", data, request.headers.get("authorization", "")))
        pair_id = None if self.pair_refusal is not None else self.pair_codes.pop(str(data.get("code")), None)
        if pair_id is None:
            code = self.pair_refusal or "apiError.worker.pairCode"
            return refusal(RefusedError(code, HTTPStatus.FORBIDDEN, "PERMISSION_DENIED"))
        token = f"custom-token-{len(self.custom_tokens) + 1}"
        self.custom_tokens.add(token)
        return Reply.json(json.dumps({"result": {"token": token, "pairId": pair_id}}))

    def _custom_sign_in(self, request: Request) -> Reply:
        """Identity Toolkit: a custom token this server issued, for the owner's tokens."""
        self.referers.append(request.headers.get("referer", ""))
        token = json.loads(request.body).get("token")
        if self.custom_sign_in_refused or token not in self.custom_tokens:
            return Reply.json(json.dumps({"error": {"code": 400, "message": "INVALID_CUSTOM_TOKEN"}}), HTTPStatus.BAD_REQUEST)
        id_token, refresh_token = self.sign_in_tokens(self.clock() + 3600)
        return Reply.json(json.dumps({"idToken": id_token, "refreshToken": refresh_token, "expiresIn": "3600"}))

    def sign_in_tokens(self, expires_at: float) -> tuple[str, str]:
        """An ID token the callables accept and its refresh token."""
        id_token, refresh_token = fake_id_token(expires_at), f"AMf-vB-refresh-{len(self.refresh_tokens) + 1}-{'x' * 40}"
        self.id_tokens.add(id_token)
        self.refresh_tokens.add(refresh_token)
        return id_token, refresh_token

    def names(self) -> list[str]:
        return [call.name for call in self.calls]

    # --- the HTTP side -------------------------------------------------------------------------------------

    def _callable(self, name: str, handler: Callable[[dict[str, object]], dict[str, object]]) -> Callable[[Request], Reply]:
        def answer(request: Request) -> Reply:
            token = request.headers.get("authorization", "").removeprefix("Bearer ")
            data = json.loads(request.body)["data"]
            self.calls.append(Call(name, data, token))
            try:
                if token not in self.id_tokens:
                    raise RefusedError("apiError.unauthenticated", HTTPStatus.UNAUTHORIZED, "UNAUTHENTICATED")
                return Reply.json(json.dumps({"result": contract_json(handler(data))}))
            except RefusedError as error:
                return refusal(error)

        return answer

    def _refresh(self, request: Request) -> Reply:
        form = {key: values[0] for key, values in parse_qs(request.body.decode("utf-8")).items()}
        self.refreshes += 1
        self.referers.append(request.headers.get("referer", ""))
        if form.get("grant_type") != "refresh_token" or form.get("refresh_token") not in self.refresh_tokens:
            return Reply.json(json.dumps({"error": {"code": 400, "message": "TOKEN_EXPIRED"}}), HTTPStatus.BAD_REQUEST)
        id_token = fake_id_token(self.clock() + 3600)
        self.id_tokens.add(id_token)
        return Reply.json(json.dumps({"id_token": id_token, "refresh_token": form["refresh_token"], "expires_in": "3600"}))

    def _init_json(self, _request: Request) -> Reply:
        config = {"apiKey": API_KEY, "authDomain": f"{PROJECT}.firebaseapp.com", "projectId": PROJECT, "appId": "1:1234:web:abcd"}
        return Reply.json(json.dumps(config))

    # --- the callables -------------------------------------------------------------------------------------

    def _hello(self, data: dict[str, object]) -> dict[str, object]:
        if self.hello_refusal is not None:
            raise RefusedError(self.hello_refusal, HTTPStatus.FORBIDDEN, "PERMISSION_DENIED")
        return dict(self.hello_answer)

    def _job_path(self, job_id: object) -> str:
        return f"cities/{self.city}/jobs/{job_id}"

    def _touch(self, path: str) -> None:
        self.versions[path] = self.versions.get(path, 0) + 1

    def _claimable(self, job_id: str) -> bool:
        job = self.store.get(self._job_path(job_id)) or {}
        return job.get("status") == "queued" and job.get("runOn") == "local"

    def _claim(self, data: dict[str, object]) -> dict[str, object]:
        return self._claim_held() or self._take(data)

    def _take(self, data: dict[str, object]) -> dict[str, object]:
        found = next((job_id for job_id in self.store.list_ids(f"cities/{self.city}/jobs") if self._claimable(job_id)), None)
        if found is None:
            return {"job": None}
        job, now = self.store.get(self._job_path(found)) or {}, Timestamp.at(self.clock())
        lease = {"owner": f"worker:{data['workerId']}", "until": now.plus(LEASE_SECONDS)}
        fields = {"status": "starting", "attempt": int(str(job.get("attempt", 0))) + 1, "lease": lease, "machine": DELETE}
        worker = {"id": data["workerId"], "uid": OWNER_UID, "claimedAt": now}
        self.store.update(self._job_path(found), {**fields, "worker": worker, "waitReason": DELETE, "dispatchAt": now})
        self._touch(self._job_path(found))
        return {"job": {"jobId": found}}

    def _claim_held(self) -> dict[str, object] | None:
        """A claim the test refuses (`claim_refusal`) or answers without a job (`claim_extra`), else None."""
        if self.claim_refusal is not None:
            raise RefusedError(self.claim_refusal, HTTPStatus.FORBIDDEN, "PERMISSION_DENIED")
        return {"job": None, **self.claim_extra} if self.claim_extra else None

    def _holder(self, job_id: object) -> object:
        worker = (self.store.get(self._job_path(job_id)) or {}).get("worker")
        return worker.get("id") if isinstance(worker, dict) else None

    def _held(self, data: dict[str, object], request: Mapping[str, object]) -> None:
        if self.revoke_when is not None and self.revoke_when(request):
            self.revoked = True
        if self.revoked or self._holder(data["jobId"]) != data["workerId"]:
            raise RefusedError(NOT_HOLDER)

    def _allowed(self, data: dict[str, object], path: str) -> str:
        jobs = f"cities/{self.city}/jobs/"
        other_job = path.startswith(jobs) and not path.startswith(self._job_path(data["jobId"]))
        if not f"{path}/".startswith(f"cities/{self.city}/") or other_job:
            raise RefusedError(REFUSED)
        return path

    def _step(self, data: dict[str, object]) -> dict[str, object]:
        request = data["request"]
        assert isinstance(request, dict)
        self._held(data, request)
        operations = {"get": self._get, "update": self._update, "create": self._create, "list": self._list}
        return operations[str(request["op"])](self._allowed(data, str(request.get("path") or request.get("collection"))), request)

    def _get(self, path: str, _request: dict[str, object]) -> dict[str, object]:
        if path in self.unreadable:
            raise RefusedError("apiError.internal", HTTPStatus.INTERNAL_SERVER_ERROR, "INTERNAL")
        return {"data": self.store.get(path), "updateTime": f"{self.versions.get(path, 0)}.000000000"}

    def _update(self, path: str, request: dict[str, object]) -> dict[str, object]:
        expected = request.get("ifUpdateTime")
        if expected is not None and expected != f"{self.versions.get(path, 0)}.000000000":
            return {"ok": False}
        fields = from_json(request["fields"])
        assert isinstance(fields, dict)
        self.store.update(path, fields)
        self._touch(path)
        return {"ok": True}

    def _create(self, path: str, request: dict[str, object]) -> dict[str, object]:
        document = from_json(request["data"])
        assert isinstance(document, dict)
        return {"created": self.store.create(path, document)}

    def _list(self, path: str, _request: dict[str, object]) -> dict[str, object]:
        ids = self.store.list_ids(path)
        kept = [found for found in ids if f"{path}/{found}" not in self.invalid]
        return {"ids": kept, **({"skipped": len(ids) - len(kept)} if path.endswith("/layerVersions") else {})}

    def _urls(self, data: dict[str, object]) -> dict[str, object]:
        request = data["request"]
        assert isinstance(request, dict)
        self._held(data, request)
        if request["kind"] == "usgs":
            return {"usgs": self._usgs(str(request["endpoint"]), request["payload"])}
        objects = request["objects"]
        assert isinstance(objects, list)
        return {"objects": [self._sign(item) for item in objects]}

    def _sign(self, item: dict[str, object]) -> dict[str, object]:
        path, method = str(item["path"]), str(item["method"])
        if not path.startswith(f"rasters/{self.city}/"):
            raise RefusedError(REFUSED)
        self.signed.append((method, path))
        self.server.route(method, f"/signed/{path}", self._signed_get if method == "GET" else self._signed_put)
        headers = {"Content-Type": str(item["contentType"])} if "contentType" in item else {}
        stored = self.objects.get(path)
        url = self.server.url(f"/signed/{path}") + "?X-Goog-Signature=fake-signature"
        signed = {"path": path, "url": url, "method": method, "headers": headers, "expiresAt": "2026-11-02T12:15:00.000Z"}
        return {**signed, **(stored.metadata() if stored else {"exists": False})}

    def _signed_get(self, request: Request) -> Reply:
        path = request.path.removeprefix("/signed/")
        self.sent.append(("GET", path))
        stored = self.objects.get(path)
        if stored is None:
            return Reply(HTTPStatus.NOT_FOUND, b"", "text/plain")
        return Reply(HTTPStatus.OK, stored.data, "application/octet-stream", {"x-goog-generation": str(stored.generation)})

    def _signed_put(self, request: Request) -> Reply:
        path = request.path.removeprefix("/signed/")
        self.sent.append(("PUT", path))
        self.objects[path] = StoredObject(request.body, next(self.generations))
        return Reply(HTTPStatus.OK, b"", "text/plain", {"x-goog-generation": str(self.objects[path].generation)})

    def _usgs(self, endpoint: str, payload: object) -> object:
        if self.m2m is None:
            raise RefusedError("apiError.usgs.notConfigured")
        try:
            with self.m2m() as client:
                return client.request(endpoint, payload if isinstance(payload, dict) else {})
        except M2MError as error:
            raise RefusedError(
                _USGS_CODES.get(type(error), "apiError.usgs.unavailable"), HTTPStatus.SERVICE_UNAVAILABLE, "UNAVAILABLE"
            ) from error

    def _end(self, data: dict[str, object]) -> dict[str, object]:
        job = self.store.get(self._job_path(data["jobId"])) or {}
        return {"status": job.get("status", "failed")}

    def ended(self) -> list[dict[str, object]]:
        return [call.data for call in self.calls if call.name == "worker-end"]
