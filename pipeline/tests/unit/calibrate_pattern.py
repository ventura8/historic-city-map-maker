"""Worlds a right-looking map can be wrong on: a field lattice around a city, a film with a displaced part (M9 §4, lesson 374)."""

from dataclasses import dataclass
from typing import Final

import cv2
import numpy
from hcm_pipeline.calibrate.dense import PROOF_SEARCH_GROUND_M, dense_grid, read_film
from hcm_pipeline.calibrate.poly import MatrixMap, PlaceMap
from hcm_pipeline.calibrate.proof import Proof
from hcm_pipeline.calibrate.rival import proved
from hcm_pipeline.geo import FloatArray, Grid, ground_scale, to_mercator
from hcm_pipeline.images import UInt8Array, as_uint8

from tests.unit.calibrate_scene import ArrayReader, nothing

LAT: Final = 44.43
WORLD: Final = 3600
WINDOW: Final = 2400
PERIOD: Final = 56
FILM: Final = 5140
FILM_PIXEL_M: Final = 7.0
CENTRE: Final = to_mercator(26.10, LAT)
LEFT: Final = CENTRE[0] - WORLD * 5.0
TOP: Final = CENTRE[1] + WORLD * 5.0
TRUTH: Final = numpy.array(
    [
        [FILM_PIXEL_M, 0.0, CENTRE[0] - FILM_PIXEL_M * FILM / 2],
        [0.0, -FILM_PIXEL_M, CENTRE[1] + FILM_PIXEL_M * FILM / 2],
        [0.0, 0.0, 1.0],
    ]
)


def _jittered(rng: numpy.random.Generator, jitter: int) -> numpy.ndarray:
    lines = numpy.arange(0, WORLD + PERIOD, PERIOD)
    return lines + rng.integers(-jitter, jitter + 1, lines.size)


def _fields(jitter: int, seed: int) -> numpy.ndarray:
    """Fields of random tones between lines repeating every `PERIOD` cells, each line off by up to `jitter`."""
    rng = numpy.random.default_rng(seed)
    across, down = _jittered(rng, jitter), _jittered(rng, jitter)
    tones = numpy.random.default_rng(seed + 1).uniform(70, 190, (down.size, across.size))
    columns = numpy.clip(numpy.searchsorted(across, numpy.arange(WORLD)) - 1, 0, across.size - 1)
    rows = numpy.clip(numpy.searchsorted(down, numpy.arange(WORLD)) - 1, 0, down.size - 1)
    world = tones[numpy.ix_(rows, columns)].astype(numpy.float32)
    for x in across[(across >= 0) & (across < WORLD - 1)].tolist():
        world[:, x : x + 2] = 40
    for y in down[(down >= 0) & (down < WORLD - 1)].tolist():
        world[y : y + 2, :] = 40
    return world


def _city(side: int) -> numpy.ndarray:
    """Rectangles that repeat nothing."""
    rng = numpy.random.default_rng(99)
    city = numpy.full((side, side), 120, numpy.float32)
    for _ in range(9000):
        x, y = rng.integers(0, side, 2).tolist()
        width, height = rng.integers(6, 40, 2).tolist()
        city[y : y + height, x : x + width] = float(rng.uniform(30, 230))
    return city


def lattice(jitter: int = 4, seed: int = 1) -> numpy.ndarray:
    """The lattice with a city over the window's central quarter."""
    world = _fields(jitter, seed)
    side = WINDOW // 2
    first = (WORLD - side) // 2
    world[first : first + side, first : first + side] = _city(side)
    return numpy.asarray(numpy.clip(world, 1, 255), numpy.float32)


def random_land(seed: int = 3) -> numpy.ndarray:
    """A world that repeats nothing anywhere."""
    rng = numpy.random.default_rng(seed)
    world = numpy.full((WORLD, WORLD), 120, numpy.float32)
    for _ in range(40000):
        x, y = rng.integers(0, WORLD, 2).tolist()
        width, height = rng.integers(6, 50, 2).tolist()
        world[y : y + height, x : x + width] = float(rng.uniform(30, 230))
    return world


def film_of(world: numpy.ndarray, displaced_from_x: float | None = None, displaced_m: float = 0.0) -> UInt8Array:
    """A film of `world` through `TRUTH`; from Mercator x `displaced_from_x` on, its ground lies `displaced_m` east of where it shows."""
    u, v = numpy.meshgrid(numpy.arange(FILM, dtype=numpy.float64) + 0.5, numpy.arange(FILM, dtype=numpy.float64) + 0.5)
    mx = TRUTH[0, 0] * u + TRUTH[0, 2]
    my = TRUTH[1, 1] * v + TRUTH[1, 2]
    if displaced_from_x is not None:
        mx = mx + (mx >= displaced_from_x) * displaced_m
    gx, gy = (mx - LEFT) / 10.0, (TOP - my) / 10.0
    film = cv2.remap(world, (gx - 0.5).astype(numpy.float32), (gy - 0.5).astype(numpy.float32), cv2.INTER_LINEAR, borderValue=128)
    grain = numpy.random.default_rng(5).normal(0, 4, film.shape)
    return as_uint8(numpy.clip(film + grain, 0, 255))


@dataclass(frozen=True)
class Look:
    """What the proof made of a map started `off` metres from the truth."""

    proof: Proof
    error_m: float


def proof_of(world: numpy.ndarray, film: UInt8Array, off: tuple[float, float] = (0.0, 0.0)) -> Look:
    """The full proof of `film` against the window of `world`, from a map `off` Mercator metres from the truth."""
    margin = (WORLD - WINDOW) // 2
    reference = as_uint8(numpy.clip(world[margin : margin + WINDOW, margin : margin + WINDOW], 1, 255))
    grid = Grid(LEFT + margin * 10.0, TOP - margin * 10.0, 10.0, WINDOW, WINDOW)
    measuring = dense_grid(reference, grid)
    start: FloatArray = TRUTH.copy()
    start[0, 2] += off[0]
    start[1, 2] += off[1]
    mapping = MatrixMap(start)
    reach = PROOF_SEARCH_GROUND_M / ground_scale(LAT)
    read = read_film(mapping, grid.box(), ArrayReader(film), (FILM, FILM, 0), reach)
    assert read is not None
    proof = proved(mapping, measuring, read, 7, nothing)
    return Look(proof, _map_error(proof.mapping, grid))


def _map_error(mapping: PlaceMap | None, grid: Grid) -> float:
    """The median ground error of the proof's map against `TRUTH` over the window's middle."""
    if mapping is None:
        return float("inf")
    u, v = numpy.meshgrid(numpy.linspace(1500, FILM - 1500, 9), numpy.linspace(1500, FILM - 1500, 9))
    film = numpy.column_stack((u.ravel(), v.ravel()))
    mapped = mapping.to_places(film)
    truth = numpy.column_stack((TRUTH[0, 0] * film[:, 0] + TRUTH[0, 2], TRUTH[1, 1] * film[:, 1] + TRUTH[1, 2]))
    return float(numpy.median(numpy.hypot(*(mapped - truth).T))) * ground_scale(grid.box().bounds().middle_lat)
