"""How a seam's offset moves its two parts, and the nodes that carry it into a warp (M8-join-interfaces.md §3, `align` 7 to 9).

The offset is shared by evidence: the worse-measured frame moves more. It fades with distance from the seam, so past
`TAPER_M` a part equals its approved georeference; the fields of several seams on one part add up. A warp cannot take a
field, so it travels as thin-plate nodes, dense where the field changes and sparse elsewhere.

A warp runs from the output to the scan, so what a part shows is GDAL's **reverse** transform of its points, fitted apart from the
forward one (on a panoramic frame they differ by tens of metres). A node therefore pairs a place with the pixel the reverse
transform reads there, and its target is that place plus the field: with no field, a warp through the nodes reads what the part's
own warp reads. A thin-plate part also keeps its own points as nodes: the spline through its points and any samples of itself is
itself, which no grid alone could hold.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Final

import numpy
import numpy.typing

from hcm_pipeline.geo import FloatArray
from hcm_pipeline.join.canvas import smoothstep
from hcm_pipeline.join.measure import SeamModel
from hcm_pipeline.join.seams import Seam, along

TAPER_M: Final = 6000.0
# A part's figure is never trusted below this: no frame is that well measured.
MIN_SIGMA_M: Final = 5.0
EQUAL_SHARE: Final = 0.5
NODE_SPACING_M: Final = 1000.0
# The dense nodes go on past the taper's end: nodes that do not move there are what hold a thin-plate spline still beyond it (with the
# sparse nodes starting at the taper's end, it drifted 1.3 m on the synthetic frame).
NODE_BAND_M: Final = TAPER_M + 2 * NODE_SPACING_M
# Outside the band only every other node of the grid is kept (2 km): a spline holds a curved transform only as well as its nodes are
# dense, and 5 km left 24 m at the corners of a frame 40 degrees off nadir.
SPARSE_EVERY: Final = 2
MAX_NODES: Final = 900
# A part's own points may leave the grid no room; the grid still holds the frame.
MIN_GRID_NODES: Final = 100
# A grid node this near a part's own point would only make the spline's system ill-conditioned.
ANCHOR_CLEARANCE_M: Final = 100.0
NODE_SPACING_GROWTH: Final = 1.25
DISTANCE_CHUNK: Final = 4096
# Places read per side of the scan for the largest move, between the nodes.
MOVE_PROBES: Final = 48
Node = tuple[float, float, float, float]
# Scan pixels to EPSG:3857 metres, or back; False where it has no answer.
Mapping = Callable[[FloatArray, FloatArray], tuple[FloatArray, FloatArray, numpy.typing.NDArray[numpy.bool_]]]


@dataclass(frozen=True)
class BaseTransform:
    """A part's own transform, GDAL's: `forward` (pixel to place), `reverse` (place to pixel, what a warp runs on), and for a
    thin-plate part the places of its own points."""

    forward: Mapping
    reverse: Mapping
    anchors: tuple[tuple[float, float], ...] = ()


def share_of(sigma_a: float | None, sigma_b: float | None) -> float:
    """Part `a`'s share of a seam's offset, its error squared over both squared; `b` has the rest. Equal when a figure is missing."""
    if sigma_a is None or sigma_b is None:
        return EQUAL_SHARE
    a, b = max(sigma_a, MIN_SIGMA_M) ** 2, max(sigma_b, MIN_SIGMA_M) ** 2
    return a / (a + b)


def taper(distance_m: FloatArray) -> FloatArray:
    """1 at the seam, 0 from `TAPER_M`, flat at both ends."""
    return smoothstep(1.0 - distance_m / TAPER_M)


def distance_m(x: FloatArray, y: FloatArray, line: FloatArray, ground: float) -> FloatArray:
    """Each point's distance to the line's nearest point, on the ground (in chunks: a scan's grid times a line is large)."""
    found = numpy.empty(x.shape, numpy.float64)
    flat_x, flat_y, out = x.ravel(), y.ravel(), found.ravel()
    for start in range(0, flat_x.size, DISTANCE_CHUNK):
        chunk_x = flat_x[start : start + DISTANCE_CHUNK, None] - line[:, 0]
        chunk_y = flat_y[start : start + DISTANCE_CHUNK, None] - line[:, 1]
        out[start : start + DISTANCE_CHUNK] = numpy.hypot(chunk_x, chunk_y).min(axis=1)
    return numpy.asarray(out.reshape(x.shape) * ground, numpy.float64)


@dataclass(frozen=True)
class SeamField:
    """One seam's pull on one part: `share` of its offset, signed for the side the part is on."""

    seam: Seam
    model: SeamModel
    share: float

    def at(self, x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray]:
        """The part's move (EPSG:3857 metres) at those places of it."""
        seam = self.seam
        dx, dy = self.model.at(along(seam.origin, seam.axis, x, y, seam.ground))
        weight = taper(distance_m(x, y, seam.line, seam.ground)) * self.share
        return dx * weight, dy * weight

    def in_band(self, x: FloatArray, y: FloatArray) -> numpy.typing.NDArray[numpy.bool_]:
        return numpy.asarray(distance_m(x, y, self.seam.line, self.seam.ground) < NODE_BAND_M, numpy.bool_)


def total_field(fields: Sequence[SeamField], x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray]:
    """The fields of a part's seams added up."""
    dx, dy = numpy.zeros(x.shape), numpy.zeros(x.shape)
    for field in fields:
        more_x, more_y = field.at(x, y)
        dx, dy = dx + more_x, dy + more_y
    return dx, dy


def _pixel_ground_m(base: BaseTransform, size: tuple[int, int], ground: float) -> float:
    """A scan pixel's size on the ground at the middle of the scan."""
    column = numpy.array([size[0] / 2, size[0] / 2 + 1.0])
    row = numpy.array([size[1] / 2, size[1] / 2])
    x, y, _ = base.forward(column, row)
    return max(float(numpy.hypot(x[1] - x[0], y[1] - y[0])) * ground, 1e-6)


def _axis(extent: int, step_px: float) -> FloatArray:
    return numpy.linspace(0.0, float(extent), max(2, int(numpy.ceil(extent / step_px)) + 1))


def _sparse(count: int) -> numpy.typing.NDArray[numpy.bool_]:
    """Every `SPARSE_EVERY`th index and the last (the outer ring stays closed)."""
    picked = numpy.arange(count) % SPARSE_EVERY == 0
    picked[-1] = True
    return numpy.asarray(picked, numpy.bool_)


def _picked(base: BaseTransform, size: tuple[int, int], fields: Sequence[SeamField], step_px: float) -> tuple[FloatArray, FloatArray]:
    """The places of the grid's nodes: inside a seam's band or on the sparse grid, whose last row and column close the outer ring."""
    columns, rows = _axis(size[0], step_px), _axis(size[1], step_px)
    u, v = numpy.meshgrid(columns, rows)
    x, y, good = base.forward(u.ravel(), v.ravel())
    band = numpy.zeros(x.shape, numpy.bool_)
    for field in fields:
        band |= field.in_band(x, y)
    sparse = _sparse(rows.size)[:, None] & _sparse(columns.size)[None, :]
    keep = (band | sparse.ravel()) & good
    return x[keep], y[keep]


def _grid_places(base: BaseTransform, size: tuple[int, int], fields: Sequence[SeamField]) -> tuple[FloatArray, FloatArray]:
    """The grid at most `MAX_NODES` with the part's points, the spacing widened until they fit."""
    room = max(MAX_NODES - len(base.anchors), MIN_GRID_NODES)
    step_px = NODE_SPACING_M / _pixel_ground_m(base, size, fields[0].seam.ground)
    x, y = _picked(base, size, fields, step_px)
    while x.size > room:
        step_px *= NODE_SPACING_GROWTH
        x, y = _picked(base, size, fields, step_px)
    return x, y


def _with_anchors(x: FloatArray, y: FloatArray, anchors: tuple[tuple[float, float], ...], ground: float) -> tuple[FloatArray, FloatArray]:
    """The grid's places clear of the part's own points, and those points."""
    if not anchors:
        return x, y
    own = numpy.array(anchors, numpy.float64)
    clear = distance_m(x, y, own, ground) >= ANCHOR_CLEARANCE_M
    return numpy.concatenate((x[clear], own[:, 0])), numpy.concatenate((y[clear], own[:, 1]))


def nodes_for(base: BaseTransform, size: tuple[int, int], fields: Sequence[SeamField]) -> tuple[Node, ...]:
    """The part's nodes through its fields (none without a field: the part keeps its own transform): each the pixel its own warp
    reads at a place, and that place moved by the field."""
    if not fields:
        return ()
    x, y = _with_anchors(*_grid_places(base, size, fields), base.anchors, fields[0].seam.ground)
    u, v, good = base.reverse(x, y)
    x, y = x[good], y[good]
    dx, dy = total_field(fields, x, y)
    return tuple(zip(u[good].tolist(), v[good].tolist(), (x + dx).tolist(), (y + dy).tolist(), strict=True))


def _probes(base: BaseTransform, nodes: Sequence[Node], size: tuple[int, int]) -> tuple[FloatArray, FloatArray]:
    """Places between the nodes all over the scan, and the nodes' own."""
    u, v = numpy.meshgrid(numpy.linspace(0.0, float(size[0]), MOVE_PROBES), numpy.linspace(0.0, float(size[1]), MOVE_PROBES))
    x, y, good = base.forward(u.ravel(), v.ravel())
    values = numpy.array(nodes, numpy.float64)
    return numpy.concatenate((x[good], values[:, 2])), numpy.concatenate((y[good], values[:, 3]))


def largest_move_m(base: BaseTransform, nodes: Sequence[Node], through: Mapping, size: tuple[int, int], ground: float) -> float:
    """How far a warp through the nodes (`through`: its place to pixel) moves anything from where the part's own warp shows it, on the
    ground. Read where the warps read: at a place, the gap between the pixels each shows, as ground through the part's transform; also
    between the nodes, because a spline holds at its nodes whatever it does elsewhere."""
    if not nodes:
        return 0.0
    x, y = _probes(base, nodes, size)
    own_u, own_v, own_good = base.reverse(x, y)
    new_u, new_v, new_good = through(x, y)
    good = own_good & new_good
    own_x, own_y, _ = base.forward(own_u[good], own_v[good])
    new_x, new_y, _ = base.forward(new_u[good], new_v[good])
    return float(numpy.hypot(new_x - own_x, new_y - own_y).max(initial=0.0)) * ground
