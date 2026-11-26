"""Sheets laid out by what they show twice (docs/research/M20-import-local.md §19.14): pieces turned by a quarter or a few degrees, with
names that say nothing, placed by their common features; garbage never judged good.
"""

from pathlib import Path

import cv2
import numpy
import pytest
from hcm_pipeline.placing import autostitch, canvas_window, featured, overlaps, sheetnames
from hcm_pipeline.placing.canvas_window import Canvas, Tile
from hcm_pipeline.placing.sheetwork import read_parts
from hcm_pipeline.raster import gdal

from tests.synthetic.sheets import SheetsSpec, map_of
from tests.synthetic.town import write_map

PIECE = (420, 320)
STEP = (300, 230)


def _turned(picture: numpy.ndarray, degrees: float) -> numpy.ndarray:
    """The piece as scanned turned by `degrees` (clockwise), on paper, its whole content kept."""
    height, width = picture.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), -degrees, 1.0)
    return numpy.asarray(cv2.warpAffine(picture, matrix, (width, height), borderValue=(255, 255, 255)), numpy.uint8)


def _pieces(tmp_path: Path, turns: dict[int, tuple[int, float]], rows: int = 2, cols: int = 3) -> list[tuple[str, Path]]:
    """A town cut into overlapping pieces named in no order (`scan-<letter>`), some turned by a quarter and some degrees."""
    whole = map_of(SheetsSpec(rows=rows, cols=cols, cell=PIECE, overlap=0.28, style="colour"))
    named = []
    for index in range(rows * cols):
        row, col = divmod(index, cols)
        piece = whole[row * STEP[1] : row * STEP[1] + PIECE[1], col * STEP[0] : col * STEP[0] + PIECE[0]].copy()
        quarter, degrees = turns.get(index, (0, 0.0))
        scanned = numpy.ascontiguousarray(numpy.rot90(_turned(piece, degrees), quarter))
        name = f"scan-{'QWERTYUIOP'[index]}.tif"
        named.append((name, write_map(tmp_path / name, scanned, grey=False)))
    return named


def test_happy_path_overlapping_pieces_turned_and_unnamed_are_placed_by_their_features(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-STITCH-FEATURES"""
    named = _pieces(tmp_path, {1: (2, 0.0), 4: (0, 6.0)})

    proposal = autostitch.propose(named)

    assert len(proposal.solved.positions) == 6
    assert proposal.plan.variants[1] == 2
    assert abs(proposal.plan.angles[4] - proposal.plan.angles[0] + 6.0) < 1.0
    assert proposal.quality.seam_median >= 0.6
    tiles, size = proposal.tiles(800)
    assert len(tiles) == 6
    assert max(size) <= 800


def test_bad_path_noise_pieces_link_nothing_and_stay_poor(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-STITCH-FEATURES-NOISE"""
    rng = numpy.random.default_rng(3)
    named = []
    for index in range(4):
        path = write_map(tmp_path / f"n{index}.tif", numpy.asarray(rng.integers(0, 256, (200, 260, 3)), numpy.uint8), grey=True)
        named.append((f"n{index}.tif", path))
    parts = read_parts(named)

    assert featured.layout(parts, (260, 200), {}) is None
    assert autostitch.propose(named).quality.verdict == "poor"


def test_bad_path_a_link_that_disagrees_is_dropped() -> None:
    links = [
        overlaps.Link(0, 1, 0.0, 1.0, (300.0, 100.0), (0.0, 100.0), 50),
        overlaps.Link(1, 2, 0.0, 1.0, (300.0, 100.0), (0.0, 100.0), 50),
        overlaps.Link(0, 2, 0.0, 1.0, (300.0, 100.0), (0.0, 100.0), 12),
        overlaps.Link(2, 3, 90.0, 1.0, (300.0, 100.0), (0.0, 100.0), 10),
        overlaps.Link(0, 3, 0.0, 1.0, (10.0, 10.0), (10.0, 10.0), 5),
    ]
    found, agree = overlaps.turns(links)
    placed = overlaps.placed(agree, found, dict.fromkeys(found, (400, 200)))

    assert found[3] == pytest.approx(90.0)
    assert all(link.inliers != 5 for link in agree)
    assert [link.b for link in placed.dropped] == [2]
    assert placed.centres[1][0] - placed.centres[0][0] == pytest.approx(300.0, abs=1.0)


def test_bad_path_matches_too_few_or_at_another_scale_make_no_link() -> None:
    rng = numpy.random.default_rng(1)
    texture = numpy.asarray(cv2.GaussianBlur(numpy.asarray(rng.integers(0, 256, (300, 300)), numpy.uint8), (0, 0), 1.5), numpy.uint8)
    small = numpy.asarray(cv2.resize(texture, (150, 150)), numpy.uint8)
    blank = numpy.full((100, 100), 255, numpy.uint8)

    assert overlaps.link_of(overlaps.features_of(texture), overlaps.features_of(blank), 0, 1) is None
    assert overlaps.link_of(overlaps.features_of(texture), overlaps.features_of(small), 0, 1) is None
    assert overlaps.link_of(overlaps.features_of(texture), overlaps.features_of(texture), 0, 1) is not None
    assert overlaps.wrapped(270.0) == pytest.approx(-90.0)
    assert overlaps.turns([]) == ({}, [])


def test_happy_path_the_quarter_most_sheets_share_is_upright() -> None:
    assert featured.quarter_of(-88.0) == 3
    assert featured.variants_of([], {}, (10, 10)) == {}


@pytest.mark.parametrize("colour", [False, True])
def test_happy_path_a_turned_tile_sets_only_its_own_pixels(tmp_path: Path, colour: bool) -> None:
    first = write_map(tmp_path / "a.tif", numpy.full((100, 100, 3), 40, numpy.uint8), grey=True)
    second = write_map(tmp_path / "b.tif", numpy.full((100, 100, 3), 120, numpy.uint8), grey=True)
    tiles = [Tile(first, (0, 0, 100, 100), 0, 0, 0, 100, 100), Tile(second, (0, 0, 100, 100), 0, 80, 0, 100, 100, 10.0)]

    target = canvas_window.render(tiles, Canvas(tmp_path / "c.tif", (180, 100), colour))
    dataset = gdal.Open(str(target))
    pixels = dataset.GetRasterBand(1).ReadAsArray()
    dataset.Close()

    assert pixels[50, 20] == 40
    assert pixels[50, 150] == 120
    assert pixels[1, 178] == canvas_window.PAPER
    assert pixels[98, 81] == 40


def test_bad_path_an_atlas_title_index_and_legend_pages_stay_out_of_the_order() -> None:
    """Scenarios: S-P20-BAD-STITCH-FOREIGN-SHEET"""
    names = ["atlas/1_Autor.jpg", "atlas/10_Registru.jpg", *(f"atlas/{number}.jpg" for number in range(12, 30)), "atlas/99_Scara.jpg"]

    grid = sheetnames.grid_of(names, 0.8)

    assert grid.unread == (0, 1, 20)
    assert len(grid.cells) == 18
    assert sheetnames.titled(["a1.tif", "b2.tif"]) == ()
    assert sheetnames.titled([]) == ()


def test_bad_path_two_sheets_that_barely_meet_once_placed_prove_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    images = {0: numpy.full((40, 40), 128, numpy.uint8), 1: numpy.full((40, 40), 128, numpy.uint8)}
    link = overlaps.Link(0, 1, 0.0, 1.0, (20.0, 20.0), (20.0, 20.0), 50)
    placed = overlaps.placed([link], {0: 0.0, 1: 0.0}, dict.fromkeys((0, 1), (40, 40)))
    monkeypatch.setattr(featured, "_between", lambda _placed, _link, _cell: numpy.asarray([[1.0, 0.0, 39.0], [0.0, 1.0, 39.0]]))

    assert featured.proof(images, placed, link, (40, 40)) == 0.0
