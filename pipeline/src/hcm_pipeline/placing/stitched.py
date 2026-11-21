"""The stitched picture a waiting series leaves (docs/research/M22-help-calibrate.md §4.1): the admin works on one picture, never on
thousands of sheets.

Whatever a grid, an atlas or a pieces series could not prove on its own, its sheets were already joined into one canvas (the grid's
mosaic from its names and frames, the atlas's pages by their edges or their overlaps, the pieces by their overlaps). That canvas is
kept beside the job's files (`stitched.tif`: it stays where the job runs, as `warped.tif` does) and a preview of it (`stitched.jpg`, its
long side at most `PREVIEW_PX`, the georeferencer's own preview size) goes up with the version, which the Help calibrate wizard lays
over the map. The georeferencer gets it too, as it gets a frame's: the picture as the version's `scan` (`scan.tif`, at most
`SCAN_MAX_PX` long, and `scan-preview.jpg`) and the city window's OpenStreetMap lines as its `reference` (`reference-osm.png`), so an
archive series waiting for points opens there like any frame (never Mapbox Satellite). The version's `help.stitched` says what it
holds: its size, how many parts joined, which were left out and why, and the joins' quality (the matched overlaps' inliers and
their residual, in canvas pixels), and for an automatic layout its summary (`layout`, M20 §19).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from hcm_pipeline.archive import model
from hcm_pipeline.documents import ReferenceInfo
from hcm_pipeline.geo import Grid
from hcm_pipeline.images import resize, write_jpeg, write_png
from hcm_pipeline.jobs import JobContext, Waiting
from hcm_pipeline.osm import draw
from hcm_pipeline.placing import assemble
from hcm_pipeline.placing.output import wait_for_help
from hcm_pipeline.placing.reference import city_window, osm_features_cached, window_resolution
from hcm_pipeline.placing.streets import UInt8Array
from hcm_pipeline.steps.common import publish_scan
from hcm_pipeline.steps.reference import osm_overlay

STITCHED: Final = "stitched.tif"
PREVIEW: Final = "stitched.jpg"
PREVIEW_PX: Final = 4096
PREVIEW_QUALITY: Final = 85
# The georeferencer's scan of a stitched picture: at most this long (its pairs are in these pixels).
SCAN_MAX_PX: Final = 8192
REFERENCE_PX: Final = 4096
LEFT_OUT_MAX: Final = model.STITCHED_LEFT_OUT_MAX
NAME_MAX: Final = 200
# Why a part is not in the stitched picture: no frame was found on it (a grid's sheet), or it shares no edge or overlap.
NO_FRAME: Final = model.LEFT_OUT_REASONS[0]
NO_JOIN: Final = model.LEFT_OUT_REASONS[1]


@dataclass(frozen=True)
class JoinQuality:
    """The joins found by matching: how many, their agreeing matches on average, and the inliers' residual (canvas pixels)."""

    links: int
    mean_inliers: float
    rms_px: float

    def as_record(self) -> dict[str, object]:
        return {"links": self.links, "meanInliers": round(self.mean_inliers, 1), "rmsPx": round(self.rms_px, 2)}


@dataclass(frozen=True)
class Stitched:
    """A series' parts joined on one canvas: how (`model.STITCH_METHODS`), how many parts and which were left out."""

    canvas: UInt8Array
    method: str
    parts: int
    left_out: tuple[tuple[str, str], ...] = ()
    metres_per_px: float | None = None
    joins: JoinQuality | None = None
    # Canvas pixels per pixel of the version's suggested pairs: 1 when the pairs were found on this canvas (an assembled series), less
    # when they are in a larger original's pixels (a single map's working copy is the canvas).
    pairs_scale: float = 1.0
    # M20 §19: the automatic layout's summary (`help.stitched.layout`), when the picture is its proposal.
    layout: Mapping[str, object] | None = None

    @property
    def joined(self) -> int:
        return max(0, self.parts - len(self.left_out))


def _preview(canvas: UInt8Array, longest: int = PREVIEW_PX) -> tuple[UInt8Array, float]:
    height, width = canvas.shape[:2]
    scale = min(1.0, longest / max(width, height))
    if scale >= 1.0:
        return canvas, 1.0
    return resize(canvas, (max(1, round(width * scale)), max(1, round(height * scale)))), scale


def _left_out(found: Sequence[tuple[str, str]]) -> list[dict[str, str]]:
    return [{"name": name[:NAME_MAX], "reason": reason} for name, reason in found[:LEFT_OUT_MAX]]


def _known(stitched: Stitched) -> None:
    """ValueError for a method or a left-out reason the server's schema does not list (`model`, the shared contract)."""
    if stitched.method not in model.STITCH_METHODS:
        raise ValueError(f"unknown stitch method {stitched.method!r}")
    unknown = {reason for _name, reason in stitched.left_out} - set(model.LEFT_OUT_REASONS)
    if unknown:
        raise ValueError(f"unknown left-out reasons {sorted(unknown)}")


def _measures(stitched: Stitched) -> dict[str, object]:
    """What only some pictures have: the ground scale (a grid's mosaic) and the joins' quality."""
    scale = {} if stitched.metres_per_px is None else {"metresPerPx": round(stitched.metres_per_px, 4)}
    joins = {} if stitched.joins is None else {"joins": stitched.joins.as_record()}
    layout = {} if stitched.layout is None else {"layout": dict(stitched.layout)}
    return {**scale, **joins, **layout}


def _linked(written: Path, target: Path) -> Path:
    """A canvas already written (an assembled series': `maps._assembled`) kept as the stitched picture by a second name, not encoded
    a second time (reports/resource-audit.md: a 600 MB write, twice)."""
    target.unlink(missing_ok=True)
    target.hardlink_to(written)
    return target


def publish_stitched(ctx: JobContext, stitched: Stitched, written: Path | None = None) -> dict[str, object]:
    """The canvas kept with the job's files, its preview with the version's; the record `help.stitched` keeps.

    A method the server's schema does not know is refused here, before any file is published: the worker's write would be refused
    after minutes of work (`overview`, harti.zip 1895, lesson 569).
    """
    _known(stitched)
    canvas = _linked(written, ctx.local(STITCHED)) if written is not None else assemble.write_canvas(ctx.local(STITCHED), stitched.canvas)
    ctx.publish(canvas, ctx.work_file(STITCHED), "image/tiff")
    small, scale = _preview(stitched.canvas)
    preview = ctx.publish(write_jpeg(ctx.local(PREVIEW), small, PREVIEW_QUALITY), ctx.version_file(PREVIEW), "image/jpeg")
    height, width = stitched.canvas.shape[:2]
    record: dict[str, object] = {
        "previewPath": preview.path,
        "previewScale": round(scale, 6),
        "width": width,
        "height": height,
        "method": stitched.method,
        "parts": stitched.parts,
        "joined": stitched.joined,
        "leftOut": _left_out(stitched.left_out),
        "leftOutCount": len(stitched.left_out),
    }
    record.update(_measures(stitched))
    ctx.log.info(f"stitched {stitched.joined} of {stitched.parts} parts into one {width} x {height} picture for a person", ctx.step)
    _for_georeferencer(ctx, stitched.canvas, stitched.pairs_scale)
    return record


def _moved(pair: object, factor: float, size: tuple[int, int]) -> dict[str, object] | None:
    """One suggested pair with its pixel in the scan's pixels; None when it is no pair or falls outside the scan."""
    record = _mapping(pair)
    pixel = _mapping(record.get("pixel"))
    if not pixel:
        return None
    x, y = float(str(pixel["x"])) * factor, float(str(pixel["y"])) * factor
    return {**record, "pixel": {"x": round(x, 2), "y": round(y, 2)}} if _inside(x, y, size) else None


def _mapping(value: object) -> Mapping[str, object]:
    return value if isinstance(value, Mapping) else {}


def _inside(x: float, y: float, size: tuple[int, int]) -> bool:
    return 0 <= x < size[0] and 0 <= y < size[1]


def in_scan(suggested: Mapping[str, object], factor: float, size: tuple[int, int]) -> dict[str, object]:
    """The version's suggestions with each pair's pixel in the scan's pixels (`factor` scan pixels per suggested pixel, `size` the
    scan's width and height); a pair that falls outside the scan is dropped (1895, 2026-11-12: 26 pairs past the 8192-px scan's edge
    put it 10 to 27 km away)."""
    kept = _kept(suggested.get("pairs"), factor, size)
    tiles = _mapping(suggested.get("tiles"))
    matched = {"tiles": {**tiles, "matched": len(kept)}} if tiles else {}
    return {**suggested, **matched, "pairs": kept}


def _kept(found: object, factor: float, size: tuple[int, int]) -> list[dict[str, object]]:
    moved = [_moved(pair, factor, size) for pair in (found if isinstance(found, list) else [])]
    return [pair for pair in moved if pair is not None]


def _suggested(ctx: JobContext) -> Mapping[str, object] | None:
    found = (ctx.services.store.get(ctx.version_path()) or {}).get("suggestions")
    return found if isinstance(found, Mapping) else None


def _for_georeferencer(ctx: JobContext, canvas: UInt8Array, pairs_scale: float = 1.0) -> None:
    """The picture as the version's `scan` and the city window's OpenStreetMap lines as its `reference`: what the georeferencer shows.
    The version's suggested pairs move into the scan's pixels with it (the scan is the canvas shrunk to `SCAN_MAX_PX`)."""
    pixels, scale = _preview(canvas, SCAN_MAX_PX)
    local = assemble.write_canvas(ctx.local("scan.tif"), pixels)
    fields: dict[str, object] = {"scan": publish_scan(ctx, local, pixels).as_record()}
    suggested = _suggested(ctx)
    if suggested is not None:
        fields["suggestions"] = in_scan(suggested, pairs_scale * scale, (pixels.shape[1], pixels.shape[0]))
    window = city_window(ctx)
    features = None if window is None else osm_features_cached(ctx, window)
    if window is not None and features is not None:
        grid = Grid.over(window, window_resolution(window, REFERENCE_PX))
        image = write_png(ctx.local("reference-osm.png"), osm_overlay(draw(features, grid)))
        path = ctx.publish(image, ctx.version_file("reference-osm.png"), "image/png").path
        fields["reference"] = ReferenceInfo(window.bounds(), path).as_record()
    ctx.update_version(fields)


def wait_stitched(ctx: JobContext, stitched: Stitched, reason: str, note: str) -> Waiting:
    """The version waits for a person with its stitched picture to place."""
    return wait_for_help(ctx, reason, note, stitched=publish_stitched(ctx, stitched))
