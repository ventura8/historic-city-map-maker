"""The PMTiles archive (`hcm_pipeline/tiles/pack.py`): the specification's ids and layout, read back by a small reader of its own."""

import base64
import gzip
import json
from pathlib import Path

import pytest
from hcm_pipeline.geo import Bounds
from hcm_pipeline.tiles.pack import ROOT_BUDGET, ArchiveInfo, Entry, PackError, directories, pack, serialized, tile_id, tiles_of

from tests.unit.pmtiles_reader import Archive

INFO = ArchiveInfo("kh-9", Bounds(25.9, 44.3, 26.3, 44.6), 10, 12)


def write_tree(root: Path, tiles: dict[tuple[int, int, int], bytes]) -> Path:
    for (zoom, x, y), data in tiles.items():
        file = root / str(zoom) / str(x) / f"{y}.webp"
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data)
    return root


@pytest.mark.parametrize(
    ("place", "expected"),
    [
        ((0, 0, 0), 0),
        ((1, 0, 0), 1),
        ((1, 0, 1), 2),
        ((1, 1, 1), 3),
        ((1, 1, 0), 4),
        ((2, 0, 0), 5),
        ((3, 7, 7), 21 + 42),
    ],
)
def test_happy_path_tile_ids_follow_the_specification(place: tuple[int, int, int], expected: int) -> None:
    """Scenarios: S-P08-HAPPY-FROM-WARP"""
    assert tile_id(*place) == expected


def test_happy_path_every_tile_of_a_level_has_its_own_id() -> None:
    """Scenarios: S-P08-HAPPY-FROM-WARP"""
    ids = {tile_id(4, x, y) for x in range(16) for y in range(16)}
    assert ids == set(range((4**4 - 1) // 3, (4**5 - 1) // 3))


def test_happy_path_an_archive_reads_back_tile_by_tile(tmp_path: Path) -> None:
    """Scenarios: S-P08-HAPPY-FROM-WARP"""
    tiles = {(10, 583, 368): b"RIFFone", (11, 1166, 736): b"RIFFtwo-longer", (12, 2332, 1472): b"RIFFthree", (12, 2333, 1472): b"RIFFfour"}
    target = tmp_path / "tiles.pmtiles"

    packed = pack(write_tree(tmp_path / "tree", tiles), target, INFO)

    archive = Archive(target.read_bytes())
    assert (packed.count, packed.bytes) == (4, target.stat().st_size)
    assert archive.header["version"] == 3
    assert (archive.header["minzoom"], archive.header["maxzoom"], archive.header["tile_type"]) == (10, 12, 4)
    assert (archive.header["clustered"], archive.header["tile_compression"]) == (1, 1)
    assert archive.header["west"] == 259_000_000
    assert archive.header["addressed"] == 4
    assert json.loads(gzip.decompress(archive.metadata())) == {"name": "kh-9", "type": "overlay", "format": "webp"}
    assert {place: archive.tile(*place) for place in tiles} == tiles
    assert archive.tile(10, 0, 0) is None


def test_happy_path_many_tiles_take_leaf_directories_and_the_root_stays_in_its_16_kib() -> None:
    """Scenarios: S-P08-HAPPY-FROM-WARP"""
    # Offsets that never follow one another and random-looking lengths: a directory that does not compress into its first 16 KiB.
    entries = [Entry(index * 7, index * 1009 + (index % 13) * 3, 100 + index % 977) for index in range(200_000)]

    root, leaves = directories(entries)

    assert len(root) <= ROOT_BUDGET
    assert leaves
    pointers = Archive.directory(root)
    assert all(pointer.run == 0 for pointer in pointers)
    first = Archive.directory(leaves[pointers[0].offset : pointers[0].offset + pointers[0].length])
    assert first[1] == entries[1]


def test_happy_path_a_big_archive_finds_its_tiles_through_the_leaves(tmp_path: Path) -> None:
    """Scenarios: S-P08-HAPPY-FROM-WARP"""
    tiles = {(12, x, y): f"tile-{x}-{y}".encode() * (1 + (x * y) % 7) for x in range(2000, 2200) for y in range(1400, 1600)}
    target = tmp_path / "tiles.pmtiles"

    pack(write_tree(tmp_path / "tree", tiles), target, ArchiveInfo("big", Bounds(25.9, 44.3, 26.3, 44.6), 12, 12))

    archive = Archive(target.read_bytes())
    assert archive.tile(12, 2000, 1400) == tiles[(12, 2000, 1400)]
    assert archive.tile(12, 2199, 1599) == tiles[(12, 2199, 1599)]


def test_bad_path_a_tree_with_no_tile_makes_no_archive(tmp_path: Path) -> None:
    """Scenarios: S-P08-BAD-NOTHING-VISIBLE"""
    tree = tmp_path / "tree"
    (tree / "10" / "1").mkdir(parents=True)

    with pytest.raises(PackError, match="no tile"):
        pack(tree, tmp_path / "x.pmtiles", INFO)


def test_bad_path_what_gdal_leaves_beside_the_tiles_is_no_tile(tmp_path: Path) -> None:
    """Scenarios: S-P08-BAD-NOTHING-VISIBLE"""
    tree = write_tree(tmp_path / "tree", {(10, 1, 2): b"x"})
    (tree / "10" / "1" / "2.webp.aux.xml").write_text("<x/>", encoding="utf-8")
    (tree / "10" / "1" / "name.webp").write_text("x", encoding="utf-8")
    (tree / "stac.json").write_text("{}", encoding="utf-8")

    assert [tile.id for tile in tiles_of(tree)] == [tile_id(10, 1, 2)]


def test_happy_path_a_directory_marks_what_follows_with_zero_and_what_does_not_with_its_offset() -> None:
    """Scenarios: S-P08-HAPPY-FROM-WARP"""
    decoded = Archive.directory(serialized([Entry(1, 0, 10), Entry(2, 10, 5), Entry(9, 40, 3)]))

    assert decoded == [Entry(1, 0, 10), Entry(2, 10, 5), Entry(9, 40, 3)]


GOLDEN = Path(__file__).parents[1] / "contracts" / "pmtiles-archive.json"
GOLDEN_TILES = {(10, 584, 361): b"tile-a", (10, 585, 361): b"tile-b", (12, 2339, 1447): b"tile-c"}


def test_happy_path_an_archive_is_what_the_viewers_reader_reads(tmp_path: Path) -> None:
    """The golden archive `packages/ui/test/map/pmtiles-source.test.ts` reads with the viewer's reader: the two languages stay one format.

    Scenarios: S-P08-HAPPY-FROM-WARP
    """
    target = tmp_path / "golden.pmtiles"
    pack(write_tree(tmp_path / "tree", GOLDEN_TILES), target, INFO)

    golden = json.loads(GOLDEN.read_text(encoding="utf-8"))

    assert base64.b64encode(target.read_bytes()).decode() == golden["base64"]
    assert golden["tiles"] == [{"z": z, "x": x, "y": y, "text": data.decode()} for (z, x, y), data in GOLDEN_TILES.items()]
