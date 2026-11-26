"""Rough points on a whole strip shrunk land on the same film at full resolution, whichever way it was scanned (DECISIONS §209).

Live 2026-11-13: the 1968 Corona frame DS1103-1058DF026, stitched right to left, offered whole shrunk 8 times; its crop around the
owner's rough points showed farmland. The whole scan and the crop read the same `frame.json` window by window, so a point at 73 %
along the shrunk strip is at 73 % of the film: never at its mirror (27 %), whatever order the segments lie in.
"""

from pathlib import Path
from typing import cast

import numpy
import pytest
from hcm_pipeline.frames import FrameLayout, Placement
from hcm_pipeline.georef.corners import Crop
from hcm_pipeline.jobs import JobContext
from hcm_pipeline.rasters import GeoTiff, read_band, write_geotiff
from hcm_pipeline.steps.locate import SegmentReader, write_crop
from hcm_pipeline.steps.whole import WholeFrame, rough_box

from tests.unit.test_frames import Staging

WIDTH, HEIGHT, SEGMENTS, OVERLAP, FACTOR = 2400, 160, 3, 80, 8
CITY_AT, DECOY_AT, SIDE = 0.73, 0.27, 64


def strip() -> numpy.ndarray:
    """Dim farmland noise, a bright square city at 73 % along and a mid-grey decoy at its mirror place."""
    film = numpy.random.default_rng(5).integers(20, 60, (HEIGHT, WIDTH)).astype(numpy.uint8)
    for share, level in ((CITY_AT, 250), (DECOY_AT, 140)):
        left = round(share * WIDTH) - SIDE // 2
        film[48 : 48 + SIDE, left : left + SIDE] = level
    return film


def delivered(tmp_path: Path, film: numpy.ndarray, right_to_left: bool) -> tuple[FrameLayout, Staging]:
    """The film cut into overlapping segments, lettered in the order the scanner read them."""
    step = (WIDTH + (SEGMENTS - 1) * OVERLAP) // SEGMENTS - OVERLAP
    spans = [(index * step, min(WIDTH, index * step + step + OVERLAP)) for index in range(SEGMENTS)]
    spans[-1] = (spans[-1][0], WIDTH)
    ordered = spans[::-1] if right_to_left else spans
    files, placements = {}, []
    for index, (start, end) in enumerate(ordered):
        name = f"{chr(ord('a') + index)}.tif"
        files[name] = write_geotiff(tmp_path / name, GeoTiff([film[:, start:end]]))
        placements.append(Placement(name, start, 0, end - start, HEIGHT))
    return FrameLayout(WIDTH, HEIGHT, FACTOR, tuple(placements)), Staging(files)


def brightest(shrunk: numpy.ndarray) -> tuple[float, float]:
    """The middle of the brightest place on the shrunk scan: where a person would put a point on the city."""
    row, column = numpy.unravel_index(int(numpy.argmax(shrunk)), shrunk.shape)
    return float(column), float(row)


@pytest.mark.parametrize("right_to_left", [True, False])
def test_happy_path_a_point_on_the_shrunk_strip_crops_the_city_at_full_resolution(tmp_path: Path, right_to_left: bool) -> None:
    """Scenarios: S-P01-HAPPY-RECROP-RIGHT-TO-LEFT"""
    film = strip()
    layout, staging = delivered(tmp_path, film, right_to_left)
    ctx = cast(JobContext, staging)
    shrunk = SegmentReader(ctx, layout).read((0, 0, WIDTH, HEIGHT), FACTOR)
    whole = WholeFrame(FACTOR, 0, 0)

    x, y = brightest(shrunk)
    points = numpy.array([whole.to_film(x, y), whole.to_film(x + 2, y + 2)], numpy.float64)
    left, top, right, bottom = rough_box(points, points, SIDE, (WIDTH, HEIGHT, 0))
    crop = read_band(write_crop(ctx, layout, Crop(left, top, right - left, bottom - top, ()), tmp_path / "crop.tif"))

    assert left <= CITY_AT * WIDTH <= right
    assert int(crop.max()) == 250
    assert numpy.array_equal(crop, film[top:bottom, left:right])


@pytest.mark.parametrize("right_to_left", [True, False])
def test_bad_path_the_mirror_place_of_the_city_is_never_cropped(tmp_path: Path, right_to_left: bool) -> None:
    """Scenarios: S-P01-BAD-RECROP-MIRRORED"""
    film = strip()
    layout, staging = delivered(tmp_path, film, right_to_left)
    ctx = cast(JobContext, staging)
    shrunk = SegmentReader(ctx, layout).read((0, 0, WIDTH, HEIGHT), FACTOR)

    x, _ = WholeFrame(FACTOR, 0, 0).to_film(*brightest(shrunk))
    crop = read_band(write_crop(ctx, layout, Crop(round(x) - SIDE, 0, 2 * SIDE, HEIGHT, ()), tmp_path / "crop.tif"))

    assert abs(x / WIDTH - CITY_AT) < 0.02
    assert not numpy.any(crop == 140)
