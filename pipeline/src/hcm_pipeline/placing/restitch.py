"""A placed series laid on its overview again, the owner's pairs kept (docs/research/M20-import-local.md §15, DECISIONS-for-review.md §216).

`imagery.locateAgain` on a published (or waiting) archive series that was placed from the owner's pairs on its overview mosaic, with
pieces left out of that mosaic, starts a new version of the same layer whose job asks `restitch` (`functions/src/imagery/restitch.ts`).
Its `place` lays the series on the overview again (the second pass in the holes included: `overview_holes`), keeps the new mosaic as
the job's `stitched.tif` and publishes it as the version's stitched picture and scan, then warps it through the base's pairs
(`owner.place_from_pairs`). The pairs still hold: an overview mosaic's frame is the overview's own, resized, so a pixel of the base's
scan and the same pixel of the new one name the same overview pixel (`owner.picture_of` scales the pairs by the two sizes). When the
overview places the series no more (its file gone from this computer, too few pieces matching), the series waits for points again on
the base's picture.
"""

from typing import Final

from hcm_pipeline.jobs import JobContext
from hcm_pipeline.placing import assemble
from hcm_pipeline.placing.maps import CANVAS, overview_mosaic, paged
from hcm_pipeline.placing.series import series_of
from hcm_pipeline.placing.stitched import publish_stitched

RESTITCH: Final = "restitch"
NO_OVERVIEW: Final = "The overview no longer places this series' pieces: add about four points on the picture, or import it again."


def asked(ctx: JobContext) -> bool:
    """The job lays its series on the overview again before the owner's pairs are applied."""
    return ctx.job.params.get(RESTITCH) is True


def restitched(ctx: JobContext) -> bool:
    """The series on its overview again, kept as `stitched.tif` and published with the version; False when the overview does not
    place it."""
    series = paged(ctx, series_of(ctx))
    made = None if isinstance(series, str) else overview_mosaic(ctx, series)
    if made is None:
        return False
    path = assemble.write_canvas(ctx.local(CANVAS), made.canvas)
    ctx.update_version({"help.stitched": publish_stitched(ctx, made.stitched(), path)})
    ctx.log.info(f"laid on the overview again: {len(made.layout.placed)} of {len(made.names)} parts", ctx.step)
    return True
