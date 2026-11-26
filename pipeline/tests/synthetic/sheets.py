"""A synthetic atlas or series of pieces for the automatic layout (docs/research/M20-import-local.md §19): one map cut into sheets.

The map is the synthetic town (`town.py`) drawn once at `map_px` per cell and cut on an N x M grid whose neighbours overlap by
`overlap` of a cell (0: pages that abut). Each sheet is then dressed as a scan would show it: paper margins and a frame line around its
content, a turn of 0, 90, 180 or 270 degrees and a mirror (`turned` of them), a scale off by up to `scale_jitter`, in grey, colour or
line art. Its name follows one of the schemes `sheetnames` reads (`rc`, `pair`, `letter`, `quadrant`, `folders`, `img`, `page`), the
files come in a shuffled order, `missing` sheets are dropped and `foreign` sheets of another town (or `noise`) are added. The answer
(`Truth`) says where each sheet's content lies on the map. Everything is drawn into the test's tmp_path; no raster is committed.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy
from numpy.typing import NDArray

from tests.synthetic.town import Drawing, TownSpec, draw_map, placement, town_lines, write_map

UInt8Image = NDArray[numpy.uint8]
PAPER = 250


@dataclass(frozen=True)
class SheetsSpec:
    """The grid, each cell's content size on the map (pixels), the overlap, how the sheets are dressed and named, and the seed."""

    rows: int = 3
    cols: int = 4
    cell: tuple[int, int] = (480, 360)
    overlap: float = 0.06
    style: str = "grey"
    margin_px: int = 0
    frame: bool = False
    turned: int = 0
    scale_jitter: float = 0.0
    names: str = "rc"
    shuffle: bool = True
    missing: int = 0
    foreign: int = 0
    noise: int = 0
    seed: int = 5
    out_px: int = 0


@dataclass(frozen=True)
class Truth:
    """One sheet's answer: its cell, its content's top left on the map (map pixels), its variant, and whether it is foreign."""

    row: int
    col: int
    origin: tuple[int, int]
    variant: int = 0
    foreign: bool = False


@dataclass
class Series:
    """The written sheets (name, path), in the order an import lists them, and each one's answer by name."""

    named: list[tuple[str, Path]] = field(default_factory=list)
    truth: dict[str, Truth] = field(default_factory=dict)
    step: tuple[int, int] = (0, 0)


def steps_of(spec: SheetsSpec) -> tuple[int, int]:
    """How far apart neighbouring sheets' contents lie on the map (across, down)."""
    return round(spec.cell[0] * (1 - spec.overlap)), round(spec.cell[1] * (1 - spec.overlap))


def map_of(spec: SheetsSpec, seed: int = 7) -> UInt8Image:
    """The whole map, RGB: the town drawn to cover the grid."""
    step = steps_of(spec)
    size = (step[0] * (spec.cols - 1) + spec.cell[0], step[1] * (spec.rows - 1) + spec.cell[1])
    metres = 2 * 2400.0 / max(size)
    drawing = Drawing(placement(metres, 0.0, (size[0] / 2, size[1] / 2)), size, spec.style, street_px=5, margin_px=0, cartouche=False)
    return draw_map(town_lines(TownSpec(seed=seed, block_m=150.0)), drawing)


def name_of(scheme: str, row: int, col: int, spec: SheetsSpec) -> str:
    """The sheet's file name in `scheme`."""
    number = row * spec.cols + col + 1
    quadrant = (row // 2) * math.ceil(spec.cols / 2) + col // 2 + 1
    names = {
        "rc": f"r{row + 1}c{col + 1}.tif",
        "pair": f"{row + 1:02d}-{col + 1:02d}.tif",
        "letter": f"{chr(ord('A') + row)}{col + 1}.tif",
        "quadrant": f"{quadrant}{'ABCD'[2 * (row % 2) + col % 2]}.tif",
        "folders": f"row{row + 1}/{col + 1}.tif",
        "img": f"img{number:03d}.tif",
        "page": f"page{number}.tif",
    }
    return names[scheme]


def foreign_name(scheme: str, index: int, spec: SheetsSpec) -> str:
    """A foreign sheet's name: after the last sheet for the schemes in order, a name no grid scheme reads otherwise."""
    after = spec.rows * spec.cols + index + 1
    if scheme in {"img", "page"}:
        return f"{scheme}{after:03d}.tif" if scheme == "img" else f"page{after}.tif"
    return f"legend{'xyz'[index % 3]}.tif"


def dressed(content: UInt8Image, spec: SheetsSpec, variant: int, scale: float) -> UInt8Image:
    """The content with its margins and frame, turned by `variant` (as `sheetwork.oriented` would undo it) and scaled."""
    picture = _bordered(content, 4) if spec.frame else content
    if spec.frame:
        cv2.rectangle(picture, (1, 1), (picture.shape[1] - 2, picture.shape[0] - 2), (0, 0, 0), 2)
    picture = _unturned(_bordered(picture, spec.margin_px), variant)
    return _enlarged(_scaled(picture, scale), spec.out_px)


def _bordered(picture: UInt8Image, px: int) -> UInt8Image:
    paper = (PAPER, PAPER, PAPER)
    return numpy.asarray(cv2.copyMakeBorder(picture, px, px, px, px, cv2.BORDER_CONSTANT, value=paper), numpy.uint8)


def _scaled(picture: UInt8Image, scale: float) -> UInt8Image:
    size = (max(8, round(picture.shape[1] * scale)), max(8, round(picture.shape[0] * scale)))
    return numpy.asarray(cv2.resize(picture, size, interpolation=cv2.INTER_AREA), numpy.uint8)


def _enlarged(picture: UInt8Image, out_px: int) -> UInt8Image:
    if not out_px:
        return picture
    factor = out_px / max(picture.shape[:2])
    return numpy.asarray(cv2.resize(picture, (round(picture.shape[1] * factor), round(picture.shape[0] * factor))), numpy.uint8)


def _unturned(picture: UInt8Image, variant: int) -> UInt8Image:
    """The picture as scanned when turning it by `variant` (clockwise turn, then mirror) gives the map's way up back."""
    mirrored = numpy.fliplr(picture) if variant >= 4 else picture
    return numpy.ascontiguousarray(numpy.rot90(mirrored, variant % 4))


def _variants(spec: SheetsSpec, count: int, rng: numpy.random.Generator) -> list[int]:
    chosen = {int(index) for index in rng.choice(count, min(spec.turned, count), replace=False)}
    return [int(rng.integers(1, 8)) if index in chosen else 0 for index in range(count)]


def _write(folder: Path, name: str, picture: UInt8Image, spec: SheetsSpec) -> Path:
    path = folder / name
    path.parent.mkdir(parents=True, exist_ok=True)
    return write_map(path, picture, grey=spec.style != "colour")


def _cells(spec: SheetsSpec, rng: numpy.random.Generator) -> list[tuple[int, int]]:
    cells = [divmod(index, spec.cols) for index in range(spec.rows * spec.cols)]
    dropped = set(rng.choice(len(cells), min(spec.missing, len(cells)), replace=False).tolist())
    return [cell for index, cell in enumerate(cells) if index not in dropped]


def _extra(spec: SheetsSpec, rng: numpy.random.Generator) -> list[UInt8Image]:
    """The foreign sheets (another town) and the noise sheets."""
    other = map_of(spec, seed=spec.seed + 101)
    found = [other[: spec.cell[1], : spec.cell[0]].copy() for _ in range(spec.foreign)]
    shape = (spec.cell[1], spec.cell[0], 3)
    found += [numpy.asarray(rng.integers(0, 256, shape), numpy.uint8) for _ in range(spec.noise)]
    return found


def make_series(folder: Path, spec: SheetsSpec) -> Series:
    """The series written under `folder`: every kept sheet, then the foreign ones, shuffled when the spec says so."""
    rng = numpy.random.default_rng(spec.seed)
    whole = map_of(spec)
    step = steps_of(spec)
    cells = _cells(spec, rng)
    variants = _variants(spec, len(cells), rng)
    series = Series(step=step)
    for (row, col), variant in zip(cells, variants, strict=True):
        origin = (col * step[0], row * step[1])
        content = whole[origin[1] : origin[1] + spec.cell[1], origin[0] : origin[0] + spec.cell[0]]
        scale = 1.0 + float(rng.uniform(-spec.scale_jitter, spec.scale_jitter))
        name = name_of(spec.names, row, col, spec)
        series.named.append((name, _write(folder, name, dressed(content, spec, variant, scale), spec)))
        series.truth[name] = Truth(row, col, origin, variant)
    for index, picture in enumerate(_extra(spec, rng)):
        name = foreign_name(spec.names, index, spec)
        series.named.append((name, _write(folder, name, dressed(picture, spec, 0, 1.0), spec)))
        series.truth[name] = Truth(-1, -1, (0, 0), 0, True)
    if spec.shuffle:
        series.named = [series.named[int(index)] for index in rng.permutation(len(series.named))]
    return series


def _pairs(series: Series, placed: dict[str, tuple[float, float]]) -> list[tuple[str, str]]:
    """Every pair of placed, real grid neighbours (the second right of or below the first)."""
    at = {(truth.row, truth.col): name for name, truth in series.truth.items() if name in placed and not truth.foreign}
    found: list[tuple[str, str]] = []
    for (row, col), name in at.items():
        found.extend(_beside(at, name, row, col))
    return found


def _beside(at: dict[tuple[int, int], str], name: str, row: int, col: int) -> list[tuple[str, str]]:
    return [(name, at[cell]) for cell in ((row, col + 1), (row + 1, col)) if cell in at]


def seam_errors(series: Series, positions: Sequence[tuple[str, tuple[float, float]]]) -> list[float]:
    """Each placed pair of grid neighbours' error (layout pixels): where the second lies from the first, against the answer brought
    to the layout's scale (the one factor that fits all pairs best: the layout's cell is the sheets' median, not the map's)."""
    placed = dict(positions)
    pairs = _pairs(series, placed)
    if not pairs:
        return []
    measured = numpy.array([numpy.subtract(placed[b], placed[a]) for a, b in pairs])
    expected = numpy.array([numpy.subtract(series.truth[b].origin, series.truth[a].origin) for a, b in pairs], numpy.float64)
    factor = float(numpy.sum(measured * expected) / max(float(numpy.sum(expected * expected)), 1e-9))
    return [float(value) for value in numpy.hypot(*(measured - factor * expected).T)]
