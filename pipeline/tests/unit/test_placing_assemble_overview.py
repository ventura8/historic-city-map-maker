"""Pieces and atlases overview mosaic and page-size helpers (docs/research/M20-import-local.md)."""

from dataclasses import replace
from pathlib import Path
from typing import cast

import cv2
import numpy
import pytest
from hcm_pipeline.archive import model
from hcm_pipeline.documents import GeorefInfo, ScanInfo
from hcm_pipeline.geo import to_lnglat, to_mercator
from hcm_pipeline.georef.transforms import Gcp
from hcm_pipeline.jobs import Done, JobContext, Waiting
from hcm_pipeline.placing import assemble, maps
from hcm_pipeline.placing.checks import Checked
from hcm_pipeline.placing.output import Placement
from hcm_pipeline.placing.raster_io import read_working
from hcm_pipeline.placing.stitched import Stitched, publish_stitched
from hcm_pipeline.raster import gdal
from hcm_pipeline.steps.place import PlaceStep

from tests.fakes.world import PipelineWorld
from tests.synthetic.scenes import CENTRE
from tests.synthetic.town import TownSpec, town_lines, write_map
from tests.unit.placing_support import originals, series_context
from tests.unit.test_placing_assemble import town_map
from tests.unit.test_placing_overview import _make_overview, _make_tile
from tests.unit.test_placing_overview_colour import _tinted


def test_happy_path_pieces_with_an_overview_use_it_as_the_series_picture(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-OVERVIEW"""
    overview = _make_overview((800, 800))
    names = [f"Sheet/r{row}c{col}.tif" for row, col in ((1, 1), (1, 2), (2, 1), (2, 2))]
    ctx = series_context(world, tmp_path, names, {"class": "pieces", "encoding": "grey"}, lines=town_lines(TownSpec(seed=77)))
    root = originals(ctx)
    (root / "Sheet").mkdir()
    write_map(root / "area-1895.tif", numpy.dstack([overview] * 3), grey=True)
    for index, (row, col) in enumerate(((0, 0), (0, 1), (1, 0), (1, 1))):
        image = _make_tile(overview, row, col, (2, 2), upscale=2)
        write_map(root / names[index], numpy.dstack([image] * 3), grey=True)

    result = PlaceStep().run(ctx)

    assert isinstance(result, Waiting)
    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    record = help_item["stitched"]
    assert isinstance(record, dict)
    assert record["method"] == "overview"
    assert record["method"] in model.STITCH_METHODS
    assert "overview" in model.ARCHIVE_PLACE_METHODS
    assert record["joined"] >= 3


def _colour_pieces(world: PipelineWorld, tmp_path: Path) -> JobContext:
    """A colour pieces series cut from a tinted overview that lies beside it in the archive."""
    overview = _tinted(_make_overview((800, 800)))
    names = [f"Sheet/r{row}c{col}.tif" for row, col in ((1, 1), (1, 2), (2, 1), (2, 2))]
    ctx = series_context(world, tmp_path, names, {"class": "pieces", "encoding": "colour"}, lines=town_lines(TownSpec(seed=77)))
    root = originals(ctx)
    (root / "Sheet").mkdir()
    write_map(root / "area-1895.tif", overview)
    for index, (row, col) in enumerate(((0, 0), (0, 1), (1, 0), (1, 1))):
        write_map(root / names[index], _make_tile(overview, row, col, (2, 2), upscale=2))
    return ctx


def _coloured(path: Path) -> None:
    """The raster keeps three distinct colour bands (a grey canvas would give equal ones)."""
    bands = read_working(path, 400).image
    assert bands.ndim == 3
    assert float(numpy.mean(numpy.abs(bands[:, :, 0].astype(int) - bands[:, :, 2].astype(int)))) > 20


def _owner_georef(scan: ScanInfo) -> GeorefInfo:
    """Eight of the owner's pairs over the scan: one metre a pixel, north up, on the town's centre."""
    cx, cy = to_mercator(*CENTRE)
    spots = [
        (scan.width * fx, scan.height * fy)
        for fx, fy in ((0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9), (0.5, 0.5), (0.3, 0.7), (0.7, 0.3), (0.6, 0.8))
    ]
    gcps = []
    for index, (x, y) in enumerate(spots):
        lng, lat = to_lnglat(cx + x, cy - y)
        gcps.append(Gcp(f"p{index}", x, y, lat, lng))
    return GeorefInfo("gcps", "affine", tuple(gcps))


def test_happy_path_a_colour_series_on_its_overview_keeps_its_colour(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-OVERVIEW-COLOUR"""
    ctx = _colour_pieces(world, tmp_path)

    result = PlaceStep().run(ctx)

    assert isinstance(result, Waiting)
    record = world.version()["help"]
    assert isinstance(record, dict)
    assert isinstance(record["stitched"], dict)
    assert record["stitched"]["method"] == "overview"
    for picture in (maps.CANVAS, "stitched.tif", "scan.tif"):
        _coloured(ctx.local(picture))


def test_happy_path_a_colour_series_placed_from_its_overview_renders_in_colour(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-OVERVIEW-COLOUR"""
    ctx = _colour_pieces(world, tmp_path)
    assert isinstance(PlaceStep().run(ctx), Waiting)
    scan = ScanInfo.of(world.version()["scan"])
    placed = replace(ctx, version=replace(ctx.version, scan=scan, georef=_owner_georef(scan)))

    result = PlaceStep().run(placed)

    assert isinstance(result, Done)
    warped = ctx.local("warped.tif")
    dataset = gdal.Open(str(warped))
    colour_bands = [dataset.GetRasterBand(index + 1).GetColorInterpretation() for index in range(dataset.RasterCount)]
    dataset.Close()
    assert colour_bands[:3] == [gdal.GCI_RedBand, gdal.GCI_GreenBand, gdal.GCI_BlueBand]
    _coloured(warped)


def test_bad_path_a_blank_overview_falls_back_to_joining_pieces(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-OVERVIEW-BLANK"""
    whole = town_map((1000, 1000))
    cuts = [whole[0:600, 0:600], whole[0:600, 400:1000], whole[400:1000, 0:600], whole[400:1000, 400:1000]]
    names = [f"Bucata/img{index:03d}.tif" for index in range(4)]
    ctx = series_context(world, tmp_path, names, {"class": "pieces", "encoding": "grey"})
    root = originals(ctx)
    (root / "Bucata").mkdir()
    write_map(root / "blank-overview.tif", numpy.dstack([numpy.full((400, 400), 255, numpy.uint8)] * 3), grey=True)
    for name, image in zip(names, cuts, strict=True):
        write_map(root / name, numpy.dstack([image] * 3), grey=True)

    result = PlaceStep().run(ctx)

    assert isinstance(result, Done)
    report = world.version()["archive"]
    assert isinstance(report, dict)
    assert report["method"] == "pieces"


def test_happy_path_atlas_pages_with_an_overview_use_it_as_the_series_picture(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-OVERVIEW-ATLAS"""
    overview = _make_overview((800, 800))
    names = [f"Atlas/r{row}c{col}.tif" for row, col in ((1, 1), (1, 2), (2, 1), (2, 2))]
    ctx = series_context(world, tmp_path, names, {"class": "atlas", "encoding": "grey"}, lines=town_lines(TownSpec(seed=77)))
    root = originals(ctx)
    (root / "Atlas").mkdir()
    write_map(root / "area-1895.tif", numpy.dstack([overview] * 3), grey=True)
    for index, (row, col) in enumerate(((0, 0), (0, 1), (1, 0), (1, 1))):
        image = _make_tile(overview, row, col, (2, 2), upscale=2)
        write_map(root / names[index], numpy.dstack([image] * 3), grey=True)

    result = PlaceStep().run(ctx)

    assert isinstance(result, Waiting)
    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    record = help_item["stitched"]
    assert isinstance(record, dict)
    assert record["method"] == "overview"
    assert record["joined"] >= 3


def test_bad_path_an_atlas_with_a_blank_overview_keeps_its_page_layout(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-OVERVIEW-ATLAS-BLANK"""
    whole = town_map((1000, 1000))
    cuts = [whole[0:600, 0:600], whole[0:600, 400:1000], whole[400:1000, 0:600], whole[400:1000, 400:1000]]
    names = [f"Atlas/img{index:03d}.tif" for index in range(4)]
    ctx = series_context(world, tmp_path, names, {"class": "atlas", "encoding": "grey"})
    root = originals(ctx)
    (root / "Atlas").mkdir()
    write_map(root / "blank-overview.tif", numpy.dstack([numpy.full((400, 400), 255, numpy.uint8)] * 3), grey=True)
    for name, image in zip(names, cuts, strict=True):
        write_map(root / name, numpy.dstack([image] * 3), grey=True)

    result = PlaceStep().run(ctx)

    record = world.version()["archive"] if isinstance(result, Done) else world.version()["help"]
    if not isinstance(result, Done):
        assert isinstance(record, dict)
        record = record["stitched"]
    assert isinstance(record, dict)
    assert record["method"] == "atlas"


def test_happy_path_a_pages_frame_is_cropped_and_the_page_size_follows_the_count() -> None:
    page = numpy.full((300, 200), 250, numpy.uint8)
    cv2.rectangle(page, (20, 20), (180, 280), 0, 3)

    assert assemble.frame_crop(page).shape[0] < 270
    assert assemble.frame_crop(numpy.full((50, 50), 250, numpy.uint8)).shape == (50, 50)
    assert maps.page_px(95) == assemble.CANVAS_MAX_PX // 11
    assert maps.page_px(10_000) == assemble.PAGE_PX


def test_bad_path_a_stitch_method_the_server_does_not_know_is_refused_before_publishing(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-STITCH-METHOD-UNKNOWN"""
    # harti.zip 1895: `overview` was missing from the server's list, so the worker's write was refused after the work (lesson 569).
    stitched = Stitched(numpy.zeros((4, 4), numpy.uint8), "made-up", 1)

    with pytest.raises(ValueError, match="unknown stitch method"):
        publish_stitched(cast(JobContext, None), stitched)


def test_bad_path_a_left_out_reason_the_server_does_not_know_is_refused_before_publishing() -> None:
    """Scenarios: S-P20-BAD-STITCH-METHOD-UNKNOWN"""
    # 1844-1846 Borroczyn, 2026-11-12: the same class of refusal as lesson 569; every list `help.stitched` writes is checked first.
    stitched = Stitched(numpy.zeros((4, 4), numpy.uint8), "atlas", 2, (("a.jpg", "no-join"), ("b.jpg", "lost")))

    with pytest.raises(ValueError, match="unknown left-out reasons"):
        publish_stitched(cast(JobContext, None), stitched)


def test_bad_path_a_place_method_the_server_does_not_know_is_refused_before_the_write() -> None:
    """Scenarios: S-P20-BAD-STITCH-METHOD-UNKNOWN"""
    # The archive report's `method` is checked against the server's `ARCHIVE_PLACE_METHODS` as the stitch's is (lesson 569).
    placement = Placement("made-up", "lineart", Checked(None, 0, 0, 100.0, None), True)

    with pytest.raises(ValueError, match="unknown place method"):
        placement.as_record()
    assert Placement("overview", "lineart", Checked(None, 0, 0, 100.0, None), True).as_record()["method"] == "overview"
