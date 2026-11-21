"""The synthetic world: proves GDAL (osgeo) writes and reads georeferenced rasters inside the image."""

from pathlib import Path

import numpy
import pytest
from hcm_pipeline.raster import gdal, osr

from tests.synthetic.world import DEFAULT_WORLD, WorldSpec, geotransform, render, web_mercator, write_world


def test_happy_path_world_round_trips_through_a_geotiff(tmp_path: Path) -> None:
    path = write_world(tmp_path / "world.tif")

    dataset = gdal.Open(str(path))
    pixels = dataset.GetRasterBand(1).ReadAsArray()

    assert (dataset.RasterXSize, dataset.RasterYSize, dataset.RasterCount) == (128, 128, 1)
    assert pixels.dtype == numpy.uint8
    assert numpy.array_equal(pixels, render(DEFAULT_WORLD))
    dataset.Close()


def test_happy_path_world_is_georeferenced_in_web_mercator_around_its_centre(tmp_path: Path) -> None:
    spec = WorldSpec(size_px=64, pixel_size_m=5.0)
    dataset = gdal.Open(str(write_world(tmp_path / "small.tif", spec)))
    srs = osr.SpatialReference()
    srs.ImportFromWkt(dataset.GetProjection())
    origin_x, pixel_w, _, origin_y, _, pixel_h = dataset.GetGeoTransform()
    center_x, center_y = web_mercator(spec.center_lon, spec.center_lat)

    assert srs.GetAuthorityCode(None) == "3857"
    assert (pixel_w, pixel_h) == (5.0, -5.0)
    assert origin_x + 32 * pixel_w == pytest.approx(center_x)
    assert origin_y + 32 * pixel_h == pytest.approx(center_y)
    assert dataset.GetGeoTransform() == pytest.approx(geotransform(spec))
    dataset.Close()


def test_happy_path_world_is_deterministic_per_seed(tmp_path: Path) -> None:
    def checksum(name: str, seed: int) -> int:
        dataset = gdal.Open(str(write_world(tmp_path / name, WorldSpec(seed=seed))))
        value = dataset.GetRasterBand(1).Checksum()
        dataset.Close()
        return value

    assert checksum("a.tif", 7) == checksum("b.tif", 7)
    assert checksum("c.tif", 7) != checksum("d.tif", 8)


@pytest.mark.parametrize(("lon", "lat"), [(0.0, 0.0), (26.10, 44.43), (-122.42, 37.77), (180.0, 0.0)])
def test_happy_path_web_mercator_agrees_with_gdal(lon: float, lat: float) -> None:
    wgs84, mercator = osr.SpatialReference(), osr.SpatialReference()
    wgs84.ImportFromEPSG(4326)
    mercator.ImportFromEPSG(3857)
    wgs84.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    x, y, _ = osr.CoordinateTransformation(wgs84, mercator).TransformPoint(lon, lat)

    assert web_mercator(lon, lat) == pytest.approx((x, y), abs=1e-3)


def test_bad_path_writing_into_a_missing_directory_raises(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="No such file or directory"):
        write_world(tmp_path / "missing" / "world.tif")


def test_bad_path_opening_a_corrupt_raster_raises(tmp_path: Path) -> None:
    corrupt = tmp_path / "corrupt.tif"
    corrupt.write_bytes(b"II*\x00not a tiff")

    with pytest.raises(RuntimeError):
        gdal.Open(str(corrupt))
