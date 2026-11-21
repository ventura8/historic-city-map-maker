"""A local worker in a process of its own, stopped by one signal (`tests/integration/test_worker_stop.py`; M7 §1.2 step 6).

The worker's real loop, its real signal handlers and the real job runner (with its own handler), in the main thread of
this process as `python -m hcm_pipeline worker` runs them; the callables answered in memory (one claim of a re-georeference
job, then none, every `poll_seconds` of 30 s), the documents in a `MemoryStore`, the steps scripted. At the `moment` the
test names, the process says so on stdout (`AT <moment>`) and waits for a line on stdin, the way a network call holds the
main thread: the test sends its one signal meanwhile, then the line. When the loop ends the process prints the job's status
(`JOB <status>`) and exits 0; a signal the worker lost leaves it claiming every 30 s, which the test sees as a timeout.

Moments: `claim` (the claim of the job is under way: no step may run), `step` (inside the `warp` step: the run goes back to
`queued` at its next checkpoint), `tail` (after the run's last checkpoint, its final write made: the signal once got lost
there, docs/LESSONS.md 342) and `idle` (between jobs).
"""

import json
import sys
import tempfile
import time
from collections.abc import Callable
from pathlib import Path
from typing import Final

import httpx
from hcm_pipeline.config import Config
from hcm_pipeline.jobs import Done, JobContext, M2MConnection, Services, StepResult
from hcm_pipeline.model import Timestamp
from hcm_pipeline.osm import OverpassClient
from hcm_pipeline.runner import JobRunner, JobStep, RunOutcome, RunSettings
from hcm_pipeline.stac import StacClient
from hcm_pipeline.store import Change
from hcm_pipeline.worker.api import WorkerApi
from hcm_pipeline.worker.local_store import LocalObjectStore
from hcm_pipeline.worker.loop import WorkerLoop
from hcm_pipeline.worker.runtime import NoSecrets
from hcm_pipeline.worker.session import Session, Tokens
from hcm_pipeline.worker.state import WorkerState

from tests.fakes.documents import MemoryStore
from tests.fakes.worker_api import PROJECT, fake_id_token

CITY: Final = "bucharest"
JOB: Final = "job-regeoref-9"
WORKER: Final = "w-0123456789abcdef"
JOB_PATH: Final = f"cities/{CITY}/jobs/{JOB}"
STEPS: Final = ("georef", "warp", "export", "pyramid", "register")
MOMENTS: Final = ("claim", "step", "tail", "idle")
REFRESH: Final = "AMf-vB" + "r" * 40
UNUSED: Final = "http://127.0.0.1:9"
# The moments held inside `worker.claim`, by the claim's number.
HELD_AT_CLAIM: Final = {"claim": 1, "idle": 2}


def hold(moment: str) -> None:
    """Says where the main thread is and waits there for the test's line (its signal comes first)."""
    sys.stdout.write(f"AT {moment}\n")
    sys.stdout.flush()
    sys.stdin.readline()


class Store(MemoryStore):
    """The documents; at `tail` the run's final write (`awaiting_approval`) holds the main thread once it is made."""

    def __init__(self, moment: str) -> None:
        super().__init__()
        self._moment = moment

    def transact(self, path: str, change: Change) -> dict[str, object] | None:
        fields = super().transact(path, change)
        if self._moment == "tail" and fields is not None and fields.get("status") == "awaiting_approval":
            hold("tail")
        return None if fields is None else dict(fields)


class Step:
    """A scripted step; `warp` holds the main thread at `step`."""

    def __init__(self, name: str, moment: str) -> None:
        self.name = name
        self._held = moment == "step" and name == "warp"

    def run(self, _ctx: JobContext) -> StepResult:
        if self._held:
            hold("step")
        return Done()


def seeded(moment: str) -> Store:
    store = Store(moment)
    at = Timestamp.at(time.time() - 60)
    stamp = {"updatedBy": "system:imagery", "updatedAt": at}
    store.seed(JOB_PATH, {"type": "regeoref", "status": "starting", "params": {"basedOn": "v0"}, "versionId": JOB, **stamp})
    version = {"layerId": "layer-1", "jobId": JOB, "origin": "regeoref", "state": "processing", "label": {"ro": "x"}, "year": 1966}
    store.seed(f"cities/{CITY}/layerVersions/{JOB}", {**version, **stamp})
    return store


class Runtime:
    """The worker's runtime with the runner's own signal handler: the real `JobRunner` over the store and the steps."""

    def __init__(self, store: Store, moment: str, work: Path) -> None:
        self._store = store
        self._steps: dict[str, JobStep] = {name: Step(name, moment) for name in STEPS}
        self._client = httpx.Client()
        self._services = Services(
            store=store,
            objects=LocalObjectStore(work),
            secrets=NoSecrets(),
            m2m=self._no_m2m,
            downloads=self._client,
            stac=StacClient(self._client, UNUSED, time.sleep),
            overpass=OverpassClient(self._client, UNUSED, time.sleep),
            clock=time.time,
            sleep=time.sleep,
            resolver=lambda _host: ["127.0.0.1"],
        )

    @staticmethod
    def _no_m2m() -> M2MConnection:
        raise AssertionError("a scripted run calls no M2M")

    def run(self, job_id: str, asked_to_stop: Callable[[], bool], asked_to_release: Callable[[], bool] = lambda: False) -> RunOutcome:
        config = Config(
            job_id=job_id,
            city_id=CITY,
            project_id=PROJECT,
            private_bucket="private",
            public_bucket="public",
            m2m_base_url=UNUSED,
            execution="worker",
            task_attempt=0,
            owner=f"worker:{WORKER}",
        )
        return JobRunner(
            config,
            self._services,
            self._steps,
            RunSettings(heartbeat_seconds=3600, asked_to_stop=asked_to_stop, asked_to_release=asked_to_release),
        ).run()


class Callables:
    """`worker.claim` hands the job once, then nothing; `worker.end` answers."""

    def __init__(self, moment: str) -> None:
        self._moment = moment
        self._claims = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        name = request.url.path.rsplit("/", 1)[-1]
        if name != "worker-claim":
            return httpx.Response(200, json={"result": {"status": "queued"}})
        self._claims += 1
        # The first claim hands the job, the second finds the worker idle.
        if HELD_AT_CLAIM.get(self._moment) == self._claims:
            hold(self._moment)
        return httpx.Response(200, json={"result": {"job": {"jobId": JOB} if self._claims == 1 else None}})


def main(moment: str) -> int:
    store = seeded(moment)
    client = httpx.Client(transport=httpx.MockTransport(Callables(moment)))
    session = Session(client, lambda: UNUSED, time.time)
    session.begin(Tokens.of(fake_id_token(time.time() + 3600), REFRESH))
    state = WorkerState(CITY, PROJECT, session)
    api = WorkerApi(client, lambda name: f"{UNUSED}/{name}", session.bearer, time.sleep)
    with tempfile.TemporaryDirectory() as work:
        WorkerLoop(session, api, state, Runtime(store, moment, Path(work)), {"cityId": CITY, "workerId": WORKER}).run()
    sys.stdout.write(f"JOB {json.dumps((store.get(JOB_PATH) or {}).get('status'))}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] in MOMENTS else "idle"))
