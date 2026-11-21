"""The worker assembled from its parts (docs/research/M7-local-worker.md §1): the session, the callables, the page's
server, the job runtime and the loop; `serve` runs the page in a thread and the loop in the calling (main) thread.
Finding 67 of 2026-11-02: the connector (`pairing.py`) signs it in from the command's pairing code or the session kept
in the work folder, so the page is for its state only (its Google sign-in stays as the fallback).
"""

import os
import secrets
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import cv2
import httpx

from hcm_pipeline.archive.intake import ArchiveStore
from hcm_pipeline.governor.actuate import Actuators, idle_io
from hcm_pipeline.governor.budget import Budget
from hcm_pipeline.governor.governor import Governor, owner_threads
from hcm_pipeline.governor.probe_linux import LinuxProbe
from hcm_pipeline.log import get_logger
from hcm_pipeline.raster import gdal
from hcm_pipeline.services import default_steps, http
from hcm_pipeline.worker.ai_state import initial_state, starter_on_state, starter_words
from hcm_pipeline.worker.api import ARCHIVE_REPORT, WorkerApi
from hcm_pipeline.worker.app import PageActions
from hcm_pipeline.worker.args import WorkerArgs
from hcm_pipeline.worker.copying import copier
from hcm_pipeline.worker.household import host_on_hello, share_of
from hcm_pipeline.worker.housekeeping import Housekeeping
from hcm_pipeline.worker.imports import ImportRoutes
from hcm_pipeline.worker.local_store import LocalObjectStore, held_films
from hcm_pipeline.worker.loop import WorkerLoop
from hcm_pipeline.worker.page import PageSettings, content_security_policy
from hcm_pipeline.worker.pairing import Connector, Pairing, SessionFile, Signer
from hcm_pipeline.worker.runtime import StepsFactory, WorkerRuntime, signed_client
from hcm_pipeline.worker.server import LocalServer
from hcm_pipeline.worker.session import Session
from hcm_pipeline.worker.sharing import Sharer, sharer
from hcm_pipeline.worker.state import WorkerState
from hcm_pipeline.worker.webconfig import WebConfig

LOG = get_logger("worker")
# Inside the container the page listens on every interface, which Docker's port publishing needs; the command publishes
# it on the computer's loopback only (`-p 127.0.0.1:8765:8765`), and the Host and Origin checks refuse anything else.
EVERY_INTERFACE: Final = ""
WORKER_ID_PREFIX: Final = "w-"
HOST_ROOT: Final = Path("/")


def profile_of(budget: Budget | None) -> str | None:
    """The governor's profile in force (`full`, `quiet`, `paused`), None before its first tick."""
    return None if budget is None else budget.profile


def sharing_thread(
    args: WorkerArgs, caller: tuple[WorkerApi, str], parts: tuple[Session, Governor, WorkerLoop], store: ArchiveStore
) -> Sharer:
    """M20 §22: the archives' series shared from a thread of their own, also while a job runs, under the governor's budget; the
    loop's claims then say `shares`."""
    (api, worker_id), (session, governor, loop) = caller, parts
    sharing = sharer(api, args.city, worker_id, store, signed_client(args.emulators))
    sharing.signed_in = lambda: session.active
    sharing.profile = lambda: profile_of(governor.budget)
    loop.shares = True
    return sharing


def new_worker_id() -> str:
    """`w-` and 16 hex characters (`WORKER_ID_PATTERN`), kept in the work folder across restarts (`SessionFile.worker_id`)."""
    return WORKER_ID_PREFIX + secrets.token_hex(8)


@dataclass(frozen=True)
class Worker:
    session: Session
    api: WorkerApi
    state: WorkerState
    actions: PageActions
    server: LocalServer
    loop: WorkerLoop
    runtime: WorkerRuntime
    client: httpx.Client
    worker_id: str
    connector: Connector
    governor: Governor
    governing: threading.Event
    sharer: Sharer

    @classmethod
    def build(
        cls,
        args: WorkerArgs,
        bind_host: str = EVERY_INTERFACE,
        clock: Callable[[], float] = time.time,
        steps: StepsFactory = default_steps,
    ) -> Worker:
        session_file = SessionFile(args.work, args.city)
        worker_id = session_file.worker_id(new_worker_id)
        # A power cut's leftovers (`*.tmp`, `*.part` of an interrupted write) go before anything runs.
        LocalObjectStore(args.work).sweep_leftovers(clock())
        client = http()
        web_config = WebConfig(client, args.endpoints.init_json, args.project)
        session = Session(
            client, lambda: f"{args.endpoints.securetoken}?key={web_config.api_key()}", clock, {"Referer": args.endpoints.referer}
        )
        api = WorkerApi(client, args.endpoints.function, session.bearer, time.sleep)
        state = WorkerState(args.city, args.project, session, worker_id)
        state.set_ai(initial_state(os.environ))
        state.image = args.image
        state.starter = starter_on_state(os.environ)
        LOG.info("%s", starter_words(state.starter))
        ids = {"cityId": args.city, "workerId": worker_id}
        # Finding 72: the image the starter's supervisor runs, which `worker.hello` compares with the installed one.
        host = host_on_hello(os.environ)
        hello = {**ids, **({"host": host} if host else {}), **({"image": args.image} if args.image else {})}
        actions = PageActions(session, api, state, web_config, hello)
        emulators = [host for host in (args.endpoints.auth_emulator,) if host]
        settings = PageSettings(args.project, args.city, LocalServer.new_csrf_token(), args.endpoints.auth_emulator)
        policy = content_security_policy(args.project, emulators)
        # M20 (docs/research/M20-import-local.md §2): a local archive's import, its report sent with the worker's own ids.
        imports = ImportRoutes(ArchiveStore(args.work), lambda body: api.call(ARCHIVE_REPORT, {**ids, **body}))
        server = LocalServer(actions, settings, (bind_host, args.port), policy, args.endpoints.hosting_origins)
        server.serve_imports(imports)
        server.on_admin = state.pace.wake
        runtime = WorkerRuntime(args, api, worker_id, state, steps)
        runtime.announce_ai = actions.announce_ai
        pairing = Pairing(client, api, args.endpoints, web_config, args.city)
        loop = WorkerLoop(session, api, state, runtime, ids)
        connector = Connector(pairing, session_file, Signer(session, actions, state.failed, loop.stop), args.pair, clock)
        actions.accept_pairing(connector.offer)
        # M26 (docs/research/M26-governor.md): how much of this computer the worker may use; `govern` starts it.
        governor = Governor(
            LinuxProbe(HOST_ROOT, args.work, clock),
            args.work,
            Actuators(gdal.SetConfigOption, set_threads=cv2.setNumThreads),
            owner_threads(os.environ),
        )
        state.machine = governor.machine
        state.pace.headroom = governor.headroom
        runtime.matcher_budget = governor.matcher_budget
        actions.choose_profile = governor.choose
        # Pause this computer (`pausing.py`): the governor frees the computer; a command from the page ends the loop's wait.
        loop.pausing.target = governor
        loop.pausing.woken = loop.nudge
        actions.pausing = loop.pausing
        state.paused = loop.pausing.snapshot
        loop.connect_with(connector)
        # The worker's disk (`housekeeping.py`): said with each claim, swept with the server's job states after it.
        housekeeping = Housekeeping(args.work, args.city, clock)
        loop.claim_extra = housekeeping.claim_extra
        loop.on_claim_answer = housekeeping.answered
        loop.sweep = housekeeping.sweep
        archives = ArchiveStore(args.work)
        loop.archives = archives.held
        loop.films = lambda: held_films(args.work, args.city)
        loop.copier = copier(api, args.city, worker_id, archives, signed_client(args.emulators))
        loop.supervised = args.supervised
        # W5: each claim says the governor's share, so a computer whose person is at it leaves the job to a calm one.
        loop.share = lambda: share_of(governor.machine())
        actions.remove_here = loop.remove_here
        # M20 §22: the archives' series shared from a thread of their own (`sharing_thread`).
        return cls(
            *(session, api, state, actions, server, loop, runtime, client, worker_id, connector, governor, threading.Event()),
            sharing_thread(args, (api, worker_id), (session, governor, loop), archives),
        )

    def govern(self, lower: Callable[[], None] = idle_io) -> None:
        """The person at the computer first: the idle I/O class (the command niced the process), then the governor's ticks in a thread
        until `close`."""
        lower()
        self.governor.tick()
        threading.Thread(target=self.governor.run, args=(self.governing,), name="governor", daemon=True).start()

    def serve(self) -> None:
        """The page in a thread, the loop here, until SIGTERM or Ctrl-C."""
        self.server.start()
        threading.Thread(target=self.sharer.run, name="sharing", daemon=True).start()
        LOG.info(
            "worker %s: open http://localhost:%d/ to see what it does (the admin's command signs it in)", self.worker_id, self.server.port
        )
        try:
            self.loop.run()
        finally:
            self.close()
            LOG.info("worker %s stopped", self.worker_id)

    def close(self) -> None:
        """The page's socket and every client closed (the tokens go with the process)."""
        self.governing.set()
        self.sharer.stop()
        self.server.stop()
        self.runtime.close()
        self.client.close()
