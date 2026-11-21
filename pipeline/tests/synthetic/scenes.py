"""Synthetic USGS scenes with a known georeference (docs/research/M3-interfaces.md §5.8; testability review §3.6).

A seeded EPSG:3857 world near Bucharest (textured ground, roads of several widths, a river, parks, blocks), its
Sentinel-2-like true-colour GeoTIFF and its OpenStreetMap-like features; a film frame made from it by inverse
warp through a ground-truth transform (projective, a panoramic term, the camera's rotation and mirror), with a
film border, split into overlapping segments and packed as a `.tgz` the way USGS delivers; and metadata corners
deliberately offset. Nothing is downloaded or committed: tests build scenes in a temporary folder, and

    PYTHONPATH=pipeline/src python pipeline/tests/synthetic/scenes.py --out DIR --seed N

writes them for the e2e mock servers (`truth.json` holds the transform and the tolerance the e2e-fakes assert).
"""

import argparse
import io
import json
import math
import sys
import tarfile
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Final

import cv2
import numpy
from hcm_pipeline.geo import Grid, MercatorBox, to_lnglat, to_lnglat_arrays, to_mercator
from hcm_pipeline.georef.corners import apply, homography
from hcm_pipeline.rasters import GeoTiff, write_geotiff
from numpy.typing import NDArray

UInt8Array = NDArray[numpy.uint8]
FloatArray = NDArray[numpy.float64]
CENTRE: Final = (26.10, 44.43)
WORLD_PX: Final = 1024
WORLD_RESOLUTION_M: Final = 10.0
BORDER_PX: Final = 20
BORDER_VALUE: Final = 6
SEGMENT_OVERLAP_PX: Final = 300
ROAD_VALUE: Final = 235
RIVER_VALUE: Final = 35
ROADS_PER_WORLD: Final = 14
BLOCKS_PER_WORLD: Final = 420
PARKS_PER_WORLD: Final = 7
# What the corner metadata gets wrong (east, north, metres): the corner guess must not need exact corners.
CORNER_OFFSET_M: Final = (240.0, -160.0)
EXPECTED_RMSE_M: Final = 15.0
# `--join`: the entities of a date's two frames (the first is the default scene's), their size and how far each lies off the middle.
JOIN_ENTITIES: Final = ("DS1035-1057DA023", "DS1035-1057DA024")
JOIN_FRAME_PX: Final = (1000, 1100)
JOIN_OFFSET_M: Final = 1500.0
# The scanner's edge band of `scanner_edges`: its outer and its inner grey level.
KH7_EDGE_VALUES: Final = (250.0, 205.0)


@dataclass(frozen=True)
class SceneSpec:
    """A synthetic frame: its size, ground resolution, orientation, distortion and the seed of everything random."""

    seed: int = 7
    width: int = 1500
    height: int = 1100
    resolution_m: float = 6.6
    rotation_deg: float = 3.0
    flipped: bool = False
    mirrored: bool = False
    pan_m: float = 18.0
    segments: int = 2
    entity_id: str = "DS1035-1057DA023"
    # Where the frame's centre lies from the world's (east, north, EPSG:3857 metres): several frames of one date over one world.
    centre_offset_m: tuple[float, float] = (0.0, 0.0)
    # The film scanned right to left with the scanner's bright edges, as the 1966 KH-7 strip's delivery (lesson 645).
    right_to_left: bool = False


@dataclass(frozen=True)
class Truth:
    """The ground truth of a scene: the content's four corners in EPSG:3857 (top-left first) and the panoramic term."""

    corners: list[tuple[float, float]]
    pan_m: float
    width: int
    height: int
    flipped: bool
    mirrored: bool
    border_px: int = BORDER_PX
    expected_rmse_m: float = EXPECTED_RMSE_M
    world: dict[str, float] = field(default_factory=dict)


def world_grid(size_px: int = WORLD_PX) -> Grid:
    cx, cy = to_mercator(*CENTRE)
    half = size_px * WORLD_RESOLUTION_M / 2
    return Grid.over(MercatorBox(cx - half, cy - half, cx + half, cy + half), WORLD_RESOLUTION_M)


def _texture(rng: numpy.random.Generator, size_px: int) -> FloatArray:
    texture = numpy.zeros((size_px, size_px))
    for sigma, weight in ((1.5, 0.35), (5.0, 0.4), (18.0, 0.6)):
        noise = rng.normal(0, 1, (size_px, size_px))
        blurred = cv2.GaussianBlur(noise, (0, 0), sigma)
        texture += weight * blurred / max(float(blurred.std()), 1e-9)
    return 120 + 22 * texture


def _roads(rng: numpy.random.Generator, size_px: int) -> list[tuple[list[tuple[float, float]], int]]:
    """Polylines in world pixels with their widths: straight avenues at random angles and a few bent streets."""
    lines = []
    for _ in range(ROADS_PER_WORLD * size_px // WORLD_PX):
        x0, y0 = rng.uniform(0, size_px, 2)
        angle = rng.uniform(0, math.pi)
        dx, dy = math.cos(angle) * size_px, math.sin(angle) * size_px
        bend = rng.uniform(-60, 60, 2)
        points = [(x0 - dx, y0 - dy), (x0 + bend[0], y0 + bend[1]), (x0 + dx, y0 + dy)]
        lines.append((points, int(rng.integers(1, 5))))
    return lines


def _river(size_px: int) -> list[tuple[float, float]]:
    columns = numpy.linspace(-20, size_px + 20, 80 * size_px // WORLD_PX)
    rows = size_px * 0.62 + 70 * numpy.sin(columns / 110.0) + 25 * numpy.sin(columns / 37.0)
    return list(zip(columns.tolist(), rows.tolist(), strict=True))


def _draw(image: FloatArray, points: Sequence[tuple[float, float]], value: float, width: int) -> None:
    polyline = numpy.array([[round(x * 4), round(y * 4)] for x, y in points], numpy.int32)
    cv2.polylines(image, [polyline], False, value, width, cv2.LINE_AA, 2)


def _blocks(image: FloatArray, rng: numpy.random.Generator) -> None:
    size_px = image.shape[0]
    area = (size_px / WORLD_PX) ** 2
    for _ in range(round(BLOCKS_PER_WORLD * area)):
        x, y = rng.integers(0, size_px - 10, 2)
        w, h = rng.integers(3, 9, 2)
        image[y : y + h, x : x + w] = rng.uniform(170, 225)
    for _ in range(round(PARKS_PER_WORLD * area)):
        centre = (int(rng.integers(80, size_px - 80)), int(rng.integers(80, size_px - 80)))
        axes = (int(rng.integers(20, 55)), int(rng.integers(15, 40)))
        cv2.ellipse(image, centre, axes, float(rng.uniform(0, 180)), 0, 360, 85, -1)


@dataclass(frozen=True)
class World:
    grid: Grid
    pixels: UInt8Array
    roads: list[tuple[list[tuple[float, float]], int]]
    river: list[tuple[float, float]]


def render_world(seed: int, size_px: int = WORLD_PX) -> World:
    rng = numpy.random.default_rng(seed)
    image = _texture(rng, size_px)
    _blocks(image, rng)
    roads = _roads(rng, size_px)
    for points, width in roads:
        _draw(image, points, ROAD_VALUE, width)
    river = _river(size_px)
    _draw(image, river, RIVER_VALUE, 9)
    return World(world_grid(size_px), numpy.asarray(numpy.clip(image, 0, 255), numpy.uint8), roads, river)


def write_sentinel2(world: World, path: Path) -> Path:
    """The world as a 3-band true-colour GeoTIFF in EPSG:3857 at 10 m (what the STAC item's `visual` asset serves)."""
    pixels = world.pixels.astype(numpy.float64)
    bands = [numpy.asarray(numpy.clip(pixels * factor, 0, 255), numpy.uint8) for factor in (0.96, 1.0, 0.9)]
    return write_geotiff(
        path, GeoTiff(bands, world.grid.geotransform()), ("COMPRESS=DEFLATE", "TILED=YES", "BLOCKXSIZE=256", "BLOCKYSIZE=256")
    )


def _lnglat_line(world: World, points: Sequence[tuple[float, float]]) -> list[list[float]]:
    u, v = numpy.array(points, numpy.float64).T
    lng, lat = to_lnglat_arrays(*world.grid.to_mercator(u, v))
    return [[round(x, 7), round(y, 7)] for x, y in zip(lng.tolist(), lat.tolist(), strict=True)]


def overpass_answer(world: World) -> dict[str, object]:
    """The world's roads and river as an Overpass `out geom` answer (ways with their geometry)."""
    elements: list[dict[str, object]] = []
    for index, (points, width) in enumerate(world.roads, start=1):
        tags = {"highway": "primary" if width >= 3 else "residential"}
        elements.append({"type": "way", "id": index, "tags": tags, "geometry": _geometry(world, points)})
    elements.append({"type": "way", "id": 900, "tags": {"waterway": "river"}, "geometry": _geometry(world, world.river)})
    return {"version": 0.6, "elements": elements}


def _geometry(world: World, points: Sequence[tuple[float, float]]) -> list[dict[str, float]]:
    return [{"lat": lat, "lon": lng} for lng, lat in _lnglat_line(world, points)]


def truth_for(spec: SceneSpec) -> Truth:
    """The frame's ground-truth corners: a rotated, slightly skewed rectangle around the world's centre."""
    rng = numpy.random.default_rng(spec.seed + 1)
    cx, cy = to_mercator(*CENTRE)
    cx, cy = cx + spec.centre_offset_m[0], cy + spec.centre_offset_m[1]
    half_w, half_h = spec.width * spec.resolution_m / 2, spec.height * spec.resolution_m / 2
    angle = math.radians(spec.rotation_deg)
    corners = []
    for sx, sy in ((-1, 1), (1, 1), (1, -1), (-1, -1)):
        jitter = rng.uniform(-50, 50, 2)
        x, y = sx * half_w + jitter[0], sy * half_h + jitter[1]
        corners.append((cx + x * math.cos(angle) - y * math.sin(angle), cy + x * math.sin(angle) + y * math.cos(angle)))
    return Truth(corners, spec.pan_m, spec.width, spec.height, spec.flipped, spec.mirrored)


def _homography(truth: Truth) -> FloatArray:
    source = numpy.array([[0, 0], [1, 0], [1, 1], [0, 1]], numpy.float64)
    return homography(source, numpy.array(truth.corners, numpy.float64))


def true_mercator(truth: Truth, u: FloatArray, v: FloatArray) -> tuple[FloatArray, FloatArray]:
    """The ground truth: content pixel (corner convention) of the stored film to EPSG:3857 metres."""
    s, t = u / truth.width, v / truth.height
    s = 1 - s if truth.flipped != truth.mirrored else s
    t = 1 - t if truth.flipped else t
    x, y = apply(_homography(truth), s, t)
    return x + truth.pan_m * (4 * (s - 0.5) ** 2 - 1 / 3), y


def render_frame(world: World, truth: Truth) -> UInt8Array:
    """The film frame: the world sampled through the truth, with a film border around it."""
    u, v = numpy.meshgrid(numpy.arange(truth.width) + 0.5, numpy.arange(truth.height) + 0.5)
    mx, my = true_mercator(truth, u.astype(numpy.float64), v.astype(numpy.float64))
    gx, gy = world.grid.to_pixel(mx, my)
    content = cv2.remap(world.pixels, (gx - 0.5).astype(numpy.float32), (gy - 0.5).astype(numpy.float32), cv2.INTER_LINEAR, borderValue=128)
    grain = numpy.random.default_rng(3).normal(0, 3, content.shape)
    frame = numpy.full((truth.height + 2 * BORDER_PX, truth.width + 2 * BORDER_PX), BORDER_VALUE, numpy.float64)
    frame[BORDER_PX:-BORDER_PX, BORDER_PX:-BORDER_PX] = content + grain
    return numpy.asarray(numpy.clip(frame, 0, 255), numpy.uint8)


def split_segments(frame: UInt8Array, count: int) -> list[UInt8Array]:
    """Overlapping vertical strips, left to right (USGS's `_a`, `_b`, ... files)."""
    width = frame.shape[1]
    step = (width + (count - 1) * SEGMENT_OVERLAP_PX) // count
    starts = [index * (step - SEGMENT_OVERLAP_PX) for index in range(count)]
    return [frame[:, start : min(width, start + step) if index < count - 1 else width] for index, start in enumerate(starts)]


def scanner_edges(frame: UInt8Array, width: int = 9) -> UInt8Array:
    """`frame` with the scanner's bright edge band at both its outer ends (white fading to light grey inwards), as the 1966 KH-7
    strip's scan holds them (lesson 645: the band runs about 240 px of 35 596)."""
    ramp = numpy.linspace(KH7_EDGE_VALUES[0], KH7_EDGE_VALUES[1], width)
    band = numpy.broadcast_to(ramp, (frame.shape[0], width))
    return numpy.ascontiguousarray(numpy.hstack((band, frame, band[:, ::-1])).astype(numpy.uint8))


def kh7_segments(frame: UInt8Array) -> list[UInt8Array]:
    """The 1966 KH-7 strip's delivery (lesson 645): two overlapping halves lettered in the film's order, right to left: `_a` is
    the right half, `_b` the left one."""
    return [numpy.ascontiguousarray(part) for part in split_segments(frame, 2)[::-1]]


def _tiff_bytes(path: Path, pixels: UInt8Array) -> bytes:
    """The pixels as a plain TIFF's bytes (the file is only a stepping stone into the archive)."""
    write_geotiff(path, GeoTiff([pixels]), ("COMPRESS=DEFLATE",))
    data = path.read_bytes()
    path.unlink()
    return data


def pack_delivery(segments: Sequence[UInt8Array], entity_id: str, folder: Path) -> Path:
    """The segments as `{entity}_a.tif`, `{entity}_b.tif`, ... in a gzipped tar, with a text member to skip."""
    archive = folder / f"{entity_id}.tgz"
    with tarfile.open(archive, "w:gz") as tar:
        for index, pixels in enumerate(segments):
            data = _tiff_bytes(folder / f"segment-{index}.tif", pixels)
            member = tarfile.TarInfo(f"{entity_id}/{entity_id}_{chr(ord('a') + index)}.tif")
            member.size = len(data)
            tar.addfile(member, io.BytesIO(data))
        notes = b"synthetic delivery\n"
        text = tarfile.TarInfo(f"{entity_id}/README.txt")
        text.size = len(notes)
        tar.addfile(text, io.BytesIO(notes))
    return archive


def metadata_corners(truth: Truth) -> dict[str, dict[str, float]]:
    """The scene's corners as USGS lists them (north-west first), offset by `CORNER_OFFSET_M`."""
    lnglat = [to_lnglat(x + CORNER_OFFSET_M[0], y + CORNER_OFFSET_M[1]) for x, y in truth.corners]
    by_north = sorted(lnglat, key=lambda place: -place[1])
    nw, ne = sorted(by_north[:2])
    sw, se = sorted(by_north[2:])
    return {name: {"lat": round(lat, 7), "lng": round(lng, 7)} for name, (lng, lat) in (("nw", nw), ("ne", ne), ("se", se), ("sw", sw))}


@dataclass(frozen=True)
class Scene:
    """Every file of a synthetic scene and the documents that describe it."""

    folder: Path
    spec: SceneSpec
    truth: Truth
    world: World
    sentinel2: Path
    delivery: Path
    overpass: dict[str, object]
    corners: dict[str, dict[str, float]]


DEFAULT_SPEC: Final = SceneSpec()


def build_scene(folder: Path, spec: SceneSpec = DEFAULT_SPEC) -> Scene:
    folder.mkdir(parents=True, exist_ok=True)
    world = render_world(spec.seed)
    truth = truth_for(spec)
    frame = render_frame(world, truth)
    parts = kh7_segments(scanner_edges(frame)) if spec.right_to_left else split_segments(frame, spec.segments)
    delivery = pack_delivery(parts, spec.entity_id, folder)
    return Scene(
        folder,
        spec,
        truth,
        world,
        write_sentinel2(world, folder / "sentinel2.tif"),
        delivery,
        overpass_answer(world),
        metadata_corners(truth),
    )


@dataclass(frozen=True)
class AffineScan:
    """A scan made from the world through an exact affine map: scan pixel (corner convention) to EPSG:3857."""

    pixels: UInt8Array
    origin: tuple[float, float]
    matrix: tuple[float, float, float, float]

    def to_mercator(self, u: float, v: float) -> tuple[float, float]:
        a, b, c, d = self.matrix
        return self.origin[0] + a * u + b * v, self.origin[1] + c * u + d * v

    def to_lnglat(self, u: float, v: float) -> tuple[float, float]:
        return to_lnglat(*self.to_mercator(u, v))


def affine_scan(
    world: World,
    size: tuple[int, int] = (1200, 900),
    matrix: tuple[float, float, float, float] = (6.0, 0.4, -0.3, -6.0),
    centre_offset_m: tuple[float, float] = (0.0, 0.0),
    gain: float = 1.0,
) -> AffineScan:
    """A scan through an exact affine map (its GCPs then fit with no residual) of the world's middle, or `centre_offset_m` (east, north)
    from it, its grey levels through `gain`: another frame of the same date, printed differently."""
    width, height = size
    centre_x, centre_y = to_mercator(*CENTRE)
    centre_x, centre_y = centre_x + centre_offset_m[0], centre_y + centre_offset_m[1]
    a, b, c, d = matrix
    origin = (centre_x - (a * width + b * height) / 2, centre_y - (c * width + d * height) / 2)
    u, v = numpy.meshgrid(numpy.arange(width) + 0.5, numpy.arange(height) + 0.5)
    gx, gy = world.grid.to_pixel(origin[0] + a * u + b * v, origin[1] + c * u + d * v)
    pixels = cv2.remap(world.pixels, (gx - 0.5).astype(numpy.float32), (gy - 0.5).astype(numpy.float32), cv2.INTER_LINEAR)
    return AffineScan(numpy.asarray(numpy.clip(pixels * gain, 0, 255), numpy.uint8), origin, matrix)


def write_truth(scene: Scene) -> Path:
    path = scene.folder / "truth.json"
    record = {"spec": asdict(scene.spec), "truth": asdict(scene.truth), "corners": scene.corners}
    path.write_text(json.dumps(record, indent=2), encoding="utf-8")
    (scene.folder / "overpass.json").write_text(json.dumps(scene.overpass), encoding="utf-8")
    return path


def join_specs(seed: int) -> tuple[SceneSpec, SceneSpec]:
    """Two frames of one date over one world, side by side with a third of a frame in common: what `--join` writes."""
    width, height = JOIN_FRAME_PX
    west = SceneSpec(seed, width, height, entity_id=JOIN_ENTITIES[0], centre_offset_m=(-JOIN_OFFSET_M, 0.0))
    return west, SceneSpec(seed, width, height, entity_id=JOIN_ENTITIES[1], centre_offset_m=(JOIN_OFFSET_M, 0.0))


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write a synthetic USGS scene and its references.")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=SceneSpec.seed)
    parser.add_argument("--join", action="store_true", help="two overlapping frames of one date, each in its entity's folder")
    args = parser.parse_args(argv)
    specs = join_specs(args.seed) if args.join else (SceneSpec(seed=args.seed),)
    for spec in specs:
        write_truth(build_scene(args.out / spec.entity_id if args.join else args.out, spec))
    return 0


if __name__ == "__main__":
    sys.exit(main())
