"""A composite warped from its parts' originals at full resolution (placing/fullres.py, M20 §19.17)."""

from pathlib import Path
from typing import Any

import numpy
import pytest
from hcm_pipeline.geo import to_mercator
from hcm_pipeline.jobs import Done
from hcm_pipeline.placing import fullres, fullres_parts
from hcm_pipeline.placing.canvas_window import Tile
from hcm_pipeline.placing.raster_io import RGB, WARP_MEMORY_MB, Pair, WarpPlan, warp_by_pairs
from hcm_pipeline.placing.stitched import STITCHED, Stitched, publish_stitched
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import driver_of
from hcm_pipeline.steps.place import PlaceStep

from tests.fakes.world import PipelineWorld
from tests.synthetic.town import draw_map, town_lines
from tests.unit.test_placing_owner import SIZE, TOLERANCE_M, bounds, drawing, footprint, parked

CENTRE = (26.1, 44.43)
PART_W, PART_H = 160, 120
REDUCE = 4


def write(path: Path, pixels: numpy.ndarray) -> Path:
    bands = [pixels[:, :, index] for index in range(pixels.shape[2])] if pixels.ndim == RGB else [pixels]
    dataset = driver_of("GTiff").Create(str(path), pixels.shape[1], pixels.shape[0], len(bands), gdal.GDT_Byte)
    for index, band in enumerate(bands, start=1):
        dataset.GetRasterBand(index).WriteArray(band)
    dataset.Close()
    return path


def stripes(value: int) -> numpy.ndarray:
    """A part with one-pixel stripes (lost on a canvas four times smaller) and a mark of `value` in its top-left corner."""
    pixels = numpy.full((PART_H, PART_W), 255, numpy.uint8)
    pixels[:, ::2] = 0
    pixels[8:24, 8:24] = value
    return pixels


def two_parts(tmp_path: Path) -> tuple[list[Path], list[Tile], Path, list[Pair]]:
    """Two originals side by side, their canvas four times smaller, and the canvas's pairs (one canvas pixel: four metres)."""
    paths = [write(tmp_path / "left.tif", stripes(60)), write(tmp_path / "right.tif", stripes(160))]
    width, height = PART_W // REDUCE, PART_H // REDUCE
    tiles = [Tile(path, (0, 0, PART_W, PART_H), 0, index * width, 0, width, height) for index, path in enumerate(paths)]
    canvas = numpy.full((height, 2 * width), 128, numpy.uint8)
    canvas_path = write(tmp_path / "canvas.tif", canvas)
    fullres.write_parts(canvas_path, [fullres_parts.tile_part(tile) for tile in tiles], (2 * width, height))
    x, y = to_mercator(*CENTRE)
    corners = [(0, 0), (2 * width, 0), (2 * width, height), (0, height), (width, height / 2)]
    pairs = [Pair(px, py, x + px * REDUCE, y - py * REDUCE) for px, py in corners]
    return paths, tiles, canvas_path, pairs


def read(path: Path) -> tuple[numpy.ndarray, tuple[float, ...]]:
    dataset = gdal.Open(str(path))
    pixels = numpy.dstack([dataset.GetRasterBand(band).ReadAsArray() for band in range(1, dataset.RasterCount + 1)])
    transform = dataset.GetGeoTransform()
    dataset.Close()
    return pixels, transform


def at(pixels: numpy.ndarray, transform: tuple[float, ...], mx: float, my: float) -> numpy.ndarray:
    return numpy.asarray(pixels[int((my - transform[3]) / transform[5]), int((mx - transform[0]) / transform[1])])


def test_happy_path_a_composite_is_warped_from_its_originals_at_their_resolution(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-FULLRES"""
    _paths, _tiles, canvas, pairs = two_parts(tmp_path)
    said: list[str] = []
    warped = fullres.warp_composite(canvas, tmp_path / "warped.tif", WarpPlan(pairs, 1.0, tps=True, nearest=True), said.append)
    pixels, transform = read(warped)
    x, y = to_mercator(*CENTRE)
    assert transform[1] == pytest.approx(1.0)
    assert pixels.shape[1] == pytest.approx(2 * PART_W, abs=2)
    assert pixels.shape[0] == pytest.approx(PART_H, abs=2)
    assert at(pixels, transform, x + 16, y - 16)[0] == 60
    assert at(pixels, transform, x + PART_W + 16, y - 16)[0] == 160
    row = pixels[PART_H // 2, 40:120, 0]
    assert set(numpy.unique(row).tolist()) == {0, 255}
    assert "from their originals" in said[0]


def test_happy_path_the_regression_a_composite_keeps_the_originals_detail_the_canvas_lost(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-FULLRES"""
    _paths, _tiles, canvas, pairs = two_parts(tmp_path)
    plan = WarpPlan(pairs, 1.0, tps=True, nearest=True)
    full, _ = read(fullres.warp_composite(canvas, tmp_path / "full.tif", plan, lambda _line: None))
    reduced, _ = read(warp_by_pairs(canvas, tmp_path / "reduced.tif", plan))
    assert full[PART_H // 2, 40:120, 0].std() > 100
    assert reduced[PART_H // 2, 40:120, 0].std() < 5


def test_bad_path_an_original_gone_warps_the_canvas_and_says_why(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-FULLRES-ORIGINAL-GONE"""
    paths, _tiles, canvas, pairs = two_parts(tmp_path)
    paths[1].unlink()
    said: list[str] = []
    warped = fullres.warp_composite(canvas, tmp_path / "warped.tif", WarpPlan(pairs, 1.0), said.append)
    pixels, transform = read(warped)
    assert transform[1] == pytest.approx(1.0)
    assert pixels[PART_H // 2, 40:120, 0].std() < 5
    assert "right.tif is not on this computer" in said[0]


def test_bad_path_an_unreadable_original_or_a_failed_warp_falls_back_to_the_canvas(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P20-BAD-FULLRES-ORIGINAL-GONE"""
    paths, _tiles, canvas, pairs = two_parts(tmp_path)
    paths[0].write_bytes(b"not a picture")
    said: list[str] = []
    fullres.warp_composite(canvas, tmp_path / "a.tif", WarpPlan(pairs, 1.0), said.append)
    assert "left.tif cannot be read" in said[0]

    write(paths[0], stripes(60))

    def broken(*_args: object) -> Path:
        raise RuntimeError("out of disk")

    monkeypatch.setattr(fullres, "warp_parts", broken)
    said.clear()
    assert fullres.warp_composite(canvas, tmp_path / "b.tif", WarpPlan(pairs, 1.0), said.append).is_file()
    assert "warping the originals failed (out of disk)" in said[-1]


def test_bad_path_a_picture_with_no_parts_or_a_broken_record_is_warped_as_it_is(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-FULLRES-ORIGINAL-GONE"""
    _paths, _tiles, canvas, pairs = two_parts(tmp_path)
    fullres.sidecar(canvas).write_text("{not json")
    said: list[str] = []
    assert fullres.read_parts(canvas) is None
    assert fullres.warp_composite(canvas, tmp_path / "w.tif", WarpPlan(pairs, 1.0), said.append).is_file()
    fullres.sidecar(canvas).write_text('{"size": [1, 1], "parts": [{"path": "x", "box": 3, "matrix": []}]}')
    assert fullres.read_parts(canvas) is None
    fullres.sidecar(canvas).unlink()
    assert fullres.read_parts(canvas) is None
    assert said == []


def test_happy_path_the_memory_is_bounded_and_the_cache_given_back(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P20-HAPPY-FULLRES"""
    _paths, _tiles, canvas, pairs = two_parts(tmp_path)
    seen: list[dict[str, object]] = []
    real = gdal.Warp

    def spy(*args: Any, **kwargs: Any) -> Any:
        seen.append(kwargs)
        return real(*args, **kwargs)

    before = gdal.GetCacheMax()
    monkeypatch.setattr(gdal, "Warp", spy)
    fullres.warp_composite(canvas, tmp_path / "w.tif", WarpPlan(pairs, 1.0, tps=True), lambda _line: None)
    assert [kwargs["warpMemoryLimit"] for kwargs in seen] == [WARP_MEMORY_MB, WARP_MEMORY_MB]
    assert all(kwargs["cutlineDSName"] for kwargs in seen)
    assert gdal.GetCacheMax() == before


def test_happy_path_a_grey_part_joins_a_colour_one_and_the_stitched_picture_is_smaller(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-FULLRES"""
    paths, tiles, canvas, pairs = two_parts(tmp_path)
    write(paths[1], numpy.dstack([stripes(160)] * RGB))
    small = write(tmp_path / "small.tif", numpy.full((PART_H // REDUCE // 2, PART_W // REDUCE), 128, numpy.uint8))
    recorded = fullres.read_parts(canvas)
    assert recorded is not None
    fullres.write_parts(small, recorded.parts, recorded.size)
    half = [Pair(pair.px / 2, pair.py / 2, pair.mx, pair.my) for pair in pairs]
    pixels, transform = read(fullres.warp_composite(small, tmp_path / "w.tif", WarpPlan(half, 1.0, nearest=True), lambda _line: None))
    x, y = to_mercator(*CENTRE)
    assert pixels.shape[2] == RGB + 1
    assert at(pixels, transform, x + 16, y - 16).tolist()[:RGB] == [60, 60, 60]
    assert tiles[0].path == paths[0]


def test_happy_path_a_tiles_variant_and_angle_carry_its_corners(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-FULLRES"""
    turned = fullres_parts.tile_part(Tile(tmp_path / "a.tif", (10, 20, 110, 220), 1, 50, 60, 40, 20))
    corners = fullres.apply(turned.matrix, numpy.array([[10.0, 20.0], [110.0, 220.0]]))
    assert corners.tolist() == [[90.0, 60.0], [50.0, 80.0]]
    flipped = fullres_parts.tile_part(Tile(tmp_path / "a.tif", (0, 0, 100, 100), 4, 0, 0, 10, 10))
    assert fullres.apply(flipped.matrix, numpy.array([[0.0, 0.0]])).tolist() == [[10.0, 0.0]]
    tilted = fullres_parts.tile_part(Tile(tmp_path / "a.tif", (0, 0, 100, 100), 0, 0, 0, 10, 10, angle=90.0))
    assert fullres.apply(tilted.matrix, numpy.array([[0.0, 0.0]]))[0] == pytest.approx([10.0, 0.0])


def test_happy_path_an_assembled_parts_working_pixels_lead_back_to_its_original(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-FULLRES"""
    path = write(tmp_path / "page.tif", numpy.zeros((400, 800), numpy.uint8))
    placed = {0: numpy.array([[1.0, 0.0, 5.0], [0.0, 1.0, 7.0]])}
    (part,) = fullres_parts.layout_parts([path], placed, 200, [(10, 4)])
    assert part.box == (40, 16, 800, 400)
    assert fullres.apply(part.matrix, numpy.array([[40.0, 16.0]])).tolist() == [[5.0, 7.0]]


def test_happy_path_overlapping_parts_split_at_the_seam_between_their_centres(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-FULLRES"""
    first = fullres.Part(tmp_path / "a.tif", (0, 0, 100, 100), numpy.eye(3))
    second = fullres.Part(tmp_path / "b.tif", (0, 0, 100, 100), numpy.array([[1.0, 0, 60], [0, 1.0, 0], [0, 0, 1.0]]))
    same = fullres.Part(tmp_path / "c.tif", (0, 0, 100, 100), numpy.eye(3))
    left, right = fullres.cells([first, second])
    assert left[:, 0].max() == pytest.approx(80.0)
    assert right[:, 0].min() == pytest.approx(80.0)
    assert len(fullres.cells([first, same])[0]) == 4


def test_happy_path_the_owners_pairs_warp_the_parked_composites_originals(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-FULLRES"""
    ctx = parked(world, tmp_path, "affine", 8)
    image = draw_map(town_lines(), drawing())
    original = write(tmp_path / "work" / "original.tif", numpy.repeat(numpy.repeat(image, 2, axis=0), 2, axis=1))
    part = fullres.Part(original, (0, 0, 2 * SIZE[0], 2 * SIZE[1]), numpy.diag([0.5, 0.5, 1.0]))
    record = fullres.write_parts(tmp_path / "record.tif", [part], SIZE)
    ctx.publish(record, ctx.work_file(fullres.sidecar(Path(STITCHED)).name), "application/json")

    assert isinstance(PlaceStep().run(ctx), Done)
    for got, expected in zip(bounds(tmp_path / "scratch" / "warped.tif"), footprint(drawing()), strict=True):
        assert abs(got - expected) < TOLERANCE_M
    assert any("from their originals" in line for line in world.log_lines())


def test_happy_path_the_stitched_picture_keeps_its_canvas_parts(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-FULLRES"""
    ctx = parked(world, tmp_path, "affine", 8)
    canvas = write(tmp_path / "scratch" / "canvas.tif", numpy.full((40, 60), 200, numpy.uint8))
    fullres.write_parts(canvas, [fullres.Part(canvas, (0, 0, 60, 40), numpy.eye(3))], (60, 40))
    stitched = Stitched(numpy.full((40, 60), 200, numpy.uint8), "pieces", 1)

    publish_stitched(ctx, stitched, canvas=canvas)
    assert ctx.services.objects.stat(ctx.work_file(f"{STITCHED}{fullres.SUFFIX}")) is not None
    publish_stitched(ctx, stitched, written=canvas)
    assert fullres.read_parts(tmp_path / "scratch" / STITCHED) is not None
    publish_stitched(ctx, stitched, canvas=tmp_path / "nothing.tif")
