"""A version ready for the `georef` step's matcher, made from the synthetic world through an exact affine map.

`seed_matching` writes what `locate` and `reference` leave behind for a USGS import: the scan (`scan.tif`, the world
sampled through `AffineScan`'s exact map, then degraded as the scenario asks), its corner GCPs (the exact corners
moved by `CORNER_ERROR_M`, as a metadata guess is off), and the job's Sentinel-2 window (the world's, or a cloudy
copy); OpenStreetMap's lines come from the world's Overpass fake. `transform_error_m` measures a fitted transform
against the exact map, so every expectation is about the truth, not about what the matcher happened to find.
"""

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import cv2
import numpy
from hcm_pipeline.geo import fnv1a, ground_scale, to_lnglat
from hcm_pipeline.georef.transforms import Transform
from hcm_pipeline.model import Timestamp
from hcm_pipeline.objects import sha256_of
from hcm_pipeline.rasters import GeoTiff, write_geotiff
from numpy.typing import NDArray

from tests.fakes.world import CITY, ENTITY_ID, JOB_ID, LAYER_ID, NOW, OWNER_UID, PipelineWorld, stamp_of
from tests.synthetic.scenes import CENTRE, AffineScan, World, affine_scan

UInt8Array = NDArray[numpy.uint8]
Degrade = Callable[[UInt8Array], UInt8Array]

S2_OBJECT: Final = f"reference/{CITY}/s2/{fnv1a('synthetic-world')}.tif"
SCAN_OBJECT: Final = f"rasters/{CITY}/{LAYER_ID}/{JOB_ID}/scan.tif"
# What the corner guess gets wrong (east, north, metres), as the scene metadata's corners do.
CORNER_ERROR_M: Final = (240.0, -160.0)
CLOUD_VALUE: Final = 250


def unchanged(pixels: UInt8Array) -> UInt8Array:
    return pixels


def blurred(sigma: float) -> Degrade:
    """A soft scan (a defocused or worn film): Gaussian blur of `sigma` scan pixels."""

    def degrade(pixels: UInt8Array) -> UInt8Array:
        return numpy.asarray(cv2.GaussianBlur(pixels, (0, 0), sigma), numpy.uint8)

    return degrade


def uniform(pixels: UInt8Array) -> UInt8Array:
    """A blank frame: one grey level everywhere."""
    return numpy.full_like(pixels, 128)


def faded(contrast: float) -> Degrade:
    """A faded frame: every grey level pulled towards the middle, to `contrast` of its distance from it."""

    def degrade(pixels: UInt8Array) -> UInt8Array:
        return numpy.asarray(numpy.clip(128 + (pixels.astype(numpy.float64) - 128) * contrast, 0, 255), numpy.uint8)

    return degrade


def overcast(world: World) -> UInt8Array:
    """The world's Sentinel-2 window under cloud from edge to edge: one white level."""
    return numpy.full_like(world.pixels, CLOUD_VALUE)


def _geotiff(path: Path, pixels: UInt8Array, world: World) -> bytes:
    bands = [numpy.asarray(numpy.clip(pixels.astype(numpy.float64) * factor, 0, 255), numpy.uint8) for factor in (0.96, 1.0, 0.9)]
    return write_geotiff(path, GeoTiff(bands, world.grid.geotransform())).read_bytes()


@dataclass(frozen=True)
class Seeded:
    """The scan's exact map and the pixels the version's scan holds."""

    truth: AffineScan
    pixels: UInt8Array


def _corners(truth: AffineScan, width: int, height: int) -> list[dict[str, object]]:
    found = []
    for index, (u, v) in enumerate(((0, 0), (width, 0), (width, height), (0, height)), start=1):
        x, y = truth.to_mercator(u, v)
        lng, lat = to_lnglat(x + CORNER_ERROR_M[0], y + CORNER_ERROR_M[1])
        found.append({"id": f"c{index}", "pixel": {"x": u, "y": v}, "geo": {"lat": lat, "lng": lng}, "enabled": True, "origin": "corner"})
    return found


def seed_matching(
    world: PipelineWorld, folder: Path, degrade: Degrade = unchanged, s2: UInt8Array | None = None, wide: bool = False
) -> Seeded:
    """A USGS import whose `locate` and `reference` are done: the version holds the scan and its corner guess; `wide`: a scan as wide
    as the city's window, which tiles of a proof have room in."""
    world.seed_city()
    truth = affine_scan(world.scene.world, (1500, 1120), (6.4, 0.4, -0.3, -6.4)) if wide else affine_scan(world.scene.world)
    pixels = degrade(truth.pixels)
    height, width = pixels.shape
    local = write_geotiff(folder / "scan.tif", GeoTiff([pixels]))
    world.gcs.put(SCAN_OBJECT, local.read_bytes())
    world.gcs.put(S2_OBJECT, _geotiff(folder / "s2.tif", world.scene.world.pixels if s2 is None else s2, world.scene.world))
    world.seed_job(JOB_ID, "usgs-import", {"entityId": ENTITY_ID, "dataset": "corona2", "sensor": "KH-4A"})
    world.store.update(world.job_path(), {"steps.reference": {"status": "done", "gcsPath": S2_OBJECT}})
    scan = {
        "path": SCAN_OBJECT,
        "width": width,
        "height": height,
        "sha256": sha256_of(local),
        "previewPath": f"rasters/{CITY}/{LAYER_ID}/{JOB_ID}/scan-preview.jpg",
        "previewScale": 1,
    }
    version = {
        "layerId": LAYER_ID,
        "jobId": JOB_ID,
        "origin": "usgs",
        "state": "processing",
        "source": {"kind": "usgs", "entityId": ENTITY_ID, "dataset": "corona2", "sensor": "KH-4A", "acquisitionDate": "1966-07-12"},
        "label": {"ro": "KH-4A Corona, 12 iulie 1966"},
        "year": 1966,
        "scan": scan,
        "georef": {"method": "corners", "transform": "affine", "gcps": _corners(truth, width, height)},
        "createdBy": OWNER_UID,
        "createdAt": Timestamp.at(NOW - 100),
        **stamp_of(NOW - 100),
    }
    world.store.seed(world.version_path(), version)
    return Seeded(truth, pixels)


def transform_error_m(transform: Transform, truth: AffineScan, size: tuple[int, int]) -> tuple[float, float]:
    """The median and the largest ground distance between the fitted transform and the exact map, over the scan."""
    width, height = size
    u, v = numpy.meshgrid(numpy.linspace(0, width, 9), numpy.linspace(0, height, 7))
    fx, fy = transform.to_mercator(u.ravel(), v.ravel())
    a, b, c, d = truth.matrix
    tx, ty = truth.origin[0] + a * u.ravel() + b * v.ravel(), truth.origin[1] + c * u.ravel() + d * v.ravel()
    distance = numpy.hypot(fx - tx, fy - ty) * ground_scale(CENTRE[1])
    return float(numpy.median(distance)), float(distance.max())
