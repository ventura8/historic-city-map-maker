"""What several steps share: the city window, the cached references, the scan preview and GDAL error handling.

The references (docs/research/M3-interfaces.md §5.5) are cached in the private bucket by window: Sentinel-2 as
`reference/{city}/s2/{key}.tif` (the key: FNV-1a of the window and every candidate's item ids; the reference guard's
verdict, `agreement.py`, in its metadata) and OpenStreetMap as
`reference/{city}/osm/{key}.geojson`; `locate` scores the corner guess against the first, `reference` draws both
for the georeferencer and `georef` matches against the first.
"""

import json
import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import numpy

from hcm_pipeline import paths, scan_tiles
from hcm_pipeline.agreement import AGREED, REJECT_M, Agreement, Candidate, Patch, candidates, decide, read_patch, readings
from hcm_pipeline.contract import SCAN_DETAIL_MAX_PIXELS, SCAN_DETAIL_MAX_PX, SCAN_PREVIEW_MAX_PX, SCAN_TILE_PX, Errors
from hcm_pipeline.documents import ScanInfo, city_bounds
from hcm_pipeline.geo import Bounds, Grid, MercatorBox, fnv1a
from hcm_pipeline.images import UInt8Array, resize, write_jpeg
from hcm_pipeline.jobs import JobContext, StepFailedError
from hcm_pipeline.model import Record
from hcm_pipeline.objects import ObjectInfo, sha256_of
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import GTIFF_OPTIONS, RasterError, open_raster, read_band
from hcm_pipeline.stac import ReferenceUnavailableError, StacItem
from hcm_pipeline.urlguard import AddressRefusedError, check_data_url, check_emulated_url

REFERENCE_RESOLUTION_M: Final = 10.0
RGB_BANDS: Final = 3
# The reference guard's verdict, kept in the cached window's metadata so `locate` and `reference` measure it once.
CHECK_METADATA: Final = "HCM_S2_CHECK"
LOOPBACK_PREFIXES: Final = ("http://127.0.0.1", "http://localhost", "http://[::1]")


def city_window(ctx: JobContext) -> MercatorBox:
    """The city's bounds plus 10 % on every side, in EPSG:3857."""
    record = ctx.read(f"cities/{ctx.city}")
    if record is None:
        raise StepFailedError(Errors.NOT_FOUND, f"the city {ctx.city} does not exist")
    return city_bounds(record).mercator().expanded()


def gdal_step[T](ctx: JobContext, work: Callable[[], T], what: str, code: str = Errors.PROCESSING_FAILED) -> T:
    """`work` (GDAL calls); a GDAL failure becomes the run's stop when the run must stop, else the step fails with `code`.

    `processingFailed` by default: the step works on files the pipeline made (a USGS frame, the scan, the warped layer), so
    the admin is never told to upload again a file they never uploaded (CR-M3-47); reading the admin's own upload passes
    `unreadableRaster` ("check the file and upload it again").
    """
    try:
        return work()
    except (RuntimeError, RasterError) as error:
        ctx.checkpoint()
        raise StepFailedError(code, f"GDAL could not {what}: {error}") from error


def reference_failure(error: Exception) -> StepFailedError:
    return StepFailedError(Errors.REFERENCE_UNAVAILABLE, str(error))


@dataclass(frozen=True)
class Sentinel2:
    """The cached Sentinel-2 window: local file, object, and the items it was made from."""

    local: Path
    info: ObjectInfo
    items: tuple[StacItem, ...]
    check: Record | None = None

    def grid(self) -> Grid:
        dataset = gdal.Open(str(self.local))
        left, resolution, _, top, _, _ = dataset.GetGeoTransform()
        grid = Grid(left, top, resolution, dataset.RasterXSize, dataset.RasterYSize)
        dataset.Close()
        return grid


def _guarded(ctx: JobContext, href: str) -> str:
    """A STAC asset's address through the guard: public https, or (under the emulators) this machine's only."""
    if ctx.config.emulated:
        return check_emulated_url(href)
    return check_data_url(href, ctx.config.stac_url.startswith(LOOPBACK_PREFIXES), ctx.services.resolver)


def _guarded_sources(ctx: JobContext, items: Sequence[StacItem]) -> list[str]:
    try:
        return [f"/vsicurl/{_guarded(ctx, item.href)}" for item in items]
    except AddressRefusedError as error:
        raise reference_failure(error) from error


def _warp_window(ctx: JobContext, sources: list[str], window: MercatorBox, local: Path) -> None:
    def work() -> None:
        options = {"dstSRS": "EPSG:3857", "xRes": REFERENCE_RESOLUTION_M, "yRes": REFERENCE_RESOLUTION_M, "resampleAlg": "bilinear"}
        bounds = (window.left, window.bottom, window.right, window.top)
        gdal.Warp(
            str(local), sources, outputBounds=bounds, creationOptions=list(GTIFF_OPTIONS), callback=ctx.flags.gdal_progress, **options
        ).Close()

    try:
        work()
    except RuntimeError as error:
        ctx.checkpoint()
        raise reference_failure(error) from error


def _candidates(ctx: JobContext, window: MercatorBox) -> list[Candidate]:
    try:
        found = candidates(ctx.services.stac.search(window.bounds(), ctx.services.clock()), window.bounds())
    except ReferenceUnavailableError as error:
        raise reference_failure(error) from error
    if not found:
        raise reference_failure(ReferenceUnavailableError("no Sentinel-2 item under 20 % clouds covers the window"))
    return found


def _patch(ctx: JobContext, found: Candidate, bounds: Bounds) -> Patch | None:
    """One set over the guard's patch; None (and a warning) when its address is refused or GDAL cannot read it: the others still
    vote, and a set that cannot be read is never the reference while one that can agrees."""
    try:
        return read_patch(_guarded_sources(ctx, found), bounds, ctx.flags.gdal_progress)
    except (StepFailedError, RuntimeError) as error:
        ctx.checkpoint()
        ctx.log.warn(f"Sentinel-2 {found[0].id} could not be read for the reference check: {error}")
        return None


def _report(ctx: JobContext, sets: Sequence[Candidate], verdict: Agreement) -> None:
    """The verdict in the job's log: a warning whenever the least cloudy set was not taken, or nothing could outvote it."""
    first, chosen = sets[0][0].id, sets[verdict.chosen][0].id
    if verdict.status != AGREED:
        ctx.log.warn(f"the Sentinel-2 reference {first} is {verdict.status}: {len(sets)} clear dates, too few agree")
    elif verdict.chosen:
        offset = verdict.offsets[0]
        away = "unread" if offset is None else f"{offset.size:.1f} m"
        ctx.log.warn(f"Sentinel-2 {first} sits {away} off the other dates (bound {REJECT_M:.1f} m): {chosen} is the reference")
    else:
        ctx.log.info(f"Sentinel-2 {chosen} agrees with the other clear dates ({len(sets)} compared)")


def _agreement(ctx: JobContext, sets: Sequence[Candidate], window: MercatorBox) -> tuple[int, Record]:
    """The guard's chosen set and its verdict over the window as the version's `s2Check` (nothing read when one set is all there is)."""
    bounds = window.bounds()
    patches = [_patch(ctx, found, bounds) for found in sets] if len(sets) > 1 else []
    verdict = decide(len(sets), readings(patches))
    _report(ctx, sets, verdict)
    return verdict.chosen, verdict.as_record(sets)


def _stored_check(local: Path, count: int) -> tuple[int, Record] | None:
    """The chosen set and verdict a cached window carries in its metadata; None when it has none to trust."""
    dataset = gdal.Open(str(local))
    text = dataset.GetMetadataItem(CHECK_METADATA) or "null"
    dataset.Close()
    try:
        record = json.loads(text)
    except json.JSONDecodeError:
        return None
    return _chosen_of(record, count)


def _chosen_of(record: object, count: int) -> tuple[int, Record] | None:
    """`chosen` names one of the sets (an int, not a bool, which JSON's `true` would be), else nothing is trusted."""
    chosen = record.get("chosen") if isinstance(record, dict) else None
    return (chosen, record) if type(chosen) is int and isinstance(record, dict) and chosen in range(count) else None


def _store_check(local: Path, check: Record) -> None:
    dataset = gdal.Open(str(local), gdal.GA_Update)
    dataset.SetMetadataItem(CHECK_METADATA, json.dumps(check, separators=(",", ":")))
    dataset.Close()


def sentinel2(ctx: JobContext, window: MercatorBox) -> Sentinel2:
    """The window's Sentinel-2 L2A true colour at 10 m in EPSG:3857, of the set the guard chose: from the cache (keyed by every
    candidate, the verdict in its metadata), else from the STAC assets."""
    sets = _candidates(ctx, window)
    ids = ";".join(",".join(item.id for item in found) for found in sets)
    object_path = paths.reference(ctx.city, "s2", fnv1a(f"{window.key()}|{ids}"))
    local = ctx.local("reference-s2.tif")
    cached = ctx.services.objects.stat(object_path)
    if cached is not None:
        ctx.services.objects.download_file(object_path, local)
        stored = _stored_check(local, len(sets))
        if stored is not None:
            return Sentinel2(local, cached, sets[stored[0]], stored[1])
    chosen, check = _agreement(ctx, sets, window)
    _warp_window(ctx, _guarded_sources(ctx, sets[chosen]), window, local)
    _store_check(local, check)
    return Sentinel2(local, ctx.publish(local, object_path, "image/tiff"), sets[chosen], check)


def osm_features(ctx: JobContext, window: MercatorBox) -> tuple[dict[str, object], str]:
    """The window's OpenStreetMap lines (GeoJSON) and their cache path: from the cache, else from Overpass."""
    object_path = paths.reference(ctx.city, "osm", fnv1a(window.key()))
    local = ctx.local("reference-osm.geojson")
    if ctx.services.objects.stat(object_path) is not None:
        ctx.services.objects.download_file(object_path, local)
        return json.loads(local.read_text(encoding="utf-8")), object_path
    try:
        features = ctx.services.overpass.features(window.bounds())
    except ReferenceUnavailableError as error:
        raise reference_failure(error) from error
    local.write_text(json.dumps(features), encoding="utf-8")
    ctx.publish(local, object_path, "application/geo+json")
    return features, object_path


def grey_reference(source: Sentinel2) -> UInt8Array:
    """The Sentinel-2 window as one grey band (the mean of its three)."""
    total = sum(read_band(source.local, band).astype(numpy.float64) for band in (1, 2, 3))
    return numpy.asarray(numpy.asarray(total) / 3, numpy.uint8)


def detail_scale(width: int, height: int) -> float:
    """The sharper scan's pixels per scan pixel: its long side at most `SCAN_DETAIL_MAX_PX`, its area at most `SCAN_DETAIL_MAX_PIXELS`."""
    return min(1.0, SCAN_DETAIL_MAX_PX / max(width, height), math.sqrt(SCAN_DETAIL_MAX_PIXELS / (width * height)))


def _scaled(pixels: UInt8Array, scale: float) -> UInt8Array:
    """`pixels` shrunk by `scale` (its pixels per scan pixel)."""
    height, width = (int(side) for side in pixels.shape[:2])
    return resize(pixels, (max(1, round(width * scale)), max(1, round(height * scale))))


def _read_scaled(local: Path, scale: float) -> UInt8Array:
    """The scan in `local` (grey, or RGB of a colour scan) read by GDAL averaged down by `scale`: the scan itself is never held
    (reports/resource-audit.md: a 20,000 px colour upload read whole was 2.4 GB)."""
    dataset = open_raster(local)
    width, height = dataset.RasterXSize, dataset.RasterYSize
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    count = RGB_BANDS if dataset.RasterCount >= RGB_BANDS else 1
    bands = [
        numpy.asarray(dataset.GetRasterBand(band).ReadAsArray(0, 0, width, height, size[0], size[1], resample_alg=gdal.GRIORA_Average))
        for band in range(1, count + 1)
    ]
    dataset.Close()
    return numpy.asarray(bands[0] if count == 1 else numpy.dstack(bands), numpy.uint8)


def _size_of(local: Path) -> tuple[int, int]:
    dataset = open_raster(local)
    size = int(dataset.RasterXSize), int(dataset.RasterYSize)
    dataset.Close()
    return size


def _preview_scale(width: int, height: int) -> float:
    return min(1.0, SCAN_PREVIEW_MAX_PX / max(width, height))


def scan_preview(local: Path) -> tuple[UInt8Array, tuple[int, int]]:
    """The preview of the scan in `local`, read shrunk out of the file, and the scan's size."""
    width, height = _size_of(local)
    return _read_scaled(local, _preview_scale(width, height)), (width, height)


def _publish_tiles(ctx: JobContext, detail: UInt8Array) -> str:
    """The sharper scan as `scan-tiles.bin`: JPEG tiles of `SCAN_TILE_PX` in one object (`scan_tiles`); its path."""
    encoded = [write_jpeg(ctx.local("scan-tile.jpg"), tile).read_bytes() for tile in scan_tiles.cut(detail, SCAN_TILE_PX)]
    local = ctx.local("scan-tiles.bin")
    local.write_bytes(scan_tiles.pack(encoded, (int(detail.shape[1]), int(detail.shape[0])), SCAN_TILE_PX))
    return ctx.publish(local, ctx.version_file("scan-tiles.bin"), "application/octet-stream").path


def publish_scan(ctx: JobContext, local: Path, pixels: UInt8Array | None = None) -> ScanInfo:
    """`scan.tif`, its preview (long side at most `SCAN_PREVIEW_MAX_PX`) and, for a longer scan, its sharper `scan-tiles.bin`.

    The detail (long side at most `SCAN_DETAIL_MAX_PX`, area at most `SCAN_DETAIL_MAX_PIXELS`) is what the georeferencer draws once
    the owner zooms past the preview's own pixels (a 1966 Corona frame was a blur at high zoom, 2026-11-12). It is written as tiles
    of `SCAN_TILE_PX`, so the browser decodes only the ones the pane shows; a scan no longer than its preview needs none. Both are
    shrunk from `pixels` when the caller holds the scan anyway, else read shrunk out of the file.
    """
    width, height = _size_of(local) if pixels is None else (int(pixels.shape[1]), int(pixels.shape[0]))

    def shrunk(scale: float) -> UInt8Array:
        return _read_scaled(local, scale) if pixels is None else _scaled(pixels, scale)

    scale = _preview_scale(width, height)
    preview = write_jpeg(ctx.local("scan-preview.jpg"), shrunk(scale))
    ctx.publish(preview, ctx.version_file("scan-preview.jpg"), "image/jpeg")
    detail = None if scale >= 1.0 else detail_scale(width, height)
    detail_path = None if detail is None else _publish_tiles(ctx, shrunk(detail))
    sha256 = sha256_of(local)
    scan = ctx.publish(local, ctx.version_file("scan.tif"), "image/tiff")
    return ScanInfo(scan.path, width, height, sha256, ctx.version_file("scan-preview.jpg"), scale, detail_path, detail)
