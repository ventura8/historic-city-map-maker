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
