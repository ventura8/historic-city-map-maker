"""A second pass for the pieces the overview's features left out: each is looked for only in the overview's holes
(docs/research/M20-import-local.md, *Atlases and pieces*, the second pass).

The first pass (`overview.fit_tiles`) matches every piece against the whole overview's features, so a piece whose streets look like
many others' (a quiet edge of town, a park, a railway yard) loses the ratio test to its look-alikes and is left out (harti.zip 1895: 3 of
60). Once the other pieces are placed, two things are known: the series' scale and turn (the strong fits' consensus) and where the
overview is still uncovered. A left-out piece is then turned and scaled by the consensus and searched by normalised cross-correlation
only where it would cover a hole; the best place is kept only when it is clearly better than every other one and the piece is not blank,
and it is refined by the piece's features within that window when they agree. Nothing is drawn or invented: the piece's own pixels
are pasted where the overview, the same printed map, shows them to belong; a piece that is not found stays out.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

import cv2
import numpy as np

from hcm_pipeline.placing.overview import AGREE_SCALE, AGREE_TURN, Features, TileFit, consensus_of, fit_tile, orb_detect, scale_turn

# A placement must cover this share of uncovered overview (the pieces overlap their neighbours, so never all of it).
HOLE_SHARE: Final = 0.2
# The correlation a piece must reach at its place, and by how much it must beat the best place that does not overlap it.
MIN_SCORE: Final = 0.45
MIN_MARGIN: Final = 0.1
EDGE_HAIR: Final = 1e-6
# The turns tried on top of the consensus': as is, and upside down.
TURNS: Final = (0.0, float(np.pi))
# A piece this flat (grey level spread) holds nothing to find.
MIN_SPREAD: Final = 8.0
# Features detected in the window around the found place, for the refinement.
WINDOW_FEATURES: Final = 8000
# The refined fit must land within this share of the template's size of the correlation's place.
REFINE_SHIFT: Final = 0.1


@dataclass(frozen=True)
class Found:
    """Where the correlation put a piece: its fit, its score and the margin over the next best place."""

    fit: TileFit
    score: float
    margin: float
    turn: float


def _corners(shape: tuple[int, ...], matrix: np.ndarray) -> np.ndarray:
    height, width = shape[:2]
    box = np.array([[0, 0], [width, 0], [width, height], [0, height]], dtype=np.float64)
    corners: np.ndarray = box @ matrix[:, :2].T + matrix[:, 2]
    return corners


def coverage(shapes: Sequence[tuple[int, ...]], fits: Sequence[TileFit | None], size: tuple[int, int]) -> np.ndarray:
    """The overview pixels (255) that a placed piece covers."""
    mask = np.zeros(size, dtype=np.uint8)
    for shape, fit in zip(shapes, fits, strict=True):
        if fit is not None:
            cv2.fillConvexPoly(mask, np.round(_corners(shape, fit.matrix)).astype(np.int32), 255)
    return mask


def _similarity(scale: float, turn: float) -> np.ndarray:
    cos, sin = scale * np.cos(turn), scale * np.sin(turn)
    return np.array([[cos, -sin, 0.0], [sin, cos, 0.0]])


def template_of(tile: np.ndarray, consensus: tuple[float, float]) -> tuple[np.ndarray, np.ndarray]:
    """The piece turned and scaled into overview pixels by the consensus, and the matrix from the piece to the template."""
    matrix = _similarity(*consensus)
    corners = _corners(tile.shape, matrix)
    matrix[:, 2] -= corners.min(axis=0)
    # A turn of exactly 180° leaves a rounding hair on the box, which must not cost a column.
    width, height = (max(1, int(np.ceil(value - EDGE_HAIR))) for value in corners.max(axis=0) - corners.min(axis=0))
    template = cv2.warpAffine(tile, matrix, (width, height), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_REPLICATE)
    return template, matrix


def _hole_share(holes: np.ndarray, size: tuple[int, int], shape: tuple[int, int]) -> np.ndarray:
    """For each placement of a `size` (height, width) template, the share of its box that is hole."""
    height, width = size
    total = cv2.integral(holes)
    rows, cols = shape
    found = total[height : height + rows, width : width + cols] - total[:rows, width : width + cols]
    found = found - total[height : height + rows, :cols] + total[:rows, :cols]
    return found / float(height * width)


def _margin(scores: np.ndarray, best: tuple[int, int], size: tuple[int, int]) -> float:
    """How far the best score stands above the best place that does not overlap it by half a template."""
    x, y = best
    height, width = size
    others = scores.copy()
    others[max(0, y - height // 2) : y + height // 2 + 1, max(0, x - width // 2) : x + width // 2 + 1] = -1.0
    return float(scores[y, x] - others.max()) if others.size else float(scores[y, x])


def correlate(tile: np.ndarray, overview: np.ndarray, holes: np.ndarray, consensus: tuple[float, float]) -> Found | None:
    """The piece's best place among those covering a hole, at the consensus' scale and turn or upside down (a piece scanned the other
    way up: harti.zip 1895 holds two)."""
    found = [_correlate_at(tile, overview, holes, (consensus[0], consensus[1] + turn)) for turn in TURNS]
    kept = [item for item in found if item is not None]
    return max(kept, key=lambda item: item.score) if kept else None


def _correlate_at(tile: np.ndarray, overview: np.ndarray, holes: np.ndarray, consensus: tuple[float, float]) -> Found | None:
    """The best place by normalised cross-correlation of the piece turned and scaled by `consensus`."""
    template, matrix = template_of(tile, consensus)
    size = (int(template.shape[0]), int(template.shape[1]))
    if size[0] >= overview.shape[0] or size[1] >= overview.shape[1] or float(template.std()) < MIN_SPREAD:
        return None
    scores = cv2.matchTemplate(overview, template, cv2.TM_CCOEFF_NORMED)
    scores = np.where(_hole_share(holes, size, scores.shape) >= HOLE_SHARE, scores, -1.0)
    _low, score, _where, peak = cv2.minMaxLoc(scores)
    best = (int(peak[0]), int(peak[1]))
    if score < MIN_SCORE:
        return None
    margin = _margin(scores, best, size)
    placed = matrix.copy()
    placed[:, 2] += best
    return Found(TileFit(matrix=placed, inliers=0, rms_px=0.0), float(score), margin, consensus[1])


def _window(found: Found, shape: tuple[int, ...], overview_shape: tuple[int, ...]) -> tuple[int, int, int, int]:
    corners = _corners(shape, found.fit.matrix)
    low, high = corners.min(axis=0), corners.max(axis=0)
    pad = (high - low) / 2
    x0, y0 = (max(0, int(value)) for value in low - pad)
    x1, y1 = min(overview_shape[1], int(high[0] + pad[0])), min(overview_shape[0], int(high[1] + pad[1]))
    return x0, y0, x1, y1


def _wrapped(turn: float) -> float:
    """The turn in (-pi, pi]."""
    return float(np.pi - (np.pi - turn) % (2 * np.pi))


def agrees(fit: TileFit, scale: float, turn: float) -> bool:
    """The fit's scale and turn agree with `scale` and `turn` (the turn's difference taken around the circle)."""
    found_scale, found_turn = scale_turn(fit)
    return abs(found_scale / scale - 1.0) <= AGREE_SCALE and abs(_wrapped(found_turn - turn)) <= AGREE_TURN


def refine(tile: np.ndarray, overview: np.ndarray, found: Found, consensus: tuple[float, float]) -> TileFit:
    """The piece's features matched within the window around its correlation place, when that fit agrees with the series and with
    the place; else the correlation's own placement."""
    x0, y0, x1, y1 = _window(found, tile.shape, overview.shape)
    window = np.ascontiguousarray(overview[y0:y1, x0:x1])
    fit = fit_tile(tile, Features(*orb_detect(window, WINDOW_FEATURES)), None, 1.0 / consensus[0])
    if fit is None or not agrees(fit, consensus[0], found.turn):
        return found.fit
    matrix = fit.matrix.copy()
    matrix[:, 2] += (x0, y0)
    shift = float(np.abs(_corners(tile.shape, matrix) - _corners(tile.shape, found.fit.matrix)).max())
    limit = REFINE_SHIFT * float(max(tile.shape[:2])) * consensus[0]
    return TileFit(matrix=matrix, inliers=fit.inliers, rms_px=fit.rms_px) if shift <= limit else found.fit


def refit_in_holes(tiles: Sequence[tuple[str, np.ndarray]], fits: Sequence[TileFit | None], overview: np.ndarray) -> list[TileFit | None]:
    """The fits with each left-out piece looked for again in the overview's holes (see the module); the holes shrink as pieces
    land. Unchanged when fewer than two pieces fitted strongly (no consensus) or none was left out."""
    result = list(fits)
    consensus = consensus_of(fits)
    if consensus is None:
        return result
    shapes = [tile.shape for _name, tile in tiles]
    for index in _left_out(fits):
        result[index] = _in_holes(tiles[index][1], overview, coverage(shapes, result, overview.shape[:2]) == 0, consensus)
    return result


def _left_out(fits: Sequence[TileFit | None]) -> list[int]:
    return [index for index, fit in enumerate(fits) if fit is None]


def _in_holes(tile: np.ndarray, overview: np.ndarray, uncovered: np.ndarray, consensus: tuple[float, float]) -> TileFit | None:
    """One left-out piece's fit in the holes, refined; None when no place clearly stands out."""
    found = correlate(tile, overview, uncovered.astype(np.uint8), consensus)
    return refine(tile, overview, found, consensus) if found is not None and found.margin >= MIN_MARGIN else None
