"""How far apart two parts lie along a seam (docs/research/M8-join-interfaces.md §3, `align` 3 to 6).

A tile of one part is looked for in the other, both contrast-enhanced and high-passed so the frames' different tones do
not count. A coarse pass finds the seam's offset and refuses a pair too far apart to be a seam at all; a fine pass, around
the coarse median, measures it. The kept samples give the model `s(u)`: where along the seam the parts differ by how much.
A shift is what a feature in part `a` needs to reach the same feature in part `b`.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Final

import cv2
import numpy
import numpy.typing

from hcm_pipeline.geo import FloatArray, Grid, zoom_resolution
from hcm_pipeline.georef.autogcp import WELL_SPREAD
from hcm_pipeline.georef.tiles import FloatImage, peak_margin
from hcm_pipeline.images import as_uint8, enhance
from hcm_pipeline.join.canvas import COARSE_ZOOM, FINE_ZOOM, Patch, PixelBox, TileSource
from hcm_pipeline.join.seams import Sample, Seam

COARSE_TILE_PX: Final = 64
FINE_TILE_PX: Final = 256
# ±600 m, over the ±400 m of the design: the search must see beyond `TOO_FAR_M`, or a pair 500 m apart would look unmeasurable
# and render double streets instead of failing.
COARSE_SEARCH_M: Final = 600.0
FINE_SEARCH_M: Final = 40.0
TOO_FAR_M: Final = 300.0
MIN_VALID_SHARE: Final = 0.9
MIN_PEAK: Final = 0.5
MIN_MARGIN: Final = 0.05
HIGH_PASS_SIGMA_PX: Final = 8.0
FLAT_SPREAD: Final = 1e-3
MAD_LIMIT: Final = 3.0
# A spread this small is the measurement's own noise (Mercator metres): nothing is an outlier against it.
MAD_FLOOR_M: Final = 1.0
MIN_CONSTANT_SAMPLES: Final = 6
MIN_QUADRATIC_SAMPLES: Final = 12
HOLD_OUT_FROM: Final = 10
HOLD_OUT_EVERY: Final = 5
QUADRATIC_TERMS: Final = 3


@dataclass(frozen=True)
class Shift:
    """A measured offset in the level's pixels (x east, y down)."""

    dx: float
    dy: float

    def metres(self, resolution: float) -> tuple[float, float]:
        """In EPSG:3857 metres (x east, y north)."""
        return self.dx * resolution, -self.dy * resolution


def prepared(patch: Patch) -> FloatImage:
    """A patch with its no data filled by its own median (an edge of no data matches nothing), enhanced and high-passed."""
    valid = patch.alpha > 0
    fill = float(numpy.median(patch.grey[valid])) if valid.any() else 0.0
    flat = as_uint8(numpy.where(valid, patch.grey, fill))
    image = enhance(flat).astype(numpy.float32)
    return numpy.asarray(image - cv2.GaussianBlur(image, (0, 0), HIGH_PASS_SIGMA_PX), numpy.float32)


def _parabola(low: float, middle: float, high: float) -> float:
    """The sub-pixel place of a peak between its two neighbours."""
    curve = low - 2.0 * middle + high
    return 0.0 if curve >= 0.0 else float(numpy.clip(0.5 * (low - high) / curve, -0.5, 0.5))


def _on_border(response: FloatImage, x: int, y: int) -> bool:
    height, width = response.shape
    return x in (0, width - 1) or y in (0, height - 1)


def locate(tile: FloatImage, area: FloatImage) -> tuple[float, float] | None:
    """Where the tile's corner best lies in the area (sub-pixel): None for a flat tile, a weak or ambiguous peak, or a peak on the
    search's edge, which may only be the slope of a peak outside it."""
    if float(tile.std()) < FLAT_SPREAD or float(area.std()) < FLAT_SPREAD:
        return None
    response = numpy.nan_to_num(numpy.asarray(cv2.matchTemplate(area, tile, cv2.TM_CCOEFF_NORMED), numpy.float32))
    margin, (x, y) = peak_margin(response)
    if _believed(float(response[y, x]), margin) and not _on_border(response, x, y):
        return _subpixel(response, x, y)
    return None


def _believed(peak: float, margin: float) -> bool:
    return peak >= MIN_PEAK and margin >= MIN_MARGIN


def _subpixel(response: FloatImage, x: int, y: int) -> tuple[float, float]:
    return (
        x + _parabola(float(response[y, x - 1]), float(response[y, x]), float(response[y, x + 1])),
        y + _parabola(float(response[y - 1, x]), float(response[y, x]), float(response[y + 1, x])),
    )


@dataclass(frozen=True)
class MatchPass:
    """A pass's tile and how far around it (pixels of its level)."""

    tile_px: int
    reach_px: int


def match_tile(a: TileSource, b: TileSource, place: tuple[int, int], step: MatchPass, prior: tuple[int, int] = (0, 0)) -> Shift | None:
    """The tile of `a` at `place` looked for in `b`, `reach_px` around `prior`: it counts only where both parts hold it."""
    half = step.tile_px // 2
    box = PixelBox(0, 0, 0, 0).around(place[0], place[1], half)
    tile = a.read(box)
    if tile.valid_share() < MIN_VALID_SHARE or b.read(box).valid_share() < MIN_VALID_SHARE:
        return None
    found = locate(prepared(tile), prepared(b.read(box.moved(*prior).grown(step.reach_px))))
    return None if found is None else Shift(prior[0] + found[0] - step.reach_px, prior[1] + found[1] - step.reach_px)


def _place(grid: Grid, sample: Sample) -> tuple[int, int]:
    x, y = grid.to_pixel(numpy.array(sample.x), numpy.array(sample.y))
    return int(x), int(y)


def coarse_pass(a: TileSource, b: TileSource, grid: Grid, samples: Sequence[Sample], ground: float) -> dict[Sample, Shift]:
    """The samples whose coarse tile matched, with their shifts in `grid`'s pixels."""
    step = MatchPass(COARSE_TILE_PX, round(COARSE_SEARCH_M / ground / grid.resolution))
    found = {sample: match_tile(a, b, _place(grid, sample), step) for sample in samples}
    return {sample: shift for sample, shift in found.items() if shift is not None}


def rmse_m(shifts: Sequence[Shift], grid: Grid, ground: float) -> float:
    """The shifts' root mean square on the ground."""
    squares = [dx * dx + dy * dy for dx, dy in (shift.metres(grid.resolution) for shift in shifts)]
    return float(numpy.sqrt(numpy.mean(squares))) * ground


def median_shift(shifts: Sequence[Shift]) -> Shift:
    return Shift(float(numpy.median([shift.dx for shift in shifts])), float(numpy.median([shift.dy for shift in shifts])))


def within_mad(values: FloatArray) -> numpy.typing.NDArray[numpy.bool_]:
    """The values within `MAD_LIMIT` median absolute deviations of their median."""
    away = numpy.abs(values - numpy.median(values))
    return numpy.asarray(away <= MAD_LIMIT * max(float(numpy.median(away)), MAD_FLOOR_M), numpy.bool_)


@dataclass(frozen=True)
class Kept:
    """A sample of the fine pass that survived, with its shift in EPSG:3857 metres."""

    sample: Sample
    dx: float
    dy: float


def kept_samples(found: dict[Sample, Shift], resolution: float) -> tuple[Kept, ...]:
    """The fine pass's samples without those beyond `MAD_LIMIT` on either axis, in order along the seam."""
    if not found:
        return ()
    samples = sorted(found, key=_position)
    moved = numpy.array([found[sample].metres(resolution) for sample in samples])
    good = within_mad(moved[:, 0]) & within_mad(moved[:, 1])
    return tuple(Kept(samples[index], *moved[index].tolist()) for index in numpy.flatnonzero(good).tolist())


def _position(sample: Sample) -> float:
    return sample.u


def held_out(kept: Sequence[Kept]) -> tuple[Kept, ...]:
    """Every fifth kept sample, once there are enough to spare."""
    return tuple(kept[HOLD_OUT_EVERY - 1 :: HOLD_OUT_EVERY]) if len(kept) >= HOLD_OUT_FROM else ()


@dataclass(frozen=True)
class SeamModel:
    """`s(u)`: polynomials in kilometres along the seam (highest power first), clamped outside the sampled range."""

    x: tuple[float, ...]
    y: tuple[float, ...]
    low: float
    high: float

    def at(self, u: FloatArray) -> tuple[FloatArray, FloatArray]:
        clamped = numpy.clip(u, self.low, self.high)
        return numpy.asarray(numpy.polyval(self.x, clamped), numpy.float64), numpy.asarray(numpy.polyval(self.y, clamped), numpy.float64)

    def largest_m(self) -> float:
        """The model's longest shift along the seam (Mercator metres)."""
        dx, dy = self.at(numpy.linspace(self.low, self.high, 33))
        return float(numpy.hypot(dx, dy).max())


def _quadratic(u: FloatArray, values: FloatArray) -> tuple[float, ...]:
    solved, _, _, _ = numpy.linalg.lstsq(numpy.vander(u, QUADRATIC_TERMS), values, rcond=None)
    return tuple(float(value) for value in solved)


def fit_model(kept: Sequence[Kept], length_m: float) -> SeamModel | None:
    """A quadratic from `MIN_QUADRATIC_SAMPLES` well-spread samples, the median from `MIN_CONSTANT_SAMPLES`, else nothing. The
    held-out samples do not take part: they judge the correction later."""
    if len(kept) < MIN_CONSTANT_SAMPLES:
        return None
    u, dx, dy = _training(kept)
    low, high = float(u.min()), float(u.max())
    if _bends(len(kept), (high - low) * 1000.0 / max(length_m, 1.0)):
        return SeamModel(_quadratic(u, dx), _quadratic(u, dy), low, high)
    return SeamModel((float(numpy.median(dx)),), (float(numpy.median(dy)),), low, high)


def _bends(count: int, spread: float) -> bool:
    return count >= MIN_QUADRATIC_SAMPLES and spread >= WELL_SPREAD


def _training(kept: Sequence[Kept]) -> tuple[FloatArray, FloatArray, FloatArray]:
    """Where along the seam, and the two shifts, of the kept samples not held out."""
    spare = held_out(kept)
    used = numpy.array([(item.sample.u, item.dx, item.dy) for item in kept if item not in spare])
    return used[:, 0], used[:, 1], used[:, 2]


@dataclass(frozen=True)
class Measured:
    """What the passes found on a seam: `coarse_m`, its coarse offset on the ground (0 when few tiles matched); no `model`: unmeasured."""

    seam: Seam
    kept: tuple[Kept, ...] = ()
    model: SeamModel | None = None
    coarse_m: float = 0.0

    def judged(self) -> tuple[Sample, ...]:
        """The samples the correction is judged on: the held-out ones, or every kept one when too few could be spared."""
        spare = held_out(self.kept) or self.kept
        return tuple(item.sample for item in spare)


FineSources = Callable[[], tuple[TileSource, TileSource, Grid]]


def _fine_pass(seam: Seam, sources: FineSources, prior: Shift) -> tuple[Kept, ...]:
    a, b, grid = sources()
    step = MatchPass(FINE_TILE_PX, round(FINE_SEARCH_M / seam.ground / grid.resolution))
    start = round(prior.dx), round(prior.dy)
    found = {sample: match_tile(a, b, _place(grid, sample), step, start) for sample in seam.samples}
    return kept_samples({sample: shift for sample, shift in found.items() if shift is not None}, grid.resolution)


def measure_seam(a: TileSource, b: TileSource, coarse: Grid, seam: Seam, sources: FineSources) -> Measured:
    """The seam's passes: the fine pass reads the scans, so it runs only once the coarse one found enough to measure."""
    found = coarse_pass(a, b, coarse, seam.samples, seam.ground)
    if len(found) < MIN_CONSTANT_SAMPLES:
        return Measured(seam, tuple(Kept(sample, 0.0, 0.0) for sample in found))
    median = median_shift(list(found.values()))
    offset_m = rmse_m([median], coarse, seam.ground)
    if offset_m > TOO_FAR_M:
        return Measured(seam, coarse_m=offset_m)
    ratio = zoom_resolution(COARSE_ZOOM) / zoom_resolution(FINE_ZOOM)
    kept = _fine_pass(seam, sources, Shift(median.dx * ratio, median.dy * ratio))
    return Measured(seam, kept, fit_model(kept, seam.length_m), offset_m)
