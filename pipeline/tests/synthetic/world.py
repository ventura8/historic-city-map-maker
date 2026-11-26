"""A synthetic reference world: a small, seeded EPSG:3857 GeoTIFF near Bucharest, written with GDAL.

M0 keeps it tiny; it proves that the `osgeo` bindings of the GDAL base image work in the test venv.
M3 grows it into the reference-world and scan harness of docs/research/design-review-testability.md
§3.6 (road grid, river, parks; inverse-warped scans with a known transform). No raster is committed:
each test writes its world into pytest's tmp_path.
"""

import math
from dataclasses import dataclass
from pathlib import Path

import numpy
from hcm_pipeline.raster import gdal, osr
from numpy.typing import NDArray

EARTH_RADIUS_M = 6_378_137.0
ROAD_SPACING_PX = 32
ROAD_WIDTH_PX = 3
ROAD_VALUE = 250
RIVER_VALUE = 30
WEB_MERCATOR_EPSG = 3857


@dataclass(frozen=True)
class WorldSpec:
    """Size in pixels, ground resolution, noise seed and the geographic centre (default: central Bucharest)."""

    size_px: int = 128
    pixel_size_m: float = 10.0
    seed: int = 0
    center_lon: float = 26.10
    center_lat: float = 44.43


DEFAULT_WORLD = WorldSpec()


def web_mercator(lon: float, lat: float) -> tuple[float, float]:
    """EPSG:4326 degrees to EPSG:3857 metres (spherical Mercator)."""
    x = EARTH_RADIUS_M * math.radians(lon)
    y = EARTH_RADIUS_M * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    return x, y


def render(spec: WorldSpec) -> NDArray[numpy.uint8]:
    """The world as 8-bit grey levels: seeded texture, a road grid and a sinuous river."""
    rng = numpy.random.default_rng(spec.seed)
    image = rng.integers(90, 160, size=(spec.size_px, spec.size_px), dtype=numpy.uint8)
    for offset in range(ROAD_WIDTH_PX):
        image[offset::ROAD_SPACING_PX, :] = ROAD_VALUE
        image[:, offset::ROAD_SPACING_PX] = ROAD_VALUE
    columns = numpy.arange(spec.size_px)
    river_rows = (spec.size_px / 2 + spec.size_px / 8 * numpy.sin(columns / 9.0)).astype(int)
    image[river_rows, columns] = RIVER_VALUE
    return image


def geotransform(spec: WorldSpec) -> tuple[float, float, float, float, float, float]:
    """North-up geotransform whose raster centre is the spec's centre."""
    center_x, center_y = web_mercator(spec.center_lon, spec.center_lat)
    half = spec.size_px * spec.pixel_size_m / 2
    return (center_x - half, spec.pixel_size_m, 0.0, center_y + half, 0.0, -spec.pixel_size_m)


def write_world(path: Path, spec: WorldSpec = DEFAULT_WORLD) -> Path:
    """Writes the world as a DEFLATE-compressed single-band GeoTIFF in EPSG:3857 and returns `path`."""
    driver = gdal.GetDriverByName("GTiff")
    if driver is None:
        raise RuntimeError("GDAL has no GTiff driver")
    dataset = driver.Create(str(path), spec.size_px, spec.size_px, 1, gdal.GDT_Byte, ["COMPRESS=DEFLATE", "TILED=YES"])
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(WEB_MERCATOR_EPSG)
    dataset.SetGeoTransform(geotransform(spec))
    dataset.SetProjection(srs.ExportToWkt())
    dataset.GetRasterBand(1).WriteArray(render(spec))
    dataset.Close()
    return path
