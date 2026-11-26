"""One claimed job run on the computer: the runner of `run`, with the worker's ports (docs/research/M7-local-worker.md §1.3).

The job's configuration (its id, the city, the lease owner `worker:<workerId>` the claim wrote) and its services: the
documents through `worker.step`, the objects routed between the work folder and signed URLs, USGS through the server,
no secret at all; the delivery's download, STAC and Overpass as `run` builds them, behind the same address guard (and,
under `--emulators`, sealed to this machine). The steps are the pipeline's own, unchanged. The bucket's lifecycle has no
arm on this computer: `housekeeping.py` sweeps the work folder after each claim.
"""

import os
import time
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Final

import httpx

from hcm_pipeline.config import DEFAULT_M2M_BASE_URL, Config
from hcm_pipeline.jobs import M2MConnection, Services
from hcm_pipeline.matcher.box import MatcherBudget
from hcm_pipeline.osm import OverpassClient
from hcm_pipeline.runner import JobRunner, JobStep, RunOutcome, RunSettings
from hcm_pipeline.secrets import SecretUnavailableError
from hcm_pipeline.services import delivery_client, emulated_guard, guarded, http
from hcm_pipeline.stac import StacClient
from hcm_pipeline.urlguard import resolve
from hcm_pipeline.worker.ai_files import AiFiles, ai_client, variant_of
from hcm_pipeline.worker.ai_state import AiState
from hcm_pipeline.worker.api import WorkerApi
from hcm_pipeline.worker.args import WorkerArgs
from hcm_pipeline.worker.documents import ApiDocumentStore, JobIds
from hcm_pipeline.worker.local_matcher import LocalMatcher, Patience, Ports
from hcm_pipeline.worker.local_store import LocalObjectStore
from hcm_pipeline.worker.m2m_proxy import ProxyM2MSession
from hcm_pipeline.worker.routed import RoutedObjectStore
from hcm_pipeline.worker.signed_store import SignedObjectStore
from hcm_pipeline.worker.state import WorkerState

LEASE_PREFIX: Final = "worker:"
EXECUTION: Final = "worker"
# Mounted by the starter file (`-v hcm-ai-files:/ai/files -v hcm-ai-box:/ai/box`): empty folders of the image otherwise.
AI_ROOT: Final = Path("/ai")
StepsFactory = Callable[[], Mapping[str, JobStep]]


class NoSecrets:
    """The worker holds no secret (the server makes the USGS calls): asking for one is a bug."""

    def read(self, name: str) -> str:
        raise SecretUnavailableError(f"the local worker holds no secret ({name})")


def worker_config(args: WorkerArgs, worker_id: str, job_id: str) -> Config:
    """The run's configuration: the job, the city, the lease owner the claim wrote; buckets and M2M are the server's."""
    return Config(
        job_id=job_id,
        city_id=args.city,
        project_id=args.project,
        private_bucket=f"{args.project}.firebasestorage.app",
        public_bucket=f"{args.project}-public",
        m2m_base_url=DEFAULT_M2M_BASE_URL,
        execution=EXECUTION,
        task_attempt=0,
        stac_url=args.stac_url,
        overpass_url=args.overpass_url,
        owner=f"{LEASE_PREFIX}{worker_id}",
        sealed=args.emulators,
    )


def signed_client(emulators: bool) -> httpx.Client:
    """The client of the signed URLs: no redirect, and every address through the guard (this machine's only under the
    emulators, else public https)."""
    hook = emulated_guard() if emulators else guarded(False)
    return httpx.Client(timeout=httpx.Timeout(60.0, read=300.0), follow_redirects=False, event_hooks={"request": [hook]})


class WorkerRuntime:
    """Builds and runs one claimed job."""

    def __init__(self, args: WorkerArgs, api: WorkerApi, worker_id: str, state: WorkerState, steps: StepsFactory) -> None:
        # Where the matcher's volumes lie, and who hears of its state (`PageActions.announce_ai`: `worker.py`).
        self.ai_root = AI_ROOT
        self.announce_ai: Callable[[AiState], None] = state.set_ai
        self.ai_sleep: Callable[[float], None] = time.sleep
        # The governor's word on each matcher request (`Governor.matcher_budget`, docs/research/M26-governor.md §4).
        self.matcher_budget: Callable[[], MatcherBudget] = MatcherBudget
        self._args = args
        self._api = api
        self._worker_id = worker_id
        self._state = state
        self._steps = steps
        self._signed = signed_client(args.emulators)
        self._http = http()
        self._ai_client = ai_client()
        self._ai_patience = Patience()

    def services(self, config: Config) -> Services:
        ids = JobIds(config.city_id, self._worker_id, config.job_id)

        def m2m() -> M2MConnection:
            return ProxyM2MSession(self._api, ids)

        return Services(
            store=ApiDocumentStore(self._api, ids, self._state.observe),
            objects=RoutedObjectStore(LocalObjectStore(self._args.work), SignedObjectStore(self._api, ids, self._signed)),
            secrets=NoSecrets(),
            m2m=m2m,
            downloads=delivery_client(config),
            stac=StacClient(self._http, config.stac_url, time.sleep),
            overpass=OverpassClient(self._http, config.overpass_url, time.sleep),
            clock=time.time,
            sleep=time.sleep,
            resolver=resolve,
            proposal_matcher=self._matcher(),
            archive_root=self._args.work,
        )

    def _matcher(self) -> LocalMatcher:
        """Only here does a run get a matcher: Cloud Run's `services.build` keeps `NullProposalMatcher` (M10)."""
        files = AiFiles(self.ai_root / "files", self._ai_client, *variant_of(os.environ))
        return LocalMatcher(
            Ports(
                self.ai_root / "box",
                files,
                self.announce_ai,
                os.environ,
                sleep=self.ai_sleep,
                patience=self._ai_patience,
                budget=self.matcher_budget,
            )
        )

    def close(self) -> None:
        self._signed.close()
        self._http.close()
        self._ai_client.close()

    def run(self, job_id: str, asked_to_stop: Callable[[], bool], asked_to_release: Callable[[], bool] = lambda: False) -> RunOutcome:
        """The job's run; it stops at its next checkpoint once `asked_to_stop` (the loop's signal) says so, and hands the job back
        once `asked_to_release` (this computer was paused) does."""
        config = worker_config(self._args, self._worker_id, job_id)
        timing = self._state.timing
        settings = RunSettings(heartbeat_seconds=timing.heartbeat_seconds, asked_to_stop=asked_to_stop, asked_to_release=asked_to_release)
        return JobRunner(config, self.services(config), self._steps(), settings).run()
