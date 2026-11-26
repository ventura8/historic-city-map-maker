"""Atlases, pieces and PDFs made one map (docs/research/M20-import-local.md §3, *Atlases and pieces*, *PDFs*), then placed."""

from dataclasses import replace
from pathlib import Path

import cv2
import numpy
import pikepdf
import pytest
from hcm_pipeline.jobs import Done, JobContext, Waiting
from hcm_pipeline.placing import assemble, autoplace, joins, maps
from hcm_pipeline.placing.autostitch import Proposal
from hcm_pipeline.placing.pdfpages import extract_pages
from hcm_pipeline.placing.quality import Quality
from hcm_pipeline.placing.series import SeriesJob
from hcm_pipeline.steps.place import PlaceStep

from tests.fakes.world import PipelineWorld, dig
from tests.synthetic.town import Drawing, draw_map, placement, town_lines, write_map
from tests.unit.placing_support import originals, series_context

RNG = numpy.random.default_rng(11)


def texture(size: tuple[int, int] = (900, 700)) -> numpy.ndarray:
    """A grey picture rich in corners (SIFT finds them): blocks and lines at random."""
    width, height = size
    image = numpy.full((height, width), 235, numpy.uint8)
    for _ in range(400):
        x, y = RNG.integers(0, width), RNG.integers(0, height)
        cv2.rectangle(image, (int(x), int(y)), (int(x + RNG.integers(5, 40)), int(y + RNG.integers(5, 40))), int(RNG.integers(0, 120)), -1)
    return image


def write_parts(folder: Path, parts: list[numpy.ndarray]) -> list[Path]:
    folder.mkdir(parents=True, exist_ok=True)
    return [write_map(folder / f"img{index:03d}.tif", numpy.dstack([part] * 3), grey=True) for index, part in enumerate(parts)]


def test_happy_path_overlapping_pieces_are_joined_where_they_were_cut_with_their_quality(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-PIECES, S-P22-HAPPY-JOIN-QUALITY"""
    whole = texture()
    pieces = [whole[0:400, 0:500], whole[0:400, 400:900], whole[300:700, 0:500], whole[300:700, 400:900]]

    found = joins.joined(write_parts(tmp_path / "p", [*pieces, texture((300, 300))]))

    assert found is not None
    canvas = assemble.compose_canvas(found.images, found.layout)
    assert found.layout.left_out == (4,)
    assert found.layout.size == pytest.approx((900, 700), abs=3)
    assert numpy.abs(canvas[:690, :890].astype(int) - whole[:690, :890].astype(int)).mean() < 4
    assert found.quality.links == 3
    assert found.quality.mean_inliers >= joins.MIN_MATCHES
    assert found.quality.rms_px < 1.5


def test_happy_path_pieces_scanned_large_are_joined_at_the_finer_resolution(tmp_path: Path) -> None:
    """Scenarios: S-P22-HAPPY-JOIN-QUALITY"""
    # Four 2000 px scans that overlap by a tenth: read at 1,200 px (the old matching size) their fine texture blurs away.
    whole = numpy.asarray(cv2.resize(texture((1000, 1000)), (3800, 3800), interpolation=cv2.INTER_NEAREST), numpy.uint8)
    pieces = [whole[0:2000, 0:2000], whole[0:2000, 1800:3800], whole[1800:3800, 0:2000], whole[1800:3800, 1800:3800]]

    found = joins.joined(write_parts(tmp_path / "big", pieces))

    assert found is not None
    assert not found.layout.left_out
    assert found.quality.links == 3


def test_bad_path_pieces_that_never_overlap_or_differ_in_scale_leave_one_part(tmp_path: Path) -> None:
    whole = texture()
    enlarged = numpy.asarray(cv2.resize(whole[0:400, 300:900], None, fx=1.6, fy=1.6), numpy.uint8)
    apart = joins.joined(write_parts(tmp_path / "a", [texture((300, 300)), texture((300, 300))]))
    scaled = joins.joined(write_parts(tmp_path / "b", [whole[0:400, 0:500], enlarged]))
    blank = joins.features_of(numpy.full((50, 50), 250, numpy.uint8))

    assert apart is not None
    assert scaled is not None
    assert scaled.layout.left_out == (1,)
    assert apart.layout.left_out == (1,)
    assert apart.quality.links == 0
    assert joins.join_of(blank, blank, (0, 1)) is None


def town_map(size: tuple[int, int] = (900, 900)) -> numpy.ndarray:
    drawing = Drawing(placement(5.0, 0.0, (size[0] / 2, size[1] / 2)), size, "grey", street_px=5, margin_px=0)
    return draw_map(town_lines(), drawing)[:, :, 0]


def cut_pages(image: numpy.ndarray, rows: int, cols: int) -> dict[tuple[int, int], numpy.ndarray]:
    height, width = image.shape[0] // rows, image.shape[1] // cols
    return {
        (col, row): image[row * height : (row + 1) * height, col * width : (col + 1) * width] for row in range(rows) for col in range(cols)
    }


def test_happy_path_an_atlases_pages_are_laid_out_by_their_edges_with_a_hole_where_one_is_missing() -> None:
    """Scenarios: S-P20-HAPPY-ATLAS"""
    pages = cut_pages(town_map(), 3, 3)
    del pages[(2, 1)]
    order = list(pages)
    RNG.shuffle(order)

    layout = assemble.atlas_layout([pages[key] for key in order], (300, 300))

    assert layout.holes == 1
    assert layout.size == (900, 900)
    assert not layout.left_out
    placed = {order[index]: (int(matrix[0, 2] // 300), int(matrix[1, 2] // 300)) for index, matrix in layout.placed.items()}
    assert placed == {key: key for key in pages}


def test_bad_path_a_page_that_joins_nothing_is_left_out() -> None:
    pages = list(cut_pages(town_map(), 2, 2).values())

    layout = assemble.atlas_layout([*pages, numpy.full((450, 450), 250, numpy.uint8)], (450, 450))

    assert layout.left_out == (4,)
    assert assemble.ncc(numpy.zeros(4), numpy.ones(4)) == 0.0


def pdf_of(path: Path, pages: list[numpy.ndarray | None], encryption: pikepdf.Encryption | None = None) -> Path:
    """A PDF whose pages each hold one JPEG (or nothing)."""
    document = pikepdf.new()
    for image in pages:
        page = document.add_blank_page(page_size=(200, 200))
        if image is not None:
            encoded = cv2.imencode(".jpg", image)[1].tobytes()
            stream = pikepdf.Stream(document, encoded)
            stream.Type, stream.Subtype = pikepdf.Name.XObject, pikepdf.Name.Image
            stream.Width, stream.Height, stream.BitsPerComponent = image.shape[1], image.shape[0], 8
            stream.ColorSpace, stream.Filter = pikepdf.Name.DeviceGray, pikepdf.Name.DCTDecode
            page.Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary(Im0=stream))
    document.save(path, encryption=encryption or False)
    return path


def test_happy_path_a_pdfs_page_images_come_out_as_they_are_stored_even_owner_locked(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-PDF"""
    owner_only = pikepdf.Encryption(owner="owner-secret-x", user="", R=4)
    source = pdf_of(
        tmp_path / "atlas.pdf", [numpy.full((40, 30), 90, numpy.uint8), None, numpy.full((20, 20), 30, numpy.uint8)], owner_only
    )

    pages = extract_pages(source, tmp_path / "pages")

    assert pages is not None
    assert pages.without_image == 1
    assert [path.suffix for path in pages.files] == [".jpg", ".jpg"]
    first = cv2.imread(str(pages.files[0]), cv2.IMREAD_GRAYSCALE)
    assert first is not None
    assert first.shape == (40, 30)


def test_bad_path_a_pdf_that_needs_a_password_is_skipped_not_cracked(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-PDF-PASSWORD"""
    ctx = series_context(world, tmp_path, ["Harti/locked.pdf"], {"class": "single", "encoding": "grey"})
    locked = pikepdf.Encryption(owner="owner-secret-x", user="user-secret-y", R=6)
    (originals(ctx) / "Harti").mkdir()
    pdf_of(originals(ctx) / "Harti" / "locked.pdf", [numpy.full((40, 30), 90, numpy.uint8)], locked)

    result = PlaceStep().run(ctx)

    assert isinstance(result, Waiting)
    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    assert help_item["note"] == maps.PDF_LOCKED
    assert extract_pages(originals(ctx) / "Harti" / "locked.pdf", tmp_path / "out") is None


def test_bad_path_a_pdf_with_no_page_image_has_nothing_to_place(world: PipelineWorld, tmp_path: Path) -> None:
    ctx = series_context(world, tmp_path, ["text.pdf"], {"class": "single", "encoding": "grey"})
    pdf_of(originals(ctx) / "text.pdf", [None])

    assert isinstance(PlaceStep().run(ctx), Waiting)
    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    assert help_item["note"] == maps.NO_PAGES


def test_happy_path_an_atlas_of_pages_is_assembled_and_placed_as_one_map(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-ATLAS"""
    names = [f"Atlas/{index}.tif" for index in range(1, 5)]
    ctx = series_context(world, tmp_path, names, {"class": "atlas", "encoding": "grey"})
    (originals(ctx) / "Atlas").mkdir()
    page_images = list(cut_pages(town_map((1000, 1000)), 2, 2).values())
    for name, image in zip(names, page_images, strict=True):
        write_map(originals(ctx) / name, numpy.dstack([image] * 3), grey=True)

    result = PlaceStep().run(ctx)

    assert isinstance(result, Done)
    version = world.version()
    report = version["archive"]
    assert isinstance(report, dict)
    assert report["method"] == "atlas"
    source = version["source"]
    assert isinstance(source, dict)
    assert source["placedCount"] == 4


def test_bad_path_pieces_the_older_joins_cannot_hold_either_wait_with_their_layout_for_a_check(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P20-BAD-STITCH-GARBAGE-WAITS"""
    whole = texture()
    names = ["Bucata/img001.tif", "Bucata/img002.tif"]
    ctx = series_context(world, tmp_path, names, {"class": "pieces", "encoding": "grey"})
    (originals(ctx) / "Bucata").mkdir()
    for name, image in zip(names, [whole[0:400, 0:500], whole[0:400, 400:900]], strict=True):
        write_map(originals(ctx) / name, numpy.dstack([image] * 3), grey=True)
    proposed = autoplace.proposed

    def doubtful(job: JobContext, series: SeriesJob) -> Proposal:
        return replace(proposed(job, series), quality=Quality(100.0, 0.4, 1.0, 0.0, "check"))

    monkeypatch.setattr(autoplace, "proposed", doubtful)
    # The older joins refuse a canvas this large: nothing vouches for the layout, so its owner checks it.
    monkeypatch.setattr(assemble, "CANVAS_MAX_PX", 600)

    assert isinstance(PlaceStep().run(ctx), Waiting)
    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    assert (help_item["reason"], help_item["note"]) == (autoplace.LAYOUT_CHECK, autoplace.NOTE_CHECK)
    assert dig(help_item, "stitched", "method") == "names"


def test_happy_path_pieces_are_stitched_and_placed_as_one_map(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-PIECES"""
    whole = town_map((1000, 1000))
    cuts = [whole[0:600, 0:600], whole[0:600, 400:1000], whole[400:1000, 0:600], whole[400:1000, 400:1000]]
    names = [f"Bucata/img{index:03d}.tif" for index in range(4)]
    ctx = series_context(world, tmp_path, names, {"class": "pieces", "encoding": "grey"})
    (originals(ctx) / "Bucata").mkdir()
    for name, image in zip(names, cuts, strict=True):
        write_map(originals(ctx) / name, numpy.dstack([image] * 3), grey=True)

    result = PlaceStep().run(ctx)

    assert isinstance(result, Done)
    report = world.version()["archive"]
    assert isinstance(report, dict)
    assert report["method"] == "pieces"
