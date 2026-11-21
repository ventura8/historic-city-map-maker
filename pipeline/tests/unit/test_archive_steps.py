"""An archive series' job (docs/research/M20-import-local.md §4, §6): `gather` checks the originals where they lie, `place` parks a class
with no path for a person with one line why, and `pyramid`'s tiles follow the series' encoding (line art crisp, its paper transparent).
"""

from collections.abc import Callable
from dataclasses import replace
from pathlib import Path

import numpy
import pytest
from hcm_pipeline.archive import report, sidecar
from hcm_pipeline.archive.intake import ArchiveStore
from hcm_pipeline.archive.model import Probe
from hcm_pipeline.contract import Errors
from hcm_pipeline.documents import Version
from hcm_pipeline.joblog import JobLog
from hcm_pipeline.jobs import Done, JobContext, RunFlags, StepFailedError, StepResult, Waiting
from hcm_pipeline.log import get_logger
from hcm_pipeline.model import Job
from hcm_pipeline.raster import gdal
from hcm_pipeline.steps.export import COG_OPTIONS, LINEART_COG_OPTIONS, Warped, cog_options, uploads_rasters, write_cog
from hcm_pipeline.steps.gather import SHEETS, GatherStep
from hcm_pipeline.steps.place import NO_PATH_NOTE, PlaceStep
from hcm_pipeline.steps.pyramid import series_encoding
from hcm_pipeline.tiles.encoding import ENCODINGS, encoding_of, paper_opaque, paper_transparent

from tests.fakes.world import JOB_ID, PipelineWorld

SERIES_PARAMS = {"class": "grid", "sheets": 2, "encoding": "lineart", "order": 0, "referenceLayerIds": []}


def archive(work: Path) -> tuple[ArchiveStore, str, str]:
    """An archive of two sheets, scanned: the store, its id and its one series' id."""
    store = ArchiveStore(work, lambda _path: Probe("jpeg", 4000, 3000, 3, 8, "rgb"))
    archive_id = store.create()
    for name in ("Harti/1897 plan.jpg", "Harti/1911 plan.jpg"):
        store.receive(archive_id, name, [name.encode()], len(name.encode()))
    made = store.scan(archive_id, report.Context(44.43, 2026, sidecar.Sidecar()))
    return store, archive_id, str(made.series[0]["seriesId"])


def context(world: PipelineWorld, tmp_path: Path, params: dict[str, object], work: Path | None) -> JobContext:
    world.seed_import()
    log = JobLog(world.store, f"{world.job_path()}/logs", world.clock, get_logger("test"))
    job = replace(Job.of(JOB_ID, world.job()), type="archive-series", params=params)
    services = replace(world.services(), archive_root=work)
    return JobContext(world.config, services, job, Version.of(JOB_ID, world.version()), tmp_path / "scratch", RunFlags(), log)


def test_happy_path_gather_finds_the_series_sheets_as_the_scan_read_them(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-GATHER"""
    _store, archive_id, series_id = archive(tmp_path / "work")
    ctx = context(world, tmp_path, {**SERIES_PARAMS, "archiveId": archive_id, "seriesId": series_id}, tmp_path / "work")

    result = GatherStep().run(ctx)

    assert isinstance(result, Done)
    assert '"cell": null' in (tmp_path / "scratch" / SHEETS).read_text(encoding="utf-8")
    assert "1 sheets of series" in world.log_lines()[-1]


def changed(store: ArchiveStore, archive_id: str) -> None:
    for path in store.files(archive_id).rglob("*.jpg"):
        path.write_bytes(b"another map")


def moved(store: ArchiveStore, archive_id: str) -> None:
    for path in store.files(archive_id).rglob("*.jpg"):
        path.unlink()


def unrecorded(store: ArchiveStore, archive_id: str) -> None:
    (store.folder(archive_id) / "archive.json").unlink()


def unsafe(store: ArchiveStore, archive_id: str) -> None:
    record = store.folder(archive_id) / "archive.json"
    record.write_text(record.read_text(encoding="utf-8").replace("Harti/1911", "../1911"), encoding="utf-8")


def untouched(_store: ArchiveStore, _archive_id: str) -> None:
    return


@pytest.mark.parametrize(
    ("damage", "series", "local"),
    [
        (changed, None, True),
        (moved, None, True),
        (unrecorded, None, True),
        (untouched, "s-000000000000", True),
        (unsafe, None, True),
        (untouched, None, False),
    ],
)
def test_bad_path_gather_refuses_originals_that_are_gone_or_changed(
    world: PipelineWorld, tmp_path: Path, damage: Callable[[ArchiveStore, str], None], series: str | None, local: bool
) -> None:
    """Scenarios: S-P20-BAD-ARCHIVE-MISSING"""
    store, archive_id, series_id = archive(tmp_path / "work")
    damage(store, archive_id)
    params: dict[str, object] = {**SERIES_PARAMS, "archiveId": archive_id, "seriesId": series or series_id}
    ctx = context(world, tmp_path, params, tmp_path / "work" if local else None)

    with pytest.raises(StepFailedError) as failed:
        GatherStep().run(ctx)

    assert failed.value.code == Errors.ARCHIVE_MISSING


def test_bad_path_gather_refuses_a_job_without_its_archive(world: PipelineWorld, tmp_path: Path) -> None:
    with pytest.raises(StepFailedError) as failed:
        GatherStep().run(context(world, tmp_path, SERIES_PARAMS, tmp_path / "work"))

    assert failed.value.code == Errors.INVALID_REQUEST


def test_bad_path_a_class_with_no_path_yet_waits_for_a_person_with_why(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-NO-PATH"""
    params = {**SERIES_PARAMS, "class": "cad", "archiveId": "ar-0123456789abcdef", "seriesId": "s-0123456789ab"}
    ctx = context(world, tmp_path, params, None)

    result = PlaceStep().run(ctx)

    assert result == Waiting("awaiting_gcps", "gcps", NO_PATH_NOTE)
    version = world.version()
    assert version["state"] == "needs_gcps"
    help_item = version["help"]
    assert isinstance(help_item, dict)
    assert (help_item["reason"], help_item["note"]) == ("no-path", NO_PATH_NOTE)


class Placed:
    def place(self, ctx: JobContext) -> StepResult:
        ctx.update_version({"archive": {"method": "grid"}})
        return Done()


def test_happy_path_a_class_with_its_path_is_placed_by_it(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-PLACE"""
    ctx = context(world, tmp_path, {**SERIES_PARAMS, "archiveId": "ar-0123456789abcdef", "seriesId": "s-0123456789ab"}, None)

    assert PlaceStep({"grid": Placed()}).run(ctx) == Done()
    assert world.version()["archive"] == {"method": "grid"}


def test_happy_path_each_series_tiles_in_its_encoding_and_every_other_job_in_todays(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-ENCODING"""
    lineart = context(world, tmp_path, {**SERIES_PARAMS, "archiveId": "a", "seriesId": "s"}, None)
    overlay = replace(lineart, job=replace(lineart.job, params={**SERIES_PARAMS, "paperTransparent": True}))
    colour = replace(lineart, job=replace(lineart.job, params={**SERIES_PARAMS, "encoding": "colour"}))
    other = replace(lineart, job=replace(lineart.job, type="usgs-import"))

    assert series_encoding(lineart) == (ENCODINGS["lineart"], False)
    assert series_encoding(overlay) == (ENCODINGS["lineart"], True)
    assert series_encoding(colour) == (ENCODINGS["colour"], None)
    assert series_encoding(other) == (ENCODINGS["grey"], None)
    assert (encoding_of(None), ENCODINGS["grey"].options) == (ENCODINGS["grey"], ("QUALITY=75",))
    assert ENCODINGS["lineart"] == replace(
        ENCODINGS["lineart"], options=("LOSSLESS=YES",), resampling="nearest", overview_resampling="nearest"
    )


def grey_and_alpha(path: Path, bands: int) -> Path:
    driver = gdal.GetDriverByName("GTiff")
    assert driver is not None
    dataset = driver.Create(str(path), 4, 2, bands, gdal.GDT_Byte)
    dataset.SetGeoTransform((0.0, 1.0, 0.0, 2.0, 0.0, -1.0))
    dataset.GetRasterBand(1).WriteArray(numpy.array([[0, 255, 10, 200], [0, 0, 255, 255]], dtype=numpy.uint8))
    if bands > 1:
        dataset.GetRasterBand(2).WriteArray(numpy.array([[255, 255, 0, 255], [255, 255, 255, 255]], dtype=numpy.uint8))
    dataset.Close()
    return path


@pytest.mark.parametrize(("bands", "alpha"), [(2, [[255, 0, 0, 0], [255, 255, 0, 0]]), (1, [[255, 0, 255, 0], [255, 255, 0, 0]])])
def test_happy_path_line_art_keeps_its_ink_black_and_makes_its_paper_and_outside_transparent(
    tmp_path: Path, bands: int, alpha: list[list[int]]
) -> None:
    """Scenarios: S-P20-HAPPY-ENCODING"""
    made = gdal.Open(str(paper_transparent(grey_and_alpha(tmp_path / "warped.tif", bands), tmp_path / "lineart.tif")))

    assert made.GetRasterBand(4).ReadAsArray().tolist() == alpha
    colours = {tuple(made.GetRasterBand(band).ReadAsArray()[row][col] for band in (1, 2, 3, 4)) for row in range(2) for col in range(4)}
    assert colours <= {(0, 0, 0, 255), (255, 255, 255, 0)}


@pytest.mark.parametrize(
    ("bands", "alpha"),
    [(2, [[255, 255, 0, 255], [255, 255, 255, 255]]), (1, [[255, 255, 255, 255], [255, 255, 255, 255]])],
)
def test_happy_path_line_art_default_keeps_opaque_white_paper(tmp_path: Path, bands: int, alpha: list[list[int]]) -> None:
    """Scenarios: S-P20-HAPPY-ENCODING"""
    # Opaque white paper by default (lesson 555, the Post 1847 map).
    made = gdal.Open(str(paper_opaque(grey_and_alpha(tmp_path / "warped.tif", bands), tmp_path / "white.tif")))

    assert made.GetRasterBand(4).ReadAsArray().tolist() == alpha
    colours = {tuple(made.GetRasterBand(band).ReadAsArray()[row][col] for band in (1, 2, 3, 4)) for row in range(2) for col in range(4)}
    assert colours <= {(0, 0, 0, 255), (255, 255, 255, 255), (255, 255, 255, 0)}


def test_happy_path_a_line_art_series_cog_is_lossless_and_every_other_cog_jpeg(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-ENCODING"""
    lineart = context(world, tmp_path, {**SERIES_PARAMS, "archiveId": "a", "seriesId": "s"}, None)
    grey = replace(lineart.job, params={**SERIES_PARAMS, "encoding": "grey"})
    other = replace(lineart.job, type="usgs-import")
    warped = grey_and_alpha(tmp_path / "warped.tif", 2)

    assert cog_options(lineart.job) == LINEART_COG_OPTIONS
    assert cog_options(grey) == cog_options(other) == COG_OPTIONS
    made = gdal.Open(str(write_cog(Warped.of(warped), tmp_path / "cog.tif", LINEART_COG_OPTIONS)))
    assert made.GetMetadataItem("COMPRESSION", "IMAGE_STRUCTURE") == "DEFLATE"


def test_bad_path_an_archive_series_full_resolution_rasters_never_leave_the_computer(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-RASTERS-STAY-LOCAL"""
    series = context(world, tmp_path, {**SERIES_PARAMS, "archiveId": "a", "seriesId": "s"}, None).job
    mapbox_city = {"imagery": {"publishThroughMapbox": True}}

    assert not uploads_rasters(mapbox_city, series)
    assert uploads_rasters(mapbox_city, replace(series, type="usgs-import"))
    assert not uploads_rasters({}, replace(series, type="usgs-import"))


def test_bad_path_line_art_of_a_masked_cog_keeps_outside_the_map_clear(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-ENCODING-MASK"""
    # The export's COG holds one grey band and its alpha as a mask; black outside pixels must not become ink (Post 1847, 2026-11-12).
    source = grey_and_alpha(tmp_path / "masked.tif", 1)
    dataset = gdal.Open(str(source), gdal.GA_Update)
    dataset.CreateMaskBand(gdal.GMF_PER_DATASET)
    dataset.GetRasterBand(1).GetMaskBand().WriteArray(numpy.array([[255, 255, 0, 0], [255, 255, 255, 0]], dtype=numpy.uint8))
    dataset.Close()

    made = gdal.Open(str(paper_opaque(source, tmp_path / "white.tif")))

    assert made.GetRasterBand(4).ReadAsArray().tolist() == [[255, 255, 0, 0], [255, 255, 255, 0]]


def test_bad_path_line_art_without_a_tiff_driver_says_so(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = grey_and_alpha(tmp_path / "warped.tif", 1)
    monkeypatch.setattr(gdal, "GetDriverByName", lambda _name: None)

    with pytest.raises(RuntimeError, match="no GTiff driver"):
        paper_transparent(source, tmp_path / "lineart.tif")
