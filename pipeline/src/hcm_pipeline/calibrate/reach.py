"""What a proved frame reaches of the city: the crop, the covered share and the outline (docs/research/M9-calibration.md §5).

All of it is measured through the proved map, on the exposure: the crop renders nothing beyond the window, the share is the part of
the city's bounds on film, and the outline (the exposure's edge, clipped to the bounds, at most 32 vertices) is what a join plans with
instead of the scene's metadata.
"""

from dataclasses import dataclass
from typing import Final

import cv2
import numpy
from numpy.typing import NDArray

from hcm_pipeline.calibrate.poly import Mask, PlaceMap
from hcm_pipeline.calibrate.proof import Proof
from hcm_pipeline.geo import FloatArray, Grid, MercatorBox, to_lnglat
from hcm_pipeline.georef.corners import Box

PROOF_CROP_PAD_PX: Final = 64
# The mask's side: fine enough for a percentage and an outline, a cheap evaluation of the map.
COVER_SIDE_CELLS: Final = 256
OUTLINE_MAX_VERTICES: Final = 32
OUTLINE_MIN_VERTICES: Final = 3
PERCENT: Final = 100.0


@dataclass(frozen=True)
class Reach:
    """A box of places on film: the cells on film, their film pixels, and the grid they lie on."""

    mask: Mask
    film: FloatArray
    grid: Grid

    @property
    def share(self) -> float:
        return float(self.mask.mean())


def reach_of(mapping: PlaceMap, box: MercatorBox, limits: tuple[int, int, int]) -> Reach:
    """Which places of `box` lie on the exposure through `mapping` (`limits`: up to this column, this row, from this column)."""
    grid = Grid.over(box, max(box.width, box.height) / COVER_SIDE_CELLS)
    mx, my = grid.centres()
    film = mapping.to_film(numpy.column_stack((mx.ravel(), my.ravel())))
    inside = (film[:, 0] >= limits[2]) & (film[:, 0] < limits[0]) & (film[:, 1] >= 0) & (film[:, 1] < limits[1])
    return Reach(numpy.asarray(inside.reshape(mx.shape), numpy.bool_), film, grid)


def measured_pct(proof: Proof, window_spread: float | None = None) -> float:
    """How much of what the frame covers of the window its agreeing tiles span, percent: what the tiles speak for. The rest of the frame
    renders too, on the polynomial's word alone. `window_spread`: a proof over a wider box's figure for the window itself."""
    return round(min(proof.spread if window_spread is None else window_spread, 1.0) * PERCENT, 1)


def proved_box(reach: Reach, limits: tuple[int, int, int]) -> Box | None:
    """The film pixels of the places on film, with a pad; None when none is."""
    film = reach.film[reach.mask.ravel()]
    if not len(film):
        return None
    left, top = max(limits[2], int(film[:, 0].min()) - PROOF_CROP_PAD_PX), max(0, int(film[:, 1].min()) - PROOF_CROP_PAD_PX)
    right, bottom = min(limits[0], int(film[:, 0].max()) + PROOF_CROP_PAD_PX), min(limits[1], int(film[:, 1].max()) + PROOF_CROP_PAD_PX)
    return left, top, right, bottom


def _simple(contour: NDArray[numpy.int32]) -> NDArray[numpy.int32]:
    """The contour with at most `OUTLINE_MAX_VERTICES`: the tolerance doubled until it fits."""
    tolerance, shape = 1.0, contour
    while len(shape) > OUTLINE_MAX_VERTICES:
        shape = numpy.asarray(cv2.approxPolyDP(contour, tolerance, True), numpy.int32)
        tolerance *= 2
    return shape


def outline(reach: Reach) -> list[dict[str, float]]:
    """The covered part's edge as `{lat, lng}` places: the largest part's, simplified; none under a triangle."""
    contours, _ = cv2.findContours(reach.mask.astype(numpy.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return []
    shape = _simple(numpy.asarray(max(contours, key=cv2.contourArea), numpy.int32)).reshape(-1, 2)
    if len(shape) < OUTLINE_MIN_VERTICES:
        return []
    places = [
        to_lnglat(reach.grid.left + (u + 0.5) * reach.grid.resolution, reach.grid.top - (v + 0.5) * reach.grid.resolution)
        for u, v in shape.tolist()
    ]
    return [{"lat": round(lat, 6), "lng": round(lng, 6)} for lng, lat in places]
