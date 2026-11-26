"""The steps' refusals and less common paths, driven through the runner against the loopback world."""

import errno
import io
import tarfile
import zipfile
from collections.abc import Callable
from pathlib import Path

import numpy
import pytest
from hcm_pipeline.config import Config, load_config
from hcm_pipeline.contract import Errors
from hcm_pipeline.frames import FrameLayout, Placement
from hcm_pipeline.rasters import GeoTiff, write_geotiff
from hcm_pipeline.runner import RunOutcome
from hcm_pipeline.steps import extract

from tests.fakes.http import Reply
from tests.fakes.world import CITY, ENTITY_ID, JOB_ID, PipelineWorld, dig

RAW = f"usgs-raw/corona2/{ENTITY_ID}/{ENTITY_ID}"
WORK = f"work/{CITY}/{JOB_ID}/"


def only(world: PipelineWorld, step: str, config: Config | None = None) -> RunOutcome:
    return world.runner(config).run(step)


def error_code(world: PipelineWorld, job_id: str = JOB_ID) -> str:
    error = world.job(job_id).get("error")
    assert isinstance(error, dict)
    return str(error["code"])


def fetched(world: PipelineWorld, path: str, data: bytes) -> None:
    world.seed_import()
    world.gcs.put(path, data)
    world.store.update(world.job_path(), {"steps.fetch": {"status": "done", "gcsPath": path}})


def tiff_bytes(tmp_path: Path, pixels: numpy.ndarray) -> bytes:
    return write_geotiff(tmp_path / "member.tif", GeoTiff([numpy.asarray(pixels, numpy.uint8)])).read_bytes()


def test_happy_path_a_zip_delivery_gives_its_segments(world: PipelineWorld, tmp_path: Path) -> None:
    packed = io.BytesIO()
    with zipfile.ZipFile(packed, "w") as archive:
        archive.writestr(f"{ENTITY_ID}/", "")
        archive.writestr(f"{ENTITY_ID}/{ENTITY_ID}_b.TIF", tiff_bytes(tmp_path, numpy.ones((4, 4))))
    fetched(world, f"{RAW}.zip", packed.getvalue())

    assert only(world, "extract") is RunOutcome.DONE
    assert world.gcs.names(WORK) == [f"{WORK}segments/b.tif"]


def tar_of_segments(tmp_path: Path, count: int) -> bytes:
    """A delivery of `count` TIFF members named as USGS names them (`_a`, `_b`, ...)."""
    member = tiff_bytes(tmp_path, numpy.ones((4, 4)))
    packed = io.BytesIO()
    with tarfile.open(fileobj=packed, mode="w:gz") as archive:
        for index in range(count):
            info = tarfile.TarInfo(f"{ENTITY_ID}_{chr(ord('a') + index)}.tif" if index < 26 else f"{ENTITY_ID}.tif")
            info.size = len(member)
            archive.addfile(info, io.BytesIO(member))
    return packed.getvalue()


def test_happy_path_a_panoramic_frames_fourteen_segments_are_all_kept(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P01-HAPPY-ALL-SEGMENTS"""
    fetched(world, f"{RAW}.tgz", tar_of_segments(tmp_path, 14))

    assert only(world, "extract") is RunOutcome.DONE
    assert world.gcs.names(WORK) == [f"{WORK}segments/{letter}.tif" for letter in "abcdefghijklmn"]


def test_bad_path_more_segments_than_any_scan_has_fails_rather_than_cutting_the_frame(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P01-BAD-TOO-MANY-SEGMENTS"""
    fetched(world, f"{RAW}.tgz", tar_of_segments(tmp_path, extract.MAX_SEGMENTS + 1))

    assert only(world, "extract") is RunOutcome.FAILED
    assert error_code(world) == Errors.ARCHIVE_CORRUPT


def test_bad_path_a_delivery_without_a_tiff_is_corrupt_and_deleted(world: PipelineWorld) -> None:
    packed = io.BytesIO()
    with tarfile.open(fileobj=packed, mode="w:gz") as archive:
        folder = tarfile.TarInfo("folder")
        folder.type = tarfile.DIRTYPE
        archive.addfile(folder)
        notes = tarfile.TarInfo("folder/README.txt")
        notes.size = 2
        archive.addfile(notes, io.BytesIO(b"hi"))
    fetched(world, f"{RAW}.tgz", packed.getvalue())

    assert only(world, "extract") is RunOutcome.FAILED
    assert error_code(world) == Errors.ARCHIVE_CORRUPT
    assert world.gcs.names("usgs-raw/") == []


class FailingFile(io.BytesIO):
    """A segment's file on a disk that refuses every write."""

    def __init__(self, code: int, message: str) -> None:
        super().__init__()
        self.failure = OSError(code, message)

    def write(self, _data: object) -> int:
        raise self.failure


def failing_writes(code: int, message: str) -> Callable[..., object]:
    """`Path.open` whose segment files refuse every write; anything else opens as ever."""
    real: Callable[..., object] = Path.open

    def opening(path: Path, mode: str = "r", *args: object, **kwargs: object) -> object:
        return FailingFile(code, message) if mode == "wb" and "segments" in path.parts else real(path, mode, *args, **kwargs)

    return opening


def zip_with_a_negative_offset(tmp_path: Path) -> bytes:
    """A zip whose end record claims its directory lies further in than it does: each member's offset comes out negative, and
    `zipfile`'s seek to it raises `OSError` (EINVAL), as 17 of 6000 damaged zips did."""
    packed = io.BytesIO()
    with zipfile.ZipFile(packed, "w") as archive:
        archive.writestr(f"{ENTITY_ID}_a.tif", tiff_bytes(tmp_path, numpy.zeros((8, 8))))
    data = bytearray(packed.getvalue())
    end_record = data.rfind(b"PK\x05\x06")
    directory_at = int.from_bytes(data[end_record + 16 : end_record + 20], "little")
    data[end_record + 16 : end_record + 20] = (directory_at + 4096).to_bytes(4, "little")
    return bytes(data)


def test_bad_path_a_zip_whose_reader_seeks_nowhere_is_corrupt_not_a_disk_failure(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P01-BAD-CORRUPT-ARCHIVE"""
    fetched(world, f"{RAW}.zip", zip_with_a_negative_offset(tmp_path))

    assert only(world, "extract") is RunOutcome.FAILED

    assert error_code(world) == Errors.ARCHIVE_CORRUPT
    assert world.gcs.names("usgs-raw/") == []


def test_bad_path_a_write_that_says_einval_is_still_the_disks(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P01-BAD-DISK-FULL-KEEPS-DELIVERY"""
    fetched(world, f"{RAW}.tgz", tar_of_segments(tmp_path, 2))

    with monkeypatch.context() as patched:
        patched.setattr(Path, "open", failing_writes(errno.EINVAL, "Invalid argument"))
        assert only(world, "extract") is RunOutcome.FAILED

    assert error_code(world) == Errors.PROCESSING_FAILED
    assert world.gcs.names("usgs-raw/") == [f"{RAW}.tgz"]


def test_bad_path_a_full_disk_during_extract_keeps_the_delivery_and_a_retry_needs_no_download(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P01-BAD-DISK-FULL-KEEPS-DELIVERY"""
    fetched(world, f"{RAW}.tgz", tar_of_segments(tmp_path, 2))

    with monkeypatch.context() as patched:
        patched.setattr(Path, "open", failing_writes(errno.ENOSPC, "No space left on device"))
        assert only(world, "extract") is RunOutcome.FAILED

    assert error_code(world) == Errors.PROCESSING_FAILED
    assert "No space left on device" in str(dig(world.job(), "error", "message"))
    assert world.gcs.names("usgs-raw/") == [f"{RAW}.tgz"]

    world.store.update(world.job_path(), {"status": "starting", "steps.extract": {"status": "pending"}})
    assert only(world, "extract") is RunOutcome.DONE
    assert world.gcs.names(WORK) == [f"{WORK}segments/{letter}.tif" for letter in "ab"]


def test_bad_path_a_truncated_archive_is_still_corrupt_and_deleted(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P01-BAD-CORRUPT-ARCHIVE"""
    whole = tar_of_segments(tmp_path, 2)
    fetched(world, f"{RAW}.tgz", whole[: len(whole) // 2])

    assert only(world, "extract") is RunOutcome.FAILED
    assert error_code(world) == Errors.ARCHIVE_CORRUPT
    assert world.gcs.names("usgs-raw/") == []


def test_bad_path_extract_without_a_fetched_delivery_fails(world: PipelineWorld) -> None:
    world.seed_import()

    assert only(world, "extract") is RunOutcome.FAILED
    assert error_code(world) == Errors.ARCHIVE_CORRUPT


def test_bad_path_stitch_without_segments_or_with_a_blank_frame_fails(world: PipelineWorld, tmp_path: Path) -> None:
    world.seed_import()
    assert only(world, "stitch") is RunOutcome.FAILED
    assert error_code(world) == Errors.PROCESSING_FAILED

    world.seed_import()
    world.gcs.put(f"{WORK}segments/a.tif", tiff_bytes(tmp_path, numpy.zeros((64, 64))))
    assert only(world, "stitch") is RunOutcome.FAILED
    assert "no image inside its film border" in str(dig(world.job(), "error", "message"))


def test_bad_path_a_corrupt_usgs_segment_is_a_processing_failure_not_an_upload_to_redo(world: PipelineWorld) -> None:
    """Scenarios: S-P01-BAD-PROCESSING-FAILED"""
    world.seed_import()
    world.gcs.put(f"{WORK}segments/a.tif", b"II*\x00broken")

    assert only(world, "stitch") is RunOutcome.FAILED
    assert error_code(world) == Errors.PROCESSING_FAILED


def test_bad_path_locate_needs_the_scene_the_city_and_a_frame_over_the_window(world: PipelineWorld) -> None:
    world.seed_import()
    world.store.documents.pop(f"cities/{CITY}/usgsScenes/{ENTITY_ID}")
    assert only(world, "locate") is RunOutcome.FAILED
    assert error_code(world) == Errors.NOT_FOUND

    world.seed_import()
    world.store.documents.pop(f"cities/{CITY}")
    assert only(world, "locate") is RunOutcome.FAILED
    assert "the city bucharest does not exist" in str(dig(world.job(), "error", "message"))


def test_bad_path_a_frame_far_from_the_city_misses_the_window(world: PipelineWorld, tmp_path: Path) -> None:
    world.seed_import()
    world.store.update(f"cities/{CITY}", {"bounds": {"west": 2.30, "south": 48.84, "east": 2.36, "north": 48.87}})
    layout = FrameLayout(400, 300, 1, (Placement(f"{WORK}segments/a.tif", 0, 0, 400, 300),))
    world.gcs.put(f"{WORK}frame.json", layout.to_json().encode())
    world.gcs.put(f"{WORK}frame-preview.tif", tiff_bytes(tmp_path, numpy.full((300, 400), 120)))

    assert only(world, "locate") is RunOutcome.FAILED
    assert error_code(world) == Errors.REFERENCE_UNAVAILABLE


@pytest.mark.parametrize(
    ("href", "problem"),
    [("https://api.mapbox.com/v4/mapbox.satellite/0/0/0.jpg", "a Mapbox address"), ("http://127.0.0.1:9/missing.tif", "")],
)
def test_bad_path_a_refused_or_unreadable_sentinel2_asset_is_no_reference(
    world: PipelineWorld, tmp_path: Path, href: str, problem: str
) -> None:
    world.stac_href = href
    world.seed_import()

    assert only(world, "reference") is RunOutcome.FAILED
    assert error_code(world) == Errors.REFERENCE_UNAVAILABLE
    assert problem in str(dig(world.job(), "error", "message"))


def test_bad_path_under_the_emulators_an_asset_off_the_machine_is_no_reference(world: PipelineWorld) -> None:
    emulated = load_config(world.env(FIRESTORE_EMULATOR_HOST="127.0.0.1:8080", STORAGE_EMULATOR_HOST="127.0.0.1:9199"))
    world.seed_import()
    assert only(world, "reference", emulated) is RunOutcome.DONE

    # A real bucket's address in the item: the e2e tier's pipeline never leaves the machine (never resolved, never read).
    world.stac_href = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/35/T/MK/TCI.tif"
    world.seed_import()
    world.gcs.objects = {name: data for name, data in world.gcs.objects.items() if not name.startswith("reference/")}

    assert only(world, "reference", emulated) is RunOutcome.FAILED
    assert error_code(world) == Errors.REFERENCE_UNAVAILABLE
    assert "off this machine under the emulators" in str(dig(world.job(), "error", "message"))


def test_bad_path_a_failing_stac_search_is_no_reference(world: PipelineWorld) -> None:
    for _ in range(3):
        world.http.enqueue("/stac/search", Reply(502))
    world.seed_import()

    assert only(world, "reference") is RunOutcome.FAILED
    assert error_code(world) == Errors.REFERENCE_UNAVAILABLE


def test_happy_path_a_second_job_over_the_same_window_reuses_the_cached_references(world: PipelineWorld) -> None:
    world.seed_import()
    assert only(world, "reference") is RunOutcome.DONE
    fetched_once = len(world.http.paths())

    world.seed_import()
    assert only(world, "reference") is RunOutcome.DONE

    assert [path for path in world.http.paths()[fetched_once:] if path != "/stac/search"] == []
