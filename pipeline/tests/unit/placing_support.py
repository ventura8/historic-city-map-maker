"""What the placers' tests share (docs/research/M20-import-local.md §3): an archive series' job in the fake world, its sheets on disk.

`series_context` makes the job's context with its sheets already gathered (the local `sheets.json` `gather` leaves), the files written
where the archive keeps its originals, and OpenStreetMap answering with the synthetic town's streets (`tests.synthetic.town`).
"""

import json
from collections.abc import Mapping, Sequence
from dataclasses import replace
from pathlib import Path

from hcm_pipeline.archive.intake import ArchiveStore
from hcm_pipeline.archive.model import Probe
from hcm_pipeline.documents import Version
from hcm_pipeline.joblog import JobLog
from hcm_pipeline.jobs import JobContext, RunFlags
from hcm_pipeline.log import get_logger
from hcm_pipeline.model import Job
from hcm_pipeline.steps.gather import SHEETS

from tests.fakes.http import Reply
from tests.fakes.world import JOB_ID, OVERPASS_PATH, PipelineWorld
from tests.synthetic.sheets import Series, SheetsSpec, make_series
from tests.synthetic.town import Line, overpass_of, town_lines

SERIES_ID = "s-0123456789ab"


def answer_with(world: PipelineWorld, lines: Sequence[Line] | None) -> None:
    """OpenStreetMap answers with `lines` (the town's by default); None: Overpass fails."""
    if lines is None:
        world.http.route("POST", OVERPASS_PATH, lambda _request: Reply(503, b"busy"))
        return
    body = json.dumps(overpass_of(lines))
    world.http.route("POST", OVERPASS_PATH, lambda _request: Reply.json(body))


def archive_of(work: Path) -> tuple[ArchiveStore, str]:
    store = ArchiveStore(work, lambda _path: Probe("tiff", 10, 10, 1, 8, "grey"))
    return store, store.create()


def series_context(
    world: PipelineWorld, tmp_path: Path, sheets: Sequence[str], params: Mapping[str, object], lines: Sequence[Line] | None = ()
) -> JobContext:
    """The job of a series whose `sheets` (paths relative to the archive) already lie in the archive's folder under `tmp_path/work`."""
    world.seed_import()
    answer_with(world, town_lines() if lines == () else lines)
    _store, archive_id = archive_of(tmp_path / "work")
    scratch = tmp_path / "scratch"
    scratch.mkdir(parents=True, exist_ok=True)
    rows = [{"path": path, "cell": None, "bytes": 1, "sha256": "0" * 64} for path in sheets]
    (scratch / SHEETS).write_text(json.dumps({"sheets": rows}), encoding="utf-8")
    full = {"archiveId": archive_id, "seriesId": SERIES_ID, "sheets": len(sheets), "order": 0, "referenceLayerIds": [], **params}
    log = JobLog(world.store, f"{world.job_path()}/logs", world.clock, get_logger("test"))
    job = replace(Job.of(JOB_ID, world.job()), type="archive-series", params=full)
    services = replace(world.services(), archive_root=tmp_path / "work")
    return JobContext(world.config, services, job, Version.of(JOB_ID, world.version()), scratch, RunFlags(), log)


def originals(ctx: JobContext) -> Path:
    """Where the series' originals lie on this computer."""
    root = ctx.services.archive_root
    assert root is not None
    folder = ArchiveStore(root).files(str(ctx.job.params["archiveId"]))
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def staged_series(world: PipelineWorld, tmp_path: Path, spec: SheetsSpec, kind: str = "atlas") -> tuple[JobContext, Series]:
    """A synthetic series (`tests.synthetic.sheets`, in grid order) moved where the archive keeps its originals, and its job."""
    staging = make_series(tmp_path / "staging", replace(spec, shuffle=False))
    ctx = series_context(world, tmp_path, [name for name, _path in staging.named], {"class": kind, "encoding": "grey"})
    for name, path in staging.named:
        target = originals(ctx) / name
        target.parent.mkdir(parents=True, exist_ok=True)
        path.rename(target)
    return ctx, staging
