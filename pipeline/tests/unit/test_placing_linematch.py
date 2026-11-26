"""The embedded placer's line ruler (`placing/linematch.py`): an offset georeference found by line tiles, and its corrected points."""

import math
from pathlib import Path

import numpy
import pytest
from hcm_pipeline.geo import to_mercator
from hcm_pipeline.jobs import Waiting
from hcm_pipeline.placing import embedded, linematch, reference
from hcm_pipeline.steps.place import PlaceStep

from tests.fakes.world import PipelineWorld
from tests.synthetic.scenes import CENTRE
from tests.unit.placing_support import originals, series_context
from tests.unit.test_placing_embedded import METRES_PER_PX, town_geotiff


def test_bad_path_a_handful_of_clear_tiles_says_nothing_either_way(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P20-HAPPY-EMBEDDED-PHOTO"""
    ctx = series_context(world, tmp_path, ["few.tif"], {"class": "georeferenced", "encoding": "grey"})
    path = town_geotiff(originals(ctx) / "few.tif", shift_m=60.0)
    real = linematch.offsets
    monkeypatch.setattr(linematch, "offsets", lambda grid, ink, lines: real(grid, ink, lines)[:3])
    window = reference.city_window(ctx)
    assert window is not None
    system = embedded.system_of(path, window)
    assert system is not None
    warped = embedded.warp_embedded(path, system, tmp_path / "w.tif", 5.0, False)

    measured = embedded.ruler(ctx, warped)

    assert measured.shift_m == 0.0
    assert measured.correction is None


def test_bad_path_an_offset_georeference_waits_with_corrected_points(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-EMBEDDED-OFFSET"""
    # Finding of 2026-11-24: the PDT sheets' index corners lay 160 to 250 m off and junction agreement missed it.
    ctx = series_context(world, tmp_path, ["off.tif"], {"class": "georeferenced", "encoding": "grey"})
    town_geotiff(originals(ctx) / "off.tif", shift_m=200.0)

    assert isinstance(PlaceStep().run(ctx), Waiting)

    version = world.version()
    help_item, suggested = version["help"], version["suggestions"]
    assert isinstance(help_item, dict)
    assert isinstance(suggested, dict)
    assert "corrected points" in str(help_item["note"])
    pairs = suggested["pairs"]
    assert isinstance(pairs, list)
    assert len(pairs) == embedded.LATTICE**2
    cx, cy = to_mercator(*CENTRE)
    for pair in pairs:
        assert isinstance(pair, dict)
        assert pair["score"] == embedded.CORRECTED_SCORE
        pixel, geo = pair["pixel"], pair["geo"]
        assert isinstance(pixel, dict)
        assert isinstance(geo, dict)
        mx, my = to_mercator(float(geo["lng"]), float(geo["lat"]))
        truth_x = cx - 500 * METRES_PER_PX + float(pixel["x"]) * METRES_PER_PX
        truth_y = cy + 500 * METRES_PER_PX - float(pixel["y"]) * METRES_PER_PX
        assert math.hypot(mx - truth_x, my - truth_y) < 25.0


def test_bad_path_tiles_that_point_every_way_give_no_correction() -> None:
    """Scenarios: S-P20-HAPPY-EMBEDDED-PHOTO"""
    rows = numpy.random.default_rng(3).uniform(0, 5000, (40, 4))

    assert linematch.correction(rows) is None
    assert linematch.correction(rows[:3]) is None


def test_happy_path_tiles_that_agree_give_their_shift() -> None:
    centres = numpy.array([(x, y) for x in range(0, 5000, 1000) for y in range(0, 5000, 1000)], numpy.float64)
    rows = numpy.column_stack((centres, centres + numpy.array([-150.0, 60.0])))
    rows[0, 2:] += 900.0

    fix = linematch.correction(rows)

    assert fix is not None
    assert abs(fix.offset_m - math.hypot(150.0, 60.0)) < 1.0
    assert numpy.allclose(fix.apply(numpy.array([[100.0, 100.0]])), [[-50.0, 160.0]])
