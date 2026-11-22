"""A PDF page drawn as it is shown: turned, stretched or cut into strips, at full resolution with its true aspect (LESSONS 759, the
plan-ghid 1923 reduced to one page, 1029 x 1934 px against a landscape page)."""

from pathlib import Path

import cv2
import numpy
import pikepdf
import pytest
from hcm_pipeline.placing import pdfcompose
from hcm_pipeline.placing.pdfpages import extract_pages


def _stream(document: pikepdf.Pdf, pixels: numpy.ndarray) -> pikepdf.Stream:
    stream = pikepdf.Stream(document, cv2.imencode(".jpg", pixels)[1].tobytes())
    stream.Type, stream.Subtype = pikepdf.Name.XObject, pikepdf.Name.Image
    stream.Width, stream.Height, stream.BitsPerComponent = pixels.shape[1], pixels.shape[0], 8
    stream.ColorSpace, stream.Filter = pikepdf.Name.DeviceGray, pikepdf.Name.DCTDecode
    return stream


def _pdf(path: Path, size: tuple[int, int], images: dict[str, numpy.ndarray], content: bytes, rotate: int = 0) -> Path:
    document = pikepdf.new()
    page = document.add_blank_page(page_size=size)
    page.Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary({f"/{name}": _stream(document, pixels) for name, pixels in images.items()}))
    page.Contents = pikepdf.Stream(document, content)
    if rotate:
        page.Rotate = rotate
    document.save(path)
    return path


def _read(path: Path) -> numpy.ndarray:
    pixels = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    assert pixels is not None
    return pixels


def test_happy_path_a_page_turned_by_rotate_comes_out_at_full_resolution_with_its_true_aspect(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-PDF-PAGE-AS-SHOWN"""
    # A portrait page of 100 x 200 pt turned to landscape: the scan stored 400 x 800 px fills it, dark on its top half.
    scan = numpy.full((800, 400), 230, numpy.uint8)
    scan[:400] = 20
    source = _pdf(tmp_path / "plan.pdf", (100, 200), {"Im0": scan}, b"q 100 0 0 200 0 0 cm /Im0 Do Q", rotate=90)

    pages = extract_pages(source, tmp_path / "pages")

    assert pages is not None
    shown = _read(pages.files[0])
    assert pages.files[0].suffix == ".tif"
    assert shown.shape == (400, 800)
    # Turned clockwise: the page's top (dark) is on the right.
    assert shown[:, 600:].mean() < 60 < shown[:, :200].mean()


def test_happy_path_strips_and_a_stretched_image_are_drawn_together(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-PDF-PAGE-AS-SHOWN"""
    top, bottom = numpy.full((100, 400), 10, numpy.uint8), numpy.full((50, 400), 240, numpy.uint8)
    content = b"q 200 0 0 100 0 100 cm /Top Do Q q 200 0 0 100 0 0 cm /Bottom Do Q"
    source = _pdf(tmp_path / "strips.pdf", (200, 200), {"Top": top, "Bottom": bottom}, content)

    pages = extract_pages(source, tmp_path / "pages")

    assert pages is not None
    shown = _read(pages.files[0])
    assert shown.shape == (400, 400)
    assert shown[:180].mean() < 40 and shown[220:].mean() > 200


def test_happy_path_an_upright_image_that_is_the_page_is_still_taken_out_as_stored(tmp_path: Path) -> None:
    source = _pdf(tmp_path / "upright.pdf", (100, 200), {"Im0": numpy.full((80, 40), 90, numpy.uint8)}, b"q 100 0 0 200 0 0 cm /Im0 Do Q")

    pages = extract_pages(source, tmp_path / "pages")

    assert pages is not None
    assert [path.suffix for path in pages.files] == [".jpg"]


def test_bad_path_a_page_whose_images_cannot_be_drawn_gives_a_blank_page_or_none(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P20-BAD-PDF-PAGE-AS-SHOWN"""
    scan = numpy.full((80, 40), 20, numpy.uint8)
    # An unbalanced Q, a short cm and a Do of a name that is no image are ignored; the stretched image cannot be decoded.
    content = b"Q 1 0 cm /Missing Do q 100 0 0 50 0 0 cm /Im0 Do Q"
    source = _pdf(tmp_path / "odd.pdf", (100, 50), {"Im0": scan}, content)

    def refuse(_image: pikepdf.PdfImage) -> object:
        raise ValueError("unsupported")

    monkeypatch.setattr(pikepdf.PdfImage, "as_pil_image", refuse)
    pages = extract_pages(source, tmp_path / "pages")

    assert pages is not None
    assert _read(pages.files[0]).min() == 255
    with pikepdf.open(source) as document:
        page = document.pages[0]
        drawn = pdfcompose.placements(page)
        assert len(drawn) == 1
        flat = [pdfcompose.Placement(drawn[0].image, (0.0, 0.0, 0.0, 0.0, 0.0, 0.0))]
        assert pdfcompose.compose(page, flat, tmp_path / "flat") is None
        assert not pdfcompose.is_as_stored(page, [pdfcompose.Placement(drawn[0].image, (100.0, 1.0, 0.0, 50.0, 0.0, 0.0))])
