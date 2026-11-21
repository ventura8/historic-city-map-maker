"""The documents the pipeline reads and writes, in the shapes of `@hcm/shared` (docs/research/M3-interfaces.md §2).

Reads: the job (`jobDocSchema`), its layer version (`layerVersionDocSchema`), the USGS scene and the city. Writes:
the job's lease, steps and status, the version's scan, reference, georeference and output, and log lines. Every
record built here serializes to exactly the golden documents of `pipeline/tests/contracts/` (timestamps as
`{seconds, nanoseconds}`), which the TypeScript schemas validate, so a reader on either side accepts what the other
wrote (this closes CR-M2-7). Timestamps stay `Timestamp` values until a store adapter turns them into its own type.
"""

import math
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Final

from hcm_pipeline.contract import GEOREF_TRANSFORMS, JOB_STEP_STATES, JOIN_MAX_PARTS, PIPELINE_WRITER, SENSOR_SPECS, USGS_DATASETS
from hcm_pipeline.geo import Bounds, numbers_of

ID: Final = re.compile(r"[A-Za-z0-9_-]{1,40}")
NS_PER_SECOND: Final = 1_000_000_000
METRE_DIGITS: Final = 2
JOIN_MIN_PARTS: Final = 2
Record = dict[str, object]


class DocumentError(ValueError):
    """A document the pipeline reads does not have the shape it needs (the job then fails as an invalid request)."""


@dataclass(frozen=True, order=True)
class Timestamp:
    """A Firestore timestamp as both SDKs expose it."""

    seconds: int
    nanoseconds: int = 0

    @classmethod
    def at(cls, epoch_seconds: float) -> Timestamp:
        whole = math.floor(epoch_seconds)
        return cls(whole, round((epoch_seconds - whole) * NS_PER_SECOND) % NS_PER_SECOND)

    def epoch(self) -> float:
        return self.seconds + self.nanoseconds / NS_PER_SECOND

    def plus(self, seconds: float) -> Timestamp:
        return Timestamp.at(self.epoch() + seconds)


def convert_tree(value: object, scalar: Callable[[object], object]) -> object:
    """`value` with every leaf that is not a record or a list passed through `scalar`."""
    if isinstance(value, Mapping):
        return {str(key): convert_tree(item, scalar) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [convert_tree(item, scalar) for item in value]
    return scalar(value)


def _timestamp_record(value: object) -> object:
    return {"seconds": value.seconds, "nanoseconds": value.nanoseconds} if isinstance(value, Timestamp) else value


def contract_json(value: object) -> object:
    """A document with its timestamps as `{seconds, nanoseconds}`: how the golden files spell it."""
    return convert_tree(value, _timestamp_record)


def stamp(now: Timestamp) -> Record:
    """The audit stamp of every pipeline write."""
    return {"updatedBy": PIPELINE_WRITER, "updatedAt": now}


# --- reading -------------------------------------------------------------------------------------


def record_of(value: object, name: str) -> Record:
    if not isinstance(value, dict):
        raise DocumentError(f"{name} must be a record")
    return value


def text_of(record: Mapping[str, object], key: str) -> str:
    value = record.get(key)
    if not isinstance(value, str) or not value:
        raise DocumentError(f"{key} must be a non-empty text")
    return value


def optional_text(record: Mapping[str, object], key: str) -> str | None:
    return text_of(record, key) if key in record else None


def id_of(record: Mapping[str, object], key: str) -> str:
    value = text_of(record, key)
    if not ID.fullmatch(value):
        raise DocumentError(f"{key} must be an id")
    return value


def member_of(record: Mapping[str, object], key: str, allowed: tuple[str, ...] | frozenset[str]) -> str:
    value = text_of(record, key)
    if value not in allowed:
        raise DocumentError(f"{key} must be one of {', '.join(sorted(allowed))}")
    return value


def number_of(record: Mapping[str, object], key: str) -> float:
    try:
        return numbers_of(record, (key,))[0]
    except ValueError as error:
        raise DocumentError(str(error)) from error


def timestamp_of(value: object) -> Timestamp | None:
    return value if isinstance(value, Timestamp) else None


@dataclass(frozen=True)
class StepRecord:
    """`steps.<name>` of a job: its status, its recorded output and when it ran."""

    status: str
    gcs_path: str | None = None
    generation: str | None = None
    sha256: str | None = None
    bytes: int | None = None
    started_at: Timestamp | None = None
    finished_at: Timestamp | None = None

    @classmethod
    def of(cls, value: object) -> StepRecord:
        record = record_of(value, "a step")
        size = record.get("bytes")
        return cls(
            status=member_of(record, "status", JOB_STEP_STATES),
            gcs_path=optional_text(record, "gcsPath"),
            generation=optional_text(record, "generation"),
            sha256=optional_text(record, "sha256"),
            bytes=size if isinstance(size, int) else None,
            started_at=timestamp_of(record.get("startedAt")),
            finished_at=timestamp_of(record.get("finishedAt")),
        )

    def as_record(self) -> Record:
        values = {
            "status": self.status,
            "gcsPath": self.gcs_path,
            "generation": self.generation,
            "sha256": self.sha256,
            "bytes": self.bytes,
            "startedAt": self.started_at,
            "finishedAt": self.finished_at,
        }
        return {key: value for key, value in values.items() if value is not None}


@dataclass(frozen=True)
class Lease:
    owner: str
    until: Timestamp

    @classmethod
    def of(cls, value: object) -> Lease | None:
        record = value if isinstance(value, dict) else {}
        owner, until = record.get("owner"), timestamp_of(record.get("until"))
        return cls(owner, until) if isinstance(owner, str) and until is not None else None

    def as_record(self) -> Record:
        return {"owner": self.owner, "until": self.until}


def optional_record(value: object) -> Record:
    return value if isinstance(value, dict) else {}


def optional_str(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _steps_of(value: object) -> dict[str, StepRecord]:
    return {str(name): StepRecord.of(step) for name, step in optional_record(value).items()}


@dataclass(frozen=True)
class Job:
    """The parts of `cities/{city}/jobs/{job}` the pipeline reads."""

    id: str
    type: str
    status: str
    params: Record
    layer_id: str | None
    version_id: str | None
    steps: dict[str, StepRecord] = field(default_factory=dict)
    lease: Lease | None = None
    cancel_requested: bool = False
    # Pause (the owner's request of 2026-11-13): the owner paused the job; the run stops at its next step boundary.
    paused: bool = False
    attempt: int = 0
    # The Cloud Run job this run was dispatched to (`fetch`, `std`, `xl`), None for a job no dispatcher sized.
    machine: str | None = None

    @classmethod
    def of(cls, job_id: str, record: Mapping[str, object]) -> Job:
        attempt = record.get("attempt")
        return cls(
            id=job_id,
            type=text_of(record, "type"),
            status=text_of(record, "status"),
            params=optional_record(record.get("params")),
            layer_id=optional_str(record.get("layerId")),
            version_id=optional_str(record.get("versionId")),
            steps=_steps_of(record.get("steps")),
            lease=Lease.of(record.get("lease")),
            cancel_requested=record.get("cancelRequested") is True,
            paused=isinstance(record.get("paused"), dict),
            attempt=attempt if isinstance(attempt, int) else 0,
            machine=optional_str(record.get("machine")),
        )

    def step(self, name: str) -> StepRecord:
        return self.steps.get(name, StepRecord("pending"))


# --- job parameters (the `JOB_PARAMS_SCHEMAS` twins) --------------------------------------------------------


def _strict(params: Mapping[str, object], allowed: frozenset[str]) -> None:
    unknown = sorted(set(params) - allowed)
    if unknown:
        raise DocumentError(f"params has unknown keys: {', '.join(unknown)}")


@dataclass(frozen=True)
class UsgsImportParams:
    entity_id: str
    dataset: str
    sensor: str

    @classmethod
    def of(cls, params: Mapping[str, object]) -> UsgsImportParams:
        _strict(params, frozenset({"entityId", "dataset", "sensor"}))
        return cls(id_of(params, "entityId"), member_of(params, "dataset", USGS_DATASETS), member_of(params, "sensor", tuple(SENSOR_SPECS)))


@dataclass(frozen=True)
class GeotiffImportParams:
    upload_path: str
    original_name: str | None
    replaces: bool

    @classmethod
    def of(cls, params: Mapping[str, object]) -> GeotiffImportParams:
        _strict(params, frozenset({"uploadPath", "originalName", "replaces"}))
        replaces = params.get("replaces")
        if not isinstance(replaces, bool):
            raise DocumentError("replaces must be true or false")
        return cls(_bounded_text(params, "uploadPath", 500), _optional_bounded(params, "originalName", 255), replaces)


@dataclass(frozen=True)
class RegeorefParams:
    based_on: str

    @classmethod
    def of(cls, params: Mapping[str, object]) -> RegeorefParams:
        _strict(params, frozenset({"basedOn"}))
        return cls(id_of(params, "basedOn"))


@dataclass(frozen=True)
class JoinPart:
    """A frame of a `layer-join`: its files live under its own layer and version."""

    version_id: str
    layer_id: str

    @classmethod
    def of(cls, value: object) -> JoinPart:
        record = record_of(value, "a part")
        _strict(record, frozenset({"versionId", "layerId"}))
        return cls(id_of(record, "versionId"), id_of(record, "layerId"))


def _archive_zoom(value: object) -> int:
    """An archive maps' join's `maxzoom`, within `ARCHIVE_JOIN_ZOOMS`."""
    if isinstance(value, bool) or not isinstance(value, int) or not ARCHIVE_JOIN_ZOOMS[0] <= value <= ARCHIVE_JOIN_ZOOMS[1]:
        raise DocumentError("a join needs its sensor, or an archive join its maxzoom (10 to 22)")
    return value


# The `maxzoom` an archive maps' join may ask (`layerJoinParamsSchema` of @hcm/shared).
ARCHIVE_JOIN_ZOOMS: Final = (10, 22)


@dataclass(frozen=True)
class JoinParams:
    """A join's parts and their camera; an archive maps' join (finding of 2026-11-14) has no camera, only its `maxzoom`, and each
    of its parts keeps its own fit (`keeps_fits`)."""

    parts: tuple[JoinPart, ...]
    sensor: str | None
    archive_maxzoom: int | None = None

    @property
    def maxzoom(self) -> int:
        return SENSOR_SPECS[self.sensor].maxzoom if self.sensor is not None else int(self.archive_maxzoom or 0)

    @property
    def keeps_fits(self) -> bool:
        return self.sensor is None

    @classmethod
    def of(cls, params: Mapping[str, object]) -> JoinParams:
        _strict(params, frozenset({"parts", "sensor", "maxzoom"}))
        parts = params.get("parts")
        if not isinstance(parts, list) or not JOIN_MIN_PARTS <= len(parts) <= JOIN_MAX_PARTS:
            raise DocumentError(f"parts must be a list of {JOIN_MIN_PARTS} to {JOIN_MAX_PARTS} frames")
        joined = tuple(JoinPart.of(part) for part in parts)
        if "sensor" in params:
            return cls(joined, member_of(params, "sensor", tuple(SENSOR_SPECS)))
        return cls(joined, None, _archive_zoom(params.get("maxzoom")))


def _bounded_text(record: Mapping[str, object], key: str, limit: int) -> str:
    value = text_of(record, key)
    if len(value) > limit:
        raise DocumentError(f"{key} is longer than {limit} characters")
    return value


def _optional_bounded(record: Mapping[str, object], key: str, limit: int) -> str | None:
    return _bounded_text(record, key, limit) if key in record else None


@dataclass(frozen=True)
class LayerTilesParams:
    """A `layer-tiles` job: the version it makes tiles for (M12)."""

    version_id: str

    @classmethod
    def of(cls, params: Mapping[str, object]) -> LayerTilesParams:
        _strict(params, frozenset({"versionId"}))
        return cls(id_of(params, "versionId"))


_ARCHIVE_SERIES_KEYS: Final = frozenset(
    {
        "archiveId",
        "seriesId",
        "class",
        "sheets",
        "encoding",
        "order",
        "gridId",
        "referenceLayerIds",
        "edition",
        "scaleDenominator",
        "paperTransparent",
        "maxzoom",
        # Locate again for overview-hole restitching (`placing/restitch.py`, DECISIONS §216e); only this job type.
        "restitch",
        # Fix the tiles: the series laid out again for its owner's check (`steps/place.py`, M20 §19.13); only this job type.
        "relayout",
    }
)


@dataclass(frozen=True)
class ArchiveSeriesParams:
    """An `archive-series` job (M20): the archive and series it places; its steps read the rest of the params themselves."""

    archive_id: str
    series_id: str

    @classmethod
    def of(cls, params: Mapping[str, object]) -> ArchiveSeriesParams:
        _strict(params, _ARCHIVE_SERIES_KEYS)
        return cls(id_of(params, "archiveId"), id_of(params, "seriesId"))


JobParams = UsgsImportParams | GeotiffImportParams | RegeorefParams | JoinParams | LayerTilesParams | ArchiveSeriesParams
_PARAMS: Final[Mapping[str, Callable[[Mapping[str, object]], JobParams]]] = {
    "usgs-import": UsgsImportParams.of,
    "geotiff-import": GeotiffImportParams.of,
    "regeoref": RegeorefParams.of,
    "layer-join": JoinParams.of,
    "layer-tiles": LayerTilesParams.of,
    "archive-series": ArchiveSeriesParams.of,
}


# The job types this pipeline runs: the local worker claims only these (an older image leaves a newer type queued).
RUN_JOB_TYPES: Final = tuple(sorted(_PARAMS))


class OutdatedJobError(DocumentError):
    """A job type this pipeline does not run: an older image than the job's, so an updated one can (a retry cures it)."""


def params_of(job: Job) -> JobParams:
    """The job's parameters for its type; OutdatedJobError for a type the pipeline does not run, DocumentError for malformed ones."""
    parse = _PARAMS.get(job.type)
    if parse is None:
        raise OutdatedJobError(f"the pipeline does not run {job.type} jobs")
    return parse(job.params)


def require_transform(value: str) -> str:
    if value not in GEOREF_TRANSFORMS:
        raise DocumentError(f"transform must be one of {', '.join(GEOREF_TRANSFORMS)}")
    return value


def bounds_of(value: object) -> Bounds:
    try:
        return Bounds.of(value)
    except ValueError as error:
        raise DocumentError(str(error)) from error


def metres(value: float) -> float:
    """A distance as documents keep it (centimetres)."""
    return round(value, METRE_DIGITS)
