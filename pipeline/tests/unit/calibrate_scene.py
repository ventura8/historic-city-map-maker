"""Synthetic frames with a known map for `calibrate/`: any latitude, any error of the metadata, any orientation (M9 §10)."""

import math
from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import Final

import cv2
import numpy
from hcm_pipeline.calibrate.chain import Found, FrameSearch, find_frame
from hcm_pipeline.calibrate.ports import NullProposalMatcher, ProposalMatcher
from hcm_pipeline.calibrate.prior import MeasuredModel
from hcm_pipeline.contract import SearchRange
from hcm_pipeline.geo import FloatArray, Grid, MercatorBox, ground_scale, to_lnglat, to_mercator
from hcm_pipeline.georef.corners import Frame, apply, first_guesses, reaching
from hcm_pipeline.images import UInt8Array, as_uint8, resize

from tests.synthetic.scenes import render_world

WORLD_SIDE_PX: Final = 2048
FILM_SIZE: Final = (1400, 1000)
SHRINK: Final = 3
SEARCH: Final = SearchRange(15_000.0, (1.0,))
LatLng = tuple[float, float]


class ArrayReader:
    """A film as an array, read by windows and averaged, as the segments are."""

    def __init__(self, film: UInt8Array) -> None:
        self.film = film
        self.reads = 0

    def read(self, box: tuple[int, int, int, int], factor: int) -> UInt8Array:
        self.reads += 1
        part = self.film[box[1] : box[3], box[0] : box[2]]
        return resize(part, ((box[2] - box[0]) // factor, (box[3] - box[1]) // factor)) if factor > 1 else part


@dataclass(frozen=True)
class Scene:
    """A place's reference and a film of it: `truth`, its true map; `quad`, the metadata's corners, `error_m` (EPSG:3857) off."""

    reference: UInt8Array
    grid: Grid
    film: UInt8Array
    truth: FloatArray
    quad: tuple[LatLng, LatLng, LatLng, LatLng]

    @property
    def size(self) -> tuple[int, int]:
        return self.film.shape[1], self.film.shape[0]

    def ground(self) -> float:
        return ground_scale(self.grid.box().bounds().middle_lat)


@dataclass(frozen=True)
class Shot:
    """How a film is taken: where, its pixel in ground metres, turned and offset; `window_share`: how much of the ground the window is."""

    lat: float = 44.43
    lng: float = 26.10
    pixel_ground_m: float = 9.0
    rotation_deg: float = 2.0
    error_ground_m: tuple[float, float] = (4000.0, -3000.0)
    seed: int = 7
    turned: int = 0
    mirrored: bool = False
    film_centre_ground_m: tuple[float, float] = (0.0, 0.0)
    shear_deg: float = 0.0


def _place_grid(lat: float, lng: float, side_px: int) -> Grid:
    cx, cy = to_mercator(lng, lat)
    half = side_px * 10.0 / 2
    return Grid.over(MercatorBox(cx - half, cy - half, cx + half, cy + half), 10.0)


def _matrix(shot: Shot, centre: tuple[float, float], ground: float) -> FloatArray:
    """Film pixels to EPSG:3857: a turned, optionally mirrored square-pixel film around `centre`."""
    width, height = FILM_SIZE
    scale = shot.pixel_ground_m / ground
    angle = math.radians(shot.rotation_deg + 90 * shot.turned)
    cos, sin = math.cos(angle) * scale, math.sin(angle) * scale
    flip = -1.0 if shot.mirrored else 1.0
    a, b, c, d = flip * cos, sin, flip * sin, -cos
    return numpy.array(
        [[a, b, centre[0] - a * width / 2 - b * height / 2], [c, d, centre[1] - c * width / 2 - d * height / 2], [0.0, 0.0, 1.0]]
    )


def _sheared(matrix: FloatArray, centre: tuple[float, float], shear_deg: float) -> FloatArray:
    """The film as a parallelogram: its long side as it was, its short side turned on the ground towards the long side's north end."""
    along = matrix[:2, 0] / numpy.linalg.norm(matrix[:2, 0])
    along = along if along[1] >= 0 else -along
    linear = numpy.eye(2) + math.tan(math.radians(shear_deg)) * numpy.outer(along, [along[1], -along[0]])
    move = numpy.eye(3)
    move[:2, :2] = linear
    move[:2, 2] = numpy.array(centre) - linear @ numpy.array(centre)
    return numpy.asarray(move @ matrix, numpy.float64)


def _film_of(pixels: UInt8Array, grid: Grid, truth: FloatArray) -> UInt8Array:
    u, v = numpy.meshgrid(numpy.arange(FILM_SIZE[0], dtype=numpy.float64) + 0.5, numpy.arange(FILM_SIZE[1], dtype=numpy.float64) + 0.5)
    gx, gy = grid.to_pixel(*apply(truth, u, v))
    film = cv2.remap(pixels, (gx - 0.5).astype(numpy.float32), (gy - 0.5).astype(numpy.float32), cv2.INTER_LINEAR, borderValue=128)
    grain = numpy.random.default_rng(5).normal(0, 4, film.shape)
    return as_uint8(numpy.clip(film + grain, 0, 255))


def _quad(truth: FloatArray, error: tuple[float, float]) -> tuple[LatLng, LatLng, LatLng, LatLng]:
    """The film's corners as metadata lists them, north-west first and clockwise."""
    x = numpy.array([0.0, FILM_SIZE[0], FILM_SIZE[0], 0.0])
    y = numpy.array([0.0, 0.0, FILM_SIZE[1], FILM_SIZE[1]])
    mx, my = apply(truth, x, y)
    places = sorted(zip((mx + error[0]).tolist(), (my + error[1]).tolist(), strict=True), key=lambda place: -place[1])
    top = sorted(places[:2])
    bottom = sorted(places[2:])
    ordered = [top[0], top[1], bottom[1], bottom[0]]
    corners = [to_lnglat(*place) for place in ordered]
    return (corners[0][1], corners[0][0]), (corners[1][1], corners[1][0]), (corners[2][1], corners[2][0]), (corners[3][1], corners[3][0])


def scene_of(given: Shot | None = None) -> Scene:
    """A world around (`lat`, `lng`), a window of its middle, and a film of it through a known map."""
    shot = given or Shot()
    ground = ground_scale(shot.lat)
    side = WORLD_SIDE_PX if ground > 0.6 else 2 * WORLD_SIDE_PX
    world = render_world(shot.seed, side)
    grid = _place_grid(shot.lat, shot.lng, side)
    centre = grid.left + side * 5.0 + shot.film_centre_ground_m[0] / ground, grid.top - side * 5.0 + shot.film_centre_ground_m[1] / ground
    rectangle = _matrix(shot, centre, ground)
    truth = _sheared(rectangle, centre, shot.shear_deg)
    error = shot.error_ground_m[0] / ground, shot.error_ground_m[1] / ground
    margin = round(side * 0.2)
    window = Grid(grid.left + margin * 10.0, grid.top - margin * 10.0, 10.0, side - 2 * margin, side - 2 * margin)
    reference = world.pixels[margin : side - margin, margin : side - margin]
    return Scene(reference, window, _film_of(world.pixels, grid, truth), truth, _quad(rectangle, error))


def elsewhere(scene: Scene, seed: int = 99) -> Scene:
    """The same film over a reference of another place."""
    side = scene.reference.shape[0]
    return replace(scene, reference=render_world(seed, side).pixels)


def search_of(
    scene: Scene,
    prior: MeasuredModel | None = None,
    matcher: ProposalMatcher | None = None,
    search: SearchRange = SEARCH,
) -> FrameSearch:
    """The chain's input for `scene`, as `locate` builds it."""
    width, height = scene.size
    frame = Frame(resize(scene.film, (width // SHRINK, height // SHRINK)), float(SHRINK), width, height)
    firsts = first_guesses(frame, scene.quad, scene.grid.box(), None)
    reached = reaching(frame, firsts, scene.grid.scaled(6), search.margin_ground_m)
    return FrameSearch(
        frame,
        tuple(each for each, _ in reached),
        scene.reference,
        scene.grid,
        ArrayReader(scene.film),
        (width, height, 0),
        search,
        None,
        "KH-9-mapping",
        7,
        prior,
        matcher=matcher or NullProposalMatcher(),
    )


def nothing() -> None:
    """A checkpoint that never stops."""


def run(scene: Scene, lines: list[str] | None = None, prior: MeasuredModel | None = None, matcher: ProposalMatcher | None = None) -> Found:
    collected = [] if lines is None else lines
    return find_frame(search_of(scene, prior, matcher), nothing, collected.append)


def film_points(scene: Scene) -> FloatArray:
    """Film points of the part of the frame inside the window."""
    u, v = numpy.meshgrid(numpy.linspace(0, scene.size[0], 15), numpy.linspace(0, scene.size[1], 11))
    film = numpy.column_stack((u.ravel(), v.ravel()))
    mx, my = apply(scene.truth, film[:, 0], film[:, 1])
    box = scene.grid.box()
    inside = (mx > box.left) & (mx < box.right) & (my > box.bottom) & (my < box.top)
    return numpy.asarray(film[inside], numpy.float64)


def map_error_ground_m(scene: Scene, found: Found) -> float:
    """The worst ground error of the proved map against the truth, over the window."""
    assert found.proof is not None
    assert found.proof.mapping is not None
    film = film_points(scene)
    mapped = found.proof.mapping.to_places(film)
    truth_x, truth_y = apply(scene.truth, film[:, 0], film[:, 1])
    return float(numpy.hypot(mapped[:, 0] - truth_x, mapped[:, 1] - truth_y).max()) * scene.ground()


def orientation_of(found: Found) -> Sequence[int | bool] | None:
    return None if found.model is None else (found.model.rotation, found.model.mirrored)
