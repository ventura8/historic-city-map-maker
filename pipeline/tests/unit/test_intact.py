"""Unit tests for hcm_pipeline.intact: whether a finished step's local output is still whole."""

import io
from contextlib import AbstractContextManager, nullcontext
from typing import IO, cast

from hcm_pipeline.intact import output_intact
from hcm_pipeline.model import StepRecord
from hcm_pipeline.objects import ObjectInfo, ObjectStore, ObjectStoreError


class _Store:
    """Just enough of an ObjectStore: `open_read` serves bytes, or raises the given error."""

    def __init__(self, data: bytes = b"", error: Exception | None = None) -> None:
        self.data = data
        self.error = error

    def open_read(self, path: str) -> AbstractContextManager[IO[bytes]]:
        if self.error is not None:
            raise self.error
        return nullcontext(io.BytesIO(self.data))


def _check(path: str, data: bytes, recorded: int | None = None, local: bool = True, error: Exception | None = None) -> bool:
    info = ObjectInfo(path=path, size=len(data), generation="1")
    record = StepRecord(status="done", gcs_path=path, bytes=recorded)
    return output_intact(cast(ObjectStore, _Store(data, error)), record, info, local)


def test_whole_tiff_is_intact() -> None:
    assert _check("work/a.tif", b"II*\x00" + b"x" * 20, recorded=24)


def test_zeroed_tiff_is_damaged() -> None:
    assert not _check("work/a.tif", b"\x00" * 24)


def test_pmtiles_header_good_and_bad() -> None:
    assert _check("work/a.pmtiles", b"PMTiles" + b"\x03" * 10)
    assert not _check("work/a.pmtiles", b"\x00" * 17)


def test_json_parses_good_and_bad() -> None:
    assert _check("work/a.json", b'{"ok": true}')
    assert not _check("work/a.json", b'{"ok": tru')


def test_size_mismatch_and_empty_are_damaged() -> None:
    assert not _check("work/a.tif", b"II*\x00xxxx", recorded=99)
    assert not _check("work/a.json", b"")


def test_cloud_or_non_local_prefix_is_trusted() -> None:
    assert _check("work/a.tif", b"\x00" * 8, local=False)
    assert _check("published/a.tif", b"\x00" * 8)


def test_unreadable_output_is_damaged() -> None:
    assert not _check("work/a.tif", b"II*\x00", error=OSError("gone"))
    assert not _check("work/a.tif", b"II*\x00", error=ObjectStoreError("gone"))
