"""An atlas's pages or overlapping pieces laid out on their own (docs/research/M20-import-local.md §19), against synthetic series.

The targets of §19.9: every sheet placed of a named or ordered series whose neighbours overlap by 3 % or more, every page of a named
atlas whose pages abut, a seam error (where a sheet lies from its neighbour, against the answer) of at most 1.5 px at the median and 3 px
at the 95th percentile, no foreign sheet ever placed, and a series of noise judged `poor`.
"""

from pathlib import Path

import numpy
import pytest
from hcm_pipeline.placing import assemble, autostitch, joins, maps

from tests.synthetic.sheets import Series, SheetsSpec, make_series, seam_errors


def _laid(tmp_path: Path, spec: SheetsSpec) -> tuple[Series, autostitch.Proposal, list[float]]:
    series = make_series(tmp_path, spec)
    proposal = autostitch.propose(series.named)
    names = [name for name, _path in series.named]
    errors = seam_errors(series, [(names[index], place) for index, place in proposal.solved.positions.items()])
    return series, proposal, errors


def _placed(series: Series, proposal: autostitch.Proposal) -> tuple[int, int, int]:
    """(real sheets placed, real sheets, foreign sheets placed)."""
    names = [name for name, _path in series.named]
    foreign = sum(series.truth[names[index]].foreign for index in proposal.solved.positions)
    real = sum(not truth.foreign for truth in series.truth.values())
    return len(proposal.solved.positions) - foreign, real, foreign


def _accurate(errors: list[float]) -> bool:
    return bool(errors) and float(numpy.median(errors)) <= 1.5 and float(numpy.percentile(errors, 95)) <= 3.0


@pytest.mark.parametrize(
    "spec",
    [
        SheetsSpec(overlap=0.06, names="rc"),
        SheetsSpec(overlap=0.06, names="pair", style="lineart"),
        SheetsSpec(rows=4, cols=4, overlap=0.06, names="quadrant", style="colour"),
        SheetsSpec(overlap=0.15, names="folders"),
        SheetsSpec(overlap=0.06, names="rc", margin_px=30, frame=True),
        SheetsSpec(overlap=0.06, names="rc", scale_jitter=0.05),
    ],
    ids=["rc", "lineart", "colour-quadrants", "folders", "margins-frames", "scale"],
)
def test_happy_path_a_named_series_is_placed_whole_and_true(tmp_path: Path, spec: SheetsSpec) -> None:
    """Scenarios: S-P20-HAPPY-STITCH-NAMES"""
    series, proposal, errors = _laid(tmp_path, spec)

    assert _placed(series, proposal) == (spec.rows * spec.cols, spec.rows * spec.cols, 0)
    assert proposal.grid.source == "name"
    assert _accurate(errors)
    assert proposal.quality.verdict == "good"


@pytest.mark.parametrize("names", ["img", "page"])
def test_happy_path_names_in_order_alone_get_their_columns_from_the_seams(tmp_path: Path, names: str) -> None:
    """Scenarios: S-P20-HAPPY-STITCH-SEAMS"""
    spec = SheetsSpec(overlap=0.03, names=names, rows=3, cols=4)

    series, proposal, errors = _laid(tmp_path, spec)

    assert proposal.grid.source == "order"
    assert proposal.grid.cols == 4
    assert _placed(series, proposal) == (12, 12, 0)
    assert _accurate(errors)


def test_happy_path_turned_and_mirrored_sheets_are_turned_back(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-STITCH-TURNED"""
    spec = SheetsSpec(overlap=0.10, names="letter", turned=3)

    series, proposal, errors = _laid(tmp_path, spec)

    names = [name for name, _path in series.named]
    assert {names[index]: variant for index, variant in proposal.plan.variants.items() if variant} == {
        name: truth.variant for name, truth in series.truth.items() if truth.variant
    }
    assert _placed(series, proposal) == (12, 12, 0)
    assert _accurate(errors)


@pytest.mark.parametrize("spec", [SheetsSpec(overlap=0.0, names="rc"), SheetsSpec(overlap=0.0, names="page", margin_px=25, frame=True)])
def test_happy_path_an_atlas_whose_pages_abut_is_placed_whole(tmp_path: Path, spec: SheetsSpec) -> None:
    """Scenarios: S-P20-HAPPY-STITCH-ABUTTING"""
    series, proposal, errors = _laid(tmp_path, spec)

    assert _placed(series, proposal) == (12, 12, 0)
    assert _accurate(errors)
    assert proposal.quality.verdict == "good"


def test_bad_path_foreign_and_missing_sheets_are_never_placed(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-STITCH-FOREIGN-SHEET"""
    spec = SheetsSpec(rows=4, cols=5, overlap=0.06, names="rc", missing=2, foreign=1)

    series, proposal, errors = _laid(tmp_path, spec)

    assert _placed(series, proposal) == (18, 18, 0)
    assert "no-join" in proposal.left_out.values()
    assert _accurate(errors)


def test_bad_path_a_foreign_sheet_numbered_with_the_pages_is_left_out(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-STITCH-FOREIGN-SHEET"""
    spec = SheetsSpec(rows=2, cols=4, overlap=0.06, names="img", foreign=1)

    series, proposal, _errors = _laid(tmp_path, spec)

    assert _placed(series, proposal)[2] == 0


def test_bad_path_noise_is_judged_poor_and_never_mosaicked(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-STITCH-GARBAGE-WAITS"""
    spec = SheetsSpec(rows=1, cols=2, overlap=0.06, names="img", noise=8)

    _series, proposal, _errors = _laid(tmp_path, spec)

    assert proposal.quality.verdict == "poor"


def test_happy_path_a_layout_is_cut_into_tiles_within_the_canvas_limit(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-STITCH-WINDOWED"""
    series = make_series(tmp_path, SheetsSpec(rows=1, cols=2, overlap=0.1, names="rc", out_px=2000))
    proposal = autostitch.propose(series.named)

    tiles, size = proposal.tiles(longest=1500)

    assert max(size) <= 1500
    assert len(tiles) == 2
    assert all(tile.width <= 1500 for _index, tile in tiles)
    assert autostitch.tiles_of(proposal.plan, {}, 100) == ([], (1, 1))


def test_bad_path_the_older_joins_leave_an_overlapping_named_series_unfinished(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-STITCH-NAMES"""
    # Why §19 exists: the edges and the overlaps of M20 §6 placed 1-6 of these 12 sheets; the layout places all 12.
    series = make_series(tmp_path, SheetsSpec(overlap=0.06, names="rc"))
    paths = [path for _name, path in series.named]
    pages = assemble.Pages.read(paths, maps.page_px(len(paths)))
    cell = (int(numpy.median([page.shape[1] for page in pages.grey])), int(numpy.median([page.shape[0] for page in pages.grey])))
    found = joins.joined(paths)

    by_edges = len(assemble.atlas_layout(pages.grey, cell).placed)
    by_overlaps = 0 if found is None else len(found.layout.placed)

    assert max(by_edges, by_overlaps) < len(paths)
    assert len(autostitch.propose(series.named).solved.positions) == len(paths)
