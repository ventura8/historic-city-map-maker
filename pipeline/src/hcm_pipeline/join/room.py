"""Whether a join's files fit the scratch folder (docs/research/M8-join-interfaces.md §3, §4).

`align` holds two scans at once, those of the seam it measures. `merge` holds one scan, each part warped and the mosaic. Each step
checks what it needs before it fetches anything, `merge` too: a run resumed there may find a fuller disk. Compression only ever helps,
so a warped part counts a byte a pixel.
"""

import errno
import shutil
from collections.abc import Sequence

from hcm_pipeline.contract import Errors
from hcm_pipeline.geo import MercatorBox, zoom_resolution
from hcm_pipeline.jobs import JobContext, StepFailedError
from hcm_pipeline.join.plan import Part
from hcm_pipeline.model import JoinParams

SCANS_AT_ONCE = 2


def scan_sizes(ctx: JobContext, parts: Sequence[Part]) -> list[int]:
    """The size of every part's scan; one no longer stored ends the job."""
    sizes = []
    for part in parts:
        info = ctx.services.objects.stat(part.scan.path)
        if info is None:
            raise StepFailedError(Errors.JOIN_PART_MISSING, f"the scan of {part.entity_id} is gone", {"frame": part.entity_id})
        sizes.append(info.size)
    return sizes


def window_px(ctx: JobContext, box: MercatorBox) -> int:
    """The window's pixels at the camera's zoom."""
    maxzoom = JoinParams.of(ctx.job.params).maxzoom
    return round(box.width * box.height / zoom_resolution(maxzoom) ** 2)


def needed_to_merge(sizes: Sequence[int], window: int) -> int:
    return max(sizes) + window * (len(sizes) + 1)


def needed_to_align(sizes: Sequence[int], window: int) -> int:
    """A seam's two scans, and what `merge` will need: a run that cannot finish fails before it downloads anything."""
    return max(sum(sorted(sizes)[-SCANS_AT_ONCE:]), needed_to_merge(sizes, window))


def require_room(ctx: JobContext, needed: int) -> None:
    free = shutil.disk_usage(ctx.workdir).free
    if free < needed:
        raise StepFailedError(Errors.JOIN_NO_ROOM, f"{needed} bytes needed for this join, {free} free")


def out_of_room(frame: str, error: OSError) -> Exception:
    """A disk that filled up while a scan came in is `joinNoRoom`: free some and retry. Any other failure stays what it is."""
    if error.errno == errno.ENOSPC:
        return StepFailedError(Errors.JOIN_NO_ROOM, f"the disk filled up fetching the scan of {frame}")
    return error
