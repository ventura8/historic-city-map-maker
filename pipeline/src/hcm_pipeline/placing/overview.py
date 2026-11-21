"""Place tiles on their overview map using ORB feature matching (docs/research/M20-import-local.md, *Atlases and pieces*).

Each tile is located on the smaller-scale overview by ORB features and an affine transform (tile -> overview pixels); its row and
column, read from its file name by `sheetnames.cell_of` (the one name parser, M20 §19.1), give a positional hint.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

from hcm_pipeline.placing.sheetnames import cell_of

_MIN_MATCHES = 4
_MIN_KEYPOINTS = 10
_MIN_INLIERS = 25
# A weaker fit is kept only when its scale and turn agree with the series' strong fits (harti.zip 1895: 14 of 60 pieces).
_MIN_WEAK_INLIERS = 10
AGREE_SCALE = 0.05
AGREE_TURN = 0.05
_MIN_CONSENSUS = 2
_TILE_FEATURES = 4000
# The overview holds every tile's features at once: 4,000 left 23 of the 60 harti.zip 1895 pieces with too few to match.
_OVERVIEW_FEATURES = 20000
# Downscales tried around the estimate; ORB's own pyramid only shrinks further, so the sweep leans small.
_SWEEP = (0.5, 0.7, 1.0, 1.4)


@dataclass(frozen=True)
class TileFit:
    """Affine fit of a tile onto the overview in pixel coordinates."""

    matrix: np.ndarray
    inliers: int
    rms_px: float


@dataclass(frozen=True)
class MosaicReport:
    """Summary of tiles placed and unplaced in the mosaic."""

    placed: list[str]
    unplaced: list[str]
    rms_px: float


@dataclass(frozen=True)
class Features:
    """ORB keypoints and descriptors of one image."""

    keypoints: list[Any]
    descriptors: np.ndarray | None


def expected_scale(count: int, tile_area: float, overview_shape: tuple[int, ...]) -> float:
    """The downscale at which `count` tiles of `tile_area` pixels cover the overview: both are read at one size, so their pixel sizes
    alone say nothing of the tiles' scale (harti.zip 1895: 1.4 against a true 7.1)."""
    overview_area = float(overview_shape[0] * overview_shape[1])
    return float(np.sqrt(max(1, count) * tile_area / max(overview_area, 1.0)))


def _base_scale(tile: np.ndarray, overview: np.ndarray) -> float:
    """Estimate the downscale factor from the tile/overview size ratio (one tile spanning the overview's shorter fit)."""
    th, tw = tile.shape[:2]
    oh, ow = overview.shape[:2]
    ratio = float(min(th / oh, tw / ow))
    return 1.0 / ratio


def orb_detect(img: np.ndarray, features: int = _TILE_FEATURES) -> tuple[list[Any], np.ndarray | None]:
    """Detect ORB keypoints and descriptors on a grey image."""
    orb = cv2.ORB.create(nfeatures=features)
    kp, des = orb.detectAndCompute(img, None)
    return list(kp), des


def overview_features(overview: np.ndarray) -> Features:
    """The overview's features, detected once for every tile."""
    return Features(*orb_detect(overview, _OVERVIEW_FEATURES))


def _descriptors_ok(
    des_t: np.ndarray | None,
    des_o: np.ndarray | None,
    kp_t: list[Any],
    kp_o: list[Any],
) -> tuple[np.ndarray, np.ndarray] | None:
    """Check that both descriptor sets are valid and sufficient."""
    if des_t is None or des_o is None:
        return None
    return (des_t, des_o) if min(len(kp_t), len(kp_o)) >= _MIN_KEYPOINTS else None


def _ratio_match(des_t: np.ndarray, des_o: np.ndarray) -> list[Any]:
    """Match descriptors with BFMatcher (Hamming) and ratio test 0.75."""
    bf = cv2.BFMatcher(cv2.NORM_HAMMING)
    matches = bf.knnMatch(des_t, des_o, k=2)
    return [m[0] for m in matches if m[0].distance < 0.75 * m[1].distance]


def _filter_by_hint(
    src: np.ndarray,
    dst: np.ndarray,
    hint: tuple[float, float],
    half_w: float,
    half_h: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Keep only matches within 1.5 tile sizes of the hint centre."""
    hx, hy = hint
    mask = (dst[:, 0] > hx - half_w) & (dst[:, 0] < hx + half_w) & (dst[:, 1] > hy - half_h) & (dst[:, 1] < hy + half_h)
    return src[mask], dst[mask]


def _apply_hint(
    src: np.ndarray,
    dst: np.ndarray,
    hint: tuple[float, float] | None,
    half_w: float,
    half_h: float,
) -> tuple[np.ndarray, np.ndarray] | None:
    """Apply the hint window filter; return None if too few points remain."""
    if hint is None:
        return src, dst
    src, dst = _filter_by_hint(src, dst, hint, half_w, half_h)
    if len(src) < _MIN_MATCHES:
        return None
    return src, dst


def _affine_fit(src: np.ndarray, dst: np.ndarray) -> TileFit | None:
    """Estimate affine partial 2D with RANSAC and its RMS error over the inliers (the outliers' distances are not the fit's error)."""
    matrix, inliers = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=4.0)
    n = 0 if inliers is None else int(inliers.sum())
    if matrix is None or n < _MIN_WEAK_INLIERS:
        return None
    kept = inliers.ravel().astype(bool)
    mapped = src[kept] @ matrix[:, :2].T + matrix[:, 2]
    rms = float(np.sqrt(np.mean(np.sum((mapped - dst[kept]) ** 2, axis=1))))
    return TileFit(matrix=matrix, inliers=n, rms_px=rms)


def _match_points(kp_t: list[Any], kp_o: list[Any], good: list[Any]) -> tuple[np.ndarray, np.ndarray]:
    """Source/destination pixel arrays for the ratio-test survivors."""
    src = np.array([kp_t[m.queryIdx].pt for m in good], dtype=np.float32)
    dst = np.array([kp_o[m.trainIdx].pt for m in good], dtype=np.float32)
    return src, dst


def _rescaled_fit(fit: TileFit, scale: float) -> TileFit:
    """Map a fit measured on a downscaled tile back to full-resolution pixels."""
    matrix = fit.matrix.copy()
    matrix[:, :2] /= scale
    return TileFit(matrix=matrix, inliers=fit.inliers, rms_px=fit.rms_px)


def _match_at_scale(
    tile: np.ndarray,
    target: Features,
    scale: float,
    hint: tuple[float, float] | None,
) -> TileFit | None:
    """Run the full matching pipeline at a given downscale factor."""
    new_w = max(1, int(tile.shape[1] / scale))
    new_h = max(1, int(tile.shape[0] / scale))
    resized = cv2.resize(tile, (new_w, new_h), interpolation=cv2.INTER_AREA)

    kp_t, des_t = orb_detect(resized)
    kp_o, des_o = target.keypoints, target.descriptors
    des = _descriptors_ok(des_t, des_o, kp_t, kp_o)
    if des is None:
        return None
    des_t, des_o = des

    good = _ratio_match(des_t, des_o)
    if len(good) < _MIN_MATCHES:
        return None

    pts = _apply_hint(*_match_points(kp_t, kp_o, good), hint, new_w * 0.75, new_h * 0.75)
    if pts is None:
        return None
    fit = _affine_fit(*pts)
    return None if fit is None else _rescaled_fit(fit, scale)


def _better(a: TileFit | None, b: TileFit) -> bool:
    """Return True if *b* is a better fit than *a*."""
    return a is None or b.inliers > a.inliers


def fit_tile(tile: np.ndarray, target: Features, hint: tuple[float, float] | None, scale: float) -> TileFit | None:
    """The tile's best fit over the downscales swept around `scale`, weak fits (at least 10 inliers) included."""
    best: TileFit | None = None
    for factor in _SWEEP:
        fit = _match_at_scale(tile, target, scale * factor, hint)
        if fit is not None and _better(best, fit):
            best = fit
    return best


def tile_on_overview(
    tile: np.ndarray,
    overview: np.ndarray,
    hint: tuple[float, float] | None,
    scale: float | None = None,
) -> TileFit | None:
    """Match a tile onto the overview via ORB features: the tile downscaled to the overview's scale (`scale`, else the size ratio),
    swept around it, ratio-tested matches, a RANSAC partial affine (4 px), within 1.5 tile sizes of *hint* when given.
    Returns a :class:`TileFit` or ``None`` if fewer than 25 inliers."""
    base = scale if scale is not None else _base_scale(tile, overview)
    fit = fit_tile(tile, overview_features(overview), hint, base)
    return fit if fit is not None and fit.inliers >= _MIN_INLIERS else None


def scale_turn(fit: TileFit) -> tuple[float, float]:
    """The fit's scale and rotation (radians)."""
    return float(np.hypot(fit.matrix[0, 0], fit.matrix[1, 0])), float(np.arctan2(fit.matrix[1, 0], fit.matrix[0, 0]))


def _strong(fits: Sequence[TileFit | None]) -> list[TileFit]:
    return [fit for fit in fits if fit is not None and fit.inliers >= _MIN_INLIERS]


def consensus_of(fits: Sequence[TileFit | None]) -> tuple[float, float] | None:
    """The median scale and turn of the strong fits, or None when fewer than two are strong."""
    strong = np.array([scale_turn(fit) for fit in _strong(fits)]).reshape(-1, 2)
    if len(strong) < _MIN_CONSENSUS:
        return None
    middle = np.median(strong, axis=0)
    return float(middle[0]), float(middle[1])


def _agrees(fit: TileFit, consensus: tuple[float, float]) -> bool:
    scale, turn = scale_turn(fit)
    return abs(scale / consensus[0] - 1.0) <= AGREE_SCALE and abs(turn - consensus[1]) <= AGREE_TURN


def _kept(fit: TileFit | None, consensus: tuple[float, float] | None) -> TileFit | None:
    """A strong fit; a weak one only when it agrees with the strong fits' scale and turn."""
    if fit is None or fit.inliers >= _MIN_INLIERS:
        return fit
    return fit if consensus is not None and _agrees(fit, consensus) else None


def fit_tiles(
    tiles: Sequence[tuple[str, np.ndarray]],
    overview: np.ndarray,
    rows: int,
    cols: int,
) -> list[TileFit | None]:
    """Every tile's fit on the overview (None when it does not land), its downscale estimated from the tiles' count."""
    target = overview_features(overview)
    area = float(np.median([tile.shape[0] * tile.shape[1] for _, tile in tiles])) if tiles else 1.0
    scale = expected_scale(len(tiles), area, overview.shape)
    fits = [fit_tile(tile, target, grid_hint(name, rows, cols, overview.shape), scale) for name, tile in tiles]
    consensus = consensus_of(fits)
    return [_kept(fit, consensus) for fit in fits]


def detail_of(fits: Sequence[TileFit | None]) -> float | None:
    """Tile pixels per overview pixel, the median over the fits; None when none landed."""
    scales = [scale_turn(fit)[0] for fit in fits if fit is not None]
    return 1.0 / float(np.median(scales)) if scales else None


def grid_hint(
    name: str,
    rows: int,
    cols: int,
    overview_shape: tuple[int, int],
) -> tuple[float, float] | None:
    """Compute the expected tile centre on the overview from the file name.

    Supported patterns (1-indexed):

    * ``r03c07`` - explicit row/col
    * ``3_7`` - row_col
    * ``03-07`` - row-col
    * ``A3`` / ``C12`` - letter (row) + number (col)
    * ``123`` - sheet number, read row-major (validated against rows*cols)

    Returns ``(cx, cy)`` in overview pixels, or ``None`` if the name
    does not contain a recognisable pattern.
    """
    rc = cell_of(name, rows, cols)
    if rc is None:
        return None
    r, c = rc
    oh, ow = overview_shape
    cy = (r + 0.5) * oh / rows
    cx = (c + 0.5) * ow / cols
    return (cx, cy)


def _paste_tile(
    canvas: np.ndarray,
    tile: np.ndarray,
    matrix: np.ndarray,
    upscale: float,
) -> None:
    """Warp a tile onto the canvas using the scaled affine matrix, within the tile's own box on the canvas."""
    m_canvas = matrix * upscale
    h, w = tile.shape[:2]
    corners = np.array([[0, 0], [w, 0], [0, h], [w, h]], dtype=np.float64) @ m_canvas[:, :2].T + m_canvas[:, 2]
    ch, cw = canvas.shape[:2]
    x0, y0 = (max(0, int(np.floor(value))) for value in corners.min(axis=0))
    x1, y1 = min(cw, int(np.ceil(corners[:, 0].max()))), min(ch, int(np.ceil(corners[:, 1].max())))
    if x1 <= x0 or y1 <= y0:
        return
    shifted = m_canvas.copy()
    shifted[:, 2] -= (x0, y0)
    size = (x1 - x0, y1 - y0)
    warped = cv2.warpAffine(tile, shifted, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    mask_src = np.full(tile.shape[:2], 255, dtype=np.uint8)
    mask = cv2.warpAffine(mask_src, shifted, size, flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    valid = mask > 0
    values = warped[valid]
    # A grey piece on a colour canvas (a colour series may hold a grey scan) fills all three bands.
    canvas[y0:y1, x0:x1][valid] = values[:, None] if canvas.ndim > values.ndim + 1 else values


def paste_on_overview(
    tiles: Iterable[tuple[str, np.ndarray]],
    fits: Sequence[TileFit | None],
    overview_shape: tuple[int, ...],
    upscale: float,
    colour: bool = False,
) -> tuple[np.ndarray, MosaicReport]:
    """The overview's frame resized by *upscale*, paper (255) where no tile lands, each fitted tile warped on it; three bands when
    *colour* (the tiles may then be read one at a time: *tiles* is iterated once)."""
    size = (int(overview_shape[0] * upscale), int(overview_shape[1] * upscale))
    canvas = np.full((*size, 3) if colour else size, 255, dtype=np.uint8)
    placed: list[str] = []
    unplaced: list[str] = []
    rms_values: list[float] = []
    for (name, tile), fit in zip(tiles, fits, strict=True):
        if fit is None:
            unplaced.append(name)
            continue
        _paste_tile(canvas, tile, fit.matrix, upscale)
        placed.append(name)
        rms_values.append(fit.rms_px)
    rms = float(np.mean(rms_values)) if rms_values else 0.0
    return canvas, MosaicReport(placed=placed, unplaced=unplaced, rms_px=rms)


def mosaic_on_overview(
    tiles: Sequence[tuple[str, np.ndarray]],
    overview: np.ndarray,
    rows: int,
    cols: int,
    upscale: float,
) -> tuple[np.ndarray, MosaicReport]:
    """Assemble a mosaic canvas from tiles placed on the overview (:func:`fit_tiles`, then :func:`paste_on_overview`).

    Tiles that fail to match are listed in the report's ``unplaced`` field.
    """
    return paste_on_overview(tiles, fit_tiles(tiles, overview, rows, cols), overview.shape, upscale)
