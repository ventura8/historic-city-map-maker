"""Atlas stitched waiting pictures (docs/research/M22-help-calibrate.md §4.1)."""

from dataclasses import replace
from pathlib import Path

import numpy
import pytest
from hcm_pipeline.jobs import JobContext, Waiting
from hcm_pipeline.placing import autoplace, stitched
from hcm_pipeline.placing.autostitch import Proposal
from hcm_pipeline.placing.quality import Quality
from hcm_pipeline.placing.series import SeriesJob
from hcm_pipeline.steps.place import PlaceStep

from tests.fakes.world import PipelineWorld, dig
from tests.synthetic.town import TownSpec, town_lines, write_map
from tests.unit.placing_support import originals, series_context
from tests.unit.test_placing_assemble import cut_pages, texture, town_map


def test_happy_path_an_atlas_that_does_not_place_itself_leaves_its_stitched_picture_with_the_pages_left_out(
    world: PipelineWorld, tmp_path: Path
) -> None:
    """Scenarios: S-P22-HAPPY-STITCHED-PREVIEW, S-P22-BAD-ATLAS-PAGES-APART, S-P22-HAPPY-GEOREF-SCAN"""
    # Another town's streets on the pages: no placement holds; one blank page joins nothing.
    names = [f"Atlas/{index}.tif" for index in range(1, 6)]
    ctx = series_context(world, tmp_path, names, {"class": "atlas", "encoding": "grey"}, lines=town_lines(TownSpec(seed=41)))
    (originals(ctx) / "Atlas").mkdir()
    page_images = [*cut_pages(town_map((1000, 1000)), 2, 2).values(), numpy.full((500, 500), 250, numpy.uint8)]
    for name, image in zip(names, page_images, strict=True):
        write_map(originals(ctx) / name, numpy.dstack([image] * 3), grey=True)

    assert isinstance(PlaceStep().run(ctx), Waiting)

    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    record = help_item["stitched"]
    assert isinstance(record, dict)
    # Laid out by its page numbers and seams (M20 §19); the blank page is told apart.
    assert record["method"] == "names"
    assert (record["parts"], record["joined"], record["leftOutCount"]) == (5, 4, 1)
    assert record["leftOut"] == [{"name": "5.tif", "reason": "blank"}]
    # Four 500 px pages: the seams' sub-pixel offsets may round the canvas up by a pixel, never more.
    assert (record["width"], record["height"]) == (pytest.approx(1000, abs=1), pytest.approx(1000, abs=1))
    assert str(record["previewPath"]).endswith("/stitched.jpg")
    assert str(record["previewPath"]) in world.gcs.objects
    # The georeferencer opens it like any frame: its scan and the city window's OpenStreetMap lines.
    version = world.version()
    scan, reference = version["scan"], version["reference"]
    assert isinstance(scan, dict)
    assert isinstance(reference, dict)
    assert (scan["width"], scan["height"]) == (record["width"], record["height"])
    assert str(scan["previewPath"]).endswith("/scan-preview.jpg")
    assert str(reference["osmPath"]) in world.gcs.objects


def test_happy_path_overlapping_atlas_pages_are_joined_by_their_overlaps(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P22-HAPPY-JOIN-QUALITY"""
    proposed = autoplace.proposed

    def doubtful(job: JobContext, series: SeriesJob) -> Proposal:
        return replace(proposed(job, series), quality=Quality(100.0, 0.4, 1.0, 0.0, "check"))

    # The older joins (M20 §19.6 step 4): the automatic layout is not sure, the overlaps place every page.
    monkeypatch.setattr(autoplace, "proposed", doubtful)
    whole = texture((900, 900))
    pages = [whole[0:500, 0:500], whole[0:500, 400:900], whole[400:900, 0:500], whole[400:900, 400:900]]
    names = [f"Atlas/{index}.tif" for index in range(1, 5)]
    ctx = series_context(world, tmp_path, names, {"class": "atlas", "encoding": "grey"}, lines=town_lines(TownSpec(seed=41)))
    for path, image in zip(names, pages, strict=True):
        (originals(ctx) / path).parent.mkdir(parents=True, exist_ok=True)
        write_map(originals(ctx) / path, numpy.dstack([image] * 3), grey=True)

    assert isinstance(PlaceStep().run(ctx), Waiting)

    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    record = help_item["stitched"]
    assert isinstance(record, dict)
    assert record["joined"] == 4
    assert record["joins"]["links"] == 3


def test_happy_path_a_preview_is_never_larger_than_the_georeferencers(world: PipelineWorld, tmp_path: Path) -> None:
    ctx = series_context(world, tmp_path, ["a.tif"], {"class": "single", "encoding": "grey"})
    record = stitched.publish_stitched(ctx, stitched.Stitched(numpy.full((10, 5000), 200, numpy.uint8), "single", 1, (), 2.0))

    assert record["previewScale"] == pytest.approx(stitched.PREVIEW_PX / 5000)
    assert record["metresPerPx"] == 2.0


def _pair(index: int, x: float, y: float) -> dict[str, object]:
    return {"id": f"j{index:03d}", "pixel": {"x": x, "y": y}, "geo": {"lat": 44.43, "lng": 26.1}, "enabled": True, "origin": "auto"}


def test_happy_path_suggested_pairs_follow_the_stitched_picture_into_the_shrunk_scan(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P22-HAPPY-PAIRS-IN-SCAN"""
    # 1895, 2026-11-12: the canvas was 16963 px wide, the scan 8192, and the pairs stayed in the canvas's pixels.
    monkeypatch.setattr(stitched, "SCAN_MAX_PX", 500)
    ctx = series_context(world, tmp_path, ["a.tif"], {"class": "pieces", "encoding": "grey"})
    pairs = [_pair(0, 800.0, 400.0), _pair(1, 10.0, 990.0)]
    ctx.update_version({"suggestions": {"method": "junctions", "tiles": {"matched": 2, "total": 9}, "pairs": pairs}})

    stitched.publish_stitched(ctx, stitched.Stitched(numpy.full((1000, 1000), 200, numpy.uint8), "pieces", 1))

    assert dig(world.version(), "scan", "width") == 500
    moved = dig(world.version(), "suggestions", "pairs")
    assert isinstance(moved, list)
    assert [pair["pixel"] for pair in moved] == [{"x": 400.0, "y": 200.0}, {"x": 5.0, "y": 495.0}]
    assert dig(world.version(), "suggestions", "tiles") == {"matched": 2, "total": 9}


def test_happy_path_a_single_maps_pairs_in_its_original_pixels_land_on_its_working_copy() -> None:
    """Scenarios: S-P22-HAPPY-PAIRS-IN-SCAN"""
    record = stitched.in_scan({"pairs": [_pair(0, 4000.0, 2000.0)]}, (1 / 4.0) * 1.0, (1500, 1000))

    assert record["pairs"] == [{**_pair(0, 0.0, 0.0), "pixel": {"x": 1000.0, "y": 500.0}}]


def test_bad_path_a_suggested_pair_outside_the_scan_is_never_offered() -> None:
    """Scenarios: S-P22-BAD-PAIRS-OUTSIDE-SCAN"""
    suggested = {"tiles": {"matched": 3, "total": 3}, "pairs": [_pair(0, 9000.0, 10.0), _pair(1, -1.0, 5.0), _pair(2, 100.0, 50.0), "x"]}

    record = stitched.in_scan(suggested, 1.0, (8192, 6000))

    kept = record["pairs"]
    assert isinstance(kept, list)
    assert [pair["id"] for pair in kept] == ["j002"]
    assert record["tiles"] == {"matched": 1, "total": 3}
    assert stitched.in_scan({"pairs": "none"}, 1.0, (10, 10))["pairs"] == []
