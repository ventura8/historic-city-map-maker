"""Which accepted frames a proved frame is held to, at their edges (M15-calibration-accuracy.md, *Joint solve*)."""

from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path

import httpx
import numpy
import pytest
from hcm_pipeline.calibrate.joint import DISAGREES, FEW, USED, Verdict
from hcm_pipeline.calibrate.ties import AlignImage
from hcm_pipeline.documents import Version
from hcm_pipeline.geo import Bounds, MercatorBox
from hcm_pipeline.joblog import JobLog
from hcm_pipeline.jobs import JobContext, LeaseLostError, RunFlags
from hcm_pipeline.log import get_logger
from hcm_pipeline.model import Job
from hcm_pipeline.objects import GcsObjectStore, ObjectInfo, ObjectStore, ObjectStoreError
from hcm_pipeline.raster import gdal
from hcm_pipeline.steps.aligning import (
    Held,
    Ours,
    alignment_record,
    held_frames,
    held_ties,
    joined_summary,
    read_onto,
    window_box,
    write_align,
)
from hcm_pipeline.steps.warp import Attached
from hcm_pipeline.store import DocumentStore, FirestoreStore
from hcm_pipeline.tokens import EmulatorTokens
from hcm_pipeline.worker.api import RevokedError, WorkerApiError

from tests.fakes.documents import DEADLINE_EXCEEDED, FakeFirestoreClient, MemoryStore
from tests.fakes.world import CITY, JOB_ID, LAYER_ID, PipelineWorld, city_bounds

BOUNDS = city_bounds()
PROVED = {"calibration": {"how": "votes"}, "georef": {"method": "auto"}}


def context(world: PipelineWorld, workdir: Path) -> JobContext:
    world.seed_import()
    log = JobLog(world.store, f"{world.job_path()}/logs", world.clock, get_logger("test"))
    job, version = Job.of(JOB_ID, world.job()), Version.of(JOB_ID, world.version())
    return JobContext(world.config, world.services(), job, version, workdir, RunFlags(), log)


def frame(world: PipelineWorld, version_id: str, year: int, **fields: object) -> None:
    """An accepted, proved frame over the city with its image, unless `fields` say otherwise (`image=False`: none kept)."""
    keep = fields.pop("image", True)
    record = {**world.version(), "state": "published", "year": year, "output": {"bounds": BOUNDS}, **PROVED, **fields}
    world.store.seed(world.version_path(version_id), record)
    if keep:
        world.gcs.put(f"rasters/{CITY}/{LAYER_ID}/{version_id}/align.tif", b"an image")


def test_happy_path_the_accepted_proved_frames_over_it_newest_first(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P06-HAPPY-JOINT-HELD-STILL"""
    ctx = context(world, tmp_path)
    frame(world, "v-1972", 1972)
    frame(world, "v-1979", 1979, state="approved")

    found = held_frames(ctx, Bounds.of(BOUNDS))

    assert found == [
        Held("v-1979", 1979, f"rasters/{CITY}/{LAYER_ID}/v-1979/align.tif"),
        Held("v-1972", 1972, f"rasters/{CITY}/{LAYER_ID}/v-1972/align.tif"),
    ]


def test_bad_path_a_frame_that_cannot_be_held_is_passed_over(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P06-BAD-JOINT-NOT-ACCEPTED"""
    ctx = context(world, tmp_path)
    elsewhere = {"west": 30.0, "south": 50.0, "east": 30.1, "north": 50.1}
    frame(world, "v-points", 1970, georef={"method": "gcps"})
    frame(world, "v-refused", 1971, calibration={"how": "none"})
    frame(world, "v-rejected", 1972, state="rejected")
    frame(world, "v-no-image", 1973, image=False)
    frame(world, "v-elsewhere", 1974, output={"bounds": elsewhere})
    frame(world, "v-no-bounds", 1975, output={"bounds": {"west": 1.0}})
    frame(world, "v-no-output", 1976, output=None)

    assert held_frames(ctx, Bounds.of(BOUNDS)) == []


def test_bad_path_a_version_gone_between_the_list_and_its_read_is_passed_over(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P06-BAD-JOINT-NOT-ACCEPTED"""
    ctx = context(world, tmp_path)
    frame(world, "v-1972", 1972)
    listed = ctx.services.store.list_ids
    monkeypatch.setattr(ctx.services.store, "list_ids", lambda collection: [*listed(collection), "v-gone"])

    assert [held.version_id for held in held_frames(ctx, Bounds.of(BOUNDS))] == ["v-1972"]


def test_bad_path_a_server_that_lists_no_versions_to_the_run_leaves_the_frame_alone(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P06-BAD-JOINT-NOT-ACCEPTED"""
    ctx = context(world, tmp_path)
    frame(world, "v-1972", 1972)

    listed = ctx.services.store.list_ids

    def refused(collection: str) -> list[str]:
        if collection.endswith("/layerVersions"):
            raise WorkerApiError("apiError.worker.refused", "the collection is off the allow-list")
        return listed(collection)

    monkeypatch.setattr(ctx.services.store, "list_ids", refused)

    assert held_frames(ctx, Bounds.of(BOUNDS)) == []
    assert any(line.startswith("the other frames could not be read") for line in world.log_lines())


def test_bad_path_a_version_the_server_cannot_read_is_no_partner_and_the_frame_goes_on(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P06-BAD-JOINT-UNREADABLE
    The live join of 2026-11-08: one older version failed its schema on the server, and the read answered apiError.internal."""
    ctx = context(world, tmp_path)
    frame(world, "v-1972", 1972)
    frame(world, "v-1966", 1966)
    frame(world, "v-1968", 1968)
    read = ctx.services.store.get

    def broken(path: str) -> object:
        if path.endswith(("/v-1966", "/v-1968")):
            raise WorkerApiError("apiError.internal", "the server could not read it")
        return read(path)

    monkeypatch.setattr(ctx.services.store, "get", broken)

    assert [held.version_id for held in held_frames(ctx, Bounds.of(BOUNDS))] == ["v-1972"]
    warned = [line for line in world.log_lines() if line.startswith("2 other frames could not be read")]
    assert len(warned) == 1
    assert "v-1966" in warned[0]
    assert "v-1968" in warned[0]


def test_bad_path_a_partner_whose_image_cannot_be_looked_up_is_left_out_with_one_line_naming_it(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P06-BAD-JOINT-UNREADABLE
    A local worker looks a partner's `align.tif` up through worker.urls: a refusal, a store failure or an id off the path pattern."""
    ctx = context(world, tmp_path)
    frame(world, "v-1972", 1972)
    frame(world, "v-1966", 1966)
    frame(world, "v-1968", 1968)
    frame(world, "v-1970", 1970, layerId="not a layer")
    stat = ctx.services.objects.stat
    failures = {
        "v-1966": WorkerApiError("apiError.unavailable", "https://signed.example/x?X-Goog-Signature=s"),
        "v-1968": ObjectStoreError("HTTP 500"),
    }

    def failing(path: str) -> ObjectInfo | None:
        for version_id, error in failures.items():
            if f"/{version_id}/" in path:
                raise error
        return stat(path)

    monkeypatch.setattr(ctx.services.objects, "stat", failing)

    assert [held.version_id for held in held_frames(ctx, Bounds.of(BOUNDS))] == ["v-1972"]
    lines = world.log_lines()
    for version_id in ("v-1966", "v-1968", "v-1970"):
        assert [line for line in lines if version_id in line] == [f"the accepted frame {version_id} could not be found: fitted without it"]
    assert not any("signed.example" in line or "not a layer" in line for line in lines)


def test_bad_path_a_lost_lease_or_a_revoked_computer_while_looking_up_a_partner_still_stops_the_run(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P06-BAD-JOINT-UNREADABLE"""
    ctx = context(world, tmp_path)
    frame(world, "v-1972", 1972)
    for error in (LeaseLostError("another execution"), RevokedError("disconnected")):

        def stopped(_path: str, error: Exception = error) -> ObjectInfo | None:
            raise error

        monkeypatch.setattr(ctx.services.objects, "stat", stopped)
        with pytest.raises(type(error)):
            held_frames(ctx, Bounds.of(BOUNDS))


def ours_over() -> Ours:
    """The joining frame's image over the city (its scan's map is never read: the partner fails first)."""
    box = Bounds.of(BOUNDS).mercator()
    return Ours(Attached(Path("never-read.tif"), {}, ()), (0, 0), AlignImage(numpy.zeros((8, 8), numpy.uint8), box.left, box.top, 5.0))


def test_bad_path_a_partner_whose_image_cannot_be_staged_or_read_is_left_out_and_the_frame_fits_alone(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P06-BAD-JOINT-UNREADABLE
    Deleted between its look-up and its download, refused by worker.urls, or a file GDAL cannot read: never a failed import."""
    ctx = context(world, tmp_path)
    frame(world, "v-1972", 1972)
    frame(world, "v-1966", 1966)
    frame(world, "v-1968", 1968)
    held = held_frames(ctx, Bounds.of(BOUNDS))
    world.gcs.objects.pop(f"rasters/{CITY}/{LAYER_ID}/v-1966/align.tif")
    download = ctx.services.objects.download_file

    def refused(path: str, local: Path) -> ObjectInfo:
        if "/v-1968/" in path:
            raise WorkerApiError("apiError.worker.refused", "off the allow-list")
        return download(path, local)

    monkeypatch.setattr(ctx.services.objects, "download_file", refused)

    assert held_ties(ctx, ours_over(), held) == []
    lines = world.log_lines()
    for version_id in ("v-1972", "v-1966", "v-1968"):
        said = [line for line in lines if version_id in line]
        assert said == [f"the accepted frame {version_id} could not be measured: fitted without it"]
    assert ctx.staged == {}


def test_bad_path_a_lost_lease_while_staging_a_partner_still_stops_the_run(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P06-BAD-JOINT-UNREADABLE"""
    ctx = context(world, tmp_path)
    frame(world, "v-1972", 1972)
    held = held_frames(ctx, Bounds.of(BOUNDS))

    def revoked(_path: str, _local: Path) -> ObjectInfo:
        raise RevokedError("disconnected")

    monkeypatch.setattr(ctx.services.objects, "download_file", revoked)

    with pytest.raises(RevokedError):
        held_ties(ctx, ours_over(), held)


class Counting(MemoryStore):
    """The world's documents, with a list that says it left `count` versions out, as the server's `worker.step` does since 2026-11-08."""

    def __init__(self, store: MemoryStore, count: int) -> None:
        super().__init__()
        self.documents = store.documents
        self.count = count

    def skipped(self, collection: str) -> int:
        return self.count if collection.endswith("/layerVersions") else 0


@pytest.mark.parametrize(("skipped", "said"), [(2, ["2 of the city's frames could not be read and were left out"]), (0, [])])
def test_bad_path_the_frames_the_server_left_out_of_its_list_are_counted_in_the_job_log(
    world: PipelineWorld, tmp_path: Path, skipped: int, said: list[str]
) -> None:
    """Scenarios: S-P06-BAD-JOINT-UNREADABLE"""
    plain = context(world, tmp_path)
    frame(world, "v-1972", 1972)
    services = replace(plain.services, store=Counting(world.store, skipped))
    ctx = JobContext(plain.config, services, plain.job, plain.version, tmp_path, RunFlags(), plain.log)

    assert [held.version_id for held in held_frames(ctx, Bounds.of(BOUNDS))] == ["v-1972"]
    assert [line for line in world.log_lines() if "of the city's frames" in line] == said


def with_services(
    world: PipelineWorld, tmp_path: Path, store: DocumentStore | None = None, objects: ObjectStore | None = None
) -> JobContext:
    """The import's context over other ports (Cloud Run's Firestore adapter, Cloud Storage over a network that fails)."""
    plain = context(world, tmp_path)
    services = replace(plain.services, store=store or plain.services.store, objects=objects or plain.services.objects)
    return JobContext(plain.config, services, plain.job, plain.version, tmp_path, RunFlags(), plain.log)


def firestore_over(world: PipelineWorld, faults: dict[str, Exception]) -> FirestoreStore:
    client = FakeFirestoreClient(documents=world.store.documents, faults=faults)
    return FirestoreStore(client, client.write_option, client.deleted_marker)


def test_bad_path_a_partner_firestore_cannot_read_on_cloud_run_is_left_out_and_the_frame_joins_the_others(
    world: PipelineWorld, tmp_path: Path
) -> None:
    """Scenarios: S-P06-BAD-JOINT-UNREADABLE
    The review of a6750294: a `DeadlineExceeded` of one partner's read escaped `PARTNER_FAILURES` and failed the import as `internal`."""
    slow = {world.version_path("v-1966"): DEADLINE_EXCEEDED("Deadline of 60.0s exceeded")}
    ctx = with_services(world, tmp_path, store=firestore_over(world, slow))
    frame(world, "v-1972", 1972)
    frame(world, "v-1966", 1966)

    assert [held.version_id for held in held_frames(ctx, Bounds.of(BOUNDS))] == ["v-1972"]
    assert [line for line in world.log_lines() if "v-1966" in line] == ["1 other frames could not be read (v-1966): fitted without them"]


def test_bad_path_a_list_firestore_cannot_answer_on_cloud_run_fits_the_frame_alone(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P06-BAD-JOINT-UNREADABLE"""
    slow = {f"cities/{CITY}/layerVersions": DEADLINE_EXCEEDED("Deadline of 60.0s exceeded")}
    ctx = with_services(world, tmp_path, store=firestore_over(world, slow))
    frame(world, "v-1972", 1972)

    assert held_frames(ctx, Bounds.of(BOUNDS)) == []
    said = [line for line in world.log_lines() if "other frames" in line]
    failure = f"Firestore list of cities/{CITY}/layerVersions: DeadlineExceeded"
    assert said == [f"the other frames could not be read ({failure}): the frame is fitted alone"]


class Flaky:
    """Cloud Storage behind a network that fails: `unreachable`'s look-up cannot connect, and every download is cut after its first
    block."""

    def __init__(self, unreachable: str) -> None:
        self.unreachable = unreachable

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if "alt" in request.url.params:
            return httpx.Response(200, content=self._cut(request))
        if self.unreachable in str(request.url):
            raise httpx.ConnectError("connection refused", request=request)
        return httpx.Response(200, json={"name": "align.tif", "size": "8", "generation": "1"})

    @staticmethod
    def _cut(request: httpx.Request) -> Iterator[bytes]:
        yield b"II*\x00"
        raise httpx.ReadError("connection reset by peer", request=request)


def test_bad_path_a_partner_the_network_cannot_reach_or_cuts_midway_is_left_out_by_name_and_its_file_unstaged(
    world: PipelineWorld, tmp_path: Path
) -> None:
    """Scenarios: S-P06-BAD-JOINT-UNREADABLE
    The review of a6750294: httpx's `ConnectError` of a look-up and `ReadError` of a download escaped `PARTNER_FAILURES`, failing the
    import as `internal` and leaving the bytes read so far in the scratch."""
    with httpx.Client(transport=httpx.MockTransport(Flaky("v-1966"))) as client:
        objects = GcsObjectStore(client, world.config.private_bucket, EmulatorTokens(), "http://storage.test")
        ctx = with_services(world, tmp_path, objects=objects)
        frame(world, "v-1972", 1972)
        frame(world, "v-1966", 1966)

        held = held_frames(ctx, Bounds.of(BOUNDS))
        assert [frame.version_id for frame in held] == ["v-1972"]
        assert held_ties(ctx, ours_over(), held) == []

    lines = world.log_lines()
    assert [line for line in lines if "v-1966" in line] == ["the accepted frame v-1966 could not be found: fitted without it"]
    assert [line for line in lines if "v-1972" in line] == ["the accepted frame v-1972 could not be measured: fitted without it"]
    assert not any("storage.test" in line for line in lines)
    assert ctx.staged == {}
    assert not (tmp_path / "align-v-1972.tif").exists()


def test_happy_path_the_record_and_the_log_line_name_every_partner() -> None:
    """Scenarios: S-P06-HAPPY-JOINT-HELD-STILL, S-P06-BAD-JOINT-PARTNER-DISAGREES"""
    verdicts = [Verdict("v-1972", 1420, 1643, USED, 1.36), Verdict("v-1966", 78, 124, FEW), Verdict("v-x", 900, 1500, DISAGREES, 9.2)]
    held = [Held("v-1972", 1972, "a"), Held("v-1966", None, "b")]

    record = alignment_record(verdicts, held)

    assert record == {
        "partners": [
            {"versionId": "v-1972", "ties": 1420, "tried": 1643, "status": USED, "offsetM": 1.36, "year": 1972},
            {"versionId": "v-1966", "ties": 78, "tried": 124, "status": FEW},
            {"versionId": "v-x", "ties": 900, "tried": 1500, "status": DISAGREES, "offsetM": 9.2},
        ]
    }
    assert joined_summary(verdicts) == "joined to 1 accepted frames held still, 1420 film ties; left out: v-1966 (few), v-x (disagrees)"
    assert joined_summary(verdicts[:1]) == "joined to 1 accepted frames held still, 1420 film ties"


def test_happy_path_an_image_written_and_read_back_on_another_grid_keeps_its_cells(tmp_path: Path) -> None:
    """Scenarios: S-P06-HAPPY-JOINT-HELD-STILL"""
    grey = numpy.zeros((40, 60), numpy.uint8)
    grey[10:30, 20:50] = numpy.arange(1, 31, dtype=numpy.uint8)[None, :]
    path = write_align(AlignImage(grey, 2.9e6, 5.5e6, 7.0), tmp_path / "align.tif")
    dataset = gdal.Open(str(path))
    assert dataset.GetRasterBand(1).GetNoDataValue() == 0
    dataset.Close()

    wider = read_onto(path, AlignImage(numpy.zeros((50, 70), numpy.uint8), 2.9e6 - 70.0, 5.5e6 + 70.0, 7.0))

    assert numpy.array_equal(wider.grey[10:50, 10:70], grey)
    assert int(wider.grey[:10].max()) == 0
    box = window_box(MercatorBox(10.5, -3.2, 99.0, 50.1), 7.0)
    assert (box.left, box.bottom, box.right, box.top) == (7.0, -7.0, 105.0, 56.0)
