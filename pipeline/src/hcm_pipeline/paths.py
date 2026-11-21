"""Object paths of the private bucket: the Python twin of `RASTER_PATHS` (`packages/shared/src/schemas/imagery-paths.ts`).

Uploads, USGS deliveries, browse copies, a job's scratch files, a layer version's files and the reference cache
(docs/research/M3-interfaces.md §2.7). Every segment is validated, so a malformed id can never climb out of its
prefix; `pipeline/tests/contracts/paths.json` holds the paths both languages must build and refuse.
"""

import re
from typing import Final

from hcm_pipeline.contract import USGS_DATASETS, VERSION_FILES

RASTER_UPLOAD_FILE: Final = re.compile(r"[A-Za-z0-9_-]{8,64}\.tiff?")
CITY_ID: Final = re.compile(r"[a-z0-9-]{2,32}")
ID: Final = re.compile(r"[A-Za-z0-9_-]{1,40}")
UID: Final = re.compile(r"[A-Za-z0-9_-]{1,128}")
DELIVERY_FILE: Final = re.compile(r"\w[\w.-]{0,99}")
WORK_FILE: Final = re.compile(r"[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}(?:/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99})?")
REFERENCE_KEY: Final = re.compile(r"[a-f0-9]{8,64}")
REFERENCE_KINDS: Final = ("s2", "osm", "dem")
# The reference kinds kept as GeoTIFF; OSM is GeoJSON.
RASTER_REFERENCE_KINDS: Final = frozenset({"s2", "dem"})


class PathError(ValueError):
    """A path segment that is not valid where it is used."""


def _segment(value: str, pattern: re.Pattern[str]) -> str:
    if not pattern.fullmatch(value) or ".." in value:
        raise PathError(f"not a valid path segment: {value!r}")
    return value


def _member(value: str, allowed: tuple[str, ...]) -> str:
    if value not in allowed:
        raise PathError(f"not a valid path segment: {value!r}")
    return value


def upload(city_id: str, uid: str, upload_id: str, file_name: str) -> str:
    """`uploads/rasters/{city}/{uid}/{upload}/{nonce}.tif`: a GeoTIFF an admin uploaded."""
    parts = (_segment(city_id, CITY_ID), _segment(uid, UID), _segment(upload_id, ID), _segment(file_name, RASTER_UPLOAD_FILE))
    return "/".join(("uploads/rasters", *parts))


def usgs_raw(dataset: str, entity_id: str, file_name: str) -> str:
    """`usgs-raw/{dataset}/{entityId}/{file}`: a USGS delivery, shared by every city."""
    return "/".join(("usgs-raw", _member(dataset, USGS_DATASETS), _segment(entity_id, ID), _segment(file_name, DELIVERY_FILE)))


def browse(dataset: str, entity_id: str) -> str:
    """`usgs-browse/{dataset}/{entityId}.jpg`: the browse copy the admin previews."""
    return f"usgs-browse/{_member(dataset, USGS_DATASETS)}/{_segment(entity_id, ID)}.jpg"


def work(city_id: str, job_id: str, name: str) -> str:
    """`work/{city}/{job}/{name}`: a job's scratch file (one or two plain segments)."""
    return "/".join(("work", _segment(city_id, CITY_ID), _segment(job_id, ID), _segment(name, WORK_FILE)))


def work_prefix(city_id: str, job_id: str) -> str:
    """`work/{city}/{job}/`: every scratch file of a job (deleted on success and on cancel)."""
    return f"work/{_segment(city_id, CITY_ID)}/{_segment(job_id, ID)}/"


def version(city_id: str, layer_id: str, version_id: str, file: str) -> str:
    """`rasters/{city}/{layer}/{version}/{file}`: one of a layer version's files (`VERSION_FILES`)."""
    parts = (_segment(city_id, CITY_ID), _segment(layer_id, ID), _segment(version_id, ID), _member(file, VERSION_FILES))
    return "/".join(("rasters", *parts))


def reference(city_id: str, kind: str, key: str) -> str:
    """`reference/{city}/{s2|osm|dem}/{key}.{tif|geojson}`: the reference cache by window key."""
    extension = "tif" if _member(kind, REFERENCE_KINDS) in RASTER_REFERENCE_KINDS else "geojson"
    return f"reference/{_segment(city_id, CITY_ID)}/{kind}/{_segment(key, REFERENCE_KEY)}.{extension}"
