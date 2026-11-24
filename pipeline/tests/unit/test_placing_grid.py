"""Class b, a sheet series placed from its names on the city grid (docs/research/M20-import-local.md §3 b)."""

import math
from pathlib import Path

import numpy
import pytest
from hcm_pipeline.archive.grammar import Cell
from hcm_pipeline.geo import to_mercator
from hcm_pipeline.jobs import Done, JobContext, Waiting
from hcm_pipeline.placing import grid
from hcm_pipeline.placing.frame import content_frame
from hcm_pipeline.placing.gridscheme import QUARTER_ORDERS, CityGrid, scheme_for
from hcm_pipeline.placing.overview import MosaicReport
from hcm_pipeline.placing.series import Sheet
from hcm_pipeline.placing.stitched import NO_FRAME, NO_JOIN
from hcm_pipeline.steps.place import PlaceStep

from tests.fakes.world import CITY, PipelineWorld
from tests.synthetic.scenes import CENTRE
from tests.synthetic.town import Drawing, Line, TownSpec, draw_map, town_lines, write_map
from tests.unit.placing_support import answer_with, originals, series_context
from tests.unit.test_placing_overview import _make_overview, _make_tile
from tests.unit.test_placing_overview_colour import _tinted

LETTERS = "ABCD"
TRUE_ORDER = 3
SHEET_PX = 250
MARGIN = 30
ANGLE = math.radians(1.5)


def grid_to_mercator() -> numpy.ndarray:
    """The truth: grid metres to Mercator, grid (1000, -1000) on the town's centre, turned 1.5 degrees, Mercator's scale."""
    cx, cy = to_mercator(*CENTRE)
    k = 1.0 / math.cos(math.radians(CENTRE[1]))
    linear = k * numpy.array([[math.cos(ANGLE), -math.sin(ANGLE)], [math.sin(ANGLE), math.cos(ANGLE)]])
    return numpy.column_stack((linear, numpy.array([cx, cy]) - linear @ numpy.array([1000.0, -1000.0])))


def sheet_drawing(cell: Cell, truth: numpy.ndarray) -> Drawing:
    """Mercator to the sheet's pixels: back to grid metres, then onto the sheet's frame (1 m a pixel, a slight shear)."""
    box = CityGrid().box(cell, TRUE_ORDER)
    inverse = numpy.linalg.inv(numpy.vstack((truth, [0, 0, 1])))[:2]
    to_sheet = numpy.array([[1.0, 0.004, MARGIN - box.west], [0.0, -1.0, MARGIN + box.north]])
    return Drawing(
        to_sheet @ numpy.vstack((inverse, [0, 0, 1])),
        (SHEET_PX + 2 * MARGIN, SHEET_PX + 2 * MARGIN),
        "grey",
        10,
        0.0,
        MARGIN,
        cartouche=False,
    )


def sheet_name(cell: Cell) -> str:
    return f"Plan/{cell.row}/{cell.row}{LETTERS[cell.col]}'{cell.quarter}.tif"


CELLS = [Cell("quarter", row, col, quarter) for row in range(1, 5) for col in range(4) for quarter in range(1, 5)]


def grid_series(
    world: PipelineWorld, tmp_path: Path, lines: list[Line] | None = None, params: dict[str, object] | None = None
) -> JobContext:
    """Sixty-four quarter sheets of the town (or of `lines`) on the true grid, read in `TRUE_ORDER`."""
    names = [sheet_name(cell) for cell in CELLS]
    ctx = series_context(world, tmp_path, names, {"class": "grid", "encoding": "lineart", "maxzoom": 15, **(params or {})})
    for cell, name in zip(CELLS, names, strict=True):
        write_sheet(originals(ctx) / name, cell, town_lines() if lines is None else lines)
    return ctx


def write_sheet(target: Path, cell: Cell, lines: list[Line]) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    write_map(target, draw_map(lines, sheet_drawing(cell, grid_to_mercator())), grey=True)


def test_happy_path_a_sheet_series_is_placed_from_its_names_its_quarter_order_read_from_its_seams(
    world: PipelineWorld, tmp_path: Path
) -> None:
    """Scenarios: S-P20-HAPPY-GRID"""
    ctx = grid_series(world, tmp_path)

    result = PlaceStep().run(ctx)

    assert isinstance(result, Done)
    report = world.version()["archive"]
    assert isinstance(report, dict)
    assert report["method"] == "grid"
    assert 0.0 < report["seamScore"] <= 1.0
    assert report["paperTransparent"] is False
    assert report["checkpointRmseM"] < 15
    assert report["checksDropped"] == 0
    assert '"order": 3' in (tmp_path / "scratch" / "placed.json").read_text(encoding="utf-8")
    source = world.version()["source"]
    assert isinstance(source, dict)
    assert source["placedCount"] == 64


def test_happy_path_a_grid_the_owner_confirmed_places_the_series_without_a_search(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-GRID"""
    ctx = grid_series(world, tmp_path, params={"gridId": "bucharest-grid"})
    truth = grid_to_mercator()
    scale = math.hypot(truth[0, 0], truth[1, 0])
    record = {"originX": truth[0, 2], "originY": truth[1, 2], "scale": scale, "rotationDeg": math.degrees(ANGLE)}
    world.store.seed(f"cities/{CITY}/grids/bucharest-grid", record)

    assert isinstance(PlaceStep().run(ctx), Done)


def test_bad_path_a_series_of_another_town_does_not_prove_its_grid(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-GRID-NOT-PROVED"""
    # No fit at all: the grid waits for three sheets.
    ctx = grid_series(world, tmp_path, lines=town_lines(TownSpec(seed=41, block_m=140.0)))

    result = PlaceStep().run(ctx)

    assert isinstance(result, Waiting)
    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    assert help_item["note"] == grid.NOT_PROVED


def test_happy_path_a_fitted_grid_that_does_not_prove_is_rendered_from_its_names_for_the_owner(
    world: PipelineWorld, tmp_path: Path
) -> None:
    """Scenarios: S-P20-HAPPY-GRID-BY-NAMES"""
    # OpenStreetMap has half the streets: the fit is found, but its checks do not hold.
    ctx = grid_series(world, tmp_path)
    answer_with(world, town_lines()[::2])

    result = PlaceStep().run(ctx)

    assert isinstance(result, Done)
    version = world.version()
    report = version["archive"]
    assert isinstance(report, dict)
    assert report["method"] == "grid-names"
    assert report["checksDropped"] > 0
    assert 0.0 < report["seamScore"] <= 1.0
    assert "help" not in version


def test_bad_path_sheets_without_frames_or_a_scheme_wait_for_a_person(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-FRAME-NOT-FOUND"""
    ctx = series_context(world, tmp_path, ["Plan/1/1A'1.tif", "Plan/12-07.tif"], {"class": "grid", "encoding": "grey"})
    for name in ("Plan/1/1A'1.tif", "Plan/12-07.tif"):
        (originals(ctx) / name).parent.mkdir(parents=True, exist_ok=True)
        write_map(originals(ctx) / name, numpy.full((60, 60, 3), 250, numpy.uint8), grey=True)

    assert isinstance(PlaceStep().run(ctx), Waiting)
    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    assert help_item["reason"] == "frame-not-found"
    # Finding of 2026-11-14 (the 1:500 sets of 1960-71): the series waits with its sheets as a picture, so the georeferencer shows a scan.
    assert help_item["stitched"]["method"] == "atlas"
    assert "scan" in world.version()

    other = series_context(world, tmp_path / "b", ["Plan/12-07.tif"], {"class": "grid", "encoding": "grey"})
    (originals(other) / "Plan").mkdir(parents=True, exist_ok=True)
    write_map(originals(other) / "Plan/12-07.tif", numpy.full((60, 60, 3), 250, numpy.uint8), grey=True)
    assert isinstance(PlaceStep().run(other), Waiting)
    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    assert help_item["note"] == grid.NO_SCHEME
    assert help_item["stitched"]["method"] == "single"
    assert "scan" in world.version()


def test_happy_path_the_city_grid_places_quarters_blocks_and_cells() -> None:
    city = CityGrid()

    quarter = city.box(Cell("quarter", 17, 0, 3), 0)
    block = city.box(Cell("block", 29, -3, 0, 2))
    cell = city.box(Cell("folder-row", -1, 2))

    assert (quarter.west, quarter.north, quarter.width, quarter.height) == (0.0, -8750.0, 250.0, 250.0)
    assert (block.west, block.north, block.width) == (-1500.0, -14500.0, 1000.0)
    assert (cell.west, cell.north, cell.south) == (1000.0, 500.0, 0.0)
    assert len(set(QUARTER_ORDERS)) == 8
    assert scheme_for("row-col") is None
    assert scheme_for("quarter", 400.0) == CityGrid(400.0)


def test_bad_path_a_grid_record_that_is_not_a_similarity_is_ignored() -> None:
    mosaic = grid.Mosaic(numpy.zeros((2, 2), numpy.uint8), numpy.zeros((2, 2), numpy.int32), 0.0, 0.0)

    assert grid._grid_matrix({"originX": "x"}, mosaic) is None
    assert grid._grid_matrix({}, mosaic) is None
    assert grid.quarter_order([], CityGrid()) == 0
    assert grid.seam_score([], CityGrid(), 0) == pytest.approx(0.0)


def test_happy_path_a_sheet_without_a_neat_line_is_framed_by_its_drawings_extent() -> None:
    """Scenarios: S-P22-HAPPY-CONTENT-FRAME"""
    sheet = numpy.full((400, 300), 250, numpy.uint8)
    for x in range(40, 260, 12):
        sheet[50:350, x : x + 3] = 20
    for y in range(50, 350, 15):
        sheet[y : y + 3, 40:260] = 20

    corners = content_frame(sheet, 220 / 300, 2.0)
    wrong = content_frame(sheet, 2.0)

    assert corners is not None
    assert corners[0] == pytest.approx((81, 101), abs=8)
    assert corners[2] == pytest.approx((521, 701), abs=8)
    assert wrong is None
    assert content_frame(numpy.full((100, 100), 250, numpy.uint8), 1.0) is None


def test_bad_path_a_grid_that_does_not_prove_keeps_its_mosaic_as_one_stitched_picture(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P22-HAPPY-STITCHED-PREVIEW"""
    ctx = grid_series(world, tmp_path, lines=town_lines(TownSpec(seed=41, block_m=140.0)))
    blank = originals(ctx) / sheet_name(CELLS[0])
    write_map(blank, numpy.full((60, 60, 3), 250, numpy.uint8), grey=True)

    assert isinstance(PlaceStep().run(ctx), Waiting)

    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    record = help_item["stitched"]
    assert isinstance(record, dict)
    assert record["method"] == "grid"
    assert record["metresPerPx"] == grid.MOSAIC_M
    assert (record["parts"], record["joined"]) == (64, 63)
    assert record["leftOut"][0]["reason"] == "no-frame"


def test_bad_path_without_city_bounds_the_grid_cannot_be_searched(world: PipelineWorld, tmp_path: Path) -> None:
    ctx = grid_series(world, tmp_path)
    city = world.store.documents[f"cities/{CITY}"]
    world.store.seed(f"cities/{CITY}", {**city, "bounds": None})

    result = PlaceStep().run(ctx)

    assert isinstance(result, Waiting)
    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    assert help_item["note"] == grid.NOT_PROVED


def _sample_rectified(path: Path) -> grid.Rectified:
    sheet = Sheet(path, path.name, None, path.name)
    cell = Cell("quarter", 1, 0, 1)
    corners = numpy.array([[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]], numpy.float64)
    return grid.Rectified(sheet, cell, corners, numpy.full((8, 8), 200, numpy.uint8))


def test_wait_picture_prefers_an_overview_mosaic_when_tiles_match(
    world: PipelineWorld, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    ctx = series_context(world, tmp_path, ["a.tif"], {"class": "grid", "encoding": "grey"})
    rectified = [_sample_rectified(tmp_path / "a.tif"), _sample_rectified(tmp_path / "b.tif")]
    mosaic = grid.Mosaic(numpy.full((4, 4), 255, numpy.uint8), numpy.full((4, 4), -1, numpy.int32), 0.0, 0.0)
    canvas = numpy.full((12, 12), 180, numpy.uint8)
    report = MosaicReport(placed=["a.tif"], unplaced=["b.tif"], rms_px=1.25)
    monkeypatch.setattr(grid, "_framed_overview", lambda _ctx, _items: tmp_path / "overview.tif")
    monkeypatch.setattr(grid, "overview_canvas", lambda _tiles, _path, _opts: (canvas, report))

    picture = grid._wait_picture(ctx, mosaic, rectified, (("gone", NO_FRAME),), False)

    assert picture.method == "overview"
    assert picture.canvas is canvas
    assert picture.parts == 3
    assert picture.left_out[0] == ("b.tif", NO_JOIN)
    assert picture.left_out[-1] == ("gone", NO_FRAME)
    assert picture.joins is not None
    assert picture.joins.links == 1
    assert picture.joins.rms_px == pytest.approx(1.25)


def test_overview_picture_returns_none_when_canvas_cannot_place_tiles(
    world: PipelineWorld, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    ctx = series_context(world, tmp_path, ["a.tif"], {"class": "grid", "encoding": "grey"})
    rectified = [_sample_rectified(tmp_path / "a.tif")]
    monkeypatch.setattr(grid, "_framed_overview", lambda _ctx, _items: tmp_path / "overview.tif")
    monkeypatch.setattr(grid, "overview_canvas", lambda _tiles, _path, _opts: None)

    assert grid._overview_picture(ctx, rectified, (), False) is None


def _coloured_sheets(tmp_path: Path, colour: bool) -> tuple[Path, list[grid.Rectified]]:
    """An overview and its four quarters written to disk, tinted (three bands) or grey."""
    overview = _make_overview((800, 800))
    picture = _tinted(overview) if colour else overview
    write_map(tmp_path / "area-1895.tif", picture if colour else numpy.dstack([picture] * 3), grey=not colour)
    rectified = []
    for row, col in ((0, 0), (0, 1), (1, 0), (1, 1)):
        tile = _make_tile(picture, row, col, (2, 2), upscale=2)
        path = write_map(tmp_path / f"r{row}c{col}.tif", tile if colour else numpy.dstack([tile] * 3), grey=not colour)
        rectified.append(_sample_rectified(path))
    return tmp_path / "area-1895.tif", rectified


def test_happy_path_a_colour_grid_series_keeps_its_colour_on_the_overview(
    world: PipelineWorld, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Scenarios: S-P20-HAPPY-OVERVIEW-COLOUR"""
    ctx = series_context(world, tmp_path, ["a.tif"], {"class": "grid", "encoding": "colour"})
    overview, rectified = _coloured_sheets(tmp_path, colour=True)
    monkeypatch.setattr(grid, "_framed_overview", lambda _ctx, _items: overview)

    picture = grid._overview_picture(ctx, rectified, (), True)

    assert picture is not None
    assert picture.method == "overview"
    assert picture.canvas.ndim == 3
    bands = picture.canvas.astype(int)
    assert float(numpy.mean(numpy.abs(bands[:, :, 0] - bands[:, :, 2]))) > 20


def test_bad_path_a_grey_grid_series_on_its_overview_stays_one_band(
    world: PipelineWorld, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Scenarios: S-P20-BAD-OVERVIEW-GREY-STAYS-GREY"""
    ctx = series_context(world, tmp_path, ["a.tif"], {"class": "grid", "encoding": "grey"})
    overview, rectified = _coloured_sheets(tmp_path, colour=False)
    monkeypatch.setattr(grid, "_framed_overview", lambda _ctx, _items: overview)

    picture = grid._overview_picture(ctx, rectified, (), False)

    assert picture is not None
    assert picture.canvas.ndim == 2


def test_bad_path_a_grid_with_most_sheets_unframed_goes_to_the_tile_wizard(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-GRID-FEW-FRAMED

    Finding of 2026-11-14 (plan cadastral 1911-1914, 20 of 100 sheets framed): the series is laid out as an atlas for the tile
    wizard (`layout-check`) instead of a grid of the few framed sheets that asks for points and leaves the rest out for good."""
    ctx = grid_series(world, tmp_path)
    names = [sheet_name(cell) for cell in CELLS]
    for name in names[: int(len(names) * 0.7)]:
        write_map(originals(ctx) / name, numpy.full((SHEET_PX, SHEET_PX, 3), 250, numpy.uint8), grey=True)

    result = PlaceStep().run(ctx)

    assert isinstance(result, Waiting)
    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    assert help_item["reason"] == "layout-check"


def test_bad_path_a_grid_with_a_few_sheets_unframed_waits_with_them_named(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-NEATLINE-UNSURE

    Lesson of 2026-11-24 (plan cadastral 1911-1914): a sheet with no confident frame is never left off the map in silence; the
    series waits in Help calibrate with the framed sheets' mosaic and the others named."""
    ctx = grid_series(world, tmp_path)
    names = [sheet_name(cell) for cell in CELLS]
    for name in names[:2]:
        write_map(originals(ctx) / name, numpy.full((SHEET_PX, SHEET_PX, 3), 250, numpy.uint8), grey=True)

    result = PlaceStep().run(ctx)

    assert isinstance(result, Waiting)
    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    assert help_item["reason"] == "frame-not-found"
    assert help_item["note"] == grid.UNFRAMED.format(count=2, total=64)
    stitched = help_item["stitched"]
    assert stitched["leftOutCount"] == 2
    assert {item["reason"] for item in stitched["leftOut"]} == {NO_FRAME}
    assert "archive" not in world.version()
