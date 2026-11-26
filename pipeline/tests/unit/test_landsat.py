"""The Landsat path's parts (docs/research/M25-landsat.md §3): which steps a scene takes, its bands, its colour and its shift."""

from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import cast

import numpy
import pytest
from hcm_pipeline.contract import SENSOR_SPECS, Errors
from hcm_pipeline.geo import FloatArray, Grid, MercatorBox
from hcm_pipeline.jobs import Done, JobContext, Skipped, StepFailedError
from hcm_pipeline.landsat import compose as compose_module
from hcm_pipeline.landsat.bands import ETM_BANDS, OLI_BANDS, TM_BANDS, band_of, needed_bands, true_colour
from hcm_pipeline.landsat.colour import CLOUD_BITS, FILL_BIT, Bands, brovey, cloud_pct, compose, masks, stretch
from hcm_pipeline.landsat.compose import measured_shift, reference_grey, shift_record, staged_bands
from hcm_pipeline.landsat.offset import Shift, shift_of
from hcm_pipeline.landsat.route import AlreadyGeoreferenced, ForLandsat, is_landsat
from hcm_pipeline.model import Job


def job(dataset: str, job_type: str = "usgs-import") -> Job:
    return Job("job-1", job_type, "running", {"entityId": "LT51830291989193MTI00", "dataset": dataset, "sensor": "L5-TM"}, None, None)


@dataclass
class Context:
    """The part of a `JobContext` the routing reads."""

    job: Job
    step: str = ""


@dataclass
class Named:
    name: str
    ran: list[str] = field(default_factory=list)

    def run(self, ctx: JobContext) -> Done:
        self.ran.append(str(ctx.job.params["dataset"]))
        return Done()


def test_happy_path_a_landsat_job_takes_the_landsat_step_under_the_other_steps_name() -> None:
    """Scenarios: S-P30-HAPPY"""
    other, landsat = Named("extract"), Named("bands")
    step = ForLandsat(other, landsat)

    step.run(cast("JobContext", Context(job("landsat_tm_c2_l1"))))
    step.run(cast("JobContext", Context(job("corona2"))))

    assert step.name == "extract"
    assert (landsat.ran, other.ran) == (["landsat_tm_c2_l1"], ["corona2"])
    assert is_landsat(job("landsat_etm_c2_l1"))
    assert not is_landsat(job("landsat_etm_c2_l1", "regeoref"))
    skipped = AlreadyGeoreferenced("locate").run(cast("JobContext", Context(job("landsat_tm_c2_l1"))))
    assert isinstance(skipped, Skipped)
    assert "no locate" in skipped.reason


def test_happy_path_the_bands_are_known_by_their_usgs_names() -> None:
    """Scenarios: S-P30-HAPPY"""
    assert band_of("LT05_L1TP_183029_19890712_20200916_02_T1_B3.TIF") == "B3"
    assert band_of("le07_l1tp_183029_20000715_20200918_02_t1_qa_pixel.tif") == "QA_PIXEL"
    assert band_of("LT05_L1TP_183029_19890712_20200916_02_T1_MTL.txt") is None
    assert band_of("LT05_L1TP_183029_19890712_20200916_02_T1_B6.TIF") == "B6"
    assert needed_bands("L5-TM") == TM_BANDS
    assert needed_bands("L7-ETM") == ETM_BANDS
    assert "B8" in ETM_BANDS
    assert "B8" not in TM_BANDS
    assert (SENSOR_SPECS["L5-TM"].maxzoom, SENSOR_SPECS["L7-ETM"].maxzoom) == (13, 14)


def test_happy_path_an_oli_scene_takes_its_own_colour_bands_and_its_panchromatic_band() -> None:
    """Scenarios: S-P30-HAPPY-OLI"""
    assert needed_bands("L8-OLI") == needed_bands("L9-OLI") == OLI_BANDS == ("B4", "B3", "B2", "B8", "QA_PIXEL")
    assert true_colour("L9-OLI") == ("B4", "B3", "B2")
    assert true_colour("L7-ETM") == true_colour("L5-TM") == ("B3", "B2", "B1")
    assert band_of("LC09_L1TP_183029_20230718_20230718_02_T1_B10.TIF") is None
    oli = SENSOR_SPECS["L8-OLI"]
    assert (oli.dataset, oli.maxzoom, SENSOR_SPECS["L9-OLI"].resolution_m) == ("landsat_ot_c2_l1", 14, 15)


def scene(size: int = 64, pan: bool = False) -> Bands:
    rng = numpy.random.default_rng(3)
    base = rng.uniform(20, 200, (size, size))
    quality = numpy.zeros((size, size), numpy.uint16)
    return Bands(base * 1.1, base, base * 0.9, quality, base * 2 if pan else None)


def test_happy_path_the_stretch_reaches_the_full_range_over_clear_pixels_and_keeps_zero_for_no_data() -> None:
    """Scenarios: S-P30-HAPPY"""
    bands = scene()
    bands.red[0, :4] = 0

    composite = compose(bands)

    red, _, _, alpha = composite.rgba
    assert red[1:].min() == 1
    assert red.max() == 255
    assert (red[0, :4] == 0).all()
    assert (alpha[0, :4] == 0).all()
    assert (alpha[1:] == 255).all()
    assert composite.grey.shape == (64, 64)


def test_bad_path_clouds_and_fill_are_masked_and_never_set_the_white_point() -> None:
    """Scenarios: S-P30-BAD-CLOUD"""
    bands = scene()
    bands.quality[:32] = 1 << 3
    bands.red[:32] = 255.0 * 4
    bands.quality[63, 63] = FILL_BIT

    valid, cloudy = masks(bands)
    composite = compose(bands)

    assert not valid[63, 63]
    assert cloudy[:32].all()
    assert not cloudy[32:].any()
    # The clear half spans the range; the bright cloud only saturates.
    assert composite.rgba[0][32:63].max() == 255
    assert cloud_pct(composite, slice(0, 64), slice(0, 64)) == pytest.approx(50.0, abs=0.1)
    assert cloud_pct(composite, slice(0, 0), slice(0, 0)) == 100.0
    assert CLOUD_BITS & (1 << 4)


def test_bad_path_a_scene_with_no_clear_pixel_stretches_its_valid_ones_and_one_with_none_is_empty() -> None:
    """Scenarios: S-P30-BAD-CLOUD"""
    band = numpy.linspace(10, 100, 16).reshape(4, 4)
    none = numpy.zeros((4, 4), numpy.bool_)
    every = numpy.ones((4, 4), numpy.bool_)

    assert stretch(band, none, every).max() == 255
    assert stretch(band, none, none).max() == 0


def test_happy_path_brovey_brings_the_panchromatic_detail_and_keeps_the_colour_ratios() -> None:
    """Scenarios: S-P30-HAPPY-ETM"""
    bands = scene(pan=True)

    red, green, blue = brovey(bands)

    intensity = (red + green + blue) / 3
    assert bands.pan is not None
    assert numpy.allclose(intensity, bands.pan)
    assert numpy.allclose(red / green, 1.1)
    assert numpy.allclose(brovey(scene())[0], scene().red)


def texture(size: int = 128) -> FloatArray:
    rng = numpy.random.default_rng(11)
    return numpy.asarray(rng.uniform(0, 255, (size, size)), numpy.float64)


def test_happy_path_phase_correlation_finds_a_known_shift() -> None:
    """Scenarios: S-P30-HAPPY"""
    reference = texture()
    moved = numpy.roll(reference, (-2, 3), axis=(0, 1))
    common = numpy.ones(reference.shape, numpy.bool_)

    shift = shift_of(moved, reference, common)

    assert shift is not None
    assert shift.dx == pytest.approx(3, abs=0.2)
    assert shift.dy == pytest.approx(-2, abs=0.2)
    assert shift.pixels == pytest.approx(13**0.5, abs=0.3)


def test_bad_path_too_few_common_pixels_or_no_peak_measure_nothing() -> None:
    """Scenarios: S-P30-BAD-OFFSET"""
    reference = texture()
    few = numpy.zeros(reference.shape, numpy.bool_)
    few[:10, :10] = True
    rng = numpy.random.default_rng(5)

    assert shift_of(reference, reference, few) is None
    assert shift_of(texture(), numpy.zeros_like(reference), numpy.ones(reference.shape, numpy.bool_)) is None
    assert shift_of(rng.uniform(0, 1, (8, 8)), rng.uniform(0, 1, (8, 8)), numpy.zeros((0, 0), numpy.bool_)) is None


def test_happy_path_the_shift_is_reported_in_ground_metres_and_the_cameras_own_pixels() -> None:
    """Scenarios: S-P30-BAD-OFFSET"""
    grid = Grid(0.0, 0.0, 20.0, 10, 10)

    record = shift_record(Shift(3.0, -4.0), grid, SENSOR_SPECS["L5-TM"], 0.0)

    assert record == {"checked": True, "offsetPx": 3.33, "offsetM": 100.0, "eastM": 60.0, "northM": 80.0}
    assert shift_record(None, grid, SENSOR_SPECS["L5-TM"], 0.0) == {"checked": False}
    assert measured_shift(compose(scene()), None) is None


@dataclass
class Objects:
    """No band in the bucket."""

    def stat(self, _path: str) -> None:
        return None


@dataclass
class Log:
    lines: list[str] = field(default_factory=list)

    def warn(self, message: str, step: str | None = None) -> None:
        self.lines.append(f"{step}: {message}")


@dataclass
class BucketContext:
    """The part of a `JobContext` `staged_bands` and `reference_grey` read."""

    services: SimpleNamespace = field(default_factory=lambda: SimpleNamespace(objects=Objects()))
    log: Log = field(default_factory=Log)

    def work_file(self, name: str) -> str:
        return f"work/c/j/{name}"


def test_bad_path_a_band_missing_from_the_bucket_fails_as_one_missing_from_the_bundle() -> None:
    """Scenarios: S-P30-BAD-MISSING-BAND"""
    with pytest.raises(StepFailedError) as raised:
        staged_bands(cast("JobContext", BucketContext()), "L5-TM")

    assert (raised.value.code, raised.value.params) == (Errors.MISSING_BAND, {"band": "B3"})


def test_bad_path_no_sentinel_2_leaves_the_shift_unmeasured_and_says_why(monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P30-BAD-OFFSET"""

    def unavailable(_ctx: JobContext, _window: MercatorBox) -> None:
        raise StepFailedError(Errors.REFERENCE_UNAVAILABLE, "no clear Sentinel-2 date")

    monkeypatch.setattr(compose_module, "sentinel2", unavailable)
    ctx = BucketContext()

    grey = reference_grey(cast("JobContext", ctx), MercatorBox(0, 0, 10, 10), Grid(0.0, 10.0, 1.0, 10, 10))

    assert grey is None
    assert ctx.log.lines == ["warp: no Sentinel-2 to check the Landsat scene against: no clear Sentinel-2 date"]
