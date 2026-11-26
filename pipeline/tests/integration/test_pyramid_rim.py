"""The film's dark rim cut from a layer's alpha (`tiles/rim.py`, docs/research/M12-own-tiles.md -> *The dark rim*): real GDAL, real tiles.

A synthetic warped frame like 1980's KH-9: a diagonal edge, an 8-pixel black rim inside it under an opaque alpha, a black building deep
inside, and a dark street that runs from the edge far into the frame; a second one whose rim fades in over 100 ground metres, with a
dark river just past the fade; and a crop of the live 1980 tile 13/4689/2965, rim and fade as Mapbox drew them before the cut. The
tiles' alpha loses the rim and its fade and keeps the rest, and the view keeps the COG's overviews.
"""

from pathlib import Path

import numpy
import pytest
from hcm_pipeline.geo import ZOOM0_RESOLUTION_M, ground_scale, to_lnglat, to_mercator
from hcm_pipeline.images import UInt8Array, as_uint8
from hcm_pipeline.raster import gdal, osr
from hcm_pipeline.rasters import driver_of
from hcm_pipeline.runner import RunOutcome
from hcm_pipeline.steps.export import Warped, write_cog
from hcm_pipeline.steps.pyramid import rgba_view, write_thumb
from hcm_pipeline.tiles.rim import RIM_MAX_GROUND_M, RIM_PREVIEW_MAX_PX, preview_factor, rim_cut, scene_level
from numpy.typing import NDArray

from tests.fakes.world import PipelineWorld
from tests.integration.tiling import FILES, run_tiles_job, seed_old_version
from tests.integration.tiling import ZOOM as TILING_ZOOM
from tests.unit.pmtiles_reader import Archive

SIZE = 600
#: A z14 grid, as the other tiling tests: about 9.6 Mercator metres a pixel, 6.8 on the ground here, so the cut reaches 22 pixels in.
ZOOM = TILING_ZOOM
RESOLUTION = ZOOM0_RESOLUTION_M / 2**ZOOM
RIM_PX = 8
SCENE_GREY = 120
BLACK = 2
#: The live tile's crop: z13 rows 40 to 139 of 13/4689/2965, its red band and its alpha.
LIVE_TILE = Path(__file__).parent.parent / "fixtures" / "rim-1980-z13-4689-2965.png"
LIVE_ZOOM = 13
LIVE_TOP_ROW = 2965 * 256 + 40


def edge_row(column: int) -> int:
    """The frame's skewed northern edge: the first opaque row of each column."""
    return 100 + column // 3


def reach_of(resolution: float, centre_y: float) -> int:
    """How many pixels of `resolution` Mercator metres the cut may reach, at the latitude of `centre_y`."""
    return round(RIM_MAX_GROUND_M / (resolution * ground_scale(to_lnglat(0, centre_y)[1])))


def framed(path: Path, rim_px: int = RIM_PX, street: bool = True) -> Path:
    """The frame: opaque below its edge, a black rim `rim_px` deep along it, a black building and a long dark street inside."""
    depth, alpha = frame_grid()
    grey = numpy.full((SIZE, SIZE), SCENE_GREY, numpy.uint8)
    grey[(depth >= 0) & (depth < rim_px)] = BLACK
    grey[400:440, 100:140] = BLACK
    if street:
        grey[:, 500:506] = BLACK
    return write_frame(path, grey, alpha)


def frame_grid() -> tuple[NDArray[numpy.int64], UInt8Array]:
    """Each pixel's depth below the frame's edge (negative outside), and the frame's alpha."""
    rows = numpy.indices((SIZE, SIZE))[0]
    depth = rows - numpy.array([edge_row(column) for column in range(SIZE)])[numpy.newaxis, :]
    return depth, numpy.where(depth >= 0, 255, 0).astype(numpy.uint8)


#: The fading frame: 4 black rows, then a linear fade to the scene over `FADE_PX` rows (100 ground metres), and a river of grey
#: `RIVER_GREY` from `RIVER_DEPTH` rows in, 3 rows past the point the fade first reaches 65 % of the scene.
FADE_PX = 15
FADE_BLACK_PX = 4
RIVER_GREY = 40
RIVER_DEPTH = 17
RIVER_PX = 5


def fading(path: Path) -> Path:
    """A frame whose rim is black for a few rows and then fades in, with a dark river parallel to the edge just inside."""
    depth, alpha = frame_grid()
    share = numpy.clip((depth - FADE_BLACK_PX) / FADE_PX, 0, 1)
    grey = (BLACK + share * (SCENE_GREY - BLACK)).astype(numpy.uint8)
    grey[(depth >= RIVER_DEPTH) & (depth < RIVER_DEPTH + RIVER_PX)] = RIVER_GREY
    return write_frame(path, grey, alpha)


def frame_origin() -> tuple[float, float]:
    """Where the other tiling tests' layer lies (`grey_warped`), so the version's recorded bounds hold this frame too."""
    left, top = to_mercator(26.1, 44.43)
    return left - left % RESOLUTION, top - top % RESOLUTION


def write_frame(path: Path, grey: UInt8Array, alpha: UInt8Array) -> Path:
    left, top = frame_origin()
    dataset = driver_of("GTiff").Create(str(path), SIZE, SIZE, 2, gdal.GDT_Byte)
    dataset.SetGeoTransform((left, RESOLUTION, 0, top, 0, -RESOLUTION))
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(3857)
    dataset.SetProjection(srs.ExportToWkt())
    dataset.GetRasterBand(1).WriteArray(grey)
    dataset.GetRasterBand(2).SetColorInterpretation(gdal.GCI_AlphaBand)
    dataset.GetRasterBand(2).WriteArray(alpha)
    dataset.Close()
    return path


def band_of(path: Path, index: int) -> UInt8Array:
    dataset = gdal.Open(str(path))
    pixels = as_uint8(dataset.GetRasterBand(index).ReadAsArray())
    dataset.Close()
    return pixels


def alpha_of(view: Path) -> UInt8Array:
    dataset = gdal.Open(str(view))
    band = dataset.GetRasterBand(4)
    assert band.GetColorInterpretation() == gdal.GCI_AlphaBand
    return as_uint8(band.ReadAsArray())


def test_happy_path_the_rim_is_cut_and_the_frame_inside_kept(tmp_path: Path) -> None:
    """Scenarios: S-P08-HAPPY-RIM-CUT"""
    alpha = alpha_of(rgba_view(framed(tmp_path / "warped.tif"), tmp_path / "rgba.vrt"))

    column = 60
    edge = edge_row(column)
    assert alpha[edge - 5, column] == 0, "outside stays transparent"
    assert alpha[edge + 1 : edge + RIM_PX - 1, column].max() == 0, "the black rim no longer shows"
    assert alpha[edge + RIM_PX + 4, column] == 255, "the scene right past the rim shows"
    assert alpha[400:440, 100:140].min() == 255, "a black building deep inside is the picture's own"
    assert alpha[300:400, 200:300].min() == 255


def test_happy_path_the_tiles_of_a_frame_with_a_rim_show_no_black_band(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P08-HAPPY-RIM-CUT"""
    seed_old_version(world, tmp_path)
    cog = write_cog(Warped.of(framed(tmp_path / "framed.tif")), tmp_path / "framed-cog.tif")
    world.gcs.put(f"{FILES}cog.tif", cog.read_bytes())

    assert run_tiles_job(world) is RunOutcome.DONE

    archive = Archive(world.gcs.objects[f"{FILES}tiles.pmtiles"].data)
    black = sum(opaque_black(data, tmp_path) for data in tiles_of(archive))
    # The building (40 x 40) and the street past the reach are black and opaque; the rim (8 deep along 600 columns) no longer is.
    assert 0 < black < 40 * 40 + 6 * SIZE


def tiles_of(archive: Archive) -> list[bytes]:
    """Every z14 tile of the frame, found by its grid."""
    span = ZOOM0_RESOLUTION_M * 256 / 2**ZOOM
    origin = ZOOM0_RESOLUTION_M * 256 / 2
    left, top = frame_origin()
    first_x, first_y = int((left + origin) // span), int((origin - top) // span)
    found = [archive.tile(ZOOM, first_x + dx, first_y + dy) for dx in range(4) for dy in range(4)]
    return [data for data in found if data is not None]


def opaque_black(data: bytes, folder: Path) -> int:
    file = folder / "tile.webp"
    file.write_bytes(data)
    dataset = gdal.Open(str(file))
    pixels = numpy.asarray(dataset.ReadAsArray())
    dataset.Close()
    if pixels.shape[0] != 4:
        return int((pixels[0] <= BLACK + 8).sum())
    return int(((pixels[0] <= BLACK + 8) & (pixels[3] >= 250)).sum())


def test_happy_path_a_fading_rim_leaves_no_dark_band(tmp_path: Path) -> None:
    """Scenarios: S-P08-HAPPY-RIM-FADE"""
    source = fading(tmp_path / "warped.tif")
    grey = band_of(source, 1)

    alpha = alpha_of(rgba_view(source, tmp_path / "rgba.vrt"))

    depth, _ = frame_grid()
    near_edge = (depth >= 0) & (depth < RIVER_DEPTH)
    shown = near_edge & (alpha == 255)
    assert shown.any(), "the scene right past the fade shows"
    assert grey[shown].min() >= 0.6 * SCENE_GREY, "no row of the fade still shows as a dark band"
    assert (alpha[depth == FADE_BLACK_PX + 6] == 0).all(), "the fade is cut as deep as it is dark, not one pixel past the black"


def test_bad_path_a_dark_river_just_past_the_fade_is_kept(tmp_path: Path) -> None:
    """Scenarios: S-P08-BAD-RIM-LIMITS"""
    alpha = alpha_of(rgba_view(fading(tmp_path / "warped.tif"), tmp_path / "rgba.vrt"))

    depth, _ = frame_grid()
    river = (depth >= RIVER_DEPTH) & (depth < RIVER_DEPTH + RIVER_PX)
    assert alpha[river].min() == 255, "a river behind a bright bank is the picture's, though it lies within the reach"
    assert alpha[depth >= RIVER_DEPTH].min() == 255


def test_bad_path_a_dark_street_from_the_edge_is_cut_only_to_the_limit(tmp_path: Path) -> None:
    """Scenarios: S-P08-BAD-RIM-LIMITS"""
    alpha = alpha_of(rgba_view(framed(tmp_path / "warped.tif"), tmp_path / "rgba.vrt"))

    street = 502
    edge = edge_row(street)
    reach = reach_of(RESOLUTION, frame_origin()[1] - RESOLUTION * SIZE / 2)
    assert alpha[edge + RIM_PX + 2, street] == 0, "within the reach, the street is taken for the rim"
    assert alpha[edge + reach + 6 :, street].min() == 255, "past the reach, the street is the picture's"


def test_happy_path_the_live_1980_edge_loses_its_fade(tmp_path: Path) -> None:
    """Scenarios: S-P08-HAPPY-RIM-FADE"""
    grey, alpha = band_of(LIVE_TILE, 1), band_of(LIVE_TILE, 2)
    resolution = ZOOM0_RESOLUTION_M / 2**LIVE_ZOOM
    reach = reach_of(resolution, ZOOM0_RESOLUTION_M * 128 - resolution * (LIVE_TOP_ROW + 50))

    kept = (alpha >= 128) & ~rim_cut(grey, alpha, reach)

    first = [grey[numpy.flatnonzero(kept[:, column])[-1], column] for column in range(grey.shape[1])]
    deepest = [int((alpha[:, column] >= 128).sum() - kept[:, column].sum()) for column in range(grey.shape[1])]
    # The black-only cut left the frame ending on the fade: a median of 63 and a tenth of the columns under 35.
    assert numpy.median(first) >= 72, "the row the frame now ends on is the scene's, not the fade's grey 29 to 70"
    assert numpy.percentile(first, 10) >= 45
    assert max(deepest) <= reach + 1, "never deeper than the reach"


def test_happy_path_the_view_keeps_the_cogs_overviews(tmp_path: Path) -> None:
    """Scenarios: S-P08-HAPPY-RIM-FADE"""
    cog = write_cog(Warped.of(fading(tmp_path / "warped.tif")), tmp_path / "cog.tif")
    source = gdal.Open(str(cog))
    levels = source.GetRasterBand(1).GetOverviewCount()
    source.Close()

    view = rgba_view(cog, tmp_path / "rgba.vrt")

    dataset = gdal.Open(str(view))
    assert levels > 0
    assert [dataset.GetRasterBand(band).GetOverviewCount() for band in range(1, 5)] == [levels] * 4
    overview = as_uint8(dataset.GetRasterBand(4).GetOverview(0).ReadAsArray())
    assert overview[edge_row(60) // 2 + 3, 30] == 0, "the overview's alpha is cut too"
    dataset.Close()
    thumb = gdal.Open(str(write_thumb(view, tmp_path / "thumb.webp")))
    assert thumb.RasterXSize == 320
    assert thumb.RasterCount == 4


def test_bad_path_a_frame_without_a_rim_keeps_its_alpha_untouched(tmp_path: Path) -> None:
    """Scenarios: S-P08-BAD-RIM-LIMITS"""
    source = framed(tmp_path / "warped.tif", rim_px=0, street=False)
    dataset = gdal.Open(str(source))
    before = as_uint8(dataset.GetRasterBand(2).ReadAsArray())
    dataset.Close()

    view = rgba_view(source, tmp_path / "rgba.vrt")

    assert not (tmp_path / "rgba-rim.tif").exists()
    assert numpy.array_equal(alpha_of(view), before)


def test_happy_path_a_cogs_mask_loses_its_rim_too(tmp_path: Path) -> None:
    """Scenarios: S-P08-HAPPY-RIM-CUT"""
    cog = write_cog(Warped.of(framed(tmp_path / "warped.tif")), tmp_path / "cog.tif")

    alpha = alpha_of(rgba_view(cog, tmp_path / "rgba.vrt"))

    column = 60
    assert alpha[edge_row(column) + 2 : edge_row(column) + RIM_PX - 2, column].max() == 0
    assert alpha[300:400, 200:300].min() == 255


def test_bad_path_a_frame_narrower_than_the_reach_is_measured_on_itself() -> None:
    """Scenarios: S-P08-BAD-RIM-LIMITS"""
    grey = numpy.full((12, 12), SCENE_GREY, numpy.uint8)
    grey[1:3] = BLACK
    grey[3] = SCENE_GREY // 2
    alpha = numpy.full((12, 12), 255, numpy.uint8)
    alpha[0] = 0

    cut = rim_cut(grey, alpha, 50)

    assert cut[1:5].all(), "the black, the fade under 65 % of the frame's own median, and one row more"
    assert not cut[5:].any()
    assert scene_level(grey, numpy.zeros_like(grey, bool)) == 0.0


@pytest.mark.parametrize(("width", "height", "factor"), [(600, 600, 1), (8192, 100, 1), (8193, 100, 2), (30_370, 22_980, 4)])
def test_happy_path_the_preview_stays_small(width: int, height: int, factor: int) -> None:
    """Scenarios: S-P08-HAPPY-RIM-CUT"""
    assert preview_factor(width, height) == factor
    assert RIM_PREVIEW_MAX_PX == 8192
