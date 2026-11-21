"""The block compositor (docs/research/M8-join-interfaces.md §3, `merge` 3 and 4)."""

from pathlib import Path

import numpy
import numpy.typing
import pytest
from hcm_pipeline.documents import JoinSeam
from hcm_pipeline.geo import Grid
from hcm_pipeline.jobs import InterruptedRunError
from hcm_pipeline.join.canvas import DatasetSource, Patch, PixelBox
from hcm_pipeline.join.compose import (
    BLEND_HALF_WIDTH_M,
    BLOCK_PX,
    CUT_HALF_WIDTH_M,
    Layer,
    Levels,
    blocks,
    closes,
    compose,
    compose_block,
    half_widths,
    signed_distance,
    upsampled,
    weight_of,
)
from hcm_pipeline.join.tone import Linear, Tone
from hcm_pipeline.raster import gdal

CELLS = (10, 16)
RATIO = 8.0
LEVELS = Levels(RATIO, RATIO)
CELL_M = 13.6
BOX = PixelBox(0, 0, 128, 80)


class Flat:
    """A warped part of one grey level, valid in `x0` to `x1`; it counts its reads."""

    def __init__(self, grey: int, x0: int = 0, x1: int = 128) -> None:
        self.grey, self.x0, self.x1, self.reads = grey, x0, x1, 0

    def read(self, box: PixelBox) -> Patch:
        self.reads += 1
        width, height = box.size
        alpha = numpy.zeros((height, width), numpy.uint8)
        alpha[:, max(self.x0 - box.x0, 0) : max(self.x1 - box.x0, 0)] = 255
        return Patch(numpy.where(alpha > 0, self.grey, 0).astype(numpy.uint8), alpha)


def report(measured: bool = True, after: float | None = 10.0) -> JoinSeam:
    return JoinSeam("a", "b", measured, measured, 12, 2, 5.0, 40.0, after)


def owner_split(column: int = 8) -> numpy.typing.NDArray[numpy.uint8]:
    owner = numpy.ones(CELLS, numpy.uint8)
    owner[:, column:] = 2
    return owner


def layer(source: Flat, weight: numpy.typing.NDArray[numpy.float32], line: Linear | None = None) -> Layer:
    covers = numpy.ones(CELLS, numpy.bool_)
    covers[:, : source.x0 // 8] = False
    covers[:, source.x1 // 8 :] = False
    return Layer(source, Tone(line or Linear(), numpy.zeros(CELLS, numpy.float32)), weight, covers)


def weights(owner: numpy.typing.NDArray[numpy.uint8], part: int, width: float = BLEND_HALF_WIDTH_M) -> numpy.typing.NDArray[numpy.float32]:
    return weight_of(owner, part, numpy.full(CELLS, width, numpy.float32), CELL_M)


def test_happy_path_a_seam_blends_wide_only_when_it_closed() -> None:
    assert closes(report())
    assert not closes(report(after=16.0))
    assert not closes(report(after=None))
    assert not closes(report(measured=False))


def test_happy_path_half_widths_are_wide_near_a_closed_seam_and_a_cut_elsewhere() -> None:
    found = half_widths(owner_split(), [(0, 1, report())], CELL_M)

    assert found[5, 8] == BLEND_HALF_WIDTH_M
    assert found[5, 0] == CUT_HALF_WIDTH_M


def test_bad_path_an_unmeasured_seam_is_a_hard_cut() -> None:
    found = half_widths(owner_split(), [(0, 1, report(False, None))], CELL_M)

    assert bool((found == CUT_HALF_WIDTH_M).all())


def test_happy_path_distance_is_signed_and_crosses_zero_at_the_edge() -> None:
    found = signed_distance(owner_split() == 1)

    assert found[5, 7] == pytest.approx(0.5)
    assert found[5, 8] == pytest.approx(-0.5)
    assert found[5, 0] > found[5, 7]


def test_happy_path_the_weights_of_two_parts_add_to_one_across_the_seam() -> None:
    owner = owner_split()

    first, second = weights(owner, 0), weights(owner, 1)

    assert numpy.allclose(first + second, 1.0)
    assert first[5, 0] == 1.0
    assert second[5, 0] == 0.0
    assert 0.5 < float(first[5, 7]) < 1.0


def test_happy_path_cells_become_pixels_bilinearly_with_their_centres_in_place() -> None:
    cells = numpy.array([[0.0, 8.0]] * 2, numpy.float32)

    found = upsampled(cells, RATIO, PixelBox(0, 0, 16, 2))

    assert float(found[0, 0]) == 0.0
    assert float(found[0, 3]) == pytest.approx(0.0, abs=0.51)
    assert float(found[0, 8]) == pytest.approx(4.5, abs=0.51)
    assert float(found[0, 15]) == 8.0


def test_happy_path_a_block_normalises_over_the_valid_pixels_with_no_translucent_line() -> None:
    owner = owner_split()
    # The seam's feather runs into part b's no data: its share goes to part a, nothing is left dark or see-through.
    a, b = Flat(100), Flat(200, 66, 128)

    grey, alpha = compose_block([layer(a, weights(owner, 0)), layer(b, weights(owner, 1))], BOX, LEVELS)

    assert bool((alpha == 255).all())
    assert grey[40, 10] == 100
    assert grey[40, 62] == 100
    assert grey[40, 120] == 200
    # Within the blend the tone runs between both, never below or above them.
    assert int(grey.min()) >= 100
    assert int(grey.max()) <= 200


def test_happy_path_a_blocks_tones_are_applied() -> None:
    owner = owner_split(16)

    grey, _ = compose_block([layer(Flat(100), weights(owner, 0), Linear(0.5, 10.0))], BOX, LEVELS)

    assert grey[40, 60] == 60


def test_happy_path_a_part_with_no_weight_in_a_block_is_not_read() -> None:
    owner = owner_split()
    a, b = Flat(100), Flat(200)
    layers = [layer(a, weights(owner, 0)), layer(b, weights(owner, 1))]

    compose_block(layers, PixelBox(0, 0, 16, 16), LEVELS)

    assert (a.reads, b.reads) == (1, 0)


def test_bad_path_a_hole_the_weighted_parts_left_is_filled_by_whichever_covers_it() -> None:
    owner = owner_split(16)
    # Part a owns the cells but its corrected edge moved off them: part b, weightless here, has the pixels.
    a, b = Flat(100, 0, 64), Flat(200, 64, 128)

    grey, alpha = compose_block([layer(a, weights(owner, 0)), layer(b, numpy.zeros(CELLS, numpy.float32))], BOX, LEVELS)

    assert bool((alpha == 255).all())
    assert grey[40, 100] == 200
    assert b.reads == 1


def test_bad_path_outside_every_frame_there_is_no_data() -> None:
    owner = owner_split(16)
    a = Flat(100, 0, 40)

    grey, alpha = compose_block([layer(a, weights(owner, 0))], BOX, LEVELS)

    assert alpha[40, 100] == 0
    assert grey[40, 100] == 0
    assert alpha[40, 10] == 255


def test_happy_path_blocks_cover_the_mosaic_without_overlap() -> None:
    found = blocks(BLOCK_PX + 10, 20)

    assert found == [PixelBox(0, 0, BLOCK_PX, 20), PixelBox(BLOCK_PX, 0, BLOCK_PX + 10, 20)]


def test_happy_path_the_mosaic_is_grey_and_last_band_alpha_on_its_grid(tmp_path: Path) -> None:
    owner = owner_split(16)
    grid = Grid(100.0, 200.0, 2.0, 128, 80)
    ticks: list[float] = []

    target = compose(tmp_path / "mosaic.tif", grid, [layer(Flat(100, 0, 64), weights(owner, 0))], LEVELS, ticks.append)

    dataset = gdal.Open(str(target))
    assert dataset.RasterCount == 2
    assert dataset.GetGeoTransform() == grid.geotransform()
    assert dataset.GetRasterBand(2).GetColorInterpretation() == gdal.GCI_AlphaBand
    assert dataset.GetRasterBand(1).ReadAsArray()[10, 10] == 100
    assert dataset.GetRasterBand(2).ReadAsArray()[10, 100] == 0
    dataset.Close()
    assert ticks == [1.0]
    source = DatasetSource(target)
    assert source.read(PixelBox(0, 0, 2, 2)).grey.tolist() == [[100, 100], [100, 100]]
    source.close()


def test_bad_path_a_run_told_to_stop_stops_between_blocks(tmp_path: Path) -> None:
    owner = owner_split(16)

    def stop(_done: float) -> None:
        raise InterruptedRunError("stop")

    with pytest.raises(InterruptedRunError):
        compose(tmp_path / "mosaic.tif", Grid(0.0, 0.0, 2.0, 128, 80), [layer(Flat(100), weights(owner, 0))], LEVELS, stop)
