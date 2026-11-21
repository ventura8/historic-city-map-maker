"""The Cloud Storage adapter against the fake JSON API: create-only uploads, sessions, reads, listing, deletes."""

from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from hcm_pipeline.objects import (
    GcsObjectStore,
    ObjectInfo,
    ObjectStoreError,
    PreconditionFailedError,
    SessionExpiredError,
    md5_of,
    sha256_of,
)
from hcm_pipeline.tokens import EmulatorTokens

from tests.fakes.gcs import FakeGcsServer
from tests.fakes.http import FakeHttpServer, Reply

BUCKET = "demo-hcm.firebasestorage.app"


@pytest.fixture
def gcs() -> Iterator[FakeGcsServer]:
    with FakeGcsServer(BUCKET) as server:
        yield server


@pytest.fixture
def store(gcs: FakeGcsServer) -> Iterator[GcsObjectStore]:
    with httpx.Client() as client:
        yield GcsObjectStore(client, BUCKET, EmulatorTokens(), gcs.base_url + "/")


def test_happy_path_an_upload_is_created_once_and_read_back(store: GcsObjectStore, gcs: FakeGcsServer, tmp_path: Path) -> None:
    local = tmp_path / "scan.tif"
    local.write_bytes(b"II*\x00" + bytes(range(256)) * 40)

    info = store.upload_file(local, "rasters/bucharest/layer/v1/scan.tif", "image/tiff")
    again = store.upload_file(local, "rasters/bucharest/layer/v1/scan.tif", "image/tiff")

    assert info == again
    assert info.size == local.stat().st_size
    assert info.md5 == md5_of(local)
    assert store.stat("rasters/bucharest/layer/v1/scan.tif") == info
    assert store.stat("rasters/missing.tif") is None
    downloaded = store.download_file(info.path, tmp_path / "copy.tif")
    assert (tmp_path / "copy.tif").read_bytes() == local.read_bytes()
    assert downloaded.generation == info.generation
    with store.open_read(info.path) as stream:
        assert stream.read() == local.read_bytes()
    assert sha256_of(local) == sha256_of(tmp_path / "copy.tif")


def test_happy_path_a_different_file_replaces_the_object(store: GcsObjectStore, gcs: FakeGcsServer, tmp_path: Path) -> None:
    gcs.put("work/bucharest/job/fetch.checkpoint.json", b'{"old": true}')
    local = tmp_path / "checkpoint.json"
    local.write_text('{"new": true}')

    info = store.upload_file(local, "work/bucharest/job/fetch.checkpoint.json", "application/json")

    assert gcs.objects[info.path].data == b'{"new": true}'


def test_happy_path_listing_follows_pages_and_deletes_tolerate_missing_objects(store: GcsObjectStore, gcs: FakeGcsServer) -> None:
    for name in ("a", "b", "c", "d", "e"):
        gcs.put(f"work/bucharest/job/{name}.tif", name.encode())
    gcs.put("work/bucharest/other/x.tif", b"x")

    listed = store.list("work/bucharest/job/")
    for info in listed:
        store.delete(info.path)
    store.delete("work/bucharest/job/a.tif")

    assert [info.path for info in listed] == [f"work/bucharest/job/{name}.tif" for name in "abcde"]
    assert gcs.names() == ["work/bucharest/other/x.tif"]


def test_happy_path_a_resumable_session_takes_chunks_and_reports_what_it_holds(store: GcsObjectStore, gcs: FakeGcsServer) -> None:
    session = store.start_resumable("usgs-raw/corona2/E1/E1.tgz", 10, "application/octet-stream")

    assert store.resumable_offset(session, 10) == 0
    assert store.write_chunk(session, 0, b"01234", 10) == 5
    assert store.resumable_offset(session, 10) == 5
    finished = store.write_chunk(session, 5, b"56789", 10)
    assert isinstance(finished, ObjectInfo)
    assert store.resumable_offset(session, 10) == finished
    assert gcs.objects["usgs-raw/corona2/E1/E1.tgz"].data == b"0123456789"


def test_bad_path_an_expired_session_and_an_existing_object_are_told_apart(store: GcsObjectStore, gcs: FakeGcsServer) -> None:
    session = store.start_resumable("usgs-raw/corona2/E1/E1.tgz", 4, "application/octet-stream")
    gcs.expire_sessions()
    gcs.put("usgs-raw/corona2/E2/E2.tgz", b"x")

    with pytest.raises(SessionExpiredError):
        store.resumable_offset(session, 4)
    with pytest.raises(SessionExpiredError):
        store.resumable_offset(gcs.base_url + "/upload/session/s404", 4)
    with pytest.raises(PreconditionFailedError):
        store.start_resumable("usgs-raw/corona2/E2/E2.tgz", 1, "application/octet-stream")


def test_bad_path_a_session_finished_by_someone_else_is_a_precondition_failure(store: GcsObjectStore, gcs: FakeGcsServer) -> None:
    session = store.start_resumable("rasters/a.tif", 2, "image/tiff")
    gcs.put("rasters/a.tif", b"zz")

    with pytest.raises(PreconditionFailedError):
        store.write_chunk(session, 0, b"ab", 2)


def test_bad_path_an_empty_file_finishes_with_an_empty_range(store: GcsObjectStore, tmp_path: Path) -> None:
    empty = tmp_path / "empty.json"
    empty.write_bytes(b"")

    assert store.upload_file(empty, "work/bucharest/job/empty.json", "application/json").size == 0


@pytest.mark.parametrize(
    ("reply", "problem"),
    [
        (Reply(500, b"oops"), "Cloud Storage stat: HTTP 500"),
        (Reply.json("[]"), "without object metadata"),
    ],
)
def test_bad_path_unexpected_answers_are_object_store_errors(reply: Reply, problem: str) -> None:
    with FakeHttpServer() as server, httpx.Client() as client:
        server.route("GET", f"/storage/v1/b/{BUCKET}/o/x.tif", lambda _request: reply)
        store = GcsObjectStore(client, BUCKET, EmulatorTokens(), server.root_url)

        with pytest.raises(ObjectStoreError, match=problem):
            store.stat("x.tif")


def test_bad_path_a_session_start_without_an_address_is_refused() -> None:
    with FakeHttpServer() as server, httpx.Client() as client:
        server.route("POST", f"/upload/storage/v1/b/{BUCKET}/o", lambda _request: Reply(200))
        store = GcsObjectStore(client, BUCKET, EmulatorTokens(), server.root_url)

        with pytest.raises(ObjectStoreError, match="no session address"):
            store.start_resumable("x.tif", 1, "image/tiff")


def cut_short(request: httpx.Request) -> Iterator[bytes]:
    """A body whose connection is reset after its first block."""
    yield b"II*\x00 the first block"
    raise httpx.ReadError("connection reset by peer", request=request)


def flaky(request: httpx.Request) -> httpx.Response:
    """Cloud Storage behind a network that fails: a look-up that cannot connect, a download cut after its first block."""
    if "alt" not in request.url.params:
        raise httpx.ConnectError("connection refused", request=request)
    return httpx.Response(200, content=cut_short(request))


def test_bad_path_a_look_up_or_a_download_the_network_cuts_is_an_object_store_error_and_leaves_no_partial_file(tmp_path: Path) -> None:
    """Scenarios: S-P06-BAD-JOINT-UNREADABLE
    The review of a6750294: httpx's own errors escaped the port, so a caller that catches `ObjectStoreError` failed the whole job."""
    local = tmp_path / "align.tif"
    with httpx.Client(transport=httpx.MockTransport(flaky)) as client:
        store = GcsObjectStore(client, BUCKET, EmulatorTokens(), "http://storage.test")

        with pytest.raises(ObjectStoreError, match=r"^Cloud Storage stat: ConnectError$"):
            store.stat("rasters/x/align.tif")
        with pytest.raises(ObjectStoreError, match=r"^Cloud Storage download: ReadError$"):
            store.download_file("rasters/x/align.tif", local)

    assert not local.exists()
