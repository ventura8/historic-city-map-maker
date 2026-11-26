"""The mosaic written in windows (docs/research/M20-import-local.md §19.6): never the whole canvas in memory."""

import os
import subprocess
import sys
from pathlib import Path

import numpy
import pytest
from hcm_pipeline.placing import canvas_window
from hcm_pipeline.placing.canvas_window import Canvas, Tile
from hcm_pipeline.raster import gdal

from tests.synthetic.sheets import SheetsSpec, make_series
from tests.synthetic.town import write_map

# The low-resource principle (M7): the worker runs in 4 GB with two cores; a 100-sheet series of 6000 px scans stays within this.
PEAK_RSS_BYTES = 1_500_000_000
# Two colour scans of 12000 x 9000 on a canvas at about their own scale: one tile in RGB and one band (about 690 MB with the
# layout), where the old paste held the whole scan at 1.05 x three times over (over 1.1 GB).
COLOUR_PEAK_RSS_BYTES = 800_000_000
# The environment variables that tune GDAL, OpenCV, the BLAS and the pipeline: a child starts without any of them.
SETTING_PREFIXES = ("GDAL_", "CPL_", "VSI_", "OGR_", "OPENCV_", "OMP_", "OPENBLAS_", "MKL_", "HCM_", "MALLOC_")


def _scan(tmp_path: Path, name: str, value: int, size: tuple[int, int] = (200, 100)) -> Path:
    picture = numpy.full((size[1], size[0], 3), value, numpy.uint8)
    picture[:, : size[0] // 2] = 255 - value
    return write_map(tmp_path / name, picture, grey=True)


def _read(path: Path) -> numpy.ndarray:
    dataset = gdal.Open(str(path))
    pixels = numpy.dstack([dataset.GetRasterBand(band).ReadAsArray() for band in range(1, dataset.RasterCount + 1)])
    dataset.Close()
    return pixels


def test_happy_path_tiles_are_pasted_turned_cropped_and_split_at_the_nearest_centre(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P20-HAPPY-STITCH-WINDOWED"""
    monkeypatch.setattr(canvas_window, "WINDOW_PX", 64)
    first = Tile(_scan(tmp_path, "a.tif", 20), (0, 0, 200, 100), 0, 0, 0, 200, 100)
    second = Tile(_scan(tmp_path, "b.tif", 200), (0, 0, 200, 100), 2, 150, 0, 200, 100)

    path = canvas_window.render([first, second], Canvas(tmp_path / "canvas.tif", (350, 120), False))

    pixels = _read(path)[:, :, 0]
    assert pixels.shape == (120, 350)
    assert (pixels[50, 10], pixels[50, 120]) == (235, 20)
    # The second scan turned half round: its light half is now on the right; the seam between them at the centres' midpoint.
    assert (pixels[50, 200], pixels[50, 340]) == (200, 55)
    assert pixels[110, 10] == canvas_window.PAPER


def test_happy_path_a_colour_canvas_keeps_three_bands_and_a_grey_scan_is_spread_over_them(tmp_path: Path) -> None:
    tile = Tile(_scan(tmp_path, "a.tif", 20), (100, 0, 200, 100), 1, 0, 0, 50, 50)

    path = canvas_window.render([tile], Canvas(tmp_path / "canvas.tif", (50, 60), True))

    pixels = _read(path)
    assert pixels.shape == (60, 50, 3)
    assert numpy.all(pixels[5:45, 5:45, 0] == 20)
    assert numpy.all(pixels[55:, :, 1] == canvas_window.PAPER)


def test_happy_path_windows_cover_a_tile_and_stop_at_the_canvas_edge() -> None:
    tile = Tile(Path("x.tif"), (0, 0, 10, 10), 0, -10, 100, 5000, 100)

    windows = list(canvas_window.windows(tile, (4100, 150)))

    assert windows == [(0, 100, 2048, 150), (2048, 100, 4096, 150), (4096, 100, 4100, 150)]
    assert not tile.meets((0, 0, 50, 50))


def test_bad_path_a_window_no_tile_covers_has_no_owner() -> None:
    tile = Tile(Path("x.tif"), (0, 0, 10, 10), 0, 0, 0, 10, 10)

    assert numpy.all(canvas_window.owners([tile], (100, 100, 108, 108)) == -1)


# The child reports its own high-water mark (`VmHWM`: `ru_maxrss` would carry over the parent's peak, which wrote the scans).
_CHILD = """
import sys
from pathlib import Path
from hcm_pipeline.heap import limit_arenas
limit_arenas()
from hcm_pipeline.placing import autostitch
from hcm_pipeline.placing.canvas_window import Canvas, render
named = [(line.split("\\t")[0], Path(line.split("\\t")[1])) for line in Path(sys.argv[1]).read_text().splitlines()]
proposal = autostitch.propose(named)
tiles, size = proposal.tiles()
render([tile for _index, tile in tiles], Canvas(Path(sys.argv[2]), size, sys.argv[3] == "colour"))
peak = next(line.split()[1] for line in Path("/proc/self/status").read_text().splitlines() if line.startswith("VmHWM:"))
print(len(proposal.solved.positions), size[0], size[1], peak)
"""


def _mosaicked(tmp_path: Path, spec: SheetsSpec, threads: str = "1") -> tuple[int, int, int, int]:
    """(sheets placed, canvas width, height, the child's peak resident memory in KiB) of laying out and mosaicking `spec`."""
    series = make_series(tmp_path / "scans", spec)
    listing = tmp_path / "named.tsv"
    listing.write_text("\n".join(f"{name}\t{path}" for name, path in series.named), encoding="utf-8")
    # GDAL's block cache as a 4 GB worker sizes it (`rasters.gdal_memory`: a sixteenth); the default would be 5 % of this machine.
    # GDAL's, OpenCV's and the pipeline's own settings are never inherited: what an earlier test of a full run left in the environment
    # would size the child differently (the colour case passed alone and failed in a full run, 2026-11-13).
    kept = {name: value for name, value in os.environ.items() if not name.startswith(SETTING_PREFIXES)}
    # The child starts as `python -m hcm_pipeline` does (`limit_arenas` first), with GDAL's threads as the governor sets them.
    env = {**kept, "PYTHONPATH": os.pathsep.join(sys.path), "GDAL_CACHEMAX": "256", "GDAL_NUM_THREADS": threads}
    command = [sys.executable, "-c", _CHILD, str(listing), str(tmp_path / "canvas.tif"), spec.style]
    done = subprocess.run(command, env=env, capture_output=True, text=True, check=True)
    placed, width, height, peak_kib = (int(value) for value in done.stdout.split())
    return placed, width, height, peak_kib


def test_happy_path_a_hundred_large_scans_are_laid_out_and_mosaicked_within_the_memory_budget(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-STITCH-WINDOWED"""
    spec = SheetsSpec(rows=10, cols=10, cell=(400, 300), overlap=0.06, names="rc", style="lineart", out_px=6000)

    placed, width, height, peak_kib = _mosaicked(tmp_path, spec)

    assert placed == 100
    assert max(width, height) <= 20_000
    assert peak_kib * 1024 <= PEAK_RSS_BYTES


@pytest.mark.parametrize("threads", ["1", "ALL_CPUS"])
def test_happy_path_large_colour_scans_cost_their_box_at_the_canvas_scale_never_the_whole_scan(tmp_path: Path, threads: str) -> None:
    """Scenarios: S-P20-HAPPY-STITCH-WINDOWED, S-P31-HAPPY-CANVAS-THREADS"""
    # One 12000 x 9000 colour scan is 324 MB as RGB; the old paste read it whole at 1.05 x and copied it three times more. On every
    # core (2026-11-13) the threads' malloc arenas kept the layout's reads: 870 MB, until the heap was given back (heap.py).
    spec = SheetsSpec(rows=1, cols=2, overlap=0.06, names="rc", style="colour", out_px=12_000)

    placed, _width, _height, peak_kib = _mosaicked(tmp_path, spec, threads)

    assert placed == 2
    assert peak_kib * 1024 <= COLOUR_PEAK_RSS_BYTES
