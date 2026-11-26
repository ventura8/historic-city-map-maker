"""Whether a finished step's recorded output is still whole (RESILIENCE-AUDIT P0-3, docs/research/M7-local-worker.md
*Crashes and power cuts*).

On the owner's computer an object's generation is its file's modification time, which a power cut does not protect: a file
whose name reached the disk before its bytes keeps a "matching" generation with nothing (or zeros) inside. A resume therefore
checks the content of a local output before it passes a step over: its size is the size recorded when the step finished, and
its first bytes are what its kind starts with (a TIFF's byte order and magic, a PMTiles header, a JSON document that parses).
Anything else is damaged: the step runs again in the same run (no attempt is spent). Cloud Storage writes an object whole or
not at all, so its outputs are trusted by their generation as before.
"""

import json
from typing import Final

from hcm_pipeline.model import StepRecord
from hcm_pipeline.objects import ObjectInfo, ObjectStore, ObjectStoreError

# What the owner's computer keeps (`worker/routed.py` LOCAL_PREFIXES): only these can be torn by a power cut.
LOCAL_PREFIXES: Final = ("usgs-raw/", "work/", "reference/")
TIFF_MAGICS: Final = (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+")
PMTILES_MAGIC: Final = b"PMTiles"
# A JSON output larger than this is only checked by its size (the step files are a few kilobytes).
JSON_READ_MAX: Final = 16 * 1024 * 1024
HEAD_BYTES: Final = 8


def _head_ok(name: str, head: bytes) -> bool:
    if name.endswith((".tif", ".tiff")):
        return head[:4] in TIFF_MAGICS
    if name.endswith(".pmtiles"):
        return head.startswith(PMTILES_MAGIC)
    return True


def _content_ok(objects: ObjectStore, info: ObjectInfo) -> bool:
    """The output's first bytes (a JSON output: all of it) are what its kind is made of."""
    whole = info.path.endswith(".json") and info.size <= JSON_READ_MAX
    with objects.open_read(info.path) as stream:
        data = stream.read() if whole else stream.read(HEAD_BYTES)
    if not whole:
        return _head_ok(info.path, data)
    try:
        json.loads(data)
    except ValueError:
        return False
    return True


def _sized(record: StepRecord, info: ObjectInfo) -> bool:
    """The size the step recorded (none recorded: any), and never an empty file."""
    return info.size > 0 and record.bytes in (None, info.size)


def _readable(objects: ObjectStore, info: ObjectInfo) -> bool:
    try:
        return _content_ok(objects, info)
    except OSError, ObjectStoreError:
        return False


def output_intact(objects: ObjectStore, record: StepRecord, info: ObjectInfo, local: bool) -> bool:
    """True when the step's output `info` is whole: always for a cloud object, else its size and its first bytes."""
    if not (local and info.path.startswith(LOCAL_PREFIXES)):
        return True
    return _sized(record, info) and _readable(objects, info)
