"""M16's reading of the figures and the start of Snap my points (docs/research/M16-recalibrate.md §1 to §3), each edge on its own."""

import numpy
import pytest
from hcm_pipeline.calibrate.dense import PROOF_SEARCH_GROUND_M
from hcm_pipeline.contract import RECALIBRATE_MIN_GAIN_M, Errors
from hcm_pipeline.documents import GeorefInfo, Version
from hcm_pipeline.georef.transforms import Fit, Gcp, fit
from hcm_pipeline.jobs import DeclinedError, StepFailedError
from hcm_pipeline.model import DocumentError
from hcm_pipeline.steps.recalibrate import (
    Compared,
    Current,
    Figure,
    RoughPoint,
    bent_start,
    compared,
    figures_record,
    figures_text,
    refitted,
    require_better,
    search_m,
    start_of,
)

PIXELS = [(0.0, 0.0), (1000.0, 0.0), (1000.0, 800.0), (0.0, 800.0), (500.0, 400.0), (250.0, 600.0), (750.0, 200.0)]


def gcps(enabled: bool = True, shift: float = 0.0) -> list[Gcp]:
    """Pairs of an exact map, 1e-5 degrees a pixel, `shift` degrees east."""
    return [Gcp(f"g{index}", x, y, 44.4 - y * 1e-5, 26.1 + x * 1e-5 + shift, enabled) for index, (x, y) in enumerate(PIXELS)]


def exact() -> Fit:
    found = fit("affine", gcps())
    assert isinstance(found, Fit)
    return found


@pytest.mark.parametrize(("after", "better"), [(10.0 - RECALIBRATE_MIN_GAIN_M, True), (9.5, False), (12.0, False)])
def test_happy_path_better_means_by_the_gain_on_the_same_checks(after: float, better: bool) -> None:
    """Scenarios: S-P19-HAPPY-REFINE, S-P19-BAD-NOT-IMPROVED"""
    figures = Compared(Figure(10.0, 5), Figure(after, 5))

    assert figures.better is better
    assert figures_record(figures) == {"before": {"rmseM": 10.0, "checks": 5}, "after": {"rmseM": after, "checks": 5}}
    assert "against the current 10.0 m on the same 5 checks" in figures_text(figures)


def test_bad_path_too_few_disabled_pairs_compare_nothing() -> None:
    """Scenarios: S-P19-HAPPY-MANUAL-FIGURES"""
    few = GeorefInfo("gcps", "affine", (*gcps()[:5], *(gcp for gcp in gcps(enabled=False)[5:])), 0.0, 0.0, 2)

    assert compared(Current.polynomial(exact()), few) is None
    assert compared(None, few) is None
    assert figures_record(None) == {}
    assert figures_text(None).startswith("not compared")


@pytest.mark.parametrize(
    ("figures", "code"),
    [(None, Errors.REFINE_UNMEASURED), (Compared(Figure(10.0, 5), Figure(9.5, 5)), Errors.NOT_IMPROVED)],
)
def test_bad_path_a_refine_declines_with_its_own_reason(figures: Compared | None, code: str) -> None:
    """Scenarios: S-P19-BAD-NOT-IMPROVED

    Too few checks to compare is its own reason: the tiles agreed, only the comparison was impossible (not `refineRefused`)."""
    with pytest.raises(DeclinedError) as raised:
        require_better(figures)

    assert raised.value.code == code


def test_happy_path_one_rough_point_moves_the_whole_start() -> None:
    """Scenarios: S-P19-HAPPY-POINTS"""
    point = RoughPoint(500.0, 400.0, 44.4 - 400 * 1e-5, 26.1 + 500 * 1e-5 + 0.001)

    start = bent_start(Current.polynomial(exact()), [point])

    lng, _ = start.to_lnglat(numpy.array([0.0]), numpy.array([0.0]))
    assert float(lng[0]) == pytest.approx(26.101, abs=1e-6)


def test_bad_path_rough_points_in_a_line_and_no_pairs_refuse() -> None:
    """Scenarios: S-P19-BAD-REFUSED"""
    line = [RoughPoint(float(index), float(index), 44.4, 26.1 + index * 1e-5) for index in range(3)]

    with pytest.raises(StepFailedError) as raised:
        bent_start(Current.polynomial(Fit(exact().transform, (), 0.0, None, 0)), line)

    assert raised.value.code == Errors.DEGENERATE_GCPS


def test_happy_path_refine_searches_as_far_as_the_current_figure_allows() -> None:
    """Scenarios: S-P19-HAPPY-REFINE"""
    current = Current.polynomial(exact())

    assert search_m(current, start_of(current, []), []) == PROOF_SEARCH_GROUND_M
    assert refitted(None) is None
    assert refitted(GeorefInfo("gcps", "affine", ())) is None


def test_bad_path_a_malformed_rough_point_is_a_document_error() -> None:
    """Scenarios: S-P19-BAD-REFUSED"""
    with pytest.raises(DocumentError):
        RoughPoint.of({"pixel": {"x": 1}, "geo": {"lat": 44.4, "lng": 26.1}})


def test_happy_path_a_version_reads_its_recalibration() -> None:
    """Scenarios: S-P19-HAPPY-REFINE"""
    record = {"layerId": "l1", "origin": "regeoref", "state": "processing", "recalibration": {"route": "auto"}}

    assert Version.of("v1", record).recalibration == {"route": "auto"}
    assert Version.of("v1", {**record, "recalibration": None}).recalibration == {}
