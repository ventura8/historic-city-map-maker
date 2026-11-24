"""The owner's saved pairs come first, and the picture they warp carries its own parts record (lesson of 2026-11-24).

The plan cadastral 1911-1914 was once sent to Fix the tiles (`relayout` stays in its job's params); the 17 pairs saved on its
stitched picture were laid aside for its tile layout again, which waited at frame-not-found as before, and the parts record beside
the picture was an older layout's.
"""

from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import numpy
import pytest
from hcm_pipeline.placing import fullres, owner, owner_layout, rebuild, restitch
from hcm_pipeline.placing.canvas_window import Tile
from hcm_pipeline.placing.series import SeriesJob
from hcm_pipeline.steps import place
from hcm_pipeline.steps.place import PlaceStep

from tests.unit.test_placing_fullres import write


class _NeverRun:
    def place(self, ctx: Any) -> object:
        raise AssertionError("the class placer ran on a series with the owner's pairs")


def test_happy_path_the_owners_pairs_place_a_series_once_sent_to_fix_the_tiles(monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P20-HAPPY-PAIRS-BEFORE-RELAYOUT"""
    georef = SimpleNamespace(method="gcps", gcps=("g1",))
    ctx = SimpleNamespace(job=SimpleNamespace(params={"class": "grid", "relayout": True}), version=SimpleNamespace(georef=georef))
    monkeypatch.setattr(restitch, "asked", lambda _ctx: False)
    monkeypatch.setattr(place, "place_from_pairs", lambda _ctx, pairs: ("pairs", pairs))
    monkeypatch.setattr(place, "relaid", lambda _ctx: ("relaid",))

    result: object = PlaceStep(cast(Any, {"grid": _NeverRun()})).run(cast(Any, ctx))

    assert result == ("pairs", georef)


def test_bad_path_without_pairs_fix_the_tiles_still_lays_the_series_out_again(monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P20-BAD-PAIRS-BEFORE-RELAYOUT"""
    ctx = SimpleNamespace(job=SimpleNamespace(params={"class": "grid", "relayout": True}), version=SimpleNamespace(georef=None))
    monkeypatch.setattr(place, "relaid", lambda _ctx: ("relaid",))

    result: object = PlaceStep(cast(Any, {"grid": _NeverRun()})).run(cast(Any, ctx))

    assert result == ("relaid",)


def test_bad_path_a_parts_record_of_an_older_layout_is_removed_for_a_rebuild(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-PAIRS-BEFORE-RELAYOUT"""
    picture = write(tmp_path / "stitched.tif", numpy.zeros((20, 40), numpy.uint8))
    part = fullres.Part(picture, (0, 0, 40, 20), numpy.eye(3))

    assert owner.parts_fit(picture, (40, 20)) is False
    fullres.write_parts(picture, [part], (80, 40))
    assert owner.parts_fit(picture, (40, 20)) is True
    fullres.write_parts(picture, [part], (100, 100))
    assert owner.parts_fit(picture, (40, 20)) is False
    assert not fullres.sidecar(picture).is_file()


def test_happy_path_the_owners_layout_rebuilds_its_record(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P20-HAPPY-PAIRS-BEFORE-RELAYOUT"""
    series = cast(SeriesJob, SimpleNamespace(sheets=()))
    ctx = cast(Any, SimpleNamespace())
    monkeypatch.setattr(owner_layout, "answer_of", lambda _ctx: None)
    assert rebuild.BUILDERS["owner"](ctx, series) is None

    tile = Tile(tmp_path / "a.tif", (0, 0, 10, 10), 0, 0, 0, 10, 10)
    proposal = SimpleNamespace(tiles=lambda _longest: ([(0, tile)], (10, 10)))
    monkeypatch.setattr(owner_layout, "answer_of", lambda _ctx: "answer")
    monkeypatch.setattr(owner_layout, "owner_proposal", lambda _named, _answer: proposal)
    found = rebuild.BUILDERS["owner"](ctx, series)

    assert found is not None
    assert found.size == (10, 10)
    assert len(found.parts) == 1
