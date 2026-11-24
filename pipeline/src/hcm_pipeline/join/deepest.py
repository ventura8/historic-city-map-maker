"""How deep an archive join is drawn (2026-11-24): as deep as its parts' originals hold, not the zoom the parts were published at.

An archive join's `maxzoom` is the largest its parts were published at (`functions/src/imagery/join-archive.ts`), and the merge warps
each part from its original (`join/warping.py`). A part's original measured through its own points (Mercator metres a scan pixel, the
pairs farthest apart) gives the zoom of about two scan pixels an output pixel (`encoding.scan_zoom`, at most 20); the join takes the
median of its parts', lowered until the window's tiles fit the series' byte budget, never under the zoom it was asked. The originals'
copies made to measure are deleted at once; the merge stages them again as it warps.
"""

import math
import statistics
from collections.abc import Sequence

from hcm_pipeline.archive import encoding
from hcm_pipeline.geo import MercatorBox, to_lnglat, to_mercator
from hcm_pipeline.georef.transforms import Gcp, enabled_gcps
from hcm_pipeline.jobs import JobContext
from hcm_pipeline.join.correction import Node
from hcm_pipeline.join.plan import Part
from hcm_pipeline.join.warping import Warper
from hcm_pipeline.steps.warp import scan_size

MIN_PAIRS = 2


def metres_per_px(gcps: Sequence[Gcp]) -> float | None:
    """Mercator metres a scan pixel between the first enabled pair and the one farthest from it in pixels, else None."""
    pairs = enabled_gcps(gcps)
    if len(pairs) < MIN_PAIRS:
        return None
    first = pairs[0]
    far = max(pairs[1:], key=lambda gcp: math.hypot(gcp.x - first.x, gcp.y - first.y))
    pixels = math.hypot(far.x - first.x, far.y - first.y)
    metres = math.dist(to_mercator(first.lng, first.lat), to_mercator(far.lng, far.lat))
    return metres / pixels if pixels > 0 else None


def _measured(warper: Warper, part: Part, nodes: Sequence[Node]) -> tuple[float, float] | None:
    """The part's original: its Mercator metres a pixel and the Mercator area it covers, else None."""
    sharpest = warper.full(part, nodes)
    metres = metres_per_px(sharpest.georef.gcps) if sharpest.original else None
    width, height = scan_size(sharpest.picture)
    warper.done_with(part, sharpest)
    return None if metres is None else (metres, width * height * metres**2)


def _within_budget(metres: float, area_m2: float, box: MercatorBox) -> int:
    """`encoding.scan_zoom` of `metres`, lowered until the tiles of `area_m2` (Mercator) fit the byte budget."""
    latitude = to_lnglat(0.0, (box.bottom + box.top) / 2)[1]
    ground_m2 = area_m2 * math.cos(math.radians(latitude)) ** 2
    return encoding.estimate(ground_m2, encoding.scan_zoom(metres), "grey", 0, latitude).maxzoom


def deepest_zoom(ctx: JobContext, warper: Warper, parts: Sequence[tuple[Part, Sequence[Node]]], box: MercatorBox, asked: int) -> int:
    """The join's zoom from its parts' originals, within the byte budget for the ground they cover (never more than `box`), never
    under `asked`."""
    found = [measured for part, nodes in parts if (measured := _measured(warper, part, nodes)) is not None]
    if not found:
        return asked
    metres = statistics.median(m for m, _area in found)
    zoom = max(_within_budget(metres, min(sum(area for _m, area in found), box.width * box.height), box), asked)
    ctx.log.info(f"the parts' originals are {metres:.3f} m a pixel: joined to zoom {zoom}", ctx.step)
    return zoom
