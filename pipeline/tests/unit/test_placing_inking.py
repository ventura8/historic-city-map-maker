"""Line art warped to a coarser grid keeps its ink (`placing/inking.py`; lesson of 2026-11-24, the plan cadastral 1911-1914)."""

from pathlib import Path

import numpy
from hcm_pipeline.placing import fullres, inking
from hcm_pipeline.placing.raster_io import Pair, WarpPlan
from hcm_pipeline.raster import gdal

from tests.unit.test_placing_fullres import write

SIZE = 400
STEP = 20


def _lines() -> numpy.ndarray:
    """White paper with one-pixel black lines every `STEP` pixels, both ways (a 1-bit plan's street lines)."""
    picture = numpy.full((SIZE, SIZE), 255, numpy.uint8)
    picture[::STEP, :] = 0
    picture[:, ::STEP] = 0
    return picture


def _warped(tmp_path: Path, nearest: bool, resolution: float) -> numpy.ndarray:
    original = write(tmp_path / "sheet.tif", _lines())
    canvas = write(tmp_path / "canvas.tif", numpy.zeros((SIZE, SIZE), numpy.uint8))
    fullres.write_parts(canvas, [fullres.Part(original, (0, 0, SIZE, SIZE), numpy.eye(3))], (SIZE, SIZE))
    plan = WarpPlan([Pair(0, 0, 0, 0), Pair(SIZE, 0, SIZE, 0), Pair(0, SIZE, 0, -SIZE)], resolution, False, nearest)
    warped = fullres.warp_composite(canvas, tmp_path / "warped.tif", plan, lambda _line: None)
    dataset = gdal.Open(str(warped))
    pixels = numpy.asarray(dataset.GetRasterBand(1).ReadAsArray())
    dataset.Close()
    return pixels


def test_happy_path_thin_lines_warped_ten_times_coarser_stay_ink(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-LINEART-INKED"""
    pixels = _warped(tmp_path, nearest=True, resolution=10.0)

    # Every second output pixel holds a line (STEP / resolution): each such row and column stays dark enough for the paper threshold.
    assert pixels.shape == (40, 40)
    assert (pixels[::2, 5:-5] < 128).all()
    assert (pixels[1::2, 1::2] > 200).all()


def test_bad_path_nearest_decimation_would_have_lost_most_of_the_lines(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-LINEART-SPECKLE"""
    lines = _lines()
    decimated = lines[5::10, 5::10]

    # What nearest did: the output pixels' centres miss the one-pixel lines, so nothing of them is left.
    assert (decimated == 255).all()
    assert inking.resampling(nearest=True, ratio=10.0) == "average"
    assert inking.resampling(nearest=True, ratio=1.5) == "near"
    assert inking.resampling(nearest=False, ratio=10.0) == "bilinear"
    assert inking.gain_of(10.0) == 6.0
    assert inking.gain_of(3.0) == 3.0
    assert inking.ratio_of([], 1.0) == 1.0
    assert inking.ratio_of([0.5, 0.25, 0.0], 1.0) == 2.6666666666666665


def test_happy_path_a_scan_near_the_output_resolution_keeps_its_crisp_pixels(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-LINEART-INKED"""
    pixels = _warped(tmp_path, nearest=True, resolution=1.0)

    assert set(numpy.unique(pixels)) <= {0, 255}
    assert (pixels[::STEP, 5:-5] == 0).all()
