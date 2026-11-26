"""The reference guard: no Sentinel-2 scene moves a city silently (docs/research/M15-calibration-accuracy.md, *The reference guard*).

Some dates of one tile sit rigidly about 12 m off the others (35TMK: 2024-10-21, 2024-10-26 and 2025-01-19, baseline 05.11), and
the least cloudy scene alone could be one of them. So the reference is chosen by agreement: up to `CANDIDATES` clear sets that
cover the window (`stac.choose`, a date's mosaic or several dates across an orbit seam), each `GAP_DAYS` from the others so one
bad period counts once, are read over the same patch (at most `PATCH_HALF_M` each side of the window's middle, on a transverse
Mercator grid centred there: ground metres east and north at any latitude, across UTM zones and tiles); every pair's rigid offset
is the median of its 900 m tiles; each set is placed against the median of all of them; a set further than `REJECT_M` is
rejected; the least cloudy set that agrees is the reference. Fewer than `MIN_AGREEING` placed sets cannot outvote one another:
the first is taken and the check says `unchecked`; placed sets that all disagree say `disputed`. The record (`s2Check` of the
version's reference) names every set, its offset and whether it was kept.
"""

import math
import statistics
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from itertools import chain, combinations, product
from typing import Final

import cv2
import numpy

from hcm_pipeline.calibrate.dense import film_filter
from hcm_pipeline.calibrate.poly import Image
from hcm_pipeline.contract import S2_CHECK_STATUSES
from hcm_pipeline.geo import Bounds
from hcm_pipeline.raster import gdal
from hcm_pipeline.stac import StacItem, choose

CANDIDATES: Final = 5
GAP_DAYS: Final = 30
# 79 scenes of 35TMK at baseline 05.xx against their median: the clean ones at most 6.2 m off, the three shifted dates 8.7 to 11.8.
REJECT_M: Final = 7.5
MIN_AGREEING: Final = 3
CELL_M: Final = 10.0
PATCH_HALF_M: Final = 5000.0
TILE_CELLS: Final = 90
STEP_CELLS: Final = 60
# 50 m each way: three times the largest shift seen, short of locking on to a neighbouring field's edge.
SEARCH_CELLS: Final = 5
MIN_PEAK: Final = 0.3
MIN_TILES: Final = 12
MIN_VALID: Final = 0.9
FLAT: Final = 1e-6

AGREED, UNCHECKED, DISPUTED = S2_CHECK_STATUSES

Candidate = tuple[StacItem, ...]
ProgressCallback = Callable[[float, str, object], int]


@dataclass(frozen=True)
class Offset:
    """Ground metres east and north."""

    east: float
    north: float

    @property
    def size(self) -> float:
        return math.hypot(self.east, self.north)


ZERO: Final = Offset(0.0, 0.0)
# What an unplaced set counts as: beyond any bound.
REJECTED: Final = Offset(math.inf, 0.0)
Places = tuple[Offset | None, ...]


@dataclass(frozen=True)
class Patch:
    """One candidate over the patch: grey and its filter, on the shared grid."""

    filtered: Image
    valid: Image


def _day(text: str) -> int | None:
    try:
        return date.fromisoformat(text).toordinal()
    except ValueError:
        return None


def _apart(item: StacItem, chosen: Candidate) -> bool:
    """True when `item` is `GAP_DAYS` or more from every date of `chosen` (a date that cannot be read is apart)."""
    day = _day(item.date)
    days = [_day(other.date) for other in chosen]
    return day is None or all(other is None or abs(day - other) >= GAP_DAYS for other in days)


def _left(items: Sequence[StacItem], chosen: Candidate) -> list[StacItem]:
    """The items still to choose from: the chosen ones go even when their date cannot be read (then "apart" from everything, themselves
    included), and so does every item within `GAP_DAYS` of them."""
    return [item for item in items if _apart(item, chosen) and item not in chosen]


def candidates(items: Sequence[StacItem], bounds: Bounds) -> list[Candidate]:
    """Up to `CANDIDATES` sets that cover the window (least cloudy first, as `choose` picks), each `GAP_DAYS` from the others."""
    found: list[Candidate] = []
    chosen = tuple(choose(items, bounds))
    while chosen and len(found) < CANDIDATES:
        found.append(chosen)
        items = _left(items, chosen)
        chosen = tuple(choose(items, bounds))
    return found


def local_grid(lng: float, lat: float) -> str:
    """A transverse Mercator centred on the window: east and north in ground metres, true at any latitude or UTM zone."""
    return f"+proj=tmerc +lat_0={lat:.6f} +lon_0={lng:.6f} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs"


def patch_half_m(bounds: Bounds) -> float:
    """Half the patch's side: `PATCH_HALF_M`, or less on a window narrower than the patch."""
    north_m = (bounds.north - bounds.south) * 111_320.0
    east_m = (bounds.east - bounds.west) * 111_320.0 * math.cos(math.radians(bounds.middle_lat))
    return min(PATCH_HALF_M, north_m / 2, east_m / 2)


def read_patch(sources: Sequence[str], bounds: Bounds, progress: ProgressCallback | None = None) -> Patch:
    """The sources (one set's assets, mosaicked) over the patch at `CELL_M`; RuntimeError when GDAL cannot read them."""
    half = math.floor(patch_half_m(bounds) / CELL_M) * CELL_M
    grid = local_grid((bounds.west + bounds.east) / 2, bounds.middle_lat)
    options = {"dstSRS": grid, "xRes": CELL_M, "yRes": CELL_M, "resampleAlg": "bilinear", "srcNodata": 0, "dstNodata": 0}
    dataset = gdal.Warp("", list(sources), format="MEM", outputBounds=(-half, -half, half, half), callback=progress, **options)
    bands = numpy.asarray(dataset.ReadAsArray(), numpy.float32).reshape(-1, dataset.RasterYSize, dataset.RasterXSize)
    dataset.Close()
    return patch_of(bands)


def patch_of(bands: Image) -> Patch:
    """The grey (mean of the bands) and its filter; a cell is valid when every band has data."""
    valid = numpy.asarray(numpy.all(bands > 0, axis=0), numpy.float32)
    return Patch(film_filter(numpy.asarray(bands.mean(axis=0), numpy.float32), valid), valid)


def _subcell(left: float, middle: float, right: float) -> float:
    curve = left - 2 * middle + right
    return 0.0 if abs(curve) < FLAT else 0.5 * (left - right) / curve


def _usable(a: Patch, b: Patch, cells: tuple[slice, slice], search: tuple[slice, slice]) -> bool:
    """A tile with data on both sides and texture in `b`."""
    return bool(min(b.valid[cells].mean(), a.valid[search].mean()) >= MIN_VALID and b.filtered[cells].std() >= FLAT)


def _tile_shift(a: Patch, b: Patch, row: int, column: int) -> Offset | None:
    """Where `b` puts the tile at (row, column) less where `a` does; None for a tile without data, texture or a clear peak."""
    cells = (slice(row, row + TILE_CELLS), slice(column, column + TILE_CELLS))
    search = (slice(row - SEARCH_CELLS, row + TILE_CELLS + SEARCH_CELLS), slice(column - SEARCH_CELLS, column + TILE_CELLS + SEARCH_CELLS))
    if not _usable(a, b, cells, search):
        return None
    scores = cv2.matchTemplate(a.filtered[search], b.filtered[cells], cv2.TM_CCOEFF_NORMED)
    _, peak, _, (x, y) = cv2.minMaxLoc(scores)
    if peak < MIN_PEAK or not (0 < x < scores.shape[1] - 1 and 0 < y < scores.shape[0] - 1):
        return None
    dx = x - SEARCH_CELLS + _subcell(scores[y, x - 1], peak, scores[y, x + 1])
    dy = y - SEARCH_CELLS + _subcell(scores[y - 1, x], peak, scores[y + 1, x])
    return Offset(float(-dx * CELL_M), float(dy * CELL_M))


def _starts(length: int) -> range:
    return range(SEARCH_CELLS, length - TILE_CELLS - SEARCH_CELLS, STEP_CELLS)


def pair_offset(a: Patch, b: Patch) -> Offset | None:
    """`b`'s place less `a`'s, the median of its tiles; None under `MIN_TILES` tiles read."""
    height, width = a.filtered.shape
    shifts = (_tile_shift(a, b, row, column) for row, column in product(_starts(height), _starts(width)))
    read = [shift for shift in shifts if shift is not None]
    return _median(read) if len(read) >= MIN_TILES else None


def _median(offsets: Sequence[Offset]) -> Offset:
    return Offset(statistics.median(offset.east for offset in offsets), statistics.median(offset.north for offset in offsets))


def readings(patches: Sequence[Patch | None]) -> dict[tuple[int, int], Offset]:
    """Every measured pair `(i, j)`: j's place less i's."""
    found: dict[tuple[int, int], Offset] = {}
    for i, j in combinations(range(len(patches)), 2):
        a, b = patches[i], patches[j]
        offset = pair_offset(a, b) if a is not None and b is not None else None
        if offset is not None:
            found[i, j] = offset
    return found


def _against(index: int, measured: Mapping[tuple[int, int], Offset], members: frozenset[int]) -> list[Offset]:
    """`index`'s place less each member's, from the pairs it was measured in (itself counting zero when it is a member)."""
    ahead = [Offset(-offset.east, -offset.north) for (i, j), offset in measured.items() if (i, j in members) == (index, True)]
    behind = [offset for (i, j), offset in measured.items() if (j, i in members) == (index, True)]
    return [ZERO] * (index in members) + ahead + behind


def placed(count: int, measured: Mapping[tuple[int, int], Offset], members: frozenset[int]) -> Places:
    """Each set against the members' consensus: the median of its place less each member's; None when no member was compared."""
    places: list[Offset | None] = []
    for index in range(count):
        against = _against(index, measured, members)
        compared = len(against) > (index in members)
        places.append(_median(against) if compared else None)
    return tuple(places)


def _trimmed(count: int, measured: Mapping[tuple[int, int], Offset], members: frozenset[int]) -> tuple[frozenset[int], Places]:
    """The members within `REJECT_M` of their own consensus, re-centred until none leaves: two shifted dates of five pull a plain
    median by 2 to 3 m, enough to keep a third at 8.7 m; once they are out, the rest agree."""
    offsets = placed(count, measured, members)
    for _ in range(count):
        within = _within(offsets)
        if within == members:
            break
        members = within
        offsets = placed(count, measured, members)
    return members, offsets


def _within(offsets: Places) -> frozenset[int]:
    """The sets placed within `REJECT_M` of the consensus."""
    return frozenset(index for index, offset in enumerate(offsets) if (offset or REJECTED).size <= REJECT_M)


@dataclass(frozen=True)
class Agreement:
    """The guard's verdict: the chosen set, each set's offset from the consensus, and whether it was kept."""

    status: str
    chosen: int
    offsets: Places
    kept: tuple[bool, ...]

    def as_record(self, sets: Sequence[Candidate]) -> dict[str, object]:
        scenes = [_scene(found, offset, kept) for found, offset, kept in zip(sets, self.offsets, self.kept, strict=True)]
        return {"status": self.status, "boundM": REJECT_M, "chosen": self.chosen, "scenes": scenes}


def _scene(found: Candidate, offset: Offset | None, kept: bool) -> dict[str, object]:
    first = found[0]
    scene: dict[str, object] = {"items": [item.id for item in found], "date": first.date, "cloud": round(first.cloud, 2), "kept": kept}
    if offset is not None:
        scene |= {"eastM": round(offset.east, 2), "northM": round(offset.north, 2)}
    return scene


def decide(count: int, measured: Mapping[tuple[int, int], Offset]) -> Agreement:
    """The least cloudy set within `REJECT_M` of the consensus of a majority (`kept`: every set that agrees); else the least cloudy
    set that was read, or the first when none was, alone `kept` (`unchecked` under `MIN_AGREEING` sets read, `disputed` when no
    majority agrees: its offsets are then against all the sets read)."""
    read = frozenset(chain.from_iterable(measured))
    members, offsets = _trimmed(count, measured, read) if len(read) >= MIN_AGREEING else (frozenset(), ())
    if 2 * len(members) > len(read):
        return Agreement(AGREED, min(members), offsets, _flags(count, members))
    first = min(read, default=0)
    status = UNCHECKED if len(read) < MIN_AGREEING else DISPUTED
    return Agreement(status, first, placed(count, measured, read), _flags(count, frozenset({first})))


def _flags(count: int, members: frozenset[int]) -> tuple[bool, ...]:
    return tuple(index in members for index in range(count))
