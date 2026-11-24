"""An atlas's or owner-laid series' sheets cut at their neat lines (`placing/framing.py`, M20 §19.20; lesson of 2026-11-24).

The sheets are drawn like the plan cadastral 1911-1914's (`test_placing_neatline`): a thin neat line `CELL` pixels a side, a border
line outside it, the title between them. A series of them is cut at each neat line before its seams are measured and its mosaic is
written; a sheet of such a series with no frame of its own is named in Help calibrate, never mosaicked with its margins.
"""

from pathlib import Path

import cv2
import numpy
import pytest
from hcm_pipeline.jobs import Waiting
from hcm_pipeline.placing import (
    autoplace,
    autostitch,
    canvas_window,
    framing,
    fullres_parts,
    layout_files,
    owner_layout,
    sheetnames,
    sheetwork,
)
from hcm_pipeline.placing.canvas_window import Canvas, Tile
from hcm_pipeline.placing.grid import GridPlacer
from hcm_pipeline.placing.neatline import NeatLine
from hcm_pipeline.placing.seams import Seam
from hcm_pipeline.placing.series import series_of
from hcm_pipeline.raster import gdal

from tests.fakes.world import PipelineWorld, dig
from tests.unit.placing_support import originals, series_context

CELL = 500
BORDER = 20
WIDTH, HEIGHT = 700, 660
PAPER, INK = 245, 10
LEFT, TOP = 70, 60


def _sheet(mark: int, left: int = LEFT, top: int = TOP, framed: bool = True) -> numpy.ndarray:
    """A sheet: its neat line at (`left`, `top`) and its border line outside it (when `framed`), a drawing inside whose lines differ
    by `mark`, and a title above."""
    grey = numpy.full((HEIGHT, WIDTH), PAPER, numpy.uint8)
    if framed:
        for offset in (0, BORDER):
            cv2.rectangle(grey, (left - offset, top - offset), (left + CELL + offset, top + CELL + offset), INK, 2)
    cv2.line(grey, (left + 40 + mark, top + 30), (left + 300, top + 420), INK, 3)
    cv2.line(grey, (left + 120, top + 470), (left + 460 - mark, top + 90), INK, 3)
    cv2.putText(grey, "Seria XI", (left + 180, top - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, INK, 1)
    return grey


def _write(path: Path, grey: numpy.ndarray) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), grey)
    return path


def _framed_series(folder: Path, count: int = 4) -> list[Path]:
    return [_write(folder / f"s{index}.png", _sheet(index * 10, LEFT + index * 7, TOP + index * 5)) for index in range(count)]


def _corners(left: int = LEFT, top: int = TOP) -> numpy.ndarray:
    return numpy.array([[left, top], [left + CELL, top], [left + CELL, top + CELL], [left, top + CELL]], numpy.float64)


def test_happy_path_a_series_of_framed_sheets_is_framed_and_each_cut_at_its_neat_line(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-NEATLINE-ATLAS"""
    paths = _framed_series(tmp_path)

    frames = framing.series_neatlines(paths, 1.0)

    assert frames is not None
    assert all(frame is not None and frame.confident for frame in frames)
    first = frames[0]
    assert first is not None
    assert numpy.abs(first.corners - _corners()).max() <= 4

    picture = framing.read_framed(paths[0], first.corners, (250, 250))
    inked = framing.read_framed(paths[0], first.corners, (250, 250), inked=True)
    # Cut at the neat line: just inside the edges lies the drawing's own paper (cut at the border line, its line and the title would
    # lie there, 10 picture pixels in), and the drawing is inside.
    for image in (picture, inked):
        assert image.shape == (250, 250)
        for band in (image[5:12], image[-12:-5], image[:, 5:12], image[:, -12:-5]):
            assert band.mean() > PAPER - 5
        assert image[15:-15, 15:-15].min() < 100


def test_happy_path_the_sheets_are_cut_at_their_frames_and_a_framed_mosaic_has_no_margin_at_its_seams(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-NEATLINE-ATLAS"""
    paths = _framed_series(tmp_path)
    named = [(path.name, path) for path in paths]

    parts = sheetwork.read_parts(named)

    assert all(part.frame and not part.unframed for part in parts)
    assert all(abs(part.aspect - 1.0) < 0.02 for part in parts)
    assert parts[1].box[0] == pytest.approx(LEFT + 7, abs=4)
    assert autostitch.neat_lined(parts)
    plan = autostitch.Plan(parts, {0: (0, 0), 1: (0, 1)}, {0: 0, 1: 0}, (100, 100))
    tiles, size = autostitch.tiles_of(plan, {0: (0.0, 0.0), 1: (100.0, 0.0)}, 200)
    assert all(tile.frame for _index, tile in tiles)
    path = canvas_window.render([tile for _index, tile in tiles], Canvas(tmp_path / "canvas.tif", size, False))
    dataset = gdal.Open(str(path))
    pixels = dataset.GetRasterBand(1).ReadAsArray()
    dataset.Close()
    # The two frames abut: no paper column at the seam, where an uncut sheet carried its margin and its border line.
    seam = pixels[5:-5, tiles[1][1].left - 3 : tiles[1][1].left + 3]
    assert (seam.mean(axis=0) < 250).all()
    # The sheet's original maps onto its tile, clipped to its frame.
    part = fullres_parts.tile_part(tiles[1][1])
    assert len(part.clip) == 4
    assert part.clip[0] == pytest.approx((tiles[1][1].left, 0.0), abs=1.0)
    assert layout_files.inked(parts[0]).shape[0] == pytest.approx(layout_files.THUMB_PX, abs=2)


def test_happy_path_a_colour_framed_tile_keeps_its_bands_and_a_cut_side_is_paper(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-NEATLINE-ATLAS"""
    colour = cv2.cvtColor(_sheet(0), cv2.COLOR_GRAY2BGR)
    path = _write(tmp_path / "c.png", colour)
    # The frame's bottom runs off the scan (the scanner cut it): that part of the picture is paper.
    corners = _corners(top=TOP + 300)
    tile = Tile(path, framing.bounds(corners, (WIDTH, HEIGHT)), 0, 0, 0, 100, 100, frame=framing.corners_of(corners))

    picture = canvas_window.picture(tile, True)

    assert picture.shape == (100, 100, 3)
    assert picture[-5:].min() == framing.PAPER
    assert framing.bounds(corners, (WIDTH, HEIGHT))[3] == HEIGHT


def test_happy_path_a_content_box_already_inside_its_neat_line_is_kept(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-NEATLINE-ATLAS"""
    box = (LEFT + 2, TOP + 2, LEFT + CELL, TOP + 400)
    part = sheetwork.Part(0, "a", tmp_path / "a.png", numpy.zeros((10, 10), numpy.uint8), 1.0, box, False)
    found = NeatLine(_corners(), 0.9)

    assert framing.holds(_corners(), part.box)
    assert not framing.holds(_corners(), (LEFT - 30, TOP, LEFT + CELL, TOP + CELL))
    assert sheetwork.framed_part(part, found, 100) is part


def test_bad_path_a_series_without_printed_frames_is_left_as_it_was(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-NEATLINE-ATLAS-UNFRAMED"""
    paths = [_write(tmp_path / f"p{index}.png", _sheet(index * 10, framed=False)) for index in range(3)]

    assert framing.series_neatlines(paths, 1.0) is None
    assert framing.series_neatlines([], 1.0) is None
    parts = sheetwork.read_parts([(path.name, path) for path in paths])
    assert not any(part.frame or part.unframed for part in parts)
    assert sheetwork.read_parts([]) == []
    assert len(framing.sample_of(100)) == framing.SAMPLE
    with pytest.raises(ValueError, match="in a line"):
        framing.to_frame(numpy.zeros((4, 2)), (10, 10))


def test_bad_path_a_framed_series_names_its_sheet_without_a_frame_and_keeps_a_blank_page(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-NEATLINE-ATLAS-UNFRAMED"""
    paths = _framed_series(tmp_path)
    paths.append(_write(tmp_path / "unframed.png", _sheet(5, framed=False)))
    paths.append(_write(tmp_path / "blank.png", numpy.full((HEIGHT, WIDTH), PAPER, numpy.uint8)))
    named = [(path.name, path) for path in paths]

    parts = sheetwork.read_parts(named)

    assert [part.unframed for part in parts] == [False] * 4 + [True, False]
    assert parts[5].blank
    assert not parts[5].frame
    grid = sheetnames.grid_of([name for name, _path in named], 1.0)
    assert autostitch.initial_out(parts, grid)[4] == autostitch.NO_FRAME
    # The owner's layout places the unframed sheet: it is still named, while the sheet the owner marked out stays theirs.
    sheets: list[dict[str, object]] = [{"index": index, "row": 0, "col": index, "turn": 0, "flip": False} for index in range(5)]
    sheets.append({"index": 5, "row": 1, "col": 0, "turn": 0, "flip": False, "out": "not-part"})
    plan = owner_layout.owner_plan(named, owner_layout.Answer(0, tuple(sheets), (), False, {}))
    assert plan.out == {4: autostitch.NO_FRAME, 5: owner_layout.NOT_PART}


def test_bad_path_an_owner_layout_with_a_sheet_unframed_waits_with_it_named(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-NEATLINE-ATLAS-UNFRAMED"""
    names = [f"plan/{row}{col}.png" for row in "AB" for col in "12"]
    ctx = series_context(world, tmp_path, names, {"class": "grid", "encoding": "grey"})
    for index, name in enumerate(names):
        _write(originals(ctx) / name, _sheet(index * 10, LEFT + index * 3, TOP + index * 2, framed=index != 3))
    sheets = [{"index": index, "row": index // 2, "col": index % 2, "turn": 0, "flip": False} for index in range(4)]
    answer = {"revision": 2, "sheets": sheets, "seams": [], "preview": False, "by": "u-owner", "at": "2026-11-24T00:00:00Z"}
    ctx.update_version({"help": {"reason": "low-confidence", "layoutAnswer": answer}})

    # A grid series the owner laid out is placed as the owner laid it out, never again by the grid's names.
    result = GridPlacer().place(ctx)

    assert isinstance(result, Waiting)
    assert dig(world.version(), "help", "reason") == autoplace.FRAME_NOT_FOUND
    assert dig(world.version(), "help", "note") == framing.UNFRAMED.format(count=1, total=4)
    assert dig(world.version(), "help", "layoutAnswer", "revision") == 2
    stitched = dig(world.version(), "help", "stitched")
    assert isinstance(stitched, dict)
    assert stitched["method"] == owner_layout.OWNER
    assert stitched["leftOut"] == [{"name": "B2.png", "reason": autostitch.NO_FRAME}]
    assert series_of(ctx).sheets[3].name == "B2.png"


def test_happy_path_a_pixel_whose_sampled_owner_does_not_cover_it_goes_to_a_covering_tile(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-NEATLINE-ATLAS

    Lesson of 2026-11-24: a paper line along every seam."""
    upper = Tile(tmp_path / "a.tif", (0, 0, 10, 10), 0, 0, 0, 10, 7)
    lower = Tile(tmp_path / "b.tif", (0, 0, 10, 10), 0, 0, 7, 10, 7)
    window = (0, 0, 10, 14)

    owner = canvas_window.owners([upper, lower], window)
    unowned = canvas_window.unowned([upper, lower], window, owner)

    rows = numpy.arange(14)[:, None]
    covered_by_owner = numpy.where(owner == 0, rows < 7, (owner == 1) & (rows >= 7))
    assert (unowned == ~covered_by_owner).all()
    assert canvas_window.unowned([upper], (0, 0, 10, 20), canvas_window.owners([upper], (0, 0, 10, 20)))[15:].all()


def test_happy_path_framed_sheets_abut_unless_their_strong_seams_step_less_than_a_cell() -> None:
    """Scenarios: S-P20-HAPPY-NEATLINE-ATLAS"""
    cell = (100, 80)
    abut = Seam(0, 1, "right", 100.0, 24.0, 0.8, 1.0, "strong")
    below = Seam(0, 2, "below", 3.0, 80.0, 0.7, 1.0, "strong")
    weak = Seam(1, 3, "below", 0.0, 50.0, 0.2, 1.0, "weak")
    overlap = Seam(0, 1, "right", 88.0, 0.0, 0.9, 1.0, "strong")

    # A shift along the seam is no overlap, and a weak seam's guess counts for nothing.
    assert autostitch.abutting([abut, below, weak], cell)
    assert autostitch.abutting([weak], cell)
    assert not autostitch.abutting([overlap, Seam(2, 3, "below", 0.0, 68.0, 0.9, 1.0, "strong")], cell)
