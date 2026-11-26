"""The matcher's search (`reports/calib/ai/search.py`, as gate R1 measured it, `docs/research/M10-local-ai.md`).

The film warped through a rough start is cut into tiles and matched many to many against the reference's tiles; each pair of tiles
that agrees on a similarity near the identity is one vote, and the consensus of those votes is a few ranked proposals. Nothing here
accepts anything: the worker's proof does, and a matcher's count never reaches a gate. Settings are those of Tests A and C and gate R1,
not tuned: tiles of 768 pixels at 15 m, 12 inliers a pair; 500 m of tolerance and 1 km apart on a whole window, 150 m and 500 m on one
smaller than a tile.

On the processor (`docs/research/M26-governor.md` §5, item h2) the request is searched at half its resolution (`decimated`: tiles of
768 pixels at 30 m, a quarter as many on each side, so about a tenth of the pairs), with the budget's keypoints: the same search,
coarser; the worker's proof still measures at full resolution. A window under two tiles a side is searched as it is. Measured on the NUC
(2026-11-13): 553 s a request before, 64 s after; with 1,024 keypoints as well, 38 s, but F006 on Fetești was no longer found.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from typing import Final, Protocol

import cv2
import numpy
from numpy.typing import NDArray

from .box import MATRIX_SIDE, MAX_PROPOSALS, FloatArray, Found, Request, UInt8Array

TILE_PX: Final = 768
# The processor's lighter search: half the resolution (fewer keypoints as well lost a frame the card finds: see above).
CPU_DECIMATION: Final = 2
PAIR_MIN_INLIERS: Final = 12
PAIR_RANSAC_PX: Final = 2.5
PAIR_MIN_SCALE: Final = 0.85
PAIR_MAX_SCALE: Final = 1.15
PAIR_MAX_TURN_DEG: Final = 4.0
FILM_MIN_VALID: Final = 0.4
REFERENCE_MIN_VALID: Final = 0.5
TILE_MIN_VALID_PIXELS: Final = 16
WHOLE_TOLERANCE_GROUND_M: Final = 500.0
WHOLE_DISTINCT_GROUND_M: Final = 1000.0
SMALL_TOLERANCE_GROUND_M: Final = 150.0
SMALL_DISTINCT_GROUND_M: Final = 500.0
REFINE_ROUNDS: Final = 3
REFINE_MIN_POINTS: Final = 6
PAIR_AGREES_SHARE: Final = 0.5
CONSENSUS_KEEP: Final = 5
CLAHE_LIMIT: Final = 2.0
CLAHE_CELLS: Final = (8, 8)
PERCENTILES: Final = (1, 99)
FULL: Final = 255
MIN_STRETCH: Final = 1e-3
Keypoints = NDArray[numpy.float64]
Tile = tuple[tuple[int, int], UInt8Array]
Vote = tuple[Keypoints, Keypoints]


class Backend(Protocol):
    """What the search needs of a network: features of a tile, and the matches of two tiles' features."""

    def extract(self, tile: UInt8Array) -> object: ...

    def match(self, features: tuple[object, object], sizes: tuple[tuple[int, int], tuple[int, int]]) -> tuple[Keypoints, Keypoints]: ...


@dataclass(frozen=True)
class Consensus:
    """A similarity about `offset`, and how many pairs and points agree."""

    similarity: FloatArray
    offset: FloatArray
    pairs: int
    points: int
    centre: FloatArray


def tiles_over(width: int, height: int, tile: int, stride: int) -> list[tuple[int, int]]:
    """Tile corners stepping `stride`, the last against the far edge."""

    def axis(size: int) -> list[int]:
        return [0] if size <= tile else [*range(0, size - tile, stride), size - tile]

    return [(u, v) for v in axis(height) for u in axis(width)]


def norm8(tile: UInt8Array) -> UInt8Array:
    """Percentile stretch and CLAHE, both images alike; no data stays zero."""
    values = tile.astype(numpy.float32)
    valid = values > 0
    if int(valid.sum()) < TILE_MIN_VALID_PIXELS:
        return numpy.zeros(tile.shape, numpy.uint8)
    low, high = numpy.percentile(values[valid], PERCENTILES)
    stretched = numpy.clip((values - low) / max(float(high - low), MIN_STRETCH) * FULL, 0, FULL).astype(numpy.uint8)
    equalised = numpy.asarray(cv2.createCLAHE(CLAHE_LIMIT, CLAHE_CELLS).apply(stretched), numpy.uint8)
    equalised[~valid] = 0
    return equalised


def pair_inliers(film: Keypoints, reference: Keypoints) -> NDArray[numpy.bool_] | None:
    """The inliers of a similarity from the film tile's pixels to the reference's, kept only near the identity the start promises."""
    if len(film) < PAIR_MIN_INLIERS:
        return None
    found: tuple[object, object] = cv2.estimateAffinePartial2D(
        film.astype(numpy.float32),
        reference.astype(numpy.float32),
        method=cv2.RANSAC,
        ransacReprojThreshold=PAIR_RANSAC_PX,
        maxIters=2000,
        confidence=0.999,
    )
    return _kept_inliers(found[0], found[1])


def _kept_inliers(model: object, flags: object) -> NDArray[numpy.bool_] | None:
    if not isinstance(model, numpy.ndarray) or not isinstance(flags, numpy.ndarray):
        return None
    inliers = numpy.asarray(flags.ravel() > 0, numpy.bool_)
    return inliers if int(inliers.sum()) >= PAIR_MIN_INLIERS and _near_identity(numpy.asarray(model, numpy.float64)) else None


def _near_identity(model: FloatArray) -> bool:
    scale = float(numpy.hypot(model[0, 0], model[1, 0]))
    turn = float(numpy.degrees(numpy.arctan2(model[1, 0], model[0, 0])))
    return PAIR_MIN_SCALE <= scale <= PAIR_MAX_SCALE and abs(turn) <= PAIR_MAX_TURN_DEG


def _to_places(grid: FloatArray, pixels: Keypoints) -> FloatArray:
    return numpy.asarray(pixels @ grid[:2, :2].T + grid[:2, 2], numpy.float64)


def _fit(start: FloatArray, true: FloatArray, offset: FloatArray) -> FloatArray | None:
    model, _ = cv2.estimateAffinePartial2D((start - offset).astype(numpy.float32), (true - offset).astype(numpy.float32), method=cv2.LMEDS)
    return None if model is None else numpy.asarray(model, numpy.float64)


def _agreeing(similarity: FloatArray, votes: Sequence[Vote], offset: FloatArray, tolerance: float) -> list[NDArray[numpy.bool_]]:
    """For each pair of tiles, which of its points the similarity puts within `tolerance` (EPSG:3857 metres)."""
    moved = [(start - offset) @ similarity[:2, :2].T + similarity[:2, 2] - (true - offset) for start, true in votes]
    return [numpy.asarray(numpy.hypot(each[:, 0], each[:, 1]) < tolerance, numpy.bool_) for each in moved]


def _counted(flags: Sequence[NDArray[numpy.bool_]]) -> tuple[int, int]:
    return sum(int(each.mean() >= PAIR_AGREES_SHARE) for each in flags), sum(int(each.sum()) for each in flags)


def _agreeing_votes(similarity: FloatArray, votes: Sequence[Vote], offset: FloatArray, tolerance: float) -> list[Vote]:
    """The pairs of tiles most of whose points the similarity holds."""
    flags = _agreeing(similarity, votes, offset, tolerance)
    return [vote for vote, each in zip(votes, flags, strict=True) if each.mean() >= PAIR_AGREES_SHARE]


def _fit_on(chosen: Sequence[Vote], offset: FloatArray) -> FloatArray | None:
    """A similarity over the chosen pairs' points, when they are enough."""
    if sum(len(each[0]) for each in chosen) < REFINE_MIN_POINTS:
        return None
    return _fit(numpy.vstack([each[0] for each in chosen]), numpy.vstack([each[1] for each in chosen]), offset)


def _refined(similarity: FloatArray, votes: Sequence[Vote], offset: FloatArray, tolerance: float) -> FloatArray:
    """The similarity fitted again, three times, on the pairs that agree with it."""
    current = similarity
    for _ in range(REFINE_ROUNDS):
        better = _fit_on(_agreeing_votes(current, votes, offset, tolerance), offset)
        if better is None:
            break
        current = better
    return current


def _ranked_hypotheses(votes: Sequence[Vote], offset: FloatArray, tolerance: float) -> list[FloatArray]:
    """Each pair's similarity, those the most pairs and points agree with first."""
    fitted = [_fit(start, true, offset) for start, true in votes]
    hypotheses = [each for each in fitted if each is not None]

    def rank(each: FloatArray) -> tuple[int, int]:
        pairs, points = _counted(_agreeing(each, votes, offset, tolerance))
        return -pairs, -points

    return sorted(hypotheses, key=rank)


def consensus(
    votes: Sequence[Vote], centre: FloatArray, ground: float, tolerance_ground_m: float, distinct_ground_m: float
) -> list[Consensus]:
    """Each pair's similarity is a hypothesis scored by the pairs that agree with it; refined, those that land on one place merged."""
    if not votes:
        return []
    offset = numpy.asarray(votes[0][1].mean(axis=0), numpy.float64)
    tolerance = tolerance_ground_m / ground
    kept: list[Consensus] = []
    for hypothesis in _ranked_hypotheses(votes, offset, tolerance):
        if len(kept) < CONSENSUS_KEEP:
            _keep_new(kept, _consensus_of(hypothesis, votes, offset, tolerance, centre), distinct_ground_m / ground)
    return sorted(kept, key=lambda each: (-each.pairs, -each.points))


def _consensus_of(hypothesis: FloatArray, votes: Sequence[Vote], offset: FloatArray, tolerance: float, centre: FloatArray) -> Consensus:
    similarity = _refined(hypothesis, votes, offset, tolerance)
    pairs, points = _counted(_agreeing(similarity, votes, offset, tolerance))
    return Consensus(similarity, offset, pairs, points, similarity[:2, :2] @ (centre - offset) + similarity[:2, 2] + offset)


def _keep_new(kept: list[Consensus], candidate: Consensus, distinct: float) -> None:
    if all(float(numpy.hypot(*(candidate.centre - each.centre))) >= distinct for each in kept):
        kept.append(candidate)


def to_matrix(found: Consensus) -> FloatArray:
    """The proposal's map from the start's places to true places, a 3 by 3."""
    matrix = numpy.eye(MATRIX_SIDE)
    linear = found.similarity[:2, :2]
    matrix[:2, :2] = linear
    matrix[:2, 2] = found.similarity[:2, 2] + found.offset - linear @ found.offset
    return matrix


def tile_size(reference: UInt8Array) -> tuple[int, bool]:
    """The tile's side, and whether the window is smaller than a tile: then the whole window is one tile."""
    height, width = reference.shape
    return (width, True) if min(height, width) < TILE_PX else (TILE_PX, False)


def film_tiles(film: UInt8Array, tile: int) -> list[Tile]:
    """Overlapping tiles of the warped film with film on enough of them."""
    height, width = film.shape
    corners = [(u, v, film[v : v + tile, u : u + tile]) for u, v in tiles_over(width, height, tile, max(tile // 2, 1))]
    return [((u, v), norm8(part)) for u, v, part in corners if part.shape == (tile, tile) and (part > 0).mean() >= FILM_MIN_VALID]


def reference_tiles(reference: UInt8Array, tile: int) -> list[Tile]:
    """Tiles of the reference, side by side, with data on enough of them."""
    height, width = reference.shape
    corners = [(u, v, reference[v : v + tile, u : u + tile]) for u, v in tiles_over(width, height, min(tile, width), tile)]
    return [((u, v), norm8(part)) for u, v, part in corners if (part > 0).mean() >= REFERENCE_MIN_VALID]


def _vote(request: Request, pair: tuple[Tile, Tile], matches: tuple[Keypoints, Keypoints]) -> Vote | None:
    """The two tiles' matches as places, when they pass the pair's gate."""
    start, true = matches
    inliers = pair_inliers(start, true)
    if inliers is None:
        return None
    return _to_places(request.film_grid, start[inliers] + pair[0][0]), _to_places(request.reference_grid, true[inliers] + pair[1][0])


def _votes_of_film_tile(
    request: Request, film: Tile, features: object, against: Sequence[tuple[Tile, object]], backend: Backend
) -> list[Vote]:
    """One film tile against every reference tile."""
    votes = [_vote(request, (film, tile), backend.match((features, other), (film[1].shape, tile[1].shape))) for tile, other in against]
    return [each for each in votes if each is not None]


def votes_of(request: Request, film: Sequence[Tile], reference: Sequence[Tile], backend: Backend, tick: Callable[[], None]) -> list[Vote]:
    """Every film tile against every reference tile, features extracted once a tile; a pair that passes is a vote, in EPSG:3857."""
    film_features = [backend.extract(tile) for _, tile in film]
    against = [(tile, backend.extract(tile[1])) for tile in reference]
    votes: list[Vote] = []
    for tile, features in zip(film, film_features, strict=True):
        tick()
        votes.extend(_votes_of_film_tile(request, tile, features, against, backend))
    return votes


def _window_centre(request: Request) -> FloatArray:
    height, width = request.reference.shape
    return numpy.asarray(_to_places(request.reference_grid, numpy.array([[width / 2, height / 2]], numpy.float64))[0], numpy.float64)


def _settings(small: bool) -> tuple[float, float]:
    """The consensus's tolerance and how far apart two proposals must lie, in ground metres."""
    return (SMALL_TOLERANCE_GROUND_M, SMALL_DISTINCT_GROUND_M) if small else (WHOLE_TOLERANCE_GROUND_M, WHOLE_DISTINCT_GROUND_M)


def _shrunk(image: UInt8Array, factor: int) -> UInt8Array:
    height, width = image.shape
    return numpy.asarray(cv2.resize(image, (width // factor, height // factor), interpolation=cv2.INTER_AREA), numpy.uint8)


def _coarser(grid: FloatArray, factor: int) -> FloatArray:
    """The grid of an image shrunk by `factor`: a coarse pixel's centre is the mean of the fine pixels it averages."""
    coarse = numpy.array(grid, numpy.float64)
    coarse[:2, 2] = grid[:2, 2] + grid[:2, :2] @ numpy.full(2, (factor - 1) / 2)
    coarse[:2, :2] = grid[:2, :2] * factor
    return coarse


def decimated(request: Request, factor: int) -> Request:
    """The request at 1/`factor` of its resolution, when its reference keeps a whole tile a side after; else as it is."""
    if factor <= 1 or min(request.reference.shape) < factor * TILE_PX:
        return request
    return replace(
        request,
        film=_shrunk(request.film, factor),
        reference=_shrunk(request.reference, factor),
        film_grid=_coarser(request.film_grid, factor),
        reference_grid=_coarser(request.reference_grid, factor),
    )


def search(request: Request, backend: Backend, tick: Callable[[], None], decimation: int = 1) -> tuple[Found, ...]:
    """What the matcher proposes for one orientation: at most three, best first; none for a film that matches nothing. `decimation`:
    the processor's lighter search (`CPU_DECIMATION`)."""
    request = decimated(request, decimation)
    tile, small = tile_size(request.reference)
    cv2.setRNGSeed(0)
    film, reference = film_tiles(request.film, tile), reference_tiles(request.reference, tile)
    if not (film and reference):
        return ()
    votes = votes_of(request, film, reference, backend, tick)
    found = consensus(votes, _window_centre(request), request.ground, *_settings(small))
    return tuple(Found(to_matrix(each), each.pairs, each.points) for each in found[:MAX_PROPOSALS])
