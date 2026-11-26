"""The rim's fade is a ramp that rises from the black core, and the band is as deep across any edge (`tiles/rim.py`, M12 *The dark rim*).

A review of c5766ba measured two faults: dark ground touching the black core (a lake, a park, a shadow at grey 30 to 70 under a scene
of 120) was cut the whole 150 m, since "darker than 65 % of the scene" alone defined the fade; and the band was measured in side steps,
so across a 45 degree edge it ended about 106 m in and a 200 m fade kept grey 54 there. These frames are previews at 5 ground metres a
pixel (a KH-9 frame's), the edge at 0, 18 and 45 degrees, a black core 20 m deep and then either a fade to the scene over 50 to 200 m or
a flat dark patch 60 m deep and 400 m wide, with and without grain; and the whole view of a frame with a lake on its rim.
"""

import math
from pathlib import Path

import cv2
import numpy
import pytest
from hcm_pipeline.images import UInt8Array, as_uint8
from hcm_pipeline.steps.pyramid import rgba_view
from hcm_pipeline.tiles.rim import RIM_FADE_SHARE, RIM_MAX_GROUND_M, edge_distance, rim_cut
from numpy.typing import NDArray

from tests.integration.test_pyramid_rim import SIZE, alpha_of, write_frame

PIXEL_M = 5.0
REACH = round(RIM_MAX_GROUND_M / PIXEL_M)
SCENE_GREY = 120
BLACK = 2
CORE_M = 20.0
PATCH_M = 60.0
SIDE = 160
#: The columns measured: well inside the patch's sides, and clear of the grid's own sides.
MIDDLE = slice(50, 110)
ANGLES = (0, 18, 45)


def depth_of(angle: float) -> NDArray[numpy.float64]:
    """Each pixel's depth in pixels below a straight edge tilted by `angle` degrees (negative outside)."""
    rows, columns = numpy.indices((SIDE, SIDE)).astype(float)
    tilt = math.radians(angle)
    return (rows - 40) * math.cos(tilt) - columns * math.sin(tilt)


def preview(angle: float, grey_of_depth_m: NDArray[numpy.float64]) -> tuple[UInt8Array, UInt8Array]:
    """The preview's grey and alpha: opaque below the edge."""
    alpha = numpy.where(depth_of(angle) >= 0, 255, 0).astype(numpy.uint8)
    return as_uint8(numpy.clip(numpy.round(grey_of_depth_m), 0, 255).astype(numpy.uint8)), alpha


def ramp(angle: float, fade_m: float) -> tuple[UInt8Array, UInt8Array]:
    """Black for `CORE_M`, then a straight fade to the scene over `fade_m` ground metres."""
    metres = depth_of(angle) * PIXEL_M
    share = numpy.clip((metres - CORE_M) / fade_m, 0, 1)
    return preview(angle, BLACK + share * (SCENE_GREY - BLACK))


def patch(angle: float, grey: int, grain: float = 0.0) -> tuple[UInt8Array, UInt8Array]:
    """Black for `CORE_M`, then a flat dark patch `PATCH_M` deep across the middle columns, the scene beside and past it."""
    metres = depth_of(angle) * PIXEL_M
    columns = numpy.indices((SIDE, SIDE))[1]
    level = numpy.where(metres < CORE_M, BLACK, SCENE_GREY).astype(float)
    level[(metres >= CORE_M) & (metres < CORE_M + PATCH_M) & (columns > 40) & (columns < 120)] = grey
    noise = numpy.random.default_rng(7).normal(0, grain, level.shape) if grain else numpy.zeros_like(level)
    return preview(angle, level + noise * (metres >= CORE_M))


def past_core(cut: NDArray[numpy.bool_], grey: UInt8Array, alpha: UInt8Array) -> int:
    """How far, in whole pixels (sides and corners count one), the cut reaches past the black core in the middle columns."""
    core = (alpha == 255) & (grey <= BLACK)
    steps = cv2.distanceTransform((~core).astype(numpy.uint8), cv2.DIST_C, 3)
    return int(steps[:, MIDDLE][cut[:, MIDDLE]].max())


@pytest.mark.parametrize("grey", [30, 50, 70])
@pytest.mark.parametrize("angle", ANGLES)
def test_bad_path_flat_dark_ground_touching_the_core_loses_at_most_two_pixels(angle: float, grey: int) -> None:
    """Scenarios: S-P08-BAD-RIM-DARK-PATCH"""
    shade, alpha = patch(angle, grey)

    cut = rim_cut(shade, alpha, REACH)

    assert past_core(cut, shade, alpha) <= 2, "a lake or a park is the picture's, not the fade's (c5766ba cut it 150 m)"
    assert cut[:, MIDDLE][(alpha[:, MIDDLE] == 255) & (shade[:, MIDDLE] <= BLACK)].all(), "the black core is still cut"


@pytest.mark.parametrize("angle", ANGLES)
def test_bad_path_grainy_dark_ground_is_not_followed_across_the_band(angle: float) -> None:
    """Scenarios: S-P08-BAD-RIM-DARK-PATCH"""
    shade, alpha = patch(angle, 50, grain=12.0)

    cut = rim_cut(shade, alpha, REACH)

    assert past_core(cut, shade, alpha) <= 6, "the scene's grain rises here and there, but a flat patch is not a fade"


@pytest.mark.parametrize("fade_m", [50, 100, 150, 200])
@pytest.mark.parametrize("angle", ANGLES)
def test_happy_path_a_fade_at_any_angle_is_cut_to_its_end_and_no_deeper_than_the_band(angle: float, fade_m: float) -> None:
    """Scenarios: S-P08-HAPPY-RIM-ANGLES"""
    shade, alpha = ramp(angle, fade_m)
    metres = depth_of(angle) * PIXEL_M

    cut = rim_cut(shade, alpha, REACH)

    kept = (alpha == 255) & ~cut & (metres <= RIM_MAX_GROUND_M - PIXEL_M)
    darkest = shade[:, MIDDLE][kept[:, MIDDLE]]
    assert darkest.size == 0 or darkest.min() >= RIM_FADE_SHARE * SCENE_GREY, "no dark row of the fade is kept within the band"
    assert metres[:, MIDDLE][cut[:, MIDDLE]].max() <= RIM_MAX_GROUND_M + PIXEL_M, "never cut past 150 m and one pixel"


@pytest.mark.parametrize("angle", ANGLES)
def test_happy_path_the_band_is_measured_as_a_straight_line_distance(angle: float) -> None:
    """Scenarios: S-P08-HAPPY-RIM-ANGLES"""
    depth = depth_of(angle)

    distance = edge_distance(depth < 0)

    deep = (depth[:, MIDDLE] > 5) & (depth[:, MIDDLE] < 30)
    over = distance[:, MIDDLE][deep] - depth[:, MIDDLE][deep]
    assert over.min() >= 0, "never shallower than the depth below the edge"
    assert over.max() <= 1.5, "nor deeper by more than a pixel's diagonal (side steps across a 45 degree edge: 41 % deeper)"


def test_bad_path_a_lake_on_the_rim_keeps_its_alpha_in_the_view(tmp_path: Path) -> None:
    """Scenarios: S-P08-BAD-RIM-DARK-PATCH"""
    rows, columns = numpy.indices((SIZE, SIZE))
    depth = rows - (100 + columns // 3)
    grey = numpy.full((SIZE, SIZE), SCENE_GREY, numpy.uint8)
    grey[(depth >= 0) & (depth < 4)] = BLACK
    lake = (depth >= 4) & (depth < 40) & (columns > 200) & (columns < 400)
    grey[lake] = 40
    source = write_frame(tmp_path / "warped.tif", grey, numpy.where(depth >= 0, 255, 0).astype(numpy.uint8))

    alpha = alpha_of(rgba_view(source, tmp_path / "rgba.vrt"))

    assert alpha[lake & (depth >= 8)].min() == 255, "the lake past its first pixels shows, though it lies within the reach"
    assert alpha[(depth >= 1) & (depth < 3)].max() == 0, "the rim's black is still cut"
