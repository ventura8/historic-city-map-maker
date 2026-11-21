"""The city's surface model for the terrain of a frame seen off nadir (docs/research/M15-calibration-accuracy.md, *Terrain*).

`georef` asks for it when it fits a KH-9 panoramic frame (`calibrate/terrain.py`); the frame then carries the cells under its scan
(`georef.terrain.heights`), so nothing that renders or shows it reads the surface again. It is cached in the private bucket by window as
`reference/{city}/dem/{key}.tif` (the key: FNV-1a of the window, the source and the cell), like the other references; a local worker keeps
it on the computer. Without it (a tile cannot be read, or the address is refused: under the emulators every real address is) the frame
is fitted flat, with a warning; a surface missing a tile is never cached.
"""

from pathlib import Path
from typing import Final

from hcm_pipeline import paths
from hcm_pipeline.calibrate.joining import Proved
from hcm_pipeline.calibrate.pairs import Calibrated
from hcm_pipeline.calibrate.terrain import Heights
from hcm_pipeline.geo import MercatorBox, fnv1a
from hcm_pipeline.jobs import JobContext
from hcm_pipeline.steps.common import LOOPBACK_PREFIXES, city_window
from hcm_pipeline.surface import DEM_SOURCE, SURFACE_CELL_GROUND_M, heights_of, tile_names, write_surface
from hcm_pipeline.urlguard import AddressRefusedError, check_data_url, check_emulated_url

FLAT: Final = "the frame is fitted flat"


def _address(ctx: JobContext, href: str) -> str:
    if ctx.config.emulated:
        return check_emulated_url(href)
    return check_data_url(href, ctx.config.dem_url.startswith(LOOPBACK_PREFIXES), ctx.services.resolver)


def _fetched(ctx: JobContext, window: MercatorBox, local: Path) -> Heights | None:
    try:
        sources = [f"/vsicurl/{_address(ctx, f'{ctx.config.dem_url}/{name}')}" for name in tile_names(window.bounds())]
        heights = write_surface(sources, window, local)
    except (AddressRefusedError, RuntimeError) as error:
        ctx.checkpoint()
        ctx.log.warn(f"no surface model ({error}): {FLAT}")
        return None
    if heights is None:
        ctx.log.warn(f"a Copernicus DEM tile over the city could not be read, or the window is too small: {FLAT}")
    return heights


def surface_key(window: MercatorBox) -> str:
    """The cached surface's key: its window, its source and its cell."""
    return fnv1a(f"{window.key()}|{DEM_SOURCE}|{SURFACE_CELL_GROUND_M:g}")


def city_heights(ctx: JobContext) -> Heights | None:
    """The city window's surface model: from the cache, else from the GLO-30 tiles (published to the cache); None without one."""
    window = city_window(ctx)
    object_path = paths.reference(ctx.city, "dem", surface_key(window))
    local = ctx.local("surface.tif")
    if ctx.services.objects.stat(object_path) is not None:
        ctx.services.objects.download_file(object_path, local)
        return heights_of(local)
    heights = _fetched(ctx, window, local)
    if heights is not None:
        ctx.publish(local, object_path, "image/tiff")
    return heights


def terrain_summary(found: Calibrated, proved: Proved) -> str:
    """The job log's line on the terrain."""
    if found.terrain is not None:
        return f"fitted over the terrain (Copernicus DEM GLO-30): {found.terrain.relief_m:.1f} m of relief beyond a second-order fit"
    if proved.heights is None:
        return "fitted flat: no surface model, or no panoramic camera"
    return "fitted flat: the terrain its tiles show is negligible, or its camera does not hold"
