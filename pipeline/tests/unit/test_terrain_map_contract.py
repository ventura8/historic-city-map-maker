"""The map of a frame over terrain as GDAL reads it for the warp: the contract the georeferencer's preview is held to
(`pipeline/tests/contracts/terrain-map.json`, read by `packages/shared/test/georef/terrain.test.ts`; M15-calibration-accuracy.md,
*Terrain*).

The record is a frame seen off nadir over a 90 m hill (`tests/integration/test_terrain_readers.py`, written once through
`gdal_pixels` below); each probe is a place on the ground, 7 x 7 over the scan, and the scan pixel GDAL's RPC
transformer gives it over the record's own heights, exactly as `steps/warp.py` hands them to `RPC_DEM`. The TypeScript map must give the
same pixels; this side checks that the file is GDAL's answer for its record.
"""

from pathlib import Path
from typing import Final

import numpy
from hcm_pipeline.documents import terrain_of
from hcm_pipeline.geo import FloatArray
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import driver_of
from hcm_pipeline.steps.warp import RPC_OPTIONS
from hcm_pipeline.surface import write_heights

from tests.contracts_loader import golden
from tests.integration.test_terrain_readers import PIXEL_GROUND_M, SIZE

PROBES_A_SIDE: Final = 7
# GDAL's answer for the stored record, to well under a thousandth of a pixel.
SAME_PX: Final = 1e-6


def gdal_pixels(record: object, lng: FloatArray, lat: FloatArray, tmp: Path) -> FloatArray:
    """Scan pixels of places through GDAL's RPC transformer over the record's heights, as a warp reads them."""
    terrain = terrain_of(record)
    assert terrain is not None
    dem = write_heights(tmp / "dem.tif", terrain.heights)
    dataset = driver_of("MEM").Create("", *SIZE, 0)
    for key, value in terrain.rpc.metadata().items():
        dataset.SetMetadataItem(key, value, "RPC")
    transformer = gdal.Transformer(dataset, None, ["METHOD=RPC", f"RPC_DEM={dem}", *RPC_OPTIONS])
    found, ok = transformer.TransformPoints(1, [(float(x), float(y), 0.0) for x, y in zip(lng, lat, strict=True)])
    assert all(ok)
    return numpy.array(found, numpy.float64)[:, :2]


def test_happy_path_the_contract_is_gdals_reading_of_its_record(tmp_path: Path) -> None:
    """Scenarios: S-A16-HAPPY-TERRAIN-PREVIEW"""
    stored = golden("terrain-map.json")
    probes = stored["probes"]
    assert isinstance(probes, list)
    lng = numpy.array([probe["geo"]["lng"] for probe in probes])
    lat = numpy.array([probe["geo"]["lat"] for probe in probes])
    expected = numpy.array([[probe["pixel"]["x"], probe["pixel"]["y"]] for probe in probes])

    assert float(numpy.abs(gdal_pixels(stored["terrain"], lng, lat, tmp_path) - expected).max()) < SAME_PX
    assert len(probes) == PROBES_A_SIDE**2


def test_bad_path_read_at_another_height_the_hill_lands_elsewhere(tmp_path: Path) -> None:
    """Scenarios: S-A16-HAPPY-TERRAIN-PREVIEW"""
    stored = golden("terrain-map.json")
    record, probes = stored["terrain"], stored["probes"]
    assert isinstance(record, dict)
    assert isinstance(probes, list)
    level = {**record, "heights": {**record["heights"], "valuesDm": "AAAA" * (len(record["heights"]["valuesDm"]) // 4)}}
    lng, lat = numpy.array([probe["geo"]["lng"] for probe in probes]), numpy.array([probe["geo"]["lat"] for probe in probes])

    # Read at the record's lowest height instead of the hill's, its slopes land metres away (25 m a pixel): the heights are the map.
    moved = gdal_pixels(level, lng, lat, tmp_path) - gdal_pixels(record, lng, lat, tmp_path)
    assert float(numpy.hypot(*moved.T).max()) * PIXEL_GROUND_M > 10.0
