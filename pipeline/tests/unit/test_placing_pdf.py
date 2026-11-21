"""A PDF atlas laid out from its pages, never read by GDAL; a page stored in an odd form decoded to a TIFF; a broken PDF failing the job
with one clear line (docs/research/M20-import-local.md §3, *PDFs*; the 1923 plan-ghid of 2026-11-12)."""

from pathlib import Path

import numpy
import pikepdf
import pytest
from hcm_pipeline.contract import Errors
from hcm_pipeline.jobs import Done, StepFailedError, Waiting
from hcm_pipeline.placing import maps, pdfpages
from hcm_pipeline.placing.pdfpages import extract_pages
from hcm_pipeline.steps.place import PlaceStep

from tests.fakes.world import PipelineWorld
from tests.synthetic.town import write_map
from tests.unit.placing_support import originals, series_context
from tests.unit.test_placing_assemble import cut_pages, pdf_of, town_map


def test_happy_path_a_pdf_atlas_beside_a_loose_map_is_laid_out_from_its_pages(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-PDF-ATLAS"""
    ctx = series_context(world, tmp_path, ["Harti/plan-ghid 1923.pdf"], {"class": "atlas", "encoding": "grey"})
    folder = originals(ctx) / "Harti"
    folder.mkdir()
    pdf_of(folder / "plan-ghid 1923.pdf", list(cut_pages(town_map((1000, 1000)), 2, 2).values()))
    # A loose map beside the PDF: the overview search found it, and GDAL was then asked to read the PDF itself.
    write_map(folder / "1911.tif", numpy.dstack([town_map((1200, 1200))] * 3), grey=True)

    result = PlaceStep().run(ctx)

    assert isinstance(result, Done)
    report = world.version()["archive"]
    assert isinstance(report, dict)
    assert report["method"] == "atlas"


def test_happy_path_a_page_that_cannot_be_written_as_stored_is_decoded_to_a_tiff(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P20-HAPPY-PDF-ATLAS"""
    source = pdf_of(tmp_path / "odd.pdf", [numpy.full((40, 30), 90, numpy.uint8)])

    def refuse(_image: pikepdf.PdfImage, fileprefix: str) -> str:
        raise NotImplementedError(fileprefix)

    monkeypatch.setattr(pikepdf.PdfImage, "extract_to", refuse)
    pages = extract_pages(source, tmp_path / "pages")

    assert pages is not None
    assert [path.suffix for path in pages.files] == [".tif"]
    assert pages.files[0].stat().st_size > 0


def test_bad_path_a_page_that_cannot_be_decoded_either_is_counted_without_an_image(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = pdf_of(tmp_path / "odd.pdf", [numpy.full((40, 30), 90, numpy.uint8)])

    def refuse(_image: pikepdf.PdfImage, *_args: object, **_kwargs: object) -> str:
        raise ValueError("unsupported")

    monkeypatch.setattr(pikepdf.PdfImage, "extract_to", refuse)
    monkeypatch.setattr(pikepdf.PdfImage, "as_pil_image", refuse)
    pages = extract_pages(source, tmp_path / "pages")

    assert pages == pdfpages.Pages((), 1)


@pytest.mark.parametrize("content", [b"", b"%PDF-1.7\n1 0 obj truncated"])
def test_bad_path_a_broken_pdf_fails_the_job_with_one_clear_line(world: PipelineWorld, tmp_path: Path, content: bytes) -> None:
    """Scenarios: S-P20-BAD-PDF-BROKEN"""
    ctx = series_context(world, tmp_path, ["Harti/broken.pdf"], {"class": "atlas", "encoding": "grey"})
    (originals(ctx) / "Harti").mkdir()
    (originals(ctx) / "Harti" / "broken.pdf").write_bytes(b"%PDF-" + content if content else b"%PDF-")

    with pytest.raises(StepFailedError) as failed:
        PlaceStep().run(ctx)

    assert failed.value.code == Errors.ARCHIVE_CORRUPT
    assert "broken.pdf is not a readable PDF" in str(failed.value)


@pytest.mark.parametrize("series_class", ["atlas", "pieces"])
def test_bad_path_an_atlas_or_pieces_pdf_that_needs_a_password_waits_for_a_person(
    world: PipelineWorld, tmp_path: Path, series_class: str
) -> None:
    """Scenarios: S-P20-BAD-PDF-PASSWORD"""
    ctx = series_context(world, tmp_path, ["locked.pdf"], {"class": series_class, "encoding": "grey"})
    locked = pikepdf.Encryption(owner="owner-secret-x", user="user-secret-y", R=6)
    pdf_of(originals(ctx) / "locked.pdf", [numpy.full((40, 30), 90, numpy.uint8)], locked)

    assert isinstance(PlaceStep().run(ctx), Waiting)
    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    assert help_item["note"] == maps.PDF_LOCKED


def test_bad_path_an_atlas_pdf_with_no_page_image_has_nothing_to_lay_out(world: PipelineWorld, tmp_path: Path) -> None:
    ctx = series_context(world, tmp_path, ["text.pdf"], {"class": "atlas", "encoding": "grey"})
    pdf_of(originals(ctx) / "text.pdf", [None])

    assert isinstance(PlaceStep().run(ctx), Waiting)
    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    assert help_item["note"] == maps.NO_PAGES
