"""The world of a join: one seeded ground, frames of one date cut from it with known errors in their points (scenario P05).

Each frame is an exact affine scan, so where any scan pixel truly lies is known: a test can ask how far a warp through the plan's
nodes puts it from the truth, and from where the frame's own points put it. The ground is larger than the default scene's, because
what must be seen beyond a seam's taper lies more than 8 km (of EPSG:3857 metres) from the seam.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Final

import cv2
import numpy
import numpy.typing
from hcm_pipeline.contract import SENSOR_SPECS
from hcm_pipeline.documents import GeorefInfo
from hcm_pipeline.geo import FloatArray, MercatorBox, to_lnglat, to_mercator
from hcm_pipeline.model import Timestamp
from hcm_pipeline.objects import sha256_of
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import WEB_MERCATOR, GeoTiff, driver_of, srs_wkt, write_geotiff
from hcm_pipeline.runner import RunOutcome

from tests.fakes.world import CITY, NOW, OWNER_UID, PipelineWorld, stamp_of
from tests.synthetic.scenes import CENTRE, AffineScan, World, affine_scan

JOB: Final = "job-join-1972"
JOIN_LAYER: Final = "kh-4-corona-1972"
DATE: Final = "1972-08-08"
SENSOR: Final = "KH-4"
GROUND_PX: Final = 3200
SCAN_M: Final = 10.0
MATRIX: Final = (SCAN_M, 0.2, -0.15, -SCAN_M)
GCP_GRID: Final = (6, 5)


@dataclass(frozen=True)
class Frame:
    """A frame of the date: where it lies off the ground's middle, what is wrong with its points and how it was printed."""

    name: str
    offset_m: tuple[float, float]
    error_m: tuple[float, float] = (0.0, 0.0)
    gain: float = 1.0
    size: tuple[int, int] = (1600, 1200)
    checkpoint_rmse_m: float | None = 20.0
    checkpoint_count: int = 5

    @property
    def version_id(self) -> str:
        return f"v-{self.name}"

    @property
    def layer_id(self) -> str:
        return f"layer-{self.name}"

    @property
    def entity_id(self) -> str:
        return f"D3C1202-{self.name}"

    @property
    def scan_path(self) -> str:
        return f"rasters/{CITY}/{self.layer_id}/{self.version_id}/scan.tif"

    def scan(self, ground: World) -> AffineScan:
        return affine_scan(ground, self.size, MATRIX, self.offset_m, self.gain)


def _gcps(frame: Frame, scan: AffineScan) -> list[dict[str, object]]:
    """A grid of points whose places carry the frame's error, as a georeferencer's fit would leave them."""
    gcps = []
    columns, rows = GCP_GRID
    for row in range(rows):
        for column in range(columns):
            u, v = frame.size[0] * (column + 0.5) / columns, frame.size[1] * (row + 0.5) / rows
            x, y = scan.to_mercator(u, v)
            lng, lat = to_lnglat(x + frame.error_m[0], y + frame.error_m[1])
            gcp = {"id": f"g{row}{column}", "pixel": {"x": u, "y": v}, "geo": {"lat": lat, "lng": lng}, "enabled": True, "origin": "auto"}
            gcps.append(gcp)
    return gcps


def _georef(frame: Frame, scan: AffineScan) -> dict[str, object]:
    figures = {"checkpointRmseM": frame.checkpoint_rmse_m} if frame.checkpoint_rmse_m is not None else {}
    return {
        "method": "auto",
        "transform": "poly2",
        "gcps": _gcps(frame, scan),
        "fitRmseM": 1.0,
        "checkpointCount": frame.checkpoint_count,
        **figures,
    }


def seed_part(world: PipelineWorld, tmp: Path, frame: Frame, pixels: numpy.typing.NDArray[numpy.uint8], scan: AffineScan) -> None:
    """A frame's version awaiting approval and its stored scan."""
    local = write_geotiff(tmp / f"{frame.name}.tif", GeoTiff([pixels]))
    world.gcs.put(frame.scan_path, local.read_bytes())
    world.store.seed(world.version_path(frame.version_id), part_record(frame, pixels, scan, sha256_of(local)))


def part_record(frame: Frame, pixels: numpy.typing.NDArray[numpy.uint8], scan: AffineScan, sha256: str) -> dict[str, object]:
    height, width = pixels.shape
    prefix = f"rasters/{CITY}/{frame.layer_id}/{frame.version_id}"
    source = {"kind": "usgs", "entityId": frame.entity_id, "dataset": "corona2", "sensor": SENSOR, "acquisitionDate": DATE}
    return {
        "layerId": frame.layer_id,
        "jobId": f"job-{frame.name}",
        "origin": "usgs",
        "state": "awaiting_approval",
        "source": source,
        "label": {"ro": frame.name},
        "year": 1972,
        "date": DATE,
        "sensor": SENSOR,
        "partOf": JOB,
        "scan": {
            "path": frame.scan_path,
            "width": width,
            "height": height,
            "sha256": sha256,
            "previewPath": f"{prefix}/scan-preview.jpg",
            "previewScale": 1,
        },
        "georef": _georef(frame, scan),
        "createdBy": OWNER_UID,
        "createdAt": Timestamp.at(NOW - 500),
        **stamp_of(NOW - 500),
    }


def city_of(half_m: tuple[float, float]) -> dict[str, float]:
    cx, cy = to_mercator(*CENTRE)
    return MercatorBox(cx - half_m[0], cy - half_m[1], cx + half_m[0], cy + half_m[1]).bounds().as_record()


def seed_city(world: PipelineWorld, half_m: tuple[float, float]) -> None:
    city = {"name": {"ro": "București", "en": "Bucharest"}, "bounds": city_of(half_m), "published": True, **stamp_of(NOW - 9000)}
    world.store.seed(f"cities/{CITY}", city)


def seed_join(world: PipelineWorld, frames: list[Frame], status: str = "starting", archive: bool = False) -> None:
    """The join's job and version, as `imagery.join` leaves them once its parts are ready (`archive`: an archive maps' join, which
    names no camera, only its `maxzoom`)."""
    parts = [{"versionId": frame.version_id, "layerId": frame.layer_id} for frame in frames]
    camera: dict[str, object] = {"maxzoom": SENSOR_SPECS[SENSOR].maxzoom} if archive else {"sensor": SENSOR}
    world.seed_job(JOB, "layer-join", {"parts": parts, **camera}, status, JOIN_LAYER)
    source_parts = [
        {
            "versionId": frame.version_id,
            "layerId": frame.layer_id,
            "entityId": frame.entity_id,
            "dataset": "corona2",
            "sensor": SENSOR,
            "acquisitionDate": DATE,
        }
        for frame in frames
    ]
    version = {
        "layerId": JOIN_LAYER,
        "jobId": JOB,
        "origin": "join",
        "state": "processing",
        "source": {"kind": "join", "parts": source_parts},
        "label": {"ro": "KH-4 Corona, 8 august 1972"},
        "year": 1972,
        "date": DATE,
        "sensor": SENSOR,
        "createdBy": OWNER_UID,
        "createdAt": Timestamp.at(NOW - 100),
        **stamp_of(NOW - 100),
    }
    world.store.seed(world.version_path(JOB), version)


def seed_frames(world: PipelineWorld, tmp: Path, ground: World, frames: list[Frame], half_m: tuple[float, float]) -> None:
    """The city, every frame and the join."""
    seed_parts(world, tmp, ground, frames, half_m)
    seed_join(world, frames)


def seed_parts(world: PipelineWorld, tmp: Path, ground: World, frames: list[Frame], half_m: tuple[float, float]) -> None:
    """The city and every frame, no join yet."""
    seed_city(world, half_m)
    for frame in frames:
        scan = frame.scan(ground)
        seed_part(world, tmp, frame, scan.pixels, scan)


def run_join(world: PipelineWorld) -> RunOutcome:
    return world.runner(replace(world.config, job_id=JOB)).run()


def pixels_of(scan: AffineScan, x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray]:
    """The scan pixel that truly shows a place."""
    a, b, c, d = scan.matrix
    east, north = x - scan.origin[0], y - scan.origin[1]
    determinant = a * d - b * c
    return (d * east - b * north) / determinant, (a * north - c * east) / determinant


def wobbled(
    pixels: numpy.typing.NDArray[numpy.uint8], amplitude_px: float, period_px: float, phase_px: float
) -> numpy.typing.NDArray[numpy.uint8]:
    """The scan with each row slid sideways along a sine: an error no smooth correction of its points can follow."""
    height, width = pixels.shape
    u, v = numpy.meshgrid(numpy.arange(width, dtype=numpy.float32), numpy.arange(height, dtype=numpy.float32))
    slide = amplitude_px * numpy.sin(2.0 * numpy.pi * (v - phase_px) / period_px)
    return numpy.asarray(
        cv2.remap(pixels, u + slide.astype(numpy.float32), v, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE), numpy.uint8
    )


def node_transform(
    nodes: Sequence[Sequence[float]], size: tuple[int, int]
) -> Callable[[FloatArray, FloatArray], tuple[FloatArray, FloatArray]]:
    """Where a warp through the plan's nodes puts a scan pixel (the thin-plate spline GDAL fits through them)."""
    dataset = driver_of("MEM").Create("", size[0], size[1], 0)
    dataset.SetGCPs([gdal.GCP(x, y, 0.0, u, v) for u, v, x, y in nodes], srs_wkt(WEB_MERCATOR))
    transformer = gdal.Transformer(dataset, None, ["METHOD=GCP_TPS", "DST_SRS=EPSG:3857"])

    def apply(u: FloatArray, v: FloatArray) -> tuple[FloatArray, FloatArray]:
        points, _ = transformer.TransformPoints(0, numpy.column_stack((u, v)).tolist())
        found = numpy.array(points, numpy.float64)
        return found[:, 0], found[:, 1]

    return apply


def georef_of(frame: Frame, ground: World) -> GeorefInfo:
    scan = frame.scan(ground)
    return GeorefInfo.of(_georef(frame, scan))
