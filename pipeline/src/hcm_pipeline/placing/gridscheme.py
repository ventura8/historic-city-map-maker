"""Where a sheet lies on its city's grid, in the grid's own metres (docs/research/M20-import-local.md §3 b step 1).

A grid scheme is pluggable per city and per name grammar (`archive.grammar`). `CityGrid` is the kind Bucharest's plans share (the
Seria/Coloana grid of the IGA 1895 and 1911 plans, the 1911-14 cadastral plan and IPB's 1:500 and 1:2000): square cells (500 m), rows
numbered south from a zero row (a prime north of it), columns lettered west and east of a zero meridian; a `quarter` sheet is one of a
cell's four quarters, a `block` sheet two rows by two columns, a `folder-row` sheet one cell. The grid's metres run east (x) and north
(y) from the zero row's top and the zero meridian; the grid's place on the Earth is the solve's (`grid`), never this module's.

The quarter numbering is one of eight (`QUARTER_ORDERS`: the four quarters read along rows or columns, from any corner); the series
says which by its seams (the order whose neighbouring sheets continue each other's lines best), never by a guess.
"""

from dataclasses import dataclass
from typing import Final

from hcm_pipeline.archive.grammar import Cell

# Quarters 1-4 as (column, row) halves of the cell, row 0 the northern half: the eight ways of reading a 2 x 2 square.
QUARTER_ORDERS: Final = (
    ((0, 0), (1, 0), (0, 1), (1, 1)),
    ((1, 0), (0, 0), (1, 1), (0, 1)),
    ((0, 1), (1, 1), (0, 0), (1, 0)),
    ((1, 1), (0, 1), (1, 0), (0, 0)),
    ((0, 0), (0, 1), (1, 0), (1, 1)),
    ((1, 0), (1, 1), (0, 0), (0, 1)),
    ((0, 1), (0, 0), (1, 1), (1, 0)),
    ((1, 1), (1, 0), (0, 1), (0, 0)),
)
CITY_CELL_M: Final = 500.0
CITY_GRAMMARS: Final = frozenset({"quarter", "block", "folder-row"})


@dataclass(frozen=True)
class Box:
    """A sheet's place in grid metres: west, north, east and south edges (y grows north)."""

    west: float
    north: float
    east: float
    south: float

    @property
    def width(self) -> float:
        return self.east - self.west

    @property
    def height(self) -> float:
        return self.north - self.south


@dataclass(frozen=True)
class CityGrid:
    """A city grid of square cells, rows numbered south and columns east from zero."""

    cell_m: float = CITY_CELL_M

    def box(self, cell: Cell, order: int = 0) -> Box:
        """Where `cell` lies with its quarters read in `QUARTER_ORDERS[order]`."""
        west, north = cell.col * self.cell_m, -cell.row * self.cell_m
        if cell.quarter:
            half = self.cell_m / 2
            dx, dy = QUARTER_ORDERS[order][cell.quarter - 1]
            return Box(west + dx * half, north - dy * half, west + (dx + 1) * half, north - (dy + 1) * half)
        size = self.cell_m * cell.span
        return Box(west, north, west + size, north - size)


def scheme_for(grammar: str, cell_m: float | None = None) -> CityGrid | None:
    """The grid scheme a name grammar's sheets lie on, or None when no scheme reads them yet (`international-1m`, `row-col`)."""
    if grammar not in CITY_GRAMMARS:
        return None
    return CityGrid(cell_m or CITY_CELL_M)
