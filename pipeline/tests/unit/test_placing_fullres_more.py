"""The parts record carried to a regeoref, written by grid mosaics and overviews, and rebuilt for parked series (M20 §19.18)."""

from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from typing import cast

import numpy
import pytest
from hcm_pipeline.archive.grammar import Cell
from hcm_pipeline.documents import GeorefInfo
from hcm_pipeline.geo import zoom_resolution
from hcm_pipeline.georef.transforms import Gcp
from hcm_pipeline.jobs import JobContext, StepFailedError
from hcm_pipeline.placing import autoplace, fullres, fullres_parts, grid, maps, rebuild
from hcm_pipeline.placing.canvas_window import Tile
from hcm_pipeline.placing.gridscheme import Box, CityGrid
from hcm_pipeline.placing.raster_io import Pair, WarpPlan
from hcm_pipeline.placing.series import SeriesJob, Sheet
from hcm_pipeline.raster import gdal
from hcm_pipeline.steps.warp import composite_originals

from tests.fakes.world import PipelineWorld
from tests.unit.test_placing_fullres import write
from tests.unit.test_placing_original import regeoref

SCAN = (220, 200)
MAXZOOM = 19


def corner_georef() -> GeorefInfo:
    """Four points at the scan's corners, one scan pixel 1e-5 degrees."""
    corners = [(0.0, 0.0), (SCAN[0], 0.0), (SCAN[0], SCAN[1]), (0.0, SCAN[1])]
    return GeorefInfo("gcps", "affine", tuple(Gcp(f"c{i}", x, y, 44.4 - y * 1e-5, 26.1 + x * 1e-5) for i, (x, y) in enumerate(corners)))


def composite(world: PipelineWorld, tmp_path: Path, record: bool = True) -> tuple[JobContext, Path]:
    """A regeoref of a three-sheet archive composite whose one original is twice its scan, its record kept with the version."""
    ctx, _scan = regeoref(world, tmp_path, sheets=3)
    ctx.local("x").parent.mkdir(parents=True, exist_ok=True)
    image = numpy.full((SCAN[1] * 2, SCAN[0] * 2), 255, numpy.uint8)
    image[:, ::2] = 0
    original = write(tmp_path / "original.tif", image)
    scan = write(ctx.local("scan.tif"), image[::2, ::2])
    if record:
        part = fullres.Part(original, (0, 0, SCAN[0] * 2, SCAN[1] * 2), numpy.diag([0.5, 0.5, 1.0]))
        kept = fullres.write_parts(tmp_path / "canvas.tif", [part], SCAN)
        ctx.publish(kept, ctx.version_file(fullres.VERSION_RECORD), "application/json")
    world.store.update(world.version_path(), {"output": {"maxzoom": MAXZOOM}})
    return ctx, scan


def test_happy_path_a_regeoref_of_a_composite_warps_its_originals(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-FULLRES"""
    ctx, scan = composite(world, tmp_path)
    warped = composite_originals(ctx, scan, corner_georef())
    assert warped is not None
    dataset = gdal.Open(str(warped))
    assert dataset.GetGeoTransform()[1] == pytest.approx(zoom_resolution(MAXZOOM))
    dataset.Close()
    assert any("from their originals" in line for line in world.log_lines())


def test_bad_path_a_regeoref_without_a_record_a_crop_or_a_zoom_keeps_the_usual_warp(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-FULLRES-ORIGINAL-GONE"""
    ctx, scan = composite(world, tmp_path / "none", record=False)
    assert composite_originals(ctx, scan, corner_georef()) is None
    cropped, scan = composite(world, tmp_path / "crop")
    cropped = replace(cropped, version=replace(cropped.version, crop=((44.4, 26.1), (44.41, 26.1), (44.41, 26.11))))
    assert composite_originals(cropped, scan, corner_georef()) is None
    unpublished, scan = composite(world, tmp_path / "zoom")
    world.store.update(world.version_path(), {"output": {"maxzoom": True}})
    assert composite_originals(unpublished, scan, corner_georef()) is None


def test_happy_path_a_grid_mosaic_records_each_sheets_original(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-FULLRES"""
    sheet = Sheet(tmp_path / "a.tif", "a", "a")
    item = grid.Rectified(
        sheet, Cell("x", 1, 1), numpy.zeros((4, 2)), numpy.zeros((50, 100), numpy.uint8), "line", numpy.eye(3), (400, 200)
    )
    mosaic = grid.Mosaic(numpy.zeros((30, 60), numpy.uint8), numpy.zeros((30, 60), numpy.int32), 0.0, 100.0, 2.0)

    class Scheme:
        def box(self, _cell: Cell, _order: int = 0) -> Box:
            return Box(20.0, 90.0, 120.0, 40.0)

    recorded = grid.mosaic_parts([item], cast(CityGrid, Scheme()), 0, mosaic)
    assert recorded is not None
    (part,) = recorded.parts
    assert part.clip == ((10.0, 5.0), (60.0, 5.0), (60.0, 30.0), (10.0, 30.0))
    assert fullres.apply(part.matrix, numpy.array([[100.0, 50.0]])).tolist() == [[60.0, 30.0]]
    assert fullres.Recorded.on(recorded, (30, 15))[0].clip[2] == (30.0, 15.0)
    assert grid.mosaic_parts([replace(item, to_picture=None)], cast(CityGrid, Scheme()), 0, mosaic) is None


def test_happy_path_an_overview_records_its_placed_tiles_and_a_clip_round_trips(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-FULLRES"""
    path = write(tmp_path / "t.tif", numpy.zeros((100, 200), numpy.uint8))
    recorded = fullres_parts.overview_parts([("t", path), ("u", path)], {"t": numpy.array([[2.0, 0, 0], [0, 2.0, 0]])}, 100, (400, 200))
    assert len(recorded.parts) == 1
    part = replace(recorded.parts[0], clip=((0.0, 0.0), (1.0, 0.0), (1.0, 1.0)))
    canvas = tmp_path / "c.tif"
    fullres.write_parts(canvas, [part], (400, 200))
    found = fullres.read_parts(canvas)
    assert found is not None
    assert found.parts[0].clip == part.clip


def test_bad_path_a_record_of_another_shape_warps_the_picture(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-FULLRES-ORIGINAL-GONE"""
    picture = write(tmp_path / "p.tif", numpy.zeros((20, 40), numpy.uint8))
    fullres.write_parts(picture, [fullres.Part(picture, (0, 0, 40, 20), numpy.eye(3))], (40, 40))
    said: list[str] = []
    plan = WarpPlan([Pair(0, 0, 0, 0), Pair(40, 0, 40, 0), Pair(0, 20, 0, -20)], 1.0)
    assert fullres.warp_composite(picture, tmp_path / "w.tif", plan, said.append).is_file()
    assert "does not fit this picture" in said[0]


def test_happy_and_bad_paths_a_parked_series_record_is_rebuilt_only_when_it_fits(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P20-HAPPY-FULLRES, S-P20-BAD-FULLRES-ORIGINAL-GONE"""
    ctx, _scan = regeoref(world, tmp_path, sheets=3)
    picture = tmp_path / "stitched.tif"
    part = fullres.Part(picture, (0, 0, 10, 10), numpy.eye(3))
    monkeypatch.setattr(rebuild, "_built", lambda _ctx, _builder: fullres.Recorded((part,), (100, 50)))
    world.store.update(world.version_path(), {"help": {"stitched": {"method": "grid"}}})
    assert rebuild.rebuilt(ctx, picture, (50, 25)) is True
    assert fullres.read_parts(picture) is not None
    assert rebuild.rebuilt(ctx, tmp_path / "other.tif", (50, 50)) is False

    def refused(_ctx: JobContext, _builder: object) -> None:
        raise StepFailedError("apiError.imagery.archiveMissing", "the archive is not here")

    monkeypatch.setattr(rebuild, "_built", refused)
    assert rebuild.rebuilt(ctx, tmp_path / "third.tif", (50, 25)) is False
    world.store.update(world.version_path(), {"help": {"stitched": {"method": "single"}}})
    assert rebuild.rebuilt(ctx, tmp_path / "fourth.tif", (50, 25)) is False
    assert any("could not be read again" in line for line in world.log_lines())


def test_happy_path_each_layout_rebuilds_its_record(world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P20-HAPPY-FULLRES"""
    ctx, _scan = regeoref(world, tmp_path, sheets=3)
    part = fullres.Part(tmp_path / "a.tif", (0, 0, 10, 10), numpy.eye(3))
    layout = SimpleNamespace(size=(40, 20))
    monkeypatch.setattr(maps, "atlas_parts", lambda _sheets: SimpleNamespace(originals=(part,), layout=layout))
    monkeypatch.setattr(maps, "pieces_parts", lambda _sheets: None)
    monkeypatch.setattr(maps, "overview_mosaic", lambda _ctx, _series: SimpleNamespace(originals=(part,), canvas=numpy.zeros((20, 40))))
    tile = Tile(tmp_path / "a.tif", (0, 0, 10, 10), 0, 0, 0, 10, 10)
    monkeypatch.setattr(autoplace, "proposed", lambda _ctx, _series: SimpleNamespace(tiles=lambda _longest: ([(0, tile)], (10, 10))))
    monkeypatch.setattr(grid, "parsed", lambda _series: grid.Parsed([], None, 0))
    series = cast(SeriesJob, SimpleNamespace(sheets=()))
    assert rebuild.BUILDERS["atlas"](ctx, series) == fullres.Recorded((part,), (40, 20))
    assert rebuild.BUILDERS["pieces"](ctx, series) is None
    found = rebuild.BUILDERS["overview"](ctx, series)
    assert found is not None
    assert found.size == (40, 20)
    names = rebuild.BUILDERS["names"](ctx, series)
    assert names is not None
    assert names.size == (10, 10)
    assert rebuild.BUILDERS["grid"](ctx, series) is None
    monkeypatch.setattr(maps, "paged", lambda _ctx, _series: "a locked PDF")
    monkeypatch.setattr(rebuild, "series_of", lambda _ctx: series)
    world.store.update(world.version_path(), {"help": {"stitched": {"method": "atlas"}}})
    assert rebuild.rebuilt(ctx, tmp_path / "x.tif", (40, 20)) is False


def test_happy_path_a_framed_grid_rebuilds_its_record(world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P20-HAPPY-FULLRES"""
    ctx, _scan = regeoref(world, tmp_path, sheets=3)
    record = fullres.Recorded((fullres.Part(tmp_path / "a.tif", (0, 0, 10, 10), numpy.eye(3)),), (20, 10))
    monkeypatch.setattr(grid, "parsed", lambda _series: SimpleNamespace(cells=["cell"], scheme="scheme"))
    monkeypatch.setattr(grid, "framed", lambda cells, _scheme: list(cells))
    monkeypatch.setattr(grid, "quarter_order", lambda _rectified, _scheme: 0)
    monkeypatch.setattr(grid, "mosaic_of", lambda _rectified, _scheme, _order: SimpleNamespace(record=record))

    assert rebuild.BUILDERS["grid"](ctx, cast(SeriesJob, SimpleNamespace(sheets=()))) == record
