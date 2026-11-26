"""Every document the pipeline writes has a shape the shared schemas were shown (finding 62 of 2026-11-02).

The live KH-9 import left a layer version the admin could not read ("This could not be read (invalid-document)", Work
0): the pipeline wrote what `layerVersionDocSchema` refuses, and the golden documents of `pipeline/tests/contracts/`
were written by hand, so nothing compared what the writers really produce with the schemas. Here the real runner and
steps run the imports' paths through every state (awaiting approval, the download handed over, USGS preparing, a failure
with parameters, a corrupt archive, cancelled, no pairs, corners kilometres off, a weak guess, the city off the frame) against the
loopback fakes, and every job, version and log document is recorded after each write. Its **shape** (every field path
with its JSON type, list items merged) must be one of the shapes of `contracts/written-documents.json`, whose documents
`packages/shared/test/schemas/pipeline-contract.test.ts` parses with `jobDocSchema`, `layerVersionDocSchema` and
`jobLogDocSchema`. A writer that adds or changes a field fails here until the file is written again:

    HCM_WRITE_CONTRACTS=1 python -m pytest -c pipeline/pyproject.toml --rootdir . pipeline/tests/integration/test_written_documents.py

then `npx prettier --write pipeline/tests/contracts/written-documents.json`, and the TypeScript test says whether the
schemas accept it. Value limits (a scan side, a GCP's pixel) are the
writers' own checks (`steps/locate.py` `within_limits`, the contract's `MAX_SCAN_PIXELS`).
"""

import json
import os
import re
from collections.abc import Callable, Iterable, Mapping
from pathlib import Path
from typing import Final

import pytest
from hcm_pipeline.calibrate.ports import Proposer
from hcm_pipeline.contract import Errors
from hcm_pipeline.model import contract_json

from tests.contracts_loader import CONTRACTS, golden, record, records
from tests.fakes.documents import MemoryStore
from tests.fakes.http import Reply
from tests.fakes.sidecar import TrueProposer, truth_matrix
from tests.fakes.world import CITY, ENTITY_ID, OVERPASS_PATH, PipelineWorld, dig, small_city
from tests.integration.joining import JOB, Frame, run_join, seed_frames
from tests.integration.matching import seed_matching, uniform
from tests.integration.tiling import run_tiles_job, seed_old_version
from tests.synthetic.scenes import Scene, overpass_answer, render_world, write_sentinel2

GOLDEN: Final = "written-documents.json"
KINDS: Final = {"job": re.compile(r"^cities/[^/]+/jobs/[^/]+$"), "version": re.compile(r"^cities/[^/]+/layerVersions/[^/]+$")}
LOG: Final = re.compile(r"^cities/[^/]+/jobs/[^/]+/logs/[^/]+$")
# A list keeps this many items in the golden file (one of each item shape first): the shape, not the bulk, is checked.
KEPT_ITEMS: Final = 12
Shape = frozenset[str]
Recorded = list[tuple[str, dict[str, object]]]


class RecordingStore(MemoryStore):
    """A `MemoryStore` that keeps every job, version and log document as it stands after each write."""

    def __init__(self) -> None:
        super().__init__()
        self.recorded: list[tuple[str, dict[str, object]]] = []

    def _record(self, path: str) -> None:
        kind = next((name for name, pattern in KINDS.items() if pattern.match(path)), "log" if LOG.match(path) else None)
        assert kind is not None, f"the pipeline wrote {path}, which no shared schema of this contract reads"
        self.recorded.append((kind, record(contract_json(self.documents[path]))))

    def update(self, path: str, fields: Mapping[str, object]) -> None:
        super().update(path, fields)
        self._record(path)

    def create(self, path: str, data: Mapping[str, object]) -> bool:
        created = super().create(path, data)
        if created:
            self._record(path)
        return created


def _type(value: object) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int | float):
        return "number"
    return "null" if value is None else "string" if isinstance(value, str) else type(value).__name__


def _paths(value: object, prefix: str) -> Iterable[str]:
    if isinstance(value, dict):
        yield f"{prefix}:object"
        for key, item in value.items():
            yield from _paths(item, f"{prefix}.{key}")
    elif isinstance(value, list):
        yield f"{prefix}:list"
        for item in value:
            yield from _paths(item, f"{prefix}[]")
    else:
        yield f"{prefix}:{_type(value)}"


def shape(document: Mapping[str, object]) -> Shape:
    """Every field path of the document with its JSON type (`steps.fetch.bytes:number`); list items merged."""
    return frozenset(_paths(dict(document), ""))


def _first_of_each_shape(items: list[object]) -> list[int]:
    """The index of the first item of each item shape."""
    seen: dict[Shape, int] = {}
    for index, item in enumerate(items):
        seen.setdefault(frozenset(_paths(item, "")), index)
    return list(seen.values())


def _kept(items: list[object]) -> list[object]:
    """At most `KEPT_ITEMS` of the items (more when they have more shapes), one of each shape first, in their order."""
    first = _first_of_each_shape(items)
    rest = [index for index in range(len(items)) if index not in first]
    return [items[index] for index in sorted(first + rest[: max(0, KEPT_ITEMS - len(first))])]


def trimmed(value: object) -> object:
    """The value with each list cut to `KEPT_ITEMS` items, one of each item shape kept (its shape unchanged)."""
    if isinstance(value, dict):
        return {key: trimmed(item) for key, item in value.items()}
    if isinstance(value, list):
        return [trimmed(item) for item in _kept(value)]
    return value


# --- the paths through every state -------------------------------------------------------------------------


def poke(world: PipelineWorld, path: str, fields: Mapping[str, object]) -> None:
    """A document changed by the test itself (the dispatcher's or the admin's part), not recorded as written."""
    world.store.documents[path].update(fields)


def whole_import(world: PipelineWorld, _tmp: Path) -> None:
    world.seed_import()
    world.run()
    assert world.version()["state"] == "awaiting_approval"


def two_phases(world: PipelineWorld, _tmp: Path) -> None:
    world.seed_import()
    poke(world, world.job_path(), {"machine": "fetch"})
    world.run()
    poke(world, world.job_path(), {"machine": "std", "status": "starting"})
    world.run()
    assert dig(world.version(), "machines") == {"download": "fetch", "process": "std"}


def usgs_preparing(world: PipelineWorld, _tmp: Path) -> None:
    world.seed_import()
    world.m2m.set_data("download-request", {"availableDownloads": [], "preparingDownloads": [{"downloadId": 1}]})
    world.m2m.set_data("download-retrieve", {"available": [], "requested": [{"downloadId": 1}]})
    world.run()
    assert world.job()["waitReason"] == "usgs-preparing"


def not_scanned(world: PipelineWorld, _tmp: Path) -> None:
    """USGS offers no download: the failure's `{entityId}` parameter."""
    world.offer_download(len(world.delivery), available=False)
    world.seed_import()
    world.run()
    assert dig(world.version(), "error", "code") == Errors.NOT_SCANNED


def size_mismatch(world: PipelineWorld, _tmp: Path) -> None:
    """A truncated delivery: the failure's `{bytes}` parameter (a number made both documents unreadable)."""
    world.offer_download(len(world.delivery) + 1000)
    world.seed_import()
    world.run()
    assert dig(world.version(), "error", "code") == Errors.DOWNLOAD_INCOMPLETE
    assert isinstance(dig(world.version(), "error", "params", "bytes"), str)


def corrupt_archive(world: PipelineWorld, _tmp: Path) -> None:
    world.delivered = b"\x1f\x8b" + b"not really gzip" * 100
    world.offer_download(len(world.delivered))
    world.seed_import()
    world.run()
    assert world.version()["state"] == "failed"


def cancelled(world: PipelineWorld, _tmp: Path) -> None:
    world.seed_import()
    poke(world, world.job_path(), {"cancelRequested": True})
    world.run()
    assert world.version()["state"] == "cancelled"


def no_pairs(world: PipelineWorld, tmp: Path) -> None:
    seed_matching(world, tmp, uniform)
    world.runner().run("georef")
    assert dig(world.version(), "error", "params") == {"pairs": "0"}


def corners_far_off(world: PipelineWorld, _tmp: Path) -> None:
    """The scene's metadata corners 1.3 km off: the tile votes find the city, the import goes on."""
    world.seed_import()
    scene = f"cities/{CITY}/usgsScenes/{ENTITY_ID}"
    corners = record(world.store.documents[scene]["corners"])
    moved = {
        name: {"lat": float(str(record(place)["lat"])) + 0.008, "lng": float(str(record(place)["lng"])) + 0.012}
        for name, place in corners.items()
    }
    poke(world, scene, {"corners": moved, "footprint": list(moved.values())})
    world.run()
    assert world.version()["state"] == "awaiting_approval"
    assert any(line.startswith("tile votes") and "moved 1." in line for line in world.log_lines())


def weak_guess(world: PipelineWorld, tmp: Path) -> None:
    """Sentinel-2 and OpenStreetMap show another place: nothing is proved, the crop keeps a margin, the admin places the points on a
    scan with no corner pairs of a frame nothing proved, and the delivery stays."""
    other = render_world(99)
    world.http.serve("/s2/visual.tif", write_sentinel2(other, tmp / "elsewhere.tif").read_bytes())
    world.http.route("POST", OVERPASS_PATH, lambda _request: Reply.json(json.dumps(overpass_answer(other))))
    world.seed_import()
    world.run()
    assert world.version()["state"] == "needs_gcps"
    assert dig(world.version(), "error", "code") == Errors.NO_MATCH
    assert "scan" in world.version()
    assert "georef" not in world.version()
    assert world.gcs.names("usgs-raw/") != []
    assert any(line.startswith("not proved") for line in world.log_lines())


def city_off_frame(world: PipelineWorld, _tmp: Path) -> None:
    """The scene's corners a degree away from the city: the frame does not reach the window, nothing is cropped."""
    world.seed_import()
    scene = f"cities/{CITY}/usgsScenes/{ENTITY_ID}"
    corners = record(world.store.documents[scene]["corners"])
    moved = {
        name: {"lat": float(str(record(place)["lat"])) + 1.0, "lng": float(str(record(place)["lng"]))} for name, place in corners.items()
    }
    poke(world, scene, {"corners": moved, "footprint": list(moved.values())})
    world.run()
    assert dig(world.version(), "error", "code") == Errors.CITY_NOT_FOUND
    assert "scan" not in world.version()


def found_by_local_ai(world: PipelineWorld, _tmp: Path) -> None:
    """A frame only a matcher's proposal proved (M10): `calibration.proposer`, on the processor after the graphics card's memory ran out."""
    world.seed_import()
    named = Proposer("aliked-lightglue", "cpu", 40.5, 46, "NVIDIA RTX 3080", "out-of-memory")
    world.matcher = TrueProposer(truth_matrix(world.scene.truth), named)
    small_city(world)
    world.run()


def _join_frames(world: PipelineWorld, tmp: Path, apart_m: float = 0.0) -> None:
    """Two frames of one date over the scene's own ground, `apart_m` from each other."""
    size = (500, 400)
    frames = [Frame("west", (-1500.0, 0.0), (apart_m, 0.0), size=size), Frame("east", (1500.0, 0.0), (-apart_m, 0.0), size=size)]
    seed_frames(world, tmp, world.scene.world, frames, (2500.0, 1500.0))


def joined_frames(world: PipelineWorld, tmp: Path) -> None:
    """A `layer-join` end to end: its report and the job's own steps."""
    _join_frames(world, tmp, 20.0)
    run_join(world)
    assert world.version(JOB)["state"] == "awaiting_approval"
    assert dig(world.version(JOB), "join", "seams")


def join_too_far(world: PipelineWorld, tmp: Path) -> None:
    """Frames too far apart: the failure's `{a}` and `{b}` parameters."""
    _join_frames(world, tmp, 400.0)
    run_join(world)
    assert dig(world.job(JOB), "error", "code") == Errors.JOIN_SEAM_TOO_FAR


def own_tiles_import(world: PipelineWorld, _tmp: Path) -> None:
    """M12: the default path: tiles and a preview, no COG."""
    world.seed_import()
    world.seed_own_city()
    world.run()


def tiles_job(world: PipelineWorld, tmp: Path) -> None:
    """M12: a version rendered before it gets its tiles and keeps its state."""
    seed_old_version(world, tmp)
    run_tiles_job(world)


def tiles_job_fails(world: PipelineWorld, tmp: Path) -> None:
    """M12: nothing to make them from: the job fails alone."""
    seed_old_version(world, tmp, with_cog=False)
    run_tiles_job(world)


PATHS: Final[dict[str, Callable[[PipelineWorld, Path], None]]] = {
    "whole-import": whole_import,
    "own-tiles-import": own_tiles_import,
    "tiles-job": tiles_job,
    "tiles-job-fails": tiles_job_fails,
    "two-phases": two_phases,
    "usgs-preparing": usgs_preparing,
    "not-scanned": not_scanned,
    "size-mismatch": size_mismatch,
    "corrupt-archive": corrupt_archive,
    "cancelled": cancelled,
    "no-pairs": no_pairs,
    "corners-far-off": corners_far_off,
    "weak-guess": weak_guess,
    "city-off-frame": city_off_frame,
    "found-by-local-ai": found_by_local_ai,
    "joined-frames": joined_frames,
    "join-too-far": join_too_far,
}


@pytest.fixture(scope="module")
def recorded(synthetic_scene: Scene, tmp_path_factory: pytest.TempPathFactory) -> dict[str, Recorded]:
    """Every path run once, each in its own world, with what it wrote recorded."""
    found = {}
    for name, path in PATHS.items():
        with PipelineWorld(synthetic_scene) as world:
            store = RecordingStore()
            world.store = store
            path(world, tmp_path_factory.mktemp(name))
            found[name] = store.recorded
    return found


def known_shapes() -> dict[str, set[Shape]]:
    stored = golden(GOLDEN)
    return {kind: {shape(document) for document in records(stored[kind])} for kind in ("job", "version", "log")}


def nearest_difference(written_shape: Shape, known: set[Shape]) -> list[str]:
    """What sets the written shape apart from the closest known one (the fields to look at)."""
    closest = min(known, key=lambda seen: len(written_shape ^ seen), default=frozenset())
    return sorted(written_shape ^ closest)


@pytest.mark.parametrize("name", list(PATHS))
def test_happy_path_each_path_writes_only_documents_of_a_known_shape(name: str, recorded: dict[str, Recorded]) -> None:
    """Scenarios: S-P01-HAPPY-WRITTEN-CONTRACT, S-P01-BAD-WRITTEN-PARAMS, S-P01-HAPPY-KH9-STRIP, S-P01-BAD-CITY-NOT-FOUND
    Scenarios: S-P01-BAD-WEAK-GUESS-TO-POINTS, S-P01-BAD-CITY-OFF-FRAME, S-P05-HAPPY, S-P05-BAD-TOO-FAR
    Scenarios: S-P07-HAPPY-SMALL-WINDOW, S-P08-HAPPY-FROM-WARP, S-P08-HAPPY-OLD-VERSION, S-P08-BAD-FAILS-ALONE"""
    known = known_shapes()

    unknown = [
        (kind, nearest_difference(shape(document), known[kind])) for kind, document in recorded[name] if shape(document) not in known[kind]
    ]

    assert recorded[name]
    assert unknown == [], f"{name}: write {GOLDEN} again (HCM_WRITE_CONTRACTS=1), then run the shared contract test"


def test_happy_path_the_golden_file_holds_one_document_of_each_shape_written(recorded: dict[str, Recorded]) -> None:
    """Scenarios: S-P01-HAPPY-WRITTEN-CONTRACT"""
    by_kind: dict[str, dict[Shape, object]] = {"job": {}, "version": {}, "log": {}}
    for documents in recorded.values():
        for kind, document in documents:
            by_kind[kind].setdefault(shape(document), trimmed(document))
    if os.environ.get("HCM_WRITE_CONTRACTS") == "1":
        content = {"comment": golden(GOLDEN)["comment"], **{kind: list(documents.values()) for kind, documents in by_kind.items()}}
        (CONTRACTS / GOLDEN).write_text(json.dumps(content, ensure_ascii=False, indent=4) + "\n", encoding="utf-8")

    assert known_shapes() == {kind: set(documents) for kind, documents in by_kind.items()}
    assert all(shape(record(trimmed(document))) == shape(record(document)) for documents in recorded.values() for _, document in documents)
