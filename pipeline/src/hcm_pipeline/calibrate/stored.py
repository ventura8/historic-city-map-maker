"""`work/{city}/{job}/calibration.json`: a proof's tiles, kept for `georef` so a retry does not measure them again (M9 §5)."""

import json
from dataclasses import dataclass
from pathlib import Path

import numpy

from hcm_pipeline.calibrate.dense import ROW_COLUMNS
from hcm_pipeline.geo import FloatArray


@dataclass(frozen=True)
class StoredTiles:
    """The tiles that counted, the proved order, the crop's corner in the film, the window's middle latitude, and a panoramic camera's
    radians a film column (M15 §2; None: no panoramic map, also in a file written before it existed)."""

    rows: FloatArray
    order: int
    left: int
    top: int
    middle_lat: float
    rad_per_px: float | None = None

    def write(self, path: Path) -> Path:
        rows = numpy.round(self.rows, 3).tolist()
        record = {"rows": rows, "order": self.order, "left": self.left, "top": self.top, "middleLat": self.middle_lat}
        camera = {} if self.rad_per_px is None else {"radPerPx": self.rad_per_px}
        path.write_text(json.dumps({**record, **camera}))
        return path

    @classmethod
    def read(cls, path: Path) -> StoredTiles:
        record = json.loads(path.read_text(encoding="utf-8"))
        rows = numpy.array(record["rows"], numpy.float64).reshape(-1, ROW_COLUMNS)
        camera = record.get("radPerPx")
        rad_per_px = float(camera) if isinstance(camera, int | float) else None
        return cls(rows, int(record["order"]), int(record["left"]), int(record["top"]), float(record["middleLat"]), rad_per_px)
