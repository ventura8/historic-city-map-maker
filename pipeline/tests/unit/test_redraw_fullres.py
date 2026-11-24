"""Redraw at full resolution (2026-11-24): the originals or a plain failure, never a copy of the published version (`steps/warp.py`)."""

import math
from dataclasses import replace
from pathlib import Path

import numpy
import pytest
from hcm_pipeline import paths
from hcm_pipeline.archive import encoding
from hcm_pipeline.contract import Errors
from hcm_pipeline.jobs import JobContext, StepFailedError
from hcm_pipeline.placing import fullres, rebuild
from hcm_pipeline.placing.original import ORIGINAL
from hcm_pipeline.placing.raster_io import Pair, WarpPlan
from hcm_pipeline.placing.redraw_layout import rebuilt_record
from hcm_pipeline.steps.warp import composite_originals, cutline, full_resolution, originals_zoom, record_paths, require_original

from tests.fakes.world import PipelineWorld
from tests.unit.test_placing_fullres import write
from tests.unit.test_placing_fullres_more import SCAN, composite, corner_georef
from tests.unit.test_placing_original import GEOREF, regeoref

RING = ((44.4, 26.1), (44.41, 26.1), (44.41, 26.11))


def redraw(ctx: JobContext, **params: object) -> JobContext:
    """The job as Redraw at full resolution writes it (`imagery.saveGcps` with `fullResolution`), naming its archive series."""
    source = ctx.version.source
    series = {"originalArchiveId": source.get("archiveId"), "originalSeriesId": source.get("seriesId")}
    return replace(ctx, job=replace(ctx.job, params={**ctx.job.params, **series, "fullResolution": True, **params}))


def test_happy_path_a_redraw_scales_the_points_from_the_working_copy_to_the_original(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-REDRAW-ORIGINAL"""
    ctx, scan = regeoref(world, tmp_path)
    ctx = redraw(ctx)

    source, georef = full_resolution(ctx, scan, GEOREF)

    assert source == tmp_path / "scratch" / ORIGINAL
    assert source != scan
    # The scan is half the original each way: every point moves to twice its pixel, its place unchanged.
    assert [(gcp.x, gcp.y, gcp.lat, gcp.lng) for gcp in georef.gcps] == [(20.0, 40.0, 44.4, 26.1), (200.0, 300.0, 44.41, 26.12)]
    require_original(ctx, source != scan)


def test_happy_path_a_cropped_version_keeps_its_ring_and_its_points_scale_alike(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-REDRAW-ORIGINAL"""
    ctx, scan = regeoref(world, tmp_path)
    ctx = redraw(replace(ctx, version=replace(ctx.version, crop=RING)))

    source, georef = full_resolution(ctx, scan, GEOREF)

    assert source.name == ORIGINAL
    assert [(gcp.x, gcp.y) for gcp in georef.gcps] == [(20.0, 40.0), (200.0, 300.0)]
    # The crop is a ring of places, not pixels: the original is cut by the same ring, whatever its size.
    assert cutline(ctx.version, tmp_path / "cut.geojson")["cropToCutline"] is True


def test_happy_path_a_redraw_of_a_redraw_finds_the_parts_record_of_the_version_it_was_drawn_from(
    world: PipelineWorld, tmp_path: Path
) -> None:
    """Scenarios: S-P20-HAPPY-REDRAW-ORIGINAL"""
    ctx, scan = composite(world, tmp_path, record=False)
    image = numpy.full((SCAN[1] * 2, SCAN[0] * 2), 255, numpy.uint8)
    original = write(tmp_path / "first-original.tif", image)
    part = fullres.Part(original, (0, 0, SCAN[0] * 2, SCAN[1] * 2), numpy.diag([0.5, 0.5, 1.0]))
    kept = fullres.write_parts(tmp_path / "first.tif", [part], SCAN)
    first = paths.version(ctx.city, ctx.version.layer_id, "ar-first", fullres.VERSION_RECORD)
    ctx.publish(kept, first, "application/json")
    ctx = redraw(ctx, recordFrom=["rg-between", "ar-first"])

    expected = [paths.version(ctx.city, ctx.version.layer_id, item, fullres.VERSION_RECORD) for item in ("rg-between", "ar-first")]
    assert record_paths(ctx)[1:] == expected
    assert composite_originals(ctx, scan, corner_georef()) is not None
    # Kept with this version as well, so the next redraw finds it in its own files.
    assert world.services().objects.stat(ctx.version_file(fullres.VERSION_RECORD)) is not None


def test_bad_path_a_redraw_with_no_original_fails_plainly_and_a_point_edit_still_warps_the_scan(
    world: PipelineWorld, tmp_path: Path
) -> None:
    """Scenarios: S-P20-BAD-REDRAW-ORIGINAL-MISSING"""
    gone, scan = regeoref(world, tmp_path, keep=False)
    assert full_resolution(redraw(gone), scan, GEOREF) == (scan, GEOREF)

    with pytest.raises(StepFailedError) as failed:
        require_original(redraw(gone), from_original=False)

    assert failed.value.code == Errors.ORIGINAL_MISSING
    require_original(gone, from_original=False)


LAYOUT = {"method": "overview", "encoding": "colour", "maxzoom": 19}


def _recorded(tmp_path: Path) -> fullres.Recorded:
    original = write(tmp_path / "laid-original.tif", numpy.full((SCAN[1] * 2, SCAN[0] * 2), 255, numpy.uint8))
    return fullres.Recorded((fullres.Part(original, (0, 0, SCAN[0] * 2, SCAN[1] * 2), numpy.diag([0.5, 0.5, 1.0])),), SCAN)


def test_happy_path_a_redraw_with_no_record_rebuilds_it_from_the_series_layout(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P20-HAPPY-REDRAW-REBUILD"""
    ctx, scan = composite(world, tmp_path, record=False)
    world.store.update(world.version_path(), {"output": None})
    asked: list[tuple[object, str]] = []

    def built(series: JobContext, method: str) -> fullres.Recorded:
        asked.append((series.job.params.get("encoding"), method))
        return _recorded(tmp_path)

    monkeypatch.setattr(rebuild, "built_by", built)
    ctx = redraw(ctx, recordFrom=["ar-first"], layout=LAYOUT)

    assert composite_originals(ctx, scan, corner_georef()) is not None
    assert asked == [("colour", "overview")]
    assert world.services().objects.stat(ctx.version_file(fullres.VERSION_RECORD)) is not None
    assert any("rebuilt from the series' overview layout" in line for line in world.log_lines())


def test_bad_path_no_layout_a_failed_layout_or_another_shape_rebuilds_nothing(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P20-BAD-REDRAW-REBUILD"""
    ctx, scan = composite(world, tmp_path, record=False)
    assert rebuilt_record(redraw(ctx), scan, SCAN) is False
    assert rebuilt_record(replace(ctx, job=replace(ctx.job, params={**ctx.job.params, "layout": LAYOUT})), scan, SCAN) is False
    monkeypatch.setattr(rebuild, "built_by", lambda _series, _method: None)
    assert rebuilt_record(redraw(ctx, layout=LAYOUT), scan, SCAN) is False
    monkeypatch.setattr(rebuild, "built_by", lambda _series, _method: replace(_recorded(tmp_path), size=(SCAN[0], SCAN[0] * 3)))
    assert rebuilt_record(redraw(ctx, layout=LAYOUT), scan, SCAN) is False
    gone = replace(ctx, services=replace(ctx.services, archive_root=tmp_path / "nowhere"))
    monkeypatch.setattr(rebuild, "built_by", lambda _series, _method: _recorded(tmp_path))
    assert rebuilt_record(redraw(gone, layout={**LAYOUT, "gridId": "g-1"}), scan, SCAN) is False


def test_happy_path_a_redraw_draws_as_deep_as_its_originals_hold(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-REDRAW-ZOOM"""
    ctx, scan = composite(world, tmp_path)
    ctx = redraw(ctx)
    fullres.write_parts(scan, _recorded(tmp_path).parts, SCAN)
    plan = WarpPlan([Pair(0.0, 0.0, 0.0, 5_000_000.0), Pair(100.0, 100.0, 10.0, 4_999_990.0), Pair(0.0, 100.0, 0.0, 4_999_990.0)], 1.0)
    found = fullres.originals_of(scan, plan)
    assert found is not None

    zoom = originals_zoom(ctx, scan, plan, 10)

    assert zoom == max(10, encoding.scan_zoom(found.mercator_m))
    assert any("drawn to zoom" in line for line in world.log_lines())
    # 0.12 m a pixel on the ground at Bucharest's latitude (1:2000 at about 400 dpi) is drawn to 19; nothing goes past 20.
    assert encoding.scan_zoom(0.12 / math.cos(math.radians(44.44))) == 19
    assert encoding.scan_zoom(0.001) == encoding.REDRAW_MAX_ZOOM


def test_bad_path_a_point_edit_or_no_record_keeps_the_published_zoom(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-REDRAW-ZOOM"""
    ctx, scan = composite(world, tmp_path, record=False)
    plan = WarpPlan([Pair(0.0, 0.0, 0.0, 0.0)], 1.0)
    assert originals_zoom(ctx, scan, plan, 17) == 17
    assert originals_zoom(redraw(ctx), scan, plan, 17) == 17
    assert encoding.scan_zoom(1e9) == encoding.MIN_ZOOM
