"""The panoramic model of `locate` on synthetic panoramic frames (lesson 361, M9).

The real 1972 KH-9 frame showed that a homography through a panoramic frame's corners has the scale wrong 1.5 to 2 times at the
city; the real 1982 frame that a shorter sweep need not be centred on the nadir. Here the film is made through the forward model itself,
from the seeded world, its corners some kilometres off the truth as the real frames' were: the model must round-trip, the chain through
it must find and prove the city, the corner homography must not, a frame of another place must go on to the admin's points, and a window
off the frame must be the one failure left.
"""

import math
from typing import Final

import cv2
import numpy
import pytest
from hcm_pipeline.calibrate.chain import Found, FrameSearch, find_frame
from hcm_pipeline.contract import SENSOR_SPECS, SearchRange
from hcm_pipeline.frames import FrameLayout
from hcm_pipeline.geo import FloatArray, Grid, MercatorBox, to_lnglat, to_mercator
from hcm_pipeline.georef.corners import (
    Assignment,
    CityNotFoundError,
    Frame,
    bounded_crop,
    corner_transform,
    crop_box,
    first_guesses,
    frame_corners,
    on_exposure,
    reaching,
)
from hcm_pipeline.georef.panoramic import PanoramicCamera, PanoramicModel, least_squares_homography, sweep_ends
from hcm_pipeline.images import UInt8Array, as_uint8
from hcm_pipeline.steps.georef import scan_resolution
from hcm_pipeline.steps.locate import camera_of, shorter_sweep

from tests.synthetic.scenes import CENTRE, World, render_world
from tests.unit.calibrate_scene import ArrayReader

# The film: about 3 m a pixel along it at the nadir and 5 m across it. The world is 10 km wide: only the strip's middle shows it.
WIDTH: Final = 12000
GAP: Final = 800
HEIGHT: Final = 1800
HALF_ANGLE_DEG: Final = 60.5
CAMERA: Final = PanoramicCamera(HALF_ANGLE_DEG, WIDTH - GAP)
SHRINK: Final = 4
# The film's middle is at the nadir, half of `SPAN_M` from either end; at each end the frame is `END_M` wide.
SPAN_M: Final = 54000.0
END_M: Final = 18000.0
# The corners' error, as the real frame's: the truth lies this far (EPSG:3857 metres) from where they say.
CORNER_ERROR_M: Final = (2000.0, -2600.0)
WINDOW_SIDE_M: Final = 8000.0


def true_corners(offset: tuple[float, float] = (0.0, 0.0)) -> FloatArray:
    """The film's corners on the ground (top-left first): an east-west strip around the centre, its top edge north."""
    cx, cy = to_mercator(*CENTRE)
    half_long, half_wide = SPAN_M / 2, END_M / 2
    return numpy.array(
        [
            [cx - half_long + offset[0], cy + half_wide + offset[1]],
            [cx + half_long + offset[0], cy + half_wide + offset[1]],
            [cx + half_long + offset[0], cy - half_wide + offset[1]],
            [cx - half_long + offset[0], cy - half_wide + offset[1]],
        ]
    )


def model(offset: tuple[float, float] = (0.0, 0.0)) -> PanoramicModel:
    return PanoramicModel(true_corners(offset), CAMERA, HEIGHT)


def quad_of(corners: FloatArray) -> list[tuple[float, float]]:
    """The corners as a scene's quad (lat, lng; north-west first, clockwise), which the film's corners already are."""
    places = [to_lnglat(float(x), float(y)) for x, y in corners]
    return [(lat, lng) for lng, lat in places]


def render_film(world: World) -> UInt8Array:
    """The film: every pixel the world's grey at the place the model gives it, grey beyond the world, then the dark gap."""
    u, v = numpy.meshgrid(numpy.arange(0, WIDTH, SHRINK) + SHRINK / 2.0, numpy.arange(0, HEIGHT, SHRINK) + SHRINK / 2.0)
    mx, my = model().to_mercator(u.astype(numpy.float64), v.astype(numpy.float64))
    gx, gy = world.grid.to_pixel(mx, my)
    pixels = cv2.remap(world.pixels, (gx - 0.5).astype(numpy.float32), (gy - 0.5).astype(numpy.float32), cv2.INTER_LINEAR, borderValue=128)
    grain = numpy.random.default_rng(11).normal(0, 3, pixels.shape)
    film = as_uint8(numpy.clip(pixels + grain, 0, 255))
    film[:, (WIDTH - GAP) // SHRINK :] = 0
    return film


def window() -> MercatorBox:
    cx, cy = to_mercator(*CENTRE)
    half = WINDOW_SIDE_M / 2
    return MercatorBox(cx - half, cy - half, cx + half, cy + half)


def reference_of(world: World, box: MercatorBox) -> tuple[UInt8Array, Grid]:
    """The world's grey over `box` at 10 m (what Sentinel-2 gives `locate`)."""
    grid = Grid.over(box, 10.0)
    mx, my = grid.centres()
    gx, gy = world.grid.to_pixel(mx, my)
    pixels = cv2.remap(world.pixels, (gx - 0.5).astype(numpy.float32), (gy - 0.5).astype(numpy.float32), cv2.INTER_LINEAR, borderValue=128)
    return as_uint8(pixels), grid


@pytest.fixture(scope="module")
def world() -> World:
    return render_world(7)


@pytest.fixture(scope="module")
def frame(world: World) -> Frame:
    film = render_film(world)
    return Frame(film, float(SHRINK), WIDTH, HEIGHT)


def search_of(
    film: Frame, reference: UInt8Array, grid: Grid, quad: list[tuple[float, float]], camera: PanoramicCamera | None
) -> FrameSearch:
    """The chain's input, as `locate` builds it, reading the film `film` shrinks."""
    exposed = on_exposure(film, camera)
    firsts = first_guesses(exposed, quad, grid.box(), camera)
    reached = reaching(exposed, firsts, grid.scaled(6), 0.0)
    full = cv2.resize(film.pixels, (film.width, film.height), interpolation=cv2.INTER_LINEAR)
    limits = (film.width, film.height, 0) if camera is None else (camera.image_start + camera.image_width, film.height, camera.image_start)
    orientations = tuple(each for each, _ in reached)
    return FrameSearch(
        exposed, orientations, reference, grid, ArrayReader(as_uint8(full)), limits, SearchRange(8000.0, (1.0,)), camera, "KH-9-pan", 7
    )


def found_in(search: FrameSearch) -> Found:
    return find_frame(search, lambda: None, list[str]().append)


def film_error_m(found: Found, box: MercatorBox) -> float:
    """The largest distance (EPSG:3857 metres) between where the proved map and the true model put the window's middle on the film."""
    assert found.proof is not None
    assert found.proof.mapping is not None
    places = numpy.array([[(box.left + box.right) / 2, (box.top + box.bottom) / 2]])
    film = found.proof.mapping.to_film(places)
    px, py = model().to_mercator(film[:, 0], film[:, 1])
    return float(numpy.hypot(px - places[:, 0], py - places[:, 1]).max())


def test_happy_path_the_forward_model_round_trips_over_the_film() -> None:
    """Scenarios: S-P01-HAPPY-PANORAMIC-LOCATE"""
    x, y = numpy.meshgrid(numpy.linspace(0.0, WIDTH - GAP, 21), numpy.linspace(0.0, HEIGHT, 11))

    back_x, back_y = model().to_film(*model().to_mercator(x, y))

    assert numpy.abs(back_x - x).max() < 1e-3
    assert numpy.abs(back_y - y).max() < 1e-3


def test_happy_path_the_model_takes_the_film_corners_to_the_ground_corners_and_narrows_at_the_nadir() -> None:
    """Scenarios: S-P01-HAPPY-PANORAMIC-LOCATE"""
    corners = frame_corners(WIDTH - GAP, HEIGHT)

    mx, my = model().to_mercator(corners[:, 0], corners[:, 1])
    middle_x, middle_y = model().to_mercator(numpy.array([(WIDTH - GAP) / 2] * 2), numpy.array([0.0, float(HEIGHT)]))

    assert numpy.allclose(numpy.column_stack((mx, my)), true_corners(), atol=1e-6)
    # The bowtie: across the film the ground at the nadir is cos(half angle) of what it is at the ends.
    assert middle_y[0] - middle_y[1] == pytest.approx(END_M * math.cos(math.radians(HALF_ANGLE_DEG)))
    assert middle_x[0] == pytest.approx(to_mercator(*CENTRE)[0])


def test_happy_path_the_ground_pixel_grows_towards_the_ends_as_the_tangent_says() -> None:
    """Scenarios: S-P01-HAPPY-PANORAMIC-LOCATE"""
    mx, _ = model().to_mercator(numpy.array([5600.0, 5601.0, 100.0, 101.0]), numpy.full(4, 900.0))

    nadir, end = mx[1] - mx[0], mx[3] - mx[2]

    theta = math.radians(HALF_ANGLE_DEG) * (2 * 100.5 / (WIDTH - GAP) - 1)
    assert end / nadir == pytest.approx(1 / math.cos(theta) ** 2, rel=0.01)


def test_happy_path_the_local_fit_holds_the_model_around_the_window() -> None:
    """Scenarios: S-P01-HAPPY-PANORAMIC-LOCATE"""
    fitted = Assignment(0, False, model().local_matrix(window()))
    x, y = fitted.to_pixel(numpy.array([window().left, window().right]), numpy.array([window().top, window().bottom]))

    px, py = model().to_mercator(x, y)

    assert numpy.hypot(px - numpy.array([window().left, window().right]), py - numpy.array([window().top, window().bottom])).max() < 100.0


def test_happy_path_a_least_squares_homography_recovers_an_exact_one_at_large_coordinates() -> None:
    """Scenarios: S-P01-HAPPY-PANORAMIC-LOCATE"""
    source = numpy.array([[x, y] for x in (250000.0, 270000.0, 290000.0) for y in (0.0, 10000.0, 20000.0)])
    truth = numpy.array([[1.1, -0.2, 2.9e6], [-0.15, -1.05, 5.5e6], [2e-9, -1e-9, 1.0]])
    homogeneous = numpy.column_stack((source, numpy.ones(len(source)))) @ truth.T
    target = homogeneous[:, :2] / homogeneous[:, 2:]

    fitted = least_squares_homography(source, target)

    assert numpy.allclose(fitted, truth, rtol=1e-6)


def test_happy_path_a_panoramic_frame_is_found_through_the_model_and_its_corners_error(world: World, frame: Frame) -> None:
    """Scenarios: S-P01-HAPPY-PANORAMIC-LOCATE, S-P06-HAPPY-VOTES"""
    reference, grid = reference_of(world, window())

    found = found_in(search_of(frame, reference, grid, quad_of(true_corners(CORNER_ERROR_M)), CAMERA))

    assert found.proof is not None

    assert found.proof.accepted
    assert found.model is not None
    assert (found.model.rotation, found.model.mirrored) == (0, False)
    assert math.hypot(found.model.dx_m, found.model.dy_m) == pytest.approx(math.hypot(*CORNER_ERROR_M), abs=300.0)
    assert film_error_m(found, window()) < 40.0


def test_bad_path_a_frame_of_another_place_goes_on_to_the_admins_points(frame: Frame) -> None:
    """Scenarios: S-P01-BAD-WEAK-GUESS-TO-POINTS, S-P06-BAD-OFF-STRIP"""
    reference, grid = reference_of(render_world(99), window())

    found = found_in(search_of(frame, reference, grid, quad_of(true_corners(CORNER_ERROR_M)), CAMERA))

    assert found.proof is None
    assert found.how == "none"


def test_bad_path_a_window_off_the_frame_is_the_one_failure_left(world: World, frame: Frame) -> None:
    """Scenarios: S-P01-BAD-CITY-OFF-FRAME"""
    reference, grid = reference_of(world, window())
    far = quad_of(true_corners((0.0, 100_000.0)))

    with pytest.raises(CityNotFoundError) as raised:
        search_of(frame, reference, grid, far, CAMERA)

    assert str(raised.value) == "the frame does not reach the city window under any orientation"


def with_a_fragment(film: UInt8Array, turned: bool = False) -> Frame:
    """The film with its dark gap and, past it, a fragment of the next exposure (bright, textured ground of nowhere near); `turned`:
    the scan's other way round, the fragment and the gap first."""
    pixels = film.copy()
    gap_end = (WIDTH - GAP + 200) // SHRINK
    pixels[:, gap_end:] = as_uint8(numpy.random.default_rng(3).integers(40, 220, pixels[:, gap_end:].shape))
    if not turned:
        return Frame(pixels, float(SHRINK), WIDTH, HEIGHT)
    return Frame(pixels[:, ::-1], float(SHRINK), WIDTH, HEIGHT)


@pytest.mark.parametrize("past", [-1, 1])
def test_bad_path_a_window_past_the_exposures_end_is_not_scored_on_its_gap_and_the_next_exposure(
    world: World, frame: Frame, past: int
) -> None:
    """Scenarios: S-P01-BAD-CITY-OFF-FRAME"""
    reference, grid = reference_of(world, window())
    # The frame's end well short of the window's near side and its surroundings: the fragment alone would lie under it.
    span_out = SPAN_M / 2 + WINDOW_SIDE_M / 2 + 1.2 * WINDOW_SIDE_M
    far = quad_of(true_corners((-past * span_out, 0.0)))
    fragment = with_a_fragment(frame.pixels)

    with pytest.raises(CityNotFoundError):
        search_of(fragment, reference, grid, far, CAMERA)


def test_happy_path_an_accepted_crop_beside_the_frames_end_stops_at_the_exposure(frame: Frame) -> None:
    """Scenarios: S-P01-BAD-CITY-OFF-FRAME"""
    box = MercatorBox(window().left + SPAN_M / 2, window().bottom, window().right + SPAN_M / 2, window().top)
    fitted = Assignment(0, False, model().local_matrix(box))

    _, _, right, _ = crop_box(fitted, box, WIDTH - GAP, HEIGHT)

    assert right == WIDTH - GAP
    assert frame.width == WIDTH
    assert on_exposure(frame, CAMERA).ground == (0, WIDTH - GAP)
    assert on_exposure(frame, None).ground == (0, WIDTH)


def test_happy_path_a_film_scanned_end_for_end_is_found_on_its_own_exposure(world: World, frame: Frame) -> None:
    """Scenarios: S-P01-HAPPY-EXPOSURE-SPAN"""
    reference, grid = reference_of(world, window())
    turned = with_a_fragment(frame.pixels, turned=True)
    camera = PanoramicCamera(HALF_ANGLE_DEG, WIDTH - GAP, GAP)

    found = found_in(search_of(turned, reference, grid, quad_of(true_corners(CORNER_ERROR_M)), camera))

    assert found.proof is not None

    assert found.proof.accepted
    # Flipped left to right: its top-left corner lies at the north-east, its top edge still along the north.
    assert found.model is not None
    assert (found.model.rotation, found.model.mirrored) == (3, True)


def test_happy_path_the_model_counts_the_film_from_the_exposures_first_column() -> None:
    """Scenarios: S-P01-HAPPY-EXPOSURE-SPAN"""
    shifted = PanoramicModel(true_corners(), PanoramicCamera(HALF_ANGLE_DEG, WIDTH - GAP, GAP), HEIGHT)
    x, y = numpy.meshgrid(numpy.linspace(0.0, WIDTH - GAP, 5), numpy.linspace(0.0, HEIGHT, 3))

    plain = model().to_mercator(x, y)
    moved = shifted.to_mercator(x + GAP, y)
    back_x, back_y = shifted.to_film(*moved)

    assert numpy.allclose(plain, moved)
    assert numpy.abs(back_x - (x + GAP)).max() < 1e-3
    assert numpy.abs(back_y - y).max() < 1e-3
    # The window off the film: its local fit still samples the exposure alone.
    fitted = Assignment(0, False, shifted.local_matrix(window()))
    fx, _ = fitted.to_pixel(numpy.array([window().left]), numpy.array([window().top]))
    assert GAP < fx[0] < WIDTH


def test_bad_path_an_unproved_crop_holds_the_city_whichever_orientation_is_true(frame: Frame, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P01-BAD-WEAK-GUESS-TO-POINTS"""
    # A margin as small against this short strip as 20 km is against the real frame's 560 km: no orientation's box takes in another's.
    monkeypatch.setattr("hcm_pipeline.georef.corners.UNPROVEN_MARGIN_M", 500.0)
    box = MercatorBox(window().left + 12000.0, window().bottom, window().right + 12000.0, window().top)
    corners = quad_of(true_corners())
    exposed = on_exposure(frame, CAMERA)
    orientations = first_guesses(exposed, corners, box, CAMERA)

    located, lost = bounded_crop(orientations, box, (WIDTH - GAP, HEIGHT, 0))

    assert lost == 0
    assert located.weak
    for orientation in orientations:
        left, top, right, bottom = crop_box(orientation, box, WIDTH - GAP, HEIGHT)
        assert located.left <= left
        assert located.top <= top
        assert located.left + located.width >= right
        assert located.top + located.height >= bottom
    assert scan_resolution(located.gcps, located.width) > 0
    assert corner_transform(located.gcps).rotation == 0


def test_happy_path_a_short_film_swept_less_and_off_the_nadir_as_its_ends_say() -> None:
    """Scenarios: S-P01-HAPPY-PANORAMIC-LOCATE"""
    # The 1982 frame D3C1217-200510A001: half a film long, its east end wider on the ground.
    quad = numpy.array([to_mercator(lng, lat) for lng, lat in ((23.181, 44.844), (26.391, 44.53), (26.242, 44.281), (23.156, 44.681))])
    layout = FrameLayout(225264, 22240, 16, ())
    camera = camera_of("KH-9-pan", layout)

    assert camera is not None
    assert camera.sweep_deg == pytest.approx(60.7, abs=0.1)
    low, high = sweep_ends(quad, camera)
    assert (math.degrees(low), math.degrees(high)) == pytest.approx((-7.8, 52.9), abs=0.5)
    # Read from its other end the frame's ends swap.
    turned = sweep_ends(quad[[2, 3, 0, 1]], camera)
    assert (math.degrees(turned[0]), math.degrees(turned[1])) == pytest.approx((52.9, -7.8), abs=0.5)


def test_happy_path_a_full_film_keeps_the_centred_sweep_and_a_sensor_without_an_angle_has_none() -> None:
    """Scenarios: S-P01-HAPPY-PANORAMIC-LOCATE"""
    spec = SENSOR_SPECS["KH-9-pan"]

    assert shorter_sweep(spec, FrameLayout(448080, 22140, 30, ())) is None
    assert shorter_sweep(SENSOR_SPECS["KH-7"], FrameLayout(1000, 1000, 1, ())) is None
    assert camera_of("KH-7", FrameLayout(1000, 1000, 1, ())) is None


def test_happy_path_an_off_nadir_model_round_trips_and_its_ground_pixel_follows_its_angle() -> None:
    """Scenarios: S-P01-HAPPY-PANORAMIC-LOCATE"""
    camera = PanoramicCamera(HALF_ANGLE_DEG, WIDTH - GAP, 0, 60.0)
    wide = true_corners()
    # The first end twice as wide on the ground as the last.
    wide[1], wide[2] = wide[1] * 0.5 + wide[2] * 0.5 + [0.0, END_M / 4], wide[1] * 0.5 + wide[2] * 0.5 - [0.0, END_M / 4]
    shifted = PanoramicModel(wide, camera, HEIGHT)
    x, y = numpy.meshgrid(numpy.linspace(0.0, WIDTH - GAP, 21), numpy.linspace(0.0, HEIGHT, 11))

    back_x, back_y = shifted.to_film(*shifted.to_mercator(x, y))
    corners = frame_corners(WIDTH - GAP, HEIGHT)
    mx, my = shifted.to_mercator(corners[:, 0], corners[:, 1])

    assert numpy.abs(back_x - x).max() < 1e-3
    assert numpy.abs(back_y - y).max() < 1e-3
    assert numpy.allclose(numpy.column_stack((mx, my)), wide, atol=1e-6)
    near_x, _ = shifted.to_mercator(numpy.array([0.0, 1.0, WIDTH - GAP - 1.0, WIDTH - GAP]), numpy.full(4, HEIGHT / 2))
    assert abs(near_x[1] - near_x[0]) > 1.5 * abs(near_x[3] - near_x[2])


def test_happy_path_each_orientation_gets_the_local_fit_of_its_own_film_direction() -> None:
    """Scenarios: S-P01-HAPPY-PANORAMIC-LOCATE"""
    blank = Frame(numpy.zeros((HEIGHT // SHRINK, WIDTH // SHRINK), numpy.uint8), float(SHRINK), WIDTH, HEIGHT)

    plain = first_guesses(blank, quad_of(true_corners()), window(), None)
    panoramic = first_guesses(blank, quad_of(true_corners()), window(), CAMERA)

    assert [(each.rotation, each.mirrored) for each in panoramic] == [(each.rotation, each.mirrored) for each in plain]
    assert all(not numpy.allclose(one.matrix, other.matrix) for one, other in zip(plain, panoramic, strict=True))
    x, _ = zip(*(each.to_pixel(numpy.array([window().left]), numpy.array([window().top])) for each in panoramic[:2]), strict=True)
    # Turned half way round, the film's x runs the other way: the same place reads from the other end of the exposure.
    assert (panoramic[0].rotation, panoramic[1].rotation) == (0, 2)
    assert x[0][0] == pytest.approx((WIDTH - GAP) - x[1][0], abs=100.0)
