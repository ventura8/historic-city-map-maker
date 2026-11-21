"""A version rendered before M12, and the side job that gives it tiles (docs/research/M12-own-tiles.md)."""

from pathlib import Path
from typing import Final

import numpy
from hcm_pipeline.geo import ZOOM0_RESOLUTION_M, to_mercator
from hcm_pipeline.model import Timestamp
from hcm_pipeline.raster import gdal, osr
from hcm_pipeline.rasters import driver_of
from hcm_pipeline.runner import RunOutcome
from hcm_pipeline.steps.export import Warped, write_cog

from tests.fakes.world import CITY, JOB_ID, LAYER_ID, NOW, OWNER_UID, PipelineWorld, stamp_of

FILES: Final = f"rasters/{CITY}/{LAYER_ID}/{JOB_ID}/"
TILES_JOB: Final = "tiles-1234abcd"
ZOOM: Final = 14


def grey_warped(path: Path, alpha_value: int = 255) -> Path:
    """A small warped layer on a z14 grid: a grey band and its alpha, over the middle of the world's city."""
    resolution = ZOOM0_RESOLUTION_M / 2**ZOOM
    left, top = to_mercator(26.1, 44.43)
    left, top = left - left % resolution, top - top % resolution
    dataset = driver_of("GTiff").Create(str(path), 600, 600, 2, gdal.GDT_Byte)
    dataset.SetGeoTransform((left, resolution, 0, top, 0, -resolution))
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(3857)
    dataset.SetProjection(srs.ExportToWkt())
    grey = (numpy.indices((600, 600)).sum(axis=0) % 251).astype(numpy.uint8)
    dataset.GetRasterBand(1).WriteArray(grey)
    alpha = numpy.zeros((600, 600), numpy.uint8)
    alpha[50:550, 50:550] = alpha_value
    dataset.GetRasterBand(2).SetColorInterpretation(gdal.GCI_AlphaBand)
    dataset.GetRasterBand(2).WriteArray(alpha)
    dataset.Close()
    return path


def seed_old_version(world: PipelineWorld, tmp_path: Path, state: str = "approved", with_cog: bool = True) -> None:
    """A version rendered before M12: a COG, no tiles; and the side job the sweep queues for it."""
    world.seed_own_city()
    warped = Warped.of(grey_warped(tmp_path / "warped.tif"))
    cog_path = f"{FILES}cog.tif"
    if with_cog:
        world.gcs.put(cog_path, write_cog(warped, tmp_path / "cog.tif").read_bytes())
    bounds = warped.grid.box().bounds().as_record()
    output: dict[str, object] = {"previewPath": f"{FILES}preview.png", "bounds": bounds, "minzoom": 12, "maxzoom": ZOOM, "areaKm2": 1.0}
    if with_cog:
        output |= {"cogPath": cog_path, "cogBytes": 1, "cogSha256": "c" * 64}
    version = {
        "layerId": LAYER_ID,
        "jobId": JOB_ID,
        "origin": "usgs",
        "state": state,
        "label": {"ro": "Cadrul"},
        "year": 1983,
        "output": output,
        "approval": {"auto": False, "by": OWNER_UID, "at": Timestamp.at(NOW - 99)},
        "createdBy": OWNER_UID,
        "createdAt": Timestamp.at(NOW - 99),
        **stamp_of(NOW - 99),
    }
    world.store.seed(world.version_path(JOB_ID), version)
    world.seed_job(TILES_JOB, "layer-tiles", {"versionId": JOB_ID})
    world.store.update(world.job_path(TILES_JOB), {"versionId": JOB_ID})


def run_tiles_job(world: PipelineWorld) -> RunOutcome:
    return world.runner(world.config.__class__(**{**world.config.__dict__, "job_id": TILES_JOB})).run()
