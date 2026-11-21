"""Pages that only touch, laid out by what crosses their edges (docs/research/M20-import-local.md §19.15).

An atlas cut on its plate's lines shows no strip twice, so neither the overlap seams nor the features place it. What continues across
a cut is the drawing's long lines: a street, a wall, a river bank leaves one page's edge and enters the next one's at the same place.

1. Each page's four edges as **crossings** (`crossings`): in a band `BAND_PX` deep along the edge, the ink's connected pieces that
   run at least `LONG_PX` into the page (a street, not a tree mark or a letter), where they meet the column `SKIP_PX` in (past the
   scan's ragged edge); smoothed (`SMOOTH_PX`) and normalised. A page with fewer than `MIN_CROSSINGS` such lines has no profile.
2. Every ordered pair's continuity on each side (`table`): the best correlation of the first's outer profile against the second's
   inner one, shifted up to `SLACK_SHARE` of the edge.
3. The **shuffled-pair baseline** (`threshold`): of all pairs' scores on a side, the `BASELINE_PCT` percentile; a continuity counts
   only when it beats that by `MARGIN` (and is at least `MIN_SCORE`). Most pairs are not neighbours, so the baseline is what chance
   gives on this very series.
4. The **assembly** (`assemble`): mutual best matches (each is the other's best on that side) that count, strongest first, each
   merging two groups of pages on the grid when no two pages would share a cell; a page whose number follows its left neighbour's
   needs only to beat the baseline (`ORDER_BONUS`: the numbering is evidence too, never on its own).
"""

import itertools
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Final

import cv2
import numpy

from hcm_pipeline.placing.geometry import FloatArray
from hcm_pipeline.placing.streets import UInt8Array

BAND_PX: Final = 40
SKIP_PX: Final = 6
LONG_PX: Final = 22
INK_LEVELS: Final = 40
PAPER_PCT: Final = 90
# A band more ink than this is a filled area or noise, not lines crossing an edge.
MAX_INK_SHARE: Final = 0.35
SMOOTH_PX: Final = 3.0
TONE_PX: Final = 4
MIN_CROSSINGS: Final = 3
SLACK_SHARE: Final = 0.03
SHIFT_STEP: Final = 2
BASELINE_PCT: Final = 99.0
MARGIN: Final = 0.05
CANDIDATES: Final = 2
MIN_SCORE: Final = 0.4
ORDER_BONUS: Final = 0.15
FIT_PCT: Final = 75.0
MIN_STRIDE_VOTES: Final = 2
MIN_NORM: Final = 1e-9
SIDES: Final = ("right", "below")
STEP: Final = {"right": (0, 1), "below": (1, 0)}
Cell = tuple[int, int]


@dataclass(frozen=True)
class Edges:
    """A page's crossing profiles: its right and bottom edges seen from inside (`out_*`), its left and top (`in_*`); None when an
    edge has too few lines to say anything."""

    out_right: FloatArray | None
    in_right: FloatArray | None
    out_below: FloatArray | None
    in_below: FloatArray | None


def crossings(band: UInt8Array) -> FloatArray | None:
    """Two profiles along the edge, each normalised (rows 0 and 1, scaled so a pair's product is their mean correlation): where a
    long line meets the band's column `SKIP_PX` (the band's outer edge is its column 0), and the ink's tone `TONE_PX` deep from
    there (a filled block, a coloured area continue too); smoothed. None with fewer than `MIN_CROSSINGS` lines."""
    paper = float(numpy.percentile(band, PAPER_PCT))
    ink = (band < paper - INK_LEVELS).astype(numpy.uint8)
    if float(ink.mean()) > MAX_INK_SHARE:
        return None
    _count, labels, stats, _centres = cv2.connectedComponentsWithStats(ink, connectivity=8)
    long = (stats[:, cv2.CC_STAT_WIDTH] >= LONG_PX) & (stats[:, cv2.CC_STAT_LEFT] <= SKIP_PX)
    long[0] = False
    hits = long[labels[:, SKIP_PX]]
    if int(numpy.count_nonzero(numpy.diff(hits.astype(numpy.int8)) == 1)) < MIN_CROSSINGS:
        return None
    lines = _normalised(_smoothed(hits.astype(numpy.float64)))
    tone = _normalised(_smoothed(255.0 - band[:, SKIP_PX : SKIP_PX + TONE_PX].astype(numpy.float64).mean(axis=1)))
    if lines is None or tone is None:
        return None
    return numpy.asarray(numpy.vstack((lines, tone)) / numpy.sqrt(2.0), numpy.float64)


def _smoothed(profile: FloatArray) -> FloatArray:
    return numpy.asarray(cv2.GaussianBlur(profile.reshape(-1, 1), (1, 0), SMOOTH_PX).ravel(), numpy.float64)


def _normalised(profile: FloatArray) -> FloatArray | None:
    centred = profile - profile.mean()
    norm = float(numpy.linalg.norm(centred))
    return numpy.asarray(centred / norm, numpy.float64) if norm > MIN_NORM else None


def _band(image: UInt8Array, outer: bool) -> UInt8Array:
    """The band along the image's right edge (`outer`, mirrored so its edge is column 0) or its left edge."""
    picked = image[:, ::-1][:, :BAND_PX] if outer else image[:, :BAND_PX]
    return numpy.ascontiguousarray(picked)


def edges_of(image: UInt8Array) -> Edges:
    turned = numpy.ascontiguousarray(image.T)
    return Edges(
        crossings(_band(image, True)), crossings(_band(image, False)), crossings(_band(turned, True)), crossings(_band(turned, False))
    )


def continuity(first: FloatArray | None, second: FloatArray | None, slack: int) -> tuple[float, int]:
    """The best correlation of two profiles with `second` shifted down by up to `slack` rows, and that shift; (0, 0) when either is
    missing."""
    if first is None or second is None:
        return 0.0, 0
    found = [(_shifted(first, second, shift), shift) for shift in range(-slack, slack + 1, SHIFT_STEP)]
    return max(found)


def _shifted(first: FloatArray, second: FloatArray, shift: int) -> float:
    """The profiles' correlation (summed over their rows) with `second` moved down by `shift`."""
    length = first.shape[-1]
    if shift >= 0:
        return float(numpy.sum(first[..., shift:] * second[..., : length - shift]))
    return float(numpy.sum(first[..., :shift] * second[..., -shift:]))


@dataclass(frozen=True)
class Table:
    """Every ordered pair's continuity on one side (`scores[a, b]`: `b` on `a`'s side), its shifts, the pages in order and the
    baseline a score must beat."""

    side: str
    sheets: tuple[int, ...]
    scores: FloatArray
    shifts: numpy.ndarray
    threshold: float


def _profiles(edges: Edges, side: str) -> tuple[FloatArray | None, FloatArray | None]:
    return (edges.out_right, edges.in_right) if side == "right" else (edges.out_below, edges.in_below)


def table(found: Mapping[int, Edges], side: str, length: int) -> Table:
    """The continuity of every ordered pair on `side` (`length`: the edge's length in cell pixels)."""
    sheets = tuple(sorted(found))
    slack = max(SHIFT_STEP, round(SLACK_SHARE * length))
    scores = numpy.full((len(sheets), len(sheets)), -1.0)
    shifts = numpy.zeros((len(sheets), len(sheets)), numpy.int64)
    for (a, first), (b, second) in itertools.permutations(enumerate(sheets), 2):
        scores[a, b], shifts[a, b] = continuity(_profiles(found[first], side)[0], _profiles(found[second], side)[1], slack)
    return Table(side, sheets, scores, shifts, threshold(scores))


def threshold(scores: FloatArray) -> float:
    """What a continuity must reach to count: the shuffled pairs' `BASELINE_PCT` percentile plus `MARGIN`, at least `MIN_SCORE`.
    The shuffled pairs are each page's pairs without its `CANDIDATES` best (where its true neighbour would be), so a small series'
    own neighbours do not raise the bar they must clear."""
    if len(scores) <= CANDIDATES + 1:
        return MIN_SCORE
    ranked = numpy.sort(numpy.where(numpy.eye(len(scores), dtype=bool), -numpy.inf, scores), axis=1)
    shuffled = ranked[:, 1 : len(scores) - CANDIDATES]
    return max(MIN_SCORE, float(numpy.percentile(shuffled, BASELINE_PCT)) + MARGIN)


@dataclass(frozen=True)
class Join:
    """`b` on `a`'s `side`, with the continuity and the shift along the edge (cell pixels)."""

    a: int
    b: int
    side: str
    score: float
    shift: int


def _mutual(found: Table, a: int, b: int) -> bool:
    return int(numpy.argmax(found.scores[a])) == b and int(numpy.argmax(found.scores[:, b])) == a


@dataclass(frozen=True)
class Order:
    """What the names say: each page's number, and the numbers' step from a page to the one below it (`stride`) when the edges
    showed it."""

    numbers: Mapping[int, int] = field(default_factory=dict)
    stride: int | None = None

    def follows(self, a: int, b: int, side: str) -> bool:
        """`b`'s number is `a`'s plus one on the right, or plus the stride below."""
        step = 1 if side == "right" else self.stride
        first = self.numbers.get(a)
        return step is not None and first is not None and self.numbers.get(b) == first + step


def _counts(found: Table, a: int, b: int, order: Order) -> bool:
    """The pair counts: a mutual best match over the threshold, or numbered in sequence and over the baseline alone (the numbering
    is evidence too, never on its own)."""
    score = float(found.scores[a, b])
    if order.follows(found.sheets[a], found.sheets[b], found.side):
        return score >= found.threshold - ORDER_BONUS
    return score >= found.threshold and _mutual(found, a, b)


def joins(tables: Sequence[Table], order: Order) -> list[Join]:
    """The pairs that count on every side, strongest first."""
    found = [
        Join(t.sheets[a], t.sheets[b], t.side, float(t.scores[a, b]), int(t.shifts[a, b]))
        for t in tables
        for a, b in itertools.permutations(range(len(t.sheets)), 2)
        if _counts(t, a, b, order)
    ]
    return sorted(found, key=lambda join: -join.score)


Fits = Callable[[int, int, str], bool]


@dataclass
class _Groups:
    """Each page's group and each group's cells; `fits` says whether two pages may touch on a side."""

    fits: Fits
    of: dict[int, int] = field(default_factory=dict)
    cells: dict[int, dict[int, Cell]] = field(default_factory=dict)

    def add(self, sheet: int) -> None:
        self.of.setdefault(sheet, sheet)
        self.cells.setdefault(sheet, {sheet: (0, 0)})

    def merge(self, join: Join) -> bool:
        """`join.b`'s group moved so it lies on `join.a`'s side, when they are two groups, no two pages share a cell and every pair
        the move makes neighbours fits (global consistency: one strong join never forces a page beside one it contradicts)."""
        self.add(join.a)
        self.add(join.b)
        first, second = self.of[join.a], self.of[join.b]
        if first == second:
            return False
        moved = _moved(self.cells[first][join.a], self.cells[second][join.b], join.side, self.cells[second])
        if not self._agrees(self.cells[first], moved):
            return False
        self.cells[first].update(moved)
        self.of.update(dict.fromkeys(self.cells.pop(second), first))
        return True

    def _agrees(self, held: Mapping[int, Cell], moved: Mapping[int, Cell]) -> bool:
        if set(moved.values()) & set(held.values()):
            return False
        return all(self.fits(*pair) for pair in _touching(held, moved))

    def largest(self) -> dict[int, Cell]:
        return max(self.cells.values(), key=len, default={})


def _touching(held: Mapping[int, Cell], moved: Mapping[int, Cell]) -> list[tuple[int, int, str]]:
    """Every pair of a held and a moved page that become neighbours: (first, second, the side the second is on)."""
    at = {cell: sheet for sheet, cell in held.items()}
    return [pair for sheet, cell in moved.items() for pair in _beside(at, sheet, cell)]


def _beside(at: Mapping[Cell, int], sheet: int, cell: Cell) -> list[tuple[int, int, str]]:
    """The page's neighbours among `at`, each pair in reading order."""
    found = []
    for side, (dr, dc) in STEP.items():
        before, after = at.get((cell[0] - dr, cell[1] - dc)), at.get((cell[0] + dr, cell[1] + dc))
        if before is not None:
            found.append((before, sheet, side))
        if after is not None:
            found.append((sheet, after, side))
    return found


def _moved(at: Cell, there: Cell, side: str, cells: Mapping[int, Cell]) -> dict[int, Cell]:
    """The second group's cells shifted so the page at `there` lands on `at`'s `side`."""
    row = at[0] + STEP[side][0] - there[0]
    col = at[1] + STEP[side][1] - there[1]
    return {sheet: (r + row, c + col) for sheet, (r, c) in cells.items()}


def _always(_a: int, _b: int, _side: str) -> bool:
    return True


def assemble(found: Sequence[Join], fits: Fits = _always) -> tuple[dict[int, Cell], list[Join]]:
    """The largest group's cells (counted from 0) and the joins that built it."""
    groups = _Groups(fits)
    used = [join for join in found if groups.merge(join)]
    placed = from_zero(groups.largest())
    return placed, [join for join in used if join.a in placed]


def from_zero(cells: Mapping[int, Cell]) -> dict[int, Cell]:
    """The cells moved so the least row and column are 0."""
    top, left = _least([row for row, _col in cells.values()]), _least([col for _row, col in cells.values()])
    return {sheet: (row - top, col - left) for sheet, (row, col) in cells.items()}


def _least(values: Sequence[int]) -> int:
    return min(values, default=0)


def fitting(tables: Sequence[Table]) -> Fits:
    """Two pages may touch on a side unless their edges contradict it: both have lines there and continue each other less than the
    series' median pair (`FIT_PCT`)."""
    by_side = {found.side: (found, {sheet: index for index, sheet in enumerate(found.sheets)}, _floor(found)) for found in tables}

    def fits(a: int, b: int, side: str) -> bool:
        found, at, floor = by_side[side]
        score = float(found.scores[at[a], at[b]])
        return score == 0.0 or score >= floor

    return fits


def _floor(found: Table) -> float:
    off = found.scores[~numpy.eye(len(found.scores), dtype=bool)] if len(found.scores) > 1 else numpy.zeros(1)
    return float(numpy.percentile(off, FIT_PCT))


def counted(tables: Sequence[Table], order: Order, a: int, b: int, side: str) -> tuple[float, int] | None:
    """The continuity and shift of `b` on `a`'s `side` when it counts (as `joins` reads it), else None."""
    found = next(t for t in tables if t.side == side)
    at = {sheet: index for index, sheet in enumerate(found.sheets)}
    first, second = at[a], at[b]
    return (float(found.scores[first, second]), int(found.shifts[first, second])) if _counts(found, first, second, order) else None


def stride_of(found: Sequence[Join], numbers: Mapping[int, int]) -> int | None:
    """The step between a page's number and the one below it, when the joins below agree on one (at least `MIN_STRIDE_VOTES`, more
    than any other step)."""
    steps = Counter(_below_steps(found, numbers))
    return _dominant([(count, step) for step, count in steps.most_common() if step > 1][:2])


def _below_steps(found: Sequence[Join], numbers: Mapping[int, int]) -> list[int]:
    below = [join for join in found if join.side == "below" and {join.a, join.b} <= numbers.keys()]
    return [numbers[join.b] - numbers[join.a] for join in below]


def _dominant(ranked: Sequence[tuple[int, int]]) -> int | None:
    """The first step when it has the votes and more than the next."""
    if not ranked or ranked[0][0] < MIN_STRIDE_VOTES:
        return None
    return ranked[0][1] if len(ranked) == 1 or ranked[0][0] > ranked[1][0] else None


def numbered_cells(order: Order, found: Sequence[Join]) -> dict[int, Cell]:
    """The pages on a grid `order.stride` wide, row-major by number, starting where the right joins wrap least."""
    stride = order.stride or 1
    rights = _right_numbers(order, found)
    offset = max(range(stride), key=lambda start: (_unwrapped(rights, start, stride), -start))
    return from_zero({sheet: divmod(number - offset, stride) for sheet, number in order.numbers.items()})


def _right_numbers(order: Order, found: Sequence[Join]) -> list[int]:
    """The numbers of the pages whose right join goes to the next number."""
    return [order.numbers[join.a] for join in found if join.side == "right" and order.follows(join.a, join.b, "right")]


def _unwrapped(rights: Sequence[int], start: int, stride: int) -> int:
    """How many right joins stay on their row when rows start at `start`."""
    return sum((number - start) % stride != stride - 1 for number in rights)
