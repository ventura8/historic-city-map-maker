"""The corner guess of `locate` (docs/research/M3-interfaces.md §5.4).

The scene's four geographic corners give the frame's footprint, but the film's first pixel row may lie at any of
them (forward or aft camera, the flight's direction), so each of the eight assignments of the frame's pixel
corners to the geographic ones (four rotations, each mirrored or not) gives a projective transform; each is scored
by the normalized correlation of the frame warped onto the city window at 60 m against the Sentinel-2 reference at
60 m, and the best one is kept. It maps the city window back into frame pixels: that crop is the scan, and four
GCPs at the crop's corners start the georeferencing.

Findings 62 and 63 of 2026-11-02 (a KH-9 Hexagon panoramic frame, a 1:12 strip): the best of the eight scored a
correlation of 0.03, a quarter turn, and was cropped anyway; the quarter turn stretched the window across the strip's
whole length (a scan over the 200 000 pixels a version may hold, which the admin then could not read) and its scan
matched nothing. Now an assignment whose ground pixel is far longer one way than the best-shaped assignment's is not
scored (`MAX_ANISOTROPY`: a quarter turn or a transposition of a strip); a guess under `MIN_CORRELATION` is searched
again over a window widened by `SEARCH_MARGIN` on every side (the frame warped onto it, the city's reference matched
inside it, the guess moved by the best match's offset: metadata corners are often kilometres off).

The rehearsal on the real 1972 frame D3C1202-200149F039 (lesson 361): a panoramic frame's corners give no homography, so a camera
with a half angle starts from `georef/panoramic.py`'s local fit. M9 (docs/research/M9-calibration.md): which orientation is true and
where the frame lies is `calibrate/`'s to find and prove; here are only the orientations, the crops and what reaches the window. A frame
nothing proves is no failure: `bounded_crop` holds the window with `UNPROVEN_MARGIN_M` under the orientations that reach it, cut to
what a scan may hold, and the admin places the points. `CityNotFoundError` is left for a frame whose exposure does not reach the
window under any assignment: a panoramic camera's dark gap and the next exposure's fragment are no ground of this frame.
"""

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from itertools import combinations, product
from typing import Final

import cv2
import numpy
from numpy.typing import NDArray

from hcm_pipeline.contract import MAX_SCAN_PIXELS
from hcm_pipeline.geo import WORLD_HALF_M, FloatArray, Grid, MercatorBox, ground_scale, near_lng, to_lnglat, to_mercator
from hcm_pipeline.georef.panoramic import PanoramicCamera, PanoramicModel
from hcm_pipeline.georef.transforms import Gcp
from hcm_pipeline.images import UInt8Array

SCORE_RESOLUTION_M: Final = 60.0
# A crop narrower or shorter than this many pixels misses the window.
MIN_CROP_PX: Final = 2
# An assignment whose ground pixel is longer one way than the other by more than this many times the best-shaped
# assignment's is not scored: a quarter turn of a 1:12 strip stretches its pixels about 140 times, of the real KH-7 strip 1:2.25 about
# 4 times where its true orientation reads 1.3, which 3 times let through: eight orientations to search instead of four.
MAX_ANISOTROPY: Final = 2.5
# Whether a frame reaches the window: over the window widened on every side by this share of its size, or by the sensor's search range
# on the ground when that is more (a town's own size is no measure of the metadata's error), film over at least this share of the
# window widened by `REACH_MARGIN` alone.
REACH_MARGIN: Final = 0.5
MIN_REACH_COVERAGE: Final = 0.05
# The margin (ground metres) of a frame nothing proved, on every side of the window: F006 lay 14 km ground off.
UNPROVEN_MARGIN_M: Final = 20_000.0
# How far towards their middle corners past longitude 180 stop: just inside, since a polynomial bends; and a quad that still spans an area.
INSIDE_WORLD_SHARE: Final = 0.99
MIN_INSIDE_WORLD_SHARE: Final = 0.01
LatLng = tuple[float, float]


class CityNotFoundError(ValueError):
    """The frame does not reach the city window under any assignment."""

    def __init__(self) -> None:
        super().__init__("the frame does not reach the city window under any orientation")


class DegenerateCornersError(ValueError):
    """Four corners that are collinear or coincident give no invertible projective transform."""

    def __init__(self) -> None:
        super().__init__("four corners are collinear or coincident and give no projective transform")


def homography(source: FloatArray, target: FloatArray) -> FloatArray:
    """The 3x3 projective map taking the four `source` points onto the four `target` points."""
    if _flat(source) or _flat(target):
        raise DegenerateCornersError
    rows, values = [], []
    for (x, y), (u, v) in zip(source.tolist(), target.tolist(), strict=True):
        rows += [[x, y, 1.0, 0.0, 0.0, 0.0, -u * x, -u * y], [0.0, 0.0, 0.0, x, y, 1.0, -v * x, -v * y]]
        values += [u, v]
    try:
        solution = numpy.linalg.solve(numpy.array(rows), numpy.array(values))
        matrix = numpy.append(solution, 1.0).reshape(3, 3)
        numpy.linalg.inv(matrix)
    except numpy.linalg.LinAlgError as error:
        raise DegenerateCornersError from error
    return matrix


# Three of four corners closer to one line than this share of the quad's size squared: no projective map, only a rounding's.
_FLAT_SHARE: Final = 1e-9


def _flat(points: FloatArray) -> bool:
    """Whether three of the four points lie on one line (two the same included). A corner given twice can still solve in floating point,
    to a map of 1e15 that folds the strip to a point (live 2026-11-14, DS1111-1020AF035)."""
    size = float(numpy.ptp(points, axis=0).max()) ** 2
    triples = combinations(range(len(points)), 3)
    return size == 0 or any(abs(_turn(points[a], points[b], points[c])) <= _FLAT_SHARE * size for a, b, c in triples)


def _turn(a: FloatArray, b: FloatArray, c: FloatArray) -> float:
    """Twice the signed area of the triangle a, b, c."""
    return float((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))


def apply(matrix: FloatArray, x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray]:
    """`matrix` applied to the points (x, y)."""
    w = matrix[2, 0] * x + matrix[2, 1] * y + matrix[2, 2]
    return (matrix[0, 0] * x + matrix[0, 1] * y + matrix[0, 2]) / w, (matrix[1, 0] * x + matrix[1, 1] * y + matrix[1, 2]) / w


@dataclass(frozen=True)
class Assignment:
    """Which geographic corner the frame's top-left pixel corner lies at, and the transform it gives."""

    rotation: int
    mirrored: bool
    matrix: FloatArray

    def to_mercator(self, x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray]:
        return apply(self.matrix, x, y)

    def to_pixel(self, mx: FloatArray, my: FloatArray) -> tuple[FloatArray, FloatArray]:
        return apply(numpy.linalg.inv(self.matrix), mx, my)

    def moved(self, dx: float, dy: float) -> Assignment:
        """The same assignment with every place moved by (`dx`, `dy`) EPSG:3857 metres."""
        shift = numpy.array([[1.0, 0.0, dx], [0.0, 1.0, dy], [0.0, 0.0, 1.0]])
        return Assignment(self.rotation, self.mirrored, shift @ self.matrix)


def frame_corners(width: int, height: int) -> FloatArray:
    """The frame's pixel corners: top-left, top-right, bottom-right, bottom-left."""
    return numpy.array([[0.0, 0.0], [width, 0.0], [width, height], [0.0, height]])


def _assignment(rotation: int, mirrored: bool, source: FloatArray, target: FloatArray) -> Assignment | None:
    try:
        return Assignment(rotation, mirrored, homography(source, target))
    except DegenerateCornersError:
        return None


def assignments(width: int, height: int, quad: Sequence[LatLng]) -> list[Assignment]:
    """The non-degenerate assignments of the frame's corners to the geographic corners (north-west first, clockwise)."""
    places = [to_mercator(lng, lat) for lat, lng in quad]
    orders = (places, [places[0], places[3], places[2], places[1]])
    corners = frame_corners(width, height)
    tried = (
        _assignment(rotation, bool(mirrored), corners, _turned(order, rotation))
        for (mirrored, order), rotation in product(enumerate(orders), range(4))
    )
    return [each for each in tried if each is not None]


def _turned(order: list[tuple[float, float]], rotation: int) -> FloatArray:
    return numpy.array(order[rotation:] + order[:rotation])


def anisotropy(transform: Assignment, width: int, height: int) -> float:
    """How many times longer the ground pixel at the frame's centre is one way than the other (1: square)."""
    x = numpy.array([width / 2, width / 2 + 1, width / 2])
    y = numpy.array([height / 2, height / 2, height / 2 + 1])
    mx, my = transform.to_mercator(x, y)
    along_x, along_y = math.hypot(mx[1] - mx[0], my[1] - my[0]), math.hypot(mx[2] - mx[0], my[2] - my[0])
    return max(along_x, along_y) / max(min(along_x, along_y), 1e-12)


def around(quad: Sequence[LatLng], middle_lng: float) -> list[LatLng]:
    """The corners on the side of `middle_lng`: a frame over longitude 180 stays one piece around the city."""
    return [(lat, near_lng(lng, middle_lng)) for lat, lng in quad]


def plausible(width: int, height: int, quad: Sequence[LatLng]) -> list[Assignment]:
    """The assignments whose ground pixels are about as square as the best-shaped one's (`MAX_ANISOTROPY`)."""
    found = assignments(width, height, quad)
    if not found:
        return []
    shapes = [anisotropy(candidate, width, height) for candidate in found]
    least = min(shapes)
    return [candidate for candidate, shape in zip(found, shapes, strict=True) if shape <= least * MAX_ANISOTROPY]


@dataclass(frozen=True)
class Frame:
    """The frame downsampled for scoring: `pixels` of the full-resolution frame shrunk `factor` times; `exposure`, the columns
    that are ground of this frame (None: all of them)."""

    pixels: UInt8Array
    factor: float
    width: int
    height: int
    exposure: tuple[int, int] | None = None

    @property
    def ground(self) -> tuple[int, int]:
        """The first column of the frame's ground and the one past its last."""
        return self.exposure or (0, self.width)


def warp_onto(frame: Frame, transform: Assignment, grid: Grid) -> tuple[UInt8Array, NDArray[numpy.bool_]]:
    """The frame resampled onto `grid` through `transform`, and the mask of grid pixels the frame covers."""
    mx, my = grid.centres()
    px, py = transform.to_pixel(mx, my)
    start, end = frame.ground
    inside = (px >= start) & (px < end) & (py >= 0) & (py < frame.height)
    map_x = (px / frame.factor - 0.5).astype(numpy.float32)
    map_y = (py / frame.factor - 0.5).astype(numpy.float32)
    warped = cv2.remap(frame.pixels, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    return numpy.asarray(warped, numpy.uint8), inside


def _widened(grid: Grid, margin_ground_m: float) -> Grid:
    """`grid` grown on every side by `REACH_MARGIN` of its size, or by `margin_ground_m` on the ground when that is more (whole pixels)."""
    reach = math.ceil(margin_ground_m / ground_scale(grid.box().bounds().middle_lat) / grid.resolution)
    columns, rows = max(1, reach, round(grid.width * REACH_MARGIN)), max(1, reach, round(grid.height * REACH_MARGIN))
    return Grid(
        grid.left - columns * grid.resolution,
        grid.top + rows * grid.resolution,
        grid.resolution,
        grid.width + 2 * columns,
        grid.height + 2 * rows,
    )


def reaching(frame: Frame, firsts: Sequence[Assignment], grid: Grid, margin_ground_m: float) -> list[tuple[Assignment, float]]:
    """The orientations whose film reaches the window's surroundings (`margin_ground_m`: how far off the sensor's search looks), with
    the share of the window they cover, most first (of equals, as given). CityNotFoundError when none does."""
    wide = _widened(grid, margin_ground_m)
    # The share is of the window's own surroundings: a wider search must never make a small frame over a small window read as less.
    needed = MIN_REACH_COVERAGE * (1 + 2 * REACH_MARGIN) ** 2 * grid.width * grid.height
    found = [
        (each, float(warp_onto(frame, each, grid)[1].mean()))
        for each in firsts
        if numpy.count_nonzero(warp_onto(frame, each, wide)[1]) >= needed
    ]
    if not found:
        raise CityNotFoundError
    return sorted(found, key=lambda entry: -entry[1])


def first_guesses(frame: Frame, quad: Sequence[LatLng], window: MercatorBox, camera: PanoramicCamera | None) -> list[Assignment]:
    """The plausible assignments, each as the panoramic model fitted around the window when the camera has one."""
    kept = plausible(frame.width, frame.height, around(quad, window.middle_lng))
    if camera is None:
        return kept
    return [fitted for fitted in (_panoramic(candidate, frame, window, camera) for candidate in kept) if fitted is not None]


def _panoramic(candidate: Assignment, frame: Frame, window: MercatorBox, camera: PanoramicCamera) -> Assignment | None:
    corners = frame_corners(frame.width, frame.height)
    places = numpy.column_stack(candidate.to_mercator(corners[:, 0], corners[:, 1]))
    matrix = PanoramicModel(places, camera, frame.height).local_matrix(window)
    return Assignment(candidate.rotation, candidate.mirrored, matrix) if _invertible(matrix) else None


def _invertible(matrix: FloatArray) -> bool:
    try:
        numpy.linalg.inv(matrix)
    except numpy.linalg.LinAlgError:
        return False
    return bool(numpy.isfinite(matrix).all())


def on_exposure(frame: Frame, camera: PanoramicCamera | None) -> Frame:
    """The frame as scored: a panoramic camera's on its exposure, whatever else the scan holds beyond it."""
    return frame if camera is None else replace(frame, exposure=(camera.image_start, camera.image_start + camera.image_width))


@dataclass(frozen=True)
class Crop:
    """The frame's pixel box over the city window, four GCPs that start the georeferencing (in the crop's pixels), and whether
    they come from a guess nothing confirmed (`weak`)."""

    left: int
    top: int
    width: int
    height: int
    gcps: tuple[Gcp, ...]
    weak: bool = False


Box = tuple[int, int, int, int]


def crop_box(transform: Assignment, window: MercatorBox, width: int, height: int, start: int = 0) -> Box:
    """The frame pixels (left, top, right, bottom) the window maps onto, clipped to the columns from `start` up to `width` (a
    panoramic camera's exposure) and the rows up to `height`."""
    px, py = transform.to_pixel(
        numpy.array([window.left, window.right, window.right, window.left]),
        numpy.array([window.top, window.top, window.bottom, window.bottom]),
    )
    left, top = max(start, int(numpy.floor(px.min()))), max(0, int(numpy.floor(py.min())))
    right, bottom = min(width, int(numpy.ceil(px.max()))), min(height, int(numpy.ceil(py.max())))
    if min(right - left, bottom - top) < MIN_CROP_PX:
        raise CityNotFoundError
    return left, top, right, bottom


def crop(transform: Assignment, window: MercatorBox, width: int, height: int, start: int = 0) -> Crop:
    """The scan's crop and its corner GCPs (`origin: 'corner'`, ids `c1` to `c4`, clockwise from the top-left)."""
    box = crop_box(transform, window, width, height, start)
    return Crop(box[0], box[1], box[2] - box[0], box[3] - box[1], _corner_gcps(transform, box, box))


def _box_reached(transform: Assignment, window: MercatorBox, limits: tuple[int, int, int]) -> Box | None:
    """`crop_box` of an orientation that may miss the widened window: None then."""
    try:
        return crop_box(transform, window, limits[0], limits[1], limits[2])
    except CityNotFoundError:
        return None


def _union(boxes: Sequence[Box]) -> Box:
    """The smallest box holding all of `boxes`."""
    return min(box[0] for box in boxes), min(box[1] for box in boxes), max(box[2] for box in boxes), max(box[3] for box in boxes)


def _cut_axis(union: tuple[int, int], first: tuple[int, int], limit: int) -> tuple[int, int]:
    """One axis of a crop: the union when it fits, else `limit` around the first box's middle, inside the union."""
    if union[1] - union[0] <= limit:
        return union
    start = max(union[0], min((first[0] + first[1] - limit) // 2, union[1] - limit))
    return start, start + limit


def _cut(union: Box, first: Box, limit: int) -> Box:
    across, along = (
        _cut_axis((union[0], union[2]), (first[0], first[2]), limit),
        _cut_axis((union[1], union[3]), (first[1], first[3]), limit),
    )
    return across[0], along[0], across[1], along[1]


def _holds(outer: Box, inner: Box) -> bool:
    return outer[0] <= inner[0] and outer[1] <= inner[1] and outer[2] >= inner[2] and outer[3] >= inner[3]


def _clipped(box: Box, within: Box) -> Box:
    return max(box[0], within[0]), max(box[1], within[1]), min(box[2], within[2]), min(box[3], within[3])


def _boxes_reached(orientations: Sequence[Assignment], wide: MercatorBox, limits: tuple[int, int, int]) -> list[Box]:
    """The orientations' boxes around `wide`; a frame none of them reaches is not the city's."""
    boxes = [box for box in (_box_reached(each, wide, limits) for each in orientations) if box is not None]
    if not boxes:
        raise CityNotFoundError
    return boxes


def bounded_crop(
    orientations: Sequence[Assignment], window: MercatorBox, limits: tuple[int, int, int], limit: int = MAX_SCAN_PIXELS
) -> tuple[Crop, int]:
    """The crop of a frame nothing proved, and how many orientations it lost: the window with `UNPROVEN_MARGIN_M` on every side under
    each orientation that reaches it, most likely first. **It always fits**: a union over `limit` a side is cut to it around the first
    orientation's box. Its GCPs lie at the corners of the first's box inside the crop, where its fit holds; they only start the matcher."""
    margin = UNPROVEN_MARGIN_M / ground_scale(window.bounds().middle_lat)
    wide = MercatorBox(window.left - margin, window.bottom - margin, window.right + margin, window.top + margin)
    boxes = _boxes_reached(orientations, wide, limits)
    kept = _cut(_union(boxes), boxes[0], limit)
    gcps = _corner_gcps(orientations[0], _clipped(boxes[0], kept), kept)
    lost = sum(not _holds(kept, box) for box in boxes)
    return Crop(kept[0], kept[1], kept[2] - kept[0], kept[3] - kept[1], gcps, True), lost


def inside_world(corners: FloatArray, to_places: Callable[[FloatArray], FloatArray]) -> FloatArray:
    """Corners drawn towards their middle until none lies past longitude 180 (a place past it is no `lngSchema` place): a crop's corners
    stick out of a window that ends on the line. They only start a fit, and four points inside the crop start it as well."""
    furthest = float(numpy.abs(to_places(corners)[:, 0]).max())
    if furthest <= WORLD_HALF_M:
        return corners
    middle = corners.mean(axis=0)
    centre = float(numpy.abs(to_places(middle.reshape(1, 2))[0, 0]))
    share = max((WORLD_HALF_M - centre) / max(furthest - centre, 1e-9) * INSIDE_WORLD_SHARE, MIN_INSIDE_WORLD_SHARE)
    return numpy.asarray(middle + (corners - middle) * share, numpy.float64)


def _corner_gcps(transform: Assignment, box: Box, within: Box) -> tuple[Gcp, ...]:
    """Four GCPs at the corners of `box` (frame pixels) through `transform`, in the pixels of the crop `within`."""
    left, top, right, bottom = box
    start = frame_corners(right - left, bottom - top) + numpy.array([left, top])
    corners = inside_world(start, lambda film: numpy.column_stack(transform.to_mercator(film[:, 0], film[:, 1])))
    mx, my = transform.to_mercator(corners[:, 0], corners[:, 1])
    gcps = []
    for index, (x, y, merc_x, merc_y) in enumerate(zip(corners[:, 0], corners[:, 1], mx, my, strict=True), start=1):
        lng, lat = to_lnglat(float(merc_x), float(merc_y))
        gcps.append(Gcp(f"c{index}", float(x - within[0]), float(y - within[1]), lat, lng, True, "corner"))
    return tuple(gcps)


def corner_transform(gcps: Sequence[Gcp]) -> Assignment:
    """The projective transform through four corner GCPs (the matcher's starting point)."""
    if len(gcps) != len(("nw", "ne", "se", "sw")):
        raise ValueError("a corner transform needs exactly four corner GCPs")
    source = numpy.array([[gcp.x, gcp.y] for gcp in gcps])
    target = numpy.array([to_mercator(gcp.lng, gcp.lat) for gcp in gcps])
    return Assignment(0, False, homography(source, target))
