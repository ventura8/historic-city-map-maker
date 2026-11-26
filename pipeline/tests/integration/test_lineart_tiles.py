"""Line-art tiles keep binary alpha at every zoom (lesson 546: Post 1847 almost invisible when overviews averaged RGBA)."""

from dataclasses import dataclass
from pathlib import Path
from typing import cast

import numpy
import pytest
from hcm_pipeline.geo import ZOOM0_RESOLUTION_M, Bounds, to_mercator
from hcm_pipeline.jobs import JobContext
from hcm_pipeline.raster import gdal, osr
from hcm_pipeline.rasters import driver_of
from hcm_pipeline.steps.export import Warped
from hcm_pipeline.steps.pyramid import Rendered, write_tree
from hcm_pipeline.tiles.encoding import ENCODINGS, TileEncoding, paper_transparent
from numpy.typing import NDArray

from tests.integration.tiling import ZOOM

SIZE = 512
#: Blocks large enough that a city-zoom overview still holds opaque ink (1 px checkers vanish under skip-blank).
BLOCK = 16
MINZOOM = ZOOM - 2
OPAQUE = 255


@dataclass(frozen=True)
class _QuietFlags:
    """Progress that never stops GDAL."""

    def gdal_progress(self, *_args: object) -> int:
        return 1


@dataclass(frozen=True)
class _QuietContext:
    """What `write_tree` reads of a job context."""

    flags: _QuietFlags = _QuietFlags()


def lineart_warped(path: Path) -> Path:
    """Ink/paper blocks on a z14 grid: paper_transparent makes ink opaque black and paper clear."""
    resolution = ZOOM0_RESOLUTION_M / 2**ZOOM
    left, top = to_mercator(26.1, 44.43)
    left, top = left - left % resolution, top - top % resolution
    rows, cols = numpy.indices((SIZE, SIZE))
    grey = numpy.where(((rows // BLOCK) + (cols // BLOCK)) % 2 == 0, 0, 255).astype(numpy.uint8)
    alpha = numpy.full((SIZE, SIZE), OPAQUE, numpy.uint8)
    dataset = driver_of("GTiff").Create(str(path), SIZE, SIZE, 2, gdal.GDT_Byte)
    dataset.SetGeoTransform((left, resolution, 0, top, 0, -resolution))
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(3857)
    dataset.SetProjection(srs.ExportToWkt())
    dataset.GetRasterBand(1).WriteArray(grey)
    dataset.GetRasterBand(2).SetColorInterpretation(gdal.GCI_AlphaBand)
    dataset.GetRasterBand(2).WriteArray(alpha)
    dataset.Close()
    return path


def soft_share(alpha: NDArray[numpy.uint8]) -> float:
    """Share of pixels that are neither clear nor fully opaque (the wash overview averaging made)."""
    soft = (alpha > 0) & (alpha < OPAQUE)
    return float(soft.mean())


def content_tile_alpha(tree: Path, zoom: int) -> NDArray[numpy.uint8]:
    """Alpha of a WebP at `zoom` that still holds ink (skip blank-only tiles)."""
    tiles = sorted(tree.joinpath(str(zoom)).rglob("*.webp"))
    assert tiles, f"no WebP under zoom {zoom} in {tree}"
    for tile in tiles:
        opened = gdal.Open(str(tile))
        assert opened is not None
        assert opened.RasterCount >= 4
        alpha = opened.GetRasterBand(4).ReadAsArray()
        if int(alpha.max()) == OPAQUE:
            return alpha
    raise AssertionError(f"no opaque ink under zoom {zoom}")


def run_tiles(view: Path, tree: Path, encoding: TileEncoding) -> Path:
    """`write_tree` over the view's own bounds."""
    box: Bounds = Warped.of(view).grid.box().bounds()
    rendered = Rendered(minzoom=MINZOOM, maxzoom=ZOOM, bounds=box, cog_path=None)
    return write_tree(view, tree, rendered, cast(JobContext, _QuietContext()), encoding)


@pytest.fixture
def lineart_view(tmp_path: Path) -> Path:
    return paper_transparent(lineart_warped(tmp_path / "warped.tif"), tmp_path / "lineart.tif")


def test_happy_path_line_art_overview_tiles_keep_binary_alpha(lineart_view: Path, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-ENCODING

    Nearest overviews; soft alpha stays 0 % (lesson 546).
    """
    tree = run_tiles(lineart_view, tmp_path / "nearest", ENCODINGS["lineart"])
    zooms = sorted({int(path.name) for path in tree.iterdir() if path.name.isdigit()})

    assert zooms[0] <= MINZOOM
    for zoom in zooms:
        assert soft_share(content_tile_alpha(tree, zoom)) == 0.0


def test_bad_path_averaged_overviews_wash_line_art_alpha(lineart_view: Path, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-LINEART-AVERAGE

    The Post 1847 failure mode: average overviews soften ink alpha.
    """
    washed = TileEncoding(("LOSSLESS=YES",), "nearest", overview_resampling="average")
    tree = run_tiles(lineart_view, tmp_path / "average", washed)
    softest = max(soft_share(content_tile_alpha(tree, int(path.name))) for path in tree.iterdir() if path.name.isdigit())

    assert softest > 0
    assert ENCODINGS["lineart"].overview_resampling == "nearest"
