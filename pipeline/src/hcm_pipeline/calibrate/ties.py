"""Film ties: a frame's warp against a frame held still, tile by tile (docs/research/M15-calibration-accuracy.md, *Joint solve*).

Every frame a proof placed keeps `align.tif`: its layer at `ALIGN_GROUND_M` (grey, 0 where it has no data, deflated; a median of
18 MB in the evidence), on a grid aligned on whole cells of the city's window, so two frames' images share their cells. A tile of the
held frame (900 m, every 450 m) is looked for in the joining frame's own image within `SEARCH_GROUND_M`, both filtered as the proof
filters film (`film_filter`); a tile counts with a clear peak (the proof's gates) inside the search. Its tie is the place the held frame
shows the tile's middle at, and the joining frame's film pixel that shows the same feature: its warp's own place-to-pixel transform at
that place plus the offset found, so the tie holds whatever map the image was rendered with.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from itertools import product
from typing import Final

import cv2
import numpy

from hcm_pipeline.calibrate.dense import PROOF_MIN_MARGIN, PROOF_MIN_PEAK, PROOF_TILE_GROUND_M, film_filter
from hcm_pipeline.calibrate.joint import PartnerTies
from hcm_pipeline.calibrate.poly import Image
from hcm_pipeline.geo import FloatArray, ground_scale

ALIGN_GROUND_M: Final = 5.0
STEP_GROUND_M: Final = 450.0
SEARCH_GROUND_M: Final = 150.0
GROSS_M: Final = 100.0
MIN_VALID: Final = 0.98
FLAT: Final = 1e-3
EXCLUSION_CELLS: Final = 8

# A tile's cells and the search around it (rows, columns).
Window = tuple[slice, slice]
Windows = tuple[Window, Window]
# Film pixels of the joining frame for EPSG:3857 places, through its warp's own transform.
ToFilm = Callable[[FloatArray], FloatArray]


def align_cell(middle_lat: float) -> float:
    """The side of an align image's cell in EPSG:3857 metres: `ALIGN_GROUND_M` on the ground at the window's middle."""
    return ALIGN_GROUND_M / ground_scale(middle_lat)


@dataclass(frozen=True)
class AlignImage:
    """An image on the align grid: grey (0 where there is no data), its top-left corner and cell (EPSG:3857 metres)."""

    grey: numpy.ndarray
    left: float
    top: float
    cell: float

    def places(self, columns: FloatArray, rows: FloatArray) -> FloatArray:
        """EPSG:3857 places of fractional cell positions (a cell's middle at +0.5)."""
        return numpy.column_stack((self.left + columns * self.cell, self.top - rows * self.cell))


@dataclass(frozen=True)
class _Filtered:
    filtered: Image
    valid: Image


def _filtered(image: AlignImage) -> _Filtered:
    valid = numpy.asarray(image.grey > 0, numpy.float32)
    return _Filtered(film_filter(numpy.asarray(image.grey, numpy.float32), valid), valid)


@dataclass(frozen=True)
class _Cells:
    """The tile, its step and the search in cells."""

    tile: int
    step: int
    search: int

    @classmethod
    def of(cls, ground_cell: float) -> _Cells:
        return cls(round(PROOF_TILE_GROUND_M / ground_cell), round(STEP_GROUND_M / ground_cell), round(SEARCH_GROUND_M / ground_cell))


def _subcell(left: float, middle: float, right: float) -> float:
    curve = left - 2 * middle + right
    return 0.0 if abs(curve) < FLAT else 0.5 * (left - right) / curve


def _usable(ours: _Filtered, theirs: _Filtered, cells: Window, search: Window) -> bool:
    full = min(float(theirs.valid[cells].mean()), float(ours.valid[search].mean())) >= MIN_VALID
    return full and float(theirs.filtered[cells].std()) >= FLAT


def _margin(scores: Image, x: int, y: int, peak: float) -> float:
    others = scores.copy()
    others[max(y - EXCLUSION_CELLS, 0) : y + EXCLUSION_CELLS + 1, max(x - EXCLUSION_CELLS, 0) : x + EXCLUSION_CELLS + 1] = -1
    return peak - float(others.max())


def _windows(at: tuple[int, int], cells: _Cells) -> Windows:
    """The held frame's tile at (row, column) and the search around it in ours."""
    row, column = at
    tile = (slice(row, row + cells.tile), slice(column, column + cells.tile))
    around = cells.tile + cells.search
    return tile, (slice(row - cells.search, row + around), slice(column - cells.search, column + around))


def _shift(ours: _Filtered, theirs: _Filtered, windows: Windows, search: int) -> tuple[float, float] | None:
    """Where ours shows the tile less where the held frame does, in cells (right, down); None when the peak is not clear or lies on the
    search's edge."""
    tile, around = windows
    scores = numpy.asarray(cv2.matchTemplate(ours.filtered[around], theirs.filtered[tile], cv2.TM_CCOEFF_NORMED), numpy.float32)
    _, peak, _, (x, y) = cv2.minMaxLoc(scores)
    inside = 0 < x < scores.shape[1] - 1 and 0 < y < scores.shape[0] - 1
    if not inside or peak < PROOF_MIN_PEAK or _margin(scores, x, y, peak) < PROOF_MIN_MARGIN:
        return None
    return x - search + _subcell(scores[y, x - 1], peak, scores[y, x + 1]), y - search + _subcell(scores[y - 1, x], peak, scores[y + 1, x])


def _starts(length: int, cells: _Cells) -> range:
    return range(cells.search, length - cells.tile - cells.search, cells.step)


@dataclass(frozen=True)
class Matched:
    """The held frame's tiles found in ours: each one's middle (cells), its offset (cells, right and down), and the tiles tried."""

    middles: FloatArray
    offsets: FloatArray
    tried: int


def _windowed(height: int, width: int, cells: _Cells) -> list[tuple[tuple[int, int], Windows]]:
    """Every tile's corner (row, column) and its windows."""
    return [((row, column), _windows((row, column), cells)) for row, column in product(_starts(height, cells), _starts(width, cells))]


def _arrays(kept: Sequence[tuple[tuple[int, int], tuple[float, float]]], tile: int) -> tuple[FloatArray, FloatArray]:
    """The kept tiles' middles (cells, x then y) and their offsets."""
    middles = numpy.array([[column + tile / 2, row + tile / 2] for (row, column), _ in kept], numpy.float64).reshape(-1, 2)
    return middles, numpy.array([shift for _, shift in kept], numpy.float64).reshape(-1, 2)


def _usable_windows(a: _Filtered, b: _Filtered, cells: _Cells) -> list[tuple[tuple[int, int], Windows]]:
    height, width = a.valid.shape
    return [(at, both) for at, both in _windowed(height, width, cells) if _usable(a, b, *both)]


def _found(
    a: _Filtered, b: _Filtered, usable: Sequence[tuple[tuple[int, int], Windows]], search: int
) -> list[tuple[tuple[int, int], tuple[float, float]]]:
    shifts = [(at, _shift(a, b, both, search)) for at, both in usable]
    return [(at, shift) for at, shift in shifts if shift is not None]


def matched(ours: AlignImage, theirs: AlignImage, ground_cell: float) -> Matched:
    """Every usable tile of `theirs` (same grid as `ours`, same shape) looked for in `ours`."""
    cells, a, b = _Cells.of(ground_cell), _filtered(ours), _filtered(theirs)
    usable = _usable_windows(a, b, cells)
    middles, offsets = _arrays(_found(a, b, usable, cells.search), cells.tile)
    return Matched(middles, offsets, len(usable))


def tied(partner: str, found: Matched, image: AlignImage, to_film: ToFilm, ground_cell: float) -> PartnerTies:
    """The ties of a match: the held frame's place for each tile, and our film pixel at that place plus the offset; a tile whose offset
    is over `GROSS_M` on the ground is no tie."""
    near = numpy.hypot(*found.offsets.T) * ground_cell <= GROSS_M if len(found.offsets) else numpy.zeros(0, numpy.bool_)
    middles, offsets = found.middles[near], found.offsets[near]
    places = image.places(middles[:, 0], middles[:, 1])
    shown = image.places(middles[:, 0] + offsets[:, 0], middles[:, 1] + offsets[:, 1])
    film = to_film(shown) if len(shown) else numpy.empty((0, 2))
    return PartnerTies(partner, numpy.asarray(film, numpy.float64), places, found.tried)
