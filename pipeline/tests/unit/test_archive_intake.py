"""An archive taken in untrusted (docs/research/M20-import-local.md §2.1, §2.2): safe paths, the zip's limits, magic bytes, the probe.

Every archive here is built by the test itself in its own temporary folder; nothing of a real archive is read or executed.
"""

import io
import json
import stat
import zipfile
from collections.abc import Mapping
from pathlib import Path

import pytest
from hcm_pipeline.archive import magic, probe, safepath, zipread
from hcm_pipeline.archive.model import Probe
from hcm_pipeline.archive.zipread import ZipLimits, ZipRefusedError

TIFF_HEAD = b"II*\x00" + b"\x00" * 60


@pytest.mark.parametrize("raw", ["Harti/Seria 11/C1.tif", "Hărți/București 1911.jpg", "a\\b.tif", "x"])
def test_happy_path_a_plain_relative_path_is_kept(raw: str) -> None:
    assert safepath.relative_path(raw) == raw.replace("\\", "/")


@pytest.mark.parametrize("raw", ["", "/etc/passwd", "../x", "a/../../x", "a//b", "C:/x", "a/\x00b", "a/./b", "x" * 501])
def test_bad_path_an_unsafe_path_is_refused(raw: str) -> None:
    """Scenarios: S-P20-BAD-ZIP-SLIP"""
    with pytest.raises(safepath.UnsafePathError):
        safepath.relative_path(raw)


def test_bad_path_a_symlinked_folder_cannot_lead_out_of_the_archive(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-ZIP-SLIP"""
    root, outside = tmp_path / "x", tmp_path / "outside"
    root.mkdir()
    outside.mkdir()
    (root / "link").symlink_to(outside)

    with pytest.raises(safepath.UnsafePathError):
        safepath.inside(root, "link/file.tif")
    assert safepath.inside(root, "a/b.tif") == root / "a" / "b.tif"


def zipped(path: Path, entries: Mapping[str, bytes], link: str | None = None, flags: int = 0x800) -> Path:
    """A zip of `entries` (UTF-8 names unless `flags` is 0), and a symlink entry named `link`."""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in entries.items():
            info = zipfile.ZipInfo(name)
            info.flag_bits |= flags
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
        if link is not None:
            info = zipfile.ZipInfo(link)
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(info, "/etc/passwd")
    return path


def test_happy_path_a_zip_is_read_in_place_and_its_unsafe_entries_reported(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-INTAKE, S-P20-BAD-ZIP-SLIP"""
    source = zipped(tmp_path / "harti.zip", {"Harti/1.tif": TIFF_HEAD, "../evil.tif": b"x", "/abs.tif": b"y", "Harti/": b""}, "Harti/link")
    root = tmp_path / "x"
    root.mkdir()

    result = zipread.extract(source, root, 10**15)

    assert result.written == ("Harti/1.tif",)
    assert set(result.refused) == {"../evil.tif", "/abs.tif", "Harti/link"}
    assert (root / "Harti" / "1.tif").read_bytes() == TIFF_HEAD
    assert not (tmp_path / "evil.tif").exists()


def test_bad_path_an_entry_that_would_overwrite_the_zip_being_read_is_refused(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-ZIP-SLIP"""
    root = tmp_path / "x"
    root.mkdir()
    source = zipped(root / "harti.zip", {"harti.zip": b"over", "Harti/1.tif": TIFF_HEAD})
    kept = source.read_bytes()

    result = zipread.extract(source, root, 10**15)

    assert (result.written, result.refused) == (("Harti/1.tif",), ("harti.zip",))
    assert source.read_bytes() == kept


@pytest.mark.parametrize(
    ("entries", "limits", "free"),
    [
        ({"bomb.tif": b"\x00" * 100_000}, ZipLimits(max_ratio=10), 10**15),
        ({"big.tif": b"\x00" * 1000}, ZipLimits(max_entry_bytes=999), 10**15),
        ({f"{index}.tif": b"x" for index in range(5)}, ZipLimits(max_entries=4), 10**15),
        ({"a.tif": b"x" * 1000}, ZipLimits(free_margin_bytes=0), 999),
    ],
)
def test_bad_path_a_bomb_a_crowd_or_no_room_refuses_the_whole_zip_before_a_byte_is_written(
    tmp_path: Path, entries: Mapping[str, bytes], limits: ZipLimits, free: int
) -> None:
    """Scenarios: S-P20-BAD-ZIP-SLIP"""
    root = tmp_path / "x"
    root.mkdir()

    with pytest.raises(ZipRefusedError):
        zipread.extract(zipped(tmp_path / "a.zip", entries), root, free, limits)
    assert list(root.iterdir()) == []


def test_happy_path_names_are_utf8_when_flagged_else_cp437(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-INTAKE"""
    utf8 = zipfile.ZipInfo("Hărți/1.tif")
    utf8.flag_bits |= 0x800
    legacy = zipfile.ZipInfo("Bucure\u0219ti.tif".encode().decode("cp437"))
    legacy.flag_bits = 0
    plain = zipfile.ZipInfo("plain.tif")

    assert [zipread.entry_name(info) for info in (utf8, legacy, plain)] == ["Hărți/1.tif", "București.tif", "plain.tif"]
    assert zipread.entry_name(zipfile.ZipInfo("\u00e9\u00ff")) == "\u00e9\u00ff"


def test_bad_path_an_entry_larger_than_its_header_says_is_a_bad_zip(tmp_path: Path) -> None:
    source = zipped(tmp_path / "a.zip", {"a.tif": b"x" * 100})
    with zipfile.ZipFile(source) as archive:
        info = archive.infolist()[0]
        info.file_size = 10
        with pytest.raises(zipfile.BadZipFile):
            zipread._write(archive, info, tmp_path / "x" / "a.tif")


@pytest.mark.parametrize(
    ("head", "expected"),
    [
        (b"II*\x00", "tiff"),
        (b"MM\x00*", "tiff"),
        (b"II+\x00", "bigtiff"),
        (b"\xff\xd8\xff\xe0", "jpeg"),
        (b"\x89PNG\r\n\x1a\n", "png"),
        (b"%PDF-1.4", "pdf"),
        (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", "ole2"),
        (b"AC1014", "dwg"),
        (b"  0\nSECTION", "dxf"),
        (b"RIFF\x00\x00\x00\x00WEBP", "webp"),
        (b"RIFF\x00\x00\x00\x00WAVE", "unknown"),
        (b"Volume in drive F", "unknown"),
    ],
)
def test_happy_path_a_file_is_known_by_its_first_bytes(head: bytes, expected: str) -> None:
    assert magic.sniff(head) == expected


def test_happy_path_a_tiff_named_368_or_without_an_extension_is_a_tiff(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-INTAKE"""
    for name in ("17A1.368", "17A1"):
        (tmp_path / name).write_bytes(TIFF_HEAD)
        assert magic.sniff_file(tmp_path / name) == "tiff"


def failing(error: Exception) -> probe.Runner:
    def run(_path: Path) -> str:
        raise error

    return run


@pytest.mark.parametrize("error", [TimeoutError("no answer in 90 s"), EOFError(), OSError("no memory")])
def test_bad_path_a_probe_that_crashes_or_times_out_is_an_unreadable_row(tmp_path: Path, error: Exception) -> None:
    """Scenarios: S-P20-BAD-PROBE-CRASH"""
    path = tmp_path / "a.tif"
    path.write_bytes(TIFF_HEAD)

    found = probe.probe_file(path, failing(error))

    assert found.format == "tiff"
    assert found.error
    assert not found.raster


def test_bad_path_an_answer_that_is_not_a_record_is_unreadable_too(tmp_path: Path) -> None:
    path = tmp_path / "a.tif"
    path.write_bytes(TIFF_HEAD)

    assert probe.probe_file(path, lambda _path: "[1, 2]").error == "answer"
    assert probe.probe_file(path, lambda _path: "not json").error == "JSONDecodeError"


def test_happy_path_the_childs_record_is_read_field_by_field(tmp_path: Path) -> None:
    path = tmp_path / "a.tif"
    path.write_bytes(TIFF_HEAD)
    record = json.dumps(
        {
            "width": 7008,
            "height": 9933,
            "bands": 1,
            "bits": 1,
            "colour": "bilevel",
            "dpi": 300,
            "crs": True,
            "gcps": "3",
            "fingerprint": [1, "x", 2],
        }
    )

    found = probe.probe_file(path, lambda _path: record)

    assert found == Probe("tiff", 7008, 9933, 1, 1, "bilevel", "", 300.0, True, 0, fingerprint=(1, 2))


def test_happy_path_a_file_that_is_no_raster_is_never_handed_to_a_decoder(tmp_path: Path) -> None:
    path = tmp_path / "Thumbs.db"
    path.write_bytes(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 100)

    assert probe.probe_file(path, failing(AssertionError("never run"))) == Probe("ole2")


def test_happy_path_the_hash_is_the_files_sha256(tmp_path: Path) -> None:
    path = tmp_path / "a.bin"
    path.write_bytes(io.BytesIO(b"abc").read())

    assert probe.sha256_file(path) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
