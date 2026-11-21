"""Terrain: a frame seen off nadir shows a rise where flat ground further out would be (M15-calibration-accuracy.md, *Terrain*).

A feature h metres above the frame's reference height shows on the film where flat ground h tan(view) further from the nadir would show:
on a KH-9 frame seen 49 degrees off nadir (A001) a 20 m rise moves it 23 m. The panoramic camera knows the direction and the tan at each
film pixel (`parallax_at`): a ray's place on the plane under the camera at a height of 1, from the nadir, through the camera's linear map
to EPSG:3857, over that map's scale (the camera's height). Over a city that field is close to affine (`Terrain.tan`).

A frame is fitted on its rows' places moved as its film shows them (`Terrain.flat`), and a film pixel goes back to the ground with the
height there taken into account (`Terrain.ground`, a fixed point: it converges while a slope stays under 1 / tan). The heights are a
surface model (Copernicus GLO-30) averaged over a 900 m tile, the area a tile measures, on cells of 300 ground metres (`Heights`,
`surface.py`). Relief a second-order fit absorbs moves nothing a frame shows: under `RELIEF_MIN_M` (ground metres RMS of the displacement
after a second-order fit over the frame's rows, once scaled by what its tiles show) the frame is fitted flat, as before.

The camera's tan runs a little high where its scan angle is loosely held (F006 over Pitești: 0.73 against 0.61 read from the tiles), and
the surface model holds today's buildings and trees: the frame's own tiles say how much of the predicted displacement they show. The tan
is scaled by the slope of the flat camera's residuals on it, both less a cubic in the film (tiles within 100 m), never above 1 (`_shown`):
0.63 over Pitești, 0.73 to 1.0 in Bucharest. The ruler chose this over the geometry alone (M15 *Terrain*).
"""

import math
from dataclasses import dataclass, replace
from typing import Final

import numpy
from numpy.typing import NDArray

from hcm_pipeline.calibrate.camera import PanoramicMap
from hcm_pipeline.calibrate.joint import ModelFit, PlaceFn
from hcm_pipeline.calibrate.poly import fit_poly, ground_errors, ground_scale_of, rmse_m
from hcm_pipeline.geo import FloatArray, to_lnglat_arrays
from hcm_pipeline.georef.rpc import Rpc

RELIEF_MIN_M: Final = 1.0
# The tiles a scale is read on: within this of the flat camera (ground metres), as the proof's gross bound.
SHOWN_WITHIN_M: Final = 100.0
# Fixed-point steps from a flat place to the ground: each shrinks the error by the slope times the tan (under 0.1 in a city).
GROUND_STEPS: Final = 6
SPREAD_SHARE: Final = 3.0


@dataclass(frozen=True)
class Heights:
    """A surface model on an EPSG:3857 grid (its top-left corner and cell side, at least 2 x 2 cells): heights in metres, bilinear between
    cell centres, the edge's value beyond the grid."""

    left: float
    top: float
    resolution: float
    values: NDArray[numpy.float32]

    def at(self, places: FloatArray) -> FloatArray:
        rows, cols = self.values.shape
        col = numpy.clip((places[:, 0] - self.left) / self.resolution - 0.5, 0.0, cols - 1.0)
        row = numpy.clip((self.top - places[:, 1]) / self.resolution - 0.5, 0.0, rows - 1.0)
        c0, r0 = numpy.minimum(col.astype(numpy.int64), cols - 2), numpy.minimum(row.astype(numpy.int64), rows - 2)
        fc, fr = col - c0, row - r0
        grid = self.values.astype(numpy.float64)
        top = grid[r0, c0] * (1 - fc) + grid[r0, c0 + 1] * fc
        bottom = grid[r0 + 1, c0] * (1 - fc) + grid[r0 + 1, c0 + 1] * fc
        return numpy.asarray(top * (1 - fr) + bottom * fr, numpy.float64)

    def covering(self, places: FloatArray) -> Heights:
        """The cells around `places`, one more on each side (what a bilinear read there takes), within the grid: the same heights
        wherever those places are."""
        rows, cols = self.values.shape
        col = (places[:, 0] - self.left) / self.resolution
        row = (self.top - places[:, 1]) / self.resolution
        c0, r0 = _first(col, cols), _first(row, rows)
        c1, r1 = _last(col, c0, cols), _last(row, r0, rows)
        left, top = self.left + c0 * self.resolution, self.top - r0 * self.resolution
        return Heights(left, top, self.resolution, self.values[r0:r1, c0:c1])


def _first(cells: FloatArray, count: int) -> int:
    return int(numpy.clip(math.floor(float(cells.min())) - 1, 0, count - 2))


def _last(cells: FloatArray, first: int, count: int) -> int:
    return int(numpy.clip(math.ceil(float(cells.max())) + 1, first + 2, count))


def parallax_at(camera: PanoramicMap, film: FloatArray) -> FloatArray:
    """The tan of the view at each film pixel, as an EPSG:3857 direction away from the nadir (module docstring)."""
    rays = camera.frame.rays(film, camera.angles)
    linear = camera.coefficients[1:3] / camera.ray_spread[:, None]
    height = math.sqrt(abs(float(numpy.linalg.det(linear)))) or 1.0
    return numpy.asarray(rays @ linear / height, numpy.float64)


def _design(places: FloatArray, centre: FloatArray, spread: FloatArray) -> FloatArray:
    return numpy.column_stack((numpy.ones(len(places)), (places - centre) / spread))


@dataclass(frozen=True)
class Terrain:
    """The heights under a frame, its reference height and the affine field of its view's tan over the places."""

    heights: Heights
    reference_m: float
    centre: FloatArray
    spread: FloatArray
    coefficients: FloatArray

    def tan(self, places: FloatArray) -> FloatArray:
        return numpy.asarray(_design(places, self.centre, self.spread) @ self.coefficients, numpy.float64)

    def shift(self, places: FloatArray, heights: FloatArray) -> FloatArray:
        """How far the film shows each place from where it is, EPSG:3857 metres, at these heights."""
        _, lat = to_lnglat_arrays(places[:, 0], places[:, 1])
        return numpy.asarray(((heights - self.reference_m) / ground_scale_of(lat))[:, None] * self.tan(places), numpy.float64)

    def flat(self, places: FloatArray) -> FloatArray:
        """Where the film shows each place: what a flat map is fitted to."""
        return places + self.shift(places, self.heights.at(places))

    def ground(self, flat: FloatArray, height_m: float | None = None) -> FloatArray:
        """The place a flat map's point shows, at the surface model's height there, or at `height_m`."""
        places = flat
        for _ in range(GROUND_STEPS):
            heights = self.heights.at(places) if height_m is None else numpy.full(len(places), height_m)
            places = flat - self.shift(places, heights)
        return places

    def fitted(self, fit: ModelFit) -> ModelFit:
        """`fit` on the rows' flat places, mapping back to the ground."""

        def on_ground(film: FloatArray, places: FloatArray, weights: FloatArray) -> PlaceFn | None:
            flat = fit(film, self.flat(places), weights)
            return None if flat is None else OnGround(flat, self)

        return on_ground

    def relief_m(self, film: FloatArray, places: FloatArray) -> float:
        """The displacement a second-order fit over these rows leaves, ground metres RMS."""
        shifted = (self.heights.at(places) - self.reference_m)[:, None] * self.tan(places)
        left = shifted - fit_poly(2, film, shifted)(film)
        return rmse_m(numpy.hypot(*left.T))


@dataclass(frozen=True)
class OnGround:
    """A flat map and the terrain that takes its places to the ground: a film pixel to the place it shows."""

    flat: PlaceFn
    terrain: Terrain

    def __call__(self, film: FloatArray) -> FloatArray:
        return self.terrain.ground(self.flat(film))


def _less_cubic(values: FloatArray, film: FloatArray) -> FloatArray:
    return numpy.asarray(values - fit_poly(3, film, values)(film), numpy.float64)


def _shown(camera: PanoramicMap, terrain: Terrain, film: FloatArray, places: FloatArray) -> float:
    """How much of the predicted displacement the frame's tiles show: the slope of the flat camera's residuals on it, both less a cubic
    in the film, clipped to [0, 1]."""
    _, lat = to_lnglat_arrays(places[:, 0], places[:, 1])
    near = ground_errors(camera.to_places(film), places) < SHOWN_WITHIN_M
    residuals = (camera.to_places(film[near]) - places[near]) * ground_scale_of(lat[near])[:, None]
    predicted = (terrain.heights.at(places[near]) - terrain.reference_m)[:, None] * terrain.tan(places[near])
    left, moved = _less_cubic(residuals, film[near]), _less_cubic(predicted, film[near])
    return float(numpy.clip(float((left * moved).sum()) / max(float((moved * moved).sum()), 1e-9), 0.0, 1.0))


def terrain_of(camera: PanoramicMap, film: FloatArray, places: FloatArray, heights: Heights) -> Terrain | None:
    """The frame's terrain from its camera fitted flat and its rows, its tan scaled by what the tiles show (`_shown`); None when the
    relief it then corrects is negligible (`RELIEF_MIN_M`): tiles that show none of it correct nothing."""
    tan = parallax_at(camera, film)
    centre, spread = places.mean(axis=0), numpy.maximum(places.std(axis=0) * SPREAD_SHARE, 1.0)
    coefficients = numpy.linalg.lstsq(_design(places, centre, spread), tan, rcond=None)[0]
    reference = float(numpy.median(heights.at(places)))
    terrain = Terrain(heights, reference, centre, spread, numpy.asarray(coefficients, numpy.float64))
    # The relief is linear in the tan: scaled by what the tiles show, it is that share of the geometry's.
    relief = terrain.relief_m(film, places)
    shown = 0.0 if relief < RELIEF_MIN_M else _shown(camera, terrain, film, places)
    return None if relief * shown < RELIEF_MIN_M else replace(terrain, coefficients=terrain.coefficients * shown)


@dataclass(frozen=True)
class TerrainFit:
    """What renders a frame over its terrain: the RPC of its map (`georef/rpc.py`), the relief it corrects (ground metres RMS after a
    second-order fit) and the heights it was fitted over, the cells under its scan (`Heights.covering`): every reader of the map, the
    warp, a join, the next frame's ties and the georeferencer, takes the place's height from them."""

    rpc: Rpc
    relief_m: float
    heights: Heights
