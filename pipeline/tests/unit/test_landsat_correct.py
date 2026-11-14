"""A saturated Landsat scene counts as cloud (lesson 726) and a systematic one is moved onto Sentinel-2 (lesson 727):
docs/research/M25-landsat.md §3, the two scenes of 2026-11-14 over Bucharest (30 June 1991 and 15 August 2008, both L1GS)."""

import io
import tarfile
from collections.abc import Callable
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Final, cast

import numpy
import pytest
from hcm_pipeline.contract import SENSOR_SPECS
from hcm_pipeline.geo import FloatArray, Grid
from hcm_pipeline.jobs import JobContext
from hcm_pipeline.landsat.bands import delivery_level
from hcm_pipeline.landsat.colour import Bands, Composite, cloud_pct, compose, masks, stretch
from hcm_pipeline.landsat.compose import Check, Placement, saturated
from hcm_pipeline.landsat.correct import SYSTEMATIC_MAX_M, level_of, moved_grid, verdict
from hcm_pipeline.landsat.offset import Shift

SIZE: Final = 96
MARGIN: Final = 16
SHIFT: Final = (5, 4)
L1GS: Final = "LT05_L1GS_182029_20080815_20201030_02_T2.tar"


def world() -> FloatArray:
    """A textured world larger than the grid, so a grid moved within `MARGIN` pixels still sees it."""
    rng = numpy.random.default_rng(17)
    return numpy.asarray(rng.uniform(20, 200, (SIZE + 2 * MARGIN, SIZE + 2 * MARGIN)), numpy.float64)


def composite_of(values: FloatArray) -> Composite:
    quality = numpy.zeros(values.shape, numpy.uint16)
    return compose(Bands(values, values * 0.9, values * 0.8, quality))


def scene_on(pixels: FloatArray, base: Grid) -> Callable[[Grid], Composite]:
    """A scene whose content lies `SHIFT` pixels right and down of the world on `base`; a moved grid samples it moved."""

    def composite_on(grid: Grid) -> Composite:
        columns = MARGIN - SHIFT[0] + round((grid.left - base.left) / base.resolution)
        rows = MARGIN - SHIFT[1] + round((base.top - grid.top) / base.resolution)
        return composite_of(pixels[rows : rows + SIZE, columns : columns + SIZE])

    return composite_on


def check(resolution: float, level: str, composite_on: Callable[[Grid], Composite] | None = None) -> Placement:
    pixels = world()
    grid = Grid(0.0, 0.0, resolution, SIZE, SIZE)
    reference = composite_of(pixels[MARGIN : MARGIN + SIZE, MARGIN : MARGIN + SIZE]).grey
    on = composite_on or scene_on(pixels, grid)
    return Check(on, reference, grid, SENSOR_SPECS["L5-TM"], 0.0, level).place()


def correction(placement: Placement, resolution: float) -> tuple[object, object, float, float]:
    """The correction's state and reason, and its shift east and north in grid pixels (phase correlation is sub-pixel)."""
    record = placement.report()["correction"]
    assert isinstance(record, dict)
    return record["state"], record.get("reason"), record["eastM"] / resolution, record["northM"] / resolution


def test_happy_path_the_product_level_comes_from_the_delivery_name() -> None:
    """Scenarios: S-P30-HAPPY-SYSTEMATIC-MOVED"""
    assert level_of(f"usgs-raw/landsat_tm_c2_l1/LT51820292008228MTI00/{L1GS}") == "L1GS"
    assert level_of("LT05_L1TP_183029_19890712_20200916_02_T1.tar") == "L1TP"
    assert level_of("le07_l1gt_182029_20000615_20200917_02_t2.tar") == "L1GT"
    assert level_of("bundle.tar") is None
    assert level_of(None) is None


def test_happy_path_only_a_systematic_scene_over_a_pixel_off_is_moved_and_never_past_the_bound() -> None:
    """Scenarios: S-P30-HAPPY-SYSTEMATIC-MOVED, S-P30-BAD-SYSTEMATIC-IMPLAUSIBLE"""
    assert verdict("L1GS", 124.8, 3744.2, 1.0) == "move"
    assert verdict("L1GT", 2.0, 60.0, 1.0) == "move"
    assert verdict("L1GS", 0.5, 15.0, 1.0) == "keep"
    assert verdict("L1TP", 124.8, 3744.2, 1.0) == "keep"
    assert verdict("L1GS", 400.0, SYSTEMATIC_MAX_M + 1, 1.0) == "implausible"
    moved = moved_grid(Grid(100.0, 200.0, 10.0, 4, 4), Shift(2.0, 3.0))
    assert (moved.left, moved.top, moved.width) == (120.0, 170.0, 4)


def test_happy_path_a_systematic_scene_is_moved_onto_sentinel_2_and_measured_again() -> None:
    """Scenarios: S-P30-HAPPY-SYSTEMATIC-MOVED"""
    placement = check(30.0, "L1GS")

    state, reason, east, north = correction(placement, 30.0)
    assert (state, reason) == ("applied", None)
    assert east == pytest.approx(SHIFT[0], abs=0.1)
    assert north == pytest.approx(-SHIFT[1], abs=0.1)
    report = placement.report()
    assert report["checked"] is True
    assert isinstance(report["offsetPx"], float)
    assert report["offsetPx"] <= 0.2


def test_bad_path_a_precise_scene_is_never_moved_and_a_shift_past_the_bound_is_refused() -> None:
    """Scenarios: S-P30-BAD-SYSTEMATIC-IMPLAUSIBLE"""
    precise = check(30.0, "L1TP").report()
    far = check(1500.0, "L1GS")

    assert "correction" not in precise
    assert precise["offsetPx"] == pytest.approx(6.4, abs=0.2)
    state, reason, east, north = correction(far, 1500.0)
    assert (state, reason, round(east), round(north)) == ("refused", "implausible", SHIFT[0], -SHIFT[1])
    assert far.report()["offsetPx"] == pytest.approx(320.2, abs=2.0)


def test_bad_path_a_shift_a_second_measure_does_not_confirm_keeps_the_scene_where_it_was() -> None:
    """Scenarios: S-P30-BAD-SYSTEMATIC-IMPLAUSIBLE"""
    pixels = world()
    stuck = composite_of(pixels[MARGIN - SHIFT[1] : MARGIN - SHIFT[1] + SIZE, MARGIN - SHIFT[0] : MARGIN - SHIFT[0] + SIZE])

    placement = check(30.0, "L1GS", lambda _grid: stuck)

    assert placement.composite is stuck
    unmeasured = Check(lambda _grid: stuck, None, Grid(0.0, 0.0, 30.0, SIZE, SIZE), SENSOR_SPECS["L5-TM"], 0.0, "L1GS").place()
    assert unmeasured.report() == {"checked": False}
    state, reason, east, north = correction(placement, 30.0)
    assert (state, reason, round(east), round(north)) == ("refused", "unconfirmed", SHIFT[0], -SHIFT[1])


def test_bad_path_a_saturated_cloud_deck_counts_as_cloud_and_comes_out_white_not_yellow() -> None:
    """Scenarios: S-P30-BAD-SATURATED"""
    rng = numpy.random.default_rng(9)
    red = numpy.full((32, 32), 255, numpy.uint8)
    green = numpy.full((32, 32), 255, numpy.uint8)
    blue = numpy.full((32, 32), 255, numpy.uint8)
    red[:4], green[:4] = rng.integers(40, 200, (4, 32)), rng.integers(40, 200, (4, 32))
    hits = saturated(red, green, blue)
    assert hits is not None
    bands = Bands(
        red.astype(numpy.float64), green.astype(numpy.float64), blue.astype(numpy.float64), numpy.zeros((32, 32), numpy.uint16), None, hits
    )

    _, cloudy = masks(bands)
    composite = compose(bands)

    assert cloudy.all()
    assert cloud_pct(composite, slice(0, 32), slice(0, 32)) == 100.0
    assert [int(band[16, 16]) for band in composite.rgba] == [255, 255, 255, 255]
    assert saturated(numpy.zeros((2, 2), numpy.float64)) is None
    assert stretch(numpy.full((2, 2), 7.0), numpy.ones((2, 2), numpy.bool_), numpy.ones((2, 2), numpy.bool_)).max() == 255


@dataclass
class Delivery:
    """A bucket holding one delivery (`data`), or none."""

    data: bytes | None

    def stat(self, _path: str) -> object | None:
        return None if self.data is None else object()

    def open_read(self, _path: str) -> io.BytesIO:
        return io.BytesIO(self.data or b"")


def level_in(path: str | None, data: bytes | None) -> str:
    fetch = SimpleNamespace(gcs_path=path)
    ctx = SimpleNamespace(job=SimpleNamespace(step=lambda _name: fetch), services=SimpleNamespace(objects=Delivery(data)))
    return delivery_level(cast("JobContext", ctx))


def tar_of(*names: str) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as archive:
        for name in names:
            archive.addfile(tarfile.TarInfo(name), io.BytesIO(b""))
    return buffer.getvalue()


def test_bad_path_a_level_no_name_says_is_read_from_the_bundle_and_never_guessed() -> None:
    """Scenarios: S-P30-HAPPY-SYSTEMATIC-MOVED, S-P30-BAD-SYSTEMATIC-IMPLAUSIBLE"""
    assert level_in(f"usgs-raw/x/{L1GS}", None) == "L1GS"
    assert level_in("usgs-raw/x/bundle.tgz", tar_of("LT05_L1GT_182029_20080815_20201030_02_T2_B1.TIF")) == "L1GT"
    assert level_in("usgs-raw/x/bundle.tgz", None) == "L1TP"
    assert level_in(None, None) == "L1TP"
    assert level_in("usgs-raw/x/bundle.tgz", tar_of()) == "L1TP"
    assert level_in("usgs-raw/x/bundle.tgz", b"not a tar at all" * 64) == "L1TP"
