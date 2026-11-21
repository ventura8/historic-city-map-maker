"""The reference guard (docs/research/M15-calibration-accuracy.md, *The reference guard*): no Sentinel-2 date moves a city silently.

Synthetic scenes are one texture placed rigidly off by known ground metres, written in the UTM zone a real tile would use: over
Bucharest, Svalbard (78° N), Ushuaia (55° S) and on the equator across the seam of zones 17 and 18 (a set mosaicked from both).
"""

import functools
import math
from itertools import combinations
from pathlib import Path
from types import SimpleNamespace
from typing import cast

import cv2
import numpy
import pytest
from hcm_pipeline import agreement
from hcm_pipeline.agreement import (
    REJECT_M,
    ZERO,
    Offset,
    Patch,
    candidates,
    decide,
    pair_offset,
    patch_half_m,
    patch_of,
    placed,
    read_patch,
    readings,
)
from hcm_pipeline.geo import Bounds
from hcm_pipeline.images import UInt8Array
from hcm_pipeline.jobs import JobContext
from hcm_pipeline.raster import gdal
from hcm_pipeline.stac import StacItem
from hcm_pipeline.steps.common import CHECK_METADATA, _report, _stored_check

MASTER_M = 5.0
MASTER_HALF_M = 6500.0
WINDOW_HALF_M = 6000.0
TOLERANCE_M = 0.5


@functools.cache
def texture(seed: int, size: int) -> UInt8Array:
    """A field and street pattern at 5 m: smoothed noise with sharp blocks, 1 to 255 (0 is no data)."""
    rng = numpy.random.default_rng(seed)
    image = cv2.GaussianBlur(rng.normal(0, 1, (size, size)).astype(numpy.float32), (0, 0), 3.0) * 60
    for _ in range(size // 6):
        row, column = rng.integers(0, size - 40, 2).tolist()
        side = int(rng.integers(8, 40))
        image[row : row + side, column : column + side] = image[row : row + side, column : column + side] + float(rng.normal(0, 40))
    return numpy.clip(image + 128, 1, 255).astype(numpy.uint8)


def window(lng: float, lat: float, half_m: float = WINDOW_HALF_M) -> Bounds:
    dlat = half_m / 111_320.0
    dlng = half_m / (111_320.0 * math.cos(math.radians(lat)))
    return Bounds(lng - dlng, lat - dlat, lng + dlng, lat + dlat)


Where = tuple[tuple[float, float], int]


def scene(folder: Path, name: str, where: Where, shift: tuple[float, float], keep: str = "all") -> str:
    """The texture moved `shift` ground metres (east, north) and written at 10 m in the zone of `where` (centre, EPSG); `keep` 'west'
    or 'east' leaves the other half without data (one part of a mosaic)."""
    centre, epsg = where
    pixels = texture(7, round(2 * MASTER_HALF_M / MASTER_M)).copy()
    side = pixels.shape[1] // 2
    if keep == "west":
        pixels[:, side:] = 0
    elif keep == "east":
        pixels[:, :side] = 0
    driver = gdal.GetDriverByName("MEM")
    assert driver is not None
    master = driver.Create("", pixels.shape[1], pixels.shape[0], 3, gdal.GDT_Byte)
    master.SetProjection(agreement.local_grid(*centre))
    master.SetGeoTransform((-MASTER_HALF_M + shift[0], MASTER_M, 0, MASTER_HALF_M + shift[1], 0, -MASTER_M))
    for band in range(1, 4):
        master.GetRasterBand(band).WriteArray(pixels)
    path = str(folder / f"{name}.tif")
    options = {"dstSRS": f"EPSG:{epsg}", "xRes": 10.0, "yRes": 10.0, "resampleAlg": "bilinear", "srcNodata": 0, "dstNodata": 0}
    gdal.Warp(path, master, **options).Close()
    return path


def verdict_of(sources: list[list[str]], bounds: Bounds) -> agreement.Agreement:
    patches = [read_patch(paths, bounds) for paths in sources]
    return decide(len(patches), readings(patches))


def item(item_id: str, date: str, cloud: float = 1.0, bbox: tuple[float, float, float, float] = (25, 44, 27, 45)) -> StacItem:
    return StacItem(item_id, date, cloud, f"https://x/{item_id}.tif", bbox)


BUCHAREST = (26.1, 44.44)


def test_happy_path_the_least_cloudy_date_that_agrees_with_the_others_is_the_reference(tmp_path: Path) -> None:
    """Scenarios: S-P06-HAPPY-REFERENCE-AGREEMENT"""
    shifts = [(0.0, 0.8), (1.0, -1.0), (-0.5, 0.5), (0.0, 0.0), (0.4, -2.0)]
    paths = [[scene(tmp_path, f"s{index}", (BUCHAREST, 32635), shift)] for index, shift in enumerate(shifts)]

    verdict = verdict_of(paths, window(*BUCHAREST))

    middle = Offset(float(numpy.median([s[0] for s in shifts])), float(numpy.median([s[1] for s in shifts])))
    assert (verdict.status, verdict.chosen, verdict.kept) == ("agreed", 0, (True,) * 5)
    for offset, (east, north) in zip(verdict.offsets, shifts, strict=True):
        assert offset is not None
        assert abs(offset.east - (east - middle.east)) < TOLERANCE_M
        assert abs(offset.north - (north - middle.north)) < TOLERANCE_M


def test_bad_path_a_date_twelve_metres_south_is_rejected_and_the_next_that_agrees_is_the_reference(tmp_path: Path) -> None:
    """Scenarios: S-P06-BAD-REFERENCE-SHIFTED-DATE"""
    shifts = [(0.0, -12.0), (0.0, 0.0), (0.6, 0.4), (-0.3, -0.6), (0.2, 0.9)]
    paths = [[scene(tmp_path, f"s{index}", (BUCHAREST, 32635), shift)] for index, shift in enumerate(shifts)]

    verdict = verdict_of(paths, window(*BUCHAREST))

    first = verdict.offsets[0]
    assert (verdict.status, verdict.chosen, verdict.kept) == ("agreed", 1, (False, True, True, True, True))
    assert first is not None
    assert abs(first.north + 12.0) < TOLERANCE_M + 0.4


def test_bad_path_two_shifted_dates_of_five_are_both_rejected_once_the_consensus_is_centred_again() -> None:
    """Scenarios: S-P06-BAD-REFERENCE-SHIFTED-DATE"""
    places = [Offset(0.0, -12.7), Offset(0.0, 0.0), Offset(0.0, -9.9), Offset(0.0, -3.1), Offset(0.0, 1.3)]
    measured = {(i, j): Offset(b.east - a.east, b.north - a.north) for (i, a), (j, b) in combinations(enumerate(places), 2)}

    verdict = decide(5, measured)

    # A plain median of the five sits at -3.1 m, which would keep the date at -9.9 (6.8 m from it).
    assert (verdict.status, verdict.chosen, verdict.kept) == ("agreed", 1, (False, True, False, True, True))


@pytest.mark.parametrize(
    ("centre", "zones"),
    [
        pytest.param((15.6, 78.22), (32633,), id="svalbard-78N"),
        pytest.param((-68.3, -54.8), (32719,), id="ushuaia-55S"),
        pytest.param((-78.0, -0.2), (32717, 32718), id="equator-across-zones-17-and-18"),
    ],
)
def test_happy_path_any_latitude_and_a_set_mosaicked_across_utm_zones_read_in_ground_metres(
    tmp_path: Path, centre: tuple[float, float], zones: tuple[int, ...]
) -> None:
    """Scenarios: S-P06-HAPPY-REFERENCE-ANY-LATITUDE"""
    shifts = [(3.0, -10.0), (0.0, 0.0), (0.0, 0.0), (0.0, 0.0)]
    halves = ("west", "east") if len(zones) > 1 else ("all",)
    paths = [
        [scene(tmp_path, f"s{index}-{part}", (centre, zone), shift, part) for zone, part in zip(zones, halves, strict=True)]
        for index, shift in enumerate(shifts)
    ]

    verdict = verdict_of(paths, window(*centre))

    first = verdict.offsets[0]
    assert (verdict.status, verdict.chosen, verdict.kept) == ("agreed", 1, (False, True, True, True))
    assert first is not None
    assert math.hypot(first.east - 3.0, first.north + 10.0) < 2 * TOLERANCE_M


def test_happy_path_candidates_are_covering_sets_a_month_apart_least_cloudy_first() -> None:
    """Scenarios: S-P06-HAPPY-REFERENCE-AGREEMENT"""
    bounds = window(*BUCHAREST)
    dates = ["2026-08-17", "2024-10-26", "2024-10-21", "2026-08-30", "2025-01-19"]
    items = [item(f"d{index}", date, index) for index, date in enumerate(dates)]
    items += [item("z", "garbage", 9), *(item(f"late{index}", f"2023-0{index + 1}-15", 10 + index) for index in range(4))]

    found = candidates(items, bounds)

    assert [[part.id for part in chosen] for chosen in found] == [["d0"], ["d1"], ["d4"], ["z"], ["late0"]]
    assert candidates([item("away", "2026-08-17", 1, (0, 0, 1, 1))], bounds) == []


def test_bad_path_too_few_dates_are_unchecked_and_a_majority_that_disagrees_is_disputed() -> None:
    """Scenarios: S-P06-BAD-REFERENCE-TOO-FEW"""
    lone = decide(1, {})
    two = decide(3, {(1, 2): Offset(0.0, 12.0)})
    apart = {(0, 1): Offset(0.0, 20.0), (0, 2): Offset(20.0, 0.0), (1, 2): Offset(20.0, -20.0)}

    assert (lone.status, lone.chosen, lone.offsets, lone.kept) == ("unchecked", 0, (None,), (True,))
    # The first set could not be read: the least cloudy one that was is taken.
    assert (two.status, two.chosen, two.kept) == ("unchecked", 1, (False, True, False))
    assert two.offsets == (None, Offset(0.0, -6.0), Offset(0.0, 6.0))
    disputed = decide(3, apart)
    assert (disputed.status, disputed.chosen, disputed.kept) == ("disputed", 0, (True, False, False))
    assert disputed.offsets[1] == Offset(0.0, 20.0)


def test_bad_path_a_set_compared_with_no_member_has_no_place() -> None:
    """Scenarios: S-P06-BAD-REFERENCE-UNREADABLE"""
    measured = {(0, 1): Offset(1.0, 0.0), (1, 2): Offset(0.0, 1.0), (0, 2): Offset(1.0, 1.0), (2, 3): Offset(0.0, 30.0)}

    assert placed(4, measured, frozenset({0, 1}))[3] is None
    verdict = decide(4, measured)
    assert (verdict.status, verdict.chosen, verdict.kept) == ("agreed", 0, (True, True, True, False))
    sets = [(item(name, f"20{26 - index}-08-17"),) for index, name in enumerate("abcd")]
    record = verdict.as_record(sets)
    assert record["scenes"] == [
        {"items": ["a"], "date": "2026-08-17", "cloud": 1.0, "kept": True, "eastM": -1.0, "northM": 0.0},
        {"items": ["b"], "date": "2025-08-17", "cloud": 1.0, "kept": True, "eastM": 0.0, "northM": 0.0},
        {"items": ["c"], "date": "2024-08-17", "cloud": 1.0, "kept": True, "eastM": 0.0, "northM": 1.0},
        {"items": ["d"], "date": "2023-08-17", "cloud": 1.0, "kept": False, "eastM": 0.0, "northM": 30.0},
    ]


def test_bad_path_a_patch_without_texture_or_data_measures_nothing(tmp_path: Path) -> None:
    """Scenarios: S-P06-BAD-REFERENCE-UNREADABLE"""
    flat = Patch(numpy.zeros((300, 300), numpy.float32), numpy.ones((300, 300), numpy.float32))
    empty = Patch(numpy.zeros((300, 300), numpy.float32), numpy.zeros((300, 300), numpy.float32))

    noise = [patch_of(numpy.random.default_rng(seed).integers(1, 255, (3, 300, 300)).astype(numpy.float32)) for seed in (1, 2)]

    assert pair_offset(flat, flat) is None
    assert pair_offset(empty, empty) is None
    assert pair_offset(*noise) is None
    assert readings([flat, None, flat]) == {}
    with pytest.raises(RuntimeError):
        read_patch([str(tmp_path / "missing.tif")], window(*BUCHAREST))


def test_happy_path_a_narrow_window_reads_a_smaller_patch() -> None:
    """Scenarios: S-P06-HAPPY-REFERENCE-ANY-LATITUDE"""
    assert patch_half_m(window(*BUCHAREST)) == agreement.PATCH_HALF_M
    assert abs(patch_half_m(window(*BUCHAREST, 2000.0)) - 2000.0) < 5
    assert REJECT_M < 8.7


class _Log:
    def __init__(self) -> None:
        self.lines: list[tuple[str, str]] = []

    def info(self, message: str, _step: str | None = None) -> None:
        self.lines.append(("info", message))

    def warn(self, message: str, _step: str | None = None) -> None:
        self.lines.append(("warn", message))


def test_happy_path_the_log_names_the_reference_and_any_date_set_aside() -> None:
    """Scenarios: S-P06-HAPPY-REFERENCE-AGREEMENT, S-P06-BAD-REFERENCE-SHIFTED-DATE"""
    log = _Log()
    ctx = cast("JobContext", SimpleNamespace(log=log))
    sets = [(item(name, "2026-08-17"),) for name in "abc"]

    _report(ctx, sets, agreement.Agreement("agreed", 0, (ZERO, ZERO, ZERO), (True, True, True)))
    _report(ctx, sets, agreement.Agreement("agreed", 1, (Offset(0.0, -11.5), ZERO, ZERO), (False, True, True)))

    assert log.lines == [
        ("info", "Sentinel-2 a agrees with the other clear dates (3 compared)"),
        ("warn", "Sentinel-2 a sits 11.5 m off the other dates (bound 7.5 m): b is the reference"),
    ]


def test_bad_path_a_cached_window_without_a_verdict_to_trust_is_measured_again(tmp_path: Path) -> None:
    """Scenarios: S-P06-BAD-REFERENCE-UNREADABLE"""
    path = Path(scene(tmp_path, "cached", (BUCHAREST, 32635), (0.0, 0.0)))

    found = [_stored_check(path, 3)]
    for text in ("{not json", '{"chosen": 3}', '{"chosen": true}', '{"chosen": 1, "status": "agreed"}'):
        dataset = gdal.Open(str(path), gdal.GA_Update)
        dataset.SetMetadataItem(CHECK_METADATA, text)
        dataset.Close()
        found.append(_stored_check(path, 3))

    assert found == [None, None, None, None, (1, {"chosen": 1, "status": "agreed"})]
