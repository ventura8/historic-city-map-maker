"""The last look of a proof: does the film fit anywhere else better than where the map puts it (docs/research/M9-calibration.md §4)?

`measure` narrows its search round by round, so its last round sees about ±150 m: a tile whose true place lies further than that simply
has no peak and drops out of `tried`, and every gate counts survivors. A field lattice proved a map 800 m wrong, whole periods off, and a
stitch seam left 30 % of a city displaced 357 m at 2.2 m of checkpoint error (lesson 374). So, with the final map, tiles spread over the
window search far wider and their score maps are **added**: noise cancels over hundreds of tiles, and what remains is where the film
as a whole agrees. A right map has one peak, on itself. A rival peak names a part of the film that agrees elsewhere (a displaced part) or
a pattern that agrees everywhere (a repeat), and the share is its height over the map's own.
"""

import math
from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import Final

import cv2
import numpy

from hcm_pipeline.calibrate.dense import TILE_MIN_VALID, DenseGrid, FilmWindow, WarpedFilm, measure, warp_film
from hcm_pipeline.calibrate.poly import PlaceMap
from hcm_pipeline.calibrate.proof import Proof, prove

# A rival this high is a repeat, however noisy the sum (a lattice under its true map: 0.49; three periods off: 1.03).
PROOF_MAX_RIVAL: Final = 0.5
# What the map's own place spans: the filter's own side lobes, and any error the last round of `measure` still saw (its search: 150 m).
RIVAL_NEAR_GROUND_M: Final = 200.0
# Over this share and this many standard deviations of the sum's noise it is a part of the film: real frames stand at 3.6 to 4.3 sigmas,
# a part displaced over 20 % of a synthetic window at 23, over 15 % at 10 and under this share.
RIVAL_MIN_SHARE: Final = 0.1
RIVAL_MIN_SIGMAS: Final = 10.0
RIVAL_SEARCH_GROUND_M: Final = 1500.0
RIVAL_TILES: Final = 400
RIVAL_MIN_TILES: Final = 30
Place = tuple[int, int]


def _search_cells(reference: DenseGrid, shape: tuple[int, int]) -> int:
    """The search in cells: `RIVAL_SEARCH_GROUND_M`, as far as a small window leaves room for tiles."""
    wanted = round(RIVAL_SEARCH_GROUND_M / (reference.grid.resolution * reference.ground))
    return max(min(wanted, (min(shape) - reference.tile) // 3), 0)


def _places(warped: WarpedFilm, reference: DenseGrid, search: int) -> list[Place]:
    """About `RIVAL_TILES` tiles over the window with their whole search on film and their whole selves on the reference."""
    tile = reference.tile
    height, width = warped.valid.shape
    room = max(height - tile - 2 * search, 1) * max(width - tile - 2 * search, 1)
    step = max(reference.step, int(math.sqrt(room / RIVAL_TILES)))
    return [
        (v, u)
        for v in range(search, height - tile - search, step)
        for u in range(search, width - tile - search, step)
        if warped.valid[v - search : v + tile + search, u - search : u + tile + search].mean() >= TILE_MIN_VALID
        and reference.valid[v : v + tile, u : u + tile].mean() >= TILE_MIN_VALID
    ]


def added_scores(warped: WarpedFilm, reference: DenseGrid, search: int, places: list[Place], tick: Callable[[], None]) -> numpy.ndarray:
    """The tiles' score maps added: the middle cell is the map's own place."""
    total = numpy.zeros((2 * search + 1, 2 * search + 1), numpy.float64)
    tile = reference.tile
    for v, u in places:
        tick()
        area = warped.filtered[v - search : v + tile + search, u - search : u + tile + search]
        total += cv2.matchTemplate(area, reference.filtered[v : v + tile, u : u + tile], cv2.TM_CCOEFF_NORMED)
    return total


@dataclass(frozen=True)
class Rival:
    """The best place beyond the map's own: its height over the map's, and over the sum's noise, in standard deviations."""

    share: float
    sigmas: float

    @property
    def stands(self) -> bool:
        """A place that agrees as the map does, or one too clear for noise that holds a real part of the film."""
        return self.share > PROOF_MAX_RIVAL or (self.share > RIVAL_MIN_SHARE and self.sigmas > RIVAL_MIN_SIGMAS)


NO_RIVAL: Final = Rival(0.0, 0.0)


def rival_of(total: numpy.ndarray, near: int) -> Rival:
    """The best place beyond `near` cells of the middle, against the best within them; infinite when the map's own place agrees on
    nothing."""
    middle = total.shape[0] // 2
    own = float(total[middle - near : middle + near + 1, middle - near : middle + near + 1].max())
    outside = numpy.ones(total.shape, numpy.bool_)
    outside[middle - near : middle + near + 1, middle - near : middle + near + 1] = False
    rest = total[outside]
    best = float(rest.max())
    sigmas = (best - float(rest.mean())) / max(float(rest.std()), 1e-9)
    return Rival(best / own if own > 0 else math.inf, sigmas)


def rival_share(mapping: PlaceMap, film: FilmWindow, reference: DenseGrid, tick: Callable[[], None]) -> Rival:
    """How high the best rival place stands over the map's own; none where too few tiles fit for the sum to say anything."""
    warped = warp_film(film, mapping, reference.grid)
    search = _search_cells(reference, warped.valid.shape)
    near = math.ceil(RIVAL_NEAR_GROUND_M / (reference.grid.resolution * reference.ground))
    places = _places(warped, reference, search) if search > near else []
    if len(places) < RIVAL_MIN_TILES:
        return NO_RIVAL
    return rival_of(added_scores(warped, reference, search, places, tick), near)


def looked_again(proof: Proof, reference: DenseGrid, tick: Callable[[], None]) -> Proof:
    """A proof that passed every gate, with the last look's figure and, when a rival stands too high, its refusal."""
    if not proof.accepted or proof.mapping is None or proof.measured.film is None:
        return proof
    rival = rival_share(proof.mapping, proof.measured.film, reference, tick)
    return replace(proof, rival=rival.share, rival_sigmas=rival.sigmas, refusal="rival" if rival.stands else None)


def proved(start: PlaceMap, reference: DenseGrid, film: FilmWindow, seed: int, tick: Callable[[], None]) -> Proof:
    """The tiles from `start`, every gate, and the last look."""
    return looked_again(prove(measure(start, reference, film, seed, tick), reference.grid, seed), reference, tick)
