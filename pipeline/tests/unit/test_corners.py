"""The orientations and the crops of `locate` on a KH-9-like panoramic strip (findings 62 and 63 of 2026-11-02).

The live frame (KH-9 Hexagon, 1972-02-02, a 1:12 strip) was cropped under a quarter turn: the crop ran along the strip's whole length
(a scan over `MAX_SCAN_PIXELS`) and matched nothing. Here a synthetic strip (1:3.75, 4 m pixels, its film stored turned and mirrored) keeps
only the square-pixel assignments, and a frame nothing proved gets a crop that **always fits**, however far its orientations lie apart.
"""

import math
from typing import Final

import numpy
import pytest
from hcm_pipeline.contract import MAX_SCAN_PIXELS, Errors
from hcm_pipeline.documents import Scene
from hcm_pipeline.geo import WORLD_HALF_M, Bounds, Grid, MercatorBox, ground_scale, near_lng, to_lnglat, to_mercator
from hcm_pipeline.georef.corners import (
    MAX_ANISOTROPY,
    UNPROVEN_MARGIN_M,
    Assignment,
    CityNotFoundError,
    Crop,
    DegenerateCornersError,
    Frame,
    anisotropy,
    assignments,
    bounded_crop,
    crop,
    crop_box,
    first_guesses,
    frame_corners,
    homography,
    inside_world,
    plausible,
    reaching,
)
from hcm_pipeline.jobs import StepFailedError
from hcm_pipeline.steps.georef import scan_resolution
from hcm_pipeline.steps.locate import frame_pixel_m, proved_gcps, within_limits

from tests.synthetic.scenes import CENTRE

# The strip: 2 400 by 640 film pixels of 4 m (9.6 by 2.56 km), its long side turned 15 degrees from east.
WIDTH: Final = 2400
HEIGHT: Final = 640
PIXEL_M: Final = 4.0
STRIP_ANGLE_DEG: Final = 15.0
# The film's top-left corner lies at the strip's north-east corner, its top edge along the north side, mirrored.
TRUE_ROTATION: Final = 1
TRUE_MIRRORED: Final = True
SHRINK: Final = 8
# The city window: 3.6 km square, 1.5 km along the strip from its middle.
WINDOW_SIDE_M: Final = 3600.0
WINDOW_ALONG_M: Final = 1500.0


def strip_quad(offset: tuple[float, float] = (0.0, 0.0)) -> list[tuple[float, float]]:
    """The strip's geographic corners (lat, lng), north-west first and clockwise, moved by `offset` metres."""
    cx, cy = to_mercator(*CENTRE)
    angle = math.radians(STRIP_ANGLE_DEG)
    half_long, half_short = WIDTH * PIXEL_M / 2, HEIGHT * PIXEL_M / 2
    quad = []
    for sx, sy in ((-1, 1), (1, 1), (1, -1), (-1, -1)):
        x, y = sx * half_long, sy * half_short
        mx = cx + x * math.cos(angle) - y * math.sin(angle) + offset[0]
        my = cy + x * math.sin(angle) + y * math.cos(angle) + offset[1]
        lng, lat = to_lnglat(mx, my)
        quad.append((lat, lng))
    return quad


def true_assignment() -> Assignment:
    found = [
        candidate
        for candidate in assignments(WIDTH, HEIGHT, strip_quad())
        if (candidate.rotation, candidate.mirrored) == (TRUE_ROTATION, TRUE_MIRRORED)
    ]
    return found[0]


def window() -> MercatorBox:
    cx, cy = to_mercator(*CENTRE)
    angle = math.radians(STRIP_ANGLE_DEG)
    x, y = cx + WINDOW_ALONG_M * math.cos(angle), cy + WINDOW_ALONG_M * math.sin(angle)
    half = WINDOW_SIDE_M / 2
    return MercatorBox(x - half, y - half, x + half, y + half)


def strip() -> Frame:
    return Frame(numpy.full((HEIGHT // SHRINK, WIDTH // SHRINK), 120, numpy.uint8), float(SHRINK), WIDTH, HEIGHT)


def test_happy_path_only_the_square_pixel_assignments_of_a_strip_are_scored() -> None:
    """Scenarios: S-P01-HAPPY-KH9-STRIP"""
    shapes = sorted(anisotropy(candidate, WIDTH, HEIGHT) for candidate in assignments(WIDTH, HEIGHT, strip_quad()))
    kept = plausible(WIDTH, HEIGHT, strip_quad())

    # The film's long side along the strip's long side: two turns, and two turns of the mirror image.
    assert {(candidate.rotation, candidate.mirrored) for candidate in kept} == {(0, False), (2, False), (1, True), (3, True)}
    assert shapes[3] <= MAX_ANISOTROPY < shapes[4]
    assert shapes[4] > (WIDTH / HEIGHT) ** 2 * 0.9


def test_happy_path_a_frame_over_the_window_reaches_it_most_covered_first() -> None:
    """Scenarios: S-P01-HAPPY-KH9-STRIP"""
    kept = plausible(WIDTH, HEIGHT, strip_quad())
    grid = Grid.over(window(), 60.0)

    found = reaching(strip(), kept, grid, 0.0)

    assert {each.rotation for each, _ in found} == {each.rotation for each in kept}
    assert all(share > 0 for _, share in found)
    assert [share for _, share in found] == sorted((share for _, share in found), reverse=True)


def test_bad_path_a_frame_far_from_the_window_does_not_reach_it() -> None:
    """Scenarios: S-P01-BAD-CITY-NOT-FOUND, S-P01-BAD-CITY-OFF-FRAME"""
    kept = plausible(WIDTH, HEIGHT, strip_quad((40_000.0, 40_000.0)))

    with pytest.raises(CityNotFoundError):
        reaching(strip(), kept, Grid.over(window(), 60.0), 0.0)


def test_bad_path_a_crop_box_outside_the_frame_does_not_reach_it() -> None:
    """Scenarios: S-P01-BAD-CITY-OFF-FRAME"""
    far = MercatorBox(window().left + 1e6, window().bottom, window().right + 1e6, window().top)

    with pytest.raises(CityNotFoundError):
        crop_box(true_assignment(), far, WIDTH, HEIGHT)


def _fine(left_m: float = 0.0) -> Assignment:
    """A film scale so fine that the margin alone is over any limit."""
    return Assignment(0, False, numpy.array([[0.01, 0.0, window().left - 1e4 + left_m], [0.0, -0.01, window().top + 1e4], [0.0, 0.0, 1.0]]))


def test_bad_path_an_unproved_crop_holds_the_margin() -> None:
    """Scenarios: S-P01-BAD-WEAK-GUESS-TO-POINTS"""
    plain = crop(true_assignment(), window(), WIDTH, HEIGHT)
    assert plain.width < WIDTH
    assert UNPROVEN_MARGIN_M == 20_000.0

    wide, lost = bounded_crop([true_assignment()], window(), (WIDTH, HEIGHT, 0))

    # The strip is under 20 km long: the margin takes all of it.
    assert (wide.left, wide.top, wide.width, wide.height) == (0, 0, WIDTH, HEIGHT)
    assert wide.weak
    assert lost == 0
    assert not plain.weak


def test_bad_path_an_unproved_crop_over_the_limit_is_cut_around_the_first_orientation_and_always_fits() -> None:
    """Scenarios: S-P06-BAD-OVER-LIMIT, S-P01-BAD-WEAK-GUESS-TOO-WIDE"""
    limits = (100 * MAX_SCAN_PIXELS, 100 * MAX_SCAN_PIXELS, 0)
    margin = UNPROVEN_MARGIN_M / ground_scale(window().bounds().middle_lat)

    one, one_lost = bounded_crop([_fine()], window(), limits)
    two, two_lost = bounded_crop([_fine(), _fine(-30_000.0)], window(), limits)

    for found in (one, two):
        assert max(found.width, found.height) <= MAX_SCAN_PIXELS
        assert within_limits(found) is found
    assert one_lost == 1
    assert two_lost == 2
    # The cut keeps the middle of the first orientation's box.
    first = crop_box(
        _fine(), MercatorBox(window().left - margin, window().bottom - margin, window().right + margin, window().top + margin), *limits[:2]
    )
    assert abs(two.left + two.width / 2 - (first[0] + first[2]) / 2) <= 1
    assert all(0 <= gcp.x <= two.width and 0 <= gcp.y <= two.height for gcp in two.gcps)


def test_happy_path_an_unproved_crop_that_fits_keeps_every_orientation_in_it() -> None:
    """Scenarios: S-P01-BAD-WEAK-GUESS-TO-POINTS"""
    kept = plausible(WIDTH, HEIGHT, strip_quad())

    found, lost = bounded_crop(kept, window(), (WIDTH, HEIGHT, 0))

    assert lost == 0
    assert (found.width, found.height) == (WIDTH, HEIGHT)


def test_bad_path_no_orientation_reaching_the_margin_is_city_not_found() -> None:
    """Scenarios: S-P01-BAD-CITY-OFF-FRAME"""
    far = MercatorBox(window().left + 1e7, window().bottom, window().right + 1e7, window().top)

    with pytest.raises(CityNotFoundError):
        bounded_crop([true_assignment()], far, (WIDTH, HEIGHT, 0))


def test_happy_path_a_frames_own_gcps_lie_at_its_corners_and_give_its_transform_back() -> None:
    """Scenarios: S-P01-HAPPY-KH9-STRIP"""
    located = crop(true_assignment(), window(), WIDTH, HEIGHT)

    assert [(gcp.x, gcp.y) for gcp in located.gcps] == [
        (0.0, 0.0),
        (float(located.width), 0.0),
        (float(located.width), float(located.height)),
        (0.0, float(located.height)),
    ]
    assert scan_resolution(located.gcps, located.width) == pytest.approx(PIXEL_M, rel=0.2)


def test_bad_path_a_crop_over_the_largest_scan_side_fails_before_it_is_read() -> None:
    """Scenarios: S-P01-BAD-CITY-NOT-FOUND"""
    with pytest.raises(StepFailedError) as raised:
        within_limits(Crop(0, 0, MAX_SCAN_PIXELS + 1, 2300, ()))

    assert raised.value.code == Errors.PROCESSING_FAILED
    assert f"over the {MAX_SCAN_PIXELS}" in str(raised.value)
    assert within_limits(Crop(0, 0, MAX_SCAN_PIXELS, 2300, ())).width == MAX_SCAN_PIXELS


# A KH-9 frame over longitude 180 at latitude -17, about 620 km long; and the same frame moved to longitude 0, the control.
LINE_QUAD: Final = ((-15.0, 174.5), (-15.0, -174.5), (-19.0, -174.5), (-19.0, 174.5))
SHIFTED_QUAD: Final = ((-15.0, -5.5), (-15.0, 5.5), (-19.0, 5.5), (-19.0, -5.5))
LINE_FILM: Final = (200_000, 10_000)


def _line_frame() -> Frame:
    pixels = numpy.full((LINE_FILM[1] // 100, LINE_FILM[0] // 100), 128, numpy.uint8)
    return Frame(pixels, 100.0, *LINE_FILM)


def _box_of(west: float, east: float, south: float = -18.2, north: float = -18.05) -> MercatorBox:
    return Bounds(west, south, east, north).mercator()


@pytest.mark.parametrize(("west", "east"), [(178.3, 178.55), (-179.7, -179.4)])
def test_happy_path_a_frame_over_longitude_180_reaches_a_city_on_either_side(west: float, east: float) -> None:
    """Scenarios: S-P01-HAPPY-ANTIMERIDIAN"""
    box = _box_of(west, east)
    firsts = first_guesses(_line_frame(), LINE_QUAD, box, None)

    found = reaching(_line_frame(), firsts, Grid.over(box, 300.0), 30_000.0)

    assert found
    assert max(share for _, share in found) == pytest.approx(1.0)


def test_happy_path_the_frame_over_the_line_reaches_as_it_does_at_longitude_0() -> None:
    """Scenarios: S-P01-HAPPY-ANTIMERIDIAN"""
    box = _box_of(-1.7, -1.45)
    firsts = first_guesses(_line_frame(), SHIFTED_QUAD, box, None)

    assert max(share for _, share in reaching(_line_frame(), firsts, Grid.over(box, 300.0), 30_000.0)) == pytest.approx(1.0)


def test_bad_path_a_city_far_from_a_frame_over_the_line_is_still_not_on_it() -> None:
    """Scenarios: S-P01-BAD-CITY-NOT-FOUND"""
    box = _box_of(160.0, 160.25)

    with pytest.raises(CityNotFoundError):
        reaching(_line_frame(), first_guesses(_line_frame(), LINE_QUAD, box, None), Grid.over(box, 300.0), 30_000.0)


def test_happy_path_a_footprint_over_the_line_stays_one_piece() -> None:
    """Scenarios: S-P01-HAPPY-ANTIMERIDIAN"""
    ring = ((-15.0, 174.5), (-15.0, -174.5), (-19.0, -174.5), (-19.0, 174.5))
    quad = Scene("x", "2000-01-01", ring, None).corner_quad()

    assert [place[1] for place in quad] == [174.5, 185.5, 185.5, 174.5]
    assert near_lng(185.5, 178.0) == 185.5
    assert near_lng(185.5, -179.0) == -174.5


def test_happy_path_a_window_stops_at_the_line_and_its_box_stays_a_plain_box() -> None:
    """Scenarios: S-P01-HAPPY-ANTIMERIDIAN"""
    window = Bounds(179.2, -18.2, 179.95, -18.05).mercator().expanded()

    assert window.right == WORLD_HALF_M
    assert window.bounds().east <= 180.0
    west = Bounds(-179.95, -18.2, -179.2, -18.05).mercator().expanded()
    assert west.left == -WORLD_HALF_M
    assert west.bounds().west >= -180.0


def test_bad_path_no_corner_pair_is_written_past_the_line() -> None:
    """Scenarios: S-P01-HAPPY-ANTIMERIDIAN"""
    window = Bounds(179.2, -18.2, 179.95, -18.05).mercator().expanded()
    firsts = first_guesses(_line_frame(), LINE_QUAD, window, None)

    located, _ = bounded_crop(firsts[:1], window, (*LINE_FILM, 0))

    assert all(-180.0 <= gcp.lng <= 180.0 for gcp in located.gcps)
    assert all(0 <= gcp.x <= located.width and 0 <= gcp.y <= located.height for gcp in located.gcps)
    assert max(gcp.x for gcp in located.gcps) > min(gcp.x for gcp in located.gcps)


def test_happy_path_corners_inside_the_world_are_left_as_they_are() -> None:
    """Scenarios: S-P01-HAPPY-ANTIMERIDIAN"""
    corners = numpy.array([[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]])

    assert inside_world(corners, lambda film: film) is corners


class _NearTheLine:
    """A proved map whose crop sticks out past longitude 180."""

    def to_places(self, film: numpy.ndarray) -> numpy.ndarray:
        return numpy.column_stack((WORLD_HALF_M - 5_000.0 + film[:, 0] * 10.0, -2e6 - film[:, 1] * 10.0))

    def to_film(self, places: numpy.ndarray) -> numpy.ndarray:
        return numpy.column_stack(((places[:, 0] - WORLD_HALF_M + 5_000.0) / 10.0, (-2e6 - places[:, 1]) / 10.0))


def test_bad_path_a_proved_crops_corners_stay_on_the_map() -> None:
    """Scenarios: S-P01-HAPPY-ANTIMERIDIAN"""
    gcps = proved_gcps(_NearTheLine(), (0, 0, 800, 600))

    assert all(gcp.lng <= 180.0 for gcp in gcps)
    assert all(0 <= gcp.x <= 800 and 0 <= gcp.y <= 600 for gcp in gcps)


def test_happy_path_a_town_the_model_puts_past_the_films_edge_still_reaches_it() -> None:
    """Scenarios: S-P01-HAPPY-TOWN-OFF-EDGE"""
    # The frame's top edge runs along y = 0; F006 lay 14 km off, so a town truly on the film can lie 14 km beyond the model's edge.
    ground = ground_scale(44.0)
    x0, y0 = to_mercator(25.0, 44.0)
    matrix = numpy.array([[1.0, 0.0, x0 - 100_000.0], [0.0, -1.0, y0], [0.0, 0.0, 1.0]])
    frame = Frame(numpy.full((300, 2000), 128, numpy.uint8), 100.0, 200_000, 30_000)
    side = 10_000.0 / ground
    above = y0 + 14_000.0 / ground
    town = Grid.over(MercatorBox(x0 - side / 2, above - side / 2, x0 + side / 2, above + side / 2), 60.0)
    first = Assignment(0, False, matrix)

    assert reaching(frame, [first], town, 30_000.0)
    with pytest.raises(CityNotFoundError):
        reaching(frame, [first], town, 0.0)


def test_bad_path_a_town_beyond_the_search_range_does_not_reach() -> None:
    """Scenarios: S-P01-BAD-CITY-NOT-FOUND"""
    ground = ground_scale(44.0)
    x0, y0 = to_mercator(25.0, 44.0)
    matrix = numpy.array([[1.0, 0.0, x0 - 100_000.0], [0.0, -1.0, y0], [0.0, 0.0, 1.0]])
    frame = Frame(numpy.full((300, 2000), 128, numpy.uint8), 100.0, 200_000, 30_000)
    side = 10_000.0 / ground
    above = y0 + 45_000.0 / ground
    town = Grid.over(MercatorBox(x0 - side / 2, above - side / 2, x0 + side / 2, above + side / 2), 60.0)

    with pytest.raises(CityNotFoundError):
        reaching(frame, [Assignment(0, False, matrix)], town, 30_000.0)


LatLng = tuple[float, float]


def _quad_of(along_m: float, across_m: float, north_south: bool) -> tuple[LatLng, LatLng, LatLng, LatLng]:
    """A strip's corners, north-west first and clockwise, at latitude 44 (ground metres)."""
    ground = ground_scale(44.0)
    x0, y0 = to_mercator(25.0, 44.0)
    half_x = (across_m if north_south else along_m) / 2 / ground
    half_y = (along_m if north_south else across_m) / 2 / ground
    places = [(x0 - half_x, y0 + half_y), (x0 + half_x, y0 + half_y), (x0 + half_x, y0 - half_y), (x0 - half_x, y0 - half_y)]
    (nw_lng, nw_lat), (ne_lng, ne_lat), (se_lng, se_lat), (sw_lng, sw_lat) = (to_lnglat(*place) for place in places)
    return (nw_lat, nw_lng), (ne_lat, ne_lng), (se_lat, se_lng), (sw_lat, sw_lng)


def test_bad_path_a_north_south_strip_scanned_as_its_width_keeps_its_true_pixel() -> None:
    """Scenarios: S-P06-BAD-NORTH-SOUTH-STRIP"""
    scene = Scene("x", "1966-01-01", (), _quad_of(200_000.0, 22_000.0, True))

    pixel = frame_pixel_m(scene, (333_000, 36_000))

    # 200 km on the ground, 333,000 pixels: about 0.6 m, about 0.83 Mercator metres; never the short edge's 0.09.
    assert pixel == pytest.approx(200_000.0 / ground_scale(44.0) / 333_000, rel=0.02)


def test_happy_path_an_east_west_strip_keeps_the_pixel_it_always_had() -> None:
    """Scenarios: S-P06-BAD-NORTH-SOUTH-STRIP"""
    scene = Scene("x", "1975-01-01", (), _quad_of(600_000.0, 40_000.0, False))

    assert frame_pixel_m(scene, (300_000, 15_000)) == pytest.approx(600_000.0 / ground_scale(44.0) / 300_000, rel=0.02)


def test_bad_path_collinear_or_coincident_corners_are_skipped_without_crashing() -> None:
    """Scenarios: S-P01-BAD-CITY-NOT-FOUND"""
    collinear: tuple[LatLng, LatLng, LatLng, LatLng] = ((44.40, 26.00), (44.40, 26.01), (44.40, 26.02), (44.40, 26.03))
    repeated: tuple[LatLng, LatLng, LatLng, LatLng] = ((44.40, 26.00), (44.40, 26.00), (44.42, 26.02), (44.42, 26.00))
    source = frame_corners(WIDTH, HEIGHT)
    target = numpy.array([to_mercator(lng, lat) for lat, lng in collinear])

    with pytest.raises(DegenerateCornersError):
        homography(source, target)
    assert assignments(WIDTH, HEIGHT, collinear) == []
    assert assignments(WIDTH, HEIGHT, repeated) == []
    # DS1111-1020AF035's corner given twice solved in floating point to a map of 1e15 that folded the strip to a point.
    twice = numpy.array([to_mercator(lng, lat) for lat, lng in ((45.963, 23.947), (43.882, 26.923), (43.882, 26.923), (45.751, 23.762))])
    with pytest.raises(DegenerateCornersError):
        homography(frame_corners(118_290, 11_232), twice)
    assert first_guesses(strip(), collinear, window(), None) == []
    with pytest.raises(CityNotFoundError):
        reaching(strip(), first_guesses(strip(), collinear, window(), None), Grid.over(window(), 60.0), 0.0)


def test_happy_path_first_guesses_skips_a_degenerate_orientation_and_keeps_the_remaining_ones(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Scenarios: S-P01-HAPPY-KH9-STRIP"""
    real_homography = homography
    calls = 0

    def first_one_singular(source: numpy.ndarray, target: numpy.ndarray) -> numpy.ndarray:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise DegenerateCornersError
        return real_homography(source, target)

    monkeypatch.setattr("hcm_pipeline.georef.corners.homography", first_one_singular)

    kept = first_guesses(strip(), strip_quad(), window(), None)
    found = reaching(strip(), kept, Grid.over(window(), 60.0), 0.0)

    assert {(each.rotation, each.mirrored) for each in kept} == {(2, False), (1, True), (3, True)}
    assert any((each.rotation, each.mirrored) == (TRUE_ROTATION, TRUE_MIRRORED) for each, _ in found)
