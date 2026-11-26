"""A PDF page drawn from its images as it is shown (docs/research/M20-import-local.md §3, *PDFs*; finding of 2026-11-22, LESSONS 759).

The page's largest image as stored is not always the page: a scan stored upright on a turned page (`/Rotate`), placed stretched, or cut
into strips. Taken out as stored, the plan-ghid 1923 reduced to one page came out 1029 x 1934 px against a landscape page: squeezed and
coarse. Here the content stream's images are placed by their matrices (`cm`, `q`, `Q`, `Do`) on a canvas of the page's box at the finest
image's own density, then turned by `/Rotate`: full resolution, the true aspect. A page whose one image already is the page (upright, no
turn, its pixels' aspect the placement's) is still taken out byte for byte (`pdfpages.py`). The canvas is held to `CANVAS_MAX_PX`.
"""

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import cv2
import numpy
import pikepdf

# The canvas's pixels at most (a 16,000 x 12,500 page): finer images are drawn at the density that fits.
CANVAS_MAX_PX: Final = 200_000_000
# How far a placement's aspect may differ from its pixels' before the page is drawn rather than taken out as stored.
ASPECT_TOLERANCE: Final = 0.01

# A `cm` operator's six numbers.
MATRIX_VALUES: Final = 6

Affine = tuple[float, float, float, float, float, float]
IDENTITY: Final[Affine] = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


@dataclass(frozen=True)
class Placement:
    """An image drawn on the page and its matrix from the unit square to the page's user space."""

    image: pikepdf.PdfImage
    matrix: Affine


def _times(first: Affine, second: Affine) -> Affine:
    """`first` then `second`, as PDF's row-vector matrices (`cm` makes the new CTM `M x CTM`)."""
    a, b, c, d, e, f = first
    p, q, r, s, t, u = second
    return (a * p + b * r, a * q + b * s, c * p + d * r, c * q + d * s, e * p + f * r + t, e * q + f * s + u)


def _image(page: pikepdf.Page, name: object) -> pikepdf.PdfImage | None:
    objects = page.obj.get("/Resources", pikepdf.Dictionary()).get("/XObject", pikepdf.Dictionary())
    found = objects.get(str(name))
    if not isinstance(found, pikepdf.Stream) or found.get("/Subtype") != pikepdf.Name.Image:
        return None
    return pikepdf.PdfImage(found)


class _Reader:
    """The graphics state a content stream walks through: the CTM, its saved copies and the images drawn."""

    def __init__(self, page: pikepdf.Page) -> None:
        self.page = page
        self.ctm: Affine = IDENTITY
        self.saved: list[Affine] = []
        self.found: list[Placement] = []

    def step(self, verb: str, operands: list[object]) -> None:
        verbs = {"q": self.save, "Q": self.restore, "cm": self.concat, "Do": self.draw}
        action = verbs.get(verb)
        if action is not None:
            action(operands)

    def save(self, _operands: list[object]) -> None:
        self.saved.append(self.ctm)

    def restore(self, _operands: list[object]) -> None:
        self.ctm = self.saved.pop() if self.saved else IDENTITY

    def concat(self, operands: list[object]) -> None:
        values = [float(str(value)) for value in operands]
        if len(values) == MATRIX_VALUES:
            self.ctm = _times((values[0], values[1], values[2], values[3], values[4], values[5]), self.ctm)

    def draw(self, operands: list[object]) -> None:
        image = _image(self.page, operands[0]) if operands else None
        if image is not None:
            self.found.append(Placement(image, self.ctm))


def placements(page: pikepdf.Page) -> list[Placement]:
    """Every image the page's own content stream draws, with its matrix (images inside forms are not followed)."""
    reader = _Reader(page)
    for instruction in pikepdf.parse_content_stream(page):
        if isinstance(instruction, pikepdf.ContentStreamInstruction):
            reader.step(str(instruction.operator), list(instruction.operands))
    return reader.found


def _rotation(page: pikepdf.Page) -> int:
    return int(page.obj.get("/Rotate", 0)) % 360


def is_as_stored(page: pikepdf.Page, drawn: list[Placement]) -> bool:
    """The page is its one image upright: taken out as stored. A page that draws none is too (its largest image is all there is)."""
    if not drawn:
        return True
    return len(drawn) == 1 and _rotation(page) == 0 and _upright(drawn[0])


def _upright(placement: Placement) -> bool:
    """Drawn unturned, unmirrored, with its pixels' aspect."""
    a, b, c, d, _e, _f = placement.matrix
    if b != 0 or c != 0 or a <= 0 or d <= 0:
        return False
    return math.isclose(a / d, placement.image.width / placement.image.height, rel_tol=ASPECT_TOLERANCE)


def _density(drawn: list[Placement]) -> float:
    """Pixels a point of the finest image drawn (its long side over the length it is drawn at)."""
    best = 0.0
    for placement in drawn:
        a, b, c, d, _e, _f = placement.matrix
        across, down = math.hypot(a, b), math.hypot(c, d)
        if across > 0 and down > 0:
            best = max(best, placement.image.width / across, placement.image.height / down)
    return best


def _box(page: pikepdf.Page) -> tuple[float, float, float, float]:
    left, bottom, right, top = (float(value) for value in page.mediabox)
    return min(left, right), min(bottom, top), max(left, right), max(bottom, top)


def _pixels(image: pikepdf.PdfImage) -> numpy.ndarray | None:
    try:
        return numpy.asarray(image.as_pil_image().convert("RGB"))
    except pikepdf.PdfError, NotImplementedError, ValueError, OSError:
        return None


def _paste(canvas: numpy.ndarray, placement: Placement, origin: tuple[float, float], scale: float) -> None:
    """One image warped onto the canvas: its pixel (u, v) is the unit square's (u / W, 1 - v / H), then the CTM, then the canvas's
    flipped y."""
    pixels = _pixels(placement.image)
    if pixels is None:
        return
    height, width = pixels.shape[:2]
    a, b, c, d, e, f = placement.matrix
    left, top = origin
    forward = numpy.array(
        [
            [scale * a / width, -scale * c / height, scale * (c + e - left)],
            [-scale * b / width, scale * d / height, scale * (top - d - f)],
        ]
    )
    size = (canvas.shape[1], canvas.shape[0])
    warped = cv2.warpAffine(pixels, forward, size, flags=cv2.INTER_LINEAR)
    mask = cv2.warpAffine(numpy.full((height, width), 255, numpy.uint8), forward, size, flags=cv2.INTER_NEAREST)
    canvas[mask > 0] = warped[mask > 0]


def compose(page: pikepdf.Page, drawn: list[Placement], target: Path) -> Path | None:
    """The page drawn from its images at the finest one's density, turned by `/Rotate`, written as a TIFF; None when nothing can be
    drawn."""
    left, bottom, right, top = _box(page)
    area = (right - left) * (top - bottom)
    density = _density(drawn)
    if area <= 0 or density <= 0:
        return None
    scale = min(density, math.sqrt(CANVAS_MAX_PX / area))
    canvas = numpy.full((round((top - bottom) * scale), round((right - left) * scale), 3), 255, numpy.uint8)
    for placement in drawn:
        _paste(canvas, placement, (left, top), scale)
    turned = numpy.ascontiguousarray(numpy.rot90(canvas, k=-_rotation(page) // 90))
    written = target.with_suffix(".tif")
    cv2.imwrite(str(written), cv2.cvtColor(turned, cv2.COLOR_RGB2BGR))
    return written
