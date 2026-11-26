"""The one import point of GDAL: `from hcm_pipeline.raster import gdal, osr`.

GDAL's Python bindings report errors through return codes unless exceptions are enabled (GDAL 4
makes exceptions the default). Every module takes the bindings from here, already switched to
exceptions, so a failed open or write raises RuntimeError instead of returning None. The bindings
come from the ghcr.io/osgeo/gdal base image (`--system-site-packages` venv), never from a wheel.
"""

from osgeo import gdal, osr

__all__ = ["gdal", "osr"]

gdal.UseExceptions()
osr.UseExceptions()
