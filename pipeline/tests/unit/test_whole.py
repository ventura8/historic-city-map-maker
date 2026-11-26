"""A frame nothing proved offered whole, and the crop around rough points (docs/research/M9-calibration.md §17)."""

from pathlib import Path

import numpy
import pytest
from hcm_pipeline.rasters import GeoTiff, write_geotiff
from hcm_pipeline.steps import whole
from hcm_pipeline.steps.whole import RoughPointsError, WholeFrame, mark, marked, offered_whole, rough_box, shrink

# The 1968 Corona frame DS1103-1058DF027: its exposure, and the two windows its footprint named.
STRIP = (131_443, 8172, 0)
FIRST_WINDOW = (54_814, 8172, 19_150)


def test_happy_path_a_strip_is_shrunk_to_the_budget_and_a_small_frame_is_not() -> None:
    """Scenarios: S-P06-HAPPY-WHOLE-STRIP"""
    assert shrink(STRIP) == 9
    assert shrink((16_384, 9000, 0)) == 1
    assert shrink((20_000, 9000, 4000)) == 1
    assert WholeFrame(9, 100, 0).to_film(10.5, 2.0) == (194.5, 18.0)


@pytest.mark.parametrize(
    ("searched", "limits", "timed_out", "offered"),
    [
        (FIRST_WINDOW, STRIP, False, True),
        (STRIP, STRIP, False, True),
        ((1500, 1100, 0), (1500, 1100, 0), True, True),
        ((900, 1100, 300), (1500, 1100, 0), False, True),
        ((1500, 1100, 0), (1500, 1100, 0), False, False),
    ],
)
def test_bad_path_an_unproved_frame_is_cut_by_a_guess_only_when_searched_whole_in_time_and_small(
    searched: whole.Limits, limits: whole.Limits, timed_out: bool, offered: bool
) -> None:
    """Scenarios: S-P06-BAD-WHOLE-STRIP-UNPROVED"""
    assert offered_whole(searched, limits, timed_out) is offered


def test_happy_path_a_shrunk_scan_says_how_it_lies_on_the_film(tmp_path: Path) -> None:
    """Scenarios: S-P06-HAPPY-WHOLE-STRIP"""
    pixels = numpy.zeros((8, 16), numpy.uint8)
    shrunk = mark(write_geotiff(tmp_path / "shrunk.tif", GeoTiff([pixels])), WholeFrame(9, 120, 0))
    plain = mark(write_geotiff(tmp_path / "plain.tif", GeoTiff([pixels])), WholeFrame(1, 0, 0))

    assert marked(shrunk) == WholeFrame(9, 120, 0)
    assert marked(plain) is None


def test_happy_path_the_crop_holds_the_rough_points_and_the_margin_around_them() -> None:
    """Scenarios: S-P06-HAPPY-ROUGH-POINTS-CROP"""
    # Half a film pixel a ground metre; four points 4 km apart along the strip, 2 km across it.
    film = numpy.array([[60_000.0, 3000.0], [62_000.0, 3000.0], [62_000.0, 4000.0], [60_000.0, 4000.0]])
    places = film * 2.0 + numpy.array([2_900_000.0, 5_500_000.0])

    left, top, right, bottom = rough_box(film, places, 30_000.0, STRIP)

    assert (left, right) == (45_000, 77_000)
    assert (top, bottom) == (0, 8172)
    assert all(left <= x <= right and top <= y <= bottom for x, y in film.tolist())


def test_bad_path_points_at_the_strips_end_stay_on_the_film_and_points_on_one_place_give_no_scale() -> None:
    """Scenarios: S-P06-BAD-ROUGH-POINTS-OUTSIDE"""
    film = numpy.array([[131_000.0, 100.0], [130_000.0, 100.0], [130_000.0, 900.0]])
    places = film * 2.0

    assert rough_box(film, places, 10_000.0, STRIP) == (125_000, 0, 131_443, 5900)
    with pytest.raises(RoughPointsError):
        rough_box(numpy.array([[5.0, 5.0], [5.0, 5.0], [5.0, 5.0]]), places, 10_000.0, STRIP)
    with pytest.raises(RoughPointsError):
        rough_box(film, numpy.zeros((3, 2)), 10_000.0, STRIP)
