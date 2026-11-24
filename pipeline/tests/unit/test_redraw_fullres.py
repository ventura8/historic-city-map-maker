"""Redraw at full resolution (2026-11-24): the originals or a plain failure, never a copy of the published version (`steps/warp.py`)."""

from dataclasses import replace
from pathlib import Path

import numpy
import pytest
from hcm_pipeline import paths
from hcm_pipeline.contract import Errors
from hcm_pipeline.jobs import JobContext, StepFailedError
from hcm_pipeline.placing import fullres
from hcm_pipeline.placing.original import ORIGINAL
from hcm_pipeline.steps.warp import composite_originals, cutline, full_resolution, record_paths, require_original

from tests.fakes.world import PipelineWorld
from tests.unit.test_placing_fullres import write
from tests.unit.test_placing_fullres_more import SCAN, composite, corner_georef
from tests.unit.test_placing_original import GEOREF, regeoref

RING = ((44.4, 26.1), (44.41, 26.1), (44.41, 26.11))


def redraw(ctx: JobContext, **params: object) -> JobContext:
    """The job as Redraw at full resolution writes it (`imagery.saveGcps` with `fullResolution`)."""
    return replace(ctx, job=replace(ctx.job, params={**ctx.job.params, "fullResolution": True, **params}))


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


def test_bad_path_a_redraw_with_no_original_fails_plainly_and_a_point_edit_still_warps_the_scan(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-REDRAW-ORIGINAL-MISSING"""
    gone, scan = regeoref(world, tmp_path, keep=False)
    assert full_resolution(redraw(gone), scan, GEOREF) == (scan, GEOREF)

    with pytest.raises(StepFailedError) as failed:
        require_original(redraw(gone), from_original=False)

    assert failed.value.code == Errors.ORIGINAL_MISSING
    require_original(gone, from_original=False)
