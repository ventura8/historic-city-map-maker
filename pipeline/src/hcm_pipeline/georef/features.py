"""Feature matching of the `s2` channel (docs/research/M4-interfaces.md §2.1 step 3; M3-interfaces.md §5.6).

SIFT (`cv2.SIFT.create(nfeatures=4000)`, L2, Lowe's ratio 0.75) as in M3; **ORB** (`cv2.ORB.create(nfeatures=5000)`,
Hamming, ratio 0.8) when SIFT finds fewer than `MIN_SIFT_KEYPOINTS` on the pre-warped scan (a smooth or low-contrast
frame) or when this OpenCV build has no SIFT. Keypoints are found once per image; each cell of the 8 x 8 grid matches
its own keypoints against the reference's within the search window around it, and a pair's margin is `1 - d1/d2` of
its two nearest distances (0 to 1: how much better the best match is than the next).
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

import cv2
import numpy
from numpy.typing import NDArray

from hcm_pipeline.geo import FloatArray

BoolArray = NDArray[numpy.bool_]

CELLS: Final = 8
SIFT_FEATURES: Final = 4000
ORB_FEATURES: Final = 5000
MIN_SIFT_KEYPOINTS: Final = 200
SIFT_RATIO: Final = 0.75
ORB_RATIO: Final = 0.8
NEIGHBOURS: Final = 2
# OpenCV puts a keypoint at the pixel's centre as (0, 0); the grids here put the pixel's corner there.
CENTRE_OFFSET: Final = 0.5


@dataclass(frozen=True)
class Method:
    """A feature detector and how its descriptors are compared."""

    name: str
    norm: int
    ratio: float
    width: int

    def detector(self) -> cv2.Feature2D:
        if self.name == "orb":
            return cv2.ORB.create(nfeatures=ORB_FEATURES)
        return cv2.SIFT.create(nfeatures=SIFT_FEATURES)


SIFT: Final = Method("sift", cv2.NORM_L2, SIFT_RATIO, 128)
ORB: Final = Method("orb", cv2.NORM_HAMMING, ORB_RATIO, 32)


@dataclass(frozen=True)
class Features:
    """Keypoints (grid pixels, corner convention) and their descriptors."""

    points: FloatArray
    descriptors: NDArray[numpy.generic]

    def subset(self, index: NDArray[numpy.int64]) -> Features:
        return Features(self.points[index], self.descriptors[index])

    def __len__(self) -> int:
        return len(self.points)


@dataclass(frozen=True)
class FeatureMatch:
    """A pair of the `s2` channel: the scan's point, the reference's, and the ratio margin."""

    cell: int
    scan: tuple[float, float]
    reference: tuple[float, float]
    margin: float


def has_sift() -> bool:
    return hasattr(cv2, "SIFT")


def detect(method: Method, image: NDArray[numpy.uint8], mask: BoolArray | None) -> Features:
    """The keypoints of `image` (only where `mask` is set) and their descriptors."""
    found, descriptors = method.detector().detectAndCompute(image, None if mask is None else mask.astype(numpy.uint8))
    points = numpy.array([point.pt for point in found], numpy.float64).reshape(-1, 2) + CENTRE_OFFSET
    dtype = numpy.uint8 if method.norm == cv2.NORM_HAMMING else numpy.float32
    empty = numpy.zeros((0, method.width), dtype)
    return Features(points, numpy.asarray(empty if descriptors is None else descriptors, dtype))


def choose(image: NDArray[numpy.uint8], mask: BoolArray | None) -> Method:
    """SIFT, or ORB when SIFT is missing or finds fewer than `MIN_SIFT_KEYPOINTS` keypoints on `image`."""
    if not has_sift() or len(detect(SIFT, image, mask)) < MIN_SIFT_KEYPOINTS:
        return ORB
    return SIFT


def cell_of(points: FloatArray, width: int, height: int) -> NDArray[numpy.int64]:
    """The 8 x 8 grid cell of each point (row-major)."""
    cx = numpy.clip((points[:, 0] / width * CELLS).astype(numpy.int64), 0, CELLS - 1)
    cy = numpy.clip((points[:, 1] / height * CELLS).astype(numpy.int64), 0, CELLS - 1)
    return cy * CELLS + cx


def cell_box(cell: int, width: int, height: int) -> tuple[float, float, float, float]:
    """A cell's centre and half sizes, in grid pixels."""
    row, column = divmod(cell, CELLS)
    cell_w, cell_h = width / CELLS, height / CELLS
    return (column + 0.5) * cell_w, (row + 0.5) * cell_h, cell_w / 2, cell_h / 2


def _near(points: FloatArray, centre: tuple[float, float], reach: tuple[float, float]) -> BoolArray:
    return (numpy.abs(points[:, 0] - centre[0]) <= reach[0]) & (numpy.abs(points[:, 1] - centre[1]) <= reach[1])


@dataclass(frozen=True)
class _Window:
    method: Method
    search_px: float


def _passing(pair: Sequence[cv2.DMatch], scan: Features, reference: Features, window: _Window) -> tuple[int, int, float] | None:
    """The pair's best match when it passes the ratio test and lies within the search window."""
    best, second = pair[0], pair[1]
    shift = float(numpy.hypot(*(scan.points[best.queryIdx] - reference.points[best.trainIdx])))
    passes = best.distance < window.method.ratio * second.distance and shift <= window.search_px
    return (best.queryIdx, best.trainIdx, 1.0 - best.distance / max(second.distance, 1e-9)) if passes else None


def _ratio_matches(scan: Features, reference: Features, window: _Window) -> list[tuple[int, int, float]]:
    """(scan index, reference index, margin) of the matches that pass the ratio test within the search window."""
    if not _enough(scan, reference):
        return []
    pairs = cv2.BFMatcher(window.method.norm).knnMatch(_mat(scan.descriptors), _mat(reference.descriptors), k=NEIGHBOURS)
    return list(filter(None, (_passing(pair, scan, reference, window) for pair in pairs)))


def _enough(scan: Features, reference: Features) -> bool:
    """Something to match: a scan keypoint, and two reference keypoints for the ratio test."""
    return len(scan) > 0 and len(reference) >= NEIGHBOURS


def _mat(descriptors: NDArray[numpy.generic]) -> NDArray[numpy.uint8 | numpy.float32]:
    """Descriptors as OpenCV takes them: bytes for ORB, 32-bit floats for SIFT."""
    return numpy.asarray(descriptors, numpy.uint8 if descriptors.dtype == numpy.uint8 else numpy.float32)


@dataclass(frozen=True)
class CellMatcher:
    """Both images' features on one level, matched cell by cell."""

    method: Method
    scan: Features
    reference: Features
    size: tuple[int, int]
    search_px: float

    def matches(self, cell: int) -> list[FeatureMatch]:
        cx, cy, half_w, half_h = cell_box(cell, *self.size)
        mine = numpy.flatnonzero(cell_of(self.scan.points, *self.size) == cell)
        theirs = numpy.flatnonzero(_near(self.reference.points, (cx, cy), (half_w + self.search_px, half_h + self.search_px)))
        local_scan, local_reference = self.scan.subset(mine), self.reference.subset(theirs)
        found = _ratio_matches(local_scan, local_reference, _Window(self.method, self.search_px))
        return [
            FeatureMatch(cell, (float(local_scan.points[i][0]), float(local_scan.points[i][1])), _xy(local_reference.points[j]), margin)
            for i, j, margin in found
        ]


def _xy(point: FloatArray) -> tuple[float, float]:
    return float(point[0]), float(point[1])
