"""The georeferencing transforms reproduce the golden cases both languages share, and recover known transforms."""

import json
import math

import numpy
import pytest
from hcm_pipeline.geo import to_lnglat
from hcm_pipeline.georef.transforms import Fit, FitRefusal, Gcp, fit, fit_transform, residuals_m, rmse, spread_share
from hypothesis import given
from hypothesis import strategies as st

from tests.contracts_loader import CONTRACTS, GeorefCase, georef_cases

OK_CASES = [case for case in georef_cases() if case.ok]
REFUSED_CASES = [case for case in georef_cases() if not case.ok]


def expect_ok(result: Fit | FitRefusal) -> Fit:
    assert isinstance(result, Fit), result
    return result


@pytest.mark.parametrize("case", OK_CASES, ids=lambda case: case.name)
def test_happy_path_golden_cases_fit_with_their_errors(case: GeorefCase) -> None:
    result = expect_ok(fit(case.transform, case.gcps))

    assert result.fit_rmse_m == pytest.approx(case.fit_rmse_m, abs=case.tolerance_m)
    assert all(gcp.residual_m is not None and gcp.residual_m < case.tolerance_m for gcp in result.gcps)


@pytest.mark.parametrize("case", [case for case in OK_CASES if case.checkpoint_count is not None], ids=lambda case: case.name)
def test_happy_path_golden_held_out_checkpoints_are_measured(case: GeorefCase) -> None:
    result = expect_ok(fit(case.transform, case.gcps))

    assert result.checkpoint_rmse_m == pytest.approx(case.checkpoint_rmse_m, abs=case.tolerance_m)
    assert result.checkpoint_count == case.checkpoint_count


@pytest.mark.parametrize("case", REFUSED_CASES, ids=lambda case: case.name)
def test_bad_path_golden_cases_are_refused_with_their_reason(case: GeorefCase) -> None:
    assert fit(case.transform, case.gcps) == FitRefusal(case.reason)


def grid_gcps(transform: tuple[float, float, float, float, float, float], count: int = 4) -> list[Gcp]:
    """Pairs on a `count` by `count` pixel grid mapped by the pixel → EPSG:3857 affine `(x0, a, b, y0, c, d)`."""
    x0, a, b, y0, c, d = transform
    gcps = []
    for index, (px, py) in enumerate((px, py) for px in numpy.linspace(0, 9000, count) for py in numpy.linspace(0, 7000, count)):
        lng, lat = to_lnglat(x0 + a * px + b * py, y0 + c * px + d * py)
        gcps.append(Gcp(f"g{index}", float(px), float(py), lat, lng))
    return gcps


BUCHAREST_AFFINE = (2_888_740.0, 2.0, 0.1, 5_550_954.0, -0.05, -2.0)


@given(
    scale=st.floats(0.5, 4.0),
    rotation=st.floats(-math.pi, math.pi),
    shear=st.floats(-0.2, 0.2),
    kind=st.sampled_from(["affine", "poly2", "tps"]),
)
def test_happy_path_any_affine_map_is_recovered_by_every_transform(scale: float, rotation: float, shear: float, kind: str) -> None:
    cos, sin = math.cos(rotation) * scale, math.sin(rotation) * scale
    gcps = grid_gcps((2_888_740.0, cos, -sin + shear, 5_550_954.0, -sin, -cos))

    result = expect_ok(fit(kind, gcps))

    assert result.fit_rmse_m < 0.01
    assert result.checkpoint_rmse_m is not None
    assert result.checkpoint_rmse_m < 0.05


def test_happy_path_inverse_maps_places_back_to_their_pixels() -> None:
    gcps = grid_gcps(BUCHAREST_AFFINE)
    for kind in ("affine", "poly2", "tps"):
        transform = fit_transform(kind, gcps)
        assert transform is not None
        px = numpy.array([1234.0, 8000.0])
        py = numpy.array([4321.0, 100.0])

        back_x, back_y = transform.to_pixel(*transform.to_mercator(px, py))

        assert numpy.allclose(back_x, px, atol=0.05)
        assert numpy.allclose(back_y, py, atol=0.05)


def test_happy_path_poly2_absorbs_a_quadratic_distortion_that_affine_cannot() -> None:
    x0, a, b, y0, c, d = BUCHAREST_AFFINE
    gcps = []
    for index, (px, py) in enumerate((px, py) for px in numpy.linspace(0, 9000, 5) for py in numpy.linspace(0, 7000, 5)):
        bend = 3e-6 * (px - 4500) ** 2
        lng, lat = to_lnglat(x0 + a * px + b * py, y0 + c * px + d * py + bend)
        gcps.append(Gcp(f"g{index}", float(px), float(py), lat, lng))

    affine = expect_ok(fit("affine", gcps))
    poly2 = expect_ok(fit("poly2", gcps))

    assert affine.fit_rmse_m > 5
    assert poly2.fit_rmse_m < 0.01
    assert poly2.transform.kind == "poly2"


def test_happy_path_thin_plate_spline_passes_through_every_pair() -> None:
    gcps = grid_gcps(BUCHAREST_AFFINE)
    moved = [gcp if gcp.id != "g5" else Gcp("g5", gcp.x, gcp.y, gcp.lat + 0.0003, gcp.lng) for gcp in gcps]
    transform = fit_transform("tps", moved)
    assert transform is not None

    assert float(numpy.max(residuals_m(transform, moved))) < 0.01
    assert expect_ok(fit("tps", moved)).fit_rmse_m < 0.01


def test_happy_path_lng_lat_of_a_pixel_is_the_inverse_mercator_of_its_fit() -> None:
    transform = fit_transform("affine", grid_gcps(BUCHAREST_AFFINE))
    assert transform is not None

    lng, lat = transform.to_lnglat(numpy.array([0.0]), numpy.array([0.0]))

    assert (float(lng[0]), float(lat[0])) == pytest.approx(to_lnglat(2_888_740.0, 5_550_954.0), abs=1e-9)


def test_bad_path_pairs_left_out_that_cannot_refit_have_no_residual() -> None:
    grid = grid_gcps(BUCHAREST_AFFINE)
    gcps = [grid[0], grid[3], grid[12]]

    result = expect_ok(fit("affine", gcps))

    assert result.checkpoint_rmse_m is None
    assert result.checkpoint_count == 0
    assert all(gcp.residual_m is None for gcp in result.gcps)


def test_bad_path_coincident_pixels_are_degenerate() -> None:
    gcps = [Gcp(f"g{index}", 10.0, 10.0, 44.4 + index * 0.01, 26.1 + index * 0.02) for index in range(6)]

    assert fit("affine", gcps) is FitRefusal.DEGENERATE
    assert spread_share(numpy.array([1.0, 1.0, 1.0]), numpy.array([2.0, 2.0, 2.0])) == 0.0


def test_bad_path_points_on_a_conic_make_a_degenerate_second_order_design() -> None:
    angles = numpy.linspace(0, 2 * math.pi, 7)[:-1]
    gcps = []
    for index, angle in enumerate(angles):
        px, py = 5000 + 3000 * math.cos(angle), 5000 + 3000 * math.sin(angle)
        lng, lat = to_lnglat(2_888_740.0 + 2 * px, 5_550_954.0 - 2 * py)
        gcps.append(Gcp(f"g{index}", px, py, lat, lng))

    assert fit("poly2", gcps) is FitRefusal.DEGENERATE


def test_happy_path_poly2_fits_when_places_lie_on_two_streets() -> None:
    """Scenarios: S-A16-HAPPY-POLY2-GRID-INVERSE"""
    pixels = ((0, 0), (9000, 0), (9000, 7000), (0, 7000), (4500, 3500), (2000, 5000))
    gcps = [
        Gcp(
            f"s{index}",
            float(px),
            float(py),
            44.55 if index % 2 == 0 else 44.5,
            26.0 + index * 0.015,
        )
        for index, (px, py) in enumerate(pixels)
    ]

    result = expect_ok(fit("poly2", gcps))

    assert result.fit_rmse_m < 0.01
    assert result.transform.kind == "poly2"
    assert not isinstance(fit("affine", gcps), FitRefusal)


def test_bad_path_pixels_on_only_two_rows_leave_poly2_singular() -> None:
    """Scenarios: S-A16-BAD-POLY2-TWO-ROWS"""
    gcps = [
        Gcp(f"{'tb'[row]}{col}", float(col * 4500), float(row * 7000), 44.4 + row * 0.05, 26.0 + col * 0.02)
        for row in range(2)
        for col in range(3)
    ]

    assert fit("poly2", gcps) is FitRefusal.DEGENERATE
    assert not isinstance(fit("affine", gcps), FitRefusal)


def test_bad_path_a_singular_spline_system_is_degenerate() -> None:
    gcps = grid_gcps(BUCHAREST_AFFINE, 4)
    doubled = [*gcps, Gcp("dup", gcps[0].x, gcps[0].y, gcps[0].lat, gcps[0].lng)]

    assert fit_transform("tps", doubled) is None


def test_happy_path_records_round_like_the_documents() -> None:
    gcp = Gcp("a001", 12.0, 7.456, 44.123456789123, 26.1, False, "auto", 0.87654, 3.14159)

    assert gcp.as_record() == {
        "id": "a001",
        "pixel": {"x": 12, "y": 7.46},
        "geo": {"lat": 44.123456789, "lng": 26.1},
        "enabled": False,
        "origin": "auto",
        "score": 0.877,
        "residualM": 3.14,
    }
    assert Gcp("g1", 1.5, 2.0, 44.0, 26.0).as_record() == {
        "id": "g1",
        "pixel": {"x": 1.5, "y": 2},
        "geo": {"lat": 44.0, "lng": 26.0},
        "enabled": True,
        "origin": "manual",
    }
    assert rmse([]) == 0.0
    assert rmse([3.0, 4.0]) == pytest.approx(math.sqrt(12.5))


def test_happy_path_a_figure_says_whether_its_checks_were_held_out_or_left_one_out() -> None:
    """Scenarios: S-P06-BAD-SEEDED-REFUSED"""
    kinds = {
        case.name: raw for case, raw in zip(georef_cases(), json.loads((CONTRACTS / "georef-cases.json").read_text())["cases"], strict=True)
    }
    for case in OK_CASES:
        fitted = fit(case.transform, case.gcps)
        assert isinstance(fitted, Fit)
        assert fitted.checkpoint_kind == kinds[case.name]["expect"]["checkpointKind"]
