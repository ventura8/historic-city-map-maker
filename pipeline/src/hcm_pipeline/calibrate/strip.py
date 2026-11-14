"""A panoramic strip searched where the city lies along it, not as one frame (docs/research/M9-calibration.md §16).

A Corona frame (KH-4, KH-4A, KH-4B) is a strip about 17 by 230 km on the ground, 137 350 by 9288 pixels scanned. Its four corners give
no homography: a corner quad that is not a parallelogram makes one bend the strip's long axis as a perspective would, kilometres off and
tens of percent out of scale a hundred kilometres from its ends, and nothing of the 1966 frames F046 and F047 agreed (2026-11-09: `not
proved (no-votes)`, a crop of 137 350 by 9288 pixels). Along the strip a place on film is about linear in the footprint's long axis, and
across it the film holds the whole width. So each orientation puts the city's window at a share of the strip's length; the film's
columns from `STRIP_MARGIN_GROUND_M` before it to as far after are the window searched, with a local map that runs linearly along the
footprint's long edges (the strip stored reversed is another orientation, so both places are searched). Windows that overlap are one.
The existing chain (votes, proof, local AI) runs inside each in turn: the first proved ends it, else the best-voted is kept.

A footprint that puts the city on no part of the strip under any orientation slides `SLIDE_GROUND_M` windows, half overlapping, along
the whole strip, each assumed to hold the city: votes and proofs only, the local AI asked of none (it would run once a window).
"""

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from typing import Final

import numpy

from hcm_pipeline.calibrate.chain import Found, FrameSearch
from hcm_pipeline.calibrate.ports import NullProposalMatcher
from hcm_pipeline.geo import FloatArray, MercatorBox
from hcm_pipeline.georef.corners import Assignment, CityNotFoundError, Frame, apply, frame_corners, homography

# A film this many times as long as it is high is a strip.
STRIP_MIN_ASPECT: Final = 4.0
# Ground metres of film searched on either side of the city along the strip: the footprints' error (F006 lay 14 km off).
STRIP_MARGIN_GROUND_M: Final = 15_000.0
# A sliding window's ground length along the strip; each starts half of it after the last.
SLIDE_GROUND_M: Final = 40_000.0
PERCENT: Final = 100.0

Reach = Callable[[Frame, Sequence[Assignment]], Sequence[tuple[Assignment, float]]]


@dataclass(frozen=True)
class StripWindow:
    """The film's columns from `start` up to `end`, the orientations' local maps there, and whether it was slid."""

    start: int
    end: int
    orientations: tuple[Assignment, ...]
    slid: bool = False

    def line(self, width: int) -> str:
        """The window as the log says it."""
        source = "slid along the strip, votes and proofs only" if self.slid else "from the footprint"
        share = f"{self.start / width * PERCENT:.0f} to {self.end / width * PERCENT:.0f} % along"
        return f"film columns {self.start} to {self.end} of {width} ({share}), {source}, {len(self.orientations)} orientations"


@dataclass(frozen=True)
class Windowed:
    """A search of the chain and the strip window it holds (None: the whole frame)."""

    search: FrameSearch
    window: StripWindow | None = None


def is_strip(frame: Frame) -> bool:
    return frame.width >= STRIP_MIN_ASPECT * frame.height


def _ground_corners(each: Assignment, width: int, height: int) -> FloatArray:
    """The ground (EPSG:3857) of the frame's corners under `each`: top-left, top-right, bottom-right, bottom-left."""
    corners = frame_corners(width, height)
    return numpy.column_stack(apply(each.matrix, corners[:, 0], corners[:, 1]))


def local_map(each: Assignment, columns: tuple[int, int], width: int, height: int) -> Assignment:
    """`each` over the film's `columns` only, linear along the footprint's long edges between its corners."""
    top_left, top_right, bottom_right, bottom_left = _ground_corners(each, width, height)
    first, last = columns[0] / width, columns[1] / width
    target = numpy.array(
        [
            top_left + (top_right - top_left) * first,
            top_left + (top_right - top_left) * last,
            bottom_left + (bottom_right - bottom_left) * last,
            bottom_left + (bottom_right - bottom_left) * first,
        ]
    )
    source = numpy.array([[columns[0], 0.0], [columns[1], 0.0], [columns[1], height], [columns[0], height]], numpy.float64)
    return Assignment(each.rotation, each.mirrored, homography(source, target))


def _axis(each: Assignment, width: int, height: int) -> tuple[FloatArray, FloatArray]:
    """The strip's centre line on the ground: its first column's middle, and the way to its last's."""
    top_left, top_right, bottom_right, bottom_left = _ground_corners(each, width, height)
    start = (top_left + bottom_left) / 2
    return start, (top_right + bottom_right) / 2 - start


def city_columns(each: Assignment, size: tuple[int, int], window: MercatorBox, margin: float) -> tuple[int, int] | None:
    """The film's columns that hold `window` with `margin` (EPSG:3857 metres) before and after along the strip; None: none do."""
    start, along = _axis(each, *size)
    length = float(numpy.hypot(*along))
    if length == 0:
        return None
    places = numpy.array(
        [[window.left, window.bottom], [window.right, window.bottom], [window.right, window.top], [window.left, window.top]]
    )
    shares = (places - start) @ along / length**2
    first, last = max(float(shares.min()) - margin / length, 0.0), min(float(shares.max()) + margin / length, 1.0)
    if last <= first:
        return None
    return math.floor(first * size[0]), math.ceil(last * size[0])


def _merged(spans: Sequence[tuple[int, int]]) -> list[tuple[int, int]]:
    """Overlapping column spans as one each."""
    merged: list[tuple[int, int]] = []
    for first, last in sorted(spans):
        if merged and first <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], last))
        else:
            merged.append((first, last))
    return merged


Placed = list[tuple[Assignment, tuple[int, int]]]


def _placed(firsts: Sequence[Assignment], size: tuple[int, int], window: MercatorBox, margin: float) -> Placed:
    """The orientations that put the city on the strip, and their columns."""
    spans = ((each, city_columns(each, size, window, margin)) for each in firsts)
    return [(each, span) for each, span in spans if span is not None]


def _inside(found: Placed, columns: tuple[int, int], size: tuple[int, int]) -> tuple[Assignment, ...]:
    """The local maps over `columns` of the orientations whose columns it holds."""
    return tuple(local_map(each, columns, *size) for each, span in found if columns[0] <= span[0] and span[1] <= columns[1])


def footprint_windows(firsts: Sequence[Assignment], size: tuple[int, int], window: MercatorBox, ground: float) -> list[StripWindow]:
    """Where the footprint puts the city along the strip under each orientation, overlapping places as one window."""
    found = _placed(firsts, size, window, STRIP_MARGIN_GROUND_M / ground)
    return [StripWindow(first, last, _inside(found, (first, last), size)) for first, last in _merged([span for _, span in found])]


def _centred(each: Assignment, columns: tuple[int, int], height: int, centre: tuple[float, float]) -> Assignment:
    """`each` moved so that the middle of the film's `columns` lies on `centre`."""
    x, y = apply(each.matrix, numpy.array([(columns[0] + columns[1]) / 2]), numpy.array([height / 2]))
    return each.moved(centre[0] - float(x[0]), centre[1] - float(y[0]))


def sliding_windows(firsts: Sequence[Assignment], size: tuple[int, int], window: MercatorBox, ground: float) -> list[StripWindow]:
    """Windows of `SLIDE_GROUND_M` along the whole strip, half overlapping, each orientation's local map moved onto the city."""
    if not firsts:
        return []
    width, height = size
    length = float(numpy.hypot(*_axis(firsts[0], width, height)[1]))
    side = min(width, max(1, round(SLIDE_GROUND_M / ground / max(length, 1e-9) * width)))
    starts = sorted({*range(0, width - side + 1, max(1, side // 2)), width - side})
    centre = ((window.left + window.right) / 2, (window.bottom + window.top) / 2)
    return [_slid(firsts, (start, start + side), size, centre) for start in starts]


def _slid(firsts: Sequence[Assignment], columns: tuple[int, int], size: tuple[int, int], centre: tuple[float, float]) -> StripWindow:
    """A sliding window: each orientation's local map over `columns`, moved onto the city's centre."""
    return StripWindow(*columns, tuple(_centred(local_map(each, columns, *size), columns, size[1], centre) for each in firsts), True)


def strip_windows(firsts: Sequence[Assignment], size: tuple[int, int], window: MercatorBox, ground: float) -> list[StripWindow]:
    """The footprint's windows, else the sliding ones."""
    return footprint_windows(firsts, size, window, ground) or sliding_windows(firsts, size, window, ground)


def _in_window(search: FrameSearch, window: StripWindow, reach: Reach) -> Windowed | None:
    """The search inside `window`: its film only, its orientations that reach the city; None: none does."""
    frame = replace(search.frame, exposure=(window.start, window.end))
    try:
        reached = tuple(each for each, _ in reach(frame, window.orientations))
    except CityNotFoundError:
        return None
    matcher = NullProposalMatcher() if window.slid else search.matcher
    limits = (window.end, search.limits[1], window.start)
    return Windowed(replace(search, frame=frame, orientations=reached, limits=limits, matcher=matcher), window)


def _whole(search: FrameSearch, reach: Reach) -> list[Windowed]:
    """The frame searched whole, on its orientations that reach the city."""
    return [Windowed(replace(search, orientations=tuple(each for each, _ in reach(search.frame, search.orientations))))]


def _windows(search: FrameSearch, reach: Reach) -> list[Windowed]:
    """The strip searched window by window; CityNotFoundError when no window reaches the city."""
    frame = search.frame
    windows = strip_windows(search.orientations, (frame.width, frame.height), search.window, search.ground)
    found = [each for each in (_in_window(search, window, reach) for window in windows) if each is not None]
    if not found:
        raise CityNotFoundError
    return found


def searches(search: FrameSearch, strip: bool, reach: Reach) -> list[Windowed]:
    """What the chain runs: a strip camera's long film window by window, any other frame whole, on its orientations that reach the city.
    CityNotFoundError when nothing reaches it."""
    return _windows(search, reach) if strip and is_strip(search.frame) else _whole(search, reach)


def best_of(windows: Sequence[Windowed], chain: Callable[[FrameSearch], Found], say: Callable[[str], None]) -> tuple[FrameSearch, Found]:
    """The chain in each window in turn: the first proved, else the window most votes agreed on (the first of equals)."""
    tried: list[tuple[Windowed, Found]] = []
    for each in windows:
        _say_window(each, "strip window", say)
        found = chain(each.search)
        tried.append((each, found))
        if found.proof is not None:
            break
    kept, found = tried[-1] if tried[-1][1].proof is not None else max(tried, key=lambda entry: entry[1].votes[0])
    _say_window(kept, "strip window kept", say)
    return kept.search, found


def _say_window(each: Windowed, what: str, say: Callable[[str], None]) -> None:
    if each.window is not None:
        say(f"{what}: {each.window.line(each.search.frame.width)}")
