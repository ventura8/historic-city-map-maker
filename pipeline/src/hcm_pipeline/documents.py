"""Layer versions, USGS scenes, cities and log lines as the pipeline reads and writes them (`@hcm/shared`).

`cities/{city}/layerVersions/{version}` (`layerVersionDocSchema`): the pipeline fills its `scan`, `reference`,
`georef` and `output` and moves its `state` (docs/research/M3-interfaces.md §2.2); the builders below produce the
records of `pipeline/tests/contracts/version.*.json`. The scene (`usgsSceneDocSchema`) gives the frame's corners;
the city (`cityDocSchema`) its bounds.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Final

import numpy

from hcm_pipeline.calibrate.terrain import Heights
from hcm_pipeline.contract import GCP_ORIGINS, LAYER_VERSION_STATES, MAX_JOB_LOGS
from hcm_pipeline.geo import Bounds, FloatArray, near_lng, to_mercator_arrays
from hcm_pipeline.georef.heights import heights_of_record, heights_record
from hcm_pipeline.georef.lattice import LATTICE_MODELS, Lattice, LatticeNode
from hcm_pipeline.georef.rpc import Rpc
from hcm_pipeline.georef.transforms import Gcp
from hcm_pipeline.model import (
    DocumentError,
    Record,
    Timestamp,
    bounds_of,
    id_of,
    member_of,
    metres,
    number_of,
    optional_record,
    optional_str,
    optional_text,
    record_of,
    require_transform,
    stamp,
    text_of,
)

GEOREF_METHODS: Final = ("corners", "gcps", "auto", "embedded")
# Held equal to `@hcm/shared` by `enums.json` (M20 added `archive`, which this copy missed: docs/LESSONS.md 527).
VERSION_ORIGINS: Final = ("usgs", "upload", "regeoref", "crop", "join", "archive")
LOG_LEVELS: Final = ("info", "warn", "error")
LOG_MESSAGE_MAX: Final = 2000
LatLng = tuple[float, float]


def _without_none(values: Mapping[str, object]) -> Record:
    return {key: value for key, value in values.items() if value is not None}


@dataclass(frozen=True)
class ScanInfo:
    """`version.scan`: the cropped scan the georeferencer shows, and its preview."""

    path: str
    width: int
    height: int
    sha256: str
    preview_path: str
    preview_scale: float
    # The sharper scan (`scan-tiles.bin`): written only when the scan is longer than its preview (None: none, or an older version).
    detail_path: str | None = None
    detail_scale: float | None = None

    @classmethod
    def of(cls, value: object) -> ScanInfo:
        record = record_of(value, "scan")
        detail_path = optional_text(record, "detailPath")
        return cls(
            text_of(record, "path"),
            int(number_of(record, "width")),
            int(number_of(record, "height")),
            text_of(record, "sha256"),
            text_of(record, "previewPath"),
            number_of(record, "previewScale"),
            detail_path,
            None if detail_path is None else number_of(record, "detailScale"),
        )

    def as_record(self) -> Record:
        detail_scale = None if self.detail_scale is None else round(self.detail_scale, 6)
        return _without_none(
            {
                "path": self.path,
                "width": self.width,
                "height": self.height,
                "sha256": self.sha256,
                "previewPath": self.preview_path,
                "previewScale": round(self.preview_scale, 6),
                "detailPath": self.detail_path,
                "detailScale": detail_scale,
            }
        )


@dataclass(frozen=True)
class ReferenceInfo:
    """`version.reference`: the window and the reference images drawn for it."""

    bounds: Bounds
    osm_path: str | None = None
    s2_path: str | None = None
    s2_item: str | None = None
    s2_date: str | None = None
    # The reference guard's verdict (`agreement.py`): every clear set it compared, its offset and whether it was kept.
    s2_check: Record | None = None

    @classmethod
    def of(cls, value: object) -> ReferenceInfo:
        record = record_of(value, "reference")
        return cls(
            bounds_of(record.get("bounds")),
            optional_text(record, "osmPath"),
            optional_text(record, "s2Path"),
            optional_text(record, "s2Item"),
            optional_text(record, "s2Date"),
            optional_record(record.get("s2Check")) or None,
        )

    def as_record(self) -> Record:
        return _without_none(
            {
                "bounds": self.bounds.as_record(),
                "osmPath": self.osm_path,
                "s2Path": self.s2_path,
                "s2Item": self.s2_item,
                "s2Date": self.s2_date,
                "s2Check": self.s2_check,
            }
        )


def gcp_of(value: object) -> Gcp:
    record = record_of(value, "a GCP")
    pixel, geo = record_of(record.get("pixel"), "pixel"), record_of(record.get("geo"), "geo")
    score, residual = record.get("score"), record.get("residualM")
    return Gcp(
        id=id_of(record, "id"),
        x=number_of(pixel, "x"),
        y=number_of(pixel, "y"),
        lat=number_of(geo, "lat"),
        lng=number_of(geo, "lng"),
        enabled=record.get("enabled") is not False,
        origin=member_of(record, "origin", GCP_ORIGINS),
        score=float(score) if isinstance(score, int | float) else None,
        residual_m=float(residual) if isinstance(residual, int | float) else None,
    )


def _gcps_of(value: object) -> tuple[Gcp, ...]:
    if not isinstance(value, list):
        raise DocumentError("gcps must be a list")
    return tuple(gcp_of(item) for item in value)


def _lattice_node(value: object) -> LatticeNode:
    record = record_of(value, "a lattice node")
    pixel, geo = record_of(record.get("pixel"), "pixel"), record_of(record.get("geo"), "geo")
    return LatticeNode(number_of(pixel, "x"), number_of(pixel, "y"), number_of(geo, "lat"), number_of(geo, "lng"))


def lattice_of(value: object) -> Lattice | None:
    """`georef.lattice` (M15 §1): None when absent; a malformed one is refused, never half read."""
    if value is None:
        return None
    record = record_of(value, "lattice")
    nodes = record.get("nodes")
    if not isinstance(nodes, list):
        raise DocumentError("lattice.nodes must be a list")
    return Lattice(member_of(record, "model", tuple(sorted(LATTICE_MODELS))), tuple(_lattice_node(node) for node in nodes))


@dataclass(frozen=True)
class TerrainInfo:
    """`georef.terrain` (M15, *Terrain*): the frame was fitted over the surface model; whatever renders or shows it reads its map through
    `rpc` over `heights`, the cells under its scan (`georef/heights.py`). `relief_m`, what the terrain moved beyond a second-order fit
    (ground metres RMS); the source is GLO-30, whose notice the layer carries."""

    rpc: Rpc
    relief_m: float
    heights: Heights

    def as_record(self) -> Record:
        rpc, heights = self.rpc.as_record(), heights_record(self.heights)
        return {"source": "glo30", "reliefM": metres(self.relief_m), "rpc": rpc, "heights": heights}


def terrain_of(value: object) -> TerrainInfo | None:
    """`georef.terrain`: None when absent; a malformed one is refused, never half read."""
    if value is None:
        return None
    record = record_of(value, "terrain")
    relief = record.get("reliefM")
    if not isinstance(relief, int | float) or isinstance(relief, bool):
        raise DocumentError("terrain.reliefM must be a number")
    try:
        return TerrainInfo(Rpc.of(record.get("rpc")), float(relief), heights_of_record(record.get("heights")))
    except ValueError as error:
        raise DocumentError(str(error)) from error


def _optional_metres(value: float | None) -> float | None:
    return None if value is None else metres(value)


@dataclass(frozen=True)
class GeorefInfo:
    """`version.georef`: how the scan is georeferenced, its pairs and errors; `weak_corners`: its corner pairs come from a guess
    nothing confirmed, good to start the matcher and no more (`steps/georef.py` clears them when it waits for the admin)."""

    method: str
    transform: str
    gcps: tuple[Gcp, ...] = ()
    fit_rmse_m: float | None = None
    checkpoint_rmse_m: float | None = None
    checkpoint_count: int | None = None
    weak_corners: bool = False
    # `checkpointKind`: `held-out` or `leave-one-out`, which the approval policy tells apart (M9 §11).
    kind: str | None = None
    # M15 §1: the nodes a warp renders when the pairs cannot rebuild the map (the panoramic camera); None: the pairs' own fit.
    lattice: Lattice | None = None
    # M15, *Terrain*: a frame fitted over the surface model renders through its RPC; None: flat.
    terrain: TerrainInfo | None = None

    @classmethod
    def of(cls, value: object) -> GeorefInfo:
        record = record_of(value, "georef")
        method, transform = member_of(record, "method", GEOREF_METHODS), require_transform(text_of(record, "transform"))
        lattice, terrain = lattice_of(record.get("lattice")), terrain_of(record.get("terrain"))
        gcps, weak = _gcps_of(record.get("gcps")), record.get("weakCorners") is True
        return cls(method, transform, gcps, weak_corners=weak, lattice=lattice, terrain=terrain)

    def as_record(self) -> Record:
        return _without_none(
            {
                "method": self.method,
                "transform": self.transform,
                "gcps": [gcp.as_record() for gcp in self.gcps],
                "fitRmseM": _optional_metres(self.fit_rmse_m),
                "checkpointRmseM": _optional_metres(self.checkpoint_rmse_m),
                "checkpointCount": self.checkpoint_count,
                "checkpointKind": self.kind,
                "weakCorners": True if self.weak_corners else None,
                "lattice": None if self.lattice is None else self.lattice.as_record(),
                "terrain": None if self.terrain is None else self.terrain.as_record(),
            }
        )


@dataclass(frozen=True)
class OutputInfo:
    """`version.output`: the admin's preview; the COG Mapbox gets and the Studio-sized file only for a city that publishes through Mapbox
    (M12). `steps/pyramid.py` adds the version's own tiles after it."""

    cog_path: str | None
    cog_bytes: int | None
    cog_sha256: str | None
    preview_path: str
    bounds: Bounds
    minzoom: int
    maxzoom: int
    area_km2: float
    studio_path: str | None = None
    studio_bytes: int | None = None
    coverage_pct: float | None = None
    outline: tuple[Mapping[str, float], ...] = ()

    def as_record(self) -> Record:
        return _without_none(
            {
                "cogPath": self.cog_path,
                "cogBytes": self.cog_bytes,
                "cogSha256": self.cog_sha256,
                "previewPath": self.preview_path,
                "bounds": self.bounds.as_record(),
                "minzoom": self.minzoom,
                "maxzoom": self.maxzoom,
                "areaKm2": round(self.area_km2, 3),
                "studioPath": self.studio_path,
                "studioBytes": self.studio_bytes,
                "coveragePct": None if self.coverage_pct is None else round(self.coverage_pct, 2),
                "outline": [dict(place) for place in self.outline] or None,
            }
        )


@dataclass(frozen=True)
class JoinSeam:
    """One owner boundary of a join (`joinSeamSchema`): `a` and `b` are entity ids; the RMSEs are absent on an unmeasured seam."""

    a: str
    b: str
    measured: bool
    applied: bool
    samples: int
    held_out: int
    max_shift_m: float
    before_rmse_m: float | None = None
    after_rmse_m: float | None = None

    def as_record(self) -> Record:
        return _without_none(
            {
                "a": self.a,
                "b": self.b,
                "measured": self.measured,
                "applied": self.applied,
                "samples": self.samples,
                "heldOut": self.held_out,
                "beforeRmseM": _optional_metres(self.before_rmse_m),
                "afterRmseM": _optional_metres(self.after_rmse_m),
                "maxShiftM": metres(self.max_shift_m),
            }
        )


@dataclass(frozen=True)
class JoinReport:
    """`version.join` (`joinReportSchema`): the checkpoint figures are the WORST frame's own and the LOWEST count, never pooled."""

    seams: tuple[JoinSeam, ...]
    omitted: tuple[str, ...]
    coverage_pct: float
    checkpoint_count: int
    max_shift_m: float
    checkpoint_rmse_m: float | None = None

    def as_record(self) -> Record:
        return _without_none(
            {
                "seams": [seam.as_record() for seam in self.seams],
                "omitted": list(self.omitted),
                "coveragePct": round(self.coverage_pct, 2),
                "checkpointRmseM": _optional_metres(self.checkpoint_rmse_m),
                "checkpointCount": self.checkpoint_count,
                "maxShiftM": metres(self.max_shift_m),
            }
        )


def _latlng(value: object) -> LatLng:
    record = record_of(value, "a place")
    return number_of(record, "lat"), number_of(record, "lng")


def _ring_of(value: object) -> tuple[LatLng, ...] | None:
    return None if not isinstance(value, list) else tuple(_latlng(item) for item in value)


@dataclass(frozen=True)
class Version:
    """The parts of a layer version the pipeline reads."""

    id: str
    layer_id: str
    origin: str
    state: str
    source: Record
    based_on: str | None = None
    sensor: str | None = None
    scan: ScanInfo | None = None
    reference: ReferenceInfo | None = None
    georef: GeorefInfo | None = None
    crop: tuple[LatLng, ...] | None = None
    # The Cloud Run job each phase ran on (`download`, `process`: finding 56 of 2026-11-01).
    machines: Mapping[str, str] = field(default_factory=dict)
    # What `locate` measured (`calibrationSchema`): `georef` adds its own figures to it.
    calibration: Record = field(default_factory=dict)
    # M16: a recalibration's route, rough points and figures (`recalibrationSchema`): `georef` measures and adds to it.
    recalibration: Record = field(default_factory=dict)

    @classmethod
    def of(cls, version_id: str, record: Mapping[str, object]) -> Version:
        scan, reference, georef = record.get("scan"), record.get("reference"), record.get("georef")
        return cls(
            id=version_id,
            layer_id=id_of(record, "layerId"),
            origin=member_of(record, "origin", VERSION_ORIGINS),
            state=member_of(record, "state", LAYER_VERSION_STATES),
            source=optional_record(record.get("source")),
            based_on=optional_str(record.get("basedOn")),
            sensor=optional_str(record.get("sensor")),
            scan=None if scan is None else ScanInfo.of(scan),
            reference=None if reference is None else ReferenceInfo.of(reference),
            georef=None if georef is None else GeorefInfo.of(georef),
            crop=_ring_of(record.get("crop")),
            machines=_machines_of(record.get("machines")),
            calibration=optional_record(record.get("calibration")),
            recalibration=optional_record(record.get("recalibration")),
        )


def _machines_of(value: object) -> dict[str, str]:
    return {} if not isinstance(value, dict) else {str(phase): machine for phase, machine in value.items() if isinstance(machine, str)}


def _corner(record: Mapping[str, object], key: str) -> LatLng:
    return _latlng(record.get(key))


def _quad(value: object) -> tuple[LatLng, LatLng, LatLng, LatLng] | None:
    if not isinstance(value, dict):
        return None
    return _corner(value, "nw"), _corner(value, "ne"), _corner(value, "se"), _corner(value, "sw")


def _one_piece(footprint: Sequence[LatLng]) -> list[LatLng]:
    """The ring's longitudes each on the side of the one before: a ring over longitude 180 stays one piece, not the world's width."""
    ring = list[LatLng]()
    for lat, lng in footprint:
        ring.append((lat, near_lng(lng, ring[-1][1] if ring else lng)))
    return ring


def _extremes(footprint: Sequence[LatLng]) -> tuple[LatLng, LatLng, LatLng, LatLng]:
    """The footprint's four extreme vertices (north-west, north-east, south-east, south-west), on a normalized box."""
    ring = _one_piece(footprint)
    places = numpy.array(ring, numpy.float64)
    x, y = to_mercator_arrays(places[:, 1], places[:, 0])
    u = (x - x.min()) / max(float(numpy.ptp(x)), 1e-9)
    v = (y - y.min()) / max(float(numpy.ptp(y)), 1e-9)
    nw, ne, se, sw = (ring[index] for index in _distinct_picks((v - u, u + v, u - v, -(u + v))))
    return nw, ne, se, sw


def _distinct_picks(scores: Sequence[FloatArray]) -> list[int]:
    """The best vertex of each score in turn, never one picked before while another is left: a strip running north-west to
    south-east has one vertex both farthest north-east and farthest south-east, and a quad with a corner twice gives no
    projective map (live 2026-11-14, DS1111-1020AF035: a zero-length strip and a raw ZeroDivisionError in `locate`)."""
    picked: list[int] = []
    for score in scores:
        picked.append(_best_left(score, picked))
    return picked


def _best_left(score: FloatArray, picked: Sequence[int]) -> int:
    """The highest-scoring vertex not in `picked`; the highest of all when every one is."""
    order = [int(index) for index in numpy.argsort(-score, kind="stable")]
    return next((index for index in order if index not in picked), order[0])


@dataclass(frozen=True)
class Scene:
    """The parts of `cities/{city}/usgsScenes/{entityId}` the corner guess reads."""

    entity_id: str
    acquisition_date: str
    footprint: tuple[LatLng, ...]
    corners: tuple[LatLng, LatLng, LatLng, LatLng] | None

    @classmethod
    def of(cls, entity_id: str, record: Mapping[str, object]) -> Scene:
        footprint = record.get("footprint")
        if not isinstance(footprint, list) or len(footprint) < len(("nw", "ne", "se")):
            raise DocumentError("footprint must list at least three places")
        places = tuple(_latlng(item) for item in footprint)
        return cls(entity_id, text_of(record, "acquisitionDate"), places, _quad(record.get("corners")))

    def corner_quad(self) -> tuple[LatLng, LatLng, LatLng, LatLng]:
        """The frame's four geographic corners (north-west first, clockwise): the metadata's, else the footprint's extremes."""
        return self.corners if self.corners is not None else _extremes(self.footprint)


def city_bounds(record: Mapping[str, object]) -> Bounds:
    """`cities/{city}.bounds`."""
    return bounds_of(record.get("bounds"))


def log_line(seq: int, level: str, message: str, now: Timestamp, step: str | None = None) -> Record:
    """`jobs/{job}/logs/{seq}` (`jobLogDocSchema`): the message is already redacted and is cut to 2,000 characters."""
    if level not in LOG_LEVELS or not 0 <= seq < MAX_JOB_LOGS:
        raise DocumentError("a log line needs a known level and a sequence number under 500")
    return _without_none({"seq": seq, "level": level, "step": step, "message": message[:LOG_MESSAGE_MAX], **stamp(now)})


def log_id(seq: int) -> str:
    """A log line's document id: its sequence number zero-padded to 6 digits."""
    return f"{seq:06d}"
