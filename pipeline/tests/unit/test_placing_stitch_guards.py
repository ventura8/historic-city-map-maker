"""What keeps a doubtful layout from being mosaicked, and the owner's answer read for what it still says (M20 §19.5, §19.6, §19.8).

The adversarial review of track/autostitch (2026-11-13): sheets named right whose seams say nothing were judged `good` (each held by
its cell's prior alone); the older joins mosaicked a `poor` layout unchecked; a sheet the owner did not name became `not-part`; a seam
answered before a sheet moved, or with a malformed point, became a fixed seam; a turn the cell's shape refuses was squashed into it.
"""

from dataclasses import replace
from pathlib import Path

import numpy
import pytest
from hcm_pipeline.jobs import JobContext, Waiting
from hcm_pipeline.placing import assemble, autoplace, autostitch, maps, owner_layout
from hcm_pipeline.placing.autostitch import Proposal
from hcm_pipeline.placing.quality import Quality
from hcm_pipeline.placing.series import SeriesJob
from hcm_pipeline.placing.sheetwork import variant_of
from hcm_pipeline.placing.stitched import JoinQuality
from hcm_pipeline.steps.place import PlaceStep

from tests.fakes.world import PipelineWorld, dig
from tests.synthetic.sheets import Series, SheetsSpec, make_series
from tests.synthetic.town import write_map
from tests.unit.placing_support import staged_series

GRID = SheetsSpec(rows=2, cols=3, overlap=0.06, names="rc", shuffle=False)


def _swapped(series: Series) -> list[tuple[str, Path]]:
    """Every name right, every picture another sheet's (the 1895 quadrants read in the wrong order)."""
    paths = [path for _name, path in series.named]
    return [(name, path) for (name, _path), path in zip(series.named, reversed(paths), strict=True)]


def _noise(series: Series) -> list[tuple[str, Path]]:
    """Every name right, every picture noise: no seam can be measured."""
    rng = numpy.random.default_rng(3)
    for _name, path in series.named:
        write_map(path, numpy.asarray(rng.integers(0, 256, (360, 480, 3)), numpy.uint8), grey=True)
    return list(series.named)


@pytest.mark.parametrize("spoil", [_swapped, _noise], ids=["swapped", "noise"])
def test_bad_path_right_names_whose_seams_say_nothing_are_never_good(tmp_path: Path, spoil: object) -> None:
    """Scenarios: S-P20-BAD-STITCH-NAMES-NO-SEAMS"""
    assert callable(spoil)
    named = spoil(make_series(tmp_path, GRID))

    proposal = autostitch.propose(named)

    assert proposal.grid.source == "name"
    assert proposal.quality.verdict in {"check", "poor"}


def _answer(sheets: list[dict[str, object]], seams: list[dict[str, object]] | None = None) -> owner_layout.Answer:
    return owner_layout.Answer(2, tuple(sheets), tuple(seams or []), False, {})


def _sheet(index: int, row: int, col: int, turn: int = 0, flip: bool = False) -> dict[str, object]:
    return {"index": index, "row": row, "col": col, "turn": turn, "flip": flip}


def test_happy_path_only_the_owners_x_takes_a_sheet_out_and_a_refused_turn_turns_back(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-STITCH-OWNER"""
    series = make_series(tmp_path, GRID)
    sheets = [_sheet(0, 0, 0, turn=90, flip=True), _sheet(1, 0, 1), {**_sheet(2, 0, 2), "out": "not-part"}, _sheet(3, 1, 0)]

    plan = owner_layout.owner_plan(series.named, _answer(sheets))

    # Sheets 4 and 5 were not named (the wizard showed them left out): they keep a reason that still counts, never `not-part`.
    assert plan.out == {2: "not-part", 4: "no-seam", 5: "no-seam"}
    # A quarter turn of an oblong sheet on an oblong cell is refused: the owner's mirror stays, the turn goes back a quarter.
    assert plan.variants[0] == variant_of(0, True)


def test_bad_path_seams_answered_before_a_move_or_with_malformed_points_are_not_fixed(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-STITCH-OWNER-MALFORMED"""
    series = make_series(tmp_path, GRID)
    sheets = [_sheet(0, 0, 0), _sheet(1, 0, 2), _sheet(3, 1, 0), _sheet(4, 1, 1)]
    good = {"a": [470.0, 180.0], "b": [28.0, 180.0]}
    seams = [
        {"a": 0, "b": 1, "side": "right", "points": good},  # sheet 1 moved two cells away: no longer a neighbour
        {"a": 0, "b": 3, "side": "right", "points": good},  # neighbours, but below, not right
        {"a": 3, "b": 4, "side": "right", "points": {"a": [1, "x"], "b": [2, 3]}},  # malformed: never a seam at (0, 0)
        {"a": 0, "b": 3, "side": "below", "points": {"a": [240.0, 350.0], "b": [240.0, 10.0]}},
    ]

    plan = owner_layout.owner_plan(series.named, _answer(sheets, seams))

    assert set(plan.fixed) == {(0, 3)}
    assert plan.fixed[(0, 3)][0] == pytest.approx(0.0, abs=1.0)


def _doubtful(verdict: str) -> object:
    proposed = autoplace.proposed

    def changed(job: JobContext, series: SeriesJob) -> Proposal:
        return replace(proposed(job, series), quality=Quality(60.0, 0.1, 9.0, 0.0, verdict))

    return changed


def _loose(count: int, rms_px: float | None) -> maps.Parts:
    """The older joins placing `count` parts, matched with that residual (None: by their edges alone, nothing measured)."""
    layout = assemble.Layout({index: assemble.IDENTITY for index in range(count)}, (100, 100))
    quality = None if rms_px is None else JoinQuality(count - 1, 30.0, rms_px)
    return maps.Parts(lambda: numpy.full((100, 100), 255, numpy.uint8), layout, quality)


@pytest.mark.parametrize(
    ("verdict", "rms_px"), [("poor", None), ("check", 9.0), ("poor", 9.0)], ids=["poor-edges", "check-loose", "poor-loose"]
)
def test_bad_path_the_older_joins_never_mosaic_unless_something_vouches_for_them(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, verdict: str, rms_px: float | None
) -> None:
    """Scenarios: S-P20-BAD-STITCH-LEGACY-LOOSE"""
    ctx, _staging = staged_series(world, tmp_path, SheetsSpec(rows=2, cols=2, overlap=0.0, names="rc"))
    monkeypatch.setattr(autoplace, "proposed", _doubtful(verdict))
    monkeypatch.setattr(maps, "atlas_parts", lambda sheets: _loose(len(sheets), rms_px))

    assert isinstance(PlaceStep().run(ctx), Waiting)

    assert dig(world.version(), "help", "reason") == autoplace.LAYOUT_CHECK


def test_happy_path_tight_older_joins_or_edges_alone_on_a_check_pass_the_bar() -> None:
    assert maps.legacy_good(_loose(10, 2.0), 10, "poor")
    assert not maps.legacy_good(_loose(10, 2.0), 12, "check")
    assert not maps.legacy_good(replace(_loose(10, 2.0), quality=JoinQuality(9, 5.0, 1.0)), 10, "check")
    assert maps.legacy_good(_loose(10, None), 10, "check")
    assert not maps.legacy_good(_loose(10, None), 10, "poor")


def test_bad_path_a_series_larger_than_the_wizard_can_open_waits_with_no_path(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P20-BAD-STITCH-TOO-MANY"""
    ctx, _staging = staged_series(world, tmp_path, SheetsSpec(rows=1, cols=3, overlap=0.06, names="rc"))
    monkeypatch.setattr(maps, "SHEETS_MAX", 2)

    assert isinstance(PlaceStep().run(ctx), Waiting)

    assert (dig(world.version(), "help", "reason"), dig(world.version(), "help", "note")) == ("no-path", maps.TOO_MANY)
    assert not any(path.endswith("/layout.json") for path in world.gcs.objects)
