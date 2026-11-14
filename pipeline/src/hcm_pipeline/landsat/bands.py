"""`extract` for a Landsat scene: the bands the true colour needs, and nothing else (docs/research/M25-landsat.md §3).

A Collection 2 Level-1 product bundle is a tar of one GeoTIFF a band (`LT05_L1TP_183029_19890712_20200916_02_T1_B3.TIF`), the quality
band (`..._QA_PIXEL.TIF`) and text files. It is streamed front to back (`tarfile` `r|*`: plain or compressed, never extracted to paths);
each needed band becomes `work/{city}/{job}/bands/{band}.tif`: blue, green and red (B1, B2, B3) and the quality band for Landsat 4 and
5 TM, and the 15 m panchromatic band (B8) besides for Landsat 7 ETM+; Landsat 8 and 9 OLI number them one higher (blue B2, green B3,
red B4; B1 is its coastal band) and have the same B8. A bundle without one of them fails with
`apiError.imagery.missingBand {band}` (the first missing one; the delivery stays: it is what USGS has); an unreadable bundle fails with
`apiError.imagery.archiveCorrupt` and is deleted, so a retry fetches it again.
"""

import re
import tarfile
import zlib
from collections.abc import Mapping
from typing import IO, Final

from hcm_pipeline.contract import Errors
from hcm_pipeline.jobs import Done, JobContext, StepFailedError, StepResult
from hcm_pipeline.landsat.correct import PRECISE, level_of
from hcm_pipeline.model import UsgsImportParams
from hcm_pipeline.objects import READ_BYTES, ObjectInfo

BAND_FILE: Final = re.compile(r"_(B[1-8]|QA_PIXEL)\.TIF$", re.IGNORECASE)
QUALITY: Final = "QA_PIXEL"
TRUE_COLOUR: Final = ("B3", "B2", "B1")
OLI_TRUE_COLOUR: Final = ("B4", "B3", "B2")
PANCHROMATIC: Final = "B8"
TM_BANDS: Final = (*TRUE_COLOUR, QUALITY)
ETM_BANDS: Final = (*TRUE_COLOUR, PANCHROMATIC, QUALITY)
OLI_BANDS: Final = (*OLI_TRUE_COLOUR, PANCHROMATIC, QUALITY)
BANDS_OF: Final[Mapping[str, tuple[str, ...]]] = {
    "L4-TM": TM_BANDS,
    "L5-TM": TM_BANDS,
    "L7-ETM": ETM_BANDS,
    "L8-OLI": OLI_BANDS,
    "L9-OLI": OLI_BANDS,
}
_CORRUPT: Final = (tarfile.TarError, zlib.error, EOFError)


def band_file(band: str) -> str:
    """The band's work file name (`bands/B3.tif`)."""
    return f"bands/{band}.tif"


def band_of(name: str) -> str | None:
    """The band a member's name holds (`B3`, `QA_PIXEL`), or None for any other file."""
    found = BAND_FILE.search(name)
    return None if found is None else found.group(1).upper()


def needed_bands(sensor: str) -> tuple[str, ...]:
    """The bands `sensor`'s true colour needs (a TM's by default)."""
    return BANDS_OF.get(sensor, TM_BANDS)


def true_colour(sensor: str) -> tuple[str, str, str]:
    """`sensor`'s red, green and blue bands (B3, B2, B1; Landsat 8 and 9 OLI's B4, B3, B2)."""
    return OLI_TRUE_COLOUR if BANDS_OF.get(sensor) == OLI_BANDS else TRUE_COLOUR


def _keep(ctx: JobContext, band: str, data: IO[bytes]) -> ObjectInfo:
    local = ctx.local(band_file(band))
    with local.open("wb") as file:
        for chunk in iter(lambda: data.read(READ_BYTES), b""):
            file.write(chunk)
    ctx.checkpoint()
    published = ctx.publish(local, ctx.work_file(band_file(band)), "image/tiff")
    local.unlink()
    return published


def _wanted(member: tarfile.TarInfo, needed: tuple[str, ...], kept: Mapping[str, ObjectInfo]) -> str | None:
    """The member's band when it is a file of a needed band not kept yet, else None."""
    band = band_of(member.name) if member.isfile() else None
    return band if band is not None and band in needed and band not in kept else None


def _bands(ctx: JobContext, delivery: str, needed: tuple[str, ...]) -> dict[str, ObjectInfo]:
    kept: dict[str, ObjectInfo] = {}
    with ctx.services.objects.open_read(delivery) as stream, tarfile.open(fileobj=stream, mode="r|*") as archive:
        for member in archive:
            band = _wanted(member, needed, kept)
            data = None if band is None else archive.extractfile(member)
            if band is not None and data is not None:
                kept[band] = _keep(ctx, band, data)
    return kept


def _readable_bands(ctx: JobContext, delivery: str, needed: tuple[str, ...]) -> dict[str, ObjectInfo]:
    """The bundle's bands; a damaged bundle is deleted and fails the step."""
    try:
        return _bands(ctx, delivery, needed)
    except _CORRUPT as error:
        ctx.services.objects.delete(delivery)
        raise StepFailedError(Errors.ARCHIVE_CORRUPT, f"the Landsat bundle is unreadable ({type(error).__name__})") from error


def _refuse_missing(needed: tuple[str, ...], kept: Mapping[str, ObjectInfo]) -> None:
    """`missingBand` naming the first needed band the bundle lacks."""
    missing = next((band for band in needed if band not in kept), None)
    if missing is not None:
        raise StepFailedError(Errors.MISSING_BAND, f"the Landsat bundle has no {missing}", {"band": missing})


def _first_member(ctx: JobContext, delivery: str) -> str | None:
    try:
        with ctx.services.objects.open_read(delivery) as stream, tarfile.open(fileobj=stream, mode="r|*") as archive:
            first = next(iter(archive), None)
    except _CORRUPT:
        return None
    return None if first is None else first.name


def _held_member(ctx: JobContext, delivery: str | None) -> str | None:
    """The delivery's first member's name, when the delivery is still here."""
    if delivery is None or ctx.services.objects.stat(delivery) is None:
        return None
    return _first_member(ctx, delivery)


def delivery_level(ctx: JobContext) -> str:
    """The product's processing level (lesson 727): from the delivery's name (`LT05_L1GS_….tar`), else from its first member's;
    `L1TP` when neither says (the delivery gone or unreadable), so a scene is never moved on a guess."""
    delivery = ctx.job.step("fetch").gcs_path
    named = level_of(delivery)
    if named is not None:
        return named
    return level_of(_held_member(ctx, delivery)) or PRECISE


class LandsatBandsStep:
    name = "extract"

    def run(self, ctx: JobContext) -> StepResult:
        delivery = ctx.job.step("fetch").gcs_path
        if delivery is None:
            raise StepFailedError(Errors.ARCHIVE_CORRUPT, "the job has no fetched delivery")
        needed = needed_bands(UsgsImportParams.of(ctx.job.params).sensor)
        kept = _readable_bands(ctx, delivery, needed)
        _refuse_missing(needed, kept)
        return Done(kept[needed[0]])
