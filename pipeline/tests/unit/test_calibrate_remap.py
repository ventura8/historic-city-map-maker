"""`warp_film` / `_remap_bounded`: a full Corona film crop can exceed OpenCV remap's max side (32_766 px)."""

import numpy
from hcm_pipeline.calibrate.dense import REMAP_MAX_PX, FilmWindow, _remap_bounded, warp_film
from hcm_pipeline.calibrate.poly import MatrixMap
from hcm_pipeline.geo import Grid


def test_happy_path_a_source_wider_than_remap_still_warps() -> None:
    """Scenarios: S-P06-HAPPY-REMAP-BOUNDED"""
    # Owner corner points on a full-width scan: film crop wider than OpenCV remap accepts.
    width = REMAP_MAX_PX + 8_000
    source = numpy.full((64, width), 40.0, dtype=numpy.float32)
    map_x = numpy.linspace(0, width - 1, 32, dtype=numpy.float32).reshape(1, 32).repeat(32, axis=0)
    map_y = numpy.linspace(0, 63, 32, dtype=numpy.float32).reshape(32, 1).repeat(32, axis=1)

    image = _remap_bounded(source, map_x, map_y)

    assert image.shape == (32, 32)
    assert float(image.mean()) > 0


def test_happy_path_warp_film_accepts_a_wide_read() -> None:
    """warp_film on a full-width read: no OpenCV assert, grid-sized output, maps still in read cells."""
    width = REMAP_MAX_PX + 4_000
    pixels = numpy.full((80, width), 50, dtype=numpy.uint8)
    film = FilmWindow(pixels, left=0, top=0, factor=1, limits=(width, 80, 0))
    # Film pixel (x,y) -> mercator (x, -y): a unit grid covers the left of the strip.
    mapping = MatrixMap(numpy.array([[1.0, 0.0, 0.0], [0.0, -1.0, 0.0], [0.0, 0.0, 1.0]]))
    grid = Grid(0.0, 0.0, 10.0, 64, 64)

    warped = warp_film(film, mapping, grid)

    assert warped.filtered.shape == (64, 64)
    assert warped.map_x.shape == (64, 64)
    assert float(warped.valid.sum()) > 0


def test_bad_path_a_narrow_source_is_unchanged_by_the_bound() -> None:
    """Scenarios: S-P06-BAD-REMAP-NARROW"""
    # Under the remap limit the helper remaps without shrinking (mean stays near the fill).
    source = numpy.full((32, 48), 55.0, dtype=numpy.float32)
    map_x = numpy.linspace(0, 47, 16, dtype=numpy.float32).reshape(1, 16).repeat(16, axis=0)
    map_y = numpy.linspace(0, 31, 16, dtype=numpy.float32).reshape(16, 1).repeat(16, axis=1)

    image = _remap_bounded(source, map_x, map_y)

    assert image.shape == (16, 16)
    assert abs(float(image.mean()) - 55.0) < 1.0
