"""The sheets' working copies, their variants and the series' cell (docs/research/M20-import-local.md §19.2); a page's content box."""

from pathlib import Path

import cv2
import numpy
import pytest
from hcm_pipeline.placing import frame, sheetwork

from tests.synthetic.sheets import SheetsSpec, dressed, make_series, map_of
from tests.synthetic.town import write_map


def test_happy_path_a_framed_page_is_cropped_inside_its_frame_and_its_margins() -> None:
    """Scenarios: S-P20-HAPPY-STITCH-ABUTTING"""
    content = map_of(SheetsSpec(rows=1, cols=1, cell=(400, 300)))[:, :, 0]
    page = dressed(numpy.dstack([content] * 3), SheetsSpec(margin_px=30, frame=True), 0, 1.0)[:, :, 0]

    left, top, right, bottom = frame.content_box(page)

    assert (left, top) == pytest.approx((34, 34), abs=3)
    assert (right - left, bottom - top) == pytest.approx((400, 300), abs=6)


def test_happy_path_paper_margins_alone_are_trimmed() -> None:
    page = numpy.full((200, 300), 250, numpy.uint8)
    dots = numpy.random.default_rng(3).random((120, 200)) < 0.3
    page[40:160, 50:250][dots] = 60

    assert frame.content_box(page) == pytest.approx((50, 40, 250, 160), abs=5)


def test_bad_path_an_outline_inside_the_drawing_is_no_frame() -> None:
    content = map_of(SheetsSpec(rows=1, cols=1, cell=(400, 300)))[:, :, 0]

    assert frame.content_box(content) == (0, 0, 400, 300)


def test_bad_path_a_street_along_the_edge_is_content_not_margin() -> None:
    page = numpy.full((200, 300), 60, numpy.uint8)
    page[:3, :] = 250
    page[:, ::12] = 250

    assert frame.content_box(page) == (0, 0, 300, 200)


def test_happy_path_a_blank_page_is_told_apart() -> None:
    assert frame.is_blank(numpy.full((100, 100), 245, numpy.uint8))
    assert not frame.is_blank(
        numpy.where(numpy.arange(100)[:, None] % 9 == 0, 30, 245).astype(numpy.uint8) * numpy.ones((1, 100), numpy.uint8)
    )


@pytest.mark.parametrize("variant", range(8))
def test_happy_path_each_variant_undoes_the_same_turn_and_mirror(variant: int) -> None:
    picture = numpy.arange(12, dtype=numpy.uint8).reshape(3, 4)
    scanned = numpy.rot90(numpy.fliplr(picture) if variant >= 4 else picture, variant % 4)

    assert numpy.array_equal(sheetwork.oriented(numpy.ascontiguousarray(scanned), variant), picture)
    assert sheetwork.variant_of(sheetwork.turn_of(variant), sheetwork.flip_of(variant)) == variant
    assert sheetwork.swaps(variant) == (variant % 2 == 1)


def test_happy_path_the_working_size_shrinks_for_a_long_series() -> None:
    assert sheetwork.work_px(10) == sheetwork.WORK_PX_MAX
    assert sheetwork.work_px(1000) == round((sheetwork.WORK_BUDGET_BYTES / 1000) ** 0.5)
    assert sheetwork.work_px(100_000) == sheetwork.WORK_PX_MIN


def test_happy_path_parts_are_read_cropped_and_brought_to_one_cell(tmp_path: Path) -> None:
    series = make_series(tmp_path, SheetsSpec(rows=1, cols=3, turned=1, margin_px=20, shuffle=False, seed=2))

    parts = sheetwork.read_parts(series.named)
    cell = sheetwork.cell_of(parts)

    assert cell == pytest.approx((480, 360), abs=4)
    assert all(not part.blank for part in parts)
    for part in parts:
        assert sheetwork.on_cell(part, sheetwork.allowed(part, cell)[0], cell).shape == (cell[1], cell[0])


def test_happy_path_a_portrait_sheet_on_a_landscape_cell_may_only_turn_a_quarter(tmp_path: Path) -> None:
    landscape = write_map(tmp_path / "a.tif", numpy.full((300, 400, 3), 90, numpy.uint8), grey=True)
    portrait = write_map(tmp_path / "b.tif", numpy.full((400, 300, 3), 90, numpy.uint8), grey=True)
    parts = sheetwork.read_parts([("a.tif", landscape), ("b.tif", landscape), ("c.tif", portrait)])
    cell = sheetwork.cell_of(parts)

    assert cell == (400, 300)
    assert sheetwork.allowed(parts[2], cell) == (1, 3, 5, 7)
    assert sheetwork.allowed(parts[0], cell) == (0, 2, 4, 6)
    assert sheetwork.allowed(parts[0], (300, 300)) == tuple(range(8))


def test_bad_path_an_empty_page_keeps_its_whole_box_and_is_blank(tmp_path: Path) -> None:
    path = write_map(tmp_path / "blank.tif", numpy.full((120, 160, 3), 250, numpy.uint8), grey=True)

    part = sheetwork.read_part(0, "blank.tif", path, 1024)

    assert part.blank
    assert part.box == (0, 0, 160, 120)
    assert sheetwork.cell_of([part]) == (160, 120)


def test_happy_path_a_colour_scan_is_marked_colour(tmp_path: Path) -> None:
    picture = numpy.asarray(cv2.merge([numpy.full((50, 60), value, numpy.uint8) for value in (10, 120, 240)]), numpy.uint8)
    path = write_map(tmp_path / "c.tif", picture)

    assert sheetwork.read_part(0, "c.tif", path, 1024).colour


def test_bad_path_a_content_box_too_small_to_be_a_page_keeps_the_whole_page(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = write_map(tmp_path / "speck.tif", numpy.full((120, 160, 3), 250, numpy.uint8), grey=True)
    # A speck of dust: the content box finds a few pixels, under MIN_SIDE_PX, which is no page's content.
    monkeypatch.setattr(sheetwork, "content_box", lambda _grey: (70, 50, 73, 53))

    part = sheetwork.read_part(0, "speck.tif", path, 1024)

    assert part.box == (0, 0, 160, 120)
