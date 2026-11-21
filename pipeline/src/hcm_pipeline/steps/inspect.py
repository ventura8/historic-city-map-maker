"""`inspect` (uploads): what the admin's GeoTIFF is (docs/research/M3-interfaces.md §5.3, §8.1).

GDAL opens the upload; a geotransform with a CRS, or GCPs with one, is its own georeference (`method:
'embedded'`, then `reference` and `georef` are skipped and the version waits for a click, never published on its
own); anything else is a scan that waits for the admin's points after `reference`. Either way the scan is
written as 8-bit (one band, or three for colour; other types stretched between the 2nd and 98th percentiles),
keeping the upload's own georeference, with its preview.
"""

from pathlib import Path
from typing import Final

import numpy

from hcm_pipeline.contract import Errors
from hcm_pipeline.documents import GeorefInfo
from hcm_pipeline.jobs import Done, JobContext, StepResult
from hcm_pipeline.model import GeotiffImportParams
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import GTIFF_OPTIONS, RasterInfo, raster_info, read_band
from hcm_pipeline.steps.common import gdal_step, publish_scan

COLOUR_BANDS: Final = 3
STATS_PX: Final = 2048
EMBEDDED: Final = GeorefInfo("embedded", "affine", ())


def scan_bands(info: RasterInfo) -> list[int]:
    """The bands the scan keeps: three for colour, else the first (a grey band with an alpha keeps the grey)."""
    return [1, 2, 3] if info.bands >= COLOUR_BANDS else [1]


def _stretch(path: Path, band: int, size: tuple[int, int]) -> list[float]:
    low, high = numpy.percentile(read_band(path, band, size).astype(numpy.float64), [2.0, 98.0])
    return [float(low), max(float(high), float(low) + 1), 0.0, 255.0]


def _scales(path: Path, info: RasterInfo, bands: list[int]) -> list[list[float]] | None:
    """`gdal.Translate`'s per-band stretch to 8 bits, between the 2nd and 98th percentiles (None for 8-bit uploads)."""
    size = (min(info.width, STATS_PX), min(info.height, STATS_PX))
    return None if info.data_type == gdal.GDT_Byte else [_stretch(path, band, size) for band in bands]


def write_scan(source: Path, target: Path) -> Path:
    """The upload as an 8-bit scan, its georeference (geotransform or GCPs) kept."""
    info = raster_info(source)
    bands = scan_bands(info)
    scales = _scales(source, info, bands)
    options: dict[str, object] = {"format": "GTiff", "outputType": gdal.GDT_Byte, "bandList": bands, "creationOptions": list(GTIFF_OPTIONS)}
    gdal.Translate(str(target), str(source), **options, **({"scaleParams": scales} if scales else {})).Close()
    return target


class InspectStep:
    name = "inspect"

    def run(self, ctx: JobContext) -> StepResult:
        params = GeotiffImportParams.of(ctx.job.params)
        upload = ctx.stage(params.upload_path, "upload.tif")
        unreadable = Errors.UNREADABLE_RASTER
        info = gdal_step(ctx, lambda: raster_info(upload), "read the upload", unreadable)
        scan_path = gdal_step(ctx, lambda: write_scan(upload, ctx.local("scan.tif")), "convert the upload to 8 bits", unreadable)
        scan = gdal_step(ctx, lambda: publish_scan(ctx, scan_path), "read the scan", unreadable)
        fields: dict[str, object] = {"scan": scan.as_record()}
        if info.georeferenced:
            fields["georef"] = EMBEDDED.as_record()
        ctx.update_version(fields)
        ctx.log.info(
            "the upload carries its own georeference" if info.georeferenced else "the upload is a scan without georeference", self.name
        )
        return Done(ctx.services.objects.stat(scan.path), scan.sha256)
