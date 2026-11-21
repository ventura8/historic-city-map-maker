"""`stitch`: where the segments lie in one frame, its film border cropped (docs/research/M3-interfaces.md §5.3).

USGS scans a long film frame in overlapping parts (`_a` to `_n`), in the film's order: left to right on a KH-9 or a Corona
frame, right to left on the 1966 KH-7 strip (lesson 645: its `_b` lies left of its `_a`, and a frame joined the other way
ended at the seam, half the city). Each pair's offset is found by matching the right segment's left strip inside the left
segment's right part (its last `MAX_OVERLAP_SHARE`, finding 76): first on images shrunk to about 2048 rows, then at full
resolution within a few pixels of that, so it is exact within 1 px. The first pair is matched both ways and the better way
holds for the whole frame; a pair that matches under `MIN_PAIR_SCORE` either way is no film's neighbours (a segment of
another frame) and fails the step. The film border (the
unexposed edge and its markings) is cut where the row and column intensity profiles of a shrunk mosaic leave the dark
level. Finding 57 of 2026-11-01: the frame is never joined in memory (a KH-9 panoramic frame was killed at 32 GiB):
the step reads windows and shrunk copies of two segments at a time and writes `frame.json` (each segment's place, and
the exposure's columns when a dark gap parts it from a fragment of the next one) and `frame-preview.tif` (the frame averaged down
to at most `PREVIEW_MAX_PX` on its long side), which `locate` reads.
"""

import math
from pathlib import Path
from typing import Final

import cv2
import numpy

from hcm_pipeline.contract import Errors
from hcm_pipeline.frames import FRAME_JSON, FRAME_PREVIEW, PREVIEW_MAX_PX, FrameLayout, Placement, Segment
from hcm_pipeline.images import UInt8Array, as_uint8
from hcm_pipeline.jobs import Done, JobContext, StepFailedError, StepResult
from hcm_pipeline.objects import ObjectInfo
from hcm_pipeline.rasters import GeoTiff, write_geotiff
from hcm_pipeline.steps.common import gdal_step

# Finding 83 of 2026-11-05: at 512 rows a KH-9 frame was shrunk 48 times, too blurred to tell its snow-covered valleys
# apart, and one pair of eight matched a wrong place; at 2048 every pair agrees with the widest strip that fits.
COARSE_ROWS: Final = 2048
# The strip of the right segment matched inside the left one: narrower than any overlap USGS leaves.
TEMPLATE_PX: Final = 160
MIN_TEMPLATE_PX: Final = 8
# The coarse search's reach, as a share of the segment's height, when less than `MAX_OVERLAP_SHARE` of its width: on a segment wider
# than about 3 times its height (a Corona's), 35 % would search further than any overlap USGS leaves. Lesson 674: a fixed 1200
# shrunk pixels (0.53 of the 1968 Corona's 11 374-row segments shrunk 5 times) stopped short of their 23 % overlaps, every pair
# matched a wrong place, and the frame repeated a third of itself.
SEARCH_HEIGHT_SHARE: Final = 1.0
# Finding 76 of 2026-11-03: the right segment starts in this last share of the left one. USGS leaves narrow overlaps (4 to
# 8 % on a KH-9 panoramic frame); searched across the whole segment, a snow-covered frame of repeating valleys matched a
# strip 46 % inside the left segment, and the frame was joined wrong.
MAX_OVERLAP_SHARE: Final = 0.35
REFINE_PX: Final = 6
# The right segment's strip starts this share of its width in from its edge: the scanner's edge band (the 1966 KH-7 strip's runs
# white for 240 px, lesson 645) is no image, and two such bands matched each other at 0.90, which joined the strip the wrong way.
# USGS overlaps are 4 % at the least, so the strip still lies inside one.
EDGE_SKIP_SHARE: Final = 0.01
# A strip whose pixels vary less than this (grey levels, standard deviation) is film border, not image: OpenCV scores such a strip
# 1.0 anywhere flat (the 1972 frame's border read as a perfect overlap the wrong way).
MIN_TEMPLATE_STD: Final = 3.0
# The strip's top and bottom left out, which is also how far up or down the right segment may lie: the scanner keeps the
# film straight (at most 0.5 % of the height on a KH-9 frame), and a jump of 11 % was a wrong match (finding 83).
MARGIN_SHARE: Final = 0.03
# A row or column belongs to the film border while its mean stays under this share of the frame's median.
BORDER_SHARE: Final = 0.35
# ... and never under this grey level (a frame that is dark everywhere holds no image).
MIN_CONTENT_LEVEL: Final = 10.0
MIN_FRAME_PX: Final = 16
# A dark column run at least this share of the frame's width may part the exposure from the next one: the 1972 KH-9 frame's holds
# 2 % of it (columns 459 808 to 469 632 of 494 445); nothing else on it runs for even 0.1 %. Calibrated on one frame.
MIN_GAP_SHARE: Final = 0.01
# ... when no more than this share of the width lies beyond it: a real gap leaves only a fragment of the next exposure (5 % on the
# 1972 frame, 24 813 columns), so a dark band with more film after it (a sea, a cloud's shadow) lies inside the exposure.
MAX_FRAGMENT_SHARE: Final = 0.1
# The coarse match's normalised correlation under which two segments are not neighbours on one film (lesson 645). On the eleven
# real multi-segment frames of 2026-11 every true pair scored 0.42 (the 1978 KH-9 mapping frame) to 0.98, the KH-7 strip's 0.52; a
# first pair the wrong way at most 0.27 (the KH-7 strip's), its edge bands skipped and the film border scored 0.
MIN_PAIR_SCORE: Final = 0.35


def _best(area: UInt8Array, template: UInt8Array) -> tuple[int, int, float]:
    """Where `template` fits best inside `area` (its top-left corner), and how well (normalised correlation, -1 to 1)."""
    _, score, _, (x, y) = cv2.minMaxLoc(cv2.matchTemplate(area, template, cv2.TM_CCOEFF_NORMED))
    return int(x), int(y), float(score)


def _shrunk_size(segment: Segment, factor: int) -> tuple[int, int]:
    """The segment's size shrunk `factor` times (rounded up: placed in a preview rounded down, it leaves no blank edge)."""
    return math.ceil(segment.width / factor), math.ceil(segment.height / factor)


def _shrunk(segment: Segment, factor: int) -> UInt8Array:
    """The segment shrunk `factor` times by averaging. Admin sweep 2026-11-14 (bug 4): picked pixels alias the film's grain, and
    the finer the camera the worse: the 1966 KH-7 Gambit delivery (1.2 m, segments shrunk about 10 times) matched its true
    neighbour at 0.34 and failed as "a delivery that mixes frames"; averaged, the grain is the scene again (`frames.averaged_window`
    reads a proof's windows so for the same reason)."""
    return segment.averaged(_shrunk_size(segment, factor))


def _factor(segment: Segment) -> int:
    return max(1, segment.height // COARSE_ROWS)


def pair_offset(left: Segment, right: Segment) -> tuple[int, int]:
    """Where `right`'s top-left pixel lies in `left`'s pixels (dx, dy), coarse to fine, from windows of the two."""
    factor = _factor(left)
    dx, dy, _score = coarse_match(_shrunk(left, factor), _shrunk(right, factor), factor)
    return _refine(left, right, (dx * factor, dy * factor), factor)


def coarse_match(left: UInt8Array, right: UInt8Array, factor: int) -> tuple[int, int, float]:
    """The right segment's place in the left one's shrunk pixels, and the match's score."""
    height = right.shape[0]
    margin = int(height * MARGIN_SHARE)
    skip = _skip(right.shape[1])
    template = right[margin : height - margin, skip : skip + max(MIN_TEMPLATE_PX, TEMPLATE_PX // factor)]
    reach = min(math.ceil(left.shape[0] * SEARCH_HEIGHT_SHARE), math.ceil(left.shape[1] * MAX_OVERLAP_SHARE))
    reach = max(template.shape[1], reach)
    start = max(0, left.shape[1] - reach)
    x, y, score = _best(left[:, start:], template)
    # `cv2.meanStdDev`, not `numpy.std`: no float copy of the strip (the bounded-memory test, S-P01-HAPPY-BOUNDED-MEMORY).
    flat = float(cv2.meanStdDev(template)[1][0][0]) < MIN_TEMPLATE_STD
    return start + x - skip, y - margin, 0.0 if flat else score


def _skip(width: int) -> int:
    """How far in from a segment's left edge its matched strip starts (`EDGE_SKIP_SHARE`), in that segment's pixels."""
    return int(width * EDGE_SKIP_SHARE)


def _neighbours(previous: Segment, segment: Segment, reversed_film: bool) -> tuple[int, int, float]:
    """Where `segment`'s top-left pixel lies in `previous`'s pixels (dx, dy) on a film read the given way, and the coarse score."""
    left, right = (segment, previous) if reversed_film else (previous, segment)
    factor = _factor(left)
    dx, dy, score = coarse_match(_shrunk(left, factor), _shrunk(right, factor), factor)
    if score < MIN_PAIR_SCORE:
        return 0, 0, score
    dx, dy = _refine(left, right, (dx * factor, dy * factor), factor)
    return (-dx, -dy, score) if reversed_film else (dx, dy, score)


def _refine(left: Segment, right: Segment, guess: tuple[int, int], factor: int) -> tuple[int, int]:
    """The offset at full resolution: the right segment's left strip within `REFINE_PX` shrunk pixels of the guess."""
    reach = REFINE_PX * factor
    margin = int(right.height * MARGIN_SHARE) + reach
    skip = min(_skip(right.width), max(0, right.width - TEMPLATE_PX))
    template = right.read(skip, margin, min(TEMPLATE_PX, right.width - skip), max(1, right.height - 2 * margin))
    x0, y0 = max(0, guess[0] + skip - reach), max(0, guess[1] + margin - reach)
    width = min(template.shape[1] + 2 * reach, left.width - x0)
    height = min(template.shape[0] + 2 * reach, left.height - y0)
    x, y, _score = _best(left.read(x0, y0, width, height), template)
    return x0 + x - skip, y0 + y - margin


def _span(profile: numpy.ndarray, level: float) -> tuple[int, int]:
    inside = numpy.flatnonzero(profile >= level)
    return (int(inside[0]), int(inside[-1]) + 1) if inside.size else (0, 0)


def _dark_level(frame: UInt8Array) -> float:
    return max(BORDER_SHARE * float(numpy.median(frame)), MIN_CONTENT_LEVEL)


def border_box(frame: UInt8Array) -> tuple[int, int, int, int]:
    """The frame inside its dark film border (rows and columns whose mean stays under the border level): x, y, w, h."""
    level = _dark_level(frame)
    top, bottom = _span(frame.mean(axis=1), level)
    left, right = _span(frame.mean(axis=0), level)
    if min(bottom - top, right - left) < MIN_FRAME_PX:
        raise StepFailedError(Errors.PROCESSING_FAILED, "the scan holds no image inside its film border")
    return left, top, right - left, bottom - top


def _dark_runs(frame: UInt8Array) -> list[tuple[int, int]]:
    """The long dark column runs of `frame` (first column, one past the last), left to right."""
    dark = (frame.mean(axis=0) < _dark_level(frame)).astype(numpy.int8)
    edges = numpy.flatnonzero(numpy.diff(numpy.concatenate(([0], dark, [0])))).tolist()
    runs = zip(edges[::2], edges[1::2], strict=True)
    return [(start, end) for start, end in runs if end - start >= max(1, MIN_GAP_SHARE * frame.shape[1])]


def _exposure_starts(runs: list[tuple[int, int]], width: int) -> list[int]:
    """Where the exposure may start: after a gap with only a fragment before it, in the frame's first half."""
    return [end for start, end in runs if start <= MAX_FRAGMENT_SHARE * width and end <= width / 2]


def _exposure_ends(runs: list[tuple[int, int]], width: int) -> list[int]:
    """Where the exposure may end: before a gap with only a fragment after it, in the frame's second half."""
    return [start for start, end in runs if width - end <= MAX_FRAGMENT_SHARE * width and start >= width / 2]


def exposure_span(frame: UInt8Array) -> tuple[int, int] | None:
    """The columns of `frame` (inside its border) that hold its exposure, whichever side of the film the next one's fragment
    lies on (an aft camera's frame, or a turned scan): between the innermost dark gaps with only such a fragment outside them.
    None: no such gap, the whole width is the exposure."""
    width = frame.shape[1]
    runs = _dark_runs(frame)
    starts, ends = _exposure_starts(runs, width), _exposure_ends(runs, width)
    return (max(starts, default=0), min(ends, default=width)) if starts or ends else None


FrameSize = tuple[int, int, int, int]


def _frame_size(origins: list[tuple[int, int]], segments: list[Segment]) -> FrameSize:
    """The joined frame's width and height, its left and its top (the leftmost and highest segment's x and y, either may be
    negative: a film read right to left places each segment left of the one before)."""
    left, top = min(x for x, _ in origins), min(y for _, y in origins)
    width = max(x - left + segment.width for (x, _), segment in zip(origins, segments, strict=True))
    height = max(y - top + segment.height for (_, y), segment in zip(origins, segments, strict=True))
    return width, height, left, top


def _preview(origins: list[tuple[int, int]], previews: list[UInt8Array], factor: int, size: FrameSize) -> UInt8Array:
    """The frame shrunk by `factor`: each segment's shrunk copy at its place (a later one covers the overlap)."""
    width, height, left, top = size
    frame = numpy.zeros((max(1, height // factor), max(1, width // factor)), numpy.uint8)
    for (x, y), shrunk in zip(origins, previews, strict=True):
        row, column = (y - top) // factor, (x - left) // factor
        rows, columns = min(shrunk.shape[0], frame.shape[0] - row), min(shrunk.shape[1], frame.shape[1] - column)
        frame[row : row + rows, column : column + columns] = shrunk[:rows, :columns]
    return frame


_FILM_WAYS: Final = {False: "left to right", True: "right to left"}


def _require_neighbours(path: str, score: float) -> None:
    """A segment that matches the one before it under `MIN_PAIR_SCORE` either way belongs to another frame: the step fails."""
    if score < MIN_PAIR_SCORE:
        name = path.rsplit("/", 1)[-1]
        raise StepFailedError(
            Errors.PROCESSING_FAILED,
            f"segment {name} does not continue the one before it (best match {score:.2f}, under {MIN_PAIR_SCORE}): "
            "the delivery mixes frames; delete it and import the scene again",
        )


class _Walk:
    """The segments read two at a time: each staged, measured, shrunk and paired with the one before, then let go."""

    def __init__(self, ctx: JobContext, paths: list[str]) -> None:
        self.ctx = ctx
        self.paths = paths
        self.factor = 1
        self.origins: list[tuple[int, int]] = []
        self.sizes: list[Segment] = []
        self.shrunk: list[UInt8Array] = []
        # None until the first pair says which way the film was scanned (True: right to left, as the KH-7 strip).
        self.reversed_film: bool | None = None

    def run(self) -> None:
        previous: Segment | None = None
        for path in self.paths:
            segment = Segment(self.ctx.stage(path))
            self._place(previous, segment)
            self._let_go(previous)
            previous = segment
            self.ctx.checkpoint()
        self._let_go(previous)

    def _place(self, previous: Segment | None, segment: Segment) -> None:
        if previous is None:
            # The preview's shrink: the frame's long side, about the segments side by side, to `PREVIEW_MAX_PX`.
            self.factor = max(1, math.ceil(max(len(self.paths) * segment.width, segment.height) / PREVIEW_MAX_PX))
            self.origins.append((0, 0))
        else:
            dx, dy = self._offset(previous, segment)
            self.origins.append((self.origins[-1][0] + dx, self.origins[-1][1] + dy))
        self.sizes.append(segment)
        self.shrunk.append(segment.averaged(_shrunk_size(segment, self.factor)))

    def _offset(self, previous: Segment, segment: Segment) -> tuple[int, int]:
        """The segment's place in the previous one's pixels: both ways for the first pair, the first pair's way after it."""
        ways = (False, True) if self.reversed_film is None else (self.reversed_film,)
        way, dx, dy, score = max(((way, *_neighbours(previous, segment, way)) for way in ways), key=lambda each: each[3])
        _require_neighbours(self.paths[len(self.sizes)], score)
        if self.reversed_film is None:
            self.reversed_film = way
            self.ctx.log.info(f"the film was scanned {_FILM_WAYS[way]} (match {score:.2f})", StitchStep.name)
        return dx, dy

    def _let_go(self, segment: Segment | None) -> None:
        if segment is not None:
            segment.close()
            self.ctx.unstage(self.paths[self.sizes.index(segment)])


def _segment_paths(ctx: JobContext) -> list[str]:
    listed = ctx.services.objects.list(ctx.work_file("segments/a.tif").rsplit("/", 1)[0] + "/")
    paths = [info.path for info in sorted(listed, key=lambda info: info.path)]
    if not paths:
        raise StepFailedError(Errors.PROCESSING_FAILED, "the job has no extracted segment")
    return paths


def _layout(walk: _Walk) -> tuple[FrameLayout, UInt8Array]:
    factor = walk.factor
    size = _frame_size(walk.origins, walk.sizes)
    preview = _preview(walk.origins, walk.shrunk, factor, size)
    left, top, width, height = border_box(preview)
    x0, y0 = left * factor + size[2], top * factor + size[3]
    placements = tuple(
        Placement(path, x - x0, y - y0, segment.width, segment.height)
        for path, (x, y), segment in zip(walk.paths, walk.origins, walk.sizes, strict=True)
    )
    full = (_full_span(left, width, preview.shape[1], factor, size[0]), _full_span(top, height, preview.shape[0], factor, size[1]))
    kept = as_uint8(preview[top : top + height, left : left + width])
    start, end = exposure_span(kept) or (0, width)
    return FrameLayout(full[0], full[1], factor, placements, None if end == width else end * factor, start * factor), kept


def _full_span(start: int, span: int, preview_span: int, factor: int, full: int) -> int:
    """A preview span at full resolution: to the frame's own edge when it reaches the preview's."""
    return full - start * factor if start + span >= preview_span else span * factor


class StitchStep:
    name = "stitch"

    def run(self, ctx: JobContext) -> StepResult:
        walk = _Walk(ctx, _segment_paths(ctx))
        gdal_step(ctx, walk.run, "read the segments")
        layout, preview = _layout(walk)
        ctx.checkpoint()
        ctx.publish(write_geotiff(ctx.local(FRAME_PREVIEW), GeoTiff([preview])), ctx.work_file(FRAME_PREVIEW), "image/tiff")
        return Done(_publish_layout(ctx, layout))


def _publish_layout(ctx: JobContext, layout: FrameLayout) -> ObjectInfo:
    local: Path = ctx.local(FRAME_JSON)
    local.write_text(layout.to_json(), encoding="utf-8")
    return ctx.publish(local, ctx.work_file(FRAME_JSON), "application/json")
