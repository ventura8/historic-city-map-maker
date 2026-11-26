"""What a file is, by its first bytes, never by its extension (docs/research/M20-import-local.md §2.2).

The archive proves why: a TIFF named `.368`, a G4 TIFF with no extension at all. `sniff` reads at most `HEAD_BYTES` and answers a format
name the classifier knows (`tiff`, `jpeg`, `png`, `pdf`, `ole2`, `dwg`, `dxf`, `zip`, ...) or `unknown`.
"""

from pathlib import Path
from typing import Final

HEAD_BYTES: Final = 64
RASTERS: Final = frozenset({"tiff", "bigtiff", "jpeg", "png", "gif", "bmp", "webp", "jp2"})
_SIGNATURES: Final = (
    (b"II*\x00", "tiff"),
    (b"MM\x00*", "tiff"),
    (b"II+\x00", "bigtiff"),
    (b"MM\x00+", "bigtiff"),
    (b"\xff\xd8\xff", "jpeg"),
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"GIF87a", "gif"),
    (b"GIF89a", "gif"),
    (b"%PDF-", "pdf"),
    (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", "ole2"),
    (b"PK\x03\x04", "zip"),
    (b"AC10", "dwg"),
    (b"\x00\x00\x00\x0cjP  \r\n\x87\n", "jp2"),
    (b"BM", "bmp"),
)
_DXF_START: Final = (b"0\r\nSECTION", b"0\nSECTION", b"  0\r\nSECTION", b"  0\nSECTION")
_RIFF: Final = b"RIFF"
_WEBP: Final = b"WEBP"
_WEBP_AT: Final = 8


def _signed(head: bytes) -> str | None:
    """The format whose leading signature `head` carries, or None."""
    return next((name for signature, name in _SIGNATURES if head.startswith(signature)), None)


def _riff_or_dxf(head: bytes) -> str:
    if head.startswith(_RIFF) and head[_WEBP_AT : _WEBP_AT + len(_WEBP)] == _WEBP:
        return "webp"
    return "dxf" if head.lstrip(b"\xef\xbb\xbf").startswith(_DXF_START) else "unknown"


def sniff(head: bytes) -> str:
    """The format of a file that starts with `head`."""
    return _signed(head) or _riff_or_dxf(head)


def sniff_file(path: Path) -> str:
    """The format of the file at `path`, from its first bytes."""
    with path.open("rb") as file:
        return sniff(file.read(HEAD_BYTES))
