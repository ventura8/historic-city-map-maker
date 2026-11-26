"""M20 (live report of 2026-11-13; docs/research/M20-import-local.md §4.1): the holder's side of an archive series' copy, wired.

A claim may answer `copy` (a series another worker waits for, of an archive this computer holds whole): `CopySender` puts its sheets
in the bucket through `worker.archiveCopy`'s signed URLs (`copy_store`) and says `done` with the bytes sent. A refusal or a network
failure is logged and leaves the job waiting: the next claim asks again.
"""

from collections.abc import Callable, Mapping

import httpx

from hcm_pipeline.archive.copy import CopySender
from hcm_pipeline.archive.intake import ArchiveStore
from hcm_pipeline.log import get_logger
from hcm_pipeline.objects import ObjectStore
from hcm_pipeline.worker.api import ARCHIVE_COPY, WorkerApi, WorkerApiError
from hcm_pipeline.worker.documents import JobIds
from hcm_pipeline.worker.signed_store import copy_store

LOG = get_logger("worker.copying")


def copy_sender(api: WorkerApi, city_id: str, worker_id: str, store: ArchiveStore, signed: httpx.Client) -> CopySender:
    """The holder's sender: each copy's files signed by `worker.archiveCopy` for its job, and its `done` said there."""

    def objects(job_id: str) -> ObjectStore:
        return copy_store(api, JobIds(city_id, worker_id, job_id), signed)

    def finish(job_id: str, sent: int) -> None:
        api.call(ARCHIVE_COPY, {**JobIds(city_id, worker_id, job_id).body(), "copy": {"kind": "done", "bytes": sent}})

    return CopySender(store, objects, finish)


def copier(
    api: WorkerApi, city_id: str, worker_id: str, store: ArchiveStore, signed: httpx.Client
) -> Callable[[Mapping[str, object]], None]:
    """What the loop calls with a claim's `copy` (a server older than M20 §22, or a worker that does not share on its own)."""
    sender = copy_sender(api, city_id, worker_id, store, signed)

    def send(duty: Mapping[str, object]) -> None:
        try:
            sender.send(city_id, duty)
        except WorkerApiError as error:
            LOG.warning("the server refused the copy of job %s: %s", duty.get("jobId"), error)

    return send
