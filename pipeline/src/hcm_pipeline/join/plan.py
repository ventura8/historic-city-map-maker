"""The frames of a join and what `align` hands `merge` (docs/research/M8-join-interfaces.md §3).

Each part's raw record is read here, because `GeorefInfo.of` drops the checkpoint values. `join-plan.json` keeps the seams'
figures and each used part's nodes, so a retry never measures again; `join-owner.tif` beside it holds who owns each cell.
"""

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from hcm_pipeline.contract import Errors
from hcm_pipeline.documents import GeorefInfo, JoinSeam, ScanInfo, Version
from hcm_pipeline.geo import MercatorBox
from hcm_pipeline.jobs import JobContext, StepFailedError
from hcm_pipeline.join.correction import Node
from hcm_pipeline.model import DocumentError, JoinParams, Record, optional_record, record_of

PLAN_FILE: Final = "join-plan.json"
OWNER_FILE: Final = "join-owner.tif"
COORDINATE_DIGITS: Final = 4
FRAME_PARAM: Final = "frame"


@dataclass(frozen=True)
class Part:
    """A frame of the join: its scan, its georeference and the figures its own checkpoints gave."""

    version: Version
    scan: ScanInfo
    georef: GeorefInfo
    entity_id: str
    checkpoint_rmse_m: float | None
    checkpoint_count: int


def _number(record: Mapping[str, object], key: str) -> float | None:
    value = record.get(key)
    return float(value) if isinstance(value, int | float) else None


def _missing(frame: str, why: str) -> StepFailedError:
    return StepFailedError(Errors.JOIN_PART_MISSING, f"the frame {frame} {why}", {FRAME_PARAM: frame})


def _scan_with_points(version: Version, entity_id: str) -> tuple[ScanInfo, GeorefInfo]:
    """A frame that has no scan, or none of its own points (an upload's embedded georeference), cannot take part."""
    if version.scan is None or version.georef is None or version.georef.method == "embedded":
        raise _missing(entity_id, "has no scan with points")
    return version.scan, version.georef


def part_of(version_id: str, record: Mapping[str, object] | None) -> Part:
    """A part from its document."""
    if record is None:
        raise _missing(version_id, "has no document")
    version = Version.of(version_id, record)
    entity_id = str(version.source.get("entityId") or version_id)
    scan, georef = _scan_with_points(version, entity_id)
    raw = optional_record(record.get("georef"))
    return Part(version, scan, georef, entity_id, _number(raw, "checkpointRmseM"), int(_number(raw, "checkpointCount") or 0))


def read_parts(ctx: JobContext) -> list[Part]:
    """The job's parts, in the order of its parameters."""
    params = JoinParams.of(ctx.job.params)
    return [part_of(part.version_id, ctx.read(ctx.version_path(part.version_id))) for part in params.parts]


@dataclass(frozen=True)
class PlannedSeam:
    """A seam's report with the positions of its parts among the used ones."""

    a: int
    b: int
    report: JoinSeam

    def as_record(self) -> Record:
        return {"between": [self.a, self.b], "report": self.report.as_record()}

    @classmethod
    def of(cls, record: Mapping[str, object]) -> PlannedSeam:
        a, b = record_list(record, "between")
        return cls(int(a), int(b), _report_of(record_of(record.get("report"), "report")))


def record_list(record: Mapping[str, object], key: str) -> list[Any]:
    """A list the plan wrote itself."""
    value = record.get(key)
    if not isinstance(value, list):
        raise DocumentError(f"{key} must be a list")
    return value


def _report_of(record: Mapping[str, object]) -> JoinSeam:
    return JoinSeam(
        a=str(record["a"]),
        b=str(record["b"]),
        measured=record["measured"] is True,
        applied=record["applied"] is True,
        samples=int(str(record["samples"])),
        held_out=int(str(record["heldOut"])),
        max_shift_m=float(str(record["maxShiftM"])),
        before_rmse_m=_number(record, "beforeRmseM"),
        after_rmse_m=_number(record, "afterRmseM"),
    )


@dataclass(frozen=True)
class PlannedPart:
    """A used part: its nodes (none: it keeps its own transform)."""

    version_id: str
    nodes: tuple[Node, ...]

    def as_record(self) -> Record:
        return {"versionId": self.version_id, "nodes": [[round(value, COORDINATE_DIGITS) for value in node] for node in self.nodes]}

    @classmethod
    def of(cls, record: Mapping[str, object]) -> PlannedPart:
        return cls(str(record["versionId"]), tuple((node[0], node[1], node[2], node[3]) for node in record_list(record, "nodes")))


@dataclass(frozen=True)
class JoinPlan:
    """What `align` decided."""

    box: MercatorBox
    parts: tuple[PlannedPart, ...]
    seams: tuple[PlannedSeam, ...]
    omitted: tuple[str, ...]
    max_shift_m: float

    def write(self, target: Path) -> Path:
        record = {
            "box": [self.box.left, self.box.bottom, self.box.right, self.box.top],
            "parts": [part.as_record() for part in self.parts],
            "seams": [seam.as_record() for seam in self.seams],
            "omitted": list(self.omitted),
            "maxShiftM": self.max_shift_m,
        }
        target.write_text(json.dumps(record), encoding="utf-8")
        return target

    @classmethod
    def read(cls, source: Path) -> JoinPlan:
        record = json.loads(source.read_text(encoding="utf-8"))
        return cls(
            MercatorBox(*record["box"]),
            tuple(PlannedPart.of(part) for part in record["parts"]),
            tuple(PlannedSeam.of(seam) for seam in record["seams"]),
            tuple(record["omitted"]),
            float(record["maxShiftM"]),
        )


def used_parts(parts: Sequence[Part], plan: JoinPlan) -> list[Part]:
    """The parts the plan uses, in its order."""
    by_version = {part.version.id: part for part in parts}
    return [by_version[planned.version_id] for planned in plan.parts]
