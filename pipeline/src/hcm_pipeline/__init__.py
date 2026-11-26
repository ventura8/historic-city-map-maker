"""Historic City Map raster pipeline, run as Cloud Run Jobs: `python -m hcm_pipeline run`.

Steps are short, idempotent and resumable (docs/research/M3-interfaces.md §5): fetch from USGS M2M,
extract, stitch, inspect, locate, reference, georeference, warp, export and register a layer version for
approval; functions publish it to Mapbox afterwards. GDAL comes from the pinned ghcr.io/osgeo/gdal base
image (`osgeo.gdal`), never from a wheel.
"""

import os
import re
from collections.abc import Mapping

# The release the image was built from (`HCM_RELEASE`, set by the installer's `docker build --build-arg`, e.g. 1.0.0-beta.1+a62d85e):
# `worker.hello` reports it and the admin's computer cards show it (live 2026-11-14: every computer said "processing 0.0.0"). A build
# without it (tests, a developer's image) is 0.0.0.
_RELEASE = re.compile(r"[0-9A-Za-z.+-]{1,40}")
UNSTAMPED = "0.0.0"


def release_of(environ: Mapping[str, str]) -> str:
    """The image's release from `environ` (`worker.hello`'s version pattern), else `UNSTAMPED`."""
    value = environ.get("HCM_RELEASE", "")
    return value if _RELEASE.fullmatch(value) else UNSTAMPED


__version__ = release_of(os.environ)
