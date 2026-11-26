"""The film's edge on a frame camera's scan (admin sweep 2026-11-14, bug 3): the KH-9 mapping camera's delivery holds the film's border, a
black band with the frame's number and marks in white, and a proved crop that reached it kept it: on 8 Oct 1977 L004, L005 and L006 a
black stripe crossed the centre of Bucharest once warped. A frame camera's exposure is a rectangle of the scan, so the border is found
line by line from each side on the shrunk preview: a line mostly black (`DARK_SHARE` of its pixels under `DARK`) is border; the border
starts within `START_SHARE` of the side (a white scanner line before it is allowed) and ends where `GAP_SHARE` of the size in a row is
not border; nothing deeper than `DEPTH_SHARE` is cut. A side with no black band keeps everything, so a dark field inside the picture is
never taken for the border.
"""

from collections.abc import Sequence
from typing import Final

from hcm_pipeline.images import UInt8Array

DARK: Final = 40
DARK_SHARE: Final = 0.5
START_SHARE: Final = 0.03
GAP_SHARE: Final = 0.02
DEPTH_SHARE: Final = 0.3
# A margin past the last black line, as a share of the size: the band's soft edge on the scan.
MARGIN_SHARE: Final = 0.004

# left, top, right, bottom in the preview's pixels.
Area = tuple[int, int, int, int]


def _first_dark(dark: Sequence[float], start: int) -> int | None:
    """The first mostly black line within `start` lines of the side, or None."""
    return next((index for index in range(min(start, len(dark))) if dark[index] >= DARK_SHARE), None)


def _border_depth(dark: Sequence[float]) -> int:
    """How many lines from the side are border (0: none): the last mostly black line of a run that starts near the side."""
    size = len(dark)
    first = _first_dark(dark, max(1, round(size * START_SHARE)))
    if first is None:
        return 0
    gap, last = max(2, round(size * GAP_SHARE)), first
    for index in range(first, round(size * DEPTH_SHARE)):
        if dark[index] >= DARK_SHARE:
            last = index
        elif index - last >= gap:
            break
    return last + 1 + round(size * MARGIN_SHARE)


def exposed_area(preview: UInt8Array) -> Area:
    """The part of the preview inside the film's border (the whole preview when no side has a black band)."""
    black = preview < DARK
    rows, columns = black.mean(axis=1), black.mean(axis=0)
    height, width = preview.shape
    top, bottom = _border_depth(list(rows)), _border_depth(list(rows[::-1]))
    left, right = _border_depth(list(columns)), _border_depth(list(columns[::-1]))
    return (left, top, width - right, height - bottom)


def trimmed(box: tuple[int, int, int, int], area: Area, factor: float) -> tuple[int, int, int, int]:
    """`box` (left, top, right, bottom in the frame's pixels) kept inside `area` (the preview's, `factor` frame pixels a pixel)."""
    inside = (round(area[0] * factor), round(area[1] * factor), round(area[2] * factor), round(area[3] * factor))
    left, top = max(box[0], inside[0]), max(box[1], inside[1])
    right, bottom = min(box[2], inside[2]), min(box[3], inside[3])
    return box if right <= left or bottom <= top else (left, top, right, bottom)
