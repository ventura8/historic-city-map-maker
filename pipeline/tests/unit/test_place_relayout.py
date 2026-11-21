"""Fix the tiles (`relayout`, M20 §19.13): `place` lays a placed series out again and waits for its owner in the tile wizard."""

from types import SimpleNamespace
from typing import Any

import pytest
from hcm_pipeline.steps import place
from hcm_pipeline.steps.place import PlaceStep


class _NeverRun:
    """A class placer Fix the tiles must pass over: the grid placed the series wrong in the first place."""

    def place(self, ctx: Any) -> object:
        raise AssertionError("the class placer ran on a series asked to be laid out again")


def _ctx(relayout: object = True) -> Any:
    return SimpleNamespace(job=SimpleNamespace(params={"class": "grid", "relayout": relayout}), version=SimpleNamespace(georef=None))


@pytest.fixture
def calls(monkeypatch: pytest.MonkeyPatch) -> dict[str, object]:
    seen: dict[str, object] = {}
    monkeypatch.setattr(place, "series_of", lambda ctx: SimpleNamespace(sheets=()))
    monkeypatch.setattr(place, "paged", lambda ctx, series: seen.get("paged", series))
    monkeypatch.setattr(place.owner_layout, "answer_of", lambda ctx: seen.get("answer"))
    monkeypatch.setattr(place.owner_layout, "place", lambda ctx, series, answer, method: ("owner", answer, method))
    monkeypatch.setattr(place.autoplace, "proposed", lambda ctx, series: "proposal")
    monkeypatch.setattr(place.autoplace, "wait_layout", lambda ctx, series, proposal: ("wait", proposal))
    monkeypatch.setattr(place, "wait_for_help", lambda ctx, reason, note: ("help", reason, note))
    return seen


def test_happy_path_a_series_never_answered_waits_with_the_automatic_proposal(calls: dict[str, object]) -> None:
    """Scenarios: S-A-HAPPY-FIX-TILES"""
    assert PlaceStep({"grid": _NeverRun()}).run(_ctx()) == ("wait", "proposal")


def test_happy_path_the_owners_earlier_layout_is_the_first_preview(calls: dict[str, object]) -> None:
    """Scenarios: S-A-HAPPY-FIX-TILES"""
    calls["answer"] = "answer"
    assert PlaceStep({"grid": _NeverRun()}).run(_ctx()) == ("owner", "answer", "atlas")


def test_bad_path_sheets_that_cannot_be_read_wait_for_a_person(calls: dict[str, object]) -> None:
    """Scenarios: S-A-BAD-FIX-TILES-STATE"""
    calls["paged"] = "The PDF could not be read."
    assert PlaceStep({"grid": _NeverRun()}).run(_ctx()) == ("help", "low-confidence", "The PDF could not be read.")


def test_bad_path_without_the_flag_the_class_placer_runs(calls: dict[str, object]) -> None:
    class _Ran:
        def place(self, ctx: Any) -> str:
            return "grid"

    assert PlaceStep({"grid": _Ran()}).run(_ctx(relayout="yes")) == "grid"
