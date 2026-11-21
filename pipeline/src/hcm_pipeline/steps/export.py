"""`export`: the admin's preview, and for a city that publishes through Mapbox the COG and the Studio file (docs/research/M3-interfaces.md
§5.3; docs/research/M12-own-tiles.md: every other city's tiles come from `pyramid`, so it pays for no 300 MB file nothing reads).

An 8-bit COG (`COMPRESS=JPEG`, `QUALITY=85`, 512 px blocks, overviews; the alpha band becomes a mask, which JPEG
needs), an RGBA PNG preview of at most 2048 px, and a JPEG-compressed GeoTIFF of at most `STUDIO_MAX_BYTES`
(halved until it fits) for the free Mapbox Studio upload. The valid area in km² (the alpha's share of the
extent, on the ground) feeds the compute-unit estimate; the share of the city's bounds under the alpha (`coveragePct`, M9 §5) tells a
frame that holds part of the city from one that holds all of it. The version's `output` records all of it.
"""

import math
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import numpy

from hcm_pipeline.calibrate.reach import COVER_SIDE_CELLS, Reach, outline
from hcm_pipeline.contract import STUDIO_MAX_BYTES
from hcm_pipeline.documents import OutputInfo, city_bounds
from hcm_pipeline.geo import ZOOM0_RESOLUTION_M, Grid, ground_scale
from hcm_pipeline.jobs import Done, JobContext, StepResult
from hcm_pipeline.join.canvas import DatasetSource
from hcm_pipeline.model import Job
from hcm_pipeline.objects import ObjectInfo, sha256_of
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import fit_long_side, raster_info, read_band
from hcm_pipeline.steps.aligning import publish_align
from hcm_pipeline.steps.common import gdal_step
from hcm_pipeline.steps.merge import city_part, coverage_pct
from hcm_pipeline.steps.warp import zooms

COG_OPTIONS: Final = ("COMPRESS=JPEG", "QUALITY=85", "BLOCKSIZE=512", "OVERVIEWS=AUTO")
# M20 (docs/research/M20-import-local.md §6): an archive's line art is never JPEG; DEFLATE with a predictor keeps its lines exact.
LINEART_COG_OPTIONS: Final = ("COMPRESS=DEFLATE", "PREDICTOR=2", "BLOCKSIZE=512", "OVERVIEWS=AUTO")
STUDIO_OPTIONS: Final = ("COMPRESS=JPEG", "JPEG_QUALITY=85", "TILED=YES", "BIGTIFF=IF_SAFER")
PREVIEW_MAX_PX: Final = 2048
AREA_SAMPLE_PX: Final = 2048
STUDIO_HALVINGS: Final = 6
SQUARE_METRES_PER_KM2: Final = 1e6


@dataclass(frozen=True)
class Warped:
    """The warped raster's grid and bands (colour bands, then the alpha band last)."""

    path: Path
    grid: Grid
    bands: int

    @classmethod
    def of(cls, path: Path) -> Warped:
        info = raster_info(path)
        left, resolution, _, top, _, _ = info.geotransform or (0.0, 1.0, 0.0, 0.0, 0.0, -1.0)
        return cls(path, Grid(left, top, resolution, info.width, info.height), info.bands)

    @property
    def colour(self) -> list[int]:
        return list(range(1, self.bands))

    @property
    def zoom(self) -> int:
        return round(math.log2(ZOOM0_RESOLUTION_M / self.grid.resolution))


def write_cog(warped: Warped, target: Path, options: tuple[str, ...] = COG_OPTIONS) -> Path:
    gdal.Translate(str(target), str(warped.path), format="COG", creationOptions=list(options)).Close()
    return target


def cog_options(job: Job) -> tuple[str, ...]:
    """The COG's compression: lossless for an archive series of line art, JPEG for every other layer."""
    lineart = job.type == "archive-series" and job.params.get("encoding") == "lineart"
    return LINEART_COG_OPTIONS if lineart else COG_OPTIONS


def write_preview(warped: Warped, target: Path) -> Path:
    """An RGBA PNG (a grey layer repeats its band three times), the long side at most 2048 px."""
    width, height, _ = fit_long_side(warped.grid.width, warped.grid.height, PREVIEW_MAX_PX)
    colour = warped.colour if len(warped.colour) >= len("rgb") else warped.colour * len("rgb")
    gdal.Translate(str(target), str(warped.path), format="PNG", bandList=[*colour[:3], warped.bands], width=width, height=height).Close()
    return target


def write_studio(warped: Warped, target: Path, max_bytes: int = STUDIO_MAX_BYTES) -> Path | None:
    """A JPEG-compressed GeoTIFF of at most `max_bytes`, halved until it fits (None when even 1/64 does not)."""
    for halving in range(STUDIO_HALVINGS):
        percent = 100.0 / 2**halving
        options = {"bandList": warped.colour, "maskBand": warped.bands, "widthPct": percent, "heightPct": percent}
        gdal.Translate(str(target), str(warped.path), format="GTiff", creationOptions=list(STUDIO_OPTIONS), **options).Close()
        if target.stat().st_size <= max_bytes:
            return target
    return None


def valid_area_km2(warped: Warped) -> float:
    """The ground area under the alpha band, km² (sampled at most 2048 px a side)."""
    width, height, scale = fit_long_side(warped.grid.width, warped.grid.height, AREA_SAMPLE_PX)
    alpha = read_band(warped.path, warped.bands, (width, height))
    pixel_area = (warped.grid.resolution / scale) ** 2
    middle = warped.grid.box().bounds().middle_lat
    return float(numpy.count_nonzero(alpha)) * pixel_area * ground_scale(middle) ** 2 / SQUARE_METRES_PER_KM2


def city_coverage(warped: Warped, city: Mapping[str, object] | None) -> float | None:
    """How much of the city's bounds the layer shows, percent; None without a city document."""
    if city is None:
        return None
    source = DatasetSource(warped.path)
    share = coverage_pct(source, warped.grid, city_bounds(city).mercator())
    source.close()
    return share


def rendered_outline(warped: Warped, city: Mapping[str, object] | None) -> tuple[dict[str, float], ...]:
    """The alpha's edge over the city's bounds, however the version was fitted: since a USGS render's grid is the whole window (M9 §5), its
    `bounds` no longer say where the frame lies, and `imagery/join.ts` plans with this. Empty when the frame shows none of the city."""
    part = None if city is None else city_part(warped.grid, city_bounds(city).mercator())
    if part is None:
        return ()
    left, top, width, height = part
    shrink = max(width, height) / COVER_SIDE_CELLS
    size = max(1, round(width / shrink)), max(1, round(height / shrink))
    source = DatasetSource(warped.path)
    mask = numpy.asarray(source.alpha_of(left, top, width, height, size) > 0, numpy.bool_)
    source.close()
    resolution = warped.grid.resolution * shrink
    grid = Grid(warped.grid.left + left * warped.grid.resolution, warped.grid.top - top * warped.grid.resolution, resolution, *size)
    return tuple(outline(Reach(mask, numpy.empty((0, 2)), grid)))


def _path_of(info: ObjectInfo | None) -> str | None:
    return None if info is None else info.path


def _size_of(info: ObjectInfo | None) -> int | None:
    return None if info is None else info.size


@dataclass(frozen=True)
class MapboxFiles:
    """What only Mapbox's path reads: the COG and its digest, and the Studio file when one fits; none of them on the default path."""

    cog: ObjectInfo | None = None
    cog_sha256: str | None = None
    studio: ObjectInfo | None = None


def publishes_through_mapbox(city: Mapping[str, object] | None) -> bool:
    """The city's `imagery.publishThroughMapbox` (`cityImagerySchema`): off by default."""
    imagery = (city or {}).get("imagery")
    return isinstance(imagery, dict) and imagery.get("publishThroughMapbox") is True


def uploads_rasters(city: Mapping[str, object] | None, job: Job) -> bool:
    """The COG and the Studio file go up for a city on Mapbox's path, never for an archive series (M20 §4): its full-resolution
    rasters stay on the owner's computer; only its tiles, thumbnail, preview and sheets go up."""
    return publishes_through_mapbox(city) and job.type != "archive-series"


class ExportStep:
    name = "export"

    def __init__(self, studio_max_bytes: int = STUDIO_MAX_BYTES) -> None:
        self._studio_max_bytes = studio_max_bytes

    def _mapbox_files(self, ctx: JobContext, warped: Warped) -> MapboxFiles:
        cog = gdal_step(ctx, lambda: write_cog(warped, ctx.local("cog.tif"), cog_options(ctx.job)), "write the COG")
        studio = gdal_step(ctx, lambda: write_studio(warped, ctx.local("studio.tif"), self._studio_max_bytes), "write the Studio file")
        sha256 = sha256_of(cog)
        cog_info = ctx.publish(cog, ctx.version_file("cog.tif"), "image/tiff")
        return MapboxFiles(cog_info, sha256, None if studio is None else ctx.publish(studio, ctx.version_file("studio.tif"), "image/tiff"))

    def run(self, ctx: JobContext) -> StepResult:
        warped = gdal_step(ctx, lambda: Warped.of(ctx.stage(ctx.work_file("warped.tif"), "warped.tif")), "read the warped layer")
        city = ctx.read(f"cities/{ctx.city}")
        mapbox = self._mapbox_files(ctx, warped) if uploads_rasters(city, ctx.job) else MapboxFiles()
        preview = gdal_step(ctx, lambda: write_preview(warped, ctx.local("preview.png")), "write the preview")
        preview_info = ctx.publish(preview, ctx.version_file("preview.png"), "image/png")
        publish_align(ctx, ctx.stage(ctx.work_file("warped.tif"), "warped.tif"))
        minzoom, maxzoom = zooms(ctx.version, warped.zoom)
        output = OutputInfo(
            cog_path=_path_of(mapbox.cog),
            cog_bytes=_size_of(mapbox.cog),
            cog_sha256=mapbox.cog_sha256,
            preview_path=preview_info.path,
            bounds=warped.grid.box().bounds(),
            minzoom=minzoom,
            maxzoom=maxzoom,
            area_km2=valid_area_km2(warped),
            studio_path=_path_of(mapbox.studio),
            studio_bytes=_size_of(mapbox.studio),
            coverage_pct=gdal_step(ctx, lambda: city_coverage(warped, city), "measure the coverage"),
            outline=gdal_step(ctx, lambda: rendered_outline(warped, city), "measure the outline"),
        )
        ctx.update_version({"output": output.as_record()})
        return Done(mapbox.cog or preview_info, mapbox.cog_sha256)
