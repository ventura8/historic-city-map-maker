"""The canvas composed part by part, each in its own box, holds the pixels it held composed on whole canvases (resource audit, item 2)."""

import math
from collections.abc import Sequence
from pathlib import Path

import cv2
import numpy
from hcm_pipeline.images import UInt8Array
from hcm_pipeline.placing import assemble
from hcm_pipeline.placing.assemble import Layout, Pages, compose_canvas, compose_parts
from hcm_pipeline.rasters import GeoTiff, write_geotiff


def whole_canvases(images: list[UInt8Array], layout: Layout) -> UInt8Array:
    """The canvas as it was composed before: every part warped onto a whole canvas, the owners resized to it (paper white past a
    part's edge in every band: it was white in the first band only, a coloured sliver along a colour atlas's rim)."""
    canvas = assemble._blank(any(image.ndim == 3 for image in images), layout.size)
    sizes = [(image.shape[1], image.shape[0]) for image in images]
    owners = cv2.resize(assemble._owners(layout, sizes), layout.size, interpolation=cv2.INTER_NEAREST)
    for index, matrix in layout.placed.items():
        whole = assemble._like(images[index], canvas)
        warped = cv2.warpAffine(whole, matrix, layout.size, flags=cv2.INTER_LINEAR, borderValue=assemble.PAPER)
        mine = owners == index
        canvas[mine] = warped[mine]
    return numpy.asarray(canvas, numpy.uint8)


def pages(count: int, size: tuple[int, int], colour: bool) -> list[UInt8Array]:
    rng = numpy.random.default_rng(5)
    width, height = size
    return [numpy.asarray(rng.integers(0, 255, (height, width, 3) if colour else (height, width)), numpy.uint8) for _ in range(count)]


def turned(angle_deg: float, scale: float, at: tuple[float, float]) -> numpy.ndarray:
    angle = math.radians(angle_deg)
    return numpy.array(
        [[scale * math.cos(angle), -scale * math.sin(angle), at[0]], [scale * math.sin(angle), scale * math.cos(angle), at[1]]]
    )


def test_happy_path_an_atlas_on_whole_cells_is_the_same_canvas_pixel_for_pixel() -> None:
    """Scenarios: S-P31-HAPPY-CANVAS-BUDGET"""
    sheets = pages(6, (211, 149), colour=True)
    # A canvas whose sides are no multiple of the owners' step: the nearest cell of a pixel is not its own eighth.
    placed = {index: numpy.array([[1.0, 0.0, (index % 3) * 211.0], [0.0, 1.0, (index // 3) * 149.0]]) for index in range(6)}
    layout = Layout(placed, (3 * 211 + 5, 2 * 149 + 3))

    assert numpy.array_equal(compose_canvas(sheets, layout), whole_canvases(sheets, layout))


def test_happy_path_turned_parts_that_overlap_keep_their_seams_and_a_grey_part_fills_a_colour_canvas() -> None:
    """Scenarios: S-P31-HAPPY-CANVAS-BUDGET"""
    parts = [*pages(2, (300, 220), colour=True), *pages(1, (260, 240), colour=False)]
    placed = {0: turned(4.0, 1.0, (30.0, 10.0)), 1: turned(-7.0, 0.8, (240.0, 90.0)), 2: turned(12.0, 1.3, (120.0, 230.0))}
    layout = Layout(placed, (640, 560))

    composed, before = compose_canvas(parts, layout), whole_canvases(parts, layout)

    # The same seams; a warp into a box rounds a turned part's samples as a warp onto the canvas does, to a grey level or two.
    differing = numpy.abs(composed.astype(int) - before.astype(int))
    assert composed.shape == (560, 640, 3)
    assert int(differing.max()) <= 2
    assert float((differing > 0).mean()) < 0.01


def test_bad_path_a_part_off_the_canvas_and_a_part_over_its_edge_leave_the_rest_as_it_was() -> None:
    """Scenarios: S-P31-BAD-CANVAS-OFF-EDGE"""
    parts = pages(3, (120, 90), colour=False)
    placed = {0: turned(0.0, 1.0, (10.0, 10.0)), 1: turned(0.0, 1.0, (-500.0, -500.0)), 2: turned(0.0, 1.0, (150.0, 60.0))}
    layout = Layout(placed, (200, 120))

    composed = compose_canvas(parts, layout)

    assert numpy.array_equal(composed, whole_canvases(parts, layout))
    # A part owns the cells of the owners' grid whose centre it holds: its inside, here, cell for cell.
    assert numpy.array_equal(composed[16:96, 16:128], parts[0][6:86, 6:118])
    assert numpy.array_equal(composed[64:120, 152:200], parts[2][4:60, 2:50])
    assert int(composed[:8, :].min()) == 255


def framed(sheet: UInt8Array) -> UInt8Array:
    """The sheet inside a dark frame six pixels wide."""
    border = numpy.zeros_like(sheet)
    border[6:-6, 6:-6] = sheet[6:-6, 6:-6]
    return border


def written(folder: Path, sheets: list[UInt8Array]) -> list[Path]:
    return [
        write_geotiff(folder / f"p{index}.tif", GeoTiff([sheet[:, :, band] for band in range(3)])) for index, sheet in enumerate(sheets)
    ]


def sizes_of(images: Sequence[UInt8Array]) -> list[tuple[int, int]]:
    return [(image.shape[1], image.shape[0]) for image in images]


def grid_of_four() -> Layout:
    return Layout(
        {index: numpy.array([[1.0, 0.0, (index % 2) * 180.0], [0.0, 1.0, (index // 2) * 130.0]]) for index in range(4)}, (360, 260)
    )


def test_happy_path_pages_held_grey_and_read_again_in_colour_make_the_same_canvas(tmp_path: Path) -> None:
    """Scenarios: S-P31-HAPPY-ATLAS-PAGES"""
    sheets = pages(4, (180, 130), colour=True)
    # A dark frame around the second page: its crop is kept, so the page read again is cut the same way.
    sheets[1] = framed(sheets[1])

    found = Pages.read(written(tmp_path, sheets), 400)

    held = list(map(assemble.frame_crop, sheets))
    sizes = sizes_of(found.grey)
    assert found.colour
    assert sizes == sizes_of(held)
    assert numpy.array_equal(found.page(1), held[1])
    assert numpy.array_equal(compose_parts(found.page, sizes, found.colour, grid_of_four()), compose_canvas(held, grid_of_four()))


def test_bad_path_grey_pages_make_a_grey_canvas_and_a_page_off_the_layout_is_never_read(tmp_path: Path) -> None:
    """Scenarios: S-P31-BAD-CANVAS-OFF-EDGE"""
    sheets = pages(2, (90, 70), colour=False)
    paths = [write_geotiff(tmp_path / f"g{index}.tif", GeoTiff([sheet])) for index, sheet in enumerate(sheets)]
    found = Pages.read(paths, 400)
    asked: list[int] = []

    def page(index: int) -> UInt8Array:
        asked.append(index)
        return found.page(index)

    canvas = compose_parts(page, [(90, 70), (90, 70)], found.colour, Layout({0: turned(0.0, 1.0, (0.0, 0.0))}, (90, 70)))

    assert not found.colour
    assert canvas.shape == (70, 90)
    assert asked == [0]
