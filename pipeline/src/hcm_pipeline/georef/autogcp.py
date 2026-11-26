"""Automatic GCP suggestions: what the matcher's pairs become (docs/research/M4-interfaces.md §2.2-§2.4).

The constants are the Python twins of `packages/shared/src/schemas/autogcp.ts`; `pipeline/tests/contracts/autogcp.json`
holds the agreed values and `pipeline/tests/unit/test_autogcp.py` keeps this module equal to it.

A pair at or above `AUTO_GCP_MIN_CONFIDENCE` joins the fit on its own; with at least `CHECKPOINT_MIN_PAIRS` of them, a
fifth (at least three), every fifth in cell order so they spread, is held out (`enabled: false`) as true checkpoints.
With at least `MIN_GCPS['poly2']` confident pairs the version gets its `georef` (`poly2` from 12 well-spread enabled
pairs, else `affine`) and the pairs between `AUTO_GCP_SUGGEST_MIN` and the confidence become its `suggestions`, each
with how far that fit puts its pixel from its place; with fewer, or with enough that lie almost in a line (one road:
`degenerate`, no fit), every candidate from `AUTO_GCP_SUGGEST_MIN` is a suggestion (the confident ones too) and the
version waits for the admin. Suggestions are never part of a fit: only
the admin's Accept and Save (`imagery.saveGcps`) put them into a georeference.
"""

from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import Final

import numpy

from hcm_pipeline.contract import MIN_GCPS
from hcm_pipeline.georef.transforms import Fit, Gcp, enabled_gcps, fit, residuals_m, spread_share
from hcm_pipeline.model import Record, Timestamp

AUTO_GCP_METHODS: Final = ("sift", "orb", "junctions")
MATCH_CHANNELS: Final = ("s2", "osm")
AUTO_GCP_MIN_CONFIDENCE: Final = 0.6
AUTO_GCP_SUGGEST_MIN: Final = 0.3
AUTO_GCP_CHECKPOINT_SHARE: Final = 0.2
CHECKPOINT_MIN_PAIRS: Final = 15
MAX_SUGGESTIONS: Final = 100
AUTO_GCP_TILE_PX: Final = 256
# The fewest checkpoints held out (the approval policy's minimum, M3 §7.1).
MIN_CHECKPOINTS: Final = 3
MIN_POLY2_PAIRS: Final = 12
WELL_SPREAD: Final = 0.25
ID_DIGITS: Final = 3


@dataclass(frozen=True)
class AutoPair:
    """One pair the matcher kept: the GCP (its `score` the confidence), the grid cell it came from and its channel."""

    gcp: Gcp
    cell: int
    channel: str


@dataclass(frozen=True)
class GcpSuggestions:
    """`layerVersion.suggestions` (`gcpSuggestionsSchema` of `@hcm/shared`)."""

    method: str
    channels: tuple[str, ...]
    generated_at: Timestamp
    tiles: tuple[int, int]
    pairs: tuple[Gcp, ...]
    min_confidence: float = AUTO_GCP_MIN_CONFIDENCE

    def as_record(self) -> Record:
        matched, total = self.tiles
        return {
            "method": self.method,
            "channels": list(self.channels),
            "generatedAt": self.generated_at,
            "minConfidence": self.min_confidence,
            "tiles": {"matched": matched, "total": total},
            "pairs": [pair.as_record() for pair in self.pairs],
        }


@dataclass(frozen=True)
class Decision:
    """What the pairs give: the fit (None when the confident pairs are too few or lie in a line) and the suggestions."""

    fitted: Fit | None
    suggestions: tuple[Gcp, ...]
    confident: int
    # Enough confident pairs, but no fit: they lie almost in a line (`apiError.imagery.noSpread`, not `noMatch`).
    degenerate: bool = False


def confidence_of(gcp: Gcp) -> float:
    return gcp.score or 0.0


def ranked(pairs: Sequence[AutoPair]) -> list[AutoPair]:
    """The pairs best first (ties by cell, then the pixel), each named `a001`, `a002`, ... in that order."""
    order = sorted(pairs, key=lambda pair: (-confidence_of(pair.gcp), pair.cell, pair.gcp.x, pair.gcp.y))
    return [replace(pair, gcp=replace(pair.gcp, id=f"a{index:0{ID_DIGITS}d}")) for index, pair in enumerate(order, start=1)]


def checkpoint_count(confident: int) -> int:
    """How many confident pairs are held out: a fifth, at least three, none below `CHECKPOINT_MIN_PAIRS`."""
    if confident < CHECKPOINT_MIN_PAIRS:
        return 0
    return max(MIN_CHECKPOINTS, int(confident * AUTO_GCP_CHECKPOINT_SHARE))


def held_out(confident: Sequence[AutoPair]) -> list[Gcp]:
    """The confident pairs with every fifth in cell order kept as a checkpoint (`enabled: false`)."""
    count = checkpoint_count(len(confident))
    by_cell = sorted(confident, key=lambda pair: (pair.cell, pair.gcp.id))
    picked = {by_cell[(index + 1) * len(by_cell) // count - 1].gcp.id for index in range(count)} if count else set()
    return [replace(pair.gcp, enabled=pair.gcp.id not in picked) for pair in confident]


def _spread(gcps: Sequence[Gcp]) -> float:
    return spread_share(numpy.array([gcp.x for gcp in gcps]), numpy.array([gcp.y for gcp in gcps])) if gcps else 0.0


def transform_kind(gcps: Sequence[Gcp]) -> str | None:
    """`poly2` from 12 well-spread enabled pairs, `affine` from 6, None below (the thin-plate spline is never chosen here)."""
    enabled = enabled_gcps(gcps)
    if len(enabled) >= MIN_POLY2_PAIRS and _spread(enabled) >= WELL_SPREAD:
        return "poly2"
    return "affine" if len(enabled) >= MIN_GCPS["poly2"] else None


def fitted_pairs(confident: Sequence[AutoPair]) -> Fit | None:
    """The fit of the confident pairs with their checkpoints held out; None when too few or degenerate."""
    gcps = held_out(confident)
    kind = transform_kind(gcps)
    result = fit(kind, gcps) if kind is not None else None
    return result if isinstance(result, Fit) else None


def _with_residuals(suggestions: Sequence[Gcp], fitted: Fit) -> tuple[Gcp, ...]:
    if not suggestions:
        return ()
    found = residuals_m(fitted.transform, suggestions).tolist()
    return tuple(replace(gcp, residual_m=float(value)) for gcp, value in zip(suggestions, found, strict=True))


def _suggested(pairs: Sequence[AutoPair], top: float) -> list[Gcp]:
    """The pairs from `AUTO_GCP_SUGGEST_MIN` up to (not including) `top`, best first, at most `MAX_SUGGESTIONS`."""
    return [pair.gcp for pair in pairs if AUTO_GCP_SUGGEST_MIN <= confidence_of(pair.gcp) < top][:MAX_SUGGESTIONS]


def decide(pairs: Sequence[AutoPair]) -> Decision:
    """The georeference and the suggestions the matcher's pairs give (§2.3)."""
    order = ranked(pairs)
    confident = [pair for pair in order if confidence_of(pair.gcp) >= AUTO_GCP_MIN_CONFIDENCE]
    enough = len(confident) >= MIN_GCPS["poly2"]
    fitted = fitted_pairs(confident) if enough else None
    if fitted is None:
        return Decision(None, tuple(_suggested(order, float("inf"))), len(confident), degenerate=enough)
    return Decision(fitted, _with_residuals(_suggested(order, AUTO_GCP_MIN_CONFIDENCE), fitted), len(confident))
