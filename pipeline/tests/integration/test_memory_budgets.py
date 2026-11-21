"""Budgets: a heavy call in a process of its own stays under its peak memory and CPU (reports/resource-audit.md §7).

Each figure was measured on the build machine before and after the fix it guards, and the budget lies between the two: the test
fails when the memory grows back.
"""

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Final

import pytest

PIPELINE: Final = Path(__file__).resolve().parents[2]
# 36 colour pages of 1600 by 1152 on a canvas of 9600 by 6912.
# Measured on the NUC, 2026-11-12: 1,161 MB and 20 CPU-seconds on whole canvases, 554 MB and 5 s part by part.
CANVAS_BUDGET_MB: Final = 800
CANVAS_BUDGET_CPU_S: Final = 12.0
# The same atlas from 36 colour sheets on disk, as `placing/maps.py` composes it: 602 MB with every page held in colour beside the
# canvas, 477 MB held grey and read again in colour only to paste it.
ATLAS_BUDGET_MB: Final = 550
# A 4 GB computer's worker may hold 60 % of it (`packages/admin/starter/hcm-worker.sh`): the heaviest jobs at their real sizes stay under.
SMALL_MACHINE_MB: Final = 4096 * 60 // 100
# A scan of 40,000 by 10,000 warped, then exported, each with a 4 GB machine's settings on two threads. At 70,000 by 15,000 the
# warp held 4,520 MB with the fixed settings and 1,239 MB with these; the export 1,994 MB (16 threads) and 671 MB (two).
WARP_BUDGET_MB: Final = 1500
COG_BUDGET_MB: Final = 900
# DS1103-1058DF027's city crop (35,664 by 8,172) copied out of two segments, and its preview, with a 4 GB machine's settings: 574 MB
# held as one array and resized, 460 MB copied 1,024 rows at a time (GDAL's 256 MB cache is most of what is left).
CROP_BUDGET_MB: Final = 520
# The preview of a 20,000 px colour upload: 2,720 MB read whole band by band, 479 MB read by GDAL averaged down.
PREVIEW_BUDGET_MB: Final = 1000


# The environment variables that tune GDAL, OpenCV, the BLAS and the pipeline: a probe starts without any of them. A full run's
# earlier tests (the governor's, the worker's, the archive probe's) may leave such settings behind; the budgets were measured
# without them (the colour canvas passed alone and failed in a full run, 2026-11-13).
SETTING_PREFIXES: Final = ("GDAL_", "CPL_", "VSI_", "OGR_", "OPENCV_", "OMP_", "OPENBLAS_", "MKL_", "HCM_", "MALLOC_")


def probe_env() -> dict[str, str]:
    """The probe's environment: the test run's without any setting of GDAL, OpenCV, the BLAS or the pipeline, plus the import path."""
    kept = {name: value for name, value in os.environ.items() if not name.startswith(SETTING_PREFIXES)}
    return {**kept, "PYTHONPATH": os.pathsep.join((str(PIPELINE / "src"), str(PIPELINE)))}


def probe(*arguments: str) -> dict[str, float]:
    env = probe_env()
    command = [sys.executable, "-m", "tests.budget_probe", *arguments]
    done = subprocess.run(command, cwd=PIPELINE, env=env, capture_output=True, text=True, check=True, timeout=600)
    cost: dict[str, float] = json.loads(done.stdout.splitlines()[-1])
    return cost


def test_happy_path_an_atlas_of_colour_sheets_is_composed_within_its_budget() -> None:
    """Scenarios: S-P31-HAPPY-CANVAS-BUDGET"""
    cost = probe("canvas", "36", "colour", "1600", "1152")

    assert cost["peakMb"] < CANVAS_BUDGET_MB
    assert cost["cpuS"] < CANVAS_BUDGET_CPU_S


def test_happy_path_a_warp_and_an_export_on_a_small_machine_stay_within_its_budget(tmp_path: Path) -> None:
    """Scenarios: S-P31-HAPPY-WARP-BUDGET"""
    warped = probe("warp", "40000", "10000", "4096", "2", str(tmp_path))
    exported = probe("cog", "4096", "2", str(tmp_path))

    assert warped["peakMb"] < WARP_BUDGET_MB
    assert exported["peakMb"] < COG_BUDGET_MB
    assert (tmp_path / "cog.tif").stat().st_size > 0


def test_happy_path_a_city_crop_and_an_uploads_preview_never_hold_the_raster_whole(tmp_path: Path) -> None:
    """Scenarios: S-P31-HAPPY-WINDOWED-READS"""
    cropped = probe("crop", "35664", "8172", str(tmp_path))
    previewed = probe("preview", "20000", str(tmp_path))

    assert cropped["peakMb"] < CROP_BUDGET_MB
    assert previewed["peakMb"] < PREVIEW_BUDGET_MB


def test_happy_path_an_atlas_holds_its_pages_grey_and_reads_each_in_colour_only_to_paste_it(tmp_path: Path) -> None:
    """Scenarios: S-P31-HAPPY-ATLAS-PAGES"""
    cost = probe("atlas", "36", "1600", "1152", str(tmp_path))

    assert cost["peakMb"] < ATLAS_BUDGET_MB


def test_happy_path_a_4_gb_computer_assembles_a_60_sheet_colour_atlas_and_crops_a_corona_strip_within_its_worker(tmp_path: Path) -> None:
    """Scenarios: S-P31-HAPPY-SMALL-MACHINE"""
    # 60 colour sheets at the size `maps.page_px(60)` reads them (2,222 px), and a city crop as wide as DS1103-1058DF027's window.
    atlas = probe("atlas", "60", "2222", "1600", str(tmp_path))
    strip = probe("crop", "35664", "8172", str(tmp_path))

    assert atlas["peakMb"] < SMALL_MACHINE_MB
    assert strip["peakMb"] < SMALL_MACHINE_MB


def test_bad_path_settings_an_earlier_test_left_behind_never_reach_a_probe(monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P31-BAD-GDAL-MEMORY-UNKNOWN"""
    # The colour canvas passed alone and failed in a full run (2026-11-13): a probe now starts from a known environment.
    monkeypatch.setenv("GDAL_CACHEMAX", "8000")
    monkeypatch.setenv("HCM_GDAL_CACHE_MB", "8000")
    monkeypatch.setenv("GDAL_NUM_THREADS", "ALL_CPUS")

    env = probe_env()

    assert "GDAL_CACHEMAX" not in env
    assert "HCM_GDAL_CACHE_MB" not in env
    assert "GDAL_NUM_THREADS" not in env
    assert env["PYTHONPATH"].endswith("pipeline")
