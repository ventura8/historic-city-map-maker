"""`georef.terrain.heights`: the heights a frame over terrain is read over, as its record holds them (M15-calibration-accuracy.md,
*Terrain*).

The cells of the city's surface under the frame's scan (`Heights.covering`), to the decimetre (`surface.py` reads them so): their grid in
EPSG:3857 metres from its north-west corner, `cell` metres a side, and each cell's decimetres above `baseDm`, row by row from the north, as
little-endian uint16 in base64. Two bytes a cell: a frame over Bucharest holds at most its window's cells, 27 KB of text. Every reader of
the frame's map takes a place's height from them: the fit, the warp's `RPC_DEM`, a join and the georeferencer's preview.
"""

import base64
import binascii
from typing import Final

import numpy
from numpy.typing import NDArray

from hcm_pipeline.calibrate.terrain import Heights
from hcm_pipeline.model import Record

DECIMETRES: Final = 10.0
MAX_SPAN_DM: Final = 65535
MIN_CELLS: Final = 2
LITTLE_UINT16: Final = "<u2"
KEYS: Final = ("left", "top", "cell", "columns", "rows", "baseDm", "valuesDm")


def to_decimetres(values: NDArray[numpy.float64]) -> NDArray[numpy.float32]:
    """Heights to the decimetre, exactly as a record gives them back."""
    return numpy.asarray(numpy.rint(values * DECIMETRES) / DECIMETRES, numpy.float32)


def heights_record(heights: Heights) -> Record:
    """`georef.terrain.heights` of heights held to the decimetre; ValueError when they span more than a uint16 holds."""
    decimetres = numpy.rint(heights.values.astype(numpy.float64) * DECIMETRES).astype(numpy.int64)
    base = int(decimetres.min())
    if int(decimetres.max()) - base > MAX_SPAN_DM:
        raise ValueError("the heights span more than 6,553.5 m")
    rows, columns = heights.values.shape
    packed = (decimetres - base).astype(LITTLE_UINT16).tobytes()
    values = base64.b64encode(packed).decode("ascii")
    return dict(zip(KEYS, (heights.left, heights.top, heights.resolution, columns, rows, base, values), strict=True))


def _number(record: Record, key: str) -> float:
    value = record.get(key)
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError(f"heights.{key} must be a number")
    return float(value)


def _count(record: Record, key: str) -> int:
    value = record.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value < MIN_CELLS:
        raise ValueError(f"heights.{key} must be a whole number of 2 or more")
    return value


def _decimetres(text: object, count: int) -> NDArray[numpy.int64]:
    try:
        packed = base64.b64decode(text if isinstance(text, str) else "", validate=True)
    except binascii.Error as error:
        raise ValueError("heights.valuesDm is not base64") from error
    if len(packed) != 2 * count:
        raise ValueError("heights.valuesDm does not hold a value a cell")
    return numpy.frombuffer(packed, LITTLE_UINT16).astype(numpy.int64)


def heights_of_record(value: object) -> Heights:
    """A stored `heights`; ValueError when it is not one."""
    if not isinstance(value, dict):
        raise ValueError("heights must be a record")
    columns, rows = _count(value, "columns"), _count(value, "rows")
    cell = _number(value, "cell")
    base = value.get("baseDm")
    if isinstance(base, bool) or not isinstance(base, int) or cell <= 0:
        raise ValueError("heights needs a whole baseDm and a positive cell")
    decimetres = _decimetres(value.get("valuesDm"), columns * rows) + base
    values = numpy.asarray(decimetres / DECIMETRES, numpy.float32).reshape(rows, columns)
    return Heights(_number(value, "left"), _number(value, "top"), cell, values)
