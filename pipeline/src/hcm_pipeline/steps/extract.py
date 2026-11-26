"""`extract`: the delivery's TIFF segments, and nothing else (docs/research/M3-interfaces.md §5.3).

A `.tgz` is streamed front to back (`tarfile` `r|gz`, never extracted to paths: only the members' bytes are read);
a `.zip` is staged first (its directory is at the end). Each TIFF member (`*_a.tif` ... `*_n.tif`, or a single
TIFF) becomes `work/{city}/{job}/segments/{letter}.tif`. An unreadable archive, or one without a TIFF, fails with
`apiError.imagery.archiveCorrupt` and the delivery is deleted, so a retry fetches it again. A disk that cannot be read or
written (a full one above all) says nothing about the archive: it fails with `apiError.imagery.processingFailed` and the
delivery stays, so a retry needs no download of many gigabytes. An archive's reader that asks for a position no file has
(`EINVAL`: a damaged zip directory's negative offset) is the archive's damage, not the disk's.
"""

import errno
import re
import tarfile
import zipfile
import zlib
from collections.abc import Iterator
from contextlib import contextmanager
from typing import IO, Final, NoReturn

from hcm_pipeline.contract import Errors
from hcm_pipeline.jobs import Done, JobContext, StepFailedError, StepResult
from hcm_pipeline.objects import READ_BYTES, ObjectInfo

SEGMENT: Final = re.compile(r"(?:_([a-z]))?\.tiff?$", re.IGNORECASE)
# Finding 84 of 2026-11-05: a KH-9 panoramic frame comes in 14 parts (`_a` to `_n`). The limit was 8 and silently dropped
# the rest, so the 1972 frame ended at the edge of the city its corners promised. It only refuses an archive no scan is.
MAX_SEGMENTS: Final = 26
# What only a damaged archive raises. Not `OSError`: that is this machine's disk, and it once deleted a good delivery of 8.7 GB.
_CORRUPT: Final = (tarfile.TarError, zipfile.BadZipFile, zlib.error, EOFError)
Member = tuple[str, IO[bytes]]


def segment_letter(name: str, seen: int) -> str | None:
    """The segment's letter (`_a` → `a`), the next free one for a TIFF without a suffix, None for anything else."""
    found = SEGMENT.search(name)
    if found is None:
        return None
    return (found.group(1) or chr(ord("a") + seen)).lower()


def _tar_members(stream: IO[bytes]) -> Iterator[Member]:
    with tarfile.open(fileobj=stream, mode="r|gz") as archive:
        for member in archive:
            data = archive.extractfile(member) if member.isfile() else None
            if data is not None:
                yield member.name, data


@contextmanager
def _zip_members(ctx: JobContext, delivery: str) -> Iterator[Iterator[Member]]:
    with zipfile.ZipFile(ctx.stage(delivery)) as archive:
        yield ((name, archive.open(name)) for name in archive.namelist() if not name.endswith("/"))


@contextmanager
def _members(ctx: JobContext, delivery: str) -> Iterator[Iterator[Member]]:
    if delivery.lower().endswith(".zip"):
        with _zip_members(ctx, delivery) as members:
            yield members
        return
    with ctx.services.objects.open_read(delivery) as stream:
        yield _tar_members(stream)


def _disk_failed(error: OSError) -> NoReturn:
    why = error.strerror or type(error).__name__
    raise StepFailedError(Errors.PROCESSING_FAILED, f"the delivery is kept, but its segments could not be written: {why}") from error


def _write(file: IO[bytes], chunk: bytes) -> None:
    """One chunk onto this machine's disk: whatever fails here is the disk's, never the archive's."""
    try:
        file.write(chunk)
    except OSError as error:
        _disk_failed(error)


def _keep(ctx: JobContext, letter: str, data: IO[bytes]) -> ObjectInfo:
    local = ctx.local(f"segments/{letter}.tif")
    with local.open("wb") as file:
        for chunk in iter(lambda: data.read(READ_BYTES), b""):
            _write(file, chunk)
    ctx.checkpoint()
    published = ctx.publish(local, ctx.work_file(f"segments/{letter}.tif"), "image/tiff")
    # The scratch folder is memory on Cloud Run: a segment goes once it is in the bucket (the small download job, finding 56).
    local.unlink()
    return published


def _segments(ctx: JobContext, delivery: str) -> list[ObjectInfo]:
    kept: list[ObjectInfo] = []
    with _members(ctx, delivery) as members:
        for name, data in members:
            letter = segment_letter(name, len(kept))
            if letter is None:
                continue
            if len(kept) == MAX_SEGMENTS:
                raise StepFailedError(Errors.ARCHIVE_CORRUPT, f"the delivery holds more than {MAX_SEGMENTS} TIFF segments")
            kept.append(_keep(ctx, letter, data))
    return kept


def _readable_segments(ctx: JobContext, delivery: str) -> list[ObjectInfo]:
    """The delivery's segments; none when the archive is damaged; a disk's failure fails the step and keeps the delivery."""
    try:
        return _segments(ctx, delivery)
    except (*_CORRUPT, OSError) as error:
        return _none_when_damaged(ctx, error)


def _none_when_damaged(ctx: JobContext, error: Exception) -> list[ObjectInfo]:
    """No segments for an archive's damage (logged); anything else this machine raised fails the step."""
    if isinstance(error, OSError) and error.errno != errno.EINVAL:
        _disk_failed(error)
    ctx.log.warn(f"the delivery is unreadable ({type(error).__name__})", ExtractStep.name)
    return []


class ExtractStep:
    name = "extract"

    def run(self, ctx: JobContext) -> StepResult:
        delivery = ctx.job.step("fetch").gcs_path
        if delivery is None:
            raise StepFailedError(Errors.ARCHIVE_CORRUPT, "the job has no fetched delivery")
        kept = _readable_segments(ctx, delivery)
        if not kept:
            ctx.services.objects.delete(delivery)
            raise StepFailedError(Errors.ARCHIVE_CORRUPT, "the delivery holds no readable TIFF segment")
        return Done(min(kept, key=lambda info: info.path))
