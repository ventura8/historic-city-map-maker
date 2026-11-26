"""`place`: an archive series placed on the map by the path of its class (docs/research/M20-import-local.md §3, §4).

Each class has its placer (`PLACERS`: the georeferenced read, the grid solve, the atlas, the pieces, the drawn-map match), which writes the
series' `warped.tif` and the version's `archive` report and answers `Done`; `export`, `pyramid` and `register` then run as for any layer.
A class with no placer yet, or a placer that cannot prove a placement, never fails the job: the version waits for a person
(`needs_gcps`) with one line saying why (`help`: the owner's standing rule of 2026-11-09, the shared "Help calibrate" queue), and the job
waits for points (`awaiting_gcps`). A low-confidence placer leaves its correspondences as suggested pairs first. Once the owner saved
pairs on the parked series (`imagery.saveGcps`: the version's `georef`, `method: 'gcps'`), `place` warps it through them
(`placing/owner.py`) and never runs the class's placer again: it only parked the series once more (2026-11-10). A series stitched
again (`restitch` in its job's parameters, DECISIONS §216) is first laid on its overview again (`placing/restitch.py`). **Fix the tiles**
(`relayout`, M20 §19.13, `functions/src/imagery/relayout.ts`) lays a placed series out again from its sheets, whatever its class, and
waits for its owner in the tile wizard (`layout-check`), with the owner's earlier layout as its first preview when it had one.
"""

from collections.abc import Mapping
from typing import Final, Protocol

from hcm_pipeline.documents import GeorefInfo
from hcm_pipeline.jobs import JobContext, StepResult
from hcm_pipeline.placing import autoplace, owner_layout, restitch
from hcm_pipeline.placing.embedded import EmbeddedPlacer
from hcm_pipeline.placing.grid import GridPlacer
from hcm_pipeline.placing.maps import AtlasPlacer, PiecesPlacer, SinglePlacer, paged
from hcm_pipeline.placing.output import wait_for_help
from hcm_pipeline.placing.owner import owner_pairs, place_from_pairs
from hcm_pipeline.placing.series import series_of
from hcm_pipeline.steps.gather import text_param

RELAYOUT: Final = "relayout"
NO_PATH_NOTE: Final = "No automatic placement for this kind of series yet: add about four points, or wait for an update."


class Placer(Protocol):
    """One class's path: it places the series or parks it with `wait_for_help`."""

    def place(self, ctx: JobContext) -> StepResult: ...


# The paths of §3, by series class (`placing/`): a georeferenced file, a grid series, an atlas, pieces and a single drawn map. A CAD
# drawing never becomes a series (it is skipped at the scan: it needs an export from CAD in v1).
PLACERS: dict[str, Placer] = {
    "georeferenced": EmbeddedPlacer(),
    "grid": GridPlacer(),
    "atlas": AtlasPlacer(),
    "pieces": PiecesPlacer(),
    "single": SinglePlacer(),
}


class PlaceStep:
    name = "place"

    def __init__(self, placers: Mapping[str, Placer] | None = None) -> None:
        self._placers = PLACERS if placers is None else placers

    def run(self, ctx: JobContext) -> StepResult:
        # The owner's saved pairs come first, even on a series once sent to Fix the tiles (`relayout` stays in its params): the
        # plan cadastral 1911-1914's 17 pairs were laid aside for its tile layout again, which waited as before (lesson of 2026-11-24).
        pairs = owner_pairs(ctx.version.georef)
        if pairs is not None:
            return self._from_pairs(ctx, pairs)
        if ctx.job.params.get(RELAYOUT) is True:
            return relaid(ctx)
        placer = self._placers.get(text_param(ctx.job.params, "class"))
        if placer is None:
            return wait_for_help(ctx, "no-path", NO_PATH_NOTE)
        return placer.place(ctx)

    @staticmethod
    def _from_pairs(ctx: JobContext, pairs: GeorefInfo) -> StepResult:
        """The owner's pairs; a series stitched again (`restitch`) is laid on its overview first, or waits when it no longer lands."""
        if restitch.asked(ctx) and not restitch.restitched(ctx):
            return wait_for_help(ctx, "low-confidence", restitch.NO_OVERVIEW)
        return place_from_pairs(ctx, pairs)


def relaid(ctx: JobContext) -> StepResult:
    """Fix the tiles: the owner's layout (their earlier one is seeded as a preview, their next answer mosaics it), else the automatic
    proposal kept for their check; never mosaicked before they answered."""
    series = paged(ctx, series_of(ctx))
    if isinstance(series, str):
        return wait_for_help(ctx, "low-confidence", series)
    answer = owner_layout.answer_of(ctx)
    if answer is not None:
        return owner_layout.place(ctx, series, answer, "atlas")
    return autoplace.wait_layout(ctx, series, autoplace.proposed(ctx, series))
