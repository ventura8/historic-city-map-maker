"""An archive series as its placer sees it (docs/research/M20-import-local.md §4): the job's parameters and the sheets `gather` checked.

The sheets are the local `sheets.json` (path relative to the archive, cell, bytes, SHA-256), read where `gather` left it, or staged from
the job's files when this run did not gather. Each sheet's original is under the archive's own folder on this computer and is never
written: placers read it through `raster_io` and write their working files to the job's scratch folder.
"""

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Final

from hcm_pipeline.archive.intake import ArchiveStore
from hcm_pipeline.jobs import JobContext
from hcm_pipeline.placing.output import param_int
from hcm_pipeline.steps.gather import SHEETS, store_of, text_param

ENCODINGS: Final = ("lineart", "grey", "colour")


@dataclass(frozen=True)
class Sheet:
    """One part of the series: its original on this computer, its name for reports and its cell (a grid cell, an atlas page)."""

    path: Path
    name: str
    cell: str | None
    relative: str = ""


@dataclass(frozen=True)
class SeriesJob:
    """What every placer needs of the job: the sheets, the encoding, the stated scale and the reference layers."""

    sheets: tuple[Sheet, ...]
    encoding: str
    scale: int | None
    paper_transparent: bool
    reference_layers: tuple[str, ...]
    grid_id: str | None

    @property
    def nearest(self) -> bool:
        """Line art is warped with nearest, so its lines stay crisp (§6)."""
        return self.encoding == "lineart"

    @property
    def colour(self) -> bool:
        """A colour series keeps its colour in every picture it is assembled into (an overview mosaic included)."""
        return self.encoding == "colour"


def _sheets_record(ctx: JobContext) -> list[Mapping[str, object]]:
    local = ctx.local(SHEETS)
    source = local if local.is_file() else ctx.stage(ctx.work_file(SHEETS), SHEETS)
    found = json.loads(source.read_text(encoding="utf-8")).get("sheets")
    return [row for row in found if isinstance(row, dict)] if isinstance(found, list) else []


def _sheet(root: Path, row: Mapping[str, object]) -> Sheet:
    relative = str(row.get("path"))
    cell = row.get("cell")
    return Sheet(root / relative, PurePosixPath(relative).name, cell if isinstance(cell, str) else None, relative)


def _texts(value: object) -> tuple[str, ...]:
    return tuple(str(item) for item in value) if isinstance(value, list) else ()


def series_of(ctx: JobContext, store: ArchiveStore | None = None) -> SeriesJob:
    """The job's series: its sheets on this computer and its parameters."""
    params = ctx.job.params
    root = (store or store_of(ctx)).files(text_param(params, "archiveId"))
    encoding = str(params.get("encoding")) if params.get("encoding") in ENCODINGS else "grey"
    grid_id = params.get("gridId")
    return SeriesJob(
        tuple(_sheet(root, row) for row in _sheets_record(ctx)),
        encoding,
        param_int(params, "scaleDenominator"),
        params.get("paperTransparent") is True,
        _texts(params.get("referenceLayerIds")),
        grid_id if isinstance(grid_id, str) else None,
    )
