"""An atlas's or pieces' grid read from their file and folder names (docs/research/M20-import-local.md §19.1).

The schemes, tried on each name's stem, the first one most names agree on wins:

- a city's Seria/Coloana grid (`17A'3`: row 17, column A', quarter 3; `archive.grammar`), its quarter order chosen by the seams;
- `r1c2` (row 1, column 2), `3_7` or `03-07` (row, column), `C12` (a letter row and a number column), all counted from 1;
- a sheet number with a quadrant letter `A` to `D` (`12A`, `12-b`): sheet 12's top left, top right, bottom left and bottom right quarter,
  on a grid twice as fine;
- folders as rows (`row1/…`, `row2/…`), each folder's files in natural order its columns;
- else the natural order (`img003`, a PDF's page numbers): each name's index, its columns not known (`col_candidates`); a name with
  words the others lack (`10_Registru` among `12`, `13`) is a title, index or legend page and is left unread (`titled`).

The order is the fallback the seams check (`autostitch`): a numbered atlas whose page count factors several ways gets its columns from the
seams that join best. `cell_of` is the one parser of a single name against a known grid (the overview's hint, `overview.grid_hint`).
"""

import math
import re
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Final

from hcm_pipeline.archive import grammar
from hcm_pipeline.placing.gridscheme import QUARTER_ORDERS

# A scheme must read at least this share of the names (the rest are foreign sheets, an index, a legend).
AGREE_SHARE: Final = 0.8
QUADRANTS: Final = "ABCD"
# A guessed grid's columns: its whole map at most this far from the median sheet's shape times its cells (both ways).
MAX_SPAN_RATIO: Final = 6.0
MAX_CANDIDATES: Final = 4
# Folders are rows when there are at least this many, each with at least this many files.
MIN_FOLDER_ROWS: Final = 2

Cell = tuple[int, int]

_RC: Final = re.compile(r"r(\d+)\s*c(\d+)", re.IGNORECASE)
_PAIR: Final = re.compile(r"(?<![\d])(\d{1,3})[_-](\d{1,3})(?![\d])")
_LETTER: Final = re.compile(r"(?<![A-Za-z])([A-Z])[_-]?(\d{1,3})(?![\d])")
_QUADRANT: Final = re.compile(r"(\d{1,4})[_-]?([A-Da-d])$")
_NUMBER: Final = re.compile(r"\d+")


@dataclass(frozen=True)
class NameGrid:
    """The parts' cells (index to (row, column), 0-based), the grid's size, how the cells were read (`name` or `order`) and the parts
    no scheme read (foreign sheets)."""

    cells: dict[int, Cell]
    rows: int
    cols: int
    source: str
    unread: tuple[int, ...] = ()

    @property
    def named(self) -> bool:
        return self.source == "name"


def _stem(name: str) -> str:
    return PurePosixPath(name).stem


def _rc(stem: str) -> Cell | None:
    found = _RC.search(stem)
    return None if found is None else (int(found.group(1)) - 1, int(found.group(2)) - 1)


def _pair(stem: str) -> Cell | None:
    found = list(_PAIR.finditer(stem))
    return None if not found else (int(found[-1].group(1)) - 1, int(found[-1].group(2)) - 1)


def _letter(stem: str) -> Cell | None:
    found = _LETTER.search(stem)
    return None if found is None else (ord(found.group(1)) - ord("A"), int(found.group(2)) - 1)


EXPLICIT: Final[tuple[Callable[[str], Cell | None], ...]] = (_rc, _pair, _letter)


def number_of(stem: str) -> int | None:
    """The name's last number, or None."""
    found = _NUMBER.findall(stem)
    return int(found[-1]) if found else None


def cell_of(name: str, rows: int, cols: int) -> Cell | None:
    """One name's (row, column) on a known grid of `rows` x `cols`: an explicit scheme, else its number read row-major (validated)."""
    stem = _stem(name)
    for scheme in EXPLICIT:
        cell = scheme(stem)
        if cell is not None:
            return cell
    number = number_of(stem)
    if number is None or not 1 <= number <= rows * cols:
        return None
    return divmod(number - 1, cols)


def _natural_key(name: str) -> tuple[object, ...]:
    return tuple(int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", name))


def _agreed(found: dict[int, Cell], count: int) -> bool:
    """A scheme's cells hold when it read most names, no two on one cell and none at a negative place."""
    cells = list(found.values())
    unique = len(set(cells)) == len(cells)
    return unique and len(found) >= AGREE_SHARE * count and all(row >= 0 and col >= 0 for row, col in cells)


def _grid(found: dict[int, Cell], count: int, source: str) -> NameGrid:
    rows = 1 + max(row for row, _ in found.values())
    cols = 1 + max(col for _, col in found.values())
    return NameGrid(found, rows, cols, source, tuple(index for index in range(count) if index not in found))


def _read_by(scheme: Callable[[str], Cell | None], stems: Sequence[str]) -> dict[int, Cell]:
    read = ((index, scheme(stem)) for index, stem in enumerate(stems))
    return {index: cell for index, cell in read if cell is not None}


def _explicit(stems: Sequence[str]) -> NameGrid | None:
    for scheme in EXPLICIT:
        found = _read_by(scheme, stems)
        if _agreed(found, len(stems)):
            return _grid(found, len(stems), "name")
    return None


def _quadrant(stem: str) -> tuple[int, int] | None:
    """A sheet number and its quadrant (0 top left to 3 bottom right), or None."""
    match = _QUADRANT.search(stem)
    return None if match is None else (int(match.group(1)), QUADRANTS.index(match.group(2).upper()))


def _quadrant_cell(base: int, quarter: int, base_cols: int) -> Cell:
    row, col = divmod(base, base_cols)
    return 2 * row + quarter // 2, 2 * col + quarter % 2


def _quadrants(stems: Sequence[str]) -> NameGrid | None:
    """Sheet numbers with a quadrant letter: each base sheet in natural order on a near-square grid, its quarters inside it."""
    read = _read_by(_quadrant, stems)
    bases = sorted({base for base, _ in read.values()})
    base_cols = math.ceil(math.sqrt(max(1, len(bases))))
    found = {index: _quadrant_cell(bases.index(base), quarter, base_cols) for index, (base, quarter) in read.items()}
    return _grid(found, len(stems), "name") if found and _agreed(found, len(stems)) else None


def _parent(name: str) -> str:
    return str(PurePosixPath(name).parent)


def _folder_row(names: Sequence[str], parent: str) -> list[int]:
    """The files of one folder, in natural order."""
    members = [index for index, name in enumerate(names) if _parent(name) == parent]
    return sorted(members, key=lambda index: _natural_key(names[index]))


def _folders(names: Sequence[str]) -> NameGrid | None:
    """Folders as rows (at least two, each with at least two files), the files in natural order as columns."""
    parents = sorted({_parent(name) for name in names}, key=_natural_key)
    rows = [_folder_row(names, parent) for parent in parents]
    if min([len(rows), *map(len, rows)]) < MIN_FOLDER_ROWS:
        return None
    return _grid(_folder_cells(rows), len(names), "name")


def _folder_cells(rows: Sequence[Sequence[int]]) -> dict[int, Cell]:
    found: dict[int, Cell] = {}
    for row, members in enumerate(rows):
        found.update({index: (row, col) for col, index in enumerate(members)})
    return found


def titled(names: Sequence[str]) -> tuple[int, ...]:
    """The names that carry words the others do not (`1_Autor`, `10_Registru`, `99_Scara` among `12`, `13`): an atlas's title, index
    and legend pages, never part of the order. Only when most names share one pattern once their numbers are taken out."""
    patterns = [_NUMBER.sub("#", _stem(name)).lower() for name in names]
    common, count = _most_common(patterns)
    if count < AGREE_SHARE * len(names):
        return ()
    return tuple(index for index, pattern in enumerate(patterns) if pattern != common)


def _most_common(patterns: Sequence[str]) -> tuple[str, int]:
    return Counter(patterns).most_common(1)[0] if patterns else ("", 0)


def order_count(names: Sequence[str]) -> int:
    """How many names the order lays out (all but the titled ones)."""
    return len(names) - len(titled(names))


def ordered(names: Sequence[str], cols: int) -> NameGrid:
    """The names in natural order laid row-major on `cols` columns, the titled ones left unread."""
    unread = titled(names)
    order = sorted((index for index in range(len(names)) if index not in unread), key=lambda index: _natural_key(names[index]))
    found = {index: divmod(position, cols) for position, index in enumerate(order)}
    return NameGrid(found, math.ceil(len(order) / cols), cols, "order", unread)


def _plausible(count: int, cols: int, aspect: float) -> tuple[bool, float, int] | None:
    """A column count's rank (a short last row, then how far the whole map is from square), or None when its map is too long."""
    rows = math.ceil(count / cols)
    span = cols * aspect / rows
    if not 1 / MAX_SPAN_RATIO <= span <= MAX_SPAN_RATIO:
        return None
    return rows * cols != count, abs(math.log(span)), cols


def col_candidates(count: int, aspect: float) -> list[int]:
    """Plausible column counts for `count` parts in order (the last row may be short), best first: the grids whose whole map is
    closest to square given the median part's shape (`aspect`, width over height), exact factorisations before short last rows."""
    best = [cols for _short, _off, cols in _ranked(count, aspect)[:MAX_CANDIDATES]]
    return best or [max(1, math.ceil(math.sqrt(count)))]


def _ranked(count: int, aspect: float) -> list[tuple[bool, float, int]]:
    """Every plausible column count's rank, best first."""
    found = [_plausible(count, cols, aspect) for cols in range(1, count + 1)]
    return sorted(rank for rank in found if rank is not None)


def _city_cell(stem: str, order: int) -> Cell | None:
    """A city grid sheet's cell (`17A'3`: row 17, column A', quarter 3; `archive.grammar`), its quarter read in `order`
    (`gridscheme.QUARTER_ORDERS`): two grid rows and columns per city cell."""
    cell = grammar.parse_quarter(stem)
    if cell is None or not cell.quarter or cell.odd:
        return None
    dx, dy = QUARTER_ORDERS[order][cell.quarter - 1]
    return cell.row * 2 + dy, cell.col * 2 + dx


def city(names: Sequence[str], order: int = 0) -> NameGrid | None:
    """The sheets on a city's Seria/Coloana grid by their names (the IPB 1:500 of 1960-71: `0B'3`, `19A2`), the quarters read in
    `order`; None unless most names read (one sheet a cell, `_one_a_cell`). `autostitch` tries every order and keeps the one whose
    seams join best (M20 §19.16)."""
    stems = [_stem(name) for name in names]
    found = _one_a_cell(_read_by(lambda stem: _city_cell(stem, order), stems), stems)
    return _grid(_from_zero(found), len(stems), "name") if len(found) >= AGREE_SHARE * len(stems) else None


def _one_a_cell(found: dict[int, Cell], stems: Sequence[str]) -> dict[int, Cell]:
    """One sheet a cell: of a cell's editions (`15M1`, `15M1_62`, `15M1_64`) or a sheet filed twice (`2/2M2`, `2'/2M2`) the one with
    the plainest name (the shortest, then the first); the others are left unread (`no-join`)."""
    kept: dict[Cell, int] = {}
    for index in sorted(found, key=lambda at: (len(stems[at]), at)):
        kept.setdefault(found[index], index)
    return {index: cell for cell, index in kept.items()}


def _from_zero(found: dict[int, Cell]) -> dict[int, Cell]:
    top, left = min(row for row, _col in found.values()), min(col for _row, col in found.values())
    return {index: (row - top, col - left) for index, (row, col) in found.items()}


def grid_of(names: Sequence[str], aspect: float = 1.0) -> NameGrid:
    """The grid the names give: a city's Seria/Coloana grid, an explicit scheme, quadrants, folders as rows; else the natural order on
    the likeliest columns."""
    stems = [_stem(name) for name in names]
    for found in (city(names), _explicit(stems), _quadrants(stems), _folders(names)):
        if found is not None:
            return found
    return ordered(names, col_candidates(order_count(names), aspect)[0])
