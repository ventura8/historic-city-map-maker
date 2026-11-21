"""The probe's child (M20 §2.2): `probe.child_main` in a spawned process, or `python -m hcm_pipeline.archive.probe_child <path>`,
which prints one JSON record.

It limits itself before it reads anything (`RLIMIT_AS` 4 GiB, `RLIMIT_CPU` 60 s), so a decoder that runs away dies alone. A raster's
header is read first; one past `MAX_PIXELS` is answered from its header only. A PDF is read as bytes, never parsed by a library: its
pages and whether it is encrypted, from its objects. A raster's 16x16 grey fingerprint (for twins and crops) comes from a decimated read.
"""

import json
import re
import resource
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Final

import numpy as np

from hcm_pipeline.raster import gdal

ADDRESS_SPACE_BYTES: Final = 4 * 1024**3
CPU_SECONDS: Final = 60
MAX_PIXELS: Final = 1_500_000_000
FINGERPRINT_PX: Final = 16
PDF_READ_BYTES: Final = 256 * 1024 * 1024
PDF_MAGIC: Final = b"%PDF-"
_PAGE: Final = re.compile(rb"/Type\s*/Page(?![a-zA-Z])")
_ENCRYPT: Final = re.compile(rb"/Encrypt\s")
_PALETTE: Final = 2
_RGB: Final = 3


def limit_self() -> None:
    """The child's own limits, set before anything of the file is read."""
    resource.setrlimit(resource.RLIMIT_AS, (ADDRESS_SPACE_BYTES, ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_CPU, (CPU_SECONDS, CPU_SECONDS))


def pdf_record(path: Path) -> dict[str, object]:
    with path.open("rb") as file:
        data = file.read(PDF_READ_BYTES)
    return {"pages": len(_PAGE.findall(data)), "encrypted": _ENCRYPT.search(data) is not None}


def _dpi(dataset: gdal.Dataset) -> float | None:
    value = dataset.GetMetadataItem("TIFFTAG_XRESOLUTION")
    try:
        return float(value) if value else None
    except ValueError:
        return None


def _colour(dataset: gdal.Dataset, bits: int) -> str:
    """`bilevel`, `grey`, `palette` or `rgb`: what the encoding is chosen from."""
    interpretation = dataset.GetRasterBand(1).GetColorInterpretation()
    if bits == 1:
        return "bilevel"
    if dataset.RasterCount >= _RGB:
        return "rgb"
    return "palette" if interpretation == _PALETTE else "grey"


def fingerprint(dataset: gdal.Dataset) -> list[int]:
    """The first band read down to 16x16 (nearest), stretched to 0-255."""
    band = dataset.GetRasterBand(1)
    small = band.ReadAsArray(buf_xsize=FINGERPRINT_PX, buf_ysize=FINGERPRINT_PX).astype(np.float64)
    span = float(small.max() - small.min()) or 1.0
    return [int(value) for value in np.round((small - small.min()) * 255 / span).ravel()]


def raster_record(path: Path) -> dict[str, object]:
    dataset = gdal.Open(str(path))
    band = dataset.GetRasterBand(1)
    bits = int(band.GetMetadataItem("NBITS", "IMAGE_STRUCTURE") or 8)
    record: dict[str, object] = {
        "width": dataset.RasterXSize,
        "height": dataset.RasterYSize,
        "bands": dataset.RasterCount,
        "bits": bits,
        "colour": _colour(dataset, bits),
        "compression": dataset.GetMetadataItem("COMPRESSION", "IMAGE_STRUCTURE") or "",
        "dpi": _dpi(dataset),
        "crs": bool(dataset.GetProjection()),
        "gcps": dataset.GetGCPCount(),
        "software": dataset.GetMetadataItem("TIFFTAG_SOFTWARE") or "",
    }
    if dataset.RasterXSize * dataset.RasterYSize <= MAX_PIXELS:
        record["fingerprint"] = fingerprint(dataset)
    dataset.Close()
    return record


def record_of(path: Path, fmt: str) -> Mapping[str, object]:
    return pdf_record(path) if fmt == "pdf" else raster_record(path)


def record_for(path: Path) -> Mapping[str, object]:
    """The file's record (a PDF by its first bytes, anything else as a raster), or why it could not be read."""
    with path.open("rb") as file:
        fmt = "pdf" if file.read(len(PDF_MAGIC)) == PDF_MAGIC else "raster"
    try:
        return record_of(path, fmt)
    except RuntimeError as error:
        return {"error": str(error)[:200]}


def main(argv: list[str]) -> int:
    limit_self()
    sys.stdout.write(json.dumps(record_for(Path(argv[1]))))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
