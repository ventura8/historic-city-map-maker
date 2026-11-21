"""A frame joined to the city's frames already accepted, which stay where they are (M15-calibration-accuracy.md, *Joint solve*).

`export` keeps every proved frame's `align.tif` beside its layer (`publish_align`). `georef` of a new proved frame finds the city's
frames an admin accepted (`approved`, `publishing` or `published`) that a proof placed on their own Sentinel-2 tiles, that overlap it
and that kept that file (`held_frames`); renders its own first map the same way; measures film ties against each
(`calibrate/ties.py`), one partner's image at a time; and fits again with them held still (`calibrate/joining.py`). A partner's layer is
never rendered again here: that is the admin's choice. A partner that cannot be looked up, staged, read or measured (a refusal of the
server, a store failure or a network that fails, a file GDAL cannot read) is left out with one job-log line naming it, and the frame is
fitted with the others or alone; a lost lease or a disconnected computer still stops the run. Nothing here runs for a frame placed only
by the admin's points, and such a frame is never a partner: every frame keeps its own tiles, so no position travels along a chain of
frames.
"""

import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Final

import numpy

from hcm_pipeline import paths
from hcm_pipeline.calibrate.joining import Proved, joined_calibration
from hcm_pipeline.calibrate.joint import USED, PartnerTies, Verdict
from hcm_pipeline.calibrate.pairs import Calibrated
from hcm_pipeline.calibrate.ties import ALIGN_GROUND_M, AlignImage, align_cell, matched, tied
from hcm_pipeline.contract import ALIGNMENT_MAX_PARTNERS
from hcm_pipeline.documents import GeorefInfo, ScanInfo, Version
from hcm_pipeline.geo import Bounds, FloatArray, MercatorBox
from hcm_pipeline.jobs import JobContext
from hcm_pipeline.model import Record
from hcm_pipeline.paths import PathError
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import GTIFF_OPTIONS, driver_of
from hcm_pipeline.steps.common import city_window, gdal_step
from hcm_pipeline.steps.warp import Attached, attached
from hcm_pipeline.store import DocumentStoreError, SkipsInvalid
from hcm_pipeline.worker.api import WorkerApiError

ALIGN_FILE: Final = "align.tif"
HELD_STATES: Final = frozenset({"approved", "publishing", "published"})
PROVED_HOWS: Final = frozenset({"votes", "pass", "points", "matcher", "local-ai"})
MAX_PARTNERS: Final = ALIGNMENT_MAX_PARTNERS
FULL: Final = 255
# What one partner's look-up, download, read or measure may raise (`WorkerApiError`, `ObjectStoreError`, `DocumentStoreError`, GDAL's and
# `RasterError` are `RuntimeError`s; `PathError` an id off the path pattern): that partner alone is left out. Both object stores raise
# httpx's errors as `ObjectStoreError` and Firestore's as `DocumentStoreError` (the review of a6750294). `RunStoppedError` is none.
PARTNER_FAILURES: Final = (RuntimeError, PathError)


@dataclass(frozen=True)
class Held:
    """A frame held still: its version, its year and its `align.tif`."""

    version_id: str
    year: int | None
    path: str


def _overlaps(a: Bounds, b: Bounds) -> bool:
    return a.west < b.east and b.west < a.east and a.south < b.north and b.south < a.north


def _field(record: Record, name: str, key: str) -> object:
    value = record.get(name)
    return value.get(key) if isinstance(value, dict) else None


def _bounds_of(record: Record) -> Bounds | None:
    try:
        return Bounds.of(_field(record, "output", "bounds"))
    except ValueError:
        return None


def proved(record: Record) -> bool:
    """A frame an automatic fit placed on the tiles a proof gave: its own Sentinel-2, never another frame's word alone."""
    return _field(record, "calibration", "how") in PROVED_HOWS and _field(record, "georef", "method") == "auto"


def _accepted(ctx: JobContext, version_id: str, record: Record) -> bool:
    """Another version of the city the admin accepted, placed by its own proof."""
    return version_id != ctx.version.id and record.get("state") in HELD_STATES and proved(record)


def _over(record: Record, bounds: Bounds) -> str | None:
    """The version's layer when its output overlaps `bounds`, else None."""
    found, layer = _bounds_of(record), record.get("layerId")
    return layer if isinstance(layer, str) and found is not None and _overlaps(found, bounds) else None


def _left_out(ctx: JobContext, version_id: str, what: str) -> None:
    """One partner that failed: the run stops when it must, else one line names the frame (never the error: it may carry a URL)."""
    ctx.checkpoint()
    ctx.log.warn(f"the accepted frame {version_id} could not be {what}: fitted without it", "georef")


def _stat(ctx: JobContext, version_id: str, layer: str) -> str | None:
    """The partner's `align.tif` when it is there; None when it is not, or cannot be looked up (left out by name)."""
    try:
        path = paths.version(ctx.city, layer, version_id, ALIGN_FILE)
        return path if ctx.services.objects.stat(path) else None
    except PARTNER_FAILURES:
        _left_out(ctx, version_id, "found")
        return None


def _kept(ctx: JobContext, version_id: str, record: Record, layer: str) -> Held | None:
    """The frame held still, when it kept its `align.tif`."""
    path = _stat(ctx, version_id, layer)
    year = record.get("year")
    return None if path is None else Held(version_id, year if isinstance(year, int) else None, path)


def _held(ctx: JobContext, version_id: str, record: Record | None, bounds: Bounds) -> Held | None:
    if record is None:
        return None
    layer = _over(record, bounds) if _accepted(ctx, version_id, record) else None
    return None if layer is None else _kept(ctx, version_id, record, layer)


def _listed(ctx: JobContext, collection: str) -> list[str]:
    """The city's version ids; none when the server lists none to this run (a local worker on a server without the joint solve) or
    Firestore cannot answer (Cloud Run)."""
    try:
        return ctx.services.store.list_ids(collection)
    except (WorkerApiError, DocumentStoreError) as error:
        ctx.log.warn(f"the other frames could not be read ({error}): the frame is fitted alone", "georef")
        return []


def _read_or_none(ctx: JobContext, path: str, unread: list[str], version_id: str) -> tuple[str, Record | None] | None:
    try:
        return version_id, ctx.read(path)
    except PARTNER_FAILURES:
        ctx.checkpoint()
        unread.append(version_id)
        return None


def _skipped(ctx: JobContext, collection: str) -> None:
    """The city's versions the server left out of its list because they fail their schema: counted in the job log, never named."""
    store = ctx.services.store
    count = store.skipped(collection) if isinstance(store, SkipsInvalid) else 0
    if count:
        ctx.log.warn(f"{count} of the city's frames could not be read and were left out", "georef")


def _readable(ctx: JobContext, collection: str) -> list[tuple[str, Record | None]]:
    """Each listed version with its record; one the server cannot read (it failed its schema there: 2026-11-08) is no partner."""
    unread: list[str] = []
    listed = _listed(ctx, collection)
    _skipped(ctx, collection)
    found = [_read_or_none(ctx, f"{collection}/{version_id}", unread, version_id) for version_id in listed]
    if unread:
        ctx.log.warn(f"{len(unread)} other frames could not be read ({', '.join(unread)}): fitted without them", "georef")
    return [pair for pair in found if pair is not None]


def held_frames(ctx: JobContext, bounds: Bounds) -> list[Held]:
    """The city's accepted, proved frames over `bounds` that kept their `align.tif`, newest first, at most `MAX_PARTNERS`."""
    found = [_held(ctx, version_id, record, bounds) for version_id, record in _readable(ctx, f"cities/{ctx.city}/layerVersions")]
    return sorted((frame for frame in found if frame is not None), key=lambda frame: -(frame.year or 0))[:MAX_PARTNERS]


def window_box(window: MercatorBox, cell: float) -> MercatorBox:
    """The window grown to whole cells of the align grid, so every frame's image of a city shares its cells."""
    left, bottom = math.floor(window.left / cell) * cell, math.floor(window.bottom / cell) * cell
    return MercatorBox(left, bottom, math.ceil(window.right / cell) * cell, math.ceil(window.top / cell) * cell)


def _grey(dataset: gdal.Dataset) -> numpy.ndarray:
    """A warped grey band and its alpha as one band: 1 to 255 where there is data, 0 elsewhere."""
    bands = numpy.asarray(dataset.ReadAsArray(), numpy.float32).reshape(dataset.RasterCount, dataset.RasterYSize, dataset.RasterXSize)
    grey = numpy.clip(bands[:-1].mean(axis=0), 1, FULL)
    return numpy.asarray(numpy.where(bands[-1] >= FULL / 2, grey, 0), numpy.uint8)


def rendered(source: Path, window: MercatorBox, middle_lat: float, method: Mapping[str, object]) -> AlignImage:
    """A georeferenced raster at `ALIGN_GROUND_M` over the window: a scan through its map (`method`: `attached`'s), or a warped layer as
    it is (none)."""
    cell = align_cell(middle_lat)
    box = window_box(window, cell)
    options = {"dstSRS": "EPSG:3857", "xRes": cell, "yRes": cell, "resampleAlg": "average", "dstAlpha": True, **method}
    dataset = gdal.Warp("", str(source), format="MEM", outputBounds=(box.left, box.bottom, box.right, box.top), **options)
    image = AlignImage(_grey(dataset), box.left, box.top, cell)
    dataset.Close()
    return image


def keeps_align(version: Version) -> bool:
    """A frame later frames may be joined to: placed by an automatic fit on its own proof's tiles."""
    method = None if version.georef is None else version.georef.method
    return proved({"calibration": dict(version.calibration), "georef": {"method": method}})


def write_align(image: AlignImage, target: Path) -> Path:
    """`align.tif`: the image, deflated, 0 the no-data value."""
    height, width = image.grey.shape
    dataset = driver_of("GTiff").Create(str(target), width, height, 1, gdal.GDT_Byte, list(GTIFF_OPTIONS))
    dataset.SetGeoTransform((image.left, image.cell, 0.0, image.top, 0.0, -image.cell))
    dataset.SetProjection("EPSG:3857")
    band = dataset.GetRasterBand(1)
    band.WriteArray(image.grey)
    band.SetNoDataValue(0)
    dataset.Close()
    return target


def publish_align(ctx: JobContext, warped: Path) -> None:
    """`export`: a proved frame's `align.tif`, from its warped layer."""
    if not keeps_align(ctx.version):
        return
    window = city_window(ctx)
    image = gdal_step(ctx, lambda: rendered(warped, window, window.bounds().middle_lat, {}), "render the frame for later ties")
    target = gdal_step(ctx, lambda: write_align(image, ctx.local(ALIGN_FILE)), "write the frame for later ties")
    ctx.publish(target, ctx.version_file(ALIGN_FILE), "image/tiff")


def read_onto(path: Path, like: AlignImage) -> AlignImage:
    """A partner's `align.tif` on our image's grid."""
    height, width = like.grey.shape
    bounds = (like.left, like.top - height * like.cell, like.left + width * like.cell, like.top)
    dataset = gdal.Warp("", str(path), format="MEM", outputBounds=bounds, width=width, height=height, resampleAlg="near", dstNodata=0)
    grey = numpy.asarray(dataset.GetRasterBand(1).ReadAsArray(), numpy.uint8)
    dataset.Close()
    return AlignImage(grey, like.left, like.top, like.cell)


def to_film(mine: Attached, offset: tuple[int, int]) -> Callable[[FloatArray], FloatArray]:
    """Film pixels of EPSG:3857 places through the scan's own map (`attached`): what its rendered image shows there."""

    def film(places: FloatArray) -> FloatArray:
        dataset = gdal.Open(str(mine.source))
        transformer = gdal.Transformer(dataset, None, [*mine.options, "DST_SRS=EPSG:3857"])
        found, _ = transformer.TransformPoints(1, [(float(x), float(y)) for x, y in places])
        dataset.Close()
        return numpy.array(found, numpy.float64)[:, :2] + numpy.array(offset, numpy.float64)

    return film


@dataclass(frozen=True)
class Ours:
    """The joining frame: its scan with its first fit's map attached, its offset in the film, its image on the align grid."""

    attached: Attached
    offset: tuple[int, int]
    image: AlignImage


def ours(ctx: JobContext, georef: GeorefInfo, scan: ScanInfo, offset: tuple[int, int], window: MercatorBox) -> Ours:
    """The frame's first fit rendered as its layer would be, at `ALIGN_GROUND_M`: over terrain through its RPC, as the warp."""
    found = attached(ctx.stage(scan.path, "scan.tif"), georef, lambda name: ctx.local(f"align-{name}"))
    return Ours(found, offset, rendered(found.source, window, window.bounds().middle_lat, found.method))


def partner_ties(ctx: JobContext, mine: Ours, held: Held) -> PartnerTies:
    """The ties with one held frame; its file is staged only while it is matched."""
    theirs = read_onto(ctx.stage(held.path, f"align-{held.version_id}.tif"), mine.image)
    ctx.unstage(held.path)
    found = matched(mine.image, theirs, ALIGN_GROUND_M)
    return tied(held.version_id, found, mine.image, to_film(mine.attached, mine.offset), ALIGN_GROUND_M)


def _ties_or_none(ctx: JobContext, mine: Ours, held: Held) -> PartnerTies | None:
    try:
        return partner_ties(ctx, mine, held)
    except PARTNER_FAILURES:
        ctx.unstage(held.path)
        _left_out(ctx, held.version_id, "measured")
        return None


def held_ties(ctx: JobContext, mine: Ours, held: Sequence[Held]) -> list[PartnerTies]:
    """The ties with each held frame; one whose file cannot be staged, read or measured is left out by name (`_left_out`)."""
    found = [_ties_or_none(ctx, mine, frame) for frame in held]
    return [ties for ties in found if ties is not None]


def bounds_of(georef: GeorefInfo) -> Bounds:
    """The box of the first fit's pairs and checks: where the frame was measured."""
    lng = [gcp.lng for gcp in georef.gcps]
    lat = [gcp.lat for gcp in georef.gcps]
    return Bounds(min(lng), min(lat), max(lng), max(lat))


def _partner_record(verdict: Verdict, years: Mapping[str, int | None]) -> Record:
    year = years.get(verdict.partner)
    return {**verdict.as_record(), **({} if year is None else {"year": year})}


def alignment_record(verdicts: Sequence[Verdict], held: Sequence[Held]) -> Record:
    """`calibration.alignment`: each partner's verdict with its year."""
    years = {frame.version_id: frame.year for frame in held}
    return {"partners": [_partner_record(verdict, years) for verdict in verdicts]}


@dataclass(frozen=True)
class Joining:
    """A frame about to be joined: its tiles, its scan, its first fit's georeference and the job's seed."""

    proved: Proved
    scan: ScanInfo
    georef: GeorefInfo
    seed: int


def _ties(ctx: JobContext, joining: Joining, held: Sequence[Held]) -> list[PartnerTies]:
    offset = (joining.proved.scan.left, joining.proved.scan.top)
    mine = gdal_step(ctx, lambda: ours(ctx, joining.georef, joining.scan, offset, city_window(ctx)), "render the frame for its ties")
    return held_ties(ctx, mine, held)


def joined_to_held(ctx: JobContext, joining: Joining, found: Calibrated) -> Calibrated:
    """The frame fitted again with the city's accepted frames that overlap it held still; as it was with none."""
    held = held_frames(ctx, bounds_of(joining.georef))
    again = joined_calibration(joining.proved, joining.seed, _ties(ctx, joining, held)) if held else None
    if again is None or not again.alignment:
        return found
    ctx.log.info(joined_summary(again.alignment), "georef")
    return replace(again, alignment_record=alignment_record(again.alignment, held))


def _named(verdicts: Sequence[Verdict]) -> str:
    left = ", ".join(f"{verdict.partner} ({verdict.status})" for verdict in verdicts if verdict.status != USED)
    return f"; left out: {left}" if left else ""


def joined_summary(verdicts: Sequence[Verdict]) -> str:
    """The job log's line: how many frames were held still, how many ties, and who was left out and why."""
    used = [verdict for verdict in verdicts if verdict.status == USED]
    return f"joined to {len(used)} accepted frames held still, {sum(verdict.ties for verdict in used)} film ties{_named(verdicts)}"
