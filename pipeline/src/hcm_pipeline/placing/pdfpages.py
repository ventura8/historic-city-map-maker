"""An archive PDF's page images (docs/research/M20-import-local.md §3, *PDFs*): taken out with pikepdf, never re-encoded.

Each page's largest image is written as it is stored (a `/DCTDecode` stream becomes a JPEG file byte for byte). A file encrypted with
an empty user password (owner restrictions only, as Miorini 1923's Standard handler) is read; one that needs a password is skipped
(`pdf-password`): the worker never asks for one and never tries to crack it. A page with no image (text only, vector drawing) gives no
file and is counted. An image stored in a form that cannot be written as is (JBIG2, an unusual colour space) is decoded once and written
as a TIFF instead, so GDAL can read every page. A file pikepdf cannot open at all (truncated, not a PDF) fails the job with one clear
line (`apiError.imagery.archiveCorrupt`), never a crash. The pages are written to the job's scratch folder, never beside the originals:
every placer reads the pages, never the PDF itself (GDAL's PDF driver in the pipeline image can write, not read, 2026-11-12).
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Final

import pikepdf

from hcm_pipeline.contract import Errors
from hcm_pipeline.jobs import StepFailedError

LOCKED_REASON: Final = "pdf-password"


@dataclass(frozen=True)
class Pages:
    """The page images taken out, in page order, and the pages that had none."""

    files: tuple[Path, ...]
    without_image: int


def _largest(page: pikepdf.Page) -> pikepdf.PdfImage | None:
    images = [pikepdf.PdfImage(image) for image in page.get_images().values() if isinstance(image, pikepdf.Stream)]
    return max(images, key=lambda image: image.width * image.height, default=None)


def _written(image: pikepdf.PdfImage, prefix: Path) -> Path | None:
    """The image as stored; decoded to a TIFF when it cannot be written as is; None when it cannot be decoded either."""
    try:
        return Path(image.extract_to(fileprefix=str(prefix)))
    except pikepdf.PdfError, NotImplementedError, ValueError:
        pass
    try:
        target = prefix.with_suffix(".tif")
        image.as_pil_image().save(target, format="TIFF", compression="tiff_deflate")
    except pikepdf.PdfError, NotImplementedError, ValueError, OSError:
        return None
    return target


def _opened(source: Path) -> pikepdf.Pdf | None:
    try:
        return pikepdf.open(source)
    except pikepdf.PasswordError:
        return None
    except pikepdf.PdfError as error:
        raise StepFailedError(Errors.ARCHIVE_CORRUPT, f"{source.name} is not a readable PDF: {str(error)[:160]}") from error


def extract_pages(source: Path, target: Path) -> Pages | None:
    """Every page's largest image under `target` (`page-0001.jpg`, ...); None when the PDF needs a password; `StepFailedError` when
    the file is no readable PDF."""
    target.mkdir(parents=True, exist_ok=True)
    document = _opened(source)
    if document is None:
        return None
    files, missing = [], 0
    with document:
        for number, page in enumerate(document.pages, start=1):
            image = _largest(page)
            written = None if image is None else _written(image, target / f"page-{number:04d}")
            if written is None:
                missing += 1
                continue
            files.append(written)
    return Pages(tuple(files), missing)
