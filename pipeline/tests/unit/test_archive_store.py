"""An archive on the owner's computer: received, read by the real probe child, scanned, recorded (docs/research/M20-import-local.md §2).

The rasters are tiny GeoTIFF-less TIFFs and PDFs the test writes itself; the probe child runs for real, in its own process.
"""

import json
import os
import resource
import runpy
import sys
from pathlib import Path

import numpy
import pytest
from hcm_pipeline.archive import probe, probe_child, report, sidecar
from hcm_pipeline.archive.intake import ArchiveStore, IntakeError
from hcm_pipeline.archive.model import Probe
from hcm_pipeline.raster import gdal

CONTEXT = report.Context(44.43, 2026, sidecar.Sidecar())


def tiff(path: Path, width: int = 640, height: int = 480, bands: int = 1, options: tuple[str, ...] = ()) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    driver = gdal.GetDriverByName("GTiff")
    assert driver is not None
    dataset = driver.Create(str(path), width, height, bands, gdal.GDT_Byte, list(options))
    for band in range(1, bands + 1):
        dataset.GetRasterBand(band).WriteArray(numpy.tile(numpy.arange(width, dtype=numpy.uint8), (height, 1)))
    dataset.Close()
    return path


def test_happy_path_the_probe_child_reads_a_raster_without_trusting_its_name(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-INTAKE"""
    path = tiff(tmp_path / "17A1.368", options=("NBITS=1",))

    found = probe.probe_file(path)

    assert (found.format, found.width, found.height, found.bands, found.bits, found.colour) == ("tiff", 640, 480, 1, 1, "bilevel")
    assert len(found.fingerprint) == 256
    assert found.error == ""


def test_happy_path_the_probe_child_reads_a_pdfs_pages_and_its_encryption(tmp_path: Path) -> None:
    path = tmp_path / "miorini.pdf"
    path.write_bytes(
        b"%PDF-1.4\n1 0 obj << /Type /Pages >> 2 0 obj << /Type /Page >> 3 0 obj << /Type/Page >> trailer << /Encrypt 4 0 R >>"
    )

    found = probe.probe_file(path)

    assert (found.format, found.pages, found.encrypted) == ("pdf", 2, True)


def test_bad_path_a_file_the_child_cannot_read_says_why(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-PROBE-CRASH"""
    path = tmp_path / "broken.tif"
    path.write_bytes(b"II*\x00" + b"\xff" * 40)

    found = probe.probe_file(path)

    assert found.error
    assert not found.raster


def test_happy_path_the_child_runs_as_a_module_and_limits_itself(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    limited: list[int] = []
    monkeypatch.setattr(resource, "setrlimit", lambda kind, _limits: limited.append(kind))
    monkeypatch.setattr(sys, "argv", ["probe_child", str(tiff(tmp_path / "a.tif", 8, 8, 3))])
    monkeypatch.delitem(sys.modules, "hcm_pipeline.archive.probe_child")

    with pytest.raises(SystemExit) as stopped:
        runpy.run_module("hcm_pipeline.archive.probe_child", run_name="__main__")

    assert stopped.value.code == 0
    assert json.loads(capsys.readouterr().out)["colour"] == "rgb"
    assert limited == [resource.RLIMIT_AS, resource.RLIMIT_CPU]


class Pipe:
    """The child's end of the pipe, in this process."""

    def __init__(self) -> None:
        self.sent: list[object] = []
        self.closed = False

    def send(self, obj: object, /) -> None:
        self.sent.append(obj)

    def close(self) -> None:
        self.closed = True


def test_happy_path_the_spawned_childs_body_keeps_gdal_local_limits_itself_and_sends_its_record(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    limited: list[int] = []
    monkeypatch.setattr(resource, "setrlimit", lambda kind, _limits: limited.append(kind))
    for key in probe.CHILD_ENV:
        monkeypatch.setenv(key, "before")
    pipe = Pipe()

    probe.child_main(str(tiff(tmp_path / "a.tif", 8, 8, 3)), pipe)

    assert json.loads(str(pipe.sent[0]))["bands"] == 3
    assert pipe.closed
    assert limited == [resource.RLIMIT_AS, resource.RLIMIT_CPU]
    assert {key: os.environ[key] for key in probe.CHILD_ENV} == probe.CHILD_ENV


def test_bad_path_a_child_that_dies_before_it_answers_is_an_unreadable_row(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P20-BAD-PROBE-CRASH"""
    monkeypatch.setattr(probe, "PROBE_TIMEOUT_SECONDS", 0)

    found = probe.probe_file(tiff(tmp_path / "slow.tif", 8, 8))

    assert found.error == "TimeoutError"


def test_happy_path_a_header_without_a_resolution_or_past_the_pixel_limit_is_still_read(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(probe_child, "MAX_PIXELS", 10)
    record = probe_child.raster_record(tiff(tmp_path / "a.tif", 8, 8))

    assert (record["dpi"], "fingerprint" in record, record["colour"]) == (None, False, "grey")


def fake_probe(path: Path) -> Probe:
    return Probe("jpeg", 4000, 3000, 3, 8, "rgb") if path.suffix == ".jpg" else Probe("unknown")


def test_happy_path_a_scan_records_every_file_and_reports_series_with_relative_paths_only(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-REPORT"""
    store = ArchiveStore(tmp_path / "work", fake_probe)
    archive_id = store.create()
    names = ("Harti/1897 Merték 1_40000.jpg", "Harti/copies/1897 Merték 1_40000 (copy).jpg", "Harti/LL.TXT")
    for name in names:
        data = b"same" if name.endswith(".jpg") else b"Volume in drive F"
        store.receive(archive_id, name, [data], len(data))
    (store.files(archive_id) / "Harti" / "link.jpg").symlink_to(store.files(archive_id) / names[0])

    made = store.scan(archive_id, CONTEXT)

    assert [(record["title"], record["year"], record["scaleDenominator"]) for record in made.series] == [
        ("1897 Merték 1 40000", 1897, 40000)
    ]
    assert made.skipped == {"duplicate-of": 1, "not-a-map": 1}
    assert str(tmp_path) not in json.dumps([made.series, made.issues])
    files = store.record(archive_id)["files"]
    assert isinstance(files, list)
    assert {row["path"] for row in files if isinstance(row, dict)} == set(names)


@pytest.mark.parametrize(
    ("name", "data", "length"), [("../out.jpg", b"x", 1), ("/etc/x", b"x", 1), ("a.jpg", b"xx", 1), ("a.jpg", b"x", -1)]
)
def test_bad_path_an_unsafe_name_or_a_body_longer_than_it_says_is_refused(tmp_path: Path, name: str, data: bytes, length: int) -> None:
    """Scenarios: S-P20-BAD-ZIP-SLIP"""
    store = ArchiveStore(tmp_path / "work", fake_probe)
    archive_id = store.create()

    with pytest.raises(IntakeError):
        store.receive(archive_id, name, [data], length)
    assert not (tmp_path / "work" / "import" / "out.jpg").exists()


def test_bad_path_an_upload_cut_off_mid_file_is_removed_never_kept(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-UPLOAD-CUT"""
    store = ArchiveStore(tmp_path / "work", fake_probe)
    archive_id = store.create()

    with pytest.raises(IntakeError, match="cut off"):
        store.receive(archive_id, "Harti/a.jpg", [b"half"], 8)
    assert not (store.files(archive_id) / "Harti" / "a.jpg").exists()


@pytest.mark.parametrize("archive_id", ["../x", "ar-XYZ", "ar-0123", "w-0123456789abcdef"])
def test_bad_path_an_archive_id_that_is_not_one_names_no_folder(tmp_path: Path, archive_id: str) -> None:
    store = ArchiveStore(tmp_path / "work", fake_probe)

    with pytest.raises(IntakeError):
        store.folder(archive_id)
    with pytest.raises(IntakeError):
        store.record("ar-0123456789abcdef")


def test_happy_path_the_childs_record_reads_a_pdf_in_process_and_says_why_a_raster_is_unreadable(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-PROBE-CRASH"""
    pdf = tmp_path / "atlas.pdf"
    pdf.write_bytes(b"%PDF-1.7\n1 0 obj << /Type /Page >> 2 0 obj << /Type /Page >>")
    broken = tmp_path / "broken.tif"
    broken.write_bytes(b"II*\x00" + b"\xff" * 40)

    assert probe_child.record_for(pdf) == {"pages": 2, "encrypted": False}
    assert "error" in probe_child.record_for(broken)


def tagged(resolution: str | None) -> gdal.Dataset:
    """A one-band raster in memory, its band a palette, its resolution tag `resolution`."""
    driver = gdal.GetDriverByName("MEM")
    assert driver is not None
    dataset = driver.Create("", 4, 4, 1, gdal.GDT_Byte)
    dataset.GetRasterBand(1).SetColorInterpretation(gdal.GCI_PaletteIndex)
    if resolution is not None:
        dataset.SetMetadataItem("TIFFTAG_XRESOLUTION", resolution)
    return dataset


@pytest.mark.parametrize(("resolution", "dpi"), [("300", 300.0), ("abc", None), (None, None)])
def test_happy_path_the_resolution_tag_is_read_and_a_palette_named(resolution: str | None, dpi: float | None) -> None:
    dataset = tagged(resolution)

    assert probe_child._dpi(dataset) == dpi
    assert probe_child._colour(dataset, 8) == "palette"
    assert probe_child._colour(dataset, 1) == "bilevel"


def test_bad_path_a_sidecar_that_is_absent_or_too_large_is_read_as_none(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P20-BAD-SIDECAR"""
    assert sidecar.read(tmp_path) == sidecar.Sidecar()
    (tmp_path / sidecar.FILE_NAME).write_text('{"series": [{"path": "Harti", "year": 1911}]}', encoding="utf-8")
    assert sidecar.read(tmp_path).entries[0].fields == {"year": 1911}
    monkeypatch.setattr(sidecar, "MAX_BYTES", 4)
    assert sidecar.read(tmp_path) == sidecar.Sidecar(refused=1)


def test_happy_path_a_folder_chosen_whole_brings_its_sidecar_one_level_down(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-SIDECAR-FOLDER"""
    (tmp_path / "Harti").mkdir()
    entry = '{"series": [{"path": "Harti/plan.jpg", "year": 1911}]}'
    (tmp_path / "Harti" / sidecar.FILE_NAME).write_text(entry, encoding="utf-8")

    assert sidecar.read(tmp_path).entries[0].path == "Harti/plan.jpg"
    (tmp_path / "Other").mkdir()
    assert sidecar.read(tmp_path) == sidecar.Sidecar()
    assert sidecar.read(tmp_path / "missing") == sidecar.Sidecar()
