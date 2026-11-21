"""Sheet names that say where a sheet lies (docs/research/M20-import-local.md §2.3 step 4, §3 b).

A small library of name grammars, none tied to one city:

- `quarter`: a city grid's row, column and quarter (`17A'3`): rows numbered from a zero row, a prime north of it; columns lettered
  without J and Q, a prime east of a zero meridian (A' is column 0, A is -1); quarters 1-4 of a cell. An edition year may follow
  (`17A1_62`), and words such as `bis` or `mic` mark an odd sheet the report lists (`31A-MIC3` is quarter 3); so does a whole cell
  with no quarter (`2C`). A
  prime spelled as a word (`13Aprim1`) reads as one.
- `block`: two neighbouring rows and two neighbouring columns of the same grid in one sheet (`29-30cb`, `9-10v'w'`, `1'-0AA'`,
  `23-24i-h`); a name whose rows or columns are not neighbours (`z'a''`, `9-10azmic`) is read by none.
- `folder-row`: the row in the folder's name (`Seria 11/`) and the column in the file's (`C`, or `C1` for C'); words after it are odd.
- `international-1m`: the international 1:1,000,000 scheme and its subdivisions (`L-35-12-A-b`).
- `row-col`: two numbers (`12-07`, `r12c07`).

A grammar is accepted for a set of sheets by `accepts` (§2.3): at least 80 % of the folder's rasters parse, the cells are one connected
set, and their pixel sizes agree. What a sheet's cell means on the ground is the grid solve's (§3 b), not this module's. A file with no
extension (`25/25-26`) is read by none: its name is not a sheet's.
"""

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Final

import numpy

GRID_LETTERS: Final = "ABCDEFGHIKLMNOPRSTUVWXYZ"
MIN_SHEETS: Final = 4
MIN_SHARE: Final = 0.8
SIZE_TOLERANCE: Final = 0.1
_QUARTER: Final = re.compile(r"^(\d{1,2})('*)([A-Z])('*)([1-4])?(?:[_-](\d{2,4}))?(?:\s*(.+))?$", re.IGNORECASE)
_BLOCK: Final = re.compile(r"^(\d{1,2})('*)-(\d{1,2})('*)\s*([A-Z])('*)-?([A-Z])('*)(?:[_-](\d{2,4}))?(?:\s*(.+))?$", re.IGNORECASE)
# A small sheet's mark before its quarter (`31A-MIC3`): the quarter is read, the sheet listed as odd.
_SMALL: Final = re.compile(r"-?mic(?=[1-4]$)", re.IGNORECASE)
# A prime spelled as a word after a column letter (`13Aprim1` is 13A'1).
_PRIME_WORD: Final = re.compile(r"(?<=[A-Z])prim(?=\d|'|$)", re.IGNORECASE)
_FOLDER_ROW: Final = re.compile(r"^seria\s*(\d{1,2})('*)$", re.IGNORECASE)
_FOLDER_COL: Final = re.compile(r"^([A-Z])(1)?(?:\s+(.+))?$", re.IGNORECASE)
_INTERNATIONAL: Final = re.compile(r"^([A-V])-(\d{1,2})(?:-(\d{1,3}))?(?:-([A-D]))?(?:-([a-d]))?$", re.IGNORECASE)
_ROW_COL: Final = re.compile(r"^r?(\d{1,3})[-_ c](\d{1,3})$", re.IGNORECASE)
_TWO_DIGITS: Final = 100
# A letter the grid does not use (J, Q): no column at all.
NO_COLUMN: Final = -1000
_CENTURY: Final = 1900


@dataclass(frozen=True)
class Cell:
    """A sheet's place on its grid: row and column (and quarter); `odd` when the name says more than the grammar reads."""

    grammar: str
    row: int
    col: int
    quarter: int = 0
    span: int = 1
    edition: int | None = None
    odd: bool = False


def column(letter: str, primes: str) -> int:
    """A grid column: primed letters east from 0 (A' is 0), plain ones west from -1 (A is -1); `NO_COLUMN` for J or Q."""
    index = GRID_LETTERS.find(letter.upper())
    if index < 0:
        return NO_COLUMN
    return index if primes else -(index + 1)


def row(number: str, primes: str) -> int:
    """A grid row: numbered south of the zero row, a prime north of it."""
    return -int(number) if primes else int(number)


def edition_year(text: str | None) -> int | None:
    """`62` is 1962, `1977` is 1977; none when the name has none."""
    if text is None:
        return None
    value = int(text)
    return value + _CENTURY if value < _TWO_DIGITS else value


def parse_quarter(stem: str) -> Cell | None:
    match = _QUARTER.match(_SMALL.sub("", stem))
    if match is None:
        return None
    number, row_primes, letter, col_primes, quarter, edition, extra = match.groups()
    col = column(letter, col_primes)
    odd = _odd_quarter(stem, quarter, extra)
    return Cell("quarter", row(number, row_primes), col, int(quarter or 0), 1, edition_year(edition), odd) if col > NO_COLUMN else None


def _odd_quarter(stem: str, quarter: str | None, extra: str | None) -> bool:
    """Words after the name, no quarter (a whole cell) or a small sheet's mark: the report lists the sheet."""
    return bool(extra) or quarter is None or _SMALL.search(stem) is not None


def parse_block(stem: str) -> Cell | None:
    match = _BLOCK.match(stem)
    if match is None:
        return None
    first, first_primes, second, second_primes, west, west_primes, east, east_primes, edition, extra = match.groups()
    cols = sorted([column(west, west_primes), column(east, east_primes)])
    top = row(first, first_primes)
    if cols[0] <= NO_COLUMN or not _neighbours_of(cols, top, row(second, second_primes)):
        return None
    return Cell("block", top, cols[0], 0, 2, edition_year(edition), bool(extra))


def _neighbours_of(cols: Sequence[int], top: int, bottom: int) -> bool:
    """A block's two columns are side by side and its second row is the one south of its first."""
    return cols[1] - cols[0] == 1 and bottom - top == 1


def parse_folder_row(folder: str, stem: str) -> Cell | None:
    """`Seria 11/C1`: row 11, column C' (the cadastral plan writes A1 for A')."""
    row_match, col_match = _FOLDER_ROW.match(folder), _FOLDER_COL.match(stem)
    if row_match is None or col_match is None:
        return None
    letter, primed, extra = col_match.groups()
    col = column(letter, "'" if primed else "")
    return Cell("folder-row", row(*row_match.groups()), col, odd=bool(extra)) if col > NO_COLUMN else None


def parse_international(stem: str) -> Cell | None:
    match = _INTERNATIONAL.match(stem)
    if match is None:
        return None
    band, zone, part = match.group(1, 2, 3)
    return Cell("international-1m", ord(band.upper()) - ord("A"), int(zone), int(part or 0))


def parse_row_col(stem: str) -> Cell | None:
    match = _ROW_COL.match(stem)
    return None if match is None else Cell("row-col", int(match.group(1)), int(match.group(2)))


def parse(path: str) -> Cell | None:
    """The first grammar that reads the file's name (with its folder's, for `folder-row`), or None."""
    pure = PurePosixPath(path)
    if not pure.suffix:
        return None
    stem, folder = _PRIME_WORD.sub("'", pure.stem), pure.parent.name
    for reader in (parse_quarter, parse_block, parse_international, parse_row_col):
        cell = reader(stem)
        if cell is not None:
            return cell
    return parse_folder_row(folder, stem)


def _component(start: tuple[int, int], places: set[tuple[int, int]]) -> set[tuple[int, int]]:
    seen, todo = set[tuple[int, int]](), [start]
    while todo:
        here = todo.pop()
        if here not in seen:
            seen.add(here)
            todo.extend(place for place in _neighbours(here) if place in places)
    return seen


def connected(cells: Iterable[Cell]) -> bool:
    """True when 80 % of the cells (a quarter's cell counts as its cell) form one set, each within `REACH` cells of the next."""
    places = {(cell.row, cell.col) for cell in cells}
    largest, left = 0, set(places)
    while left:
        part = _component(next(iter(left)), places)
        largest, left = max(largest, len(part)), left - part
    return largest > 0 and largest >= MIN_SHARE * len(places)


# Sheets join when they lie within this many cells of each other: a surviving series has gaps (the cadastral plan's rows are 9, 11, 12,
# 15, 18, 19, 21 and 22), a set of names that happen to parse is scattered further.
REACH: Final = 3


def _neighbours(place: tuple[int, int]) -> list[tuple[int, int]]:
    steps = range(-REACH, REACH + 1)
    return [(place[0] + dr, place[1] + dc) for dr in steps for dc in steps if dr or dc]


def alike(sizes: Sequence[tuple[int, int]]) -> bool:
    """80 % of the sheets are within `SIZE_TOLERANCE` of the median size on both sides: sheets cut by hand, or scanned in two batches
    a few per cent apart (Bucharest's 1:2000 sheets are 7008 x 9933 and 6608 x 9363), are one series; an atlas of mixed pages is not."""
    if not sizes:
        return False
    measured = numpy.array(sizes, numpy.float64)
    close = numpy.all(numpy.abs(measured / numpy.median(measured, axis=0) - 1.0) <= SIZE_TOLERANCE, axis=1)
    return bool(close.mean() >= MIN_SHARE)


def accepts(parsed: int, rasters: int, cells: Sequence[Cell], sizes: Sequence[tuple[int, int]]) -> bool:
    """§2.3: enough sheets, 80 % of the rasters parse, one connected set, and 80 % of one size (`alike`)."""
    return parsed >= MIN_SHEETS and parsed >= MIN_SHARE * rasters and alike(sizes) and connected(cells)
