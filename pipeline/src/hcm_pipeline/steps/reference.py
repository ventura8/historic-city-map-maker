"""`reference`: the window's Sentinel-2 and OpenStreetMap references (docs/research/M3-interfaces.md §5.5).

Both are cached (`reference/{city}/...`); this step draws the georeferencer's two images, `reference-s2.jpg` (true
colour) and `reference-osm.png` (the lines on transparency), on the window's 10 m grid, and records the version's
`reference` (the window's bounds, the two images, the item and its date, and `s2Check`: the reference guard's verdict over
the clear dates it compared, `agreement.py`). An upload with its own georeference
needs none (`skipped`). Attributions: "Contains modified Copernicus Sentinel data {year}" and "© OpenStreetMap
contributors (ODbL)". Never Mapbox Satellite.
"""

from typing import Final

import numpy

from hcm_pipeline.contract import SCAN_PREVIEW_MAX_PX
from hcm_pipeline.documents import ReferenceInfo
from hcm_pipeline.images import UInt8Array, resize, write_jpeg, write_png
from hcm_pipeline.jobs import Done, JobContext, Skipped, StepResult
from hcm_pipeline.osm import draw
from hcm_pipeline.rasters import fit_long_side, read_band, to_uint8
from hcm_pipeline.steps.common import Sentinel2, city_window, gdal_step, osm_features, sentinel2

LINE_COLOUR: Final = (230, 40, 40)


def true_colour(source: Sentinel2) -> UInt8Array:
    """The window's three bands as one RGB image, the long side at most `SCAN_PREVIEW_MAX_PX`."""
    rgb = numpy.dstack([to_uint8(read_band(source.local, band)) for band in (1, 2, 3)])
    width, height, _ = fit_long_side(rgb.shape[1], rgb.shape[0], SCAN_PREVIEW_MAX_PX)
    return resize(rgb, (width, height))


def osm_overlay(lines: UInt8Array) -> UInt8Array:
    """The drawn lines in one colour on transparency (RGBA), the long side at most `SCAN_PREVIEW_MAX_PX`."""
    width, height, _ = fit_long_side(lines.shape[1], lines.shape[0], SCAN_PREVIEW_MAX_PX)
    alpha = resize(lines, (width, height))
    colour = [numpy.full_like(alpha, value) for value in LINE_COLOUR]
    return numpy.dstack([*colour, alpha])


class ReferenceStep:
    name = "reference"

    def run(self, ctx: JobContext) -> StepResult:
        if ctx.version.georef is not None and ctx.version.georef.method == "embedded":
            return Skipped("the upload carries its own georeference")
        window = city_window(ctx)
        source = sentinel2(ctx, window)
        features, _ = osm_features(ctx, window)
        s2_image = gdal_step(ctx, lambda: write_jpeg(ctx.local("reference-s2.jpg"), true_colour(source)), "draw the Sentinel-2 image")
        osm_image = write_png(ctx.local("reference-osm.png"), osm_overlay(draw(features, source.grid())))
        s2_path = ctx.publish(s2_image, ctx.version_file("reference-s2.jpg"), "image/jpeg").path
        osm_path = ctx.publish(osm_image, ctx.version_file("reference-osm.png"), "image/png").path
        item = source.items[0]
        reference = ReferenceInfo(window.bounds(), osm_path, s2_path, item.id, item.date, source.check)
        ctx.update_version({"reference": reference.as_record()})
        return Done(source.info)
