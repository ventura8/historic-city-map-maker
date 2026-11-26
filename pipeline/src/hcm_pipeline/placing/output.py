"""What a placer leaves (docs/research/M20-import-local.md §4, §5): `warped.tif` and the version's `archive` report, or a wait for a person.

A placement that holds publishes the series' `warped.tif` beside the job's files and writes `archive` (`archiveReportSchema`), the
`source`'s placed count and skip counts; `export`, `pyramid` and `register` follow as for any layer, and the approval applies §5 to it.
One that does not hold waits for a person: the version gets `help` (why, in one line, for the shared "Help calibrate" queue, the owner's
standing rule of 2026-11-09) and its best pairs as suggestions (origin `auto`, `junctions`), and the job waits for points.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from hcm_pipeline.archive import model
from hcm_pipeline.geo import to_lnglat, zoom_resolution
from hcm_pipeline.georef.autogcp import MAX_SUGGESTIONS, GcpSuggestions
from hcm_pipeline.georef.transforms import Gcp
from hcm_pipeline.jobs import Done, JobContext, Waiting
from hcm_pipeline.placing.checks import Checked
from hcm_pipeline.placing.raster_io import Pair

DEFAULT_MAXZOOM: Final = 18
ARCHIVE_MAX_ZOOM: Final = 21
JUNCTIONS: Final = "junctions"
LAYOUT_ANSWER: Final = "layoutAnswer"


def param_int(params: Mapping[str, object], name: str, default: int | None = None) -> int | None:
    value = params.get(name)
    return value if isinstance(value, int) and not isinstance(value, bool) else default


def resolution_of(params: Mapping[str, object]) -> float:
    """The series' Mercator metres per pixel: its `maxzoom`'s (18 when the job has none), never deeper than 21."""
    zoom = min(ARCHIVE_MAX_ZOOM, param_int(params, "maxzoom", DEFAULT_MAXZOOM) or DEFAULT_MAXZOOM)
    return zoom_resolution(zoom)


@dataclass(frozen=True)
class Placement:
    """A held placement's report: how, its encoding, the map's scale, the checks and the rival search."""

    method: str
    encoding: str
    checked: Checked
    rival_clean: bool
    scale: int | None = None
    paper_transparent: bool = False
    seam: float | None = None

    def as_record(self) -> dict[str, object]:
        self._require_known_method()
        record: dict[str, object] = {
            "method": self.method,
            "encoding": self.encoding,
            "paperTransparent": self.encoding == "lineart" and self.paper_transparent,
            "checkpointCount": self.checked.count,
            "checksDropped": self.checked.dropped,
            "measuredPct": min(100.0, self.checked.measured_pct),
            "rivalClean": self.rival_clean,
        }
        optional = {
            "scaleDenominator": self.scale,
            "checkpointRmseM": self._rmse(),
            "residuals": self._residuals(),
            "seamScore": self._seam_score(),
        }
        return record | {key: value for key, value in optional.items() if value is not None}

    def _require_known_method(self) -> None:
        """A method the server's `ARCHIVE_PLACE_METHODS` does not list fails here, before the write it would refuse."""
        if self.method not in model.ARCHIVE_PLACE_METHODS:
            raise ValueError(f"unknown place method {self.method!r}")

    def _seam_score(self) -> float | None:
        return None if self.seam is None else round(max(-1.0, min(1.0, self.seam)), 3)

    def _rmse(self) -> float | None:
        return None if self.checked.rmse_m is None else round(self.checked.rmse_m, 2)

    def _residuals(self) -> dict[str, object] | None:
        return None if self.checked.residuals is None else self.checked.residuals.as_record()


def finish(ctx: JobContext, placement: Placement, warped: Path, placed: int) -> Done:
    """The series' `warped.tif` published beside the job's files and its report and placed count written on the version."""
    ctx.update_version({"archive": placement.as_record(), "source.placedCount": placed})
    ctx.log.info(f"placed by {placement.method}: {placed} parts, {placement.checked.count} checks", ctx.step)
    return Done(ctx.publish(warped, ctx.work_file("warped.tif"), "image/tiff"))


def wait_for_help(
    ctx: JobContext,
    reason: str,
    note: str,
    fields: Mapping[str, object] | None = None,
    stitched: Mapping[str, object] | None = None,
) -> Waiting:
    """The version waits for a person with why (`help`) and, for a series joined into one picture, that picture (`stitched`,
    M22 §4.1); the job waits for points. The owner's tile layout (`help.layoutAnswer`, M20 §19.8) is carried into the new `help` in
    the same write, so neither a crash between two writes nor a later wait drops it."""
    help_item: dict[str, object] = {"reason": reason, "note": note[:200], "at": ctx.now()}
    if stitched is not None:
        help_item["stitched"] = dict(stitched)
    answer = _layout_answer(ctx)
    if answer is not None:
        help_item[LAYOUT_ANSWER] = answer
    ctx.update_version({"state": "needs_gcps", "help": help_item, **(fields or {})})
    ctx.log.info(f"waits for a person ({reason}): {note[:200]}", ctx.step)
    return Waiting("awaiting_gcps", "gcps", note)


def _layout_answer(ctx: JobContext) -> dict[str, object] | None:
    """The version's `help.layoutAnswer` as it is, or None."""
    help_item = (ctx.services.store.get(ctx.version_path()) or {}).get("help")
    found = help_item.get(LAYOUT_ANSWER) if isinstance(help_item, Mapping) else None
    return dict(found) if isinstance(found, Mapping) else None


def _gcp(index: int, pair: Pair, score: float) -> Gcp:
    lng, lat = to_lnglat(pair.mx, pair.my)
    return Gcp(f"j{index:03d}", pair.px, pair.py, lat, lng, True, "auto", max(0.0, min(1.0, score)))


def suggestions(ctx: JobContext, pairs: Sequence[Pair], scores: Sequence[float], tried: int) -> dict[str, object]:
    """The best pairs (at most 100) as the version's suggestions, for the georeferencer to open with."""
    ranked = sorted(zip(pairs, scores, strict=True), key=lambda item: -item[1])[:MAX_SUGGESTIONS]
    gcps = tuple(_gcp(index, pair, score) for index, (pair, score) in enumerate(ranked))
    record = GcpSuggestions(JUNCTIONS, ("osm",), ctx.now(), (len(gcps), max(tried, len(gcps))), gcps, 0.0).as_record()
    return {"suggestions": record}
