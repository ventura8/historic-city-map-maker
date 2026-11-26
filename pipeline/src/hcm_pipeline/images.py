"""Plain images through OpenCV: the previews, the reference drawings, contrast enhancement and resizing.

OpenCV orders colour channels blue-green-red; every function here takes and returns RGB (or RGBA) and converts
at the file boundary. Determinism: `deterministic()` pins OpenCV to one thread and a seed (the tests and the
matcher's RANSAC, docs/research/M3-interfaces.md §5.6).
"""

from pathlib import Path
from typing import Final

import cv2
import numpy
from numpy.typing import NDArray

UInt8Array = NDArray[numpy.uint8]
JPEG_QUALITY: Final = 85
CLAHE_CLIP: Final = 2.0
CLAHE_TILES: Final = 8
GRAY_DIMENSIONS: Final = 2
RGB_CHANNELS: Final = 3


class ImageError(RuntimeError):
    """OpenCV could not encode an image."""


def deterministic(seed: int) -> None:
    """One OpenCV thread and a fixed seed (the tests)."""
    cv2.setNumThreads(1)
    seeded(seed)


def seeded(seed: int) -> None:
    """OpenCV's random generator (RANSAC) seeded, so a job matches the same way every time."""
    cv2.setRNGSeed(seed)


def as_uint8(image: object) -> UInt8Array:
    return numpy.asarray(image, numpy.uint8)


def _write(path: Path, extension: str, image: UInt8Array, params: list[int]) -> Path:
    ok, encoded = cv2.imencode(extension, image, params)
    if not ok:
        raise ImageError(f"OpenCV could not encode {path.name}")
    path.write_bytes(numpy.asarray(encoded, numpy.uint8).tobytes())
    return path


def _bgr(image: UInt8Array) -> UInt8Array:
    if image.ndim == GRAY_DIMENSIONS:
        return image
    code = cv2.COLOR_RGB2BGR if image.shape[2] == RGB_CHANNELS else cv2.COLOR_RGBA2BGRA
    return as_uint8(cv2.cvtColor(image, code))


def write_jpeg(path: Path, image: UInt8Array, quality: int = JPEG_QUALITY) -> Path:
    """A grey or RGB image as a JPEG."""
    return _write(path, ".jpg", _bgr(image), [cv2.IMWRITE_JPEG_QUALITY, quality])


def write_png(path: Path, image: UInt8Array) -> Path:
    """A grey, RGB or RGBA image as a PNG."""
    return _write(path, ".png", _bgr(image), [cv2.IMWRITE_PNG_COMPRESSION, 6])


def resize(image: UInt8Array, size: tuple[int, int]) -> UInt8Array:
    """`image` at `size` (width, height), averaged when it shrinks."""
    shrinking = size[0] < image.shape[1]
    return as_uint8(cv2.resize(image, size, interpolation=cv2.INTER_AREA if shrinking else cv2.INTER_LINEAR))


def enhance(image: UInt8Array) -> UInt8Array:
    """Contrast-limited adaptive histogram equalisation (CLAHE) of a grey image."""
    return as_uint8(cv2.createCLAHE(clipLimit=CLAHE_CLIP, tileGridSize=(CLAHE_TILES, CLAHE_TILES)).apply(image))
