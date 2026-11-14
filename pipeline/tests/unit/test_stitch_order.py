"""Segments in the film's order, whichever way it was scanned (lesson 645 of docs/LESSONS.md).

The 1966 KH-7 strip's delivery letters its two segments right to left, each with the scanner's bright edge band at the frame's
outer end. Joined left to right, the two bands matched each other and the frame ended at the seam: the city's south half was lost.
"""

from pathlib import Path

import cv2
import numpy
import pytest
from hcm_pipeline.contract import Errors
from hcm_pipeline.frames import FrameLayout, Segment
from hcm_pipeline.rasters import GeoTiff, read_band, write_geotiff
from hcm_pipeline.runner import RunOutcome
from hcm_pipeline.steps import stitch

from tests.fakes.world import CITY, JOB_ID, PipelineWorld
from tests.synthetic.scenes import SEGMENT_OVERLAP_PX, SceneSpec, kh7_segments, render_frame, render_world, scanner_edges, truth_for

WORK = f"work/{CITY}/{JOB_ID}/"
SPEC = SceneSpec(seed=11, width=1800, height=1100, segments=2, right_to_left=True)


def kh7_frame(seed: int = SPEC.seed) -> numpy.ndarray:
    spec = SceneSpec(seed=seed, width=SPEC.width, height=SPEC.height)
    return scanner_edges(render_frame(render_world(seed), truth_for(spec)))


def deliver(world: PipelineWorld, tmp_path: Path, parts: list[numpy.ndarray]) -> None:
    for index, part in enumerate(parts):
        name = f"{chr(ord('a') + index)}.tif"
        world.gcs.put(f"{WORK}segments/{name}", write_geotiff(tmp_path / name, GeoTiff([part])).read_bytes())
    world.seed_import()


def test_happy_path_a_strip_scanned_right_to_left_is_joined_whole_with_both_halves(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P01-HAPPY-KH7-TWO-SEGMENTS"""
    frame = kh7_frame()
    parts = kh7_segments(frame)
    deliver(world, tmp_path, parts)

    assert world.runner().run("stitch") is RunOutcome.DONE

    layout = FrameLayout.from_json(world.gcs.objects[f"{WORK}frame.json"].data.decode())
    first, second = layout.placements
    assert first.path.endswith("a.tif")
    assert second.path.endswith("b.tif")
    # `_b`, the left half, lies left of `_a`, overlapping it by the delivery's overlap; together they span the whole strip.
    assert first.x - second.x == parts[1].shape[1] - SEGMENT_OVERLAP_PX
    assert layout.width == frame.shape[1]
    local = tmp_path / "preview.tif"
    local.write_bytes(world.gcs.objects[f"{WORK}frame-preview.tif"].data)
    preview = read_band(local)
    top = -min(first.y, second.y)
    assert numpy.array_equal(preview, frame[top : top + preview.shape[0], : preview.shape[1]])


def test_happy_path_a_strip_scanned_left_to_right_keeps_its_order(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P01-HAPPY-KH7-TWO-SEGMENTS"""
    frame = kh7_frame()
    deliver(world, tmp_path, kh7_segments(frame)[::-1])

    assert world.runner().run("stitch") is RunOutcome.DONE

    layout = FrameLayout.from_json(world.gcs.objects[f"{WORK}frame.json"].data.decode())
    assert layout.placements[0].x == 0
    assert layout.width == frame.shape[1]


def test_bad_path_a_segment_of_another_frame_is_refused(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P01-BAD-SEGMENT-OTHER-FRAME"""
    ours, other = kh7_segments(kh7_frame()), kh7_segments(kh7_frame(seed=29))
    deliver(world, tmp_path, [ours[0], other[1]])

    assert world.runner().run("stitch") is RunOutcome.FAILED

    error = world.job()["error"]
    assert isinstance(error, dict)
    assert error["code"] == Errors.PROCESSING_FAILED
    assert f"{WORK}frame.json" not in world.gcs.objects


@pytest.mark.parametrize("true_order", [True, False])
def test_bad_path_the_scanners_edge_bands_never_match_each_other(true_order: bool) -> None:
    """Scenarios: S-P01-BAD-SEGMENT-OTHER-FRAME"""
    # The wrong order puts the two bands side by side: the strip matched starts past its band, so only the true overlap scores.
    right_half, left_half = kh7_segments(kh7_frame())
    left, right = (left_half, right_half) if true_order else (right_half, left_half)
    _dx, _dy, score = stitch.coarse_match(left, right, 1)

    assert (score >= stitch.MIN_PAIR_SCORE) is true_order


def corona_pair(overlap: int) -> tuple[numpy.ndarray, numpy.ndarray]:
    """Two segments of a wide Corona-like frame (3.2 times as wide as tall), overlapping by `overlap` columns."""
    rng = numpy.random.default_rng(68)
    height, width = 1400, 4480
    noise = rng.normal(128, 60, (height, 2 * width)).astype(numpy.float32)
    frame = numpy.clip(cv2.GaussianBlur(noise, (0, 0), 3) * 3 - 256, 0, 255).astype(numpy.uint8)
    return frame[:, :width], frame[:, width - overlap : 2 * width - overlap]


@pytest.mark.parametrize("overlap", [300, 1300])
def test_happy_path_a_wide_segments_overlap_beyond_its_height_share_is_found(overlap: int) -> None:
    """Scenarios: S-P01-HAPPY-CORONA-WIDE-OVERLAP"""
    # Lesson 674: an overlap of 29 % of the width lies past the former fixed reach of 1200 shrunk pixels.
    left, right = corona_pair(overlap)

    dx, dy, score = stitch.coarse_match(left, right, 1)

    assert (dx, dy) == (left.shape[1] - overlap, 0)
    assert score > 0.9


def test_bad_path_the_reach_never_passes_the_overlap_share_of_a_wide_segment() -> None:
    """Scenarios: S-P01-HAPPY-CORONA-WIDE-OVERLAP"""
    # An overlap wider than `MAX_OVERLAP_SHARE` of the segment lies outside the search: the match lands elsewhere.
    left, right = corona_pair(1700)

    dx, _dy, _score = stitch.coarse_match(left, right, 1)

    assert dx != left.shape[1] - 1700


def grainy_pair(grain: float) -> tuple[numpy.ndarray, numpy.ndarray]:
    """Two overlapping segments of a fine camera's film: a smooth scene under strong per-pixel grain (the 1966 KH-7 Gambit, 1.2 m)."""
    rng = numpy.random.default_rng(3)
    height, width, segment, overlap = 2000, 9000, 5000, 1237
    scene = cv2.GaussianBlur(rng.normal(0, 1, (height, width)).astype(numpy.float32), (0, 0), 12)
    scene = (scene - scene.mean()) / scene.std() * 30
    frame = numpy.clip(128 + scene + rng.normal(0, grain, (height, width)).astype(numpy.float32), 0, 255).astype(numpy.uint8)
    return frame[:, :segment], frame[:, segment - overlap : 2 * segment - overlap]


def test_bad_path_picked_pixels_alias_the_grain_and_a_true_pair_scores_under_the_limit() -> None:
    """Scenarios: S-P01-BAD-PICKED-PIXELS-ALIAS"""
    # Admin sweep 2026-11-14 (bug 4): the live Gambit pair matched at 0.34 shrunk by picking pixels; so does this one.
    left, right = grainy_pair(40)
    factor = 10

    _dx, _dy, score = stitch.coarse_match(
        numpy.ascontiguousarray(left[::factor, ::factor]), numpy.ascontiguousarray(right[::factor, ::factor]), factor
    )

    assert score < stitch.MIN_PAIR_SCORE


def test_happy_path_averaged_segments_match_a_grainy_true_pair_well_over_the_limit(tmp_path: Path) -> None:
    """Scenarios: S-P01-HAPPY-GRAINY-PAIR"""
    left, right = grainy_pair(40)
    factor = 10
    segments = [Segment(write_geotiff(tmp_path / f"{name}.tif", GeoTiff([part]))) for name, part in (("a", left), ("b", right))]

    dx, dy, score = stitch.coarse_match(stitch._shrunk(segments[0], factor), stitch._shrunk(segments[1], factor), factor)

    assert (dx, dy) == ((left.shape[1] - 1237) // factor, 0)
    assert score > 0.9
