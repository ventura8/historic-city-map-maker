"""A panoramic strip searched where the city lies along it (docs/research/M9-calibration.md §16)."""

import itertools
from dataclasses import dataclass, replace
from functools import cache
from typing import Final

import cv2
import numpy
import pytest
from hcm_pipeline.calibrate.chain import Found, FrameSearch, find_frame
from hcm_pipeline.calibrate.ports import NullProposalMatcher
from hcm_pipeline.calibrate.strip import (
    STRIP_MARGIN_GROUND_M,
    Reach,
    StripWindow,
    Windowed,
    best_of,
    city_columns,
    searches,
    sliding_windows,
    strip_windows,
)
from hcm_pipeline.contract import SENSOR_SPECS, SearchRange
from hcm_pipeline.geo import FloatArray, Grid, MercatorBox, ground_scale, to_lnglat
from hcm_pipeline.georef.corners import Assignment, CityNotFoundError, Frame, first_guesses, reaching
from hcm_pipeline.images import UInt8Array, as_uint8

from tests.synthetic.scenes import render_world
from tests.unit.calibrate_scene import ArrayReader, nothing

# A strip 240 by 17.5 km on the ground at 17.5 m a pixel, wider at its east end (16 to 20 km): its corners make no parallelogram.
FILM: Final = (13_700, 1000)
LENGTH_GROUND_M: Final = 240_000.0
WIDTHS_GROUND_M: Final = (16_000.0, 20_000.0)
CITY_AT: Final = 0.6
ERROR_GROUND_M: Final = (1000.0, -3000.0)
WORLD_SIDE_PX: Final = 2048
SEARCH: Final = SearchRange(30_000.0, (1.0,))
LatLng = tuple[float, float]


@dataclass(frozen=True)
class Strip:
    """A long film over a world: the reference of its middle, its true corners (no homography holds them) and the metadata's."""

    reference: UInt8Array
    grid: Grid
    film: UInt8Array
    corners: FloatArray
    quad: tuple[LatLng, LatLng, LatLng, LatLng]

    @property
    def ground(self) -> float:
        return ground_scale(self.grid.box().bounds().middle_lat)


def _corners(centre: tuple[float, float], ground: float, city_at: float) -> FloatArray:
    """North-west, north-east, south-east, south-west in EPSG:3857: a strip running east, the city `city_at` of its length along."""
    length = LENGTH_GROUND_M / ground
    start = numpy.array(centre) - numpy.array([city_at * length, 0.0])
    end = start + numpy.array([length, 0.0])
    north = numpy.array([0.0, 1.0])
    first, last = (width / ground / 2 for width in WIDTHS_GROUND_M)
    return numpy.array([start + north * first, end + north * last, end - north * last, start - north * first])


def truth_of(corners: FloatArray, x: FloatArray, y: FloatArray) -> FloatArray:
    """The film's ground: linear along each long edge, and across."""
    u, v = (x / FILM[0])[:, None], (y / FILM[1])[:, None]
    top = corners[0] + (corners[1] - corners[0]) * u
    bottom = corners[3] + (corners[2] - corners[3]) * u
    return numpy.asarray(top + (bottom - top) * v, numpy.float64)


def _film(world_pixels: UInt8Array, grid: Grid, corners: FloatArray) -> UInt8Array:
    pixel = numpy.column_stack(grid.to_pixel(corners[:, 0], corners[:, 1]))
    u = (numpy.arange(FILM[0], dtype=numpy.float32) + 0.5) / FILM[0]
    v = ((numpy.arange(FILM[1], dtype=numpy.float32) + 0.5) / FILM[1])[:, None]
    maps = []
    for axis in (0, 1):
        top = pixel[0, axis] + (pixel[1, axis] - pixel[0, axis]) * u
        bottom = pixel[3, axis] + (pixel[2, axis] - pixel[3, axis]) * u
        maps.append(numpy.asarray(top + (bottom - top) * v - 0.5, numpy.float32))
    film = cv2.remap(world_pixels, maps[0], maps[1], cv2.INTER_LINEAR, borderValue=128)
    grain = numpy.random.default_rng(5).normal(0, 4, film.shape)
    return as_uint8(numpy.clip(film + grain, 0, 255))


def _quad(corners: FloatArray, ground: float) -> tuple[LatLng, LatLng, LatLng, LatLng]:
    off = numpy.array(ERROR_GROUND_M) / ground
    places = [to_lnglat(float(x), float(y)) for x, y in corners + off]
    return (places[0][1], places[0][0]), (places[1][1], places[1][0]), (places[2][1], places[2][0]), (places[3][1], places[3][0])


@cache
def strip_of(reversed_film: bool = False, city_at: float = CITY_AT) -> Strip:
    """The strip; `reversed_film`: its film stored east end first, the metadata's corners as they were."""
    world = render_world(7, WORLD_SIDE_PX)
    grid = world.grid
    box = grid.box()
    ground = ground_scale(box.bounds().middle_lat)
    corners = _corners(((box.left + box.right) / 2, (box.bottom + box.top) / 2), ground, city_at)
    film = _film(world.pixels, grid, corners)
    margin = round(WORLD_SIDE_PX * 0.2)
    window = Grid(
        grid.left + margin * grid.resolution,
        grid.top - margin * grid.resolution,
        grid.resolution,
        WORLD_SIDE_PX - 2 * margin,
        WORLD_SIDE_PX - 2 * margin,
    )
    reference = world.pixels[margin : WORLD_SIDE_PX - margin, margin : WORLD_SIDE_PX - margin]
    stored = numpy.ascontiguousarray(film[:, ::-1]) if reversed_film else film
    return Strip(reference, window, stored, corners, _quad(corners, ground))


def search_of(strip: Strip) -> FrameSearch:
    """The chain's input for the whole strip, as `locate` builds it before the windows."""
    frame = Frame(strip.film, 1.0, FILM[0], FILM[1])
    firsts = first_guesses(frame, strip.quad, strip.grid.box(), None)
    return FrameSearch(
        frame, tuple(firsts), strip.reference, strip.grid, ArrayReader(strip.film), (FILM[0], FILM[1], 0), SEARCH, None, "KH-4A", 7
    )


def reach_of(strip: Strip) -> Reach:
    return lambda frame, firsts: reaching(frame, firsts, strip.grid.scaled(6), SEARCH.margin_ground_m)


def windows_of(strip: Strip) -> list[Windowed]:
    return searches(search_of(strip), True, reach_of(strip))


def located(strip: Strip, lines: list[str]) -> tuple[FrameSearch, Found]:
    return best_of(windows_of(strip), lambda each: find_frame(each, nothing, lines.append), lines.append)


def worst_error_ground_m(strip: Strip, found: Found, search: FrameSearch, reversed_film: bool) -> float:
    """The proved map's worst ground error over the film the window holds inside the city's window."""
    assert found.proof is not None
    assert found.proof.mapping is not None
    start, end = search.limits[2], search.limits[0]
    u, v = numpy.meshgrid(numpy.linspace(start, end, 60), numpy.linspace(0, FILM[1], 9))
    film = numpy.column_stack((u.ravel(), v.ravel()))
    stored_x = FILM[0] - film[:, 0] if reversed_film else film[:, 0]
    truth = truth_of(strip.corners, stored_x, film[:, 1])
    box = strip.grid.box()
    inside = (truth[:, 0] > box.left) & (truth[:, 0] < box.right) & (truth[:, 1] > box.bottom) & (truth[:, 1] < box.top)
    mapped = found.proof.mapping.to_places(film[inside])
    return float(numpy.hypot(*(mapped - truth[inside]).T).max()) * strip.ground


def share_of(search: FrameSearch) -> tuple[float, float]:
    return search.limits[2] / FILM[0], search.limits[0] / FILM[0]


@pytest.mark.parametrize(("reversed_film", "city_on_film"), [(False, CITY_AT), (True, 1 - CITY_AT)])
def test_happy_path_a_strip_is_searched_and_proved_where_the_city_lies_along_it(reversed_film: bool, city_on_film: float) -> None:
    """Scenarios: S-P06-HAPPY-STRIP-WINDOW"""
    strip = strip_of(reversed_film)
    lines: list[str] = []

    search, found = located(strip, lines)

    assert found.proof is not None
    assert found.proof.accepted
    assert worst_error_ground_m(strip, found, search, reversed_film) < 25.0
    first, last = share_of(search)
    assert first < city_on_film < last
    assert last - first < 0.3
    assert search.frame.exposure == (search.limits[2], search.limits[0])
    assert sum(line.startswith("strip window: film columns") for line in lines) >= 1
    assert any(line.startswith("strip window kept:") and "from the footprint" in line for line in lines)


def test_happy_path_both_ends_of_the_strip_are_windows_when_the_film_may_be_stored_reversed() -> None:
    """Scenarios: S-P06-HAPPY-STRIP-WINDOW"""
    strip = strip_of()
    frame = Frame(strip.film, 1.0, FILM[0], FILM[1])
    firsts = first_guesses(frame, strip.quad, strip.grid.box(), None)

    windows = strip_windows(firsts, FILM, strip.grid.box(), strip.ground)

    middles = sorted((each.start + each.end) / 2 / FILM[0] for each in windows)
    assert len(windows) == 2
    assert middles[0] == pytest.approx(1 - CITY_AT, abs=0.03)
    assert middles[1] == pytest.approx(CITY_AT, abs=0.03)
    assert all(not each.slid and len(each.orientations) == 2 for each in windows)


def test_happy_path_a_window_holds_the_city_and_its_margin_along_the_strip() -> None:
    """Scenarios: S-P06-HAPPY-STRIP-WINDOW"""
    strip = strip_of()
    frame = Frame(strip.film, 1.0, FILM[0], FILM[1])
    each = first_guesses(frame, strip.quad, strip.grid.box(), None)[0]
    box = strip.grid.box()

    span = city_columns(each, FILM, box, STRIP_MARGIN_GROUND_M / strip.ground)

    assert span is not None
    city = box.width * strip.ground / LENGTH_GROUND_M
    margin = STRIP_MARGIN_GROUND_M / LENGTH_GROUND_M
    assert (span[1] - span[0]) / FILM[0] == pytest.approx(city + 2 * margin, abs=0.01)


def test_bad_path_an_orientation_that_folds_the_strip_to_a_point_holds_no_columns() -> None:
    """Scenarios: S-P01-BAD-CITY-NOT-FOUND"""
    strip = strip_of()
    folded = Assignment(0, False, numpy.array([[0.0, 0.0, 1.0], [0.0, 0.0, 1.0], [0.0, 0.0, 1.0]]))

    assert city_columns(folded, FILM, strip.grid.box(), STRIP_MARGIN_GROUND_M / strip.ground) is None


def test_bad_path_a_footprint_off_the_city_slides_windows_along_the_whole_strip() -> None:
    """Scenarios: S-P06-BAD-STRIP-NO-PLACE"""
    strip = strip_of()
    frame = Frame(strip.film, 1.0, FILM[0], FILM[1])
    box = strip.grid.box()
    far = MercatorBox(box.left + 400_000, box.bottom + 400_000, box.right + 400_000, box.top + 400_000)
    firsts = first_guesses(frame, strip.quad, box, None)

    windows = strip_windows(firsts, FILM, far, strip.ground)

    slid = sliding_windows(firsts, FILM, far, strip.ground)
    assert [(each.start, each.end) for each in windows] == [(each.start, each.end) for each in slid]
    assert windows[0].start == 0
    assert windows[-1].end == FILM[0]
    assert all(later.start < earlier.end for earlier, later in itertools.pairwise(windows))
    assert all(each.slid for each in windows)
    centre = numpy.array([(far.left + far.right) / 2, (far.bottom + far.top) / 2])
    for each in windows:
        middle = each.orientations[0].to_mercator(numpy.array([(each.start + each.end) / 2]), numpy.array([FILM[1] / 2]))
        assert numpy.hypot(middle[0][0] - centre[0], middle[1][0] - centre[1]) < 1.0


def test_bad_path_slid_windows_ask_no_local_ai_and_a_strip_nothing_reaches_is_not_the_citys() -> None:
    """Scenarios: S-P06-BAD-STRIP-NO-PLACE"""
    strip = strip_of()
    search = replace(search_of(strip), grid=Grid(strip.grid.left + 400_000, strip.grid.top, strip.grid.resolution, 10, 10))

    slid = searches(search, True, lambda frame, firsts: [(each, 1.0) for each in firsts])

    assert all(each.window is not None and each.window.slid for each in slid)
    assert all(isinstance(each.search.matcher, NullProposalMatcher) for each in slid)

    def refuse(frame: Frame, firsts: object) -> list[tuple[Assignment, float]]:
        raise CityNotFoundError

    with pytest.raises(CityNotFoundError):
        searches(search, True, refuse)


def test_bad_path_a_frame_or_a_camera_that_is_no_strip_is_searched_whole() -> None:
    """Scenarios: S-P06-BAD-STRIP-NO-PLACE"""
    strip = strip_of()
    search = search_of(strip)
    square = replace(search, frame=replace(search.frame, width=FILM[0], height=FILM[0] // 2))

    for each, strip_camera in ((search, False), (square, True)):
        whole = searches(each, strip_camera, lambda frame, firsts: [(one, 1.0) for one in firsts[:1]])
        assert len(whole) == 1
        assert whole[0].window is None
        assert whole[0].search.orientations == each.orientations[:1]
    assert SENSOR_SPECS["KH-4A"].strip
    assert not SENSOR_SPECS["KH-9-pan"].strip


def _found(agreed: int) -> Found:
    return Found(None, "none", None, (agreed, 100), None, ())


def test_bad_path_no_window_proved_keeps_the_best_voted_and_the_first_of_equals() -> None:
    """Scenarios: S-P06-BAD-STRIP-NO-PLACE"""
    search = search_of(strip_of())
    windows = [Windowed(search, StripWindow(index * 10, index * 10 + 20, ())) for index in range(3)]
    votes = iter([3, 7, 7])
    lines: list[str] = []

    kept, found = best_of(windows, lambda each: _found(next(votes)), lines.append)

    assert found.votes == (7, 100)
    assert kept is windows[1].search
    assert lines[-1].startswith("strip window kept: film columns 10 to 30")
    whole, _ = best_of([Windowed(search)], lambda each: _found(0), lines.append)
    assert whole is search
    assert len(lines) == 4
