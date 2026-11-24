"""Class b: a sheet series placed from its sheets' names on the city grid (docs/research/M20-import-local.md §3 b).

1. Parse: each sheet's name is a cell of its grammar (`archive.grammar`); the grammar's grid scheme (`gridscheme`) says where the cell
   lies in the grid's metres. A grammar with no scheme yet, or a name the report marked odd, is not placed by name.
2. Frame per sheet: the neat line on a reduced copy (`frame`); its four corners make the sheet's homography to its cell. A sheet with
   no printed neat line (the cadastral sheets) is framed by its drawing's extent when that holds its cell's shape (M22 §4.1). A sheet
   framed by neither is left out and counted (`frame-not-found`): one bad sheet never blocks the series.
3. The quarter numbering: of the eight orders, the one whose neighbouring sheets continue each other's lines best (edge profiles).
4. Solve the grid once: the sheets pasted on the grid at 2 m (coarser for a city-wide series) make the whole series' street
   pattern, placed on the reference (the ladder, then OpenStreetMap) as a map of known scale, north up, its fit rigid (an affine),
   with the rival search and the held-out checks of a drawn map (`single`). A grid the owner confirmed (`params.gridId`,
   `cities/{c}/grids/{g}`) starts the fit instead of the search. Batch 4 (§5.1): a grid that does not prove but was fitted is still
   rendered from the sheets' names (`grid-names`), with its seams and its checks against the reference measured, for the owner alone to
   approve by hand (the policy never publishes it); with no fit at all it waits for a person, its mosaic kept as the one stitched
   picture the Help calibrate wizard places (`stitched`, M22 §4.1), preferring tiles laid on an archive overview when one is found
   (`overview_find`).
5. Render: each sheet warped from its own scan into the series' one `warped.tif`, cut at its neat line (hard seams, no feather), through
   a 5 x 5 lattice of its homography composed with the solved grid.

The joint seam solve across neighbours (paper shrink, scanner skew), the TPS where 30 printed crossings support it and the crossing
detection on a printed grid (the IGA quadrants) are not built: the frames' homographies and one rigid grid stand for them.
"""

import json
from collections.abc import Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Final

import cv2
import numpy

from hcm_pipeline.archive.grammar import Cell, parse
from hcm_pipeline.georef.transforms import Transform
from hcm_pipeline.jobs import JobContext, StepResult
from hcm_pipeline.placing import assemble, fullres, fullres_parts, neatline
from hcm_pipeline.placing.checks import Checked
from hcm_pipeline.placing.frame import content_frame, find_frame
from hcm_pipeline.placing.geometry import FloatArray, compose
from hcm_pipeline.placing.gridscheme import QUARTER_ORDERS, Box, CityGrid, scheme_for
from hcm_pipeline.placing.maps import AtlasPlacer, atlas_parts
from hcm_pipeline.placing.neatline import NeatLine
from hcm_pipeline.placing.output import Placement, finish, resolution_of, wait_for_help
from hcm_pipeline.placing.overview_find import CanvasOpts, find_overview, overview_canvas
from hcm_pipeline.placing.raster_io import read_working
from hcm_pipeline.placing.reference import city_window
from hcm_pipeline.placing.render import SheetWarp, render_sheets
from hcm_pipeline.placing.series import SeriesJob, Sheet, series_of
from hcm_pipeline.placing.single import LARGEST_WORKING_PX, Attempt, Drawn, Search, attempt, drawn_of, fit_from
from hcm_pipeline.placing.stitched import NO_FRAME, NO_JOIN, JoinQuality, Stitched, wait_stitched
from hcm_pipeline.placing.streets import UInt8Array, grey_of
from hcm_pipeline.steps.gather import store_of, text_param

SEAM_M: Final = 2.0
# The frame's own line is left outside the straightened sheet (it would draw the grid's lines into the mosaic and blind its seams).
INSET_SHARE: Final = 0.012
# The mosaic's metres a pixel: as fine as the sheets were straightened, coarser only to keep its long side within the working size.
MOSAIC_M: Final = SEAM_M
MOSAIC_MAX_PX: Final = 6000
FRAME_PX: Final = 1000
NO_SCHEME: Final = "These sheets' names are read, but no grid scheme places them yet: add about four points on a few sheets."
# Under this share of framed sheets the series is laid out as an atlas (the tile wizard's path) instead of a grid of the few framed.
FRAMED_SHARE_MIN: Final = 0.5
NO_FRAMES: Final = "No sheet's frame was found: add about four points on a few sheets."
UNFRAMED: Final = (
    "The frame of {count} of {total} sheets was not found, so they would be missing from the map: open Help calibrate, which"
    " lists them, and place the series there."
)
NOT_PROVED: Final = "The grid could not be placed on its own: place three sheets on the map, and the rest follow."
OWNER_METHOD: Final = "grid-names"


@dataclass(frozen=True)
class Rectified:
    """A sheet whose frame was found: its cell, its frame's corners (scan pixels) and its picture on its cell at `SEAM_M`."""

    sheet: Sheet
    cell: Cell
    corners: FloatArray
    image: UInt8Array
    # How its frame was found: its neat line with the series' help (`neatline`), its outermost long lines (`line`) or its
    # drawing's extent (`content`).
    framed_by: str = "line"
    # Its original's pixels to the picture's (3x3) and the original's size: the mosaic's parts record (`fullres`).
    to_picture: FloatArray | None = None
    full: tuple[int, int] = (0, 0)


def rectify(sheet: Sheet, cell: Cell, scheme: CityGrid, found: NeatLine | None = None) -> Rectified | None:
    """The sheet straightened onto its cell, or None when no frame is found: its neat line found with the series' help (`found`,
    when confident), else its outermost long lines, else its drawing's extent."""
    working = read_working(sheet.path, FRAME_PX)
    grey = grey_of(working.image)
    box = scheme.box(cell)
    corners, framed_by = _frame_of(grey, working.scale, box.width / box.height, found)
    if corners is None:
        return None
    width, height = round(box.width / SEAM_M), round(box.height / SEAM_M)
    inset = INSET_SHARE * max(width, height) + 1
    target = numpy.array(
        [[-inset, -inset], [width + inset, -inset], [width + inset, height + inset], [-inset, height + inset]], numpy.float32
    )
    homography = cv2.getPerspectiveTransform((corners / working.scale).astype(numpy.float32), target)
    picture = numpy.asarray(cv2.warpPerspective(grey, homography, (width, height), borderValue=255), numpy.uint8)
    to_picture = fullres.indexed(numpy.asarray(homography, numpy.float64)) @ numpy.diag([1 / working.scale, 1 / working.scale, 1.0])
    return Rectified(sheet, cell, corners, picture, framed_by, to_picture, (working.width, working.height))


def _frame_of(grey: UInt8Array, scale: float, aspect: float, found: NeatLine | None) -> tuple[FloatArray | None, str]:
    """The sheet's frame (full scan pixels) and how it was found (`Rectified.framed_by`)."""
    if found is not None and found.confident:
        return found.corners, "neatline"
    corners = find_frame(grey, scale)
    if corners is not None:
        return corners, "line"
    return content_frame(grey, aspect, scale), "content"


NEIGHBOUR_STEPS: Final = ((1, 0, "right", "left"), (0, -1, "bottom", "top"))


def _positions(boxes: list[Box]) -> dict[tuple[int, int], int]:
    """Each sheet by its place in units of the smallest sheet (x east, y north)."""
    unit = min((min(box.width, box.height) for box in boxes), default=1.0)
    return {(round(box.west / unit), round(box.north / unit)): index for index, box in enumerate(boxes)}


def _neighbour_pairs(at: dict[tuple[int, int], int]) -> list[tuple[int, int, str, str]]:
    """Every sheet with its east and south neighbours: (sheet, neighbour, its edge, the neighbour's edge)."""
    steps = [(place, step) for place in at for step in NEIGHBOUR_STEPS]
    return [
        (at[place], at[(place[0] + dx, place[1] + dy)], side, facing)
        for place, (dx, dy, side, facing) in steps
        if (place[0] + dx, place[1] + dy) in at
    ]


def seam_score(rectified: list[Rectified], scheme: CityGrid, order: int) -> float:
    """How well neighbouring sheets continue each other's lines when the quarters are read in `order` (mean edge correlation)."""
    at = _positions([scheme.box(item.cell, order) for item in rectified])
    profiles = [assemble.edges_of(item.image) for item in rectified]
    scores = [assemble.ncc(profiles[a][side], profiles[b][facing]) for a, b, side, facing in _neighbour_pairs(at)]
    return float(numpy.mean(scores)) if scores else 0.0


def quarter_order(rectified: list[Rectified], scheme: CityGrid) -> int:
    """The quarter numbering the seams agree with best (0 when no sheet is a quarter)."""
    if not any(item.cell.quarter for item in rectified):
        return 0
    scores = [seam_score(rectified, scheme, order) for order in range(len(QUARTER_ORDERS))]
    return int(numpy.argmax(scores))


@dataclass(frozen=True)
class Mosaic:
    """The series pasted on its grid: the picture, which sheet each pixel is, the grid metres of its top left and its metres a pixel."""

    image: UInt8Array
    owner: numpy.ndarray
    west: float
    north: float
    metres: float = MOSAIC_M
    # Each sheet's original to the mosaic (`mosaic_parts`), kept with the stitched picture.
    record: fullres.Recorded | None = None


def _slot(mosaic: Mosaic, box: Box) -> tuple[int, int, tuple[int, int]]:
    """Where a sheet's box lies on the mosaic: its column, row and size in mosaic pixels."""
    metres = mosaic.metres
    col, row = round((box.west - mosaic.west) / metres), round((mosaic.north - box.north) / metres)
    return col, row, (max(1, round(box.width / metres)), max(1, round(box.height / metres)))


def mosaic_parts(rectified: list[Rectified], scheme: CityGrid, order: int, mosaic: Mosaic) -> fullres.Recorded | None:
    """Each framed sheet's original to the mosaic (its homography, then its slot), clipped to its slot; None without a transform."""
    height, width = mosaic.image.shape
    parts = []
    for item in rectified:
        if item.to_picture is None:
            return None
        col, row, size = _slot(mosaic, scheme.box(item.cell, order))
        picture_h, picture_w = item.image.shape[:2]
        slot = numpy.array([[size[0] / picture_w, 0, col], [0, size[1] / picture_h, row], [0, 0, 1.0]])
        right, bottom = float(min(width, col + size[0])), float(min(height, row + size[1]))
        clip = ((col, row), (right, row), (right, bottom), (col, bottom))
        parts.append(fullres.Part(item.sheet.path, (0, 0, *item.full), slot @ item.to_picture, clip))
    return fullres.Recorded(tuple(parts), (width, height))


def _paste(mosaic: Mosaic, index: int, picture: UInt8Array, box: Box) -> None:
    """One sheet's picture into the mosaic at its box (cut where it would run past the mosaic's edge)."""
    col, row, size = _slot(mosaic, box)
    piece = cv2.resize(picture, size, interpolation=cv2.INTER_AREA)
    height, width = mosaic.image.shape
    mosaic.image[row : row + size[1], col : col + size[0]] = piece[: height - row, : width - col]
    mosaic.owner[row : row + size[1], col : col + size[0]] = index


def _extent(boxes: list[Box]) -> tuple[float, float, float, float]:
    """The boxes' west and north edges, and the series' width and height in grid metres."""
    edges = numpy.array([(box.west, box.north, box.east, box.south) for box in boxes])
    west, north = float(edges[:, 0].min()), float(edges[:, 1].max())
    return west, north, float(edges[:, 2].max() - west), float(north - edges[:, 3].min())


def mosaic_of(rectified: list[Rectified], scheme: CityGrid, order: int) -> Mosaic:
    """The sheets pasted on the grid at `MOSAIC_M` (coarser for a series wider than `MOSAIC_MAX_PX` of it)."""
    boxes = [scheme.box(item.cell, order) for item in rectified]
    west, north, across, down = _extent(boxes)
    metres = max(MOSAIC_M, max(across, down) / MOSAIC_MAX_PX)
    width, height = max(1, round(across / metres)), max(1, round(down / metres))
    mosaic = Mosaic(numpy.full((height, width), 255, numpy.uint8), numpy.full((height, width), -1, numpy.int32), west, north, metres)
    for index, (item, box) in enumerate(zip(rectified, boxes, strict=True)):
        _paste(mosaic, index, item.image, box)
    return replace(mosaic, record=mosaic_parts(rectified, scheme, order, mosaic))


def _grid_matrix(record: Mapping[str, object], mosaic: Mosaic) -> FloatArray | None:
    """A confirmed grid's similarity (grid metres to Mercator) composed with the mosaic's pixels to grid metres."""
    try:
        x0, y0, scale, rotation = (float(str(record[key])) for key in ("originX", "originY", "scale", "rotationDeg"))
    except KeyError, ValueError:
        return None
    angle = numpy.radians(rotation)
    cos, sin = scale * numpy.cos(angle), scale * numpy.sin(angle)
    similarity = numpy.array([[cos, -sin, x0], [sin, cos, y0]])
    pixels = numpy.array([[mosaic.metres, 0.0, mosaic.west], [0.0, -mosaic.metres, mosaic.north]])
    return compose(similarity, pixels)


@dataclass(frozen=True)
class Parsed:
    """The series' sheets read: those with a cell, their scheme, and how many names were odd or unread."""

    cells: list[tuple[Sheet, Cell]]
    scheme: CityGrid | None
    unread: int


def parsed(series: SeriesJob) -> Parsed:
    """The sheets whose names give a cell (odd names left out), and the scheme of the first one's grammar."""
    cells = [
        (sheet, cell) for sheet, cell in ((sheet, parse(sheet.relative)) for sheet in series.sheets) if cell is not None and not cell.odd
    ]
    return Parsed(cells, _scheme(cells), len(series.sheets) - len(cells))


def _scheme(cells: list[tuple[Sheet, Cell]]) -> CityGrid | None:
    return scheme_for(cells[0][1].grammar) if cells else None


def _owner_at(mosaic: Mosaic, x: float, y: float) -> int:
    height, width = mosaic.owner.shape
    return int(mosaic.owner[min(int(y), height - 1), min(int(x), width - 1)])


def mosaic_drawn(ctx: JobContext, mosaic: Mosaic, rectified: list[Rectified]) -> Drawn:
    """The mosaic as a drawn map, each junction named by the sheet it lies on."""
    path = assemble.write_canvas(ctx.local("mosaic.tif"), mosaic.image)
    drawn = drawn_of(path, "grid", max(mosaic.image.shape), framed=False)
    return replace(drawn, parts=tuple(rectified[max(0, _owner_at(mosaic, x, y))].sheet.name for x, y in drawn.junctions))


def _placed(ctx: JobContext, series: SeriesJob, mosaic: Mosaic, drawn: Drawn) -> Attempt | None:
    """The grid placed: from the owner's confirmed grid when the job names one, else searched for on the reference."""
    window = city_window(ctx)
    if window is None:
        return None
    ground = float(numpy.cos(numpy.radians(window.bounds().middle_lat)))
    search = Search((0.0,), mosaic.metres / ground, rigid=True)
    record = ctx.read(f"cities/{ctx.city}/grids/{series.grid_id}") if series.grid_id else None
    start = None if record is None else _grid_matrix(record, mosaic)
    if start is not None:
        return replace(fit_from(ctx, series, drawn, start, search), rival_clean=True)
    return attempt(ctx, series, drawn, window, search)


class GridPlacer:
    """Class b: the series' sheets on the city grid, the grid solved once."""

    def place(self, ctx: JobContext) -> StepResult:
        series = series_of(ctx)
        read = parsed(series)
        if read.scheme is None:
            return _wait_unplaced(ctx, series, "low-confidence", NO_SCHEME)
        rectified = framed(read.cells, read.scheme)
        if not rectified:
            return _wait_unplaced(ctx, series, "frame-not-found", NO_FRAMES)
        if len(rectified) < FRAMED_SHARE_MIN * len(read.cells):
            # Finding of 2026-11-14 (plan cadastral 1911-1914: 20 of 100 sheets framed): a grid of a few framed sheets left the rest
            # out for good and asked for points, while the tile wizard, the one place to lay out the others, said it no longer waited.
            ctx.log.info(f"only {len(rectified)} of {len(read.cells)} sheets framed: laid out as an atlas for the tile wizard", ctx.step)
            return AtlasPlacer().place(ctx)
        return _all_framed(ctx, series, rectified, read.cells, read.scheme)


def _wait_unplaced(ctx: JobContext, series: SeriesJob, reason: str, note: str) -> StepResult:
    """The series waits for points with its sheets as they are, so the georeferencer has a scan to show (finding of 2026-11-14:
    the six 1:500 sets of 1960-71 parked with no picture and the page said "The scan cannot be shown"). One sheet is shown whole;
    several are laid out as an atlas by their edges."""
    if not series.sheets:
        return wait_for_help(ctx, reason, note)
    if len(series.sheets) == 1:
        working = read_working(series.sheets[0].path, LARGEST_WORKING_PX)
        return wait_stitched(ctx, Stitched(working.image, "single", 1, pairs_scale=1 / working.scale), reason, note)
    parts = atlas_parts(series.sheets)
    recorded = fullres.Recorded(parts.originals, parts.layout.size)
    return wait_stitched(ctx, Stitched(parts.canvas(), "atlas", len(series.sheets), record=recorded), reason, note)


def _all_framed(
    ctx: JobContext, series: SeriesJob, rectified: list[Rectified], cells: list[tuple[Sheet, Cell]], scheme: CityGrid
) -> StepResult:
    """The grid solved when every sheet is framed; else the series waits with the unframed ones named."""
    unframed = _unframed(ctx, cells, rectified)
    if unframed:
        return _wait_unframed(ctx, series, rectified, scheme, unframed)
    return _solved(ctx, series, rectified, scheme)


def _wait_unframed(
    ctx: JobContext, series: SeriesJob, rectified: list[Rectified], scheme: CityGrid, unframed: tuple[tuple[str, str], ...]
) -> StepResult:
    """Most sheets framed, some not: the series waits in Help calibrate with the framed sheets' mosaic and the others named
    (`no-frame`), never placed without them (lesson of 2026-11-24: a sheet left out of the map must be seen)."""
    mosaic = mosaic_of(rectified, scheme, quarter_order(rectified, scheme))
    note = UNFRAMED.format(count=len(unframed), total=len(unframed) + len(rectified))
    return wait_stitched(ctx, _wait_picture(ctx, mosaic, rectified, unframed, series.colour), "frame-not-found", note)


def _unframed(ctx: JobContext, cells: list[tuple[Sheet, Cell]], rectified: list[Rectified]) -> tuple[tuple[str, str], ...]:
    """The sheets no frame was found on (logged with how the others were framed)."""
    by_content = sum(item.framed_by == "content" for item in rectified)
    ctx.log.info(
        f"{len(rectified)} sheets framed ({by_content} by their drawing's extent), {len(cells) - len(rectified)} without a frame", ctx.step
    )
    kept = {item.sheet.relative for item in rectified}
    return tuple((sheet.name, NO_FRAME) for sheet, _cell in cells if sheet.relative not in kept)


def framed(cells: list[tuple[Sheet, Cell]], scheme: CityGrid) -> list[Rectified]:
    """The sheets whose frame was found, straightened onto their cells: first their neat lines, found with the series' cell
    (`neatline`, lesson of 2026-11-24)."""
    lines = _neat_lines(cells, scheme)
    found = [rectify(sheet, cell, scheme, line) for (sheet, cell), line in zip(cells, lines, strict=True)]
    return [item for item in found if item]


def _neat_lines(cells: list[tuple[Sheet, Cell]], scheme: CityGrid) -> list[NeatLine | None]:
    """Each sheet's neat line found with the series' cell (its shape from the first sheet's box)."""
    if not cells:
        return []
    box = scheme.box(cells[0][1])
    return neatline.series_frames([sheet.path for sheet, _cell in cells], box.width / box.height)


def _framed_overview(ctx: JobContext, rectified: list[Rectified]) -> Path | None:
    root = store_of(ctx).files(text_param(ctx.job.params, "archiveId"))
    return find_overview(root, [item.sheet.path for item in rectified])


def _overview_picture(ctx: JobContext, rectified: list[Rectified], unframed: tuple[tuple[str, str], ...], colour: bool) -> Stitched | None:
    """The framed sheets laid on an archive overview (in their colour for a colour series), or None when none is found or too few
    match."""
    overview = _framed_overview(ctx, rectified)
    if overview is None:
        return None
    made = overview_canvas([(item.sheet.name, item.sheet.path) for item in rectified], overview, CanvasOpts(colour=colour))
    if made is None:
        return None
    canvas, report = made
    left = tuple((name, NO_JOIN) for name in report.unplaced) + unframed
    quality = JoinQuality(links=len(report.placed), mean_inliers=0.0, rms_px=report.rms_px)
    parts = _overview_record(rectified, report.on_canvas, (canvas.shape[1], canvas.shape[0]))
    return Stitched(canvas, "overview", len(rectified) + len(unframed), left, joins=quality, record=parts)


def _overview_record(rectified: list[Rectified], on_canvas: dict[str, numpy.ndarray], size: tuple[int, int]) -> fullres.Recorded:
    tiles = [(item.sheet.name, item.sheet.path) for item in rectified]
    return fullres_parts.overview_parts(tiles, on_canvas, CanvasOpts().read_px, size)


def _wait_picture(
    ctx: JobContext,
    mosaic: Mosaic,
    rectified: list[Rectified],
    unframed: tuple[tuple[str, str], ...],
    colour: bool,
) -> Stitched:
    """Prefer the overview mosaic for the georeferencer; else the name/frame mosaic."""
    overviewed = _overview_picture(ctx, rectified, unframed, colour)
    if overviewed is not None:
        return overviewed
    return Stitched(mosaic.image, "grid", len(rectified) + len(unframed), unframed, mosaic.metres, record=mosaic.record)


def _solved(
    ctx: JobContext, series: SeriesJob, rectified: list[Rectified], scheme: CityGrid, unframed: tuple[tuple[str, str], ...] = ()
) -> StepResult:
    """The quarter order chosen, the grid placed and the sheets rendered; or a wait for a person with the mosaic to place when the
    grid does not prove."""
    order = quarter_order(rectified, scheme)
    mosaic = mosaic_of(rectified, scheme, order)
    found = _placed(ctx, series, mosaic, mosaic_drawn(ctx, mosaic, rectified))
    held = None if found is None else found.held()
    if held is not None:
        ctx.log.info(f"the grid is placed, its quarters read in order {order}", ctx.step)
        return _rendered(ctx, series, Solved(rectified, scheme, order, mosaic, held[0].transform), Placed("grid", held[0].checked, True))
    if found is None or found.fit is None:
        return wait_stitched(ctx, _wait_picture(ctx, mosaic, rectified, unframed, series.colour), "low-confidence", NOT_PROVED)
    ctx.log.info(f"the grid did not prove: placed from the sheets' names for the owner to approve, order {order}", ctx.step)
    placed = Placed(OWNER_METHOD, found.fit.checked, found.rival_clean)
    return _rendered(ctx, series, Solved(rectified, scheme, order, mosaic, found.fit.transform), placed)


@dataclass(frozen=True)
class Solved:
    """A placed grid: the framed sheets, the scheme and quarter order, the mosaic and its transform to Mercator metres."""

    rectified: list[Rectified]
    scheme: CityGrid
    order: int
    mosaic: Mosaic
    transform: Transform


@dataclass(frozen=True)
class Placed:
    """How the grid was placed: proved (`grid`) or from the names alone (`grid-names`), its checks and its rival search."""

    method: str
    checks: Checked
    rival_clean: bool


def _rendered(ctx: JobContext, series: SeriesJob, solved: Solved, placed: Placed) -> StepResult:
    """Every framed sheet rendered into the series' `warped.tif`, and the report with its seams."""
    origin = (solved.mosaic.west, solved.mosaic.north, solved.mosaic.metres)
    warps = [
        SheetWarp.of(item.sheet.path, item.corners, solved.scheme.box(item.cell, solved.order), origin, solved.transform)
        for item in solved.rectified
    ]
    warped = render_sheets(warps, ctx.local("warped.tif"), resolution_of(ctx.job.params), series.nearest)
    record = {"order": solved.order, "sheets": [item.sheet.name for item in solved.rectified]}
    ctx.local("placed.json").write_text(json.dumps(record), encoding="utf-8")
    seam = seam_score(solved.rectified, solved.scheme, solved.order)
    placement = Placement(placed.method, series.encoding, placed.checks, placed.rival_clean, series.scale, series.paper_transparent, seam)
    return finish(ctx, placement, warped, len(solved.rectified))
