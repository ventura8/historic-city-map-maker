"""A sheet's neat line found with its series' help (docs/research/M20-import-local.md §3 b step 2, §19.19; lesson of 2026-11-24).

The plan cadastral 1911-1914 (124 sheets, 7072 px wide) had a neat line found on none of its sheets: each is a double frame (the
drawing's own line and a border line about 130 px outside it, the sheet's title and stamps between them), the scanner cut many sheets
on one side, and the frame finder read a 1000 px copy where a one-pixel line is only a shade of grey. So:

1. Each sheet is read keeping its ink (`read_box_inked`, its long side about `LINE_PX`), and only long straight lines are kept (an
   opening along each axis, a few pixels of tilt allowed); every row's and column's share of such lines is its profile, and each
   peak of the profile read along the sheet's turn is a line (`Line`: where it lies, its share of the side, its slope, its ends).
2. The series' cell in scan pixels (`series_cell`): on each axis, the gap between the outermost long lines that most sheets share
   (at least half of them). A double frame gives two gaps (the neat lines' and the border lines'); the neat line is the inner one.
3. Each sheet (`sheet_frame`): on each axis the pair of lines the cell's size apart, or, where a strong line across a side runs off
   the scan (`cut_sides`), the line that survives plus the cell's size (`inferred`); the best evidenced wins (`evidence`). The
   frame's confidence is the weaker axis's; under `CONFIDENT` the sheet has no frame here, and a sheet no finder frames goes to the
   guided queue with its name (`frame-not-found`), never silently.

Memory: one sheet's reduced copy at a time; the series keeps only each sheet's lines.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import cv2
import numpy

from hcm_pipeline.placing.geometry import FloatArray
from hcm_pipeline.placing.raster_io import read_box_inked
from hcm_pipeline.placing.streets import BoolArray, UInt8Array, grey_of
from hcm_pipeline.rasters import raster_info

# The reduced copy's long side: a 7072 px scan is read 4 to 1, each pixel the darkest of the scan's (a one-pixel line survives).
LINE_PX: Final = 1800
# Ink: darker than the paper (its 98th percentile) by this much.
INK_LEVELS: Final = 60.0
PAPER_PERCENTILE: Final = 98
# A long line: a straight run of at least this share of the side; a tilt of this many reduced pixels across a run is allowed.
RUN_SHARE: Final = 0.08
TILT_PX: Final = 2
# Ink this thick across a run (a share of the side, at least `THICK_MIN_PX` reduced pixels) is a filled area, not a line.
THICK_SHARE: Final = 0.02
THICK_MIN_PX: Final = 9
# Two peaks of a profile closer than this many reduced pixels are one line (a double line's two strokes).
BAND_PX: Final = 6
# The sheet's skew is searched within this slope (about 1.7 degrees), in `SKEW_STEPS` steps.
MAX_SKEW: Final = 0.03
SKEW_STEPS: Final = 61
SKEWS: Final = tuple(float(slope) for slope in numpy.linspace(-MAX_SKEW, MAX_SKEW, SKEW_STEPS))
# Each axis's own skew is then refined within this slope of the sheet's turn.
REFINE_SKEW: Final = 0.004
REFINE_STEPS: Final = tuple(float(step) for step in numpy.linspace(-REFINE_SKEW, REFINE_SKEW, 9))
# A profile's peak counts from this share of the side; one side of a pair must span `STRONG`, a full line `FULL`.
FAINT: Final = 0.12
STRONG: Final = 0.4
FULL: Final = 0.6
# A line's ends: these percentiles of its runs along the axis (a stray speck beyond it is no line).
EXTENT_PERCENTILE: Final = 1
# A frame spans this share of the scan's side at least and at most.
FRAME_MIN: Final = 0.6
FRAME_MAX: Final = 0.995
# Two gaps are the same cell within this share; a cell needs this share of the series' sheets (and two at least).
CELL_TOLERANCE: Final = 0.025
SUPPORT: Final = 0.5
# Sheets share a gap within this share of it; a gap shared by this share of the best-shared one's sheets competes with it.
CLUSTER_TOLERANCE: Final = 0.01
NEAR_BEST: Final = 0.8
# The cell is measured between this many strong lines at each end of a side.
OUTERMOST: Final = 2
MIN_SUPPORT: Final = 2
CLOSENESS_DROP: Final = 0.5
# A side placed from the cell's size lies beyond the scan's edge (less this share of it): the scanner cut it.
EDGE_SHARE: Final = 0.03
# At most this share of the cell may be cut off (a line further in is a line of the drawing, or a scanner's streak).
MAX_CUT: Final = 0.2
INFERRED_WEIGHT: Final = 0.8
# A frame is used from this confidence (0-1).
CONFIDENT: Final = 0.4
SIDES: Final = ("top", "right", "bottom", "left")


@dataclass(frozen=True)
class Line:
    """A long straight line on one axis, in full scan pixels: `at` across the axis at the side's middle, `slope` per pixel along it,
    and the share of the side it spans."""

    at: float
    strength: float
    slope: float = 0.0
    # Where it starts and ends along the axis (full pixels): a frame's line runs on to the scan's edge where the scanner cut the side.
    start: float = 0.0
    end: float = 0.0

    def shifted(self, by: float) -> "Line":
        """The same line moved across the axis by `by` pixels (a side the scanner cut, placed from the cell's size)."""
        return Line(self.at + by, 0.0, self.slope)

    def reaches(self, low: float, high: float) -> tuple[bool, bool]:
        """Whether a strong line runs on to within `low` of the axis's start and to past `high`."""
        strong = self.strength >= STRONG
        return strong and self.start <= low, strong and self.end >= high


@dataclass(frozen=True)
class SheetLines:
    """A sheet's long lines: horizontal ones (`rows`, top to bottom), vertical ones (`cols`, left to right), and its size."""

    rows: tuple[Line, ...]
    cols: tuple[Line, ...]
    width: int
    height: int


@dataclass(frozen=True)
class Sides:
    """One axis's two sides (near: top or left), and which of them was placed from the cell's size (None: both were found)."""

    near: Line
    far: Line
    inferred: str | None = None

    @property
    def gap(self) -> float:
        return self.far.at - self.near.at


@dataclass(frozen=True)
class NeatLine:
    """A sheet's frame: its four corners in full scan pixels (top left first, clockwise), how sure it is (0-1) and the side placed
    from the series' cell (`top`, `right`, `bottom`, `left`), if any."""

    corners: FloatArray
    confidence: float
    inferred: str | None = None

    @property
    def confident(self) -> bool:
        return self.confidence >= CONFIDENT


def read_lines(path: Path) -> SheetLines:
    """The sheet's long lines, read from a reduced copy that keeps its ink."""
    info = raster_info(path)
    width, height = info.width, info.height
    factor = max(1, -(-max(width, height) // LINE_PX))
    size = (max(1, width // factor), max(1, height // factor))
    grey = grey_of(read_box_inked(path, (0, 0, size[0] * factor, size[1] * factor), size))
    return lines_of(grey, (width, height))


def lines_of(grey: UInt8Array, full: tuple[int, int]) -> SheetLines:
    """The long lines of a reduced copy `grey` of a scan `full` pixels in size (width, height)."""
    ink = grey < float(numpy.percentile(grey, PAPER_PERCENTILE)) - INK_LEVELS
    scale = (full[0] / grey.shape[1], full[1] / grey.shape[0])
    across, down = _Runs.of(_long_runs(ink)), _Runs.of(_long_runs(ink.T))
    # One turn of the sheet: its horizontal lines slope by `skew`, its vertical ones by `-skew` (a scanner's streaks are always
    # upright: alone, they would set the vertical lines' skew to none).
    turn = max(SKEWS, key=lambda skew: _sharpness(across.profile(skew)) + _sharpness(down.profile(-skew)))
    rows = _axis_lines(across, across.refined(turn), scale[1], scale[0])
    cols = _axis_lines(down, down.refined(-turn), scale[0], scale[1])
    return SheetLines(rows, cols, full[0], full[1])


def _long_runs(ink: BoolArray) -> BoolArray:
    """Only the thin straight runs along the rows of `ink` at least `RUN_SHARE` of its width, a slight tilt allowed (a filled
    area, as thick as `THICK_SHARE` of the side across the runs, is no line)."""
    marks = ink.astype(numpy.uint8)
    thick = max(THICK_MIN_PX, round(THICK_SHARE * ink.shape[0]))
    filled = cv2.morphologyEx(marks, cv2.MORPH_OPEN, numpy.ones((thick, 1), numpy.uint8))
    tilted = cv2.dilate(marks & (1 - filled), numpy.ones((2 * TILT_PX + 1, 1), numpy.uint8))
    length = max(3, round(RUN_SHARE * ink.shape[1]))
    return numpy.asarray(cv2.morphologyEx(tilted, cv2.MORPH_OPEN, numpy.ones((1, length), numpy.uint8)) > 0, bool)


@dataclass(frozen=True)
class _Runs:
    """The long runs along one axis: their pixels' rows, their columns' offsets from the middle, and the mask's size."""

    rows: numpy.ndarray
    offsets: FloatArray
    shape: tuple[int, int]

    @classmethod
    def of(cls, runs: BoolArray) -> "_Runs":
        rows, columns = numpy.nonzero(runs)
        return cls(rows, columns.astype(numpy.float64) - runs.shape[1] / 2, (runs.shape[0], runs.shape[1]))

    def profile(self, skew: float) -> FloatArray:
        """Each row's share of the side covered by runs, read along `skew` (rows per column); runs read off the mask are dropped."""
        placed = numpy.rint(self.rows - skew * self.offsets).astype(numpy.int64)
        kept = placed[(placed >= 0) & (placed < self.shape[0])]
        return numpy.asarray(numpy.bincount(kept, minlength=self.shape[0]) / self.shape[1], numpy.float64)

    def refined(self, skew: float) -> float:
        """The skew within `REFINE_SKEW` of `skew` that lines this axis's runs up best (a sheet's paper is seldom quite square)."""
        return max((skew + step for step in REFINE_STEPS), key=lambda near: _sharpness(self.profile(near)))


def _axis_lines(runs: _Runs, skew: float, across: float, along: float) -> tuple[Line, ...]:
    """Every peak of the runs' profile read along `skew` as a line, in full pixels (`across` and `along`: full pixels per reduced
    pixel across and along the axis)."""
    profile = runs.profile(skew)
    placed = runs.rows - skew * runs.offsets
    peaks = [row for row in range(len(profile)) if profile[row] >= FAINT and _is_peak(profile, row)]
    return tuple(_line(runs, placed, row, float(profile[row]), (across, along, skew)) for row in peaks)


def _line(runs: "_Runs", placed: FloatArray, row: int, strength: float, scales: tuple[float, float, float]) -> Line:
    """The peak at `row` as a line in full pixels, with where its runs start and end along the axis."""
    across, along, skew = scales
    middle = runs.shape[1] / 2
    on = runs.offsets[numpy.abs(placed - row) <= 1]
    start, end = (float(numpy.percentile(on, EXTENT_PERCENTILE)), float(numpy.percentile(on, 100 - EXTENT_PERCENTILE)))
    # The middle of the line's band (its tilt allowance widens a line evenly on both sides).
    near = placed[numpy.abs(placed - row) <= TILT_PX + 1]
    return Line((float(numpy.mean(near)) + 0.5) * across, strength, skew * across / along, (start + middle) * along, (end + middle + 1) * along)


def _sharpness(profile: FloatArray) -> float:
    """How sharply the runs line up (lines read along their own skew stack into one row each)."""
    return float(numpy.square(profile).sum())


def _is_peak(profile: numpy.ndarray, row: int) -> bool:
    """The highest point within `BAND_PX` (the first of equals)."""
    low, high = max(0, row - BAND_PX), min(len(profile), row + BAND_PX + 1)
    window = profile[low:high]
    return bool(profile[row] >= window.max() and int(numpy.argmax(window)) == row - low)


def _gaps(lines: Sequence[Line], size: int) -> list[float]:
    """The gaps a frame could span between the `OUTERMOST` strong lines at each end of the side (a double frame's neat line and
    border line; a street that runs straight across a sheet lies further in)."""
    strong = [line.at for line in lines if line.strength >= STRONG]
    nears, fars = strong[:OUTERMOST], strong[-OUTERMOST:]
    return [b - a for a in nears for b in fars if FRAME_MIN * size <= b - a <= FRAME_MAX * size]


def cell_of(gaps_by_sheet: Sequence[Sequence[float]]) -> float | None:
    """The gap most sheets share (within `CLUSTER_TOLERANCE`), at least half of them; of gaps shared nearly as widely
    (`NEAR_BEST`), the shortest (a double frame's neat line lies inside its border line). Its median; None when none is shared."""
    support = {gap: len(_sharing(gaps_by_sheet, gap)) for gaps in gaps_by_sheet for gap in gaps}
    best = max(support.values(), default=0)
    if best < max(MIN_SUPPORT, SUPPORT * len(gaps_by_sheet)):
        return None
    chosen = min(gap for gap, count in support.items() if count >= NEAR_BEST * best)
    return float(numpy.median(_sharing(gaps_by_sheet, chosen)))


def _sharing(gaps_by_sheet: Sequence[Sequence[float]], gap: float) -> list[float]:
    """Each sheet's gap closest to `gap`, for the sheets that have one within `CLUSTER_TOLERANCE` of it."""
    closest = [min(gaps, key=lambda other: abs(other - gap)) for gaps in gaps_by_sheet if gaps]
    return [other for other in closest if abs(other - gap) <= CLUSTER_TOLERANCE * gap]


def series_cell(sheets: Sequence[SheetLines], aspect: float) -> tuple[float | None, float | None]:
    """The series' cell in scan pixels (width, height); an axis no gap is shared on takes the other's through `aspect` (the
    cell's width over its height)."""
    width = cell_of([_gaps(sheet.cols, sheet.width) for sheet in sheets])
    height = cell_of([_gaps(sheet.rows, sheet.height) for sheet in sheets])
    if width is None and height is not None:
        width = height * aspect
    if height is None and width is not None:
        height = width / aspect
    return width, height


def _pairs(lines: Sequence[Line], cell: float) -> list[Sides]:
    """Every two lines about the cell's size apart, one of them strong."""
    return [
        Sides(a, b)
        for a in lines
        for b in lines
        if b.at > a.at and max(a.strength, b.strength) >= STRONG and _closeness(b.at - a.at, cell) > 0
    ]


def _closeness(gap: float, cell: float) -> float:
    """1 for a gap of the cell's size, falling to `1 - CLOSENESS_DROP` at `CELL_TOLERANCE` off it; 0 beyond."""
    off = abs(gap - cell) / (CELL_TOLERANCE * cell)
    return 0.0 if off > 1 else 1.0 - CLOSENESS_DROP * off


def _cut(lines: Sequence[Line], size: int, cell: float, names: tuple[str, str], cut: frozenset[str]) -> list[Sides]:
    """The strong lines whose partner, the cell's size away, lies beyond the scan's edge or within `EDGE_SHARE` of it (the scanner
    cut it): the innermost such line on each side (a double frame's border line lies outside its neat line). Only a side in `cut`
    may be missing (`cut_sides`)."""
    edge, kept = EDGE_SHARE * size, (1 - MAX_CUT) * cell
    strong = [line for line in lines if line.strength >= STRONG]
    nears = [Sides(line, line.shifted(cell), names[1]) for line in strong if size - edge - cell < line.at <= size - kept]
    fars = [Sides(line.shifted(-cell), line, names[0]) for line in strong if kept <= line.at < cell + edge]
    inner_near = max(nears, key=lambda sides: sides.near.at, default=None)
    inner_far = min(fars, key=lambda sides: sides.far.at, default=None)
    return [sides for sides in (inner_near, inner_far) if sides is not None and sides.inferred in cut]


def _innermost(lines: Sequence[Line], size: int) -> Sides | None:
    """Without a series' cell: the innermost pair of strong lines that spans a frame's share of the side."""
    strong = [line for line in lines if line.strength >= STRONG]
    pairs = [(a, b) for a in strong for b in strong if FRAME_MIN * size <= b.at - a.at <= FRAME_MAX * size]
    best = min(pairs, key=lambda pair: pair[1].at - pair[0].at, default=None)
    return None if best is None else Sides(*best)


def evidence(sides: Sides, cell: float | None) -> float:
    """How sure an axis's sides are (0-1): their found lines' mean share of a full line, times how closely their gap matches the
    cell; a side the scanner cut counts its one line, lowered by `INFERRED_WEIGHT`."""
    found = [min(1.0, line.strength / FULL) for line in (sides.near, sides.far) if line.strength > 0]
    if sides.inferred:
        return found[0] * INFERRED_WEIGHT
    return float(numpy.mean(found)) * (1.0 if cell is None else _closeness(sides.gap, cell))


def axis_sides(
    lines: Sequence[Line], size: int, cell: float | None, names: tuple[str, str], cut: frozenset[str] = frozenset()
) -> Sides | None:
    """One axis's two sides (`names`: near, far): of the pairs the cell's size apart and the lines whose partner the scanner cut
    (only a side in `cut`), the best evidenced; without a cell, the innermost pair."""
    if cell is None:
        return _innermost(lines, size)
    candidates = _pairs(lines, cell) + _cut(lines, size, cell, names, cut)
    return max(candidates, key=lambda sides: evidence(sides, cell), default=None)


def _crossing(horizontal: Line, vertical: Line, centre: tuple[float, float]) -> tuple[float, float]:
    """Where a horizontal line (`y = at + slope (x - cx)`) meets a vertical one (`x = at + slope (y - cy)`)."""
    cx, cy = centre
    y = (horizontal.at + horizontal.slope * (vertical.at - cx - vertical.slope * cy)) / (1 - horizontal.slope * vertical.slope)
    return vertical.at + vertical.slope * (y - cy), y


def cut_sides(sheet: SheetLines) -> frozenset[str]:
    """The sides the scanner may have cut: where a strong line across them runs on to the scan's edge (a frame's line stops at the
    neat line on a whole sheet, and runs off the scan where the neat line is gone)."""
    rows = [line.reaches(EDGE_SHARE * sheet.width, (1 - EDGE_SHARE) * sheet.width) for line in sheet.rows]
    cols = [line.reaches(EDGE_SHARE * sheet.height, (1 - EDGE_SHARE) * sheet.height) for line in sheet.cols]
    reached = {
        "left": any(left for left, _right in rows),
        "right": any(right for _left, right in rows),
        "top": any(top for top, _bottom in cols),
        "bottom": any(bottom for _top, bottom in cols),
    }
    return frozenset(side for side, found in reached.items() if found)


def sheet_frame(sheet: SheetLines, cell: tuple[float | None, float | None]) -> NeatLine | None:
    """The sheet's neat line from its lines and the series' cell (width, height in scan pixels), or None when an axis has no sides."""
    cut = cut_sides(sheet)
    down = axis_sides(sheet.rows, sheet.height, cell[1], ("top", "bottom"), cut)
    across = axis_sides(sheet.cols, sheet.width, cell[0], ("left", "right"), cut)
    if down is None or across is None:
        return None
    centre = (sheet.width / 2, sheet.height / 2)
    corners = numpy.array(
        [
            _crossing(down.near, across.near, centre),
            _crossing(down.near, across.far, centre),
            _crossing(down.far, across.far, centre),
            _crossing(down.far, across.near, centre),
        ],
        numpy.float64,
    )
    confidence = min(evidence(down, cell[1]), evidence(across, cell[0]))
    return NeatLine(corners, round(confidence, 3), down.inferred or across.inferred)


def series_frames(paths: Sequence[Path], aspect: float) -> list[NeatLine | None]:
    """Every sheet's neat line, found with the series' cell (`aspect`: the cell's width over its height)."""
    sheets = [read_lines(path) for path in paths]
    cell = series_cell(sheets, aspect)
    return [sheet_frame(sheet, cell) for sheet in sheets]
