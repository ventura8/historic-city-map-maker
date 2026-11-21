"""Pairing: the admin's command signs the worker in, no browser needed (finding 67 of 2026-11-02, M7 §2.6).

The command carries a one-time code (`--pair <code>`, ten minutes, minted by the admin's `worker.pairCode`). At start the
worker sends it to `worker.pair` (no sign-in), gets a Firebase custom token of the owner who minted it (claims `worker`,
`city`, `pair`), signs in with it at Google's Identity Toolkit (`accounts:signInWithCustomToken`, the project's web API
key, the Hosting origin as `Referer`) and goes on exactly as after the local page's sign-in: `worker.hello` must accept
the ID token first. The refresh token is kept in the work folder (`.hcm-session-<city>.json`, mode 600: the named volume
`hcm-worker`), with the pairing's id and the code's SHA-256, so a restart of the container (a reboot: `--restart
unless-stopped`) resumes the session without a new code, and a new command (a new code) pairs again, revoking the old
pairing (`replaces`). Disconnect this computer in the admin revokes the pairing: the next call says so and the kept
session is deleted. A transient failure (the network not up yet after a reboot) is tried again every `RETRY_SECONDS`.
Finding 72 (auto-pair, M7 §2.7): the code may also come later, from the admin itself (`POST /pair`, `offer`), to a worker
the starter file started with no code at all. A new pairing `worker.hello` refuses for this computer's worker id (revoked
while the computer was off, or another account's) would be refused for every later code too: the id is forgotten, the new
pairing kept, and the process ends (`Signer.restart`), so the supervisor or Docker's restart policy starts it as a new
worker, with no new code. An id file or a session file the work folder cannot hold (read-only, damaged) is only logged:
the id and the session then live in memory.
"""

import contextlib
import hashlib
import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final, Protocol

import httpx

from hcm_pipeline.contract import Errors
from hcm_pipeline.durable import write_atomic
from hcm_pipeline.log import get_logger
from hcm_pipeline.worker.api import PAIR, REFUSED, REVOKED, WorkerApi, WorkerApiError
from hcm_pipeline.worker.args import Endpoints
from hcm_pipeline.worker.session import RefreshUnavailableError, Session, SessionEndedError, Tokens
from hcm_pipeline.worker.webconfig import WebConfig, WebConfigError

LOG = get_logger("worker.pairing")
RETRY_SECONDS: Final = 30.0
FILE_MODE: Final = 0o600
PAIR_ID: Final = re.compile(r"[0-9a-f]{40}")
WORKER_ID: Final = re.compile(r"w-[0-9a-f]{16}")
CODE_HASH: Final = re.compile(r"[0-9a-f]{64}")
SIGN_IN_REFUSED: Final = "apiError.unauthenticated"
# What a failed attempt may raise and is tried again later: the server, Google's token services or the web configuration
# out of reach.
TRANSIENT: Final = (RefreshUnavailableError, WebConfigError)
# What `worker.hello` answers about the worker id itself, whichever pairing asks: disconnected, or another account's.
ID_REFUSALS: Final = (REVOKED, REFUSED)


def code_hash(code: str) -> str:
    """The SHA-256 of a pairing code: what the kept session remembers of it (never the code)."""
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Kept:
    """A paired session as the work folder keeps it."""

    refresh_token: str = field(repr=False)
    pair_id: str
    code_hash: str

    @classmethod
    def of(cls, record: object) -> Kept | None:
        """The kept session from its JSON record, None when it is not one."""
        kept = cls(_text(record, "refreshToken"), _text(record, "pairId"), _text(record, "codeHash"))
        return kept if kept.valid() else None

    def valid(self) -> bool:
        return bool(self.refresh_token) and PAIR_ID.fullmatch(self.pair_id) is not None and CODE_HASH.fullmatch(self.code_hash) is not None

    def record(self) -> dict[str, str]:
        return {"refreshToken": self.refresh_token, "pairId": self.pair_id, "codeHash": self.code_hash}


class SessionFile:
    """`<work>/.hcm-session-<city>.json`, readable by the worker's user only."""

    def __init__(self, folder: Path, city: str) -> None:
        self.path = folder / f".hcm-session-{city}.json"
        self.id_path = folder / f".hcm-worker-{city}.id"

    def load(self) -> Kept | None:
        try:
            return Kept.of(json.loads(self.path.read_text("utf-8")))
        except OSError, ValueError:
            return None

    def save(self, kept: Kept) -> None:
        """Written to a new file of mode 600, then moved over the old one (never readable by others, never half written).
        A work folder that refuses it costs the next restart a new code, not this run."""
        try:
            write_atomic(self.path, json.dumps(kept.record()), FILE_MODE)
        except OSError as error:
            LOG.warning("the session cannot be kept in the work folder (%s): the next start needs a new code", type(error).__name__)

    def _kept_id(self) -> str | None:
        """The id file's id; None without a file, with a damaged one, or with one that cannot be read."""
        try:
            kept = self.id_path.read_text("utf-8").strip()
        except OSError, ValueError:
            return None
        return kept if WORKER_ID.fullmatch(kept) else None

    def worker_id(self, new: Callable[[], str]) -> str:
        """This computer's worker id, kept beside the session (finding 77 of 2026-11-03: a new id per process left one more
        worker document at every restart); forgotten with the session, so a disconnected computer starts as a new worker. A
        work folder that cannot hold it only logs: the id then lives as long as the process."""
        kept = self._kept_id()
        if kept is not None:
            return kept
        worker_id = new()
        try:
            write_atomic(self.id_path, worker_id)
        except OSError as error:
            LOG.warning("the worker id cannot be kept in the work folder (%s): a restart makes a new one", type(error).__name__)
        return worker_id

    def forget_id(self) -> None:
        """The id alone forgotten: the next start is a new worker, on the session kept beside it."""
        with contextlib.suppress(OSError):
            self.id_path.unlink()

    def clear(self) -> None:
        for path in (self.path, self.id_path):
            with contextlib.suppress(OSError):
                path.unlink()


@dataclass(frozen=True)
class Paired:
    """What a code was exchanged for: the owner's tokens and the pairing's id."""

    id_token: str = field(repr=False)
    refresh_token: str = field(repr=False)
    pair_id: str


def _text(body: object, key: str) -> str:
    value = body.get(key) if isinstance(body, dict) else None
    return value if isinstance(value, str) else ""


class Pairing:
    """`worker.pair`, then the custom token's sign-in."""

    def __init__(self, http: httpx.Client, api: WorkerApi, endpoints: Endpoints, web_config: WebConfig, city: str) -> None:
        self._http = http
        self._api = api
        self._endpoints = endpoints
        self._web_config = web_config
        self._city = city

    def exchange(self, code: str, replaces: str | None) -> Paired:
        """The code exchanged once; `WorkerApiError` with the server's code when it is refused."""
        request = {"cityId": self._city, "code": code, **({"replaces": replaces} if replaces else {})}
        answer = self._api.call(PAIR, request, anonymous=True)
        pair_id = _text(answer, "pairId")
        if not PAIR_ID.fullmatch(pair_id):
            raise WorkerApiError(Errors.INTERNAL, "worker.pair answered without a pairing")
        body = self._sign_in(_text(answer, "token"))
        return Paired(_text(body, "idToken"), _text(body, "refreshToken"), pair_id)

    def _sign_in(self, custom_token: str) -> object:
        url = f"{self._endpoints.custom_token}?key={self._web_config.api_key()}"
        try:
            response = self._http.post(
                url, json={"token": custom_token, "returnSecureToken": True}, headers={"Referer": self._endpoints.referer}
            )
        except httpx.TransportError as error:
            raise RefreshUnavailableError(f"the sign-in service is unreachable: {type(error).__name__}") from error
        if not response.is_success:
            raise WorkerApiError(SIGN_IN_REFUSED, f"the custom token's sign-in was refused (HTTP {response.status_code})")
        try:
            return response.json()
        except ValueError as error:
            raise RefreshUnavailableError("the sign-in service answered without tokens") from error


class SignIn(Protocol):
    """The page's sign-in (`app.PageActions.sign_in`): `worker.hello` first, then the session begins."""

    def sign_in(self, id_token: object, refresh_token: object, keep: Callable[[Tokens], None] | None = None) -> str | None: ...


@dataclass(frozen=True)
class Signer:
    """Who the connector signs in through: the session, the page's sign-in (`worker.hello` first) and the page's error; and
    what ends this process, for a supervisor or a restart policy to start it again (`WorkerLoop.stop`)."""

    session: Session
    actions: SignIn
    failed: Callable[[str], None]
    restart: Callable[[], None] = lambda: None


class Connector:
    """Signs the worker in at start from the command's code or the kept session, again after a transient failure."""

    def __init__(self, pairing: Pairing, file: SessionFile, signer: Signer, code: str | None, clock: Callable[[], float]) -> None:
        self._failed = signer.failed
        self._restart = signer.restart
        self._pairing = pairing
        self._file = file
        self._session = signer.session
        self._actions = signer.actions
        self._code = code
        self._clock = clock
        self._settled = False
        self._next_at = 0.0

    def attempt(self) -> None:
        """One try, when there is no session, nothing settled yet and the last transient failure is `RETRY_SECONDS` old."""
        if self._session.active or self._settled or self._clock() < self._next_at:
            return
        try:
            self._settled = self._connect()
        except TRANSIENT as error:
            LOG.warning("could not sign in yet (%s); trying again in %d s", type(error).__name__, int(RETRY_SECONDS))
            self._next_at = self._clock() + RETRY_SECONDS

    def offer(self, code: str) -> None:
        """The admin's code (`POST /pair`): tried at the loop's next pass, as the command's code would have been."""
        self._code = code
        self._settled = False
        self._next_at = 0.0

    def forget(self) -> None:
        """Disconnected in the admin: the kept session is deleted, and nothing is tried again until a new command."""
        self._file.clear()
        self._settled = True

    def _connect(self) -> bool:
        kept = self._file.load()
        if self._code is not None and (kept is None or kept.code_hash != code_hash(self._code)):
            return self._pair(self._code, kept)
        return self._resume(kept) if kept is not None else True

    def _pair(self, code: str, kept: Kept | None) -> bool:
        try:
            paired = self._pairing.exchange(code, kept.pair_id if kept else None)
        except WorkerApiError as error:
            return self._refused(error.code, kept)
        hashed = code_hash(code)
        refused = self._actions.sign_in(paired.id_token, paired.refresh_token, self._keeper(paired.pair_id, hashed))
        if refused is None:
            LOG.info("paired with the admin's code: this computer works for the city now, no sign-in needed")
        elif refused in ID_REFUSALS:
            self._start_as_new_worker(Kept(paired.refresh_token, paired.pair_id, hashed), refused)
        return self._settle(refused)

    def _start_as_new_worker(self, kept: Kept, refused: str) -> None:
        """The pairing is good and the id is not: the id goes, the pairing stays (its code is used up), and the process ends."""
        LOG.warning("this computer's worker id is refused (%s): it starts again as a new worker, on the new pairing", refused)
        self._file.forget_id()
        self._file.save(kept)
        self._restart()

    def _refused(self, code: str, kept: Kept | None) -> bool:
        """A refused code: an unreachable server is tried again; else the kept session (if any) is the fallback."""
        if code == Errors.UNAVAILABLE:
            raise RefreshUnavailableError("the server did not answer worker.pair")
        LOG.warning("the pairing code was refused (%s): the admin's Jobs page pairs this computer again", code)
        if kept is not None:
            return self._resume(kept)
        self._failed(code)
        return True

    def _resume(self, kept: Kept) -> bool:
        try:
            tokens = self._session.renew(kept.refresh_token)
        except SessionEndedError:
            LOG.warning("the kept session was refused: the admin's Jobs page pairs this computer again")
            self._file.clear()
            return True
        refused = self._actions.sign_in(tokens.id_token, tokens.refresh_token, self._keeper(kept.pair_id, kept.code_hash))
        if refused == REVOKED:
            self._file.clear()
        return self._settle(refused)

    @staticmethod
    def _settle(refused: str | None) -> bool:
        """Settled unless the server could not be reached (then tried again)."""
        if refused == Errors.UNAVAILABLE:
            raise RefreshUnavailableError("the server did not answer worker.hello")
        return True

    def _keeper(self, pair_id: str, hashed: str) -> Callable[[Tokens], None]:
        def keep(tokens: Tokens) -> None:
            self._file.save(Kept(tokens.refresh_token, pair_id, hashed))

        return keep
