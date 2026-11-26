"""The archive's shared vocabulary (twins of `packages/shared/src/schemas/imagery-archive.ts`, held equal by `enums.json`) and records.

`FileRow` is one file of the archive as the probe read it; it stays in the worker's own `archive.json`. `Series` is what the report
proposes for a group of files. Paths are always relative to the archive's root, POSIX-style.
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Final

ARCHIVE_SERIES_CLASSES: Final = ("georeferenced", "grid", "atlas", "pieces", "single", "cad")
ARCHIVE_SKIP_REASONS: Final = (
    "not-a-map",
    "not-a-map-page",
    "duplicate-of",
    "twin-of",
    "crop-of",
    "do-not-publish",
    "index-only",
    "too-small",
    "unreadable",
    "pdf-password",
    "needs-cad-export",
    "unsafe-path",
    "too-many-series",
)
ARCHIVE_ENCODINGS: Final = ("lineart", "grey", "colour")
ARCHIVE_AUTO_LIKELIHOODS: Final = ("likely", "possible", "points")
ARCHIVE_PLACE_METHODS: Final = ("embedded", "grid", "atlas", "pieces", "match", "gcps", "grid-names", "overview")
# How a series' parts were joined into one picture (`help.stitched.method`; `STITCH_METHODS` of @hcm/shared).
STITCH_METHODS: Final = ("grid", "atlas", "pieces", "single", "overview", "names", "owner")
# Why a part is left out of the stitched picture, and how many of them `help.stitched.leftOut` names (`LEFT_OUT_REASONS`,
# `STITCHED_LEFT_OUT_MAX` of @hcm/shared; the shared contract since 2026-11-12, lesson 579).
LEFT_OUT_REASONS: Final = ("no-frame", "no-join", "blank", "not-part", "no-seam")
STITCHED_LEFT_OUT_MAX: Final = 200
RIGHTS_LICENCES: Final = ("PD", "CC0", "CC-BY-4.0", "CC-BY-SA-4.0", "permission", "unclear", "unknown")
RIGHTS_STATES: Final = ("clear", "needs-confirmation", "do-not-publish")
HELP_REASONS: Final = ("no-path", "low-confidence", "frame-not-found", "no-scale", "archive-missing", "layout-check")
# The tile layout (`imagery-tiles.ts` of @hcm/shared; docs/research/M20-import-local.md §19): seams' states, where a sheet's cell came
# from, its quarter turns, the series' verdict, the seams' sides, the verdict's thresholds and the files' limits and sprite cells.
SEAM_STATES: Final = ("strong", "weak", "missing", "owner")
SHEET_SOURCES: Final = ("name", "overview", "seam", "order", "owner")
SHEET_TURNS: Final = (0, 90, 180, 270)
STITCH_VERDICTS: Final = ("good", "check", "poor")
SEAM_SIDES: Final = ("right", "below")
STITCH_GOOD_PLACED_PCT: Final = 90
STITCH_GOOD_SEAM_NCC: Final = 0.5
STITCH_GOOD_RMS_PX: Final = 3
STITCH_MAX_MOVE_CELL: Final = 0.25
LAYOUT_WEAK_SEAMS_MAX: Final = 200
LAYOUT_SHEETS_MAX: Final = 10000
LAYOUT_SEAMS_MAX: Final = 40000
THUMB_CELL_PX: Final = 128
THUMB_SPRITE_COLS: Final = 32
SEAM_CELL_PX: Final = 256
ARCHIVE_MAX_SERIES: Final = 200
ARCHIVE_ISSUES_MAX: Final = 500
ARCHIVE_SERIES_MAX_BYTES: Final = 2_000_000_000
# A raster under this many pixels on its long side is too small to calibrate (it is still importable if the owner insists).
MIN_LONG_SIDE_PX: Final = 600


@dataclass(frozen=True)
class Probe:
    """What the sandboxed probe read of one file; `format` is from its magic bytes, never its extension."""

    format: str
    width: int = 0
    height: int = 0
    bands: int = 0
    bits: int = 0
    colour: str = ""
    compression: str = ""
    dpi: float | None = None
    crs: bool = False
    gcps: int = 0
    pages: int = 0
    encrypted: bool = False
    software: str = ""
    # A 16x16 grey fingerprint (256 values 0-255) for twins and crops; empty when none was read.
    fingerprint: tuple[int, ...] = ()
    error: str = ""

    @property
    def raster(self) -> bool:
        return self.width > 0 and self.height > 0


@dataclass(frozen=True)
class FileRow:
    """One file of the archive: its relative path, size, SHA-256 and what its probe read."""

    path: str
    size: int
    sha256: str
    probe: Probe
    # A world file (`.tfw`, `.jgw`, `.pgw`, `.wld`) or a `.prj` / `.aux.xml` beside it.
    sidecars: tuple[str, ...] = ()


@dataclass(frozen=True)
class Rights:
    """A series' rights as the pre-flag rules (or the owner's sidecar) set them; the owner edits and confirms them in the report."""

    licence: str
    state: str
    year: str
    author: str | None = None
    source_label: str | None = None
    source_url: str | None = None
    watermark: str | None = None
    note: str | None = None
    # Who granted the permission or confirmed the licence, in the owner's own words.
    confirmed_by: str | None = None
    # The original the scan was made from (a library, a museum), its address, and whether that is only likely.
    original_label: str | None = None
    original_url: str | None = None
    original_probable: bool = False

    def _original(self) -> dict[str, object] | None:
        if self.original_label is None:
            return None
        original: dict[str, object] = {"label": self.original_label}
        original |= {"url": self.original_url} if self.original_url else {}
        return original | ({"probable": True} if self.original_probable else {})

    def as_record(self) -> dict[str, object]:
        record: dict[str, object] = {"licence": self.licence, "state": self.state, "year": self.year}
        optional: dict[str, object] = {"author": self.author, "sourceLabel": self.source_label, "sourceUrl": self.source_url}
        optional |= {"watermark": self.watermark, "note": self.note, "confirmedBy": self.confirmed_by, "original": self._original()}
        return record | {key: value for key, value in optional.items() if value}


@dataclass(frozen=True)
class Series:
    """A group of files that make one map: what the report proposes for it."""

    key: str
    series_class: str
    title: str
    files: tuple[FileRow, ...]
    year: int | None = None
    year_label: str | None = None
    edition: str | None = None
    scale: int | None = None
    reason: str | None = None
    grid: str | None = None
    # The owner's sidecar: the deepest zoom the tiles may go to, and a series imported last (`priority: low`).
    maxzoom: int | None = None
    low: bool = False
    # Each file's place in the series (a grid cell, an atlas page), by relative path.
    cells: Mapping[str, str] = field(default_factory=dict)

    @property
    def bytes(self) -> int:
        return sum(row.size for row in self.files)


@dataclass(frozen=True)
class Skip:
    """A file that becomes no series, and why; `of` is the kept file a duplicate, a twin or a crop stands for."""

    path: str
    reason: str
    of: str | None = None
