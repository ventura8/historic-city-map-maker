"""Overlapping parts joined by their features at a higher resolution (docs/research/M22-help-calibrate.md §4.1).

The dry run on `harti.zip` (M20 §15.1) joined 1 of 60 pieces on SIFT at 1,200 px and 2 of 94 atlas pages by their edges. Here every
part is read at `JOIN_PX` (twice as fine), its SIFT features matched to every other part's with FLANN and Lowe's ratio, and each pair
fitted by a similarity (two scans of one sheet differ by a shift and a turn at about one scale: four degrees of freedom need far fewer
agreeing matches than an affine's six) under RANSAC. A pair joins when at least `MIN_MATCHES` agree, spread over `MIN_SPREAD` of the
part both ways (a cluster on one ornament is a chance agreement), at a scale within `SCALE_SLACK` of one. The parts are then chained
along the strongest joins (`assemble`'s maximum spanning tree) and the canvas drawn at `CANVAS_PX` a part, with hard seams.

The quality is reported with the stitched picture: the joins used, their agreeing matches on average, and the inliers' residual in
canvas pixels.
"""

import itertools
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import cv2
import numpy
from numpy.typing import NDArray

from hcm_pipeline.placing import assemble
from hcm_pipeline.placing.geometry import FloatArray, compose, scale_of
from hcm_pipeline.placing.raster_io import Working, read_working
from hcm_pipeline.placing.stitched import JoinQuality
from hcm_pipeline.placing.streets import UInt8Array, grey_of

JOIN_PX: Final = 2400
CANVAS_PX: Final = assemble.MATCH_PX
FEATURES: Final = 8000
RATIO: Final = 0.8
MIN_MATCHES: Final = 12
MIN_SPREAD: Final = 0.05
SCALE_SLACK: Final = 0.1
RANSAC_PX: Final = 4.0
FLANN_TREES: Final = 5
FLANN_CHECKS: Final = 50
KNN: Final = 2


@dataclass(frozen=True)
class Features:
    """A part's SIFT keypoints (as points) and descriptors at `JOIN_PX`, and its size there."""

    points: FloatArray
    descriptors: NDArray[numpy.float32]
    size: tuple[int, int]


@dataclass(frozen=True)
class Join:
    """A join: the agreeing matches, the similarity taking `second`'s pixels to `first`'s, and the inliers' residual (pixels)."""

    first: int
    second: int
    inliers: int
    matrix: FloatArray
    rms_px: float


def features_of(image: UInt8Array) -> Features:
    keypoints, descriptors = cv2.SIFT.create(nfeatures=FEATURES).detectAndCompute(grey_of(image), None)
    points = numpy.array([keypoint.pt for keypoint in keypoints], numpy.float64).reshape(-1, 2)
    found = numpy.zeros((0, 128), numpy.float32) if descriptors is None else numpy.asarray(descriptors, numpy.float32)
    return Features(points, found, (image.shape[1], image.shape[0]))


def _comparable(first: Features, second: Features) -> bool:
    """Both parts have enough features to be matched."""
    return min(len(first.points), len(second.points)) >= MIN_MATCHES


def _passes(pair: Sequence[cv2.DMatch]) -> bool:
    return len(pair) == KNN and pair[0].distance < RATIO * pair[1].distance


def _matched(first: Features, second: Features) -> tuple[FloatArray, FloatArray]:
    """Second's points and the first's they match (Lowe's ratio over FLANN's two nearest)."""
    if not _comparable(first, second):
        return numpy.zeros((0, 2)), numpy.zeros((0, 2))
    flann = cv2.FlannBasedMatcher({"algorithm": 1, "trees": FLANN_TREES}, {"checks": FLANN_CHECKS})
    good = [pair[0] for pair in flann.knnMatch(second.descriptors, first.descriptors, k=KNN) if _passes(pair)]
    queries, trains = _indices(good)
    return second.points[queries].reshape(-1, 2), first.points[trains].reshape(-1, 2)


def _indices(good: Sequence[cv2.DMatch]) -> tuple[list[int], list[int]]:
    """Each match's point in the second part and in the first."""
    return [match.queryIdx for match in good], [match.trainIdx for match in good]


def _spread(points: FloatArray, size: tuple[int, int]) -> bool:
    span = points.max(axis=0) - points.min(axis=0)
    return bool(span[0] >= MIN_SPREAD * size[0] and span[1] >= MIN_SPREAD * size[1])


def _holds(matrix: FloatArray, inliers: numpy.ndarray, source: FloatArray, size: tuple[int, int]) -> bool:
    """Enough agreeing matches, spread over the part, at about one scale."""
    return bool(inliers.sum() >= MIN_MATCHES and abs(scale_of(matrix) - 1.0) <= SCALE_SLACK and _spread(source[inliers], size))


def join_of(first: Features, second: Features, indices: tuple[int, int]) -> Join | None:
    """The similarity joining two parts, or None when too few spread matches agree on one at about one scale."""
    source, target = _matched(first, second)
    if len(source) < MIN_MATCHES:
        return None
    found, mask = cv2.estimateAffinePartial2D(source, target, method=cv2.RANSAC, ransacReprojThreshold=RANSAC_PX, maxIters=5000)
    matrix, inliers = numpy.asarray(found, numpy.float64), numpy.asarray(mask).ravel().astype(bool)
    if matrix.shape != (2, 3) or not _holds(matrix, inliers, source, second.size):
        return None
    moved = source[inliers] @ matrix[:, :2].T + matrix[:, 2]
    rms = float(numpy.sqrt(numpy.mean(numpy.sum((moved - target[inliers]) ** 2, axis=1))))
    return Join(indices[0], indices[1], int(inliers.sum()), matrix, rms)


def joins_of(found: Sequence[Features]) -> list[Join]:
    """Every pair of parts that joins."""
    tried = (join_of(found[i], found[j], (i, j)) for i, j in itertools.combinations(range(len(found)), 2))
    return [join for join in tried if join is not None]


def _scaled(matrix: FloatArray, inner: float, outer: float) -> FloatArray:
    """`matrix` (part pixels at one size to canvas pixels at another) read from part pixels `inner` times finer to canvas pixels
    `outer` times finer."""
    widen = numpy.array([[outer, 0.0, 0.0], [0.0, outer, 0.0]])
    return compose(widen, compose(matrix, numpy.array([[inner, 0.0, 0.0], [0.0, inner, 0.0]])))


@dataclass(frozen=True)
class Joined:
    """The parts at canvas size, their layout and what the joins used measured."""

    images: list[UInt8Array]
    layout: assemble.Layout
    quality: JoinQuality


def _used(placed: dict[int, FloatArray], joins: list[Join]) -> list[Join]:
    """The joins the tree took: one per placed part but the root, the strongest first."""
    inside = [join for join in joins if join.first in placed and join.second in placed]
    return sorted(inside, key=lambda join: -join.inliers)[: max(0, len(placed) - 1)]


def _quality(used: list[Join], ratio: float) -> JoinQuality:
    if not used:
        return JoinQuality(0, 0.0, 0.0)
    inliers = float(numpy.mean([join.inliers for join in used]))
    return JoinQuality(len(used), inliers, float(numpy.mean([join.rms_px for join in used])) * ratio)


def _on_canvas(fine: Sequence[Working], coarse: Sequence[Working], placed: dict[int, FloatArray]) -> tuple[dict[int, FloatArray], float]:
    """Each placed part's transform from its canvas-size pixels to the canvas, drawn in the root's (the first placed part's) pixels at
    canvas size (the parts of one sheet share its dpi), and canvas pixels per fine pixel."""
    root = next(iter(placed))
    ratio = fine[root].scale / coarse[root].scale
    return {index: _scaled(matrix, coarse[index].scale / fine[index].scale, ratio) for index, matrix in placed.items()}, ratio


def joined(paths: Sequence[Path]) -> Joined | None:
    """The parts chained on their joins and laid out for a canvas of `CANVAS_PX` parts; None when the chain would make a canvas
    larger than `assemble.CANVAS_MAX_PX` (the joins do not describe one sheet)."""
    fine, coarse = _read(paths, JOIN_PX), _read(paths, CANVAS_PX)
    joins = joins_of(list(map(features_of, _images(fine))))
    placed, left_out = assemble.tree(len(paths), _edges(joins))
    on_canvas, ratio = _on_canvas(fine, coarse, placed)
    low, size = assemble.bounds(on_canvas, _sizes(coarse))
    if max(size) > assemble.CANVAS_MAX_PX:
        return None
    shift = numpy.array([[1.0, 0.0, -low[0]], [0.0, 1.0, -low[1]]])
    layout = assemble.Layout({index: compose(shift, matrix) for index, matrix in on_canvas.items()}, size, left_out)
    return Joined(_images(coarse), layout, _quality(_used(placed, joins), ratio))


def _read(paths: Sequence[Path], longest: int) -> list[Working]:
    return [read_working(path, longest) for path in paths]


def _images(parts: Sequence[Working]) -> list[UInt8Array]:
    return [working.image for working in parts]


def _sizes(parts: Sequence[Working]) -> list[tuple[int, int]]:
    return [(working.image.shape[1], working.image.shape[0]) for working in parts]


def _edges(joins: Sequence[Join]) -> assemble.Edges:
    return assemble.Edges([(float(join.inliers), join.first, join.second, join.matrix) for join in joins])
