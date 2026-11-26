"""The two assembly cases (docs/research/M20-import-local.md §3, *Atlases and pieces*): many scans made one map before it is placed.

- **Pieces**: overlapping scans of one big sheet, joined pair by pair on their features (`joins`, M22 §4.1). The pieces are
  chained from the best-connected one along the strongest overlaps (a maximum spanning tree, `tree`), and every pixel of the canvas
  takes the piece whose centre is nearest among those that cover it: a hard seam, never a feather (blending line art doubles its lines). The
  global bundle adjustment and the graph-cut seam of §3 are not built: the tree's chained fits and the nearest-centre seam stand for them.
- **Atlas**: numbered pages that abut on a printed grid. Without OCR of the index page (not built), the layout comes from the pages
  themselves: two pages are neighbours when the ink along one's right (or bottom) edge continues along the other's left (or top) edge,
  each the other's best match, and the pages are laid out on whole cells from the best-connected page.

Either way, a part that joins nothing is left out and reported, and a cell inside the layout with no part is a hole (§3: Borroczyn's page
50 is in the twin set). The canvas is written to the job's scratch folder; one that waits for a person is kept as its stitched
picture (`stitched`).
"""

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

import cv2
import numpy
from numpy.typing import NDArray

from hcm_pipeline.placing.frame import find_frame
from hcm_pipeline.placing.geometry import FloatArray, compose, invert
from hcm_pipeline.placing.raster_io import RGB, read_working
from hcm_pipeline.placing.streets import UInt8Array, grey_of
from hcm_pipeline.rasters import GTIFF_OPTIONS, GeoTiff, write_geotiff

MATCH_PX: Final = 1200
CANVAS_MAX_PX: Final = 20_000
PAGE_PX: Final = 800
PROFILE_SAMPLES: Final = 256
EDGE_STRIP: Final = 1
MIN_EDGE_SCORE: Final = 0.6
# The best continuation must beat the page's next best by this much (a missing page leaves its neighbours a poor second best).
EDGE_MARGIN: Final = 0.15
OWNER_STEP: Final = 8
# Paper white past a part's edge, in every band (a bare 255 is white in the first band only: a coloured sliver along the atlas's rim).
PAPER: Final = (255, 255, 255)


@dataclass(frozen=True)
class Layout:
    """Where each kept part lies on the canvas (a 2x3 from its working pixels to canvas pixels), the canvas size, and the parts left
    out (by index) and the holes (atlas cells with no page)."""

    placed: dict[int, FloatArray]
    size: tuple[int, int]
    left_out: tuple[int, ...] = ()
    holes: int = 0


@dataclass
class Edges:
    """The overlaps found: (strength, i, j, the 2x3 taking j's pixels to i's)."""

    found: list[tuple[float, int, int, FloatArray]] = field(default_factory=list)


IDENTITY: Final = numpy.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]])


def _strength(count: int, edges: Edges) -> FloatArray:
    strength = numpy.zeros(count)
    for weight, i, j, _ in edges.found:
        strength[[i, j]] += weight
    return strength


def tree(count: int, edges: Edges) -> tuple[dict[int, FloatArray], tuple[int, ...]]:
    """Each part's transform to the root's pixels along the strongest overlaps, from the best-connected part."""
    placed = {int(numpy.argmax(_strength(count, edges))): IDENTITY}
    for _ in range(count):
        _grow(placed, edges)
    return placed, tuple(index for index in range(count) if index not in placed)


def _grow(placed: dict[int, FloatArray], edges: Edges) -> None:
    """The strongest overlap between a placed part and one not yet placed joins the latter."""
    joining = [edge for edge in sorted(edges.found, key=lambda edge: -edge[0]) if (edge[1] in placed) != (edge[2] in placed)]
    if joining:
        _, i, j, matrix = joining[0]
        new, transform = (j, compose(placed[i], matrix)) if i in placed else (i, compose(placed[j], invert(matrix)))
        placed[new] = transform


def bounds(placed: dict[int, FloatArray], sizes: Sequence[tuple[int, int]]) -> tuple[FloatArray, tuple[int, int]]:
    corners = []
    for index, matrix in placed.items():
        width, height = sizes[index]
        box = numpy.array([[0, 0], [width, 0], [width, height], [0, height]], numpy.float64)
        corners.append(box @ matrix[:, :2].T + matrix[:, 2])
    stacked = numpy.vstack(corners)
    low, high = stacked.min(axis=0), stacked.max(axis=0)
    return low, (math.ceil(high[0] - low[0]), math.ceil(high[1] - low[1]))


# --- atlas pages ------------------------------------------------------------------------------------------------------


def _ink_profile(strip: UInt8Array, along: int) -> FloatArray:
    """The darkness along an edge strip, resampled to `PROFILE_SAMPLES` and centred."""
    ink = 255.0 - strip.astype(numpy.float64).mean(axis=1 - along)
    profile = numpy.interp(numpy.linspace(0, len(ink) - 1, PROFILE_SAMPLES), numpy.arange(len(ink)), ink)
    return numpy.asarray(profile - profile.mean(), numpy.float64)


def edges_of(page: UInt8Array) -> dict[str, FloatArray]:
    """A page's four edge profiles (right and left run down the page, top and bottom across)."""
    k = EDGE_STRIP
    return {
        "right": _ink_profile(page[:, -k:], 0),
        "left": _ink_profile(page[:, :k], 0),
        "bottom": _ink_profile(page[-k:, :], 1),
        "top": _ink_profile(page[:k, :], 1),
    }


def ncc(first: FloatArray, second: FloatArray) -> float:
    norm = float(numpy.linalg.norm(first) * numpy.linalg.norm(second))
    return float(first @ second) / norm if norm > 0 else 0.0


def _scores(profiles: Sequence[dict[str, FloatArray]], side: str, facing: str) -> FloatArray:
    """How well each page's `side` edge continues into each other page's `facing` edge (-1 on the diagonal)."""
    count = len(profiles)
    scores = numpy.array([[ncc(profiles[i][side], profiles[j][facing]) for j in range(count)] for i in range(count)])
    numpy.fill_diagonal(scores, -1.0)
    return scores


def _clear(scores: FloatArray) -> NDArray[numpy.bool_]:
    """Which rows' best score is high and beats their second best by `EDGE_MARGIN`."""
    ranked = numpy.sort(scores, axis=1)
    second = ranked[:, -2] if scores.shape[1] > 1 else numpy.full(len(scores), -1.0)
    return numpy.asarray((ranked[:, -1] >= MIN_EDGE_SCORE) & (ranked[:, -1] - second >= EDGE_MARGIN), numpy.bool_)


def _best_neighbours(profiles: Sequence[dict[str, FloatArray]], side: str, facing: str) -> dict[int, tuple[int, float]]:
    """For each page, the page whose `facing` edge best and clearly continues its `side` edge (kept when each is the other's best),
    with that score."""
    scores = _scores(profiles, side, facing)
    best, back = numpy.argmax(scores, axis=1), numpy.argmax(scores, axis=0)
    mutual = (back[best] == numpy.arange(len(profiles))) & _clear(scores) & _clear(scores.T)[best]
    return {int(i): (int(best[i]), float(scores[i, best[i]])) for i in numpy.flatnonzero(mutual)}


Link = tuple[float, int, int, int, int]


def _links(pairs: dict[int, tuple[int, float]], step: tuple[int, int]) -> list[Link]:
    """Each pair as two links (score, from, to, dx, dy): one each way."""
    found: list[Link] = []
    for i, (j, score) in pairs.items():
        found.extend(((score, i, j, step[0], step[1]), (score, j, i, -step[0], -step[1])))
    return found


def page_cells(pages: Sequence[UInt8Array]) -> dict[int, tuple[int, int]]:
    """Each laid-out page's (column, row): the strongest links first (a maximum spanning tree), a link to a taken cell refused."""
    profiles = [edges_of(page) for page in pages]
    links = _links(_best_neighbours(profiles, "right", "left"), (1, 0)) + _links(_best_neighbours(profiles, "bottom", "top"), (0, 1))
    links.sort(key=lambda link: -link[0])
    cells = {links[0][1] if links else 0: (0, 0)}
    while _join(cells, links):
        pass
    return cells


def _target(cells: dict[int, tuple[int, int]], link: Link) -> tuple[int, int] | None:
    """The free cell a link from a laid-out page to one not yet laid out leads to, or None."""
    _, here, there, dx, dy = link
    if here not in cells or there in cells:
        return None
    cell = (cells[here][0] + dx, cells[here][1] + dy)
    return None if cell in cells.values() else cell


def _join(cells: dict[int, tuple[int, int]], links: list[Link]) -> bool:
    """The strongest link from a laid-out page to one not yet laid out, into a free cell; False when there is none."""
    for link in links:
        cell = _target(cells, link)
        if cell is not None:
            cells[link[2]] = cell
            return True
    return False


def frame_box(image: UInt8Array) -> tuple[slice, slice]:
    """The rows and columns of the page inside its frame (the whole page when it has none)."""
    corners = find_frame(grey_of(image))
    if corners is None:
        return slice(None), slice(None)
    left, top = numpy.floor(corners.min(axis=0)).astype(int)
    right, bottom = numpy.ceil(corners.max(axis=0)).astype(int)
    return slice(max(0, int(top)), int(bottom)), slice(max(0, int(left)), int(right))


def frame_crop(image: UInt8Array) -> UInt8Array:
    """The page inside its frame (the whole page when it has none)."""
    rows, columns = frame_box(image)
    return image[rows, columns]


@dataclass(frozen=True)
class Pages:
    """An atlas's pages, held grey and cropped to their frames (what the layout reads); each read again in colour only while it is
    pasted (reports/resource-audit.md: 60 colour pages beside the canvas were 735 MB more)."""

    paths: tuple[Path, ...]
    max_px: int
    grey: tuple[UInt8Array, ...]
    boxes: tuple[tuple[slice, slice], ...]
    colour: bool

    @classmethod
    def read(cls, paths: Sequence[Path], max_px: int) -> Pages:
        grey, boxes, colour = [], [], False
        for path in paths:
            image = read_working(path, max_px).image
            box = frame_box(image)
            colour = colour or image.ndim == RGB
            grey.append(grey_of(image[box]))
            boxes.append(box)
        return cls(tuple(paths), max_px, tuple(grey), tuple(boxes), colour)

    def page(self, index: int) -> UInt8Array:
        """Page `index` as it is pasted: read again, cropped to its frame."""
        return read_working(self.paths[index], self.max_px).image[self.boxes[index]]


def _stretch(page: UInt8Array, cell: tuple[int, int], at: tuple[int, int]) -> FloatArray:
    height, width = page.shape[:2]
    return numpy.array([[cell[0] / width, 0.0, at[0] * cell[0]], [0.0, cell[1] / height, at[1] * cell[1]]])


def atlas_layout(pages: Sequence[UInt8Array], cell: tuple[int, int]) -> Layout:
    """The pages on whole cells of `cell` (width, height) canvas pixels: each page stretched to its cell."""
    cells = page_cells([grey_of(page) for page in pages])
    places = numpy.array(list(cells.values()))
    low, span = places.min(axis=0), places.max(axis=0) - places.min(axis=0) + 1
    placed = {index: _stretch(pages[index], cell, (column - low[0], row - low[1])) for index, (column, row) in cells.items()}
    left_out = tuple(sorted(set(range(len(pages))) - set(cells)))
    return Layout(placed, (int(span[0]) * cell[0], int(span[1]) * cell[1]), left_out, int(span[0] * span[1]) - len(cells))


# --- the canvas ---------------------------------------------------------------------------------------------------------


def _owners(layout: Layout, sizes: Sequence[tuple[int, int]]) -> NDArray[numpy.int32]:
    """Which part each canvas pixel takes (on a coarse grid): the covering part whose centre is nearest; -1 where none covers."""
    width, height = (max(1, layout.size[0] // OWNER_STEP), max(1, layout.size[1] // OWNER_STEP))
    best = numpy.full((height, width), numpy.inf)
    owner = numpy.full((height, width), -1, numpy.int32)
    v, u = numpy.mgrid[0:height, 0:width] * OWNER_STEP + OWNER_STEP / 2
    for index, matrix in layout.placed.items():
        inverse = invert(matrix)
        x = inverse[0, 0] * u + inverse[0, 1] * v + inverse[0, 2]
        y = inverse[1, 0] * u + inverse[1, 1] * v + inverse[1, 2]
        part_w, part_h = sizes[index]
        inside = (x >= 0) & (y >= 0) & (x < part_w) & (y < part_h)
        distance = numpy.hypot(x - part_w / 2, y - part_h / 2)
        better = inside & (distance < best)
        best[better], owner[better] = distance[better], index
    return owner


def _blank(colour: bool, size: tuple[int, int]) -> UInt8Array:
    width, height = size
    return numpy.full((height, width, RGB) if colour else (height, width), 255, numpy.uint8)


def _like(image: UInt8Array, canvas: UInt8Array) -> UInt8Array:
    """A grey part made colour when the canvas is."""
    return numpy.dstack([image] * RGB) if canvas.ndim == RGB and image.ndim != RGB else image


def _own_box(matrix: FloatArray, size: tuple[int, int], canvas: tuple[int, int]) -> tuple[int, int, int, int]:
    """The canvas pixels (left, top, right, bottom) a part of `size` reaches through `matrix`, a pixel more on every side (the blend at
    its edge), inside the canvas."""
    width, height = size
    corners = numpy.array([[0, 0], [width, 0], [0, height], [width, height]], numpy.float64) @ matrix[:, :2].T + matrix[:, 2]
    low, high = numpy.floor(corners.min(axis=0)) - 1, numpy.ceil(corners.max(axis=0)) + 1
    return max(0, int(low[0])), max(0, int(low[1])), min(canvas[0], int(high[0])), min(canvas[1], int(high[1]))


def _cells(pixels: int, cells: int, first: int, last: int) -> NDArray[numpy.intp]:
    """The owners' cell of each canvas pixel from `first` up to `last` along a side of `pixels`: the nearest, as `cv2.resize` picks it."""
    scale = 1.0 / (pixels / cells)
    return numpy.minimum(numpy.floor(numpy.arange(first, last) * scale).astype(numpy.intp), cells - 1)


def _paste(canvas: UInt8Array, image: UInt8Array, matrix: FloatArray, mine: NDArray[numpy.bool_], corner: tuple[int, int]) -> None:
    """`image` through `matrix` onto its own box of the canvas (from `corner`, as large as `mine`), where `mine` says the box is its."""
    height, width = mine.shape
    shifted = matrix.copy()
    shifted[:, 2] -= corner
    warped = cv2.warpAffine(image, shifted, (width, height), flags=cv2.INTER_LINEAR, borderValue=PAPER)
    canvas[corner[1] : corner[1] + height, corner[0] : corner[0] + width][mine] = warped[mine]


def compose_canvas(images: Sequence[UInt8Array], layout: Layout) -> UInt8Array:
    """The parts on the canvas with hard seams (`_owners`); paper white where no part lies."""
    sizes = [(image.shape[1], image.shape[0]) for image in images]
    return compose_parts(images.__getitem__, sizes, any(image.ndim == RGB for image in images), layout)


def compose_parts(part: Callable[[int], UInt8Array], sizes: Sequence[tuple[int, int]], colour: bool, layout: Layout) -> UInt8Array:
    """The parts (`part(index)`, of `sizes`) on the canvas with hard seams (`_owners`); paper white where no part lies. Each part is
    asked for once, warped only into its own box, and the owners stay on their coarse grid (reports/resource-audit.md: 60 colour sheets
    held 3.8 GB with every part warped onto a whole canvas and the owners resized to it, 1.7 GB so, for a sixth of the time)."""
    canvas = _blank(colour, layout.size)
    owners = _owners(layout, sizes)
    for index, matrix in layout.placed.items():
        left, top, right, bottom = _own_box(matrix, sizes[index], layout.size)
        if right <= left or bottom <= top:
            continue
        rows, columns = _cells(layout.size[1], owners.shape[0], top, bottom), _cells(layout.size[0], owners.shape[1], left, right)
        _paste(canvas, _like(part(index), canvas), matrix, owners[numpy.ix_(rows, columns)] == index, (left, top))
    return canvas


def write_canvas(target: Path, canvas: UInt8Array) -> Path:
    """The canvas as a plain (not georeferenced) TIFF in the scratch folder."""
    bands = [canvas[:, :, index] for index in range(RGB)] if canvas.ndim == RGB else [canvas]
    return write_geotiff(target, GeoTiff(bands, None), GTIFF_OPTIONS)
