"""Writes that survive a power cut (RESILIENCE-AUDIT P0-2): the bytes and the rename both `fsync`ed, and a cut at any point
leaves the old file or the new one, never half of one, and no leftover beside it."""

import os
import stat
from pathlib import Path

import pytest
from hcm_pipeline.durable import copy_atomic, fsync_folder, write_atomic, write_json_atomic
from hcm_pipeline.worker.local_store import LocalObjectStore


def synced(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    """The descriptors `os.fsync` was called with, the real call made too."""
    calls: list[int] = []
    real = os.fsync

    def spy(descriptor: int) -> None:
        calls.append(descriptor)
        real(descriptor)

    monkeypatch.setattr("hcm_pipeline.durable.os.fsync", spy)
    return calls


def cut_at_fsync(monkeypatch: pytest.MonkeyPatch) -> None:
    """The power goes at the first `fsync`: nothing after it happens."""

    def cut(_descriptor: int) -> None:
        raise OSError("power cut")

    monkeypatch.setattr("hcm_pipeline.durable.os.fsync", cut)


def test_happy_path_a_write_syncs_its_bytes_and_its_folder_and_keeps_its_mode(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P04-HAPPY-DURABLE-WRITE"""
    calls = synced(monkeypatch)
    target = tmp_path / "deep" / "session.json"

    write_atomic(target, '{"a": 1}', 0o600)
    write_json_atomic(tmp_path / "governor.json", {"chosen": "quiet"})

    assert target.read_text(encoding="utf-8") == '{"a": 1}'
    assert stat.S_IMODE(target.stat().st_mode) == 0o600
    assert (tmp_path / "governor.json").read_text(encoding="utf-8") == '{"chosen": "quiet"}'
    assert len(calls) == 4
    assert sorted(path.name for path in tmp_path.iterdir()) == ["deep", "governor.json"]


def test_bad_path_a_power_cut_mid_write_leaves_the_old_file_and_no_leftover(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P04-BAD-DURABLE-WRITE-CUT"""
    target = tmp_path / "frame.json"
    target.write_text("old", encoding="utf-8")
    cut_at_fsync(monkeypatch)

    with pytest.raises(OSError, match="power cut"):
        write_atomic(target, "new")
    with pytest.raises(OSError, match="power cut"):
        copy_atomic(target, tmp_path / "copy.json")

    assert target.read_text(encoding="utf-8") == "old"
    assert [path.name for path in tmp_path.iterdir()] == ["frame.json"]


def test_bad_path_a_power_cut_mid_upload_leaves_the_stores_old_object(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P04-BAD-DURABLE-WRITE-CUT"""
    store = LocalObjectStore(tmp_path / "work")
    local = tmp_path / "new.json"
    local.write_text('{"v": 2}', encoding="utf-8")
    old = tmp_path / "work" / "work" / "bucharest" / "job-1" / "frame.json"
    old.parent.mkdir(parents=True)
    old.write_text('{"v": 1}', encoding="utf-8")
    cut_at_fsync(monkeypatch)

    with pytest.raises(OSError, match="power cut"):
        store.upload_file(local, "work/bucharest/job-1/frame.json", "application/json")

    assert old.read_text(encoding="utf-8") == '{"v": 1}'
    assert [path.name for path in old.parent.iterdir()] == ["frame.json"]


def test_happy_path_each_chunk_of_a_session_is_synced_before_the_next_is_asked_for(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P04-HAPPY-DURABLE-WRITE"""
    store = LocalObjectStore(tmp_path)
    session = store.start_resumable("usgs-raw/corona2/E1/E1.tgz", 6, "application/octet-stream")
    calls = synced(monkeypatch)

    assert store.write_chunk(session, 0, b"abc", 6) == 3

    assert len(calls) == 1


def test_bad_path_a_folder_the_system_cannot_open_is_left_as_it_is(tmp_path: Path) -> None:
    fsync_folder(tmp_path / "missing")
