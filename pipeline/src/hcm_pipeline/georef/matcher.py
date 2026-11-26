"""Automatic GCPs (docs/research/M4-interfaces.md §2.1; M3-interfaces.md §5.6): the scan against Sentinel-2 and OSM.

1. The scan is pre-warped with the current transform onto the reference grid, so scale and rotation are mostly gone.
2. Two channels (`MATCH_CHANNELS`): `s2`, the Sentinel-2 window in grey, and `osm`, OpenStreetMap's lines as a
   proximity field (`tiles.py`); a window without one runs on the other.
3. Coarse to fine over three levels (1/4, 1/2, 1 of the reference's 10 m), the pre-warped scan cut into an 8 x 8 grid:
   on `s2`, SIFT features (or ORB, `features.py`) matched per cell within the search window (± 400 m at the coarsest
   level, halved per level), a cell without a match falling back to its tile's correlation; on `osm`, every cell's
   tile of the scan's lines correlated with the proximity field.
4. RANSAC over both channels keeps the inliers, scored and at most two per cell (`consensus.py`); each level's pairs
   refit the transform the next level pre-warps with.
5. Each kept pair goes back to scan pixels through the pre-warp's inverse: a GCP with `origin: 'auto'` and its
   confidence as `score`; `autogcp.decide` then splits them into the fit and the suggestions.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from math import ceil, floor
from typing import Final

import cv2
import numpy

from hcm_pipeline.geo import FloatArray, Grid, ground_scale, to_lnglat, to_lnglat_arrays
from hcm_pipeline.georef.autogcp import MATCH_CHANNELS, AutoPair, transform_kind
from hcm_pipeline.georef.consensus import Candidate, Scored, consensus
from hcm_pipeline.georef.features import CELLS, BoolArray, CellMatcher, Method, choose, detect
from hcm_pipeline.georef.tiles import TileMatcher, lines, lines_at, proximity
from hcm_pipeline.georef.transforms import Gcp, fit_transform
from hcm_pipeline.images import UInt8Array, as_uint8, enhance, resize

PixelMap = Callable[[FloatArray, FloatArray], tuple[FloatArray, FloatArray]]

LEVELS: Final = ((4, 400.0), (2, 200.0), (1, 100.0))
MAX_AUTO_GCPS: Final = 200
ERODE_PX: Final = 5
# `cv2.remap` asserts every side of its source and its result under 32 767 pixels.
REMAP_MAX_PX: Final = 32_766


@dataclass(frozen=True)
class Scan:
    """The scan's pixels at full resolution and its approximate ground size per pixel (EPSG:3857 metres)."""

    pixels: UInt8Array
    resolution: float


@dataclass(frozen=True)
class References:
    """What the scan is matched against, on the 10 m reference grid: Sentinel-2 in grey and the drawn OSM lines."""

    grid: Grid
    s2: UInt8Array | None = None
    osm: UInt8Array | None = None

    @property
    def channels(self) -> tuple[str, ...]:
        """The channels that can run: `s2` with an image, `osm` with at least one line."""
        present = {"s2": self.s2 is not None, "osm": self.osm is not None and bool(self.osm.any())}
        return tuple(channel for channel in MATCH_CHANNELS if present[channel])


@dataclass
class Tiles:
    """Matching tiles that gave a candidate, of the tiles tried, per channel."""

    matched: dict[str, int] = field(default_factory=dict)
    tried: dict[str, int] = field(default_factory=dict)

    def count(self, channel: str, found: bool) -> None:
        self.tried[channel] = self.tried.get(channel, 0) + 1
        self.matched[channel] = self.matched.get(channel, 0) + int(found)

    @property
    def total(self) -> tuple[int, int]:
        return sum(self.matched.values()), sum(self.tried.values())


@dataclass(frozen=True)
class MatchResult:
    """The pairs of the finest level that could refit the transform (else of the finest level), and how they came."""

    method: str
    channels: tuple[str, ...]
    pairs: tuple[AutoPair, ...]
    tiles: Tiles


def _shrink_factor(resolution: float, scan_resolution: float) -> float:
    """About two scan pixels per grid pixel (so the pre-warp does not alias), never enlarged."""
    return max(1.0, resolution / scan_resolution / 2)


def _shrunk(pixels: UInt8Array, factor: float) -> tuple[UInt8Array, float]:
    """`pixels` downsampled `factor` times, or further when a side would be more than `cv2.remap` takes, and the factor applied."""
    height, width = pixels.shape
    applied = max(factor, max(width, height) / REMAP_MAX_PX)
    if applied <= 1.0:
        return pixels, 1.0
    shrunk_width = max(1, round(width / applied))
    return resize(pixels, (shrunk_width, max(1, round(height / applied)))), width / shrunk_width


def _covered_box(px: FloatArray, py: FloatArray, shape: tuple[int, ...], pad: int) -> tuple[int, int, int, int]:
    """The scan's pixels (left, top, right, bottom) the places lie on, `pad` wider on every side, within the scan."""
    height, width = shape
    left, right = max(0, floor(px.min()) - pad), min(width, ceil(px.max()) + pad + 1)
    top, bottom = max(0, floor(py.min()) - pad), min(height, ceil(py.max()) + pad + 1)
    return left, top, right, bottom


def prewarp(scan: Scan, to_pixel: PixelMap, grid: Grid) -> tuple[UInt8Array, BoolArray]:
    """The scan resampled onto `grid` (mercator to scan pixel through `to_pixel`), and the mask it covers. Only the part of the scan
    under the grid is shrunk and resampled: a weak guess's crop (`georef/corners.py`) is far wider than the window, and more than
    `cv2.remap` takes."""
    px, py = to_pixel(*grid.centres())
    height, width = scan.pixels.shape
    inside = (px >= 0) & (px < width) & (py >= 0) & (py < height)
    if not inside.any():
        return as_uint8(numpy.zeros(px.shape)), inside
    factor = _shrink_factor(grid.resolution, scan.resolution)
    left, top, right, bottom = _covered_box(px[inside], py[inside], scan.pixels.shape, ceil(2 * factor))
    pixels, applied = _shrunk(scan.pixels[top:bottom, left:right], factor)
    map_x, map_y = ((px - left) / applied - 0.5).astype(numpy.float32), ((py - top) / applied - 0.5).astype(numpy.float32)
    return as_uint8(cv2.remap(pixels, map_x, map_y, cv2.INTER_LINEAR, borderValue=0)), inside


def _eroded(inside: BoolArray) -> BoolArray:
    """The covered mask without its rim (the pre-warp's edge is not a feature)."""
    return numpy.asarray(cv2.erode(inside.astype(numpy.uint8), numpy.ones((ERODE_PX, ERODE_PX), numpy.uint8)).astype(bool))


@dataclass(frozen=True)
class _LevelImages:
    """One level: its grid, the CLAHE'd pre-warped scan and its mask, the references and the search reach."""

    grid: Grid
    scan: UInt8Array
    mask: BoolArray
    s2: UInt8Array | None
    osm: UInt8Array | None
    search_px: float

    def tiles(self, channel: str, scan: UInt8Array, reference: UInt8Array) -> TileMatcher:
        return TileMatcher(channel, scan, reference, self.mask, self.search_px, self.grid.resolution)


def _tile(matcher: TileMatcher, cell: int, tiles: Tiles) -> list[Candidate]:
    """The cell's tile in one channel, counted when it was tried."""
    if not matcher.tried(cell):
        return []
    found = matcher.match(cell)
    tiles.count(matcher.channel, found is not None)
    return [] if found is None else [Candidate(cell, found.scan, found.reference, found.margin, matcher.channel)]


def _s2_candidates(images: _LevelImages, method: Method, tiles: Tiles) -> list[Candidate]:
    """Feature matches per cell on `s2`; a cell without one falls back to its tile."""
    if images.s2 is None:
        return []
    size = (images.grid.width, images.grid.height)
    cells = CellMatcher(method, detect(method, images.scan, images.mask), detect(method, images.s2, None), size, images.search_px)
    fallback = images.tiles("s2", images.scan, images.s2)
    found: list[Candidate] = []
    for cell in range(CELLS * CELLS):
        matches = [Candidate(cell, match.scan, match.reference, match.margin, "s2") for match in cells.matches(cell)]
        found += matches or _tile(fallback, cell, tiles)
    return found


def _osm_candidates(images: _LevelImages, tiles: Tiles) -> list[Candidate]:
    """Every cell's tile of the scan's lines against the OSM proximity field."""
    if images.osm is None:
        return []
    matcher = images.tiles("osm", lines(images.scan, images.grid.resolution), images.osm)
    return [candidate for cell in range(CELLS * CELLS) for candidate in _tile(matcher, cell, tiles)]


def _level_images(scan: Scan, to_pixel: PixelMap, references: References, level: tuple[Grid, float]) -> _LevelImages:
    grid, search_m = level
    warped, inside = prewarp(scan, to_pixel, grid)
    size = (grid.width, grid.height)
    s2 = None if "s2" not in references.channels or references.s2 is None else enhance(resize(references.s2, size))
    osm = None if "osm" not in references.channels or references.osm is None else proximity(lines_at(references.osm, size), grid.resolution)
    return _LevelImages(grid, enhance(warped), _eroded(inside), s2, osm, search_m / grid.resolution)


def metres_per_px(grid: Grid) -> float:
    """Ground metres per pixel of `grid` at its centre."""
    _, lat = to_lnglat(grid.left + grid.width * grid.resolution / 2, grid.top - grid.height * grid.resolution / 2)
    return grid.resolution * ground_scale(lat)


def _to_pairs(kept: Sequence[Scored], to_pixel: PixelMap, grid: Grid) -> list[AutoPair]:
    """The pairs as GCPs: the pre-warped point back to scan pixels, the reference point to WGS84."""
    if not kept:
        return []
    scan_u, scan_v = numpy.array([pair.candidate.scan for pair in kept]).T
    ref_u, ref_v = numpy.array([pair.candidate.reference for pair in kept]).T
    px, py = to_pixel(*grid.to_mercator(scan_u, scan_v))
    lng, lat = to_lnglat_arrays(*grid.to_mercator(ref_u, ref_v))
    return [
        AutoPair(
            Gcp(f"t{index}", float(x), float(y), float(la), float(lo), True, "auto", pair.score),
            pair.candidate.cell,
            pair.candidate.channel,
        )
        for index, (pair, x, y, la, lo) in enumerate(zip(kept, px, py, lat, lng, strict=True), start=1)
    ]


def _inside_scan(pairs: list[AutoPair], width: int, height: int) -> list[AutoPair]:
    return [pair for pair in pairs if 0 <= pair.gcp.x <= width and 0 <= pair.gcp.y <= height]


@dataclass(frozen=True)
class _Matching:
    scan: Scan
    references: References
    method: Method


def _level(matching: _Matching, to_pixel: PixelMap, factor: int, search_m: float) -> tuple[list[AutoPair], Tiles]:
    """One level's pairs (inside the scan) and its tiles."""
    grid = matching.references.grid.scaled(factor)
    images = _level_images(matching.scan, to_pixel, matching.references, (grid, search_m))
    tiles = Tiles()
    candidates = _s2_candidates(images, matching.method, tiles) + _osm_candidates(images, tiles)
    height, width = matching.scan.pixels.shape
    return _inside_scan(_to_pairs(consensus(candidates, metres_per_px(grid)), to_pixel, grid), width, height), tiles


def _method(scan: Scan, initial: PixelMap, references: References) -> Method:
    """SIFT, or ORB when SIFT finds too few keypoints on the scan pre-warped onto the finest grid."""
    warped, inside = prewarp(scan, initial, references.grid)
    return choose(enhance(warped), _eroded(inside))


def _refit(pairs: Sequence[AutoPair]) -> PixelMap | None:
    """The transform a level's pairs give for the next pre-warp (None when they are too few or degenerate)."""
    gcps = [pair.gcp for pair in pairs]
    kind = transform_kind(gcps)
    refit = fit_transform(kind, gcps) if kind is not None else None
    return None if refit is None else refit.to_pixel


def _coarse_to_fine(matching: _Matching, initial: PixelMap) -> tuple[list[AutoPair], Tiles]:
    """The pairs of the finest level that refit the transform, else those of the finest level."""
    to_pixel, best = initial, None
    last: tuple[list[AutoPair], Tiles] = ([], Tiles())
    for factor, search_m in LEVELS:
        last = _level(matching, to_pixel, factor, search_m)
        refit = _refit(last[0])
        if refit is not None:
            to_pixel, best = refit, last
    return best or last


def match(scan: Scan, initial: PixelMap, references: References) -> MatchResult:
    """Automatic pairs of the scan against the references, coarse to fine (none when nothing matches)."""
    if not references.channels:
        raise ValueError("the matcher needs a Sentinel-2 image or OpenStreetMap lines")
    matching = _Matching(scan, references, _method(scan, initial, references))
    pairs, tiles = _coarse_to_fine(matching, initial)
    strongest = sorted(pairs, key=lambda pair: -(pair.gcp.score or 0.0))[:MAX_AUTO_GCPS]
    return MatchResult(matching.method.name, references.channels, tuple(strongest), tiles)
