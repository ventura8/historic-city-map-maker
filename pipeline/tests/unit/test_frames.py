"""A frame stitched and cropped window by window, never whole in memory (finding 57 of 2026-11-01)."""

import tracemalloc
from pathlib import Path
from typing import cast

import cv2
import numpy
import pytest
from hcm_pipeline.frames import FrameLayout, Placement, Segment
from hcm_pipeline.georef.corners import Crop
from hcm_pipeline.jobs import JobContext
from hcm_pipeline.objects import ObjectInfo
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import GeoTiff, read_band, write_geotiff
from hcm_pipeline.runner import RunOutcome
from hcm_pipeline.steps import stitch
from hcm_pipeline.steps.locate import camera_of, film_limits, scoring_frame, write_crop

from tests.fakes.world import CITY, JOB_ID, PipelineWorld

WORK = f"work/{CITY}/{JOB_ID}/"
HEIGHT, SEGMENT_WIDTH, STEP = 4000, 1000, 800
# Finding 76's copy of a strip inside the left segment.
DECOY = 196
SEGMENTS = 6


def scan() -> numpy.ndarray:
    """A textured film frame: blurred noise, so every overlap has one best match."""
    noise = numpy.random.default_rng(57).integers(0, 256, (HEIGHT, STEP * (SEGMENTS - 1) + SEGMENT_WIDTH), dtype=numpy.uint8)
    return numpy.asarray(cv2.GaussianBlur(noise, (5, 5), 0), numpy.uint8)


def tiff(tmp_path: Path, pixels: numpy.ndarray, name: str) -> bytes:
    return write_geotiff(tmp_path / name, GeoTiff([pixels]), ("TILED=YES",)).read_bytes()


def segmented(world: PipelineWorld, tmp_path: Path, frame: numpy.ndarray) -> None:
    for index in range(SEGMENTS):
        part = frame[:, index * STEP : index * STEP + SEGMENT_WIDTH]
        world.gcs.put(f"{WORK}segments/{chr(ord('a') + index)}.tif", tiff(tmp_path, numpy.ascontiguousarray(part), f"{index}.tif"))


def test_happy_path_a_frame_larger_than_the_memory_it_uses_is_stitched_exactly(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P01-HAPPY-BOUNDED-MEMORY"""
    # The preview's cap scaled as the frame is (16384 px of a KH-9 frame's 300 000): a small share of the frame.
    monkeypatch.setattr(stitch, "PREVIEW_MAX_PX", 1024)
    frame = scan()
    segmented(world, tmp_path, frame)
    world.seed_import()

    peaks: list[int] = []
    publish = JobContext.publish

    def measured(ctx: JobContext, local: Path, object_path: str, content_type: str) -> ObjectInfo:
        # The in-process fake bucket's own upload handling is no memory of the pipeline's: measured up to it, then past it.
        peaks.append(tracemalloc.get_traced_memory()[1])
        info = publish(ctx, local, object_path, content_type)
        tracemalloc.reset_peak()
        return info

    monkeypatch.setattr(JobContext, "publish", measured)
    tracemalloc.start()
    outcome = world.runner().run("stitch")
    peak = max([*peaks, tracemalloc.get_traced_memory()[1]])
    tracemalloc.stop()

    assert outcome is RunOutcome.DONE
    layout = FrameLayout.from_json(world.gcs.objects[f"{WORK}frame.json"].data.decode())
    assert [(placement.x, placement.y) for placement in layout.placements] == [(index * STEP, 0) for index in range(SEGMENTS)]
    assert (layout.width, layout.height) == (frame.shape[1], HEIGHT)
    # The old step held every segment and the joined frame (over 2.5 times the frame); this one two segments' windows.
    assert peak < frame.nbytes / 2
    assert f"{WORK}frame-preview.tif" in world.gcs.objects


def test_bad_path_a_copy_of_the_strip_deep_inside_the_left_segment_is_not_where_the_right_one_starts(tmp_path: Path) -> None:
    """Scenarios: S-P01-BAD-STITCH-DECOY"""
    frame = scan()
    left, right = frame[:, :SEGMENT_WIDTH].copy(), frame[:, STEP : STEP + SEGMENT_WIDTH].copy()
    # The right segment's left strip again at a fifth of the left one (an overlap of 80 %), exactly; the true overlap grainy,
    # as a scan's is, so a search across the whole segment prefers the copy.
    left[:, DECOY : DECOY + 300] = right[:, :300]
    grain = numpy.random.default_rng(76).integers(-60, 61, left[:, STEP:].shape)
    left[:, STEP:] = numpy.clip(left[:, STEP:].astype(numpy.int16) + grain, 0, 255).astype(numpy.uint8)
    paths = [tmp_path / name for name in ("a.tif", "b.tif")]
    for path, pixels in zip(paths, (left, right), strict=True):
        path.write_bytes(tiff(tmp_path, numpy.ascontiguousarray(pixels), f"{path.stem}-src.tif"))
    segments = [Segment(path) for path in paths]

    offset = stitch.pair_offset(*segments)
    for segment in segments:
        segment.close()

    assert offset == (STEP, 0)


def test_bad_path_a_copy_of_the_strip_far_above_its_place_is_not_where_the_right_one_starts(tmp_path: Path) -> None:
    """Scenarios: S-P01-BAD-STITCH-VERTICAL"""
    frame = scan()
    left, right = frame[:, :SEGMENT_WIDTH].copy(), frame[:, STEP : STEP + SEGMENT_WIDTH].copy()
    # In the overlap's own columns but 8 % of the height higher: a false step like the 1972 frame's (finding 83).
    jump = HEIGHT * 8 // 100
    left[: HEIGHT - jump, STEP:] = right[jump:, : SEGMENT_WIDTH - STEP]
    paths = [tmp_path / name for name in ("a.tif", "b.tif")]
    for path, pixels in zip(paths, (left, right), strict=True):
        path.write_bytes(tiff(tmp_path, numpy.ascontiguousarray(pixels), f"{path.stem}-src.tif"))
    segments = [Segment(path) for path in paths]

    _dx, dy = stitch.pair_offset(*segments)
    for segment in segments:
        segment.close()

    assert abs(dy) <= HEIGHT * 3 // 100


def test_happy_path_the_preview_averages_what_it_shrinks_and_the_matching_does_not(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P01-HAPPY-AVERAGED-PREVIEW"""
    # Film grain at its finest: every other column black or white. Picking pixels gives one of the two, the average the mean.
    grain = numpy.zeros((1600, 1600), numpy.uint8)
    grain[:, ::2] = 200
    path = tmp_path / "grain.tif"
    path.write_bytes(tiff(tmp_path, grain, "grain-src.tif"))
    segment = Segment(path)

    picked = segment.read(0, 0, 1600, 1600, (200, 200))
    averaged = segment.averaged((200, 200))
    segment.close()

    assert averaged.shape == picked.shape == (200, 200)
    assert int(averaged.min()) == int(averaged.max()) == 100
    assert int(picked.max() - picked.min()) == 0
    assert int(picked.max()) in (0, 200)


def test_happy_path_a_stitched_frame_records_where_its_exposure_ends_and_its_preview_is_averaged(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P01-HAPPY-AVERAGED-PREVIEW"""
    monkeypatch.setattr(stitch, "PREVIEW_MAX_PX", 1024)
    frame = scan()
    # The exposure stops at column 4500: a dark gap after the last overlap, then a fragment of the next exposure, as on the 1972 frame.
    frame[:, 4500:4600] = 0
    segmented(world, tmp_path, frame)
    world.seed_import()

    assert world.runner().run("stitch") is RunOutcome.DONE

    layout = FrameLayout.from_json(world.gcs.objects[f"{WORK}frame.json"].data.decode())
    assert layout.width == frame.shape[1]
    assert layout.image_end == pytest.approx(4500, abs=2 * layout.preview_factor)
    assert layout.image_start == 0
    assert layout.image_width == layout.image_end


def test_happy_path_a_film_scanned_the_other_way_records_where_its_exposure_starts(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P01-HAPPY-EXPOSURE-SPAN"""
    monkeypatch.setattr(stitch, "PREVIEW_MAX_PX", 1024)
    frame = scan()
    # The fragment and its gap first, as an aft camera's frame or a turned scan holds them.
    frame[:, 300:400] = 0
    segmented(world, tmp_path, frame)
    world.seed_import()

    assert world.runner().run("stitch") is RunOutcome.DONE

    layout = FrameLayout.from_json(world.gcs.objects[f"{WORK}frame.json"].data.decode())
    assert layout.image_start == pytest.approx(400, abs=2 * layout.preview_factor)
    assert layout.image_end is None
    assert layout.image_width == layout.width - layout.image_start


def test_happy_path_a_frame_without_a_gap_ends_at_its_width_and_old_files_read_the_same() -> None:
    """Scenarios: S-P01-HAPPY-AVERAGED-PREVIEW"""
    whole = numpy.full((40, 400), 120, numpy.uint8)
    # A dark column run shorter than the share is a shadow, not the end.
    whole[:, 300:302] = 0
    assert stitch.exposure_span(whole) is None

    old = FrameLayout.from_json('{"width": 400, "height": 40, "preview_factor": 1, "placements": []}')
    assert old.image_end is None
    assert old.image_start == 0
    assert old.image_width == 400
    assert old.exposure == (0, 400)
    written = FrameLayout.from_json(FrameLayout(400, 40, 1, (), 320, 30).to_json())
    assert (written.image_width, written.exposure) == (290, (30, 320))
    assert FrameLayout.from_json(FrameLayout(400, 40, 1, (), None, 30).to_json()).exposure == (30, 400)


def strip_with(*gaps: tuple[int, int]) -> numpy.ndarray:
    """A bright film of 10 000 columns with dark columns at `gaps`."""
    strip = numpy.full((20, 10000), 120, numpy.uint8)
    for start, end in gaps:
        strip[:, start:end] = 0
    return strip


def test_happy_path_the_exposure_is_found_whichever_way_the_film_was_scanned() -> None:
    """Scenarios: S-P01-HAPPY-EXPOSURE-SPAN"""
    # As the 1972 frame: the exposure, a dark gap of 2 %, a fragment of 5 % of the next exposure.
    scanned = strip_with((9300, 9500))

    assert stitch.exposure_span(scanned) == (0, 9300)
    assert stitch.exposure_span(scanned[::-1]) == (0, 9300)
    assert stitch.exposure_span(scanned[:, ::-1]) == (700, 10000)
    assert stitch.exposure_span(scanned[::-1, ::-1]) == (700, 10000)
    # Fragments on both sides.
    assert stitch.exposure_span(strip_with((500, 700), (9300, 9500))) == (700, 9300)


@pytest.mark.parametrize(
    ("gaps", "span"),
    [
        # A dark band with more film after it than a fragment is not the end of the exposure: a sea, a cloud's shadow.
        (((7000, 8500),), None),
        (((6000, 6200),), None),
        # ... and it does not hide the real gap after it.
        (((6000, 6200), (9300, 9500)), (0, 9300)),
        (((1500, 3000),), None),
        # A run that takes the middle of the film leaves no exposure to squeeze the frame into.
        (((500, 9500),), None),
    ],
)
def test_bad_path_a_dark_band_inside_the_film_does_not_end_the_exposure(
    gaps: tuple[tuple[int, int], ...], span: tuple[int, int] | None
) -> None:
    """Scenarios: S-P01-BAD-EXPOSURE-DARK-BAND"""
    assert stitch.exposure_span(strip_with(*gaps)) == span


def test_happy_path_the_scoring_frame_shrinks_a_preview_but_never_enlarges_it(tmp_path: Path) -> None:
    """Scenarios: S-P01-HAPPY-AVERAGED-PREVIEW"""
    pixels = numpy.random.default_rng(5).integers(0, 256, (100, 800), dtype=numpy.uint8)
    preview = tmp_path / "preview.tif"
    preview.write_bytes(tiff(tmp_path, pixels, "preview-src.tif"))

    shrunk = scoring_frame(preview, 8000, 1000, 6.0)
    kept = scoring_frame(preview, 8000, 1000, 0.5)
    fine = scoring_frame(preview, 8000, 1000, 30.0)

    assert shrunk.pixels.shape == (100, 800)
    assert (shrunk.factor, shrunk.width, shrunk.height) == (10.0, 8000, 1000)
    assert kept.pixels.shape == (17, 133)
    assert kept.factor == pytest.approx(8000 / 133)
    # Finer than the scoring cell by its corners, a frame is not enlarged past its preview (cv2.remap's limit, the 1972 frame's 2 m).
    assert fine.pixels.shape == (100, 800)
    # Averaged, no further blur: what the votes read stays sharp, and the preview itself is not touched at its own size.
    assert fine.pixels.std() == pytest.approx(float(pixels.std()))


def test_happy_path_a_segment_window_is_read_averaged(tmp_path: Path) -> None:
    """Scenarios: S-P06-HAPPY-VOTES"""
    path = tmp_path / "averaged.tif"
    path.write_bytes(tiff(tmp_path, numpy.array([[0, 100, 200, 200], [100, 200, 200, 200]]), "averaged-src.tif"))
    segment = Segment(path)

    pixels = segment.averaged_window(0, 0, 4, 2, (2, 1))
    segment.close()

    assert pixels.tolist() == [[100, 200]]


def test_happy_path_only_a_camera_with_a_half_angle_has_a_panoramic_model() -> None:
    """Scenarios: S-P01-HAPPY-PANORAMIC-LOCATE"""
    layout = FrameLayout(494445, 21984, 32, (), 459808)

    camera = camera_of("KH-9-pan", layout)

    assert camera is not None
    assert (camera.half_angle_deg, camera.image_width, camera.image_start) == (60.5, 459808, 0)
    assert camera_of("KH-4A", layout) is None
    # A crop stays on the exposure of a frame with a panoramic model, and on the whole frame of any other.
    assert film_limits(camera, layout) == (459808, 21984, 0)
    assert film_limits(None, layout) == (494445, 21984, 0)
    turned = camera_of("KH-9-pan", FrameLayout(494445, 21984, 32, (), None, 34624))
    assert turned is not None
    assert (turned.image_width, turned.image_start) == (459821, 34624)
    assert film_limits(turned, layout) == (494445, 21984, 34624)


class Staging:
    """What `write_crop` asks of a run: each segment staged on demand and let go."""

    def __init__(self, files: dict[str, Path]) -> None:
        self.files = files
        self.staged: list[str] = []
        self.let_go: list[str] = []

    def stage(self, object_path: str) -> Path:
        self.staged.append(object_path)
        return self.files[object_path]

    def unstage(self, object_path: str) -> None:
        self.let_go.append(object_path)

    def checkpoint(self) -> None:
        return None


def test_bad_path_a_crop_across_two_segments_reads_both_and_one_past_them_stays_black(tmp_path: Path) -> None:
    """Scenarios: S-P01-BAD-CROP-ACROSS-SEGMENTS"""
    frame = numpy.arange(40 * 60, dtype=numpy.uint32).reshape(40, 60).astype(numpy.uint16) * 7
    left, right = frame[:, :36], frame[:, 30:]
    files = {"a": write_geotiff(tmp_path / "a.tif", GeoTiff([left.astype(numpy.uint8)])), "b": tmp_path / "b.tif"}
    # The right segment is 16-bit: read through its own linear stretch to 8 bits.
    driver = gdal.GetDriverByName("GTiff")
    assert driver is not None
    dataset = driver.Create(str(files["b"]), right.shape[1], right.shape[0], 1, gdal.GDT_UInt16)
    dataset.GetRasterBand(1).WriteArray(right)
    dataset.Close()
    layout = FrameLayout(60, 40, 1, (Placement("a", 0, 0, 36, 40), Placement("b", 30, 0, 30, 40)))
    staging = Staging(files)

    across = read_band(write_crop(cast(JobContext, staging), layout, Crop(20, 5, 20, 10, ()), tmp_path / "across.tif"))
    beyond = read_band(write_crop(cast(JobContext, staging), layout, Crop(60, 0, 4, 4, ()), tmp_path / "beyond.tif"))

    stretched = Segment(files["b"]).read(0, 5, 10, 10)
    assert numpy.array_equal(across[:, :10], left.astype(numpy.uint8)[5:15, 20:30])
    assert numpy.array_equal(across[:, 10:], stretched)
    assert staging.staged == ["a", "b"]
    assert staging.let_go == staging.staged
    assert (beyond.shape, int(beyond.max())) == ((4, 4), 0)
