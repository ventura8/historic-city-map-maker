"""One heavy call in a process of its own, and what it cost: peak memory, CPU and wall time (reports/resource-audit.md §7).

`python -m tests.budget_probe canvas <pages> <colour|grey> <page width> <page height>`: `compose_canvas` over a square atlas.
`python -m tests.budget_probe warp <width> <height> <memory MB|machine> <threads> <folder>`: a synthetic scan through a thin-plate
warp, with the settings `gdal_memory` gives a process that may use that much; `cog <memory MB|machine> <threads> <folder>`: that
warp's output exported as a COG; `tiles <processes> <folder>`: it cut into tiles by that many processes.
`crop <width> <height> <folder>`: a city crop of that size copied out of two segments (`locate.write_crop`) and its preview;
`atlas <pages> <width> <height> <folder> [held]`: that many colour sheets on disk composed as an atlas is (`held`: every page
held beside the canvas, as before); `preview <side> <folder>`: the preview of a square colour upload of that side (`common.scan_preview`).
The answer is one JSON line: `peakMb` (this process), `childMb` (its largest child: a tile process), `cpuS`, `wallS`.
The budget tests (`tests/integration/test_memory_budgets.py`) run it small; the audit's figures come from it at the audit's sizes.
"""

import json
import math
import resource
import sys
import time
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Final, cast

import numpy
from hcm_pipeline import rasters
from hcm_pipeline.frames import FrameLayout, Placement
from hcm_pipeline.georef.corners import Crop
from hcm_pipeline.jobs import JobContext
from hcm_pipeline.placing import assemble
from hcm_pipeline.placing.raster_io import read_working
from hcm_pipeline.raster import gdal
from hcm_pipeline.steps.common import scan_preview
from hcm_pipeline.steps.locate import write_crop

LATTICE: Final = 17
# About 2.4 m a scan pixel around Bucharest, slightly rotated: the audit's scan.
RESOLUTION_M: Final = 2.4
ORIGIN: Final = (2_900_000.0, 5_550_000.0)
COG_OPTIONS: Final = ("COMPRESS=JPEG", "QUALITY=85", "BLOCKSIZE=512", "OVERVIEWS=AUTO")
MACHINE: Final = "machine"


def canvas(count: int, colour: bool, page: tuple[int, int]) -> None:
    width, height = page
    side = math.ceil(math.sqrt(count))
    rng = numpy.random.default_rng(1)
    pages = [rng.integers(0, 255, (height, width, 3) if colour else (height, width), numpy.uint8) for _ in range(count)]
    placed = {index: numpy.array([[1.0, 0.0, (index % side) * width], [0.0, 1.0, (index // side) * height]]) for index in range(count)}
    assemble.compose_canvas(pages, assemble.Layout(placed, (side * width, math.ceil(count / side) * height)))


def _sheets(count: int, page: tuple[int, int], folder: Path) -> list[Path]:
    width, height = page
    rng = numpy.random.default_rng(3)
    paths = []
    for index in range(count):
        pixels = rng.integers(0, 255, (height, width), numpy.uint8)
        paths.append(rasters.write_geotiff(folder / f"sheet-{index:03d}.tif", rasters.GeoTiff([pixels, pixels // 2, pixels // 3])))
    return paths


def atlas(count: int, page: tuple[int, int], folder: Path, held: bool) -> None:
    """An atlas of `count` colour sheets on disk, laid out on a square and composed as `placing/maps.py` does (`held`: every colour
    page read and held beside the canvas, as before 2026-11-12)."""
    width, height = page
    paths = _sheets(count, page, folder)
    side = math.ceil(math.sqrt(count))
    placed = {index: numpy.array([[1.0, 0.0, (index % side) * width], [0.0, 1.0, (index // side) * height]]) for index in range(count)}
    layout = assemble.Layout(placed, (side * width, math.ceil(count / side) * height))
    if held:
        assemble.compose_canvas([assemble.frame_crop(read_working(path, max(page)).image) for path in paths], layout)
        return
    pages = assemble.Pages.read(paths, max(page))
    assemble.compose_parts(pages.page, [(each.shape[1], each.shape[0]) for each in pages.grey], pages.colour, layout)


def _scan(path: Path, width: int, height: int) -> None:
    dataset = rasters.driver_of("GTiff").Create(str(path), width, height, 1, gdal.GDT_Byte, list(rasters.GTIFF_OPTIONS))
    rng = numpy.random.default_rng(2)
    for top in range(0, height, 1024):
        rows = min(1024, height - top)
        low = rng.integers(0, 255, (rows // 8 + 1, width // 8 + 1), numpy.uint8)
        strip = numpy.repeat(numpy.repeat(low, 8, 0), 8, 1)[:rows, :width] // 2 + rng.integers(0, 127, (rows, width), numpy.uint8)
        dataset.GetRasterBand(1).WriteArray(strip, 0, top)
    dataset.Close()


def _gcps(width: int, height: int) -> list[gdal.GCP]:
    found = []
    for row in range(LATTICE):
        for column in range(LATTICE):
            x, y = column * width / (LATTICE - 1), row * height / (LATTICE - 1)
            east = ORIGIN[0] + x * RESOLUTION_M * 0.999 + y * RESOLUTION_M * 0.03
            north = ORIGIN[1] - y * RESOLUTION_M * 0.999 + x * RESOLUTION_M * 0.03
            found.append(gdal.GCP(east, north, 0.0, x, y))
    return found


def _settings(memory: str, threads: str) -> rasters.GdalMemory:
    """GDAL set up as `gdal_memory` says for a process that may use `memory` MB (`machine`: unknown, a large machine's)."""
    settings = rasters.gdal_memory(None if memory == MACHINE else int(memory))
    rasters.configure_gdal(threads)
    gdal.SetConfigOption("GDAL_CACHEMAX", str(settings.cache_mb))
    return settings


def warp(size: tuple[int, int], memory: str, threads: str, folder: Path) -> None:
    """The scan made (its cost is not the warp's: made by an earlier call when it is there) and warped through a thin plate."""
    scan, view = folder / "scan.tif", folder / "scan-gcps.vrt"
    if not scan.exists():
        _scan(scan, *size)
    settings = _settings(memory, threads)
    gdal.Translate(str(view), str(scan), format="VRT", GCPs=_gcps(*size), outputSRS="EPSG:3857").Close()
    gdal.Warp(
        str(folder / "warped.tif"),
        str(view),
        dstSRS="EPSG:3857",
        xRes=RESOLUTION_M,
        yRes=RESOLUTION_M,
        targetAlignedPixels=True,
        resampleAlg="bilinear",
        dstAlpha=True,
        multithread=True,
        warpMemoryLimit=settings.warp_mb,
        creationOptions=list(rasters.GTIFF_OPTIONS),
        tps=True,
    ).Close()


def cog(memory: str, threads: str, folder: Path) -> None:
    """The warped scan of `warp` exported as the COG a version keeps."""
    _settings(memory, threads)
    gdal.Translate(str(folder / "cog.tif"), str(folder / "warped.tif"), format="COG", creationOptions=list(COG_OPTIONS)).Close()


def tiles(processes: int, folder: Path) -> None:
    rasters.configure_gdal()
    view = folder / "rgba.vrt"
    bands = ["-b", "1", "-b", "1", "-b", "1", "-b", "2", "-colorinterp", "red,green,blue,alpha"]
    gdal.Translate(str(view), str(folder / "warped.tif"), options=["-of", "VRT", *bands]).Close()
    arguments: dict[str, object] = {
        "input": str(view),
        "output": str(folder / f"tree-{processes}"),
        "output-format": "WEBP",
        "min-zoom": 10,
        "max-zoom": 16,
        "tile-size": 256,
        "skip-blank": True,
        "resampling": "bilinear",
        "webviewer": "none",
        "num-threads": processes,
    }
    gdal.Run(["raster", "tile"], arguments=arguments)


class _Staged:
    """What `write_crop` asks of a run, over files already on the disk."""

    def stage(self, object_path: str) -> Path:
        return Path(object_path)

    def unstage(self, object_path: str) -> None:
        """Nothing was staged."""

    def checkpoint(self) -> None:
        """No run to stop."""


def crop(size: tuple[int, int], folder: Path) -> None:
    """Two segments side by side, each half the crop and a tenth more, and the crop over both written and previewed."""
    width, height = size
    half = width // 2 + width // 10
    paths = [folder / "segment-a.tif", folder / "segment-b.tif"]
    for path in paths:
        _scan(path, half, height)
    placements = (Placement(str(paths[0]), 0, 0, half, height), Placement(str(paths[1]), width - half, 0, half, height))
    layout = FrameLayout(width, height, 1, placements)
    _settings("4096", "2")
    written = write_crop(cast(JobContext, _Staged()), layout, Crop(0, 0, width, height, ()), folder / "scan.tif")
    scan_preview(written)


def preview(side: int, folder: Path) -> None:
    """A colour upload nobody wrote a pixel of (GDAL reads it as it would any other) and its preview."""
    upload = folder / "upload.tif"
    _settings("4096", "2")
    rasters.driver_of("GTiff").Create(str(upload), side, side, 3, gdal.GDT_Byte, list(rasters.GTIFF_OPTIONS)).Close()
    scan_preview(upload)


def _run(arguments: Sequence[str]) -> None:
    what, rest = arguments[0], arguments[1:]
    calls: dict[str, Callable[[], None]] = {
        "canvas": lambda: canvas(int(rest[0]), rest[1] == "colour", (int(rest[2]), int(rest[3]))),
        "atlas": lambda: atlas(int(rest[0]), (int(rest[1]), int(rest[2])), Path(rest[3]), rest[4:] == ["held"]),
        "warp": lambda: warp((int(rest[0]), int(rest[1])), rest[2], rest[3], Path(rest[4])),
        "cog": lambda: cog(rest[0], rest[1], Path(rest[2])),
        "crop": lambda: crop((int(rest[0]), int(rest[1])), Path(rest[2])),
        "preview": lambda: preview(int(rest[0]), Path(rest[1])),
        "tiles": lambda: tiles(int(rest[0]), Path(rest[1])),
    }
    calls[what]()


def _peak_mb() -> int:
    """This process's own peak resident memory (`VmHWM`). Not `getrusage`: Linux carries the peak of the process that started this one
    across `exec`, so a probe started from a large pytest reported pytest's peak (2,105 MB for every probe, 2026-11-12)."""
    for line in Path("/proc/self/status").read_text(encoding="ascii").splitlines():
        if line.startswith("VmHWM:"):
            return round(int(line.split()[1]) / 1024)
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024)


def main(arguments: Sequence[str]) -> int:
    started, cpu = time.monotonic(), time.process_time()
    _run(arguments)
    cost = {
        "peakMb": _peak_mb(),
        "childMb": round(resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 1024),
        "cpuS": round(time.process_time() - cpu, 1),
        "wallS": round(time.monotonic() - started, 1),
    }
    sys.stdout.write(json.dumps(cost) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
