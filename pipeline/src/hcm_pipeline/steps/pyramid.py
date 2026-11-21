"""`pyramid`: the version's own tiles and its small picture (docs/research/M12-own-tiles.md).

256 px WebP at quality 75 with alpha, from the output's minimum to its maximum zoom, packed into one PMTiles archive, uploaded
privately as `rasters/C/L/V/tiles.pmtiles` beside `thumb.webp`, and recorded as `output.tiles`. The approval view reads the archive
before anyone approves; `imagery.publish` copies it to the public bucket after. No Mapbox is involved. An import or a join makes it
from its `warped.tif`; a `layer-tiles` job, for a version rendered before this step existed, from the `cog.tif` that version has
(measured on a real frame: 85 s against 87 s, 174.8 MB against 175.7 MB). Either way the film's dark rim is cut from the alpha first
(`tiles/rim.py`), so a frame's edge shows the basemap rather than an opaque black band.
"""

import os
import shutil
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from hcm_pipeline.contract import SIDE_JOB_TYPES, Errors
from hcm_pipeline.geo import Bounds
from hcm_pipeline.jobs import Done, JobContext, StepFailedError, StepResult
from hcm_pipeline.model import DocumentError, bounds_of, number_of
from hcm_pipeline.objects import sha256_of
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import machine_memory_mb
from hcm_pipeline.steps.common import gdal_step
from hcm_pipeline.tiles.encoding import ENCODINGS, TileEncoding, encoding_of, paper_opaque, paper_transparent
from hcm_pipeline.tiles.pack import ArchiveInfo, Packed, PackError, pack
from hcm_pipeline.tiles.rim import add_trimmed_alpha, find_rim, trimmed_alpha

TILE_SIZE_PX: Final = 256
ARCHIVE_JOB: Final = "archive-series"
THUMB_WIDTH_PX: Final = 320
THUMB_QUALITY: Final = 70
ARCHIVE_TYPE: Final = "application/vnd.pmtiles"
THUMB_TYPE: Final = "image/webp"
RGB_BANDS: Final = 3
RGBA_INTERPRETATION: Final = "red,green,blue,alpha"
RGB_INTERPRETATION: Final = "red,green,blue"
THREADS_OPTION: Final = "GDAL_NUM_THREADS"
# `gdal raster tile` starts a process a thread, each holding about 170 MB (reports/resource-audit.md: 16 of them, 2.7 GB): they
# are as many as `GDAL_NUM_THREADS` says, at most the cores but one, and at most what a quarter of the memory holds at this much each.
TILE_PROCESS_MB: Final = 256
TILE_MEMORY_SHARE: Final = 1 / 4


@dataclass(frozen=True)
class Rendered:
    """What the step reads of `output`: the zooms and the bounds, and the COG when the version has one."""

    minzoom: int
    maxzoom: int
    bounds: Bounds
    cog_path: str | None

    @classmethod
    def of(cls, record: Mapping[str, object] | None) -> Rendered:
        output = (record or {}).get("output")
        if not isinstance(output, dict):
            raise StepFailedError(Errors.PROCESSING_FAILED, "the version has no exported output")
        cog = output.get("cogPath")
        return cls(*_zooms_and_bounds(output), cog if isinstance(cog, str) else None)


def _zooms_and_bounds(output: Mapping[str, object]) -> tuple[int, int, Bounds]:
    try:
        return int(number_of(output, "minzoom")), int(number_of(output, "maxzoom")), bounds_of(output.get("bounds"))
    except DocumentError as error:
        raise StepFailedError(Errors.PROCESSING_FAILED, f"the version's output is unreadable: {error}") from error


def _alpha_of(dataset: gdal.Dataset) -> str:
    """The band that says what shows: the warped raster's alpha band, or the COG's mask (JPEG holds no alpha)."""
    last = dataset.RasterCount
    return str(last) if dataset.GetRasterBand(last).GetColorInterpretation() == gdal.GCI_AlphaBand else "mask"


def _colour_bands(dataset: gdal.Dataset) -> list[str]:
    """The three colour bands of a grey or a colour layer."""
    colours = dataset.RasterCount - (_alpha_of(dataset) != "mask")
    return [str(band) for band in (range(1, RGB_BANDS + 1) if colours >= RGB_BANDS else [1] * RGB_BANDS)]


def _band_options(dataset: gdal.Dataset, alpha: str | None) -> list[str]:
    """RGB, then `alpha` when the view takes the source's own."""
    if alpha is None:
        bands, interpretation = _colour_bands(dataset), RGB_INTERPRETATION
    else:
        bands, interpretation = [*_colour_bands(dataset), alpha], RGBA_INTERPRETATION
    return [*(option for band in bands for option in ("-b", band)), "-colorinterp", interpretation]


def rgba_view(source: Path, target: Path, film: bool = True) -> Path:
    """A VRT of `source` as RGBA, which the tiler and the picture read; its alpha without the film's dark rim, if it has one (M20: a
    scanned map is no film, and its ink at the edge is no rim: `film` False keeps its alpha)."""
    dataset = gdal.Open(str(source))
    alpha = _alpha_of(dataset)
    rim = find_rim(dataset, alpha, target.with_name(f"{target.stem}-rim.tif")) if film else None
    gdal.Translate(str(target), dataset, options=["-of", "VRT", *_band_options(dataset, None if rim else alpha)]).Close()
    dataset.Close()
    if rim is not None:
        add_trimmed_alpha(target, trimmed_alpha(source, alpha, rim, target.with_name(f"{target.stem}-alpha.tif")))
    return target


def tile_processes(configured: str | None, cores: int | None, memory_mb: int | None) -> int:
    """How many processes cut the tiles: `configured` (`GDAL_NUM_THREADS`, a number; anything else: all there may be), the cores but
    one, and the memory's share, whichever is least; at least one."""
    spare = max(1, (cores or 1) - 1)
    wanted = int(configured) if configured is not None and configured.isdigit() else spare
    held = spare if memory_mb is None else int(memory_mb * TILE_MEMORY_SHARE) // TILE_PROCESS_MB
    return max(1, min(wanted, spare, held))


def write_tree(view: Path, tree: Path, rendered: Rendered, ctx: JobContext, encoding: TileEncoding = ENCODINGS["grey"]) -> Path:
    """The tile pyramid: blank tiles skipped; line art uses nearest at every zoom (M20; overviews too — averaged RGBA washed ink)."""
    arguments: dict[str, object] = {
        "input": str(view),
        "output": str(tree),
        "output-format": "WEBP",
        "creation-option": list(encoding.options),
        "min-zoom": rendered.minzoom,
        "max-zoom": rendered.maxzoom,
        "tile-size": TILE_SIZE_PX,
        "skip-blank": True,
        "resampling": encoding.resampling,
        "overview-resampling": encoding.overview_resampling,
        "webviewer": "none",
        "num-threads": tile_processes(gdal.GetConfigOption(THREADS_OPTION), os.cpu_count(), machine_memory_mb()),
    }
    gdal.Run(["raster", "tile"], arguments=arguments, progress=ctx.flags.gdal_progress)
    return tree


def write_thumb(view: Path, target: Path) -> Path:
    """The 320 px picture, averaged from the view's closest overview rather than its full size, when it has overviews."""
    options = [f"QUALITY={THUMB_QUALITY}"]
    gdal.Translate(
        str(target), str(view), format="WEBP", width=THUMB_WIDTH_PX, height=0, resampleAlg="average", creationOptions=options
    ).Close()
    return target


def series_encoding(ctx: JobContext) -> tuple[TileEncoding, bool | None]:
    """M20 (docs/research/M20-import-local.md §6): an archive series' encoding and its paper mode.

    For line art, `True` is transparent paper (opt-in), `False` is opaque white (the default); every other job returns `None`
    and today's grey tiles.
    """
    if ctx.job.type != ARCHIVE_JOB:
        return ENCODINGS["grey"], None
    name = ctx.job.params.get("encoding")
    if name != "lineart":
        return encoding_of(name), None
    return ENCODINGS["lineart"], ctx.job.params.get("paperTransparent") is True


def _source_of(ctx: JobContext, rendered: Rendered) -> Path:
    if ctx.job.type not in SIDE_JOB_TYPES:
        return ctx.stage(ctx.work_file("warped.tif"), "warped.tif")
    if rendered.cog_path is None:
        raise StepFailedError(Errors.PROCESSING_FAILED, "the version has neither tiles nor a COG to make them from")
    return ctx.stage(rendered.cog_path, "cog.tif")


def _lineart_view(ctx: JobContext, source: Path, transparent: bool) -> Path:
    """Line art as opaque white paper (default) or transparent paper (opt-in)."""
    encode = paper_transparent if transparent else paper_opaque
    note = "make the paper transparent" if transparent else "make the paper opaque white"
    return gdal_step(ctx, lambda: encode(source, ctx.local("lineart.tif")), note)


class PyramidStep:
    name = "pyramid"

    def run(self, ctx: JobContext) -> StepResult:
        rendered = Rendered.of(ctx.read(ctx.version_path()))
        encoding, paper = series_encoding(ctx)
        source = _source_of(ctx, rendered)
        if paper is not None:
            source = _lineart_view(ctx, source, paper)
        film = ctx.job.type != ARCHIVE_JOB
        view = gdal_step(ctx, lambda: rgba_view(source, ctx.local("rgba.vrt"), film), "read the rendered layer")
        tree = gdal_step(ctx, lambda: write_tree(view, ctx.local("tree"), rendered, ctx, encoding), "make the tiles")
        thumb = gdal_step(ctx, lambda: write_thumb(view, ctx.local("thumb.webp")), "make the picture")
        archive = ctx.local("tiles.pmtiles")
        packed = _packed(tree, archive, ArchiveInfo(ctx.version.layer_id, rendered.bounds, rendered.minzoom, rendered.maxzoom))
        shutil.rmtree(tree)
        sha256 = sha256_of(archive)
        info = ctx.publish(archive, ctx.version_file("tiles.pmtiles"), ARCHIVE_TYPE)
        thumb_info = ctx.publish(thumb, ctx.version_file("thumb.webp"), THUMB_TYPE)
        tiles = {"path": info.path, "bytes": info.size, "count": packed.count, "sha256": sha256, "thumbPath": thumb_info.path}
        ctx.update_version({"output.tiles": tiles})
        return Done(info, sha256)


def _packed(tree: Path, archive: Path, info: ArchiveInfo) -> Packed:
    try:
        return pack(tree, archive, info)
    except PackError as error:
        raise StepFailedError(Errors.PROCESSING_FAILED, str(error)) from error
