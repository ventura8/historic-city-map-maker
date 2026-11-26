"""Find a series' overview map in the archive and build its mosaic (slices 3-4)."""

from __future__ import annotations

import math
import os
import re
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import numpy as np

from hcm_pipeline.placing.assemble import CANVAS_MAX_PX
from hcm_pipeline.placing.overview import MosaicReport, TileFit, detail_of, fit_tiles, paste_on_overview
from hcm_pipeline.placing.overview_holes import refit_in_holes
from hcm_pipeline.placing.raster_io import read_working
from hcm_pipeline.placing.streets import UInt8Array, grey_of

RASTER_SUFFIXES: frozenset[str] = frozenset({".jpg", ".jpeg", ".tif", ".tiff", ".png"})
SKIP_NAMES: frozenset[str] = frozenset({"thumbs.db", ".ds_store", "desktop.ini"})
# A file at least this large is accepted without opening it; smaller rasters are probed for a long side ≥ MIN_SIDE.
TRUST_BYTES: int = 50_000
MIN_BYTES: int = 1_024
MIN_SIDE: int = 256
# A year stands alone: "1-10000" (a map's scale) holds no year.
YEAR_RE = re.compile(r"(?<!\d)\d{4}(?!\d)")
TOKEN_RE = re.compile(r"[A-Za-z]{4,}")
DEFAULT_READ_PX: int = 2400
UPSCALE_LO: float = 1.5
UPSCALE_HI: float = 8.0


@dataclass(frozen=True)
class CanvasOpts:
    """Grid size, upscale and read size for `overview_canvas`, and whether the canvas keeps the series' colour."""

    rows: int | None = None
    cols: int | None = None
    upscale: float | None = None
    read_px: int = DEFAULT_READ_PX
    colour: bool = False


def _tokens(name: str) -> set[str]:
    return set(YEAR_RE.findall(name)) | {token.lower() for token in TOKEN_RE.findall(name)}


def _long_side(path: Path) -> int:
    try:
        working = read_working(path, MIN_SIDE)
    except OSError, RuntimeError, ValueError:
        return 0
    return max(working.width, working.height)


def _size_ok(path: Path) -> bool:
    try:
        size = path.stat().st_size
    except OSError:
        return False
    if size >= TRUST_BYTES:
        return True
    return size >= MIN_BYTES and _long_side(path) >= MIN_SIDE


def _ok_file(path: Path, sheets: set[Path]) -> bool:
    skipped = path.resolve() in sheets or path.name.lower() in SKIP_NAMES
    return (not skipped) and path.suffix.lower() in RASTER_SUFFIXES and path.is_file() and _size_ok(path)


def _pick(candidates: Sequence[Path], folder_tokens: set[str]) -> Path | None:
    if not candidates:
        return None
    ranked = sorted(candidates, key=lambda path: (len(_tokens(path.stem) & folder_tokens), path.stat().st_size), reverse=True)
    return ranked[0]


def _candidates(directory: Path, sheets: set[Path]) -> list[Path]:
    return [path for path in directory.iterdir() if _ok_file(path, sheets)] if directory.is_dir() else []


def _under_root(path: Path, root: Path) -> bool:
    resolved, base = path.resolve(), root.resolve()
    return resolved == base or base in resolved.parents


def _path_tokens(path: Path) -> set[str]:
    return _tokens(path.stem) | _tokens(path.parent.name)


def _needed(tokens: set[str]) -> set[str]:
    """What a related file must share: a year when the pieces' folders name one (a city's name alone matches every map), else a word."""
    years = {token for token in tokens if token.isdigit()}
    return years or tokens


def _related(candidates: Sequence[Path], tokens: set[str]) -> list[Path]:
    return [path for path in candidates if _path_tokens(path) & tokens]


def _levels(folder: Path, root: Path) -> list[Path]:
    """The folder's ancestors, nearest first, from its parent up to the archive root."""
    base = root.resolve()
    return [level for level in folder.resolve().parents if level == base or base in level.parents]


def _level_candidates(level: Path, came_from: Path, sheets: set[Path]) -> list[Path]:
    """Rasters loose in `level` and in its child folders, leaving out the branch the pieces live in."""
    found = _candidates(level, sheets)
    for child in sorted(level.iterdir()):
        if child.is_dir() and child != came_from:
            found.extend(_candidates(child, sheets))
    return found


def _near_overview(folder: Path, root: Path, sheets: set[Path], tokens: set[str]) -> Path | None:
    """Any raster one folder up; else, climbing towards the archive root, the best related raster beside each ancestor's branch."""
    found = _pick(_candidates(folder.parent, sheets), tokens)
    if found is not None:
        return found
    need, came_from = _needed(tokens), folder.resolve()
    for level in _levels(folder, root):
        found = _pick(_related(_level_candidates(level, came_from, sheets), need), tokens)
        if found is not None:
            return found
        came_from = level
    return None


def _search(folder: Path, root: Path, sheets: set[Path], tokens: set[str]) -> Path | None:
    found = _pick(_candidates(folder, sheets), tokens)
    if found is not None or not _under_root(folder.parent, root):
        return found
    return _near_overview(folder, root, sheets, tokens)


def find_overview(root: Path, sheets: Sequence[Path]) -> Path | None:
    """A loose overview raster beside the series' tiles, or a same-year raster beside a branch on the way up to the archive root."""
    if not sheets:
        return None
    resolved = [sheet.resolve() for sheet in sheets]
    folder = Path(os.path.commonpath([str(path.parent) for path in resolved]))
    if not _under_root(folder, root):
        return None
    return _search(folder, root, set(resolved), _tokens(folder.name) | _tokens(folder.parent.name))


# What stands for a tile that did not fit: never pasted, so never read.
_EMPTY: Final = np.zeros((0, 0), dtype=np.uint8)


def _read_grey(path: Path, read_px: int) -> UInt8Array:
    return grey_of(read_working(path, read_px).image)


def _upscale_of(fits: Sequence[TileFit | None], overview: UInt8Array) -> float:
    """The canvas keeps the tiles' detail (their pixels per overview pixel), within the bounds and `CANVAS_MAX_PX`."""
    detail = detail_of(fits) or UPSCALE_LO
    ceiling = min(UPSCALE_HI, CANVAS_MAX_PX / max(float(max(overview.shape[:2])), 1.0))
    return float(min(ceiling, max(UPSCALE_LO, detail)))


def _enough(placed: int, total: int) -> bool:
    return placed >= max(2, (total + 1) // 2)


def _colour_tiles(tiles: Sequence[tuple[str, Path]], fits: Sequence[TileFit | None], read_px: int) -> Iterator[tuple[str, UInt8Array]]:
    """Each placed tile read again in its own colour at the size it was fitted at, one at a time as it is pasted: a colour series'
    tiles are never all held in three bands at once (the canvas itself can be 15,000 x 17,000). A tile that did not fit is skipped
    by the paste, so it is not read again (an empty stand-in keeps the pairing with its fit)."""
    return ((name, _EMPTY if fit is None else read_working(path, read_px).image) for (name, path), fit in zip(tiles, fits, strict=True))


def _mosaic(
    tiles: Sequence[tuple[str, Path]],
    loaded: Sequence[tuple[str, UInt8Array]],
    overview_grey: UInt8Array,
    settings: CanvasOpts,
) -> tuple[UInt8Array, MosaicReport]:
    """The tiles fitted on their grey features, the left-out ones looked for again in the overview's holes; pasted grey, or in
    their own colour when the series is colour."""
    side = max(1, math.ceil(math.sqrt(len(loaded))))
    rows = settings.rows if settings.rows is not None else side
    cols = settings.cols if settings.cols is not None else side
    fits = refit_in_holes(loaded, fit_tiles(loaded, overview_grey, rows, cols), overview_grey)
    scale = settings.upscale if settings.upscale is not None else _upscale_of(fits, overview_grey)
    pieces = _colour_tiles(tiles, fits, settings.read_px) if settings.colour else loaded
    return paste_on_overview(pieces, fits, overview_grey.shape, scale, settings.colour)


def _load_tiles(tiles: Sequence[tuple[str, Path]], read_px: int) -> list[tuple[str, UInt8Array]]:
    return [(name, _read_grey(path, read_px)) for name, path in tiles]


def overview_canvas(
    tiles: Sequence[tuple[str, Path]],
    overview: Path,
    opts: CanvasOpts | None = None,
) -> tuple[UInt8Array, MosaicReport] | None:
    """Tiles laid on the overview at tile detail (in colour when `opts.colour`), or None when too few match."""
    settings = opts or CanvasOpts()
    if not tiles:
        return None
    if not overview.is_file():
        return None
    loaded = _load_tiles(tiles, settings.read_px)
    canvas, report = _mosaic(tiles, loaded, _read_grey(overview, settings.read_px), settings)
    if not _enough(len(report.placed), len(loaded)):
        return None
    return canvas, report
