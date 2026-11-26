"""A drawn map's street network, the classical path (docs/research/M20-import-local.md §3 c step 2): always on, CPU only.

Streets are the paper between the drawn blocks: on a line plan the corridors between parallel lines, on a coloured map the paper between
coloured blocks. Paper is what is lighter than Otsu's threshold (and, in colour, unsaturated). The street network is the paper that hangs
together across the map: a building's interior or a hatched block is paper too, but enclosed, so only the large connected parts are kept,
and open ground wider than a street is left out. Their skeleton is the network's centre lines, its pruned branches dropped, and a junction
is a skeleton pixel with three or more neighbours (each cluster one junction). OpenStreetMap's drawn lines go through the same skeleton,
so both sides of a match are made alike.
"""

from dataclasses import dataclass
from typing import Final

import cv2
import numpy
from numpy.typing import NDArray

from hcm_pipeline.placing.geometry import FloatArray

UInt8Array = NDArray[numpy.uint8]
BoolArray = NDArray[numpy.bool_]
# A part of the paper is the network when it spans this share of the image's long side.
NETWORK_SPAN: Final = 0.25
# A street is at most this share of the image's long side wide (open ground wider is left out).
MAX_STREET_SHARE: Final = 0.02
MIN_STREET_PX: Final = 3
SATURATED: Final = 60
THINNING_ROUNDS: Final = 200
# Zhang and Suen remove a border pixel with two to six set neighbours.
MIN_KEPT: Final = 2
MAX_KEPT: Final = 6
PRUNE_ROUNDS: Final = 6
JUNCTION_NEIGHBOURS: Final = 3
# The streets' half width is the skeleton's distance to ink at this percentile; the skeleton further than NARROW_WIDTHS of it is no street.
NARROW_PERCENTILE: Final = 30.0
NARROW_WIDTHS: Final = 2.5
# A spur shorter than this many street half widths is worn away; junction pixels this many half widths apart are one junction.
SPUR_WIDTHS: Final = 3.0
MERGE_WIDTHS: Final = 1.5
_RGB: Final = 3


def grey_of(image: NDArray[numpy.uint8]) -> UInt8Array:
    """One band: the image itself, or its luminance."""
    if image.ndim == _RGB:
        return numpy.asarray(cv2.cvtColor(image[:, :, :_RGB], cv2.COLOR_RGB2GRAY), numpy.uint8)
    return numpy.asarray(image, numpy.uint8)


def paper_of(image: NDArray[numpy.uint8]) -> BoolArray:
    """Paper: lighter than Otsu's threshold and, in a coloured image, unsaturated."""
    grey = grey_of(image)
    threshold, _ = cv2.threshold(grey, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    light = grey > threshold
    if image.ndim != _RGB:
        return numpy.asarray(light, numpy.bool_)
    saturation = cv2.cvtColor(image[:, :, :_RGB], cv2.COLOR_RGB2HSV)[:, :, 1]
    return numpy.asarray(light & (saturation < SATURATED), numpy.bool_)


def network_of(paper: BoolArray) -> BoolArray:
    """The connected parts of the paper that span the map, its open ground wider than a street left out."""
    count, labels, stats, _ = cv2.connectedComponentsWithStats(paper.astype(numpy.uint8), connectivity=4)
    span = NETWORK_SPAN * max(paper.shape)
    wide = (stats[:, cv2.CC_STAT_WIDTH] >= span) | (stats[:, cv2.CC_STAT_HEIGHT] >= span)
    wide[0] = False
    kept = numpy.isin(labels, numpy.flatnonzero(wide[:count]))
    half_width = max(MIN_STREET_PX, round(MAX_STREET_SHARE * max(paper.shape)))
    distance = cv2.distanceTransform(kept.astype(numpy.uint8), cv2.DIST_L2, 3)
    return numpy.asarray(kept & (distance <= half_width), numpy.bool_)


def _neighbours(image: UInt8Array) -> list[UInt8Array]:
    """P2 to P9 of Zhang and Suen (north, then clockwise) for every pixel, the border padded with zero."""
    padded = numpy.pad(image, 1)
    height, width = image.shape
    offsets = ((0, 1), (0, 2), (1, 2), (2, 2), (2, 1), (2, 0), (1, 0), (0, 0))
    return [padded[row : row + height, col : col + width] for row, col in offsets]


def _turns(p: list[UInt8Array]) -> NDArray[numpy.int32]:
    """The crossing number: how many times the ring of eight neighbours goes from empty to set."""
    return numpy.asarray(sum(((p[index] == 0) & (p[(index + 1) % 8] == 1)).astype(numpy.int32) for index in range(8)), numpy.int32)


def _deletable(image: UInt8Array, first: bool) -> BoolArray:
    p = _neighbours(image)
    count = sum(numpy.asarray(value, numpy.int32) for value in p)
    turns = _turns(p)
    a, b = (p[0] * p[2] * p[4], p[2] * p[4] * p[6]) if first else (p[0] * p[2] * p[6], p[0] * p[4] * p[6])
    return numpy.asarray((image == 1) & (count >= MIN_KEPT) & (count <= MAX_KEPT) & (turns == 1) & (a == 0) & (b == 0), numpy.bool_)


def thin(mask: BoolArray) -> BoolArray:
    """The mask's one-pixel skeleton (Zhang and Suen)."""
    image = mask.astype(numpy.uint8)
    for _ in range(THINNING_ROUNDS):
        removed = 0
        for first in (True, False):
            gone = _deletable(image, first)
            image[gone] = 0
            removed += int(gone.sum())
        if removed == 0:
            break
    return numpy.asarray(image == 1, numpy.bool_)


def neighbour_count(skeleton: BoolArray) -> NDArray[numpy.int32]:
    return numpy.asarray(sum(numpy.asarray(value, numpy.int32) for value in _neighbours(skeleton.astype(numpy.uint8))), numpy.int32)


def prune(skeleton: BoolArray, rounds: int = PRUNE_ROUNDS) -> BoolArray:
    """The skeleton with its short spurs worn away: its end pixels removed `rounds` times."""
    kept = skeleton.copy()
    for _ in range(rounds):
        ends = kept & (neighbour_count(kept) <= 1)
        kept &= ~ends
    return kept


def junctions(skeleton: BoolArray, merge_px: int = 1) -> FloatArray:
    """Pixel centres (x, y) where three or more branches meet (a crossing number of three or more: a staircase's corner is no
    junction), one per cluster (junction pixels within `merge_px` are one)."""
    crossing = (skeleton & (_turns(_neighbours(skeleton.astype(numpy.uint8))) >= JUNCTION_NEIGHBOURS)).astype(numpy.uint8)
    size = 2 * max(1, merge_px) + 1
    count, _, _, centroids = cv2.connectedComponentsWithStats(cv2.dilate(crossing, numpy.ones((size, size), numpy.uint8)), connectivity=8)
    return numpy.asarray(centroids[1:count] + 0.5, numpy.float64).reshape(-1, 2)


@dataclass(frozen=True)
class Network:
    """A street network's centre lines and its streets' typical half width in pixels (how far apart one junction's pixels may lie)."""

    skeleton: BoolArray
    half_width: float

    def junctions(self) -> FloatArray:
        return junctions(self.skeleton, round(self.half_width * MERGE_WIDTHS))


def _narrow(skeleton: BoolArray, distance: NDArray[numpy.float32]) -> tuple[BoolArray, float]:
    """The skeleton where it runs down a street, and the streets' half width. On a line plan the blocks are paper too: their skeleton
    runs far from any ink, so only the skeleton within `NARROW_WIDTHS` of the narrow quarter's half width is a street."""
    if not skeleton.any():
        return skeleton, 1.0
    half_width = max(1.0, float(numpy.percentile(distance[skeleton], NARROW_PERCENTILE)))
    return numpy.asarray(skeleton & (distance <= NARROW_WIDTHS * half_width), numpy.bool_), half_width


def street_network(image: NDArray[numpy.uint8]) -> Network:
    """A drawn map's street centre lines: the skeleton of its network down its streets, its spurs (as long as a street is wide) pruned."""
    network = network_of(paper_of(image))
    distance = numpy.asarray(cv2.distanceTransform(network.astype(numpy.uint8), cv2.DIST_L2, 3), numpy.float32)
    skeleton, half_width = _narrow(thin(network), distance)
    return Network(prune(skeleton, max(PRUNE_ROUNDS, round(SPUR_WIDTHS * half_width))), half_width)


def street_skeleton(image: NDArray[numpy.uint8]) -> BoolArray:
    """A drawn map's street centre lines."""
    return street_network(image).skeleton


def line_skeleton(lines: UInt8Array) -> BoolArray:
    """Lines drawn on black (OpenStreetMap's) as one-pixel centre lines."""
    return prune(thin(numpy.asarray(lines > 0, numpy.bool_)))
