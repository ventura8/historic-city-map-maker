"""Every file of an archive into exactly one series or one skip reason (docs/research/M20-import-local.md §2.3), for any city.

The detectors run in order, each on what the ones before left: junk (thumbnail caches, autosaves, listings, system files), exact
duplicates (SHA-256; the shortest name is kept), CAD drawings (reported: they need an export from CAD in v1), already georeferenced
rasters, sheet series whose names a grammar reads (`grammar.py`; an edition suffix makes its own partial series), atlases (numbered pages
in one folder; titled pages that are no map are skipped, an index page is kept for the layout only), pieces (a folder of at least three
scans in a scanner's own order, `img362.jpg`, one series per folder, or per parent when all its folders are pieces: the four `N_quadrat`
folders of one sheet), and single maps. A raster too small to calibrate becomes a series the report proposes to skip. Whether pieces
really overlap is the placer's to find (`placing.assemble`); twin scans need the pixels and stay singles here.
"""

import re
from collections import defaultdict
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Final

from hcm_pipeline.archive import grammar
from hcm_pipeline.archive.magic import RASTERS
from hcm_pipeline.archive.model import MIN_LONG_SIDE_PX, FileRow, Series, Skip

JUNK_NAMES: Final = frozenset({"thumbs.db", ".ds_store", "desktop.ini", "hcm-archive.json"})
JUNK_FOLDERS: Final = frozenset({"__macosx"})
CAD_FORMATS: Final = frozenset({"dwg", "dxf"})
SIDECAR_SUFFIXES: Final = frozenset({".tfw", ".tifw", ".jgw", ".pgw", ".wld", ".prj", ".xml"})
INDEX_WORDS: Final = ("cuprins", "index", "inhalt", "contents")
MIN_ATLAS_PAGES: Final = 3
_PAGE: Final = re.compile(r"^(\d{1,4})(?:[_\s-]+(.*))?$")
_SCANNER_ORDER: Final = re.compile(r"^(?:img|image|scan|dsc|dscn|pict)[_\s-]?\d{2,6}$", re.IGNORECASE)
MIN_PIECES: Final = 3
# A year is four digits on their own; one that follows `1_`, `1:` or `1-` is a scale's denominator (`1_2000`, `1-10000`), never a year.
_YEAR: Final = re.compile(r"(?<!\d)(?<!1[_:-])(1[5-9]\d\d|20\d\d)(?!\d)")
_SCALE: Final = re.compile(r"1[_:](\d{3,7})(?!\d)")


@dataclass
class Found:
    """What the detectors found so far: the series, the skips and the files still to place."""

    series: list[Series] = field(default_factory=list)
    skips: list[Skip] = field(default_factory=list)


def _name(row: FileRow) -> PurePosixPath:
    return PurePosixPath(row.path)


def is_junk(row: FileRow) -> bool:
    """A thumbnail cache, an autosave, a listing or a system file: nothing of it is a map."""
    path = _name(row)
    in_junk_folder = any(part.lower() in JUNK_FOLDERS for part in path.parts)
    return in_junk_folder or path.name.lower() in JUNK_NAMES or row.probe.format in {"ole2", "unknown", "zip"}


def is_sidecar(row: FileRow) -> bool:
    """A world file, a `.prj` or an `.aux.xml` beside a raster: read with it, never a file of its own."""
    return _name(row).suffix.lower() in SIDECAR_SUFFIXES and row.probe.format == "unknown"


def year_in(path: str) -> int | None:
    """The first year the file's or the folder's own name states (1500-2099); the folders above it say nothing of it."""
    match = _YEAR.search(PurePosixPath(path).name)
    return int(match.group(1)) if match else None


def scale_in(path: str) -> int | None:
    """A scale the file's or the folder's own name states (`1_500`, `1:2000`)."""
    match = _SCALE.search(PurePosixPath(path).name)
    return int(match.group(1)) if match else None


def title_of(path: str) -> str:
    """A title from a folder or file name (without its extension): its words, its separators made spaces."""
    name = PurePosixPath(path)
    words = re.sub(r"[_\s]+", " ", name.stem if name.suffix else name.name).strip()
    return words[:200] or "?"


# --- the detectors ------------------------------------------------------------------------------------------------


def _dropped(row: FileRow) -> bool:
    return is_junk(row) or is_sidecar(row)


def drop_junk(rows: Sequence[FileRow], found: Found) -> list[FileRow]:
    """Junk, and the sidecars read with their rasters (`FileRow.sidecars`): no map of their own."""
    found.skips.extend(Skip(row.path, "not-a-map") for row in rows if _dropped(row))
    return [row for row in rows if not _dropped(row)]


def drop_duplicates(rows: Sequence[FileRow], found: Found) -> list[FileRow]:
    """One file per SHA-256: the shortest path (then the first in order) is kept."""
    by_hash: dict[str, list[FileRow]] = defaultdict(list)
    for row in rows:
        by_hash[row.sha256].append(row)
    kept = []
    for same in by_hash.values():
        first, *others = sorted(same, key=lambda row: (len(row.path), row.path))
        kept.append(first)
        found.skips.extend(Skip(other.path, "duplicate-of", first.path) for other in others)
    return sorted(kept, key=lambda row: row.path)


def drop_cad(rows: Sequence[FileRow], found: Found) -> list[FileRow]:
    found.skips.extend(Skip(row.path, "needs-cad-export") for row in rows if row.probe.format in CAD_FORMATS)
    return [row for row in rows if row.probe.format not in CAD_FORMATS]


def _georeferenced(row: FileRow) -> bool:
    return row.probe.crs or row.probe.gcps > 0 or bool(row.sidecars)


def take_georeferenced(rows: Sequence[FileRow], found: Found) -> list[FileRow]:
    """Class a: a CRS, ground control points, or a world file beside it; one series per file."""
    for row in filter(_georeferenced, rows):
        found.series.append(Series(f"geo:{row.path}", "georeferenced", title_of(row.path), (row,), year=year_in(row.path)))
    return [row for row in rows if not _georeferenced(row)]


_ROW_FOLDER: Final = re.compile(r"^(?:\d{1,2}'*(?:-\d{1,2}'*)?|seria\s*\d{1,2}'*)$", re.IGNORECASE)


def group_folder(path: str) -> str:
    """The folder that holds a sheet series: the sheet's own, or its parent when the sheet's folder is one row (`9`, `9-10`, `Seria 11`)."""
    parent = PurePosixPath(path).parent
    return str(parent.parent if _ROW_FOLDER.match(parent.name) else parent)


def _family_key(path: str, cell: grammar.Cell) -> tuple[str, str, int | None]:
    """The sheets of one series: one grammar in one folder, one edition."""
    return cell.grammar, group_folder(path), cell.edition


def _families(rows: Iterable[FileRow]) -> dict[tuple[str, str, int | None], list[tuple[FileRow, grammar.Cell]]]:
    families: dict[tuple[str, str, int | None], list[tuple[FileRow, grammar.Cell]]] = defaultdict(list)
    for row in rows:
        cell = grammar.parse(row.path)
        if cell is not None and row.probe.format in RASTERS:
            families[_family_key(row.path, cell)].append((row, cell))
    return families


def _folder_rasters(rows: Sequence[FileRow], folders: set[str]) -> list[FileRow]:
    return [row for row in rows if str(_name(row).parent) in folders and row.probe.format in RASTERS]


def _accepted(members: Sequence[tuple[FileRow, grammar.Cell]], odd: Sequence[tuple[FileRow, grammar.Cell]]) -> bool:
    """§2.3: the sheets a grammar read against them and the names it could not read in their folders (an edition's are its own)."""
    sizes = [(row.probe.width, row.probe.height) for row, _ in members]
    return grammar.accepts(len(members), len(members) + len(odd), [cell for _, cell in members], sizes)


def cell_label(cell: grammar.Cell) -> str:
    """`row,col,quarter`, and `?` for a name the report asks about."""
    return f"{cell.row},{cell.col},{cell.quarter}{'?' if cell.odd else ''}"


def _grid_series(key: tuple[str, str, int | None], members: Sequence[tuple[FileRow, grammar.Cell]]) -> Series:
    files = tuple(row for row, _ in members)
    folder, edition = key[1], key[2]
    cells = {row.path: cell_label(cell) for row, cell in members}
    if edition is None:
        return Series(
            f"grid:{key[0]}:{folder}", "grid", title_of(folder), files, year_in(folder), scale=scale_in(folder), grid=key[0], cells=cells
        )
    title = f"{title_of(folder)} ({edition})"
    return Series(
        f"grid:{key[0]}:{folder}:{edition}",
        "grid",
        title,
        files,
        edition,
        edition=str(edition),
        scale=scale_in(folder),
        grid=key[0],
        cells=cells,
    )


def _unread(rows: Sequence[FileRow], members: Sequence[tuple[FileRow, grammar.Cell]]) -> list[FileRow]:
    """The rasters of the members' folders that no grammar reads."""
    folders = {str(_name(row).parent) for row, _ in members}
    return [row for row in _folder_rasters(rows, folders) if grammar.parse(row.path) is None]


def _odd_names(
    rows: Sequence[FileRow], key: tuple[str, str, int | None], members: Sequence[tuple[FileRow, grammar.Cell]]
) -> list[tuple[FileRow, grammar.Cell]]:
    """The base edition's folders' rasters no grammar reads: the report's table of odd names ("we read these as ...")."""
    if key[2] is not None:
        return []
    return [(row, grammar.Cell(key[0], 0, 0, odd=True)) for row in _unread(rows, members)]


def _family_order(item: tuple[tuple[str, str, int | None], object]) -> tuple[str, str, int]:
    grammar_name, folder, edition = item[0]
    return grammar_name, folder, edition or 0


def _take_family(
    rows: Sequence[FileRow], key: tuple[str, str, int | None], members: Sequence[tuple[FileRow, grammar.Cell]], found: Found, based: bool
) -> set[str]:
    """The family's series, when its grammar is accepted (or it is an edition of an accepted base series); the paths it took."""
    odd = _odd_names(rows, key, members)
    if not (based or _accepted(members, odd)):
        return set()
    whole = [*members, *odd]
    found.series.append(_grid_series(key, whole))
    return {row.path for row, _ in whole}


def _left(rows: Sequence[FileRow], taken: set[str]) -> list[FileRow]:
    return [row for row in rows if row.path not in taken]


def take_grids(rows: Sequence[FileRow], found: Found) -> list[FileRow]:
    """Class b: a family of sheets a grammar reads; its base edition takes the odd names of its folders too. An edition of an accepted
    base series is a series of its own however few its sheets (§1.4: a partial layer of its year, which the owner may drop)."""
    taken: set[str] = set()
    bases: set[tuple[str, str]] = set()
    for key, members in sorted(_families(rows).items(), key=_family_order):
        took = _take_family(rows, key, members, found, (key[0], key[1]) in bases)
        bases |= {(key[0], key[1])} if took and key[2] is None else set()
        taken |= took
    return _left(rows, taken)


def _page(row: FileRow) -> tuple[int, str] | None:
    match = _PAGE.match(_name(row).stem)
    return None if match is None else (int(match.group(1)), (match.group(2) or "").strip())


def _paged(row: FileRow) -> bool:
    return row.probe.format in RASTERS and _page(row) is not None


def _plain_pages(pages: Sequence[FileRow]) -> int:
    """How many pages carry a plain number and no title."""
    return sum(_numbered(row)[1] == "" for row in pages)


def _atlas_folders(rows: Sequence[FileRow]) -> dict[str, list[FileRow]]:
    """Folders of numbered pages: at least three plain page numbers (`12.jpg`), with the titled pages beside them (`1_Autor.jpg`)."""
    folders: dict[str, list[FileRow]] = defaultdict(list)
    for row in filter(_paged, rows):
        folders[str(_name(row).parent)].append(row)
    return {folder: pages for folder, pages in folders.items() if _plain_pages(pages) >= MIN_ATLAS_PAGES}


def _page_skip(row: FileRow, words: str) -> Skip | None:
    """A titled page: an index (kept for the layout only), or a page that is no map (`1_Autor`, `99_Scara`)."""
    if not words:
        return None
    return Skip(row.path, "index-only" if words.lower().startswith(INDEX_WORDS) else "not-a-map-page")


def _numbered(row: FileRow) -> tuple[int, str]:
    return _page(row) or (0, "")


def _page_skips(pages: Sequence[FileRow]) -> list[Skip]:
    found = (_page_skip(row, _numbered(row)[1]) for row in pages)
    return [skip for skip in found if skip is not None]


def _atlas(folder: str, pages: Sequence[FileRow], found: Found) -> None:
    """One atlas of `pages`, its titled pages skipped."""
    skips = _page_skips(pages)
    maps = tuple(_left(pages, {skip.path for skip in skips}))
    cells = {row.path: str(_numbered(row)[0]) for row in maps}
    found.series.append(Series(f"atlas:{folder}", "atlas", title_of(folder), maps, year_in(folder), cells=cells, scale=scale_in(folder)))
    found.skips.extend(skips)


def take_atlases(rows: Sequence[FileRow], found: Found) -> list[FileRow]:
    """Atlas: numbered pages in one folder; its titled pages skipped with their reason."""
    taken: set[str] = set()
    for folder, pages in sorted(_atlas_folders(rows).items()):
        _atlas(folder, pages, found)
        taken.update(row.path for row in pages)
    return _left(rows, taken)


def _scanner_named(row: FileRow) -> bool:
    return row.probe.format in RASTERS and _SCANNER_ORDER.match(_name(row).stem) is not None


def _piece_folders(rows: Sequence[FileRow]) -> dict[str, list[FileRow]]:
    """Folders holding at least `MIN_PIECES` scans named in a scanner's order."""
    folders: dict[str, list[FileRow]] = defaultdict(list)
    for row in filter(_scanner_named, rows):
        folders[str(_name(row).parent)].append(row)
    return {folder: pieces for folder, pieces in folders.items() if len(pieces) >= MIN_PIECES}


def pieces_group(folder: str, pieces: set[str], rows: Sequence[FileRow]) -> str:
    """A pieces folder's series: its parent when every folder of rasters under that parent is a pieces folder, else itself."""
    parent = str(PurePosixPath(folder).parent)
    siblings = _raster_folders_under(parent, rows)
    return parent if len(siblings) > 1 and siblings <= pieces else folder


def _raster_folders_under(parent: str, rows: Sequence[FileRow]) -> set[str]:
    """The folders right under `parent` that hold a raster."""
    folders = {_name(row).parent for row in rows if row.probe.format in RASTERS}
    return {str(folder) for folder in folders if str(folder.parent) == parent}


def take_pieces(rows: Sequence[FileRow], found: Found) -> list[FileRow]:
    """Pieces: scans of one sheet in a scanner's order, made one map by the placer."""
    folders = _piece_folders(rows)
    groups: dict[str, list[FileRow]] = defaultdict(list)
    for folder, members in sorted(folders.items()):
        groups[pieces_group(folder, set(folders), rows)].extend(members)
    for group, members in groups.items():
        found.series.append(Series(f"pieces:{group}", "pieces", title_of(group), tuple(members), year_in(group), scale=scale_in(group)))
    return _left(rows, {row.path for members in groups.values() for row in members})


def _small(row: FileRow) -> bool:
    return row.probe.raster and max(row.probe.width, row.probe.height) < MIN_LONG_SIDE_PX


def _readable(row: FileRow) -> bool:
    return row.probe.raster or (row.probe.format == "pdf" and row.probe.pages > 0)


def single_of(row: FileRow) -> Series:
    """One map: a PDF of many pages is an atlas; a raster too small to calibrate is proposed to be skipped."""
    cls = "atlas" if row.probe.pages > 1 else "single"
    reason = "too-small" if _small(row) else None
    return Series(f"{cls}:{row.path}", cls, title_of(row.path), (row,), year_in(row.path), reason=reason, scale=scale_in(row.path))


def _unreadable(row: FileRow) -> Skip:
    return Skip(row.path, "unreadable" if row.probe.error else "not-a-map")


def take_singles(rows: Sequence[FileRow], found: Found) -> list[FileRow]:
    """Class c: every raster or PDF left is one map; anything else is no map (or could not be read)."""
    found.series.extend(map(single_of, filter(_readable, rows)))
    found.skips.extend(_unreadable(row) for row in rows if not _readable(row))
    return []


DETECTORS: Final[tuple[Callable[[Sequence[FileRow], Found], list[FileRow]], ...]] = (
    drop_junk,
    drop_duplicates,
    drop_cad,
    take_georeferenced,
    take_grids,
    take_atlases,
    take_pieces,
    take_singles,
)


def classify(rows: Sequence[FileRow]) -> Found:
    """The series and the skips of `rows`: every file lands in exactly one."""
    found, left = Found(), list(rows)
    for detector in DETECTORS:
        left = detector(left, found)
    return found
