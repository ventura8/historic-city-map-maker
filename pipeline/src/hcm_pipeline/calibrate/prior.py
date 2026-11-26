"""The same pass's last proved frame: a neighbour's model as the first place to look (docs/research/M9-calibration.md §2).

Frames of one mission, camera and date share their error: F006 to F007 differed by 6.5 km, F039 to F040 by about 1 km. The key is
the mission, the camera letter and the date (`D3C1203-300415`, `F`), as `imagery/join.ts` reads them. `imagery.onJobWrite` writes
`cities/{city}/imageryPasses/{key}` when `locate` ends proved; here it is only read. A refusal falls through to the full search.
"""

import math
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

import numpy

from hcm_pipeline.geo import FloatArray, MercatorBox, ground_scale
from hcm_pipeline.georef.corners import Assignment
from hcm_pipeline.georef.panoramic import PanoramicCamera

PRIOR_MARGIN_GROUND_M: Final = 12_000.0
ENTITY: Final = re.compile(r"^(?P<mission>.+)(?P<camera>[A-Z])\d+$")


def pass_key(entity_id: str, acquisition_date: str) -> str | None:
    """The pass of `D3C1203-300415F006` taken 1972-..: mission and camera letter and date; None for an id of another form."""
    found = ENTITY.match(entity_id)
    return None if found is None else f"{found['mission']}-{found['camera']}-{acquisition_date}"


@dataclass(frozen=True)
class MeasuredModel:
    """`calibration.model`: the orientation, and the similarity from the first guess to where the frame lies, around the window."""

    camera: str
    rotation: int
    mirrored: bool
    scale: float
    rotation_deg: float
    dx_m: float
    dy_m: float

    @classmethod
    def of(cls, record: object) -> MeasuredModel | None:
        """The model of a pass's document, None when it holds none this version reads (never an exception: only a place to look)."""
        if not isinstance(record, Mapping):
            return None
        try:
            return cls(
                str(record["camera"]),
                int(record["rotation"]),
                bool(record["mirrored"]),
                float(record["scale"]),
                float(record["rotationDeg"]),
                float(record["dxM"]),
                float(record["dyM"]),
            )
        except KeyError, TypeError, ValueError:
            return None

    def as_record(self) -> dict[str, object]:
        return {
            "camera": self.camera,
            "rotation": self.rotation,
            "mirrored": self.mirrored,
            "scale": round(self.scale, 5),
            "rotationDeg": round(self.rotation_deg, 4),
            "dxM": round(self.dx_m, 1),
            "dyM": round(self.dy_m, 1),
        }

    def matrix_on(self, assignment: Assignment, window: MercatorBox) -> FloatArray:
        """`assignment`'s first guess moved as this model measured a neighbour's."""
        cx, cy = (window.left + window.right) / 2, (window.bottom + window.top) / 2
        angle = math.radians(self.rotation_deg)
        a, b = self.scale * math.cos(angle), self.scale * math.sin(angle)
        linear = numpy.array([[a, -b], [b, a]])
        move = numpy.eye(3)
        move[:2, :2] = linear
        move[:2, 2] = [cx + self.dx_m - a * cx + b * cy, cy + self.dy_m - b * cx - a * cy]
        return numpy.asarray(move @ assignment.matrix, numpy.float64)

    def fits(self, assignment: Assignment, camera: PanoramicCamera | None) -> bool:
        wanted = "corners" if camera is None else "panoramic"
        return (assignment.rotation, assignment.mirrored, wanted) == (self.rotation, self.mirrored, self.camera)


def measured_model(first: Assignment, moved: FloatArray, window: MercatorBox, camera: PanoramicCamera | None) -> MeasuredModel:
    """The similarity (closest to `moved @ inverse(first)`) around the window's centre, as a record."""
    cx, cy = (window.left + window.right) / 2, (window.bottom + window.top) / 2
    relative = moved @ numpy.linalg.inv(first.matrix)
    relative = relative / relative[2, 2]
    scale = math.hypot(relative[0, 0], relative[1, 0])
    rotation = math.degrees(math.atan2(relative[1, 0], relative[0, 0]))
    centre = relative @ numpy.array([cx, cy, 1.0])
    return MeasuredModel(
        "corners" if camera is None else "panoramic",
        first.rotation,
        first.mirrored,
        scale,
        rotation,
        float(centre[0] / centre[2] - cx),
        float(centre[1] / centre[2] - cy),
    )


def prior_margin_m(window: MercatorBox) -> float:
    """`PRIOR_MARGIN_GROUND_M` in EPSG:3857 metres at the window's latitude."""
    return PRIOR_MARGIN_GROUND_M / ground_scale(window.bounds().middle_lat)
