"""GDAL's cache, a warp's memory and the tile processes follow the machine (reports/resource-audit.md, items 1 and 8)."""

from pathlib import Path

import numpy
import pytest
from hcm_pipeline import rasters
from hcm_pipeline.contract import SCAN_PREVIEW_MAX_PX
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import GdalMemory, GeoTiff, configure_gdal, gdal_memory, machine_memory_mb, warp_memory_mb, write_geotiff
from hcm_pipeline.steps.common import scan_preview
from hcm_pipeline.steps.pyramid import tile_processes

GIB = 2**30


def _machine(monkeypatch: pytest.MonkeyPatch, folder: Path, limit: str | None, available_kb: int | None) -> None:
    """A machine whose container says `limit` (cgroup v2) and whose `/proc/meminfo` says `available_kb`; None: no such file."""
    v2, meminfo = folder / "memory.max", folder / "meminfo"
    if limit is not None:
        v2.write_text(f"{limit}\n", encoding="ascii")
    if available_kb is not None:
        meminfo.write_text(f"MemTotal:  99999999 kB\nMemAvailable:   {available_kb} kB\n", encoding="ascii")
    monkeypatch.setattr(rasters, "CGROUP_LIMITS", (v2, folder / "v1-missing"))
    monkeypatch.setattr(rasters, "MEMINFO", meminfo)


@pytest.mark.parametrize(
    ("memory_mb", "expected"),
    [
        (4096, GdalMemory(256, 512)),
        (8192, GdalMemory(512, 1024)),
        (16384, GdalMemory(1024, 2048)),
        (65536, GdalMemory(1024, 2048)),
        (1024, GdalMemory(128, 256)),
        (None, GdalMemory(1024, 2048)),
    ],
)
def test_happy_path_the_cache_and_the_warp_follow_the_memory_given(memory_mb: int | None, expected: GdalMemory) -> None:
    """Scenarios: S-P31-HAPPY-GDAL-MEMORY"""
    assert gdal_memory(memory_mb) == expected


def test_happy_path_a_small_container_gets_small_settings_and_the_environment_overrides_them(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Scenarios: S-P31-HAPPY-GDAL-MEMORY"""
    _machine(monkeypatch, tmp_path, str(4 * GIB), 20 * 1024 * 1024)

    assert machine_memory_mb() == 4096
    assert warp_memory_mb() == 512
    # A governor's warp memory (M26) is taken when it is less, never when it is more.
    for governed, expected in (("300", 300), ("9000", 512), ("x", 512)):
        gdal.SetConfigOption("HCM_GOVERNED_WARP_MB", governed)
        assert warp_memory_mb() == expected
    gdal.SetConfigOption("HCM_GOVERNED_WARP_MB", None)
    configure_gdal("1")
    assert gdal.GetConfigOption("GDAL_CACHEMAX") == "256"

    monkeypatch.setenv("HCM_GDAL_CACHE_MB", "300")
    monkeypatch.setenv("HCM_WARP_MEMORY_MB", "700")
    configure_gdal("1")
    assert gdal.GetConfigOption("GDAL_CACHEMAX") == "300"
    assert warp_memory_mb() == 700


def test_bad_path_no_limit_a_busy_machine_an_unreadable_one_and_a_bad_override(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Scenarios: S-P31-BAD-GDAL-MEMORY-UNKNOWN"""
    # No container limit (`max`): what the machine has free decides, here 2 GB of a large machine.
    _machine(monkeypatch, tmp_path / "a", None, None)
    assert machine_memory_mb() is None
    assert warp_memory_mb() == 2048
    (tmp_path / "b").mkdir()
    _machine(monkeypatch, tmp_path / "b", "max", 2 * 1024 * 1024)
    assert machine_memory_mb() == 2048
    assert gdal_memory(machine_memory_mb()) == GdalMemory(128, 256)
    (tmp_path / "c").mkdir()
    _machine(monkeypatch, tmp_path / "c", str(8 * GIB), None)
    (tmp_path / "c" / "meminfo").write_text("MemTotal: 5 kB\n", encoding="ascii")
    assert machine_memory_mb() == 8192
    # An override that is no positive number is not taken.
    monkeypatch.setenv("HCM_GDAL_CACHE_MB", "lots")
    monkeypatch.setenv("HCM_WARP_MEMORY_MB", "0")
    assert gdal_memory(4096) == GdalMemory(256, 512)
    configure_gdal("1")


@pytest.mark.parametrize(
    ("configured", "cores", "memory_mb", "expected"),
    [
        ("ALL_CPUS", 16, 31_000, 15),
        (None, 16, 4096, 4),
        ("ALL_CPUS", 16, 2048, 2),
        ("ALL_CPUS", 4, 16_000, 3),
        ("2", 16, 31_000, 2),
        ("64", 8, None, 7),
        ("1", 16, 31_000, 1),
        ("ALL_CPUS", 1, 31_000, 1),
        ("ALL_CPUS", None, 512, 1),
        ("ALL_CPUS", 16, 100, 1),
    ],
)
def test_happy_path_tile_processes_are_capped_by_the_cores_but_one_and_the_memory(
    configured: str | None, cores: int | None, memory_mb: int | None, expected: int
) -> None:
    """Scenarios: S-P31-HAPPY-TILE-PROCESSES, S-P31-BAD-TILE-PROCESSES-SMALL"""
    assert tile_processes(configured, cores, memory_mb) == expected


def test_bad_path_a_small_or_grey_scans_preview_is_the_scan_itself_and_a_large_colour_one_is_shrunk(tmp_path: Path) -> None:
    """Scenarios: S-P31-BAD-WINDOWED-READS-SMALL"""
    grey = numpy.arange(60 * 80, dtype=numpy.uint32).reshape(60, 80).astype(numpy.uint8)
    small = write_geotiff(tmp_path / "small.tif", GeoTiff([grey]))
    wide = numpy.zeros((40, 2 * SCAN_PREVIEW_MAX_PX), numpy.uint8)
    wide[:, :SCAN_PREVIEW_MAX_PX] = 200
    colour = write_geotiff(tmp_path / "colour.tif", GeoTiff([wide, wide // 2, wide // 4]))

    same, size = scan_preview(small)
    shrunk, large = scan_preview(colour)

    assert size == (80, 60)
    assert numpy.array_equal(same, grey)
    assert large == (2 * SCAN_PREVIEW_MAX_PX, 40)
    assert shrunk.shape == (20, SCAN_PREVIEW_MAX_PX, 3)
    assert shrunk[10, 10].tolist() == [200, 100, 50]
    assert shrunk[10, -10].tolist() == [0, 0, 0]
