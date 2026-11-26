"""Moving a systematic Landsat scene onto Sentinel-2 (docs/research/M25-landsat.md §3; lesson 727).

USGS processes a Level-1 scene to one of three levels, named in the product id (`LT05_L1GS_182029_20080815_…`): `L1TP` is placed on
ground control points (about 12 m), `L1GT` and `L1GS` only by the satellite's own orbit and attitude, which can put a scene kilometres
off. Bucharest's 15 August 2008 scene (L1GS) measured 3,744 m from Sentinel-2. Such a scene is moved by the shift `warp` measured,
then measured again: the move is kept only when the second measure is within a pixel (a wrong peak does not survive it), and a shift
larger than a systematic placement can be (`SYSTEMATIC_MAX_M`) is never applied. A precise (L1TP) scene is never moved, nor one whose
level cannot be read. The version's `landsat` report says what happened (`correction`); a moved scene always waits for an admin.
"""

import re
from dataclasses import dataclass
from typing import Final, Literal

from hcm_pipeline.geo import Grid
from hcm_pipeline.landsat.offset import Shift

LEVEL: Final = re.compile(r"_(L1TP|L1GT|L1GS)_", re.IGNORECASE)
PRECISE: Final = "L1TP"
SYSTEMATIC: Final = frozenset({"L1GT", "L1GS"})
SYSTEMATIC_MAX_M: Final = 5000.0

Verdict = Literal["move", "implausible", "keep"]


def level_of(name: str | None) -> str | None:
    """The processing level a product's file name holds (`L1GS`), or None when it holds none."""
    found = None if name is None else LEVEL.search(name)
    return None if found is None else found.group(1).upper()


def verdict(level: str, offset_px: float, offset_m: float, max_px: float) -> Verdict:
    """`move` for a systematic scene measured over `max_px` off within `SYSTEMATIC_MAX_M`; `implausible` past it; else `keep`."""
    if level not in SYSTEMATIC or offset_px <= max_px:
        return "keep"
    return "move" if offset_m <= SYSTEMATIC_MAX_M else "implausible"


def moved_grid(grid: Grid, shift: Shift) -> Grid:
    """The grid to sample the scene on so that its content lands `shift` back: right by `dx` pixels and down by `dy`."""
    return Grid(grid.left + shift.dx * grid.resolution, grid.top - shift.dy * grid.resolution, grid.resolution, grid.width, grid.height)


@dataclass(frozen=True)
class Correction:
    """What the report says of a move: `applied`, or `refused` with why (`implausible`: too far; `unconfirmed`: not within a pixel
    when measured again), and the measured shift in ground metres east and north."""

    state: Literal["applied", "refused"]
    east_m: float
    north_m: float
    reason: Literal["implausible", "unconfirmed"] | None = None

    def record(self) -> dict[str, object]:
        fields: dict[str, object] = {"state": self.state, "eastM": round(self.east_m, 1), "northM": round(self.north_m, 1)}
        return fields if self.reason is None else {**fields, "reason": self.reason}
