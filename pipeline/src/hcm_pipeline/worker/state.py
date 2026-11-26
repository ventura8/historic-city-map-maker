"""What the local page shows (`GET /state`, docs/research/M7-local-worker.md §2.1, §10.3): the account signed in (its
e-mail only, never a token), the city, idle or the job and its step, and the last error; and what `worker.hello`
answered (how often to claim, how often the heartbeat writes). Thread-safe: the page's server reads it while the loop
writes it. Finding 72 of 2026-11-02 (auto-pair, M7 §2.7): the admin reads it too, from the project's Hosting origin: the
worker's id and whether it takes a pairing code now (`pairable`: no session, and not disconnected in the admin). M26: `machine`, the
governor's word on this computer (its cores, memory, power, cards, the profile in force and the budget), for the admin's card;
`image` and `starter`, the versions the card compares with the installed release's. Pause this computer (2026-11-13): `paused`,
`{by: 'computer' | 'admin', until?}` while paused, else null.
"""

import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Final

from hcm_pipeline.log import get_logger
from hcm_pipeline.worker.ai_state import AiState
from hcm_pipeline.worker.api import REVOKED
from hcm_pipeline.worker.pace import Pace
from hcm_pipeline.worker.session import Session

LOG = get_logger("worker.state")

# `WORKER_POLL_SECONDS` of @hcm/shared, until `worker.hello` answers its own.
DEFAULT_POLL_SECONDS: Final = 30.0


@dataclass
class Timing:
    """`worker.hello`'s answer: the claim interval, the longest an idle worker may wait between claims (None: a server that
    names none, asked every `poll_seconds`) and the heartbeat's (None: the runner's own)."""

    poll_seconds: float = DEFAULT_POLL_SECONDS
    idle_poll_seconds: float | None = None
    heartbeat_seconds: float | None = None


class WorkerState:
    def __init__(self, city: str, project: str, session: Session, worker_id: str = "") -> None:
        self._city = city
        self._project = project
        self._worker_id = worker_id
        self._session = session
        self._lock = threading.Lock()
        self._job: str | None = None
        self._step: str | None = None
        self._error: str | None = None
        self._outdated = False
        self._ai = AiState()
        self.timing = Timing()
        # The governor's word on this computer (docs/research/M26-governor.md §6); None before its first tick.
        self.machine: Callable[[], Mapping[str, object] | None] = lambda: None
        # The image this worker runs (`--image`) and its starter's word (docs/research/M7-local-worker.md, *The starter updates
        # itself*), for the admin's "This computer"; the build sets them.
        self.image: str | None = None
        self.starter: Mapping[str, object] | None = None
        self.pace = Pace()
        # Pause this computer (`pausing.py`): `{by, until?}` while paused, else None; the build sets it.
        self.paused: Callable[[], Mapping[str, object] | None] = lambda: None

    def busy(self, job_id: str) -> None:
        with self._lock:
            self._job, self._step, self._error = job_id, None, None

    def idle(self) -> None:
        with self._lock:
            self._job, self._step = None, None

    def failed(self, code: str | None) -> None:
        """The last error the page shows (an `apiError.*` code), or none."""
        with self._lock:
            self._error = code

    @property
    def is_outdated(self) -> bool:
        with self._lock:
            return self._outdated

    def outdated(self, outdated: bool) -> None:
        """Finding 67: whether this worker's image is no longer the installed pipeline's (it takes no job until updated)."""
        with self._lock:
            if outdated and not self._outdated:
                LOG.warning(
                    "the imagery pipeline was updated in the admin: this computer runs an older image and takes no job until it runs "
                    "the new one (the starter file's service does so by itself; a worker started by hand needs the admin's command)"
                )
            self._outdated = outdated

    def observe(self, path: str, fields: Mapping[str, object]) -> None:
        """A document write of the run: the job's `step` becomes the page's step line."""
        step = fields.get("step")
        with self._lock:
            if self._job is not None and path.endswith(f"/jobs/{self._job}") and isinstance(step, str):
                self._step = step

    @property
    def ai(self) -> AiState:
        """The local AI's state (docs/research/M10-local-ai.md)."""
        with self._lock:
            return self._ai

    def set_ai(self, ai: AiState) -> None:
        """What `GET /state` says of it from now on: the starter polls `wanted` there."""
        with self._lock:
            self._ai = ai

    def _phase(self) -> str:
        if not self._session.active:
            return "signed-out"
        return "idle" if self._job is None else "busy"

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            last_error = self._error or self._session.ended_because
            return {
                "workerId": self._worker_id,
                "signedIn": self._session.active,
                "pairable": not self._session.active and last_error != REVOKED,
                "email": self._session.email,
                "city": self._city,
                "project": self._project,
                "state": self._phase(),
                "jobId": self._job,
                "step": self._step,
                "lastError": last_error,
                "outdated": self._outdated,
                "ai": self._ai.on_state(),
                "machine": self.machine(),
                "image": self.image,
                "starter": self.starter,
                "paused": self.paused(),
            }
