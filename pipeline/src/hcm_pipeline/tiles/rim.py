"""The film's dark rim, cut from a layer's alpha before its tiles are made (docs/research/M12-own-tiles.md -> *The dark rim*).

The scan's border crop (`steps/stitch.py`) keeps a few rows of the film's dark edge where that edge is skewed or fades, and the warp's
alpha marks the whole footprint as image: an opaque dark band along a frame's edge on the map (the owner's screenshot of 2026-11-08,
1980's frame: 3 to 5 z13 rows at grey 0 to 3 under alpha 255, then 3 to 6 more fading in at grey 29 to 70). The crop stays as it is,
since moving it would shift the scan's pixels under the saved points; the tiles take an alpha without the rim instead, a band measured
in two passes from the alpha's edge, as a straight-line distance (`edge_distance`), so the band is as deep across a 45 degree edge as
across a straight one. The film's black (grey `RIM_DARK_LEVEL` or less) that the transparent outside reaches through black pixels
only is the rim's core. From the core the cut grows through the fade, a ramp that rises outward: a pixel joins while it is darker than
`RIM_FADE_SHARE` of the scene's own level (the median of the frame deeper than the band) and the profile still rises there (`rising`),
so a flat dark patch (a lake, a park, a shadow) that touches the core loses a pixel or two, not the band. The fade's last dark pixel
before the scene is taken too, and one preview pixel past the cut for the bilinear edge. Neither pass goes more than
`RIM_MAX_GROUND_M` from the alpha's edge. So a frame with no black at its edge keeps its alpha untouched. The cut is found on a preview
at most `RIM_PREVIEW_MAX_PX` on its long side (about 5 m a pixel for a KH-9 frame), drawn bilinear at full size and written once as a
tiled alpha with the source's own overview levels (`trimmed_alpha`), so the view keeps the COG's overviews and nothing reads the
full-size frame through a pixel function more than once.
"""

import html
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import cv2
import numpy
from numpy.typing import NDArray

from hcm_pipeline.geo import ground_scale, to_lnglat
from hcm_pipeline.images import UInt8Array, as_uint8
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import driver_of

#: The film's own black: its rim reads 0 to 3, a scene's shadow on these scans rarely under 30.
RIM_DARK_LEVEL: Final = 24
#: The fade ends where the image first reaches this share of the scene's median grey (1980's fade: grey 29 to 70 under a median of 88).
RIM_FADE_SHARE: Final = 0.65
#: The deepest a rim is cut, in ground metres from the alpha's edge (1980's rim and fade: about 100).
RIM_MAX_GROUND_M: Final = 150.0
#: The fade's profile rises more than this much grey a preview pixel outward (a 200 m fade on a 5 m preview: 3); a flat patch's, 0.
RIM_RISE: Final = 1.5
RIM_PREVIEW_MAX_PX: Final = 8192
#: An alpha at or above this shows (the preview averages the alpha's edge).
OPAQUE: Final = 128
KEEP: Final = 255
#: A step of the cut moves to a side neighbour only.
_STEP: Final = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))
#: The profile is read over this many pixels on each side of a pixel, along the edge and across it, which averages the scene's grain.
_WINDOW_PX: Final = 3
_OFFSETS: Final = tuple((dy, dx) for dy in range(-_WINDOW_PX, _WINDOW_PX + 1) for dx in range(-_WINDOW_PX, _WINDOW_PX + 1))
#: The shells a profile is read in, as distances from the edge less the pixel's own: two pixels nearer, one nearer, its own, one farther.
_SHELLS: Final = ((-2.5, -1.5), (-1.5, -0.5), (-0.5, 0.5), (0.5, 1.5))
_TRIMMED_OPTIONS: Final = ("TILED=YES", "COMPRESS=DEFLATE")
# The compression's threads are GDAL's (the governor's budget on a local worker, docs/research/M26-governor.md §4), never every core.
_THREADS_OPTION: Final = "GDAL_NUM_THREADS"


@dataclass(frozen=True)
class Rim:
    """The keep-mask beside the view (0 where the rim is cut, 255 elsewhere) and its size in preview pixels."""

    path: Path
    width: int
    height: int


@dataclass(frozen=True)
class Shells:
    """The shells' mean grey (one row per shell) around the pixels at `rows, columns`, and how many pixels each mean holds."""

    rows: NDArray[numpy.intp]
    columns: NDArray[numpy.intp]
    means: NDArray[numpy.float32]
    counts: NDArray[numpy.float32]

    def paint(self, shape: tuple[int, ...], chosen: NDArray[numpy.bool_]) -> NDArray[numpy.bool_]:
        """A full-size mask, true at the pixels whose `chosen` is."""
        mask = numpy.zeros(shape, bool)
        mask[self.rows[chosen], self.columns[chosen]] = True
        return mask


def preview_factor(width: int, height: int) -> int:
    """How many of the raster's pixels make one of the preview's, on each side."""
    return max(1, math.ceil(max(width, height) / RIM_PREVIEW_MAX_PX))


def alpha_band(dataset: gdal.Dataset, alpha: str) -> gdal.Band:
    """`alpha` as the view names it: a band number, or `mask` for the COG's mask (JPEG holds no alpha)."""
    return dataset.GetRasterBand(1).GetMaskBand() if alpha == "mask" else dataset.GetRasterBand(int(alpha))


def _read(band: gdal.Band, width: int, height: int) -> UInt8Array:
    return as_uint8(band.ReadAsArray(buf_xsize=width, buf_ysize=height, resample_alg=gdal.GRIORA_Average))


def _grow(seeds: NDArray[numpy.bool_], passable: NDArray[numpy.bool_], steps: int) -> NDArray[numpy.bool_]:
    """`seeds` and the `passable` pixels reached from them through passable side neighbours, in at most `steps` steps."""
    reached, through = seeds.astype(numpy.uint8), (seeds | passable).astype(numpy.uint8)
    for _ in range(steps):
        grown = as_uint8(cv2.dilate(reached, _STEP)) & through
        if numpy.array_equal(grown, reached):
            break
        reached = grown
    return reached.astype(bool)


def scene_level(grey: UInt8Array, inside: NDArray[numpy.bool_]) -> float:
    """The median grey of the frame deeper than the band, or of the whole frame when it is all band."""
    return float(numpy.median(grey[inside])) if inside.any() else 0.0


def edge_distance(outside: NDArray[numpy.bool_]) -> NDArray[numpy.float32]:
    """Each pixel's straight-line distance, in pixels, to the nearest transparent one (0 outside), the same across any edge's angle."""
    return numpy.asarray(cv2.distanceTransform((~outside).astype(numpy.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE), numpy.float32)


def shell_means(grey: UInt8Array, distance: NDArray[numpy.float32], counted: NDArray[numpy.bool_], at: NDArray[numpy.bool_]) -> Shells:
    """For each pixel `at`, the mean grey of the `counted` pixels in each of `_SHELLS` within `_WINDOW_PX`, and how many there were."""
    height, width = grey.shape
    rows, columns = numpy.nonzero(at)
    own = distance[rows, columns]
    sums = numpy.zeros((len(_SHELLS), rows.size), numpy.float32)
    counts = numpy.zeros((len(_SHELLS), rows.size), numpy.float32)
    for dy, dx in _OFFSETS:
        near_rows, near_columns = numpy.clip(rows + dy, 0, height - 1), numpy.clip(columns + dx, 0, width - 1)
        inside = (near_rows == rows + dy) & (near_columns == columns + dx) & counted[near_rows, near_columns]
        step = distance[near_rows, near_columns] - own
        for index, (low, high) in enumerate(_SHELLS):
            chosen = inside & (step > low) & (step <= high)
            sums[index] += numpy.where(chosen, grey[near_rows, near_columns], 0)
            counts[index] += chosen
    return Shells(rows, columns, (sums / numpy.maximum(counts, 1)).astype(numpy.float32), counts)


def rising(grey: UInt8Array, distance: NDArray[numpy.float32], dark: NDArray[numpy.bool_]) -> NDArray[numpy.bool_]:
    """The `dark` pixels where the dark pixels' profile still rises outward: their shell is brighter than the one two pixels nearer, and
    than the one next to it, or the one farther is brighter than theirs (a grain's dip inside a fade); a flat patch rises nowhere."""
    shells = shell_means(grey, distance, dark, dark)
    two_nearer, nearer, own, farther = shells.means
    climbs = (own - nearer > RIM_RISE) | ((farther - own > RIM_RISE) & (shells.counts[3] > 0))
    return shells.paint(dark.shape, (own - two_nearer > 2 * RIM_RISE) & climbs)


def fade_end(
    grey: UInt8Array, distance: NDArray[numpy.float32], opaque: NDArray[numpy.bool_], at: NDArray[numpy.bool_], level: float
) -> NDArray[numpy.bool_]:
    """The pixels `at` whose next shell outward is the scene's (at least the fade's limit `level`): the fade's last dark pixel."""
    shells = shell_means(grey, distance, opaque, at)
    return shells.paint(at.shape, (shells.means[3] >= level) & (shells.counts[3] > 0))


def rim_cut(grey: UInt8Array, alpha: UInt8Array, reach: int) -> NDArray[numpy.bool_]:
    """The opaque pixels to cut: the black core the outside reaches, the rising fade grown from it and its last dark pixel, all within
    `reach` of the alpha's edge, and one pixel more."""
    outside = alpha < OPAQUE
    distance = edge_distance(outside)
    band = ~outside & (distance <= reach)
    deep = ~outside & ~band
    limit = max(RIM_DARK_LEVEL, RIM_FADE_SHARE * scene_level(grey, deep if deep.any() else ~outside))
    core = _grow(outside, band & (grey <= RIM_DARK_LEVEL), 2 * reach)
    if numpy.array_equal(core, outside):
        return numpy.zeros_like(outside)
    dark = band & (grey < limit)
    fade = _grow(core, rising(grey, distance, dark), 2 * reach) & ~outside
    fade |= fade_end(grey, distance, ~outside, dark & ~fade & _dilated(fade), limit)
    return _dilated(fade) & ~outside & (distance <= reach + 1)


def _dilated(mask: NDArray[numpy.bool_]) -> NDArray[numpy.bool_]:
    return numpy.asarray(cv2.dilate(mask.astype(numpy.uint8), _STEP), bool)


def reach_px(dataset: gdal.Dataset, preview_width: int) -> int:
    """`RIM_MAX_GROUND_M` in the preview's pixels, at the latitude of the frame's middle (the raster is Web Mercator)."""
    transform = dataset.GetGeoTransform()
    pixel_m = abs(transform[1]) * dataset.RasterXSize / preview_width
    middle_lat = to_lnglat(0.0, transform[3] + transform[5] * dataset.RasterYSize / 2)[1]
    return max(1, round(RIM_MAX_GROUND_M / (pixel_m * ground_scale(middle_lat))))


def find_rim(dataset: gdal.Dataset, alpha: str, target: Path) -> Rim | None:
    """The keep-mask of `dataset`'s rim written to `target`; None when the frame has no rim to cut."""
    factor = preview_factor(dataset.RasterXSize, dataset.RasterYSize)
    width, height = math.ceil(dataset.RasterXSize / factor), math.ceil(dataset.RasterYSize / factor)
    grey = _read(dataset.GetRasterBand(1), width, height)
    cut = rim_cut(grey, _read(alpha_band(dataset, alpha), width, height), reach_px(dataset, width))
    if not cut.any():
        return None
    mask = driver_of("GTiff").Create(str(target), width, height, 1, gdal.GDT_Byte, ["COMPRESS=DEFLATE"])
    mask.GetRasterBand(1).WriteArray(numpy.where(cut, 0, KEEP).astype(numpy.uint8))
    mask.Close()
    return Rim(target, width, height)


def _source(path: Path, band: str, extra: str = "", resampling: str = "") -> str:
    name = html.escape(str(path.resolve()), quote=True)
    file = f'<SourceFilename relativeToVRT="0">{name}</SourceFilename>'
    return f"<SimpleSource{resampling}>{file}<SourceBand>{band}</SourceBand>{extra}</SimpleSource>"


def _rects(rim: Rim, width: int, height: int) -> str:
    """The whole preview drawn over the whole view."""
    source = f'<SrcRect xOff="0" yOff="0" xSize="{rim.width}" ySize="{rim.height}"/>'
    return f'{source}<DstRect xOff="0" yOff="0" xSize="{width}" ySize="{height}"/>'


def overview_factors(dataset: gdal.Dataset) -> list[int]:
    """The source's overview levels as factors of its full size, which the trimmed alpha repeats so the view keeps them."""
    band = dataset.GetRasterBand(1)
    return [round(dataset.RasterXSize / band.GetOverview(level).XSize) for level in range(band.GetOverviewCount())]


def trimmed_alpha(source: Path, alpha: str, rim: Rim, target: Path) -> Path:
    """The smaller of the source's alpha and the keep-mask drawn bilinear to full size, written once as a tiled GTiff with overviews."""
    dataset = gdal.Open(str(source))
    width, height, factors = dataset.RasterXSize, dataset.RasterYSize, overview_factors(dataset)
    dataset.Close()
    derived = target.with_suffix(".vrt")
    plan = driver_of("VRT").Create(str(derived), width, height, 0)
    plan.AddBand(gdal.GDT_Byte, ["subClass=VRTDerivedRasterBand", "PixelFunctionType=min"])
    band = plan.GetRasterBand(1)
    band.SetMetadataItem("source_0", _source(source, "mask,1" if alpha == "mask" else alpha), "new_vrt_sources")
    band.SetMetadataItem("source_1", _source(rim.path, "1", _rects(rim, width, height), ' resampling="bilinear"'), "new_vrt_sources")
    plan.Close()
    threads = gdal.GetConfigOption(_THREADS_OPTION) or "ALL_CPUS"
    written = gdal.Translate(str(target), str(derived), format="GTiff", creationOptions=[*_TRIMMED_OPTIONS, f"NUM_THREADS={threads}"])
    if factors:
        written.BuildOverviews("AVERAGE", factors)
    written.Close()
    derived.unlink()
    return target


def add_trimmed_alpha(view: Path, alpha: Path) -> None:
    """A last band of `view`, its alpha: the trimmed alpha's one band, a plain source, so the view's overviews are its sources'."""
    dataset = gdal.Open(str(view), gdal.GA_Update)
    dataset.AddBand(gdal.GDT_Byte)
    band = dataset.GetRasterBand(dataset.RasterCount)
    band.SetColorInterpretation(gdal.GCI_AlphaBand)
    band.SetMetadataItem("source_0", _source(alpha, "1"), "new_vrt_sources")
    dataset.Close()
