"""Documents, geometry helpers, rasters, images and the job log: the small pieces the steps stand on."""

import io
import logging
from pathlib import Path

import cv2
import numpy
import pytest
from hcm_pipeline.documents import GeorefInfo, Scene, city_bounds, log_id, log_line
from hcm_pipeline.geo import Bounds, Grid, MercatorBox, fnv1a, ground_scale, numbers_of, to_lnglat, to_mercator, zoom_resolution
from hcm_pipeline.images import ImageError, enhance, resize, write_jpeg, write_png
from hcm_pipeline.joblog import MAX_LINES, JobLog, scrub
from hcm_pipeline.model import DocumentError, Timestamp, bounds_of, require_transform
from hcm_pipeline.rasters import GeoTiff, RasterError, fit_long_side, open_raster, raster_info, read_band, to_uint8, write_geotiff

from tests.fakes.documents import MemoryStore

LOGS = "cities/bucharest/jobs/job-1/logs"


def test_happy_path_a_footprint_without_corners_gives_its_extreme_vertices() -> None:
    footprint = [
        {"lat": 44.6, "lng": 25.9},
        {"lat": 44.62, "lng": 26.3},
        {"lat": 44.3, "lng": 26.32},
        {"lat": 44.28, "lng": 25.92},
        {"lat": 44.45, "lng": 25.88},
    ]
    scene = Scene.of("E1", {"acquisitionDate": "1966-07-12", "footprint": footprint})

    assert scene.corners is None
    assert scene.corner_quad() == ((44.6, 25.9), (44.62, 26.3), (44.3, 26.32), (44.28, 25.92))


def test_bad_path_a_diagonal_strip_footprint_gives_four_different_corners() -> None:
    """DS1111-1020AF035 (live 2026-11-14): one vertex is both farthest north-east and farthest south-east."""
    footprint = [
        {"lat": 45.751, "lng": 23.762},
        {"lat": 43.748, "lng": 26.645},
        {"lat": 43.882, "lng": 26.923},
        {"lat": 45.963, "lng": 23.947},
    ]
    quad = Scene.of("DS1111-1020AF035", {"acquisitionDate": "1970-07-24", "footprint": footprint}).corner_quad()

    assert quad == ((45.963, 23.947), (43.882, 26.923), (43.748, 26.645), (45.751, 23.762))
    assert len(set(quad)) == len(quad)


def test_bad_path_scenes_need_a_footprint_and_georefs_a_list_of_pairs() -> None:
    with pytest.raises(DocumentError, match="at least three places"):
        Scene.of("E1", {"acquisitionDate": "1966-07-12", "footprint": [{"lat": 1, "lng": 2}]})
    with pytest.raises(DocumentError, match="gcps must be a list"):
        GeorefInfo.of({"method": "gcps", "transform": "affine", "gcps": {}})
    with pytest.raises(DocumentError, match="transform must be one of"):
        require_transform("tps3")
    with pytest.raises(DocumentError, match="west < east"):
        bounds_of({"west": 2, "south": 1, "east": 1, "north": 2})
    with pytest.raises(DocumentError, match="known level"):
        log_line(500, "info", "x", Timestamp(1))
    assert city_bounds({"bounds": {"west": 1, "south": 2, "east": 3, "north": 4}}) == Bounds(1, 2, 3, 4)


def test_bad_path_number_records_need_every_number() -> None:
    with pytest.raises(ValueError, match="expected a record"):
        numbers_of([1, 2], ("x",))
    with pytest.raises(ValueError, match="x must be a number"):
        numbers_of({"x": True}, ("x",))


def test_happy_path_mercator_grids_and_hashes() -> None:
    x, y = to_mercator(26.1, 44.43)
    box = MercatorBox(x, y, x + 1000, y + 500)
    grid = Grid.over(box, 10)

    assert to_lnglat(x, y) == pytest.approx((26.1, 44.43))
    assert (grid.width, grid.height) == (100, 50)
    assert grid.scaled(4).width == 25
    assert grid.box() == box
    assert box.expanded(0.1).width == pytest.approx(1200)
    assert zoom_resolution(16) == pytest.approx(2.388657133911758)
    assert ground_scale(60) == pytest.approx(0.5)
    assert fnv1a("") == "cbf29ce484222325"
    assert fnv1a("a") == "af63dc4c8601ec8c"


def test_happy_path_rasters_round_trip_and_stretch(tmp_path: Path) -> None:
    pixels = numpy.arange(64, dtype=numpy.uint8).reshape(8, 8)
    path = write_geotiff(tmp_path / "a.tif", GeoTiff([pixels, numpy.full((8, 8), 255, numpy.uint8)], (0, 10, 0, 80, 0, -10), alpha=True))

    info = raster_info(path)

    assert (info.width, info.height, info.bands, info.georeferenced) == (8, 8, 2, True)
    assert numpy.array_equal(read_band(path), pixels)
    assert read_band(path, 1, (4, 4)).shape == (4, 4)
    wide = numpy.linspace(0, 4000, 100).reshape(10, 10)
    stretched = to_uint8(wide)
    assert (int(stretched.min()), int(stretched.max())) == (0, 255)
    assert fit_long_side(4000, 1000, 2048) == (2048, 512, 0.512)
    assert fit_long_side(100, 50, 2048) == (100, 50, 1.0)


def test_bad_path_an_unreadable_raster_is_a_raster_error(tmp_path: Path) -> None:
    broken = tmp_path / "broken.tif"
    broken.write_bytes(b"II*\x00garbage")

    with pytest.raises(RasterError, match=r"GDAL cannot read broken\.tif"):
        open_raster(broken)


def test_happy_path_images_are_written_and_enhanced(tmp_path: Path) -> None:
    grey = numpy.tile(numpy.arange(0, 64, dtype=numpy.uint8), (32, 1))
    rgba = numpy.dstack([grey, grey, grey, numpy.full_like(grey, 200)])

    jpeg = write_jpeg(tmp_path / "a.jpg", numpy.dstack([grey, grey, grey]))
    png = write_png(tmp_path / "a.png", rgba)

    assert numpy.asarray(cv2.imread(str(jpeg))).shape == (32, 64, 3)
    assert numpy.asarray(cv2.imread(str(png), cv2.IMREAD_UNCHANGED)).shape == (32, 64, 4)
    assert resize(grey, (128, 64)).shape == (64, 128)
    assert enhance(grey).dtype == numpy.uint8


def test_bad_path_an_image_opencv_cannot_encode_is_an_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cv2, "imencode", lambda *_args: (False, None))

    with pytest.raises(ImageError, match=r"could not encode a\.png"):
        write_png(tmp_path / "a.png", numpy.zeros((2, 2), numpy.uint8))


def test_happy_path_the_job_log_writes_redacted_numbered_lines() -> None:
    store = MemoryStore()
    store.seed(f"{LOGS}/000000", {"seq": 0})
    stream = io.StringIO()
    logger = logging.getLogger("hcm_pipeline.test-joblog")
    logger.addHandler(logging.StreamHandler(stream))
    job_log = JobLog(store, LOGS, lambda: 1792000000.0, logger)

    job_log.info("fetching https://dds.cr.usgs.gov/x.tgz?sig=abc for ops@example.org", "fetch")
    job_log.warn("slow")
    job_log.error("failed")

    assert store.get(f"{LOGS}/000001") == {
        "seq": 1,
        "level": "info",
        "step": "fetch",
        "message": "fetching https://dds.cr.usgs.gov/x.tgz?[REDACTED] for [EMAIL]",
        "updatedBy": "system:pipeline",
        "updatedAt": Timestamp(1792000000),
    }
    assert [(store.get(f"{LOGS}/{log_id(seq)}") or {}).get("level") for seq in (2, 3)] == ["warn", "error"]
    assert "sig=abc" not in stream.getvalue()


def test_bad_path_the_job_log_stops_at_500_lines_and_skips_taken_numbers() -> None:
    store = MemoryStore()
    log = JobLog(store, LOGS, lambda: 0.0, logging.getLogger("hcm_pipeline.test-joblog"))
    log.info("first")
    store.seed(f"{LOGS}/000001", {"seq": 1})

    log.info("second")
    for index in range(MAX_LINES):
        log.info(f"line {index}")

    assert store.get(f"{LOGS}/000002") is not None
    assert len(store.list_ids(LOGS)) == MAX_LINES
    assert scrub("token=abc") == "token=[REDACTED]"


def test_bad_path_a_line_whose_numbers_are_all_taken_is_dropped_after_three_tries() -> None:
    store = MemoryStore()
    log = JobLog(store, LOGS, lambda: 0.0, logging.getLogger("hcm_pipeline.test-joblog"))
    log.info("first")
    for seq in (1, 2, 3):
        store.seed(f"{LOGS}/{log_id(seq)}", {"seq": seq, "message": "another run"})

    log.info("lost")

    assert [(store.get(f"{LOGS}/{log_id(seq)}") or {}).get("message") for seq in (1, 2, 3)] == ["another run"] * 3
    assert store.get(f"{LOGS}/{log_id(4)}") is None
    log.info("next")
    assert (store.get(f"{LOGS}/{log_id(4)}") or {}).get("message") == "next"
