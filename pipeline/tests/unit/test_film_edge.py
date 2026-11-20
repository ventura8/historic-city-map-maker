"""The film's border left out of a frame camera's crop (`georef/film_edge.py`; admin sweep 2026-11-14, bug 3: 8 Oct 1977 L004 to L006
kept the KH-9 mapping camera's black border, numbers and marks in white, across the centre of Bucharest)."""

import numpy
from hcm_pipeline.georef.film_edge import exposed_area, trimmed

SIZE = (400, 600)


def _picture() -> numpy.ndarray:
    """A grey picture with dark fields inside it, as farmland and forest are."""
    rng = numpy.random.default_rng(7)
    pixels = rng.integers(90, 200, SIZE, dtype=numpy.uint8)
    pixels[250:330, 40:260] = 20
    return pixels


def test_a_black_band_with_white_marks_on_top_is_left_out() -> None:
    """Scenarios: S-P33-HAPPY"""
    pixels = _picture()
    pixels[0:3, :] = 255
    pixels[3:80, :] = 10
    pixels[20:60, 100:180] = 250
    pixels[25:55, 450:480] = 250

    left, top, right, bottom = exposed_area(pixels)

    assert (left, right, bottom) == (0, SIZE[1], SIZE[0])
    assert 80 <= top <= 86
    assert trimmed((0, 0, 1200, 800), (left, top, right, bottom), 2.0) == (0, top * 2, 1200, 800)


def test_a_picture_with_no_band_keeps_everything_even_a_dark_field() -> None:
    """Scenarios: S-P33-BAD-NO-BORDER"""
    pixels = _picture()
    pixels[30:120, :] = 15

    assert exposed_area(pixels) == (0, 0, SIZE[1], SIZE[0])


def test_a_box_wholly_on_the_border_is_kept_as_it_was() -> None:
    """Scenarios: S-P33-BAD-NO-BORDER"""
    assert trimmed((0, 0, 100, 50), (0, 60, 600, 400), 1.0) == (0, 0, 100, 50)
    assert trimmed((0, 0, 40, 200), (60, 0, 600, 400), 1.0) == (0, 0, 40, 200)


def test_a_band_with_a_wide_gap_stops_at_the_first_run() -> None:
    """Scenarios: S-P33-HAPPY"""
    pixels = _picture()
    pixels[0:40, :] = 10
    pixels[40:55, :] = 180
    pixels[55:100, :] = 10

    _left, top, _right, _bottom = exposed_area(pixels)

    assert 40 <= top <= 50


def test_a_short_gap_in_the_band_is_still_border() -> None:
    """A bright run shorter than GAP_SHARE is still the border (the soft edge), not the picture."""
    pixels = _picture()
    pixels[0:40, :] = 10
    pixels[40:45, :] = 180
    pixels[45:80, :] = 10

    _left, top, _right, _bottom = exposed_area(pixels)

    assert top >= 80


def test_a_band_that_fills_the_depth_cap_is_cut_there() -> None:
    """A solid black band past DEPTH_SHARE ends at the depth cap (the for-loop exits without a gap break)."""
    pixels = _picture()
    depth = round(SIZE[0] * 0.3)
    pixels[0:depth, :] = 10

    _left, top, _right, _bottom = exposed_area(pixels)

    assert top >= depth


def test_bands_on_every_side() -> None:
    """Scenarios: S-P33-HAPPY"""
    pixels = _picture()
    pixels[:, 0:40] = 5
    pixels[:, -30:] = 5
    pixels[-50:, :] = 5

    left, top, right, bottom = exposed_area(pixels)

    assert left >= 40
    assert right <= SIZE[1] - 30
    assert bottom <= SIZE[0] - 50
    assert top == 0


def test_a_dark_band_that_starts_too_far_in_is_not_the_border() -> None:
    """A dark strip deeper than START_SHARE of the side is farmland, not the film's edge."""
    pixels = _picture()
    start = max(2, round(SIZE[0] * 0.05))
    pixels[start : start + 40, :] = 8

    assert exposed_area(pixels) == (0, 0, SIZE[1], SIZE[0])


def test_trimmed_keeps_the_overlap_when_the_box_crosses_the_border() -> None:
    """A crop that straddles the exposed area is clipped to the overlap."""
    assert trimmed((0, 0, 400, 300), (50, 40, 500, 280), 1.0) == (50, 40, 400, 280)
