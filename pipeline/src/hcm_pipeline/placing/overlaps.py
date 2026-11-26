"""Sheets laid out by what they show twice (docs/research/M20-import-local.md §19.14), when their names do not say where they go.

1. Every sheet's ORB features (`FEATURES`, on a contrast-equalised copy); every pair matched (Lowe's ratio `RATIO`) and a similarity
   (turn, scale, shift) fitted by RANSAC (`cv2.estimateAffinePartial2D`). A pair is a `Link` when at least `MIN_INLIERS` matches,
   `MIN_INLIER_SHARE` of them, agree and the scale is within `SCALE_RANGE` (the sheets are on one cell).
2. The links' turns made one (`turns`): the sheets' turns along the strongest links (a maximum spanning tree) from the best linked
   sheet; a link whose turn disagrees with the tree by more than `TURN_SLACK_DEG` is dropped.
3. The shifts solved at once (`placed`): each link says where its two sheets' centres lie from each other once both are turned;
   iteratively reweighted least squares (Huber, `HUBER_PX`), a link still off by more than `OUTLIER_PX` dropped.

Only the largest group of linked sheets is laid out; the others are left out. Pages that only abut (no common strip) never link here:
they stay with the names' grid and its seams (`autostitch`).
"""

import itertools
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

import cv2
import numpy

from hcm_pipeline.placing.geometry import FloatArray
from hcm_pipeline.placing.streets import UInt8Array

FEATURES: Final = 3000
RATIO: Final = 0.75
MIN_INLIERS: Final = 20
MIN_INLIER_SHARE: Final = 0.1
RANSAC_PX: Final = 4.0
SCALE_RANGE: Final = (0.8, 1.25)
TURN_SLACK_DEG: Final = 3.0
HUBER_PX: Final = 3.0
OUTLIER_PX: Final = 12.0
ITERATIONS: Final = 8
CLAHE_LIMIT: Final = 2.0
MIN_SPREAD: Final = 1e-9
NEAREST: Final = 2


@dataclass(frozen=True)
class Features:
    """One sheet's keypoints (x, y) and their descriptors (None when it has too few)."""

    points: FloatArray
    descriptors: numpy.ndarray | None


@dataclass(frozen=True)
class Link:
    """Sheet `b` seen in sheet `a`: `b`'s turn there (degrees, clockwise on the page), its scale, the agreeing matches' centroids in
    each sheet (x, y) and how many agree."""

    a: int
    b: int
    turn: float
    scale: float
    at_a: tuple[float, float]
    at_b: tuple[float, float]
    inliers: int


def features_of(image: UInt8Array) -> Features:
    """The sheet's ORB keypoints and descriptors, found on a contrast-equalised copy (faint print and dark scans alike)."""
    equal = cv2.createCLAHE(clipLimit=CLAHE_LIMIT, tileGridSize=(8, 8)).apply(image)
    keypoints, descriptors = cv2.ORB.create(nfeatures=FEATURES).detectAndCompute(equal, None)
    points = numpy.array([keypoint.pt for keypoint in keypoints], numpy.float64).reshape(-1, 2)
    return Features(points, descriptors if len(points) >= MIN_INLIERS else None)


def _clear(pair: Sequence[cv2.DMatch]) -> bool:
    """A match whose best is clearly better than its second best (Lowe's ratio)."""
    return len(pair) == NEAREST and pair[0].distance < RATIO * pair[1].distance


def _matches(first: Features, second: Features) -> tuple[FloatArray, FloatArray]:
    """The pairs of points whose best match is clear."""
    if first.descriptors is None or second.descriptors is None:
        return numpy.zeros((0, 2)), numpy.zeros((0, 2))
    found = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(first.descriptors, second.descriptors, k=NEAREST)
    good = [pair[0] for pair in filter(_clear, found)]
    ids = numpy.array([(match.queryIdx, match.trainIdx) for match in good], numpy.int64).reshape(-1, 2)
    return first.points[ids[:, 0]].reshape(-1, 2), second.points[ids[:, 1]].reshape(-1, 2)


def _fit(at_a: FloatArray, at_b: FloatArray) -> tuple[numpy.ndarray, numpy.ndarray] | None:
    """The similarity from `b`'s points to `a`'s and which matches agree, when enough of them do."""
    if len(at_a) < MIN_INLIERS:
        return None
    # RANSAC finds no model on degenerate points (all on one line): OpenCV then answers None, which its stubs do not say.
    fitted: tuple[numpy.ndarray | None, numpy.ndarray] = cv2.estimateAffinePartial2D(
        at_b, at_a, method=cv2.RANSAC, ransacReprojThreshold=RANSAC_PX
    )
    matrix, mask = fitted
    if matrix is None:
        return None
    agree = mask.ravel().astype(bool)
    count = int(agree.sum())
    return (matrix, agree) if count >= max(MIN_INLIERS, MIN_INLIER_SHARE * len(at_a)) else None


def _point(values: FloatArray) -> tuple[float, float]:
    return float(values[0]), float(values[1])


def link_of(first: Features, second: Features, a: int, b: int) -> Link | None:
    """The similarity that brings `b`'s points onto `a`'s, when enough matches agree on it and its scale is the cell's; else None."""
    at_a, at_b = _matches(first, second)
    fitted = _fit(at_a, at_b)
    if fitted is None:
        return None
    matrix, agree = fitted
    scale = float(math.hypot(matrix[0, 0], matrix[1, 0]))
    if not SCALE_RANGE[0] <= scale <= SCALE_RANGE[1]:
        return None
    turn = math.degrees(math.atan2(matrix[1, 0], matrix[0, 0]))
    return Link(a, b, turn, scale, _point(at_a[agree].mean(axis=0)), _point(at_b[agree].mean(axis=0)), int(agree.sum()))


def every_pair(sheets: Sequence[int]) -> list[tuple[int, int]]:
    order = sorted(sheets)
    return [(order[first], order[second]) for first, second in zip(*numpy.triu_indices(len(order), 1), strict=True)]


def links_of(found: Mapping[int, Features], pairs: Sequence[tuple[int, int]] | None = None) -> list[Link]:
    """The links between the sheets (every pair, or only `pairs`)."""
    wanted = every_pair(list(found)) if pairs is None else pairs
    links = [link_of(found[a], found[b], a, b) for a, b in wanted]
    return [link for link in links if link is not None]


def wrapped(degrees: float) -> float:
    """The angle in (-180, 180]."""
    return float(-((-degrees + 180.0) % 360.0 - 180.0))


class _Groups:
    """Which group each sheet is in (union-find)."""

    def __init__(self) -> None:
        self.parent: dict[int, int] = {}

    def root(self, sheet: int) -> int:
        while self.parent.setdefault(sheet, sheet) != sheet:
            sheet = self.parent[sheet]
        return sheet

    def join(self, link: Link) -> bool:
        """The link's two groups joined; False when they were one already."""
        first, second = self.root(link.a), self.root(link.b)
        self.parent[second] = first
        return first != second

    def largest(self) -> set[int]:
        by_group: dict[int, set[int]] = {}
        for sheet in list(self.parent):
            by_group.setdefault(self.root(sheet), set()).add(sheet)
        return max(by_group.values(), key=len, default=set())


def _spanning(links: Sequence[Link]) -> tuple[list[Link], set[int]]:
    """A maximum spanning forest of the links (strongest first, Kruskal) and the sheets of its largest tree."""
    groups = _Groups()
    tree = [link for link in sorted(links, key=lambda found: -found.inliers) if groups.join(link)]
    return tree, groups.largest()


def _tree(links: Sequence[Link]) -> dict[int, float]:
    """Each sheet's turn along the spanning tree, walked out from the largest group's first sheet; only that group's sheets."""
    tree, keep = _spanning(links)
    turns = {min(keep): 0.0} if keep else {}
    for _ in range(len(keep)):
        for link in tree:
            _extend(turns, link)
    return {sheet: turns[sheet] for sheet in keep}


def _extend(turns: dict[int, float], link: Link) -> None:
    """The link's unknown end's turn from its known one: `b` lies turned by `link.turn` in `a`."""
    if link.a in turns and link.b not in turns:
        turns[link.b] = wrapped(turns[link.a] + link.turn)
    elif link.b in turns and link.a not in turns:
        turns[link.a] = wrapped(turns[link.b] - link.turn)


def turns(links: Sequence[Link]) -> tuple[dict[int, float], list[Link]]:
    """Every linked sheet's turn (degrees, the largest group only) and the links that agree with them."""
    found = _tree(links)
    return found, [link for link in links if _agrees(found, link)]


def _agrees(found: Mapping[int, float], link: Link) -> bool:
    known = link.a in found and link.b in found
    return known and abs(wrapped(found[link.b] - found[link.a] - link.turn)) <= TURN_SLACK_DEG


def rotation(degrees: float) -> FloatArray:
    radians = math.radians(degrees)
    return numpy.array([[math.cos(radians), -math.sin(radians)], [math.sin(radians), math.cos(radians)]], numpy.float64)


@dataclass(frozen=True)
class Placed:
    """Each sheet's centre on the canvas and turn, the links kept with their residuals (pixels) and those dropped."""

    centres: dict[int, tuple[float, float]]
    turns: dict[int, float]
    kept: tuple[Link, ...]
    residuals: tuple[float, ...]
    dropped: tuple[Link, ...]


@dataclass(frozen=True)
class _System:
    """The unknowns' order, the links and each one's measured step from `a`'s centre to `b`'s on the canvas (both turned)."""

    index: dict[int, int]
    links: tuple[Link, ...]
    steps: FloatArray


def _step(link: Link, found: Mapping[int, float], centres: Mapping[int, tuple[float, float]]) -> FloatArray:
    from_a = rotation(found[link.a]) @ (numpy.array(link.at_a) - centres[link.a])
    from_b = rotation(found[link.b]) @ (numpy.array(link.at_b) - centres[link.b])
    return numpy.asarray(from_a - from_b, numpy.float64)


def _system(links: Sequence[Link], found: Mapping[int, float], sizes: Mapping[int, tuple[int, int]]) -> _System:
    centres = {sheet: (sizes[sheet][0] / 2.0, sizes[sheet][1] / 2.0) for sheet in found}
    steps = numpy.asarray([_step(link, found, centres) for link in links], numpy.float64).reshape(-1, 2)
    return _System({sheet: at for at, sheet in enumerate(sorted(found))}, tuple(links), steps)


def _solve(system: _System, weights: FloatArray) -> FloatArray:
    """The weighted least-squares centres, the first sheet held at the origin."""
    count, rows = len(system.index), len(system.links)
    design = numpy.zeros((rows + 1, count))
    for row, link in enumerate(system.links):
        design[row, system.index[link.b]], design[row, system.index[link.a]] = 1.0, -1.0
    design[-1, 0] = 1.0
    target = numpy.vstack((system.steps, numpy.zeros((1, 2))))
    scale = numpy.sqrt(numpy.append(weights, 1.0))[:, None]
    solution, *_ = numpy.linalg.lstsq(design * scale, target * scale, rcond=None)
    return numpy.asarray(solution, numpy.float64)


def _residuals(system: _System, solution: FloatArray) -> FloatArray:
    ends = numpy.array([(system.index[link.a], system.index[link.b]) for link in system.links], numpy.int64).reshape(-1, 2)
    moved = solution[ends[:, 1]] - solution[ends[:, 0]] - system.steps
    return numpy.asarray(numpy.hypot(moved[:, 0], moved[:, 1]), numpy.float64)


def _irls(system: _System) -> FloatArray:
    base = numpy.array([float(link.inliers) for link in system.links], numpy.float64)
    solution = _solve(system, base)
    for _ in range(ITERATIONS):
        residuals = _residuals(system, solution)
        solution = _solve(system, base * numpy.minimum(1.0, HUBER_PX / numpy.maximum(residuals, MIN_SPREAD)))
    return solution


def placed(links: Sequence[Link], found: Mapping[int, float], sizes: Mapping[int, tuple[int, int]]) -> Placed:
    """The sheets' centres from the links that agree on the turns (`found`); `sizes` each sheet's (width, height)."""
    system = _system(links, found, sizes)
    solution = _irls(system)
    residuals = _residuals(system, solution)
    good = residuals <= OUTLIER_PX
    kept = tuple(itertools.compress(system.links, good))
    dropped = tuple(itertools.compress(system.links, ~good))
    where = {sheet: _point(solution[at]) for sheet, at in system.index.items()}
    return Placed(where, dict(found), kept, tuple(float(value) for value in residuals[good]), dropped)
