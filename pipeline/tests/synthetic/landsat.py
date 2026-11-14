"""A synthetic Landsat Collection 2 Level-1 bundle of the synthetic world (docs/research/M25-landsat.md §8).

The world's pixels, warped from EPSG:3857 to UTM zone 35N (where the synthetic city lies, as Bucharest does) at Landsat's 30 m (15 m for
the panchromatic band of ETM+ and OLI), one GeoTIFF a band, named as USGS names them, with the quality band (`QA_PIXEL`: fill outside
the scene, a cloud box where a test asks for one) and the metadata text, packed in a plain tar as USGS delivers it. A test may leave a
band out.
"""

import io
import tarfile
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import numpy
from hcm_pipeline.geo import MercatorBox
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import GeoTiff, driver_of, srs_wkt, write_geotiff

from tests.synthetic.scenes import World

PRODUCT: Final = "LT05_L1TP_183029_19890712_20200916_02_T1"
ETM_PRODUCT: Final = "LE07_L1TP_183029_20000715_20200918_02_T1"
OLI_PRODUCT: Final = "LC09_L1TP_183029_20230718_20230718_02_T1"
SYSTEMATIC_PRODUCT: Final = "LT05_L1GS_182029_20080815_20201030_02_T2"
UTM_35N: Final = "EPSG:32635"
CLOUD: Final = 1 << 3
FILL: Final = 1
TM: Final = ("B1", "B2", "B3")


@dataclass(frozen=True)
class Bundle:
    """What to pack: the product id, the bands, an optional cloud box (EPSG:3857), and the bands left out."""

    product: str = PRODUCT
    bands: tuple[str, ...] = (*TM, "QA_PIXEL")
    cloud: MercatorBox | None = None
    left_out: frozenset[str] = frozenset()


def _band_of_world(world: World, folder: Path, name: str, resolution_m: float) -> Path:
    """The world warped to UTM at `resolution_m`, its outside 0 (no data)."""
    source = write_geotiff(folder / f"world-{name}.tif", GeoTiff([world.pixels], world.grid.geotransform()))
    target = folder / f"{name}.TIF"
    gdal.Warp(str(target), str(source), dstSRS=UTM_35N, xRes=resolution_m, yRes=resolution_m, dstNodata=0, resampleAlg="average").Close()
    return target


def _quality(world: World, folder: Path, cloud: MercatorBox | None) -> Path:
    """The quality band: fill outside the world, cloud inside `cloud`, nothing else; in UTM at 30 m, nearest."""
    centres_x, centres_y = world.grid.centres()
    quality = numpy.zeros(world.pixels.shape, numpy.uint16)
    if cloud is not None:
        inside = (centres_x >= cloud.left) & (centres_x <= cloud.right) & (centres_y >= cloud.bottom) & (centres_y <= cloud.top)
        quality[inside] = CLOUD
    source = folder / "world-qa.tif"
    dataset = driver_of("GTiff").Create(str(source), world.grid.width, world.grid.height, 1, gdal.GDT_UInt16)
    dataset.SetGeoTransform(world.grid.geotransform())
    dataset.SetProjection(srs_wkt(3857))
    dataset.GetRasterBand(1).WriteArray(quality)
    dataset.Close()
    target = folder / "QA_PIXEL.TIF"
    gdal.Warp(str(target), str(source), dstSRS=UTM_35N, xRes=30.0, yRes=30.0, dstNodata=FILL, resampleAlg="near").Close()
    return target


def _members(world: World, folder: Path, bundle: Bundle) -> Iterable[tuple[str, Path]]:
    for band in bundle.bands:
        if band in bundle.left_out:
            continue
        if band == "QA_PIXEL":
            yield f"{bundle.product}_QA_PIXEL.TIF", _quality(world, folder, bundle.cloud)
        else:
            yield f"{bundle.product}_{band}.TIF", _band_of_world(world, folder, band, 15.0 if band == "B8" else 30.0)


def landsat_bundle(world: World, folder: Path, bundle: Bundle) -> bytes:
    """The bundle's bytes: a plain tar of the bands and the metadata text, as USGS delivers a Level-1 product."""
    folder.mkdir(parents=True, exist_ok=True)
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as archive:
        for name, path in _members(world, folder, bundle):
            archive.add(str(path), arcname=name)
        metadata = f"PRODUCT_ID = {bundle.product}\n".encode()
        info = tarfile.TarInfo(f"{bundle.product}_MTL.txt")
        info.size = len(metadata)
        archive.addfile(info, io.BytesIO(metadata))
    return buffer.getvalue()
