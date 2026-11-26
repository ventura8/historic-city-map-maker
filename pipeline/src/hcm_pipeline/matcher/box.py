"""The box between the worker and the sidecar: the volume `hcm-ai-box`, its files and what is valid in them (M10 *Delivery*).

The sidecar has no network, so this folder is the whole of what it hears and says. One request for one orientation:
`<id>.request.npz` (no pickle) and, in return, `<id>.answer.json`. `<id>.cancel` asks a run to stop, `<id>.rerun` says the graphics
card ran out of memory and the request runs once more on the processor. `sidecar.json` says which device the sidecar runs on and beats
while it lives; `starter.json` is the starter file's word when it cannot bring the sidecar up. Every file appears by a rename, so a
reader never sees half of one. Nothing here imports `hcm_pipeline`, OpenCV or PyTorch.
"""

import json
import math
import os
import re
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Self

import numpy
from numpy.typing import NDArray

SIDECAR: Final = "sidecar.json"
STARTER: Final = "starter.json"
REQUEST_SUFFIX: Final = ".request.npz"
ANSWER_SUFFIX: Final = ".answer.json"
CANCEL_SUFFIX: Final = ".cancel"
RERUN_SUFFIX: Final = ".rerun"
REQUEST_ID: Final = re.compile(r"[a-z0-9][a-z0-9-]{0,79}")
MAX_PROPOSALS: Final = 3
MIN_SCALE: Final = 0.85
MAX_SCALE: Final = 1.15
MATRIX_SIDE: Final = 3
# Named, not spelt in the `except`: this file runs under the sidecar's Python 3.12; ruff's target (3.14) drops the parentheses it needs.
UNREADABLE: Final = (OSError, ValueError, RecursionError)
DEVICES: Final = frozenset({"gpu", "cpu"})
# What a failed answer may say, beyond a number: a weights file that no longer matches its pin. Anything else reads as a bad answer.
TAMPERED: Final = "tampered"
GARBAGE: Final = "garbage"
# `gpu-busy`: the governor kept the request off a card other programs held (docs/research/M26-governor.md §5).
FALLBACKS: Final = frozenset({None, "no-gpu", "out-of-memory", "gpu-busy"})
DEFAULT_KEYPOINTS: Final = 2048
BUDGET_FIELDS: Final = 4
FloatArray = NDArray[numpy.float64]
UInt8Array = NDArray[numpy.uint8]


class BadAnswerError(ValueError):
    """An answer the worker will not read as a proposal; its `word` is what the panel says (`adminWorker.ai.why.*`)."""

    def __init__(self, detail: str, word: str = GARBAGE) -> None:
        super().__init__(detail)
        self.word = word


@dataclass(frozen=True)
class MatcherBudget:
    """The governor's word on one request (docs/research/M26-governor.md §4): processor threads (0: the child's own), keypoints per
    tile, the card's memory share (0: no cap), and whether the card must be left to other programs (the request runs on the processor)."""

    threads: int = 0
    keypoints: int = DEFAULT_KEYPOINTS
    gpu_fraction: float = 0.0
    yield_gpu: bool = False

    def as_array(self) -> FloatArray:
        return numpy.array([self.threads, self.keypoints, self.gpu_fraction, float(self.yield_gpu)], numpy.float64)

    @classmethod
    def of_array(cls, values: FloatArray) -> Self:
        """A stored budget; one of another shape reads as the default."""
        if values.shape != (BUDGET_FIELDS,):
            return cls()
        threads, keypoints, fraction, held = (float(each) for each in values)
        return cls(max(0, int(threads)), max(1, int(keypoints)), min(1.0, max(0.0, fraction)), held > 0)


@dataclass(frozen=True)
class Request:
    """One orientation for the matcher: the film warped through its start, the reference, both grids (pixel to EPSG:3857 metres)."""

    film: UInt8Array
    reference: UInt8Array
    film_grid: FloatArray
    reference_grid: FloatArray
    ground: float
    budget: MatcherBudget = MatcherBudget()


@dataclass(frozen=True)
class Found:
    """A proposal: the map from the start's places to true places, its consensus's pairs and points."""

    matrix: FloatArray
    pairs: int
    points: int


@dataclass(frozen=True)
class Answer:
    """What the sidecar says of a request: its proposals, and how it ran."""

    found: tuple[Found, ...]
    device: str
    device_name: str | None
    seconds: float
    fallback: str | None = None

    def as_record(self) -> dict[str, object]:
        return {
            "proposals": [{"matrix": each.matrix.tolist(), "pairs": each.pairs, "points": each.points} for each in self.found],
            "device": self.device,
            "deviceName": self.device_name,
            "seconds": self.seconds,
            "fallback": self.fallback,
        }


@dataclass(frozen=True)
class SidecarStatus:
    """Which device the sidecar runs on, why not the graphics card when it does not, and its heartbeat."""

    device: str
    device_name: str | None
    fallback: str | None
    beat: int


def write_atomic(path: Path, data: bytes) -> None:
    """`data` at `path` by a rename: a reader sees all of it or nothing."""
    part = path.with_name(f"{path.name}.part")
    part.write_bytes(data)
    os.replace(part, path)


def _write_json(path: Path, value: Mapping[str, object]) -> None:
    write_atomic(path, json.dumps(value).encode("utf-8"))


def _read_json(path: Path) -> Mapping[str, object] | None:
    """The file's object; None when it is absent or no object."""
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except UNREADABLE:
        return None
    return value if isinstance(value, dict) else None


def write_status(box: Path, status: SidecarStatus) -> None:
    fields = {"device": status.device, "deviceName": status.device_name, "fallback": status.fallback, "beat": status.beat}
    _write_json(box / SIDECAR, fields)


def _text_or_none(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _one_of(value: object, allowed: Collection[str | None]) -> bool:
    """Whether a value read from the box is one of these words; a list or an object is none of them, not an unhashable crash."""
    return (value is None or isinstance(value, str)) and value in allowed


def read_status(box: Path) -> SidecarStatus | None:
    """What the sidecar last said; None when it said nothing readable."""
    value = _read_json(box / SIDECAR)
    if value is None or not _one_of(value.get("device"), DEVICES):
        return None
    beat = value.get("beat")
    if not isinstance(beat, int):
        return None
    return SidecarStatus(str(value["device"]), _text_or_none(value.get("deviceName")), _text_or_none(value.get("fallback")), beat)


def starter_word(box: Path) -> str | None:
    """Why the starter file cannot bring the sidecar up; None while it says nothing of the kind."""
    value = _read_json(box / STARTER)
    why = None if value is None else value.get("why")
    return why if isinstance(why, str) else None


def write_request(box: Path, request_id: str, request: Request) -> Path:
    """The request's file by a rename; its name is checked: it comes from the worker's own counter."""
    if REQUEST_ID.fullmatch(request_id) is None:
        raise ValueError(f"not a request id: {request_id!r}")
    path = box / f"{request_id}{REQUEST_SUFFIX}"
    part = box / f"{request_id}.part.npz"
    numpy.savez_compressed(
        part,
        film=request.film,
        reference=request.reference,
        film_grid=request.film_grid,
        reference_grid=request.reference_grid,
        ground=numpy.array(request.ground),
        budget=request.budget.as_array(),
    )
    os.replace(part, path)
    return path


def read_request(path: Path) -> Request:
    """A request, read with no pickle."""
    with numpy.load(path, allow_pickle=False) as stored:
        film, reference, film_grid, reference_grid = (stored[key] for key in ("film", "reference", "film_grid", "reference_grid"))
        budget = MatcherBudget.of_array(stored["budget"]) if "budget" in stored.files else MatcherBudget()
        return Request(film, reference, film_grid, reference_grid, float(stored["ground"].item()), budget)


def request_id_of(path: Path) -> str:
    return path.name.removesuffix(REQUEST_SUFFIX)


def pending(box: Path) -> list[Path]:
    """The requests that wait for an answer, oldest name first (the worker's counter names them in order)."""
    return sorted(each for each in box.glob(f"*{REQUEST_SUFFIX}") if not (box / f"{request_id_of(each)}{ANSWER_SUFFIX}").exists())


def write_answer(box: Path, request_id: str, answer: Answer) -> None:
    _write_json(box / f"{request_id}{ANSWER_SUFFIX}", answer.as_record())


def write_failure(box: Path, request_id: str, why: str) -> None:
    """An answer that says the run failed, so the worker stops waiting for it."""
    _write_json(box / f"{request_id}{ANSWER_SUFFIX}", {"failed": why})


def _whole(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise BadAnswerError("a count that is not a whole number")
    return value


def _scale_of(matrix: FloatArray) -> float:
    return float(abs(numpy.linalg.det(matrix[:2, :2])) ** 0.5)


def _believable(matrix: FloatArray) -> bool:
    """A finite 3 by 3 similarity of a scale the pair gate allows, last row (0, 0, 1)."""
    if matrix.shape != (MATRIX_SIDE, MATRIX_SIDE) or not numpy.isfinite(matrix).all():
        return False
    return bool(numpy.allclose(matrix[2], [0.0, 0.0, 1.0])) and MIN_SCALE <= _scale_of(matrix) <= MAX_SCALE


def _matrix_of(value: object) -> FloatArray:
    try:
        matrix = numpy.array(value, numpy.float64)
    except (TypeError, ValueError, OverflowError) as error:
        raise BadAnswerError("a matrix that is no matrix") from error
    if not _believable(matrix):
        raise BadAnswerError("a matrix of the wrong shape, not finite, or no similarity of a believable scale")
    return matrix


def _found_of(value: object) -> Found:
    if not isinstance(value, dict):
        raise BadAnswerError("a proposal that is no object")
    return Found(_matrix_of(value.get("matrix")), _whole(value.get("pairs")), _whole(value.get("points")))


def _float_of(value: object) -> float:
    """A JSON number as a float; a whole number too large for one is no number here."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise BadAnswerError("seconds that are no number")
    try:
        return float(value)
    except OverflowError as error:
        raise BadAnswerError("seconds beyond any time") from error


def _seconds_of(value: object) -> float:
    seconds = _float_of(value)
    if not math.isfinite(seconds) or seconds < 0:
        raise BadAnswerError("seconds that are no time")
    return seconds


def _proposals_of(value: object) -> Sequence[object]:
    if not isinstance(value, list) or len(value) > MAX_PROPOSALS:
        raise BadAnswerError("no list of at most three proposals")
    return value


def parse_answer(value: Mapping[str, object]) -> Answer:
    """An answer the worker may read: finite, at most three proposals, believable scales; anything else raises `BadAnswerError`."""
    if not _one_of(value.get("device"), DEVICES) or not _one_of(value.get("fallback"), FALLBACKS):
        raise BadAnswerError("an unknown device or fallback")
    found = tuple(_found_of(each) for each in _proposals_of(value.get("proposals")))
    return Answer(
        found,
        str(value["device"]),
        _text_or_none(value.get("deviceName")),
        _seconds_of(value.get("seconds")),
        _text_or_none(value.get("fallback")),
    )


def read_answer(path: Path) -> Answer:
    """The answer file, valid, or `BadAnswerError` with why."""
    value = _read_json(path)
    if value is None:
        raise BadAnswerError("no answer readable as an object")
    failed = value.get("failed")
    if failed is not None:
        raise BadAnswerError(f"the sidecar failed: {str(failed)[:80]}", TAMPERED if failed == TAMPERED else GARBAGE)
    return parse_answer(value)


def clear_request(box: Path, request_id: str) -> None:
    """A request's files gone, whatever its end: the box stays under its 200 MB."""
    for suffix in (REQUEST_SUFFIX, ANSWER_SUFFIX, CANCEL_SUFFIX, RERUN_SUFFIX, ".part.npz", f"{ANSWER_SUFFIX}.part"):
        (box / f"{request_id}{suffix}").unlink(missing_ok=True)
