"""Each file of an archive read in a sandboxed child (docs/research/M20-import-local.md §2.2).

The parent hashes the file itself (SHA-256, streamed) and sniffs its magic bytes; anything that decodes is read in a child process,
spawned (never forked: nothing of the worker's own state is copied into it), which first tells GDAL to stay local, then limits itself
(`RLIMIT_AS` 4 GiB, 60 s of CPU) and refuses a raster past 1.5 gigapixels before decoding a pixel (`probe_child`). The parent waits at
most `PROBE_TIMEOUT_SECONDS` for its answer. A crash, a timeout or an answer that does not parse becomes an `unreadable` probe and never
stops the scan. Nothing of the archive is ever executed, and the archive's folder is never on the child's import path.
"""

import hashlib
import importlib
import json
import multiprocessing
import os
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Final, Protocol

from hcm_pipeline.archive.magic import RASTERS, sniff_file
from hcm_pipeline.archive.model import Probe

PROBE_TIMEOUT_SECONDS: Final = 90
JOIN_SECONDS: Final = 5
HASH_CHUNK_BYTES: Final = 1024 * 1024
CHILD_MODULE: Final = "hcm_pipeline.archive.probe_child"
# The child's GDAL: no folder scanned beside the file, no remote address opened, no proxy.
CHILD_ENV: Final = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".none",
    "GDAL_HTTP_TIMEOUT": "1",
    "NO_PROXY": "*",
}
DECODED: Final = RASTERS | {"pdf"}

# Reads one file in a child; answers the child's JSON record, or raises (`OSError`, `EOFError`, `ValueError`).
Runner = Callable[[Path], str]


class Sender(Protocol):
    """The child's end of the pipe."""

    def send(self, obj: object, /) -> None: ...

    def close(self) -> None: ...


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        while chunk := file.read(HASH_CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


def child_main(path: str, sender: Sender) -> None:
    """The spawned child's body: GDAL kept local, the limits set, then the file read; its record sent as JSON."""
    os.environ.update(CHILD_ENV)
    child = importlib.import_module(CHILD_MODULE)
    child.limit_self()
    sender.send(json.dumps(child.record_for(Path(path))))
    sender.close()


def run_child(path: Path) -> str:
    """The child's record of `path`; `TimeoutError` past the timeout, `EOFError` when the child died before it answered."""
    context = multiprocessing.get_context("spawn")
    receiver, sender = context.Pipe(duplex=False)
    process = context.Process(target=child_main, args=(str(path), sender), daemon=True)
    process.start()
    sender.close()
    try:
        if not receiver.poll(PROBE_TIMEOUT_SECONDS):
            raise TimeoutError(f"no answer in {PROBE_TIMEOUT_SECONDS} s")
        return str(receiver.recv())
    finally:
        receiver.close()
        process.join(JOIN_SECONDS)
        process.kill()
        process.join()


def _int(record: Mapping[str, object], key: str) -> int:
    value = record.get(key)
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _text(record: Mapping[str, object], key: str) -> str:
    value = record.get(key)
    return value[:200] if isinstance(value, str) else ""


def _dpi(record: Mapping[str, object]) -> float | None:
    value = record.get("dpi")
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) and value > 0 else None


def _fingerprint(record: Mapping[str, object]) -> tuple[int, ...]:
    value = record.get("fingerprint")
    return tuple(item for item in value if isinstance(item, int)) if isinstance(value, list) else ()


def probe_of(record: Mapping[str, object], fmt: str) -> Probe:
    """The child's JSON record as a `Probe`: each field checked for its type (the child is trusted no more than the file)."""
    return Probe(
        format=fmt,
        width=_int(record, "width"),
        height=_int(record, "height"),
        bands=_int(record, "bands"),
        bits=_int(record, "bits"),
        colour=_text(record, "colour"),
        compression=_text(record, "compression"),
        dpi=_dpi(record),
        crs=record.get("crs") is True,
        gcps=_int(record, "gcps"),
        pages=_int(record, "pages"),
        encrypted=record.get("encrypted") is True,
        software=_text(record, "software"),
        fingerprint=_fingerprint(record),
        error=_text(record, "error"),
    )


def probe_file(path: Path, run: Runner = run_child) -> Probe:
    """What the file is; decoded in the child when it is a raster or a PDF, else from its magic bytes alone."""
    fmt = sniff_file(path)
    if fmt not in DECODED:
        return Probe(format=fmt)
    try:
        answer = json.loads(run(path))
    except (OSError, EOFError, ValueError) as error:
        return Probe(format=fmt, error=type(error).__name__)
    return probe_of(answer, fmt) if isinstance(answer, dict) else Probe(format=fmt, error="answer")
