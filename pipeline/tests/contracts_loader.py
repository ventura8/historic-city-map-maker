"""Typed readers of the golden contract files of `pipeline/tests/contracts/` (docs/research/M3-interfaces.md §5.8).

The files are owned by the contract (both languages must pass a change); the pipeline's tests read them through
these helpers so every field the tests use is checked to have the type the test expects.
"""

import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from hcm_pipeline.georef.transforms import Gcp
from hcm_pipeline.model import Timestamp

CONTRACTS = Path(__file__).resolve().parent / "contracts"


def golden(name: str) -> dict[str, object]:
    """One golden JSON document."""
    value = json.loads((CONTRACTS / name).read_text(encoding="utf-8"))
    assert isinstance(value, dict)
    return value


def _is_timestamp(value: object) -> bool:
    return isinstance(value, dict) and set(value) == {"seconds", "nanoseconds"}


def _timestamp(value: dict[str, object]) -> Timestamp:
    return Timestamp(int(str(value["seconds"])), int(str(value["nanoseconds"])))


def _converted(value: object) -> object:
    if isinstance(value, dict):
        return {key: with_timestamps(item) for key, item in value.items()}
    return [with_timestamps(item) for item in value] if isinstance(value, list) else value


def with_timestamps(value: object) -> object:
    """A golden document with its `{seconds, nanoseconds}` records as `Timestamp` (what a store returns)."""
    return _timestamp(record(value)) if _is_timestamp(value) else _converted(value)


def stored(name: str) -> dict[str, object]:
    """A golden document as the store would return it."""
    return record(with_timestamps(golden(name)))


def record(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return value


def records(value: object) -> list[dict[str, object]]:
    assert isinstance(value, list)
    return [record(item) for item in value]


def number(value: object) -> float:
    assert isinstance(value, int | float)
    return float(value)


def gcp_of(value: dict[str, object]) -> Gcp:
    pixel, geo = record(value["pixel"]), record(value["geo"])
    return Gcp(
        id=str(value["id"]),
        x=number(pixel["x"]),
        y=number(pixel["y"]),
        lat=number(geo["lat"]),
        lng=number(geo["lng"]),
        enabled=bool(value["enabled"]),
        origin=str(value["origin"]),
        score=number(value["score"]) if "score" in value else None,
        residual_m=number(value["residualM"]) if "residualM" in value else None,
    )


@dataclass(frozen=True)
class GeorefCase:
    name: str
    transform: str
    gcps: tuple[Gcp, ...]
    expect: dict[str, object]

    @property
    def ok(self) -> bool:
        return bool(self.expect["ok"])

    @property
    def reason(self) -> str:
        return str(self.expect["reason"])

    @property
    def fit_rmse_m(self) -> float:
        return number(self.expect["fitRmseM"])

    @property
    def tolerance_m(self) -> float:
        return number(self.expect["toleranceM"])

    @property
    def checkpoint_rmse_m(self) -> float:
        return number(self.expect["checkpointRmseM"])

    @property
    def checkpoint_count(self) -> int | None:
        value = self.expect.get("checkpointCount")
        return None if value is None else int(number(value))


@cache
def georef_cases() -> tuple[GeorefCase, ...]:
    cases = records(golden("georef-cases.json")["cases"])
    return tuple(
        GeorefCase(str(case["name"]), str(case["transform"]), tuple(gcp_of(gcp) for gcp in records(case["gcps"])), record(case["expect"]))
        for case in cases
    )
