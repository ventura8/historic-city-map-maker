"""What the matcher's pairs become (docs/research/M4-interfaces.md §2.2-§2.4): the contract's constants and golden record,
the confident pairs and their checkpoints, the suggestions and their residuals."""

import math

import pytest
from hcm_pipeline.georef import autogcp
from hcm_pipeline.georef.autogcp import (
    AutoPair,
    GcpSuggestions,
    checkpoint_count,
    decide,
    held_out,
    ranked,
    transform_kind,
)
from hcm_pipeline.georef.transforms import Gcp
from hcm_pipeline.model import Timestamp

from tests.contracts_loader import gcp_of, golden, record, records, stored

CONSTANTS = golden("autogcp.json")
CENTRE = (44.43, 26.10)
# Metres per degree near Bucharest, enough for an exact synthetic affine map.
LAT_M, LNG_M = 111_000.0, 79_400.0


def place(x: float, y: float) -> tuple[float, float]:
    """The exact map of these tests: 6 m pixels, north up, the scan's origin at the centre."""
    return CENTRE[0] - y * 6 / LAT_M, CENTRE[1] + x * 6 / LNG_M


def pair(index: int, score: float, x: float, y: float, cell: int | None = None) -> AutoPair:
    lat, lng = place(x, y)
    return AutoPair(Gcp(f"t{index}", x, y, lat, lng, True, "auto", score), index if cell is None else cell, "s2")


def grid_pairs(count: int, score: float) -> list[AutoPair]:
    """`count` pairs spread over a 1000 x 800 scan, one per cell, exactly on the map."""
    return [pair(index, score, 40 + (index % 8) * 120 + index, 30 + (index // 8) * 95) for index in range(count)]


def test_happy_path_the_constants_equal_the_shared_copy() -> None:
    assert {key: value for key, value in CONSTANTS.items() if key != "comment"} == {
        "AUTO_GCP_METHODS": list(autogcp.AUTO_GCP_METHODS),
        "MATCH_CHANNELS": list(autogcp.MATCH_CHANNELS),
        "AUTO_GCP_MIN_CONFIDENCE": autogcp.AUTO_GCP_MIN_CONFIDENCE,
        "AUTO_GCP_SUGGEST_MIN": autogcp.AUTO_GCP_SUGGEST_MIN,
        "AUTO_GCP_CHECKPOINT_SHARE": autogcp.AUTO_GCP_CHECKPOINT_SHARE,
        "CHECKPOINT_MIN_PAIRS": autogcp.CHECKPOINT_MIN_PAIRS,
        "MAX_SUGGESTIONS": autogcp.MAX_SUGGESTIONS,
        "AUTO_GCP_TILE_PX": autogcp.AUTO_GCP_TILE_PX,
    }


def test_happy_path_the_suggestions_record_equals_the_golden_document() -> None:
    expected = record(stored("version.needs-gcps.suggestions.json")["suggestions"])
    tiles = record(expected["tiles"])
    suggestions = GcpSuggestions(
        method=str(expected["method"]),
        channels=tuple(str(channel) for channel in records_of(expected["channels"])),
        generated_at=timestamp(expected["generatedAt"]),
        tiles=(int(str(tiles["matched"])), int(str(tiles["total"]))),
        pairs=tuple(gcp_of(item) for item in records(expected["pairs"])),
        min_confidence=float(str(expected["minConfidence"])),
    )

    assert suggestions.as_record() == expected


def timestamp(value: object) -> Timestamp:
    assert isinstance(value, Timestamp)
    return value


def records_of(value: object) -> list[object]:
    assert isinstance(value, list)
    return value


def test_happy_path_pairs_are_named_best_first() -> None:
    order = ranked([pair(1, 0.4, 10, 10), pair(2, 0.9, 20, 20), pair(3, 0.4, 5, 5, cell=0)])

    assert [(item.gcp.id, item.gcp.score) for item in order] == [("a001", 0.9), ("a002", 0.4), ("a003", 0.4)]
    assert order[1].cell == 0


@pytest.mark.parametrize(("confident", "held"), [(6, 0), (14, 0), (15, 3), (19, 3), (20, 4), (64, 12)])
def test_happy_path_a_fifth_of_the_confident_pairs_are_checkpoints_from_fifteen(confident: int, held: int) -> None:
    assert checkpoint_count(confident) == held
    assert sum(not gcp.enabled for gcp in held_out(grid_pairs(confident, 0.9))) == held


def test_happy_path_checkpoints_are_every_fifth_in_cell_order() -> None:
    pairs = ranked(grid_pairs(15, 0.9))

    kept = held_out(pairs)

    assert [index for index, gcp in enumerate(sorted(kept, key=lambda gcp: gcp.x + 1000 * gcp.y)) if not gcp.enabled] == [4, 9, 14]


def test_happy_path_the_transform_follows_the_enabled_pairs_and_their_spread() -> None:
    spread = [item.gcp for item in grid_pairs(16, 0.9)]
    line = [Gcp(f"g{index}", index * 10.0, index * 10.0, 44.4, 26.1) for index in range(12)]

    assert transform_kind(spread) == "poly2"
    assert transform_kind(line) == "affine"
    assert transform_kind(spread[:5]) is None
    assert transform_kind([]) is None


def test_happy_path_six_confident_pairs_fit_and_the_weaker_ones_become_suggestions_with_residuals() -> None:
    pairs = [*grid_pairs(20, 0.8), pair(30, 0.5, 500, 400), pair(31, 0.35, 700, 100), pair(32, 0.1, 300, 300)]

    decision = decide(pairs)

    assert decision.fitted is not None
    assert decision.confident == 20
    assert decision.fitted.checkpoint_count == 4
    assert decision.fitted.transform.kind == "poly2"
    assert [(gcp.id, gcp.score) for gcp in decision.suggestions] == [("a021", 0.5), ("a022", 0.35)]
    assert all(gcp.residual_m is not None and gcp.residual_m < 0.01 for gcp in decision.suggestions)
    assert math.isclose(decision.fitted.checkpoint_rmse_m or 0.0, 0.0, abs_tol=0.01)


def test_bad_path_fewer_than_six_confident_pairs_suggest_every_candidate_without_residuals() -> None:
    pairs = [*grid_pairs(4, 0.7), pair(10, 0.45, 500, 400), pair(11, 0.2, 100, 700)]

    decision = decide(pairs)

    assert decision.fitted is None
    assert decision.confident == 4
    assert decision.degenerate is False
    assert [gcp.score for gcp in decision.suggestions] == [0.7, 0.7, 0.7, 0.7, 0.45]
    assert all(gcp.residual_m is None for gcp in decision.suggestions)


def test_bad_path_confident_pairs_on_one_line_are_no_fit() -> None:
    pairs = [pair(index, 0.9, index * 50.0, index * 50.0) for index in range(8)]

    decision = decide(pairs)

    assert decision.fitted is None
    # Eight confident pairs are not too few: they lie in a line, which the version says apart (`noSpread`).
    assert (decision.confident, decision.degenerate) == (8, True)
    assert len(decision.suggestions) == 8


def test_happy_path_no_weaker_pair_means_no_suggestion() -> None:
    decision = decide(grid_pairs(10, 0.95))

    assert decision.fitted is not None
    assert decision.suggestions == ()


def test_bad_path_at_most_the_suggestion_cap_is_kept() -> None:
    weak = [pair(index, 0.4, (index % 30) * 30.0, (index // 30) * 30.0) for index in range(autogcp.MAX_SUGGESTIONS + 20)]

    decision = decide(weak)

    assert len(decision.suggestions) == autogcp.MAX_SUGGESTIONS
