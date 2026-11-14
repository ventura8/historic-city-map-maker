"""`locate`: where the frame lies, and the city crop (docs/research/M3-interfaces.md §5.4, docs/research/M9-calibration.md).

The scene's corners (else its footprint's extremes) give the plausible orientations; `calibrate/` looks for the frame by the tile votes
over its preview and proves what they propose with no landmark. **Proved:** the crop is what the frame reaches of the city window, through
the proved map, on the exposure; the tiles go to `calibration.json` for `georef`, so a retry does not measure them again, and the USGS
delivery is deleted (M7 §5). **Not proved:** `bounded_crop` holds the window with a margin under the orientations that reach it, cut to
what a scan may hold; the delivery stays, the matcher still runs and the admin's points are next. A frame that does not reach the window
fails with `apiError.imagery.cityNotFound`; a panoramic camera's frame is read on its exposure alone. Finding 57 of 2026-11-01: the frame
is never read whole; the search reads `stitch`'s shrunk preview, and everything else is read window by window out of the segments, each
staged, read and let go in turn. `version.calibration` records what happened; it is what the admin shows. The search is held to its
camera's `search_seconds` (live 2026-11-12: a KH-5 Argon frame, 550 km across, searched an hour with no end): past it the windows left
are not searched. **Not proved, and no guess to cut it by** (a strip none of whose windows was proved, a search out of time, a frame
over `whole.WHOLE_MAX_PX`): the scan is the whole exposure shrunk, with no corner pairs, and waits for the owner's rough points, around
which `steps/recrop.py` cuts the film at full resolution (`steps/whole.py`; live 2026-11-12: a Corona strip kept its first window,
countryside).
"""

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import numpy

from hcm_pipeline.calibrate.camera import PANORAMIC_MAP_SENSORS
from hcm_pipeline.calibrate.chain import Found, FrameSearch, find_frame
from hcm_pipeline.calibrate.dense import Box
from hcm_pipeline.calibrate.poly import PlaceMap
from hcm_pipeline.calibrate.prior import MeasuredModel, pass_key
from hcm_pipeline.calibrate.proof import Proof
from hcm_pipeline.calibrate.reach import measured_pct, outline, proved_box, reach_of
from hcm_pipeline.calibrate.stored import StoredTiles
from hcm_pipeline.calibrate.strip import Windowed, best_of, searches
from hcm_pipeline.contract import MAX_SCAN_PIXELS, SENSOR_SPECS, Errors, SensorSpec
from hcm_pipeline.documents import GeorefInfo, Scene, city_bounds
from hcm_pipeline.frames import FRAME_JSON, FRAME_PREVIEW, FrameLayout, Placement, Segment
from hcm_pipeline.geo import Grid, MercatorBox, fnv1a, to_lnglat, to_mercator
from hcm_pipeline.georef.corners import (
    Assignment,
    CityNotFoundError,
    Crop,
    Frame,
    around,
    bounded_crop,
    crop_box,
    first_guesses,
    frame_corners,
    inside_world,
    on_exposure,
    reaching,
)
from hcm_pipeline.georef.film_edge import exposed_area, trimmed
from hcm_pipeline.georef.panoramic import PanoramicCamera
from hcm_pipeline.georef.transforms import Gcp
from hcm_pipeline.images import UInt8Array, as_uint8, resize, seeded
from hcm_pipeline.jobs import Done, JobContext, StepFailedError, StepResult
from hcm_pipeline.model import UsgsImportParams
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import GTIFF_OPTIONS, GeoTiff, driver_of, read_band, to_uint8, write_geotiff
from hcm_pipeline.steps.common import city_window, gdal_step, grey_reference, publish_scan, sentinel2
from hcm_pipeline.steps.whole import POINTS_NEXT, Limits, WholeFrame, mark, offered_whole, shrink
from hcm_pipeline.store import DELETE

# The frame is shrunk until a pixel is about this many metres before the votes read it.
SCORING_PIXEL_M: Final = 30.0
# The step whose output is the USGS delivery, and the prefix every delivery lives under (`paths.usgs_raw`).
DELIVERY_STEP: Final = "fetch"
USGS_RAW_PREFIX: Final = "usgs-raw/"
# A film this share of the sensor's full aspect or longer swept the whole angle (four real KH-9 frames: 19.6 to 20.5 for 20.2).
FULL_SWEEP_SHARE: Final = 0.9
PERCENT: Final = 100.0
# The frame cameras whose delivery holds the film's black border inside the city crop (`inside_film`).
FILM_EDGE_SENSORS: Final = frozenset({"KH-9-mapping"})
# Rows of a crop copied at a time: at a Corona strip's 35,000 columns, about 36 MB.
CROP_BLOCK_ROWS: Final = 1024


def _scene(ctx: JobContext, entity: UsgsImportParams) -> Scene:
    record = ctx.read(f"cities/{ctx.city}/usgsScenes/{entity.entity_id}")
    if record is None:
        raise StepFailedError(Errors.NOT_FOUND, f"the scene {entity.entity_id} is not harvested")
    return Scene.of(entity.entity_id, record)


def frame_pixel_m(scene: Scene, size: tuple[int, int]) -> float:
    """The frame's approximate pixel size in EPSG:3857 metres: its longer side on the ground over its longer side on film. A strip may
    run north-south and be scanned with that side as its width: its short edge over its width read ten times too fine, and the votes
    got a preview shrunk ten times too far."""
    (nw_lat, nw_lng), (ne_lat, ne_lng), (se_lat, se_lng), _ = around(scene.corner_quad(), scene.corner_quad()[0][1])
    (x0, y0), (x1, y1), (x2, y2) = to_mercator(nw_lng, nw_lat), to_mercator(ne_lng, ne_lat), to_mercator(se_lng, se_lat)
    return max(max(math.hypot(x1 - x0, y1 - y0), math.hypot(x2 - x1, y2 - y1)) / max(size), 1e-3)


def scoring_frame(preview: Path, width: int, height: int, pixel_m: float) -> Frame:
    """The frame (`width` by `height` at full resolution) from its preview, averaged to about `SCORING_PIXEL_M` per pixel. A blur
    only costs the votes (the 1982 frame: 15 tiles agree with one cell of it, 17 without). Never enlarged: it holds nothing the preview
    does not, and a side over 32 767 pixels is more than `cv2.remap` takes
    (a KH-9 frame over 2 m a pixel by its corners would be: its corners' pixel is the whole frame's mean, not the nadir's)."""
    pixels = to_uint8(read_band(preview, 1))
    factor = max(1.0, SCORING_PIXEL_M / pixel_m)
    size = (max(1, round(width / factor)), max(1, round(height / factor)))
    shrunk = resize(pixels, size) if size[0] < pixels.shape[1] else pixels
    return Frame(shrunk, width / shrunk.shape[1], width, height)


def shorter_sweep(spec: SensorSpec, layout: FrameLayout) -> float | None:
    """How far a camera swung for a film shorter than its full sweep's (the film runs at one angle a pixel); None: the full sweep."""
    aspect = layout.image_width / max(layout.height, 1)
    if spec.half_angle_deg is None or spec.full_aspect is None or aspect >= FULL_SWEEP_SHARE * spec.full_aspect:
        return None
    return 2 * spec.half_angle_deg * aspect / spec.full_aspect


def camera_of(sensor: str, layout: FrameLayout) -> PanoramicCamera | None:
    """The panoramic model's camera when the sensor has a half angle; the exposure's span from `stitch`'s `exposure_span`."""
    spec = SENSOR_SPECS[sensor]
    half_angle = spec.half_angle_deg
    return None if half_angle is None else PanoramicCamera(half_angle, layout.image_width, layout.image_start, shorter_sweep(spec, layout))


def rad_per_px(sensor: str, layout: FrameLayout) -> float | None:
    """Radians a film column of a camera `georef` fits a panoramic map for (M15 §2): its sweep over the exposure, a shorter film's at the
    full film's rate; None for any other camera."""
    spec = SENSOR_SPECS[sensor]
    half, aspect = spec.half_angle_deg, spec.full_aspect
    if sensor not in PANORAMIC_MAP_SENSORS or half is None or aspect is None:
        return None
    full = aspect * layout.height
    span = full if shorter_sweep(spec, layout) is not None else min(layout.image_width, full)
    return math.radians(2 * half) / max(span, 1.0)


def film_limits(camera: PanoramicCamera | None, layout: FrameLayout) -> tuple[int, int, int]:
    """What a crop may hold: up to this column, up to this row, from this column (a panoramic camera's frame: its exposure)."""
    return (
        (layout.width, layout.height, 0) if camera is None else (camera.image_start + camera.image_width, layout.height, camera.image_start)
    )


def write_crop(ctx: JobContext, layout: FrameLayout, box: Crop, target: Path) -> Path:
    """The frame's pixels in `box` as a GeoTIFF, copied out of the segments that cover it, one at a time (a later one on top),
    `CROP_BLOCK_ROWS` rows at a time: the crop is never held whole (reports/resource-audit.md: a city on a KH-9 frame was 2.5 GB as
    one array, held again for its preview)."""
    dataset = driver_of("GTiff").Create(str(target), box.width, box.height, 1, gdal.GDT_Byte, list(GTIFF_OPTIONS))
    window = (box.left, box.top, box.width, box.height)
    for placement in layout.covering(window):
        _copy_rows(ctx, placement, placement.window(window) or window, (dataset.GetRasterBand(1), box.left, box.top))
    dataset.Close()
    return target


def _copy_rows(ctx: JobContext, placement: Placement, part: tuple[int, int, int, int], onto: tuple[gdal.Band, int, int]) -> None:
    """`part` (in the frame's pixels) of one segment onto the crop's band, whose corner lies at `onto`'s column and row of the frame."""
    x, y, width, height = part
    band, left, top = onto
    segment = Segment(ctx.stage(placement.path))
    for row in range(y, y + height, CROP_BLOCK_ROWS):
        rows = min(CROP_BLOCK_ROWS, y + height - row)
        band.WriteArray(segment.read(x - placement.x, row - placement.y, width, rows), x - left, row - top)
        ctx.checkpoint()
    segment.close()
    ctx.unstage(placement.path)


def delete_delivery(ctx: JobContext) -> None:
    """The job's USGS delivery deleted once a full-resolution city crop is recorded (M7 §5): after a proved crop, or after `recrop` cut
    the film around the owner's points. Never after a guess or a whole frame shrunk, on a worker or not (live 2026-11-14, DS1111: a
    shrunk whole strip deleted it, and only a new fetch could cut the city at full resolution if the segments were lost). Only a
    `usgs-raw/` object, a missing one is fine (a retry of `locate`, or another city's job deleted it first)."""
    delivery = ctx.job.step(DELIVERY_STEP).gcs_path
    if delivery is None or not delivery.startswith(USGS_RAW_PREFIX):
        return
    ctx.services.objects.delete(delivery)
    ctx.log.info(f"the USGS delivery {delivery} is deleted: the city crop is recorded", LocateStep.name)


class SegmentReader:
    """The film of a job's frame, read by windows out of its segments, each staged and let go in turn."""

    def __init__(self, ctx: JobContext, layout: FrameLayout) -> None:
        self._ctx, self._layout = ctx, layout

    def read(self, box: Box, factor: int) -> UInt8Array:
        """`box` (left, top, right, bottom) averaged `factor` times; a later segment on top."""
        left, top, right, bottom = box
        pixels = numpy.zeros(((bottom - top) // factor, (right - left) // factor), numpy.uint8)
        for placement in self._layout.covering((left, top, right - left, bottom - top)):
            self._onto(pixels, placement, box, factor)
        return as_uint8(pixels)

    def _onto(self, pixels: UInt8Array, placement: Placement, box: Box, factor: int) -> None:
        first_x, first_y = -((box[0] - placement.x) // factor), -((box[1] - placement.y) // factor)
        last_x = min((placement.x + placement.width - box[0]) // factor, pixels.shape[1])
        last_y = min((placement.y + placement.height - box[1]) // factor, pixels.shape[0])
        first_x, first_y = max(first_x, 0), max(first_y, 0)
        if last_x <= first_x or last_y <= first_y:
            return
        x, y = box[0] + first_x * factor - placement.x, box[1] + first_y * factor - placement.y
        size = (last_x - first_x, last_y - first_y)
        segment = Segment(self._ctx.stage(placement.path))
        pixels[first_y:last_y, first_x:last_x] = segment.averaged_window(x, y, size[0] * factor, size[1] * factor, size)
        segment.close()
        self._ctx.unstage(placement.path)
        self._ctx.checkpoint()


def proved_gcps(mapping: PlaceMap, box: Box) -> tuple[Gcp, ...]:
    """Four GCPs at the crop's corners through the proved map (`origin: 'corner'`): they stand until `georef` fits the tiles."""
    offset = numpy.array([box[0], box[1]])
    corners = inside_world(frame_corners(box[2] - box[0], box[3] - box[1]), lambda crop: mapping.to_places(crop + offset))
    places = mapping.to_places(corners + offset)
    gcps = []
    for index, (corner, place) in enumerate(zip(corners.tolist(), places.tolist(), strict=True), start=1):
        lng, lat = to_lnglat(place[0], place[1])
        gcps.append(Gcp(f"c{index}", corner[0], corner[1], lat, lng, True, "corner"))
    return tuple(gcps)


def _wide_reference(ctx: JobContext, box: MercatorBox) -> tuple[UInt8Array, Grid] | None:
    """Sentinel-2 over the wider box a matcher's proposal is proved on (M10); one that cannot be had costs the matcher, not the job."""
    try:
        source = sentinel2(ctx, box)
    except StepFailedError as error:
        ctx.log.warn(f"the wider reference is not to be had ({error}): the proposal is proved over the city's window", LocateStep.name)
        return None
    return grey_reference(source), source.grid()


def _pass_prior(ctx: JobContext, scene: Scene) -> MeasuredModel | None:
    """The last proved frame of the scene's pass, when the city has one (only a first place to look)."""
    key = pass_key(scene.entity_id, scene.acquisition_date)
    record = None if key is None else ctx.read(f"cities/{ctx.city}/imageryPasses/{key}")
    return None if record is None else MeasuredModel.of(record.get("model"))


@dataclass(frozen=True)
class Proved:
    """A proof that holds a map: its verdict, the map and the polynomial's order."""

    proof: Proof
    mapping: PlaceMap
    order: int


class SearchTimeUpError(Exception):
    """The frame's search ran out of its time."""


class SearchBudget:
    """The chain's tick held to `seconds` from the first search: past it the chain stops, and each window left answers not found."""

    def __init__(self, ctx: JobContext, seconds: float) -> None:
        self._ctx = ctx
        self._seconds = seconds
        self._ends_at = ctx.services.clock() + seconds
        self.timed_out = False

    def tick(self) -> None:
        self._ctx.checkpoint()
        if self._ctx.services.clock() > self._ends_at:
            raise SearchTimeUpError

    def find(self, search: FrameSearch, say: Callable[[str], None]) -> Found:
        if not self.timed_out:
            try:
                return find_frame(search, self.tick, say)
            except SearchTimeUpError:
                self.timed_out = True
                say(f"the search ran out of its {round(self._seconds / 60)} min: the whole frame is offered, points are next")
        return Found(None, "none", None, (0, 0), None, ())


class LocateStep:
    name = "locate"

    def run(self, ctx: JobContext) -> StepResult:
        entity = UsgsImportParams.of(ctx.job.params)
        scene = _scene(ctx, entity)
        window = city_window(ctx)
        layout = FrameLayout.from_json(ctx.stage(ctx.work_file(FRAME_JSON), FRAME_JSON).read_text(encoding="utf-8"))
        preview = ctx.stage(ctx.work_file(FRAME_PREVIEW), FRAME_PREVIEW)
        try:
            windows = self._search(ctx, (scene, entity.sensor), window, preview, layout)
            say = self._say(ctx)
            budget = SearchBudget(ctx, SENSOR_SPECS[entity.sensor].search_seconds)
            search, found = gdal_step(ctx, lambda: best_of(windows, lambda each: budget.find(each, say), say), "search the frame")
            return self._cropped(ctx, search, found, layout, budget.timed_out)
        except CityNotFoundError as error:
            raise StepFailedError(Errors.CITY_NOT_FOUND, str(error)) from error

    def _cropped(self, ctx: JobContext, search: FrameSearch, found: Found, layout: FrameLayout, timed_out: bool = False) -> StepResult:
        proof = found.proof
        if proof is None or proof.mapping is None or proof.forward is None:
            return self._unproved(ctx, search, found, layout, timed_out)
        return self._proved(ctx, search, found, Proved(proof, proof.mapping, proof.forward.order), layout)

    def _unproved(self, ctx: JobContext, search: FrameSearch, found: Found, layout: FrameLayout, timed_out: bool) -> StepResult:
        """A guess cuts the frame only when it was searched whole, in time, and is no larger than a scan shown whole."""
        limits = film_limits(camera_of(search.sensor, layout), layout)
        if offered_whole(search.limits, limits, timed_out):
            return self._whole(ctx, found, layout, (limits, expected_boxes(search, found)))
        return self._not_proved(ctx, search, found, layout)

    def _whole(self, ctx: JobContext, found: Found, layout: FrameLayout, framed: tuple[Limits, list[Box]]) -> StepResult:
        """The whole exposure, shrunk to what the georeferencer shows, with no corner pairs: the owner's rough points are next. Where the
        scene's corners put the city, most voted first, goes with it (`calibration.expected`, the scan's pixels): the georeferencer opens
        there instead of on the whole strip (admin sweep 2026-11-14, bug 6)."""
        limits, boxes = framed
        whole = WholeFrame(shrink(limits), limits[2], 0)
        box = (limits[2], 0, limits[0], limits[1])
        pixels = gdal_step(ctx, lambda: SegmentReader(ctx, layout).read(box, whole.factor), "read the whole frame")
        scan = publish_scan(ctx, mark(write_geotiff(ctx.local("scan.tif"), GeoTiff([pixels])), whole), pixels)
        record = _refusal_record(found, 0)
        expected = on_scan(boxes, whole, (scan.width, scan.height))
        calibration = {**record, "expected": expected} if expected else record
        ctx.update_version({"scan": scan.as_record(), "georef": DELETE, "calibration": calibration})
        ctx.log.warn(f"{_why_not(found)} in any part of the frame: {_whole_line(whole, scan.width, scan.height)}", self.name)
        return Done(ctx.services.objects.stat(scan.path), scan.sha256)

    def _say(self, ctx: JobContext) -> Callable[[str], None]:
        return lambda line: ctx.log.info(line, self.name)

    def _search(self, ctx: JobContext, shot: tuple[Scene, str], window: MercatorBox, preview: Path, layout: FrameLayout) -> list[Windowed]:
        scene, sensor = shot
        source = sentinel2(ctx, window)
        grid = source.grid()
        camera = camera_of(sensor, layout)
        size = (layout.width, layout.height)
        frame = on_exposure(gdal_step(ctx, lambda: scoring_frame(preview, *size, frame_pixel_m(scene, size)), "read the frame"), camera)
        firsts = first_guesses(frame, scene.corner_quad(), grid.box(), camera)
        spec = SENSOR_SPECS[sensor]
        seed = int(fnv1a(ctx.job.id)[:7], 16)
        seeded(seed)
        whole = FrameSearch(
            frame,
            tuple(firsts),
            grey_reference(source),
            grid,
            SegmentReader(ctx, layout),
            film_limits(camera, layout),
            spec.search,
            camera,
            sensor,
            seed,
            _pass_prior(ctx, scene),
            matcher=ctx.services.proposal_matcher,
            wide=lambda box: _wide_reference(ctx, box),
        )
        reach = grid.scaled(_REACH_FACTOR)
        return searches(whole, spec.strip, lambda film, firsts: reaching(film, firsts, reach, spec.search.margin_ground_m))

    def _proved(self, ctx: JobContext, search: FrameSearch, found: Found, proved: Proved, layout: FrameLayout) -> StepResult:
        window, limits, mapping = search.window, search.limits, proved.mapping
        box = proved_box(reach_of(mapping, window, limits), limits)
        if box is None:
            raise CityNotFoundError
        box = inside_film(ctx, search.sensor, box, layout)
        located = Crop(box[0], box[1], box[2] - box[0], box[3] - box[1], proved_gcps(mapping, box))
        local = gdal_step(ctx, lambda: write_crop(ctx, layout, within_limits(located), ctx.local("scan.tif")), "crop the frame")
        camera = rad_per_px(search.sensor, layout)
        stored = StoredTiles(proved.proof.measured.rows, proved.order, box[0], box[1], window.bounds().middle_lat, camera)
        ctx.publish(stored.write(ctx.local(CALIBRATION_FILE)), ctx.work_file(CALIBRATION_FILE), "application/json")
        scan = gdal_step(ctx, lambda: publish_scan(ctx, local), "read the crop")
        record = _calibration(ctx, found, mapping, limits)
        georef = GeorefInfo("corners", "affine", located.gcps)
        ctx.update_version({"scan": scan.as_record(), "georef": georef.as_record(), "calibration": record})
        ctx.log.info(_proved_line(proved.proof, record.get("coveredPct"), located), self.name)
        delete_delivery(ctx)
        return Done(ctx.services.objects.stat(scan.path), scan.sha256)

    def _not_proved(self, ctx: JobContext, search: FrameSearch, found: Found, layout: FrameLayout) -> StepResult:
        ranked = _by_votes(search.orientations, found)
        located, cut = bounded_crop(ranked, search.window, search.limits, MAX_SCAN_PIXELS)
        local = gdal_step(ctx, lambda: write_crop(ctx, layout, within_limits(located), ctx.local("scan.tif")), "crop the frame")
        scan = gdal_step(ctx, lambda: publish_scan(ctx, local), "read the crop")
        georef = GeorefInfo("corners", "affine", located.gcps, weak_corners=True)
        record = _refusal_record(found, cut)
        ctx.update_version({"scan": scan.as_record(), "georef": georef.as_record(), "calibration": record})
        ctx.log.warn(_not_proved_line(found, located), self.name)
        return Done(ctx.services.objects.stat(scan.path), scan.sha256)


# The reach is measured at 60 m or so: a share, not a place.
_REACH_FACTOR: Final = 6
CALIBRATION_FILE: Final = "calibration.json"


def _by_votes(orientations: Sequence[Assignment], found: Found) -> list[Assignment]:
    """The orientations most votes named first; of equals, as `reaching` ordered them (coverage, then as given)."""

    def votes(each: Assignment) -> int:
        named = [
            p.agreed
            for p in found.tried
            if (p.hypothesis.assignment.rotation, p.hypothesis.assignment.mirrored) == (each.rotation, each.mirrored)
        ]
        return max(named, default=0)

    return sorted(orientations, key=lambda each: -votes(each))


def _calibration(ctx: JobContext, found: Found, mapping: PlaceMap, limits: tuple[int, int, int]) -> dict[str, object]:
    """`version.calibration` of a proved frame: the city's own bounds, not the window with its margin, decide what it covers."""
    record = ctx.read(f"cities/{ctx.city}") or {}
    reach = reach_of(mapping, city_bounds(record).mercator(), limits)
    fields: dict[str, object] = {
        "how": found.how,
        "votes": {"agreed": found.votes[0], "tiles": found.votes[1]},
        "coveredPct": round(reach.share * PERCENT, 1),
        **_of_the_chain(found),
    }
    edge = outline(reach)
    return {**fields, "outline": edge} if edge else fields


def _of_the_chain(found: Found) -> dict[str, object]:
    """What this proposal and proof add: only what they hold."""
    fields: dict[str, object] = {}
    if found.model is not None:
        fields["model"] = found.model.as_record()
    if found.proposer is not None:
        fields["proposer"] = found.proposer.as_record()
    proof = found.proof
    if proof is not None:
        fields["tiles"] = {"agreed": proof.inliers, "tried": proof.tried}
        fields["crossValidatedM"] = round(proof.checked.cv_m, 2)
        fields["measuredPct"] = measured_pct(proof, found.window_spread)
    return fields


def _refusal_record(found: Found, cut: int) -> dict[str, object]:
    """`version.calibration` of a frame nothing proved."""
    proof = found.refused
    fields: dict[str, object] = {"how": "none", "refusal": "no-votes" if proof is None else proof.refusal}
    if found.votes[1] > 0:
        fields["votes"] = {"agreed": found.votes[0], "tiles": found.votes[1]}
    if proof is not None:
        fields["tiles"] = {"agreed": proof.inliers, "tried": proof.tried}
    return {**fields, "cutOrientations": cut} if cut else fields


def _proved_line(proof: Proof, covered: object, located: Crop) -> str:
    return (
        f"proved: {proof.inliers} of {proof.tried} tiles agree, cross-validated {proof.checked.cv_m:.1f} m, "
        f"covers {covered} % of the city; "
        f"crop {located.width} x {located.height} px, delivery deleted"
    )


def _why_not(found: Found) -> str:
    proof = found.refused
    return f"not proved ({'no-votes' if proof is None else f'{proof.refusal}: {proof.inliers} of {proof.tried}'})"


def _not_proved_line(found: Found, located: Crop) -> str:
    return f"{_why_not(found)}: crop {located.width} x {located.height} px, delivery kept, the admin's points are next"


def _whole_line(whole: WholeFrame, width: int, height: int) -> str:
    return f"the whole frame is the scan, shrunk {whole.factor} times ({width} x {height} px), delivery kept; {POINTS_NEXT}"


def inside_film(ctx: JobContext, sensor: str, box: Box, layout: FrameLayout) -> Box:
    """A frame camera's crop kept off the film's border (`georef/film_edge.py`; admin sweep 2026-11-14, bug 3)."""
    if sensor not in FILM_EDGE_SENSORS:
        return box
    pixels = to_uint8(read_band(ctx.stage(ctx.work_file(FRAME_PREVIEW), FRAME_PREVIEW), 1))
    area = exposed_area(pixels)
    kept = trimmed(box, area, layout.width / pixels.shape[1])
    if kept != box:
        ctx.log.info(f"the film's border is left out of the crop: {box} becomes {kept} (frame pixels)", LocateStep.name)
    return kept


# At most this many places the city may lie, most voted first (`calibration.expected`).
MAX_EXPECTED: Final = 4


def expected_boxes(search: FrameSearch, found: Found) -> list[Box]:
    """The frame pixels (left, top, right, bottom) the city window maps onto under each orientation that reaches it, most voted
    first, without repeats."""
    boxes: list[Box] = []
    right, bottom, start = search.limits
    for orientation in _by_votes(search.orientations, found):
        try:
            box = crop_box(orientation, search.window, right, bottom, start)
        except CityNotFoundError:
            continue
        if box not in boxes:
            boxes.append(box)
    return boxes[:MAX_EXPECTED]


def on_scan(boxes: Sequence[Box], whole: WholeFrame, size: tuple[int, int]) -> list[dict[str, int]]:
    """`boxes` (frame pixels) in a whole frame's scan pixels, clipped to it: `{x, y, width, height}`, empty ones left out."""
    found: list[dict[str, int]] = []
    for left, top, right, bottom in boxes:
        x0, y0 = max(0, (left - whole.left) // whole.factor), max(0, (top - whole.top) // whole.factor)
        x1, y1 = min(size[0], -(-(right - whole.left) // whole.factor)), min(size[1], -(-(bottom - whole.top) // whole.factor))
        if x1 > x0 and y1 > y0:
            found.append({"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0})
    return found


def within_limits(located: Crop) -> Crop:
    """The crop, refused before it is read when a side is over `MAX_SCAN_PIXELS`: a version's scan is never larger
    (`scanSchema`; finding 62 of 2026-11-02: a 300 000-pixel crop made the version unreadable in the admin). `bounded_crop` always
    fits and a proved crop holds only the window: a guard no input reaches."""
    if max(located.width, located.height) > MAX_SCAN_PIXELS:
        why = f"the city crop would be {located.width} x {located.height} pixels, over the {MAX_SCAN_PIXELS} a scan may have"
        raise StepFailedError(Errors.PROCESSING_FAILED, why)
    return located
