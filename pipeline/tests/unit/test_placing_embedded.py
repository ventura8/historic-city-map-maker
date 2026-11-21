"""Class a, a file that carries its own georeference (docs/research/M20-import-local.md §3 a), and the reference ladder (§1.7)."""

import math
from pathlib import Path

import numpy
import pytest
from hcm_pipeline.archive.classify import classify
from hcm_pipeline.archive.model import FileRow, Probe
from hcm_pipeline.geo import MercatorBox, to_mercator
from hcm_pipeline.jobs import Done, Waiting
from hcm_pipeline.placing import embedded, reference
from hcm_pipeline.placing.checks import Checked
from hcm_pipeline.placing.output import Placement, resolution_of, suggestions
from hcm_pipeline.placing.raster_io import Pair, dpi_of
from hcm_pipeline.placing.series import series_of
from hcm_pipeline.raster import osr
from hcm_pipeline.rasters import GeoTiff, srs_wkt, write_geotiff
from hcm_pipeline.steps.gather import SHEETS
from hcm_pipeline.steps.place import PlaceStep

from tests.fakes.world import CITY, LAYER_ID, PipelineWorld
from tests.synthetic.scenes import CENTRE
from tests.synthetic.town import Drawing, draw_map, town_lines
from tests.unit.placing_support import originals, series_context

METRES_PER_PX = 5.0
SIZE = (1000, 1000)


def town_geotiff(path: Path, shift_m: float = 0.0, epsg: int = 3857, world_file: bool = False) -> Path:
    """The town drawn north up at about 5 m a pixel of `epsg`, georeferenced by its own tags, or by a world file with no `.prj`."""
    to_system = _affine_to(epsg)
    cx, cy = (numpy.array(to_mercator(*CENTRE)) @ to_system[:, :2].T) + to_system[:, 2]
    left, top = cx - 500 * METRES_PER_PX, cy + 500 * METRES_PER_PX
    to_pixels = numpy.array([[1 / METRES_PER_PX, 0.0, -left / METRES_PER_PX], [0.0, -1 / METRES_PER_PX, top / METRES_PER_PX]])
    matrix = to_pixels @ numpy.vstack((to_system, [0.0, 0.0, 1.0]))
    image = draw_map(town_lines(), Drawing(matrix, SIZE, "grey", street_px=5, margin_px=0))
    left += shift_m
    transform = (left, METRES_PER_PX, 0.0, top, 0.0, -METRES_PER_PX)
    write_geotiff(path, GeoTiff([image[:, :, 0]], None if world_file else transform, epsg))
    if world_file:
        path.with_suffix(".tfw").write_text(f"{METRES_PER_PX}\n0\n0\n{-METRES_PER_PX}\n{left + 2.5}\n{top - 2.5}\n", encoding="utf-8")
    return path


def _affine_to(epsg: int) -> numpy.ndarray:
    """Mercator to `epsg` around the town, as the affine that fits it best (exact for Mercator itself)."""
    source, target = osr.SpatialReference(), osr.SpatialReference()
    source.ImportFromEPSG(3857)
    target.ImportFromEPSG(epsg)
    for srs in (source, target):
        srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    convert = osr.CoordinateTransformation(source, target)
    cx, cy = to_mercator(*CENTRE)
    points = numpy.array([(cx + dx, cy + dy) for dx in (-4000.0, 0.0, 4000.0) for dy in (-4000.0, 0.0, 4000.0)])
    moved = numpy.array([convert.TransformPoint(float(x), float(y))[:2] for x, y in points])
    design = numpy.column_stack((points, numpy.ones(len(points))))
    solution, *_ = numpy.linalg.lstsq(design, moved, rcond=None)
    return numpy.asarray(solution.T, numpy.float64)


def test_happy_path_a_georeferenced_file_is_warped_and_measured_against_openstreetmap(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-EMBEDDED"""
    ctx = series_context(world, tmp_path, ["geo.tif"], {"class": "georeferenced", "encoding": "grey", "maxzoom": 15})
    town_geotiff(originals(ctx) / "geo.tif")

    result = PlaceStep().run(ctx)

    assert isinstance(result, Done)
    report = world.version()["archive"]
    assert isinstance(report, dict)
    assert report["method"] == "embedded"
    assert report["checkpointRmseM"] < 10
    assert report["checkpointCount"] > 20


def test_happy_path_a_world_file_with_no_prj_is_read_in_the_one_system_that_lands_in_the_city(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-EMBEDDED"""
    ctx = series_context(world, tmp_path, ["stereo.tif"], {"class": "georeferenced", "encoding": "grey"})
    path = town_geotiff(originals(ctx) / "stereo.tif", epsg=3844, world_file=True)
    window = reference.city_window(ctx)
    assert window is not None

    assert embedded.system_of(path, window) == srs_wkt(3844)
    assert isinstance(PlaceStep().run(ctx), Done)


def test_bad_path_a_georeference_that_disagrees_with_openstreetmap_waits_for_a_look(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-EMBEDDED-DISAGREES"""
    ctx = series_context(world, tmp_path, ["off.tif"], {"class": "georeferenced", "encoding": "grey"})
    town_geotiff(originals(ctx) / "off.tif", shift_m=60.0)

    result = PlaceStep().run(ctx)

    assert isinstance(result, Waiting)
    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    assert "disagrees with OpenStreetMap" in str(help_item["note"])


def test_bad_path_a_world_file_whose_system_cannot_be_told_waits(world: PipelineWorld, tmp_path: Path) -> None:
    ctx = series_context(world, tmp_path, ["nowhere.tif"], {"class": "georeferenced", "encoding": "grey"})
    path = originals(ctx) / "nowhere.tif"
    write_geotiff(path, GeoTiff([numpy.full((10, 10), 200, numpy.uint8)], None))
    path.with_suffix(".tfw").write_text("1\n0\n0\n-1\n5\n5\n", encoding="utf-8")

    assert isinstance(PlaceStep().run(ctx), Waiting)
    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    assert help_item["note"] == embedded.NO_SYSTEM

    world.store.seed(f"cities/{CITY}", {"name": {"ro": "B", "en": "B"}})
    assert isinstance(PlaceStep().run(ctx), Waiting)
    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    assert help_item["note"] == embedded.NO_WINDOW


def test_happy_path_a_ruler_without_openstreetmap_reports_no_figure(world: PipelineWorld, tmp_path: Path) -> None:
    ctx = series_context(world, tmp_path, ["geo.tif"], {"class": "georeferenced", "encoding": "grey"}, lines=None)
    town_geotiff(originals(ctx) / "geo.tif")

    assert isinstance(PlaceStep().run(ctx), Done)
    report = world.version()["archive"]
    assert isinstance(report, dict)
    assert "checkpointRmseM" not in report
    assert report["checkpointCount"] == 0


def test_happy_path_a_calibrated_layer_is_a_rung_of_the_ladder_with_its_own_error(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-LADDER"""
    ctx = series_context(world, tmp_path, ["map.tif"], {"class": "single", "encoding": "grey", "referenceLayerIds": [LAYER_ID]})
    cog = town_geotiff(tmp_path / "cog.tif")
    world.store.seed(f"cities/{CITY}/layers/{LAYER_ID}", {"currentVersion": "v-ladder"})
    world.store.seed(f"cities/{CITY}/layerVersions/v-ladder", {"archive": {"checkpointRmseM": 4.0}})
    ctx.services.objects.upload_file(cog, f"rasters/{CITY}/{LAYER_ID}/v-ladder/cog.tif", "image/tiff")
    window = reference.city_window(ctx)
    assert window is not None

    rungs = reference.references(ctx, [LAYER_ID, "no-such-layer"], window, 20.0)

    assert [rung.label for rung in rungs] == [f"layer:{LAYER_ID}", "osm"]
    assert rungs[0].error_m == 4.0
    assert len(rungs[0].places) > 50
    assert reference.window_resolution(MercatorBox(0, 0, 1500, 900), 1000) == 2.0


def test_happy_path_a_box_away_from_the_city_is_asked_for_on_its_own(world: PipelineWorld, tmp_path: Path) -> None:
    ctx = series_context(world, tmp_path, ["map.tif"], {"class": "single", "encoding": "grey"})
    cx, cy = to_mercator(*CENTRE)
    far = MercatorBox(cx + 50_000, cy, cx + 52_000, cy + 2_000)

    found = reference.osm_reference(ctx, far, 20.0)

    assert found is not None
    assert len(list((tmp_path / "work" / "osm").glob("*.json"))) == 1


def test_happy_path_the_reports_parts_and_the_suggestions_are_well_formed(world: PipelineWorld, tmp_path: Path) -> None:
    ctx = series_context(world, tmp_path, ["a.tif"], {"class": "single", "encoding": "lineart", "paperTransparent": False})
    pairs = [Pair(1.0, 2.0, *to_mercator(*CENTRE))] * 2

    record = suggestions(ctx, pairs, [0.9, 1.4], 7)
    placed = Placement("match", "lineart", Checked(None, 0, 0, 120.0, None), True, None, False).as_record()

    made = record["suggestions"]
    assert isinstance(made, dict)
    assert made["tiles"] == {"matched": 2, "total": 7}
    assert placed["paperTransparent"] is False
    assert placed["measuredPct"] == 100.0
    assert resolution_of({"maxzoom": 25}) == pytest.approx(156_543.03392804097 / 2**21)
    assert series_of(ctx).paper_transparent is False
    assert dpi_of(write_geotiff(tmp_path / "plain.tif", GeoTiff([numpy.zeros((4, 4), numpy.uint8)], None))) is None


def test_happy_path_a_series_staged_from_the_jobs_files_when_this_run_did_not_gather(world: PipelineWorld, tmp_path: Path) -> None:
    ctx = series_context(world, tmp_path, ["a.tif"], {"class": "single", "encoding": "colour"})
    local = tmp_path / "scratch" / SHEETS
    ctx.services.objects.upload_file(local, ctx.work_file(SHEETS), "application/json")
    local.unlink()

    series = series_of(ctx)

    assert [sheet.name for sheet in series.sheets] == ["a.tif"]
    assert series.encoding == "colour"


def row(path: str, dpi: float = 600.0) -> FileRow:
    return FileRow(path, 1000, path, Probe("jpeg", 4800, 6900, 3, 8, "rgb", dpi=dpi))


def test_happy_path_scanner_ordered_pieces_become_one_series_per_sheet() -> None:
    """Scenarios: S-P20-HAPPY-PIECES"""
    quadrats = [
        f"Harti/1895.jpg/{quad}_quadrat/img{number}.jpg" for quad, number in zip((1, 1, 1, 1, 2, 2, 2, 2), range(362, 370), strict=True)
    ]
    rows = [*map(row, quadrats), *(row(f"Harti/Bucati/scan_{number:03d}.jpg") for number in range(3))]

    found = classify(rows)

    pieces = sorted((series.key, len(series.files)) for series in found.series if series.series_class == "pieces")
    assert pieces == [("pieces:Harti/1895.jpg", 8), ("pieces:Harti/Bucati", 3)]
    assert next(series.year for series in found.series if series.key == "pieces:Harti/1895.jpg") == 1895


def test_bad_path_two_scans_in_a_scanners_order_are_single_maps() -> None:
    found = classify([row("Harti/x/img01.jpg"), row("Harti/x/img02.jpg")])

    assert sorted(series.series_class for series in found.series) == ["single", "single"]
    assert math.isclose(len(found.series), 2)
