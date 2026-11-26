"""`doctor`: proves the runtime image can do raster work, and logs the library versions.

Run it after every image build and from the Setup Assistant's self-test: `python -m hcm_pipeline doctor`.
It needs no job configuration. It fails when a GDAL driver the pipeline writes or reads is missing
(GTiff and COG for the exported rasters, VRT for crops, PNG and JPEG for previews and browse images).
"""

import platform
from collections.abc import Callable, Sequence
from typing import Final

import cv2
import numpy

from hcm_pipeline.log import fields
from hcm_pipeline.raster import gdal
from hcm_pipeline.steps import Outcome, StepContext, StepError

REQUIRED_DRIVERS: Final = ("GTiff", "COG", "VRT", "PNG", "JPEG")

DriverLookup = Callable[[str], object | None]


def missing_drivers(lookup: DriverLookup, names: Sequence[str] = REQUIRED_DRIVERS) -> list[str]:
    """The driver names `lookup` (gdal.GetDriverByName) does not know."""
    return [name for name in names if lookup(name) is None]


def runtime_versions() -> dict[str, str]:
    return {
        "python": platform.python_version(),
        "gdal": gdal.__version__,
        "numpy": numpy.__version__,
        "opencv": cv2.__version__,
    }


class DoctorStep:
    name = "doctor"
    requires_config = False

    def __init__(self, lookup: DriverLookup = gdal.GetDriverByName) -> None:
        self._lookup = lookup

    def run(self, ctx: StepContext) -> Outcome:
        missing = missing_drivers(self._lookup)
        if missing:
            raise StepError(f"GDAL lacks the drivers: {', '.join(missing)}")
        ctx.log.info("runtime ready", extra=fields(**runtime_versions()))
        return Outcome.DONE
