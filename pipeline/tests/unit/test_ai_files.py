"""The local matcher's files (M10): fetched behind the guard, hashed, unpacked by name; `superpoint.py` never leaves the tarball."""

import hashlib
import io
import json
import tarfile
import zipfile
from collections.abc import Callable
from pathlib import Path
from typing import Final

import httpx
import pytest
from hcm_pipeline.urlguard import AddressRefusedError
from hcm_pipeline.worker.ai_files import (
    AI_FILE_HOSTS,
    LIGHTGLUE_MEMBERS,
    MATCHER_DIR,
    PINS,
    PINS_CPU,
    AiFiles,
    AiFilesError,
    ai_client,
    guarded_hop,
    load_pins,
    safe_name,
    unpack_lightglue,
    variant_of,
    wheel_members,
)

COMMIT: Final = "abc123"
WEIGHTS: Final = b"weights"


def tarball(extra: tuple[str, ...] = ("lightglue/superpoint.py", "lightglue/__init__.py")) -> bytes:
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:gz") as tar:
        for member in (*LIGHTGLUE_MEMBERS, *extra):
            data = f"# {member}".encode()
            info = tarfile.TarInfo(f"LightGlue-{COMMIT}/{member}")
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return stream.getvalue()


def wheel() -> bytes:
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr("kornia/__init__.py", "# kornia")
        archive.writestr("kornia-0.9.0.dist-info/LICENSE", "Apache-2.0")
        archive.writestr("evil/run.py", "# not a package of the matcher")
    return stream.getvalue()


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def pins_file(tmp_path: Path, files: dict[str, bytes]) -> Path:
    """Pins for the three kinds of file, the right hashes of `files`."""
    kinds = {"w.pth": "weights", "lg.tar.gz": "lightglue", "k.whl": "wheel"}
    pins = {
        "image": "pytorch/pytorch:x@sha256:" + "a" * 64,
        "commit": COMMIT,
        "files": [
            {"name": name, "kind": kinds[name], "url": f"https://github.com/{name}", "sha256": sha(data)} for name, data in files.items()
        ],
    }
    path = tmp_path / "pins.json"
    path.write_text(json.dumps(pins), encoding="utf-8")
    return path


def good_files() -> dict[str, bytes]:
    return {"w.pth": WEIGHTS, "lg.tar.gz": tarball(), "k.whl": wheel()}


def client_of(answer: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(answer))


def serving(files: dict[str, bytes], asked: list[str]) -> httpx.Client:
    def answer(request: httpx.Request) -> httpx.Response:
        name = request.url.path.lstrip("/")
        asked.append(name)
        return httpx.Response(200, content=files[name])

    return client_of(answer)


def test_happy_path_each_file_is_fetched_hashed_and_placed_once(tmp_path: Path) -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    asked: list[str] = []
    files = AiFiles(tmp_path / "files", serving(good_files(), asked), pins_file(tmp_path, good_files()))

    assert not files.ready()
    files.ensure()

    root = tmp_path / "files"
    assert files.ready()
    assert (root / "weights" / "w.pth").read_bytes() == WEIGHTS
    assert (root / "lib" / "kornia" / "__init__.py").exists()
    assert (root / "lib" / "kornia-0.9.0.dist-info" / "LICENSE").exists()
    assert not (root / "lib" / "evil").exists()
    assert (root / "code" / "matcher" / "serve.py").exists()
    assert (root / "code" / "matcher" / "pins.json").exists()

    files.ensure()
    assert sorted(asked) == sorted(good_files())


def test_bad_path_superpoint_and_upstreams_init_never_leave_the_tarball(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-TAMPERED-FILE"""
    archive = tmp_path / "lg.tar.gz"
    archive.write_bytes(tarball())

    unpack_lightglue(archive, tmp_path / "lib", COMMIT)

    names = sorted(each.name for each in (tmp_path / "lib" / "lightglue").iterdir())
    assert names == ["LICENSE", "__init__.py", "aliked.py", "lightglue.py", "utils.py"]
    assert "superpoint" not in (tmp_path / "lib" / "lightglue" / "__init__.py").read_text(encoding="utf-8")


def test_bad_path_a_tarball_lacking_a_member_is_refused(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-TAMPERED-FILE"""
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:gz") as tar:
        info = tarfile.TarInfo(f"LightGlue-{COMMIT}/lightglue/aliked.py")
        tar.addfile(info, io.BytesIO())
        tar.addfile(tarfile.TarInfo(f"LightGlue-{COMMIT}/lightglue/lightglue.py"), io.BytesIO())
        link = tarfile.TarInfo(f"LightGlue-{COMMIT}/lightglue/utils.py")
        link.type = tarfile.DIRTYPE
        tar.addfile(link)
    archive = tmp_path / "lg.tar.gz"
    archive.write_bytes(stream.getvalue())

    with pytest.raises(AiFilesError) as refused:
        unpack_lightglue(archive, tmp_path / "lib", COMMIT)
    assert refused.value.why == "tampered"


def test_bad_path_a_tampered_file_is_deleted_refetched_once_and_then_refused(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-TAMPERED-FILE"""
    asked: list[str] = []
    wrong = {**good_files(), "w.pth": b"tampered"}
    files = AiFiles(tmp_path / "files", serving(wrong, asked), pins_file(tmp_path, good_files()))

    with pytest.raises(AiFilesError) as refused:
        files.ensure()

    assert refused.value.why == "tampered"
    assert asked.count("w.pth") == 2
    assert not (tmp_path / "files" / "dl" / "w.pth").exists()
    assert not (tmp_path / "files" / "dl" / "w.pth.part").exists()
    assert not files.ready()


def test_bad_path_a_file_tampered_on_disk_is_fetched_again(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-TAMPERED-FILE"""
    asked: list[str] = []
    files = AiFiles(tmp_path / "files", serving(good_files(), asked), pins_file(tmp_path, good_files()))
    files.ensure()
    (tmp_path / "files" / "dl" / "w.pth").write_bytes(b"changed")
    (tmp_path / "files" / "ready.json").unlink()
    asked.clear()

    files.ensure()

    assert asked == ["w.pth"]
    assert (tmp_path / "files" / "weights" / "w.pth").read_bytes() == WEIGHTS


def test_bad_path_a_stale_or_broken_ready_mark_is_not_ready(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-TAMPERED-FILE"""
    files = AiFiles(tmp_path / "files", client_of(lambda _r: httpx.Response(500)), pins_file(tmp_path, good_files()))
    (tmp_path / "files").mkdir()
    (tmp_path / "files" / "ready.json").write_text('{"pins": "another"}', encoding="utf-8")
    assert not files.ready()
    (tmp_path / "files" / "ready.json").write_text("{", encoding="utf-8")
    assert not files.ready()


def test_bad_path_an_upstream_that_fails_says_unreachable_and_leaves_no_part(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""
    files = AiFiles(tmp_path / "files", client_of(lambda _r: httpx.Response(503)), pins_file(tmp_path, good_files()))

    with pytest.raises(AiFilesError) as refused:
        files.ensure()

    assert refused.value.why == "unreachable"
    assert list((tmp_path / "files" / "dl").iterdir()) == []


def test_happy_path_the_download_is_a_tick_away_from_a_cancel(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""

    class StoppedError(Exception):
        """The job's cancel."""

    def tick() -> None:
        raise StoppedError

    files = AiFiles(tmp_path / "files", serving(good_files(), []), pins_file(tmp_path, good_files()))
    files.tick = tick
    with pytest.raises(StoppedError):
        files.ensure()


def test_bad_path_only_the_allowed_hosts_are_reached_every_hop_through_the_guard() -> None:
    """Scenarios: S-P07-BAD-TAMPERED-FILE"""
    hook = guarded_hop(lambda _host: ["140.82.121.3"])
    hook(httpx.Request("GET", "https://github.com/x"))

    for address in ("https://evil.example/x", "http://github.com/x"):
        with pytest.raises(AddressRefusedError):
            hook(httpx.Request("GET", address))
    private = guarded_hop(lambda _host: ["10.0.0.1"])
    with pytest.raises(AddressRefusedError):
        private(httpx.Request("GET", "https://github.com/x"))


def test_happy_path_every_pin_is_on_an_allowed_host_with_a_whole_hash_and_the_image_by_digest() -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    image, pins = load_pins(PINS)

    assert image.startswith("pytorch/pytorch:")
    assert "@sha256:" in image
    assert {each.kind for each in pins} == {"weights", "lightglue", "wheel"}
    for pin in pins:
        assert httpx.URL(pin.url).host in AI_FILE_HOSTS
        assert len(pin.sha256) == 64
    # MINIMA and RoMa are no part of this: their weights are licensed only by implication.
    assert not [each for each in pins if "roma" in each.name.lower() or "minima" in each.name.lower()]
    assert (MATCHER_DIR / "NOTICE.md").exists()


def test_bad_path_an_archive_cannot_name_where_its_file_lands() -> None:
    """Scenarios: S-P07-BAD-TAMPERED-FILE"""
    assert not safe_name("../../etc/passwd")
    assert not safe_name("/etc/passwd")
    assert not safe_name("")
    assert list(wheel_members(["kornia/../../x.py", "kornia/", "kornia/a.py", "cv2/b.so", "other/c.py", "z.dist-info/LICENSE"])) == [
        "kornia/a.py",
        "cv2/b.so",
        "z.dist-info/LICENSE",
    ]


def test_happy_path_the_real_client_follows_redirects_behind_the_guard() -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    client = ai_client(lambda _host: ["140.82.121.3"])
    try:
        assert client.follow_redirects
        assert client.event_hooks["request"]
    finally:
        client.close()


def _part_at(root: Path, target: str) -> Path:
    """The first file's download writes through this link: a real error of a real file, with no fake of `open`."""
    part = root / "dl" / "w.pth.part"
    part.parent.mkdir(parents=True)
    part.symlink_to(target)
    return part


def test_bad_path_a_disk_that_fills_while_fetching_says_disk_and_leaves_no_part(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-LOCAL-FAULT"""
    files = good_files()
    root = tmp_path / "files"
    made = AiFiles(root, serving(files, []), pins_file(tmp_path, files))
    part = _part_at(root, "/dev/full")

    with pytest.raises(AiFilesError) as raised:
        made.ensure()

    assert raised.value.why == "disk"
    assert not part.is_symlink()


def test_bad_path_a_volume_refusing_the_download_is_a_stand_aside_not_a_crash(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-LOCAL-FAULT"""
    files = good_files()
    root = tmp_path / "files"
    made = AiFiles(root, serving(files, []), pins_file(tmp_path, files))
    _part_at(root, str(tmp_path / "nowhere" / "w.pth.part"))

    with pytest.raises(AiFilesError) as raised:
        made.ensure()

    assert raised.value.why == "no-answer"


def test_bad_path_weights_altered_after_the_first_use_are_placed_again_from_what_was_fetched(tmp_path: Path) -> None:
    """The stamp says they were verified once: a child refusing them at every request heals nothing. Scenarios: S-P07-BAD-TAMPERED-FILE"""
    files = good_files()
    asked: list[str] = []
    root = tmp_path / "files"
    made = AiFiles(root, serving(files, asked), pins_file(tmp_path, files))
    made.ensure()
    fetched = len(asked)
    (root / "weights" / "w.pth").write_bytes(b"altered")
    assert made.ready()

    made.ensure()

    assert (root / "weights" / "w.pth").read_bytes() == WEIGHTS
    assert len(asked) == fetched


def test_bad_path_weights_altered_with_their_download_are_fetched_again(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-TAMPERED-FILE"""
    files = good_files()
    asked: list[str] = []
    root = tmp_path / "files"
    made = AiFiles(root, serving(files, asked), pins_file(tmp_path, files))
    made.ensure()
    (root / "weights" / "w.pth").write_bytes(b"altered")
    (root / "dl" / "w.pth").write_bytes(b"altered too")
    asked.clear()

    made.ensure()

    assert (root / "weights" / "w.pth").read_bytes() == WEIGHTS
    assert asked == ["w.pth"]


def test_happy_path_intact_weights_are_neither_placed_nor_fetched_again(tmp_path: Path) -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    files = good_files()
    asked: list[str] = []
    root = tmp_path / "files"
    made = AiFiles(root, serving(files, asked), pins_file(tmp_path, files))
    made.ensure()
    stamp = (root / "weights" / "w.pth").stat().st_mtime_ns
    asked.clear()

    made.ensure()

    assert asked == []
    assert (root / "weights" / "w.pth").stat().st_mtime_ns == stamp


def test_happy_path_a_computer_without_a_card_gets_the_processors_files_in_their_own_folder(tmp_path: Path) -> None:
    """M26 item i: the worker's own image and PyTorch for the processor, never mixed with the card's image's packages.

    Scenarios: S-P07-HAPPY-CPU-IMAGE
    """
    assert variant_of({"HCM_AI_VARIANT": "cpu"}) == (PINS_CPU, "lib-cpu")
    asked: list[str] = []
    files = AiFiles(tmp_path / "files", serving(good_files(), asked), pins_file(tmp_path, good_files()), "lib-cpu")
    files.ensure()

    root = tmp_path / "files"
    assert (root / "lib-cpu" / "kornia" / "__init__.py").exists()
    assert (root / "lib-cpu" / "lightglue" / "__init__.py").exists()
    assert not (root / "lib").exists()
    image, pins = load_pins(PINS_CPU)
    assert image == "worker"
    names = {pin.name for pin in pins}
    assert {name.split("-")[0] for name in names if name.endswith(".whl")} >= {"torch", "torchvision", "kornia", "kornia_rs"}
    assert all("cp312" not in name for name in names)
    # The same weights as the card's: one proof, whichever sidecar ran.
    weights = {(pin.name, pin.sha256) for pin in pins if pin.kind == "weights"}
    assert weights == {(pin.name, pin.sha256) for pin in load_pins(PINS)[1] if pin.kind == "weights"}
    for pin in pins:
        assert httpx.URL(pin.url).host in AI_FILE_HOSTS
        assert len(pin.sha256) == 64


@pytest.mark.parametrize("said", ["gpu", "CPU", "", "cpu "])
def test_bad_path_anything_but_cpu_keeps_the_cards_image_and_a_wheel_keeps_only_its_packages(said: str) -> None:
    """Scenarios: S-P07-BAD-CPU-IMAGE"""
    assert variant_of({"HCM_AI_VARIANT": said}) == (PINS, "lib")
    assert variant_of({}) == (PINS, "lib")
    names = ["torch/__init__.py", "torch/lib/libgomp.so.1", "caffe2/evil.py", "../torch/x.py", "typing_extensions.py", "isympy.py"]
    assert wheel_members(names) == ["torch/__init__.py", "torch/lib/libgomp.so.1", "typing_extensions.py"]
