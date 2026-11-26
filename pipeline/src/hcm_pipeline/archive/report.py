"""What the server learns of a scanned archive: `worker.archiveReport`'s request (docs/research/M20-import-local.md §2.4).

Series and counts only: at most 200 series (the rest are counted as `too-many-series`), the skipped files counted by reason, and up to 500
of their paths relative to the archive's root. No host path, file content or per-file row goes up; those stay in `archive.json`. Each
series' id is stable across rescans of the same files (`s-` and 12 hex characters of its key's SHA-256). The order is the reference ladder
(§1.7): placed layers first, then sheet grids newest first (they solve the city's grid), then every other map newest first.
"""

import hashlib
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Final

from hcm_pipeline.archive import encoding, rights
from hcm_pipeline.archive.model import ARCHIVE_ISSUES_MAX, ARCHIVE_MAX_SERIES, Rights, Series, Skip
from hcm_pipeline.archive.sidecar import Entry, Sidecar

MIN_YEAR: Final = 1500
DEFAULT_ZOOM: Final = 17
DEFAULT_SHEET_M2: Final = 4_000_000.0
# A grid sheet's scan is its paper, margins, title block and the overlap with its neighbours included: its own cell is about half of
# it (Bucharest's 1:500 sheets scan to about 296 x 420 m of ground for a 250 m cell). Measured on one city's sheets, not proved general.
GRID_CELL_SHARE: Final = 0.5
COPYRIGHT_WORDS: Final = ("copyright", "\u00a9")
_CLASS_RANK: Final = {"georeferenced": 0, "grid": 1}
_LIKELIHOOD: Final = {"georeferenced": "likely", "grid": "likely", "atlas": "possible", "pieces": "possible", "single": "possible"}


@dataclass(frozen=True)
class Context:
    """What the report reads beside the files: the city's latitude, the year now, the owner's sidecar."""

    latitude: float
    current_year: int
    sidecar: Sidecar


def series_id(key: str) -> str:
    return f"s-{hashlib.sha256(key.encode('utf-8')).hexdigest()[:12]}"


def _str(entry: Entry | None, key: str) -> str | None:
    value = entry.fields.get(key) if entry else None
    return value if isinstance(value, str) else None


def _int(entry: Entry | None, key: str) -> int | None:
    value = entry.fields.get(key) if entry else None
    return value if isinstance(value, int) else None


def declared(series: Series, entry: Entry | None) -> Series:
    """The series with what the owner's sidecar states over what detection guessed."""
    if entry is None:
        return series
    return replace(
        series,
        title=_pick(_str(entry, "title"), series.title),
        year=_pick(_int(entry, "year"), series.year),
        scale=_pick(_int(entry, "scale"), series.scale),
        reason=_pick(_str(entry, "skip"), series.reason),
        year_label=_str(entry, "yearLabel"),
        maxzoom=_int(entry, "maxzoom"),
        low=_str(entry, "priority") == "low",
    )


def _pick[T](stated: T | None, found: T) -> T:
    """What the owner stated, else what was found."""
    return found if stated is None else stated


def _copyright(entry: Entry | None) -> bool:
    """A watermark the owner transcribed that is a copyright mark."""
    mark = _str(entry, "watermark")
    return mark is not None and any(word in mark.lower() for word in COPYRIGHT_WORDS)


def _stated(entry: Entry | None, found: Rights) -> Rights:
    """The sidecar's rights over the rules': a state the owner states drops the rules' note."""
    state = _str(entry, "state")
    note = _str(entry, "note") or (found.note if state is None else None)
    licence = _pick(_str(entry, "licence"), found.licence)
    return replace(found, licence=licence, state=_pick(state, found.state), note=note, confirmed_by=_str(entry, "confirmedBy"))


def _guarded(flagged: Rights, stated: Rights) -> Rights:
    """§7: a permission nobody is named for waits for the owner; a copyright mark stays unless a permission is named."""
    if stated.licence == "permission" and stated.confirmed_by is None:
        return replace(stated, licence="unknown", state="needs-confirmation", note=rights.PERMISSION_NOTE)
    if flagged.state == "do-not-publish" and stated.licence != "permission":
        return flagged
    return stated


def rights_of(series: Series, entry: Entry | None, context: Context) -> Rights:
    """The pre-flag rules (§7), then the sidecar's own rights where it states them."""
    found = rights.preflag(series.year, _str(entry, "author"), context.current_year, copyright_mark=_copyright(entry))
    stated = replace(
        _stated(entry, found),
        year=_pick(_str(entry, "yearLabel"), found.year),
        source_label=_str(entry, "sourceLabel"),
        source_url=_str(entry, "sourceUrl"),
        watermark=_str(entry, "watermark"),
        original_label=_str(entry, "originalLabel"),
        original_url=_str(entry, "originalUrl"),
        original_probable=entry is not None and entry.fields.get("originalProbable") is True,
    )
    return _guarded(found, stated)


def _area(series: Series) -> float:
    """The ground the series covers: its sheets at their scan resolution (a grid sheet's own cell only, `GRID_CELL_SHARE`), or about
    2 km square a sheet when that is not known."""
    total = 0.0
    for row in series.files:
        gsd = encoding.ground_m_per_px(row.probe.dpi, series.scale)
        total += row.probe.width * row.probe.height * gsd**2 if gsd else DEFAULT_SHEET_M2
    return total * GRID_CELL_SHARE if series.series_class == "grid" else total


def _scan_zoom(series: Series, latitude: float) -> int:
    """The zoom of the scan's own ground resolution (its coarsest dpi at its scale), or the default when either is unknown."""
    dpis = [row.probe.dpi for row in series.files if row.probe.dpi]
    gsd = encoding.ground_m_per_px(min(dpis), series.scale) if dpis else None
    return encoding.resolution_zoom(gsd, latitude) if gsd else DEFAULT_ZOOM


def _zoom(series: Series, latitude: float) -> int:
    """The scan's own zoom, never past the owner's `maxzoom`."""
    zoom = _scan_zoom(series, latitude)
    return min(zoom, series.maxzoom or zoom)


def _skip_reason(series: Series, found_rights: Rights) -> str | None:
    """The series' own reason (too small, the sidecar's), else do-not-publish when its rights say so."""
    if series.reason is not None:
        return series.reason
    return "do-not-publish" if found_rights.state == "do-not-publish" else None


def _year(series: Series, context: Context) -> tuple[int, str | None]:
    """The series' year, and its label: an undated series shows `?` until the owner types its year (this year stands in)."""
    if series.year is None:
        return context.current_year, "?"
    return max(MIN_YEAR, series.year), series.year_label


def _estimate(series: Series, chosen: str, latitude: float) -> dict[str, object]:
    guess = encoding.estimate(_area(series), _zoom(series, latitude), chosen, len(series.files), latitude)
    return {"maxzoom": guess.maxzoom, "tilesBytes": guess.tiles_bytes, "minutes": guess.minutes, "auto": _likelihood(series)}


def record_of(series: Series, order: int, context: Context) -> dict[str, object]:
    """One row of the report (`archiveSeriesSchema`)."""
    entry = context.sidecar.entry_for(series.files[0].path)
    chosen = encoding.encoding_of([row.probe for row in series.files])
    found_rights = rights_of(series, entry, context)
    skip = _skip_reason(series, found_rights)
    year, label = _year(series, context)
    record: dict[str, object] = {
        "seriesId": series_id(series.key),
        "class": series.series_class,
        "title": series.title,
        "year": year,
        "files": len(series.files),
        "bytes": series.bytes,
        "action": "import" if skip is None else "skip",
        "encoding": chosen,
        "rights": found_rights.as_record(),
        "estimate": _estimate(series, chosen, context.latitude),
        "order": order,
    }
    optional = {"reason": skip, "yearLabel": label, "edition": series.edition, "scaleDenominator": series.scale}
    return record | {key: value for key, value in optional.items() if value is not None}


def _likelihood(series: Series) -> str:
    """The report's chip: a map of no known scale needs points; a grid or an embedded georeference likely places itself."""
    return _LIKELIHOOD.get(series.series_class, "points") if series.scale or series.series_class in _CLASS_RANK else "points"


def ladder(series: Sequence[Series]) -> list[Series]:
    """The reference ladder: placed layers, then grids, then the rest; newest first within each, undated last; the owner's low priority
    after all of them."""
    return sorted(series, key=lambda each: (each.low, _CLASS_RANK.get(each.series_class, 2), -(each.year or 0), each.title))


@dataclass(frozen=True)
class Report:
    """The report's three parts, as `worker.archiveReport` takes them."""

    series: list[dict[str, object]]
    skipped: dict[str, int]
    issues: list[dict[str, str]]
    # Every file's bytes, the skipped ones included (the archive's size the server shows).
    total_bytes: int = 0


def _overflow(series: Sequence[Series]) -> list[Skip]:
    return [Skip(row.path, "too-many-series") for each in series for row in each.files]


def report_of(series: Sequence[Series], skips: Sequence[Skip], context: Context) -> Report:
    """The series records (at most 200), the skipped counts and the sample of skipped paths, all relative to the archive."""
    ordered = ladder([declared(each, context.sidecar.entry_for(each.files[0].path)) for each in series if each.files])
    every_skip = [*skips, *_overflow(ordered[ARCHIVE_MAX_SERIES:])]
    records = [record_of(each, order, context) for order, each in enumerate(ordered[:ARCHIVE_MAX_SERIES])]
    return Report(records, dict(Counter(skip.reason for skip in every_skip)), list(map(_issue, every_skip[:ARCHIVE_ISSUES_MAX])))


def _issue(skip: Skip) -> dict[str, str]:
    issue = {"path": skip.path[:500], "reason": skip.reason}
    return issue | ({"of": skip.of[:500]} if skip.of else {})


def counts(records: Sequence[Mapping[str, object]]) -> dict[str, int]:
    """How many series the report proposes to import and to skip."""
    return dict(Counter(str(record["action"]) for record in records))
