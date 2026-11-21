"""A parked series placed from the owner's pairs (`placing/owner.py`): warped where the pairs say, or parked again with too few."""

from dataclasses import replace
from pathlib import Path

import numpy
from hcm_pipeline.documents import GeorefInfo, ScanInfo
from hcm_pipeline.geo import to_lnglat
from hcm_pipeline.georef.transforms import Gcp
from hcm_pipeline.jobs import Done, JobContext, Waiting
from hcm_pipeline.placing.owner import NOT_ENOUGH, owner_pairs
from hcm_pipeline.placing.stitched import STITCHED
from hcm_pipeline.raster import gdal
from hcm_pipeline.steps.place import PlaceStep

from tests.fakes.world import PipelineWorld
from tests.synthetic.town import Drawing, draw_map, placement, town_lines, write_map
from tests.unit.placing_support import series_context

SIZE = (1100, 1000)
# The georeferencer's scan of the stitched picture: half its size, so the pairs are in half its pixels.
HALF = 0.5
SPOTS = ((100, 120), (950, 90), (1000, 880), (140, 900), (560, 480), (300, 600), (800, 400), (620, 820), (450, 200), (200, 380), (880, 650))
PARAMS = {"class": "grid", "encoding": "grey", "maxzoom": 15}
TOLERANCE_M = 15.0


def drawing() -> Drawing:
    return Drawing(placement(5.2, 3.0, (550, 500)), SIZE, "grey", street_px=5, margin_px=40)


def place_of(found: Drawing, column: float, row: float) -> tuple[float, float]:
    """The Mercator place the drawing puts at a stitched pixel."""
    linear, shift = found.matrix[:, :2], found.matrix[:, 2]
    mx, my = numpy.linalg.solve(linear, numpy.array([column, row]) - shift)
    return float(mx), float(my)


def owner_gcps(found: Drawing, count: int) -> tuple[Gcp, ...]:
    gcps = []
    for index, (column, row) in enumerate(SPOTS[:count]):
        lng, lat = to_lnglat(*place_of(found, column, row))
        gcps.append(Gcp(f"p{index}", column * HALF, row * HALF, lat, lng))
    return tuple(gcps)


def parked(world: PipelineWorld, tmp_path: Path, transform: str, count: int, keep_stitched: bool = True) -> JobContext:
    """A grid series parked with its stitched picture (kept in the job's work folder, or gone) and the owner's pairs saved."""
    ctx = series_context(world, tmp_path, ["Harti/a.tif"], PARAMS)
    found = drawing()
    image = draw_map(town_lines(), found)
    small = image[:: int(1 / HALF), :: int(1 / HALF)]
    scan = ctx.publish(write_map(tmp_path / "scan.tif", small, grey=True), ctx.version_file("scan.tif"), "image/tiff")
    if keep_stitched:
        ctx.publish(write_map(tmp_path / "kept.tif", image, grey=True), ctx.work_file(STITCHED), "image/tiff")
    info = ScanInfo(scan.path, SIZE[0] // 2, SIZE[1] // 2, "0" * 64, scan.path, 1.0)
    georef = GeorefInfo("gcps", transform, owner_gcps(found, count))
    world.store.update(world.version_path(), {"help": {"reason": "low-confidence", "note": "parked", "stitched": {"parts": 2}}})
    return replace(ctx, version=replace(ctx.version, scan=info, georef=georef))


def footprint(found: Drawing) -> tuple[float, float, float, float]:
    corners = [place_of(found, column, row) for column in (0, SIZE[0]) for row in (0, SIZE[1])]
    xs, ys = [corner[0] for corner in corners], [corner[1] for corner in corners]
    return min(xs), max(ys), max(xs), min(ys)


def bounds(path: Path) -> tuple[float, float, float, float]:
    dataset = gdal.Open(str(path))
    left, width, _, top, _, height = dataset.GetGeoTransform()
    right, bottom = left + width * dataset.RasterXSize, top + height * dataset.RasterYSize
    dataset.Close()
    return left, top, right, bottom


def test_happy_path_the_owners_pairs_place_a_parked_series_where_they_say(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-OWNER-PAIRS"""
    ctx = parked(world, tmp_path, "affine", 8)

    result = PlaceStep().run(ctx)

    assert isinstance(result, Done)
    warped = tmp_path / "scratch" / "warped.tif"
    for got, expected in zip(bounds(warped), footprint(drawing()), strict=True):
        assert abs(got - expected) < TOLERANCE_M
    version = world.version()
    report = version["archive"]
    assert isinstance(report, dict)
    assert (report["method"], report["encoding"], report["checkpointCount"]) == ("gcps", "grey", 8)
    assert report["checkpointRmseM"] < 1.0
    assert report["measuredPct"] > 50
    georef = version["georef"]
    assert isinstance(georef, dict)
    assert (georef["method"], georef["transform"]) == ("gcps", "affine")


def test_happy_path_with_the_stitched_picture_gone_a_spline_warps_the_scan(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-OWNER-PAIRS"""
    ctx = parked(world, tmp_path, "tps", 11, keep_stitched=False)

    assert isinstance(PlaceStep().run(ctx), Done)
    for got, expected in zip(bounds(tmp_path / "scratch" / "warped.tif"), footprint(drawing()), strict=True):
        assert abs(got - expected) < TOLERANCE_M * 2


def test_bad_path_too_few_pairs_park_the_series_again_with_its_help(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-OWNER-PAIRS-FEW"""
    ctx = parked(world, tmp_path, "poly2", 4)

    result = PlaceStep().run(ctx)

    assert result == Waiting("awaiting_gcps", "gcps", NOT_ENOUGH)
    version = world.version()
    assert version["state"] == "needs_gcps"
    assert "archive" not in version
    help_item = version["help"]
    assert isinstance(help_item, dict)
    assert (help_item["reason"], help_item["note"], help_item["stitched"]) == ("low-confidence", NOT_ENOUGH, {"parts": 2})
    assert not (tmp_path / "scratch" / "warped.tif").exists()

    few = ctx.version.georef
    assert few is not None
    no_scan = replace(ctx, version=replace(ctx.version, scan=None, georef=replace(few, transform="affine")))
    assert isinstance(PlaceStep().run(no_scan), Waiting)


def test_bad_path_only_the_owners_own_pairs_skip_the_placer() -> None:
    assert owner_pairs(None) is None
    assert owner_pairs(GeorefInfo("gcps", "affine")) is None
    assert owner_pairs(GeorefInfo("corners", "affine", (Gcp("a", 0, 0, 44.4, 26.1),))) is None


class _NeverRun:
    """A class placer the owner's pairs must spare: it would only park the series again."""

    def place(self, ctx: JobContext) -> Waiting:
        raise AssertionError(f"the class placer ran on {ctx.job.id} although the owner's pairs were saved")


def test_happy_path_a_stopped_series_tried_again_places_from_the_kept_pairs(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-A12-HAPPY-RETRY-STOPPED-PAIRS"""
    # docs/LESSONS.md 565: the Stop deleted the job's work files (`stitched.tif`) and the retry set the version `processing`
    # with its `georef` and `help` kept; `place` runs from the start of the walk again.
    ctx = parked(world, tmp_path, "affine", 8, keep_stitched=False)
    world.store.update(world.version_path(), {"state": "processing"})

    result = PlaceStep({"grid": _NeverRun()}).run(ctx)

    assert isinstance(result, Done)
    version = world.version()
    assert version["state"] == "processing"
    report = version["archive"]
    assert isinstance(report, dict)
    assert report["method"] == "gcps"
