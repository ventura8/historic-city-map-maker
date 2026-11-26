"""A placed series laid on its overview again with the owner's pairs kept (`placing/restitch.py`, DECISIONS-for-review.md §216)."""

from dataclasses import replace
from pathlib import Path

import pytest
from hcm_pipeline.jobs import Done, JobContext, Waiting
from hcm_pipeline.placing import assemble, restitch
from hcm_pipeline.placing.maps import Assembled
from hcm_pipeline.steps.place import PlaceStep

from tests.fakes.world import PipelineWorld
from tests.synthetic.town import draw_map, town_lines
from tests.unit.placing_support import originals
from tests.unit.test_placing_owner import TOLERANCE_M, bounds, drawing, footprint, parked


def _asked(ctx: JobContext) -> JobContext:
    folder = originals(ctx) / "Harti"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "a.tif").write_bytes(b"II*\x00")
    return replace(ctx, job=replace(ctx.job, params={**ctx.job.params, restitch.RESTITCH: True}))


def test_happy_path_a_series_laid_on_its_overview_again_keeps_the_owners_pairs(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P20-HAPPY-RESTITCH"""
    ctx = _asked(parked(world, tmp_path, "affine", 8, keep_stitched=False))
    image = draw_map(town_lines(), drawing())
    names = ("a.tif", "b.tif")
    made = Assembled(image, assemble.Layout({0: assemble.IDENTITY, 1: assemble.IDENTITY}, image.shape[1::-1], (), 0), names, "overview")
    monkeypatch.setattr(restitch, "overview_mosaic", lambda _ctx, _series: made)

    result = PlaceStep().run(ctx)

    assert isinstance(result, Done)
    for got, expected in zip(bounds(tmp_path / "scratch" / "warped.tif"), footprint(drawing()), strict=True):
        assert abs(got - expected) < TOLERANCE_M
    version = world.version()
    help_item, scan = version["help"], version["scan"]
    assert isinstance(help_item, dict)
    assert isinstance(scan, dict)
    stitched = help_item["stitched"]
    assert (stitched["method"], stitched["joined"], stitched["leftOutCount"]) == ("overview", 2, 0)
    assert scan["width"] == image.shape[1]


def test_bad_path_a_series_the_overview_no_longer_places_waits_with_its_pairs(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P20-BAD-RESTITCH-NO-OVERVIEW"""
    ctx = _asked(parked(world, tmp_path, "affine", 8))
    monkeypatch.setattr(restitch, "overview_mosaic", lambda _ctx, _series: None)

    result = PlaceStep().run(ctx)

    assert isinstance(result, Waiting)
    version = world.version()
    help_item = version["help"]
    assert isinstance(help_item, dict)
    assert (version["state"], help_item["reason"], help_item["note"]) == ("needs_gcps", "low-confidence", restitch.NO_OVERVIEW)
    assert not (tmp_path / "scratch" / "warped.tif").exists()


def test_a_series_not_asked_is_placed_from_its_pairs_alone(world: PipelineWorld, tmp_path: Path) -> None:
    ctx = parked(world, tmp_path, "affine", 8)
    assert not restitch.asked(ctx)
    assert isinstance(PlaceStep().run(ctx), Done)
