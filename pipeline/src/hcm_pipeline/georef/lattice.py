"""What a warp renders: the fitted map sampled on a lattice over the scan (docs/research/M15-calibration-accuracy.md §1).

`gdalwarp -order 2` does not render the map the pairs were fitted to: GDAL fits its own place-to-pixel polynomial through them, which
lay 8.5 to 13 m RMS (252 m at a corner) from the fit on half the real frames. Sampled on 17 x 17 nodes over the scan and warped with
`-tps`, the layer reproduces the fitted map within 0.02 to 0.8 m (real frames, M9 §14). The nodes are not measurements: a polynomial
fit's are worked out at the warp from its pairs, and only a map its pairs cannot rebuild (the panoramic camera, fitted on every tile)
stores them, as `georef.lattice` (`georefSchema`), which no editor, residual or checkpoint reads.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Final

import numpy

from hcm_pipeline.geo import FloatArray, to_mercator

# 289 nodes, under `MAX_GCPS` (300): within 0.4 m of the map on a 40,000-pixel KH-9 crop.
LATTICE_SIDE: Final = 17
LATTICE_MODELS: Final = frozenset({"panoramic", "polynomial"})
GEO_DIGITS: Final = 9
PIXEL_DIGITS: Final = 2

ToLngLat = Callable[[FloatArray, FloatArray], tuple[FloatArray, FloatArray]]


@dataclass(frozen=True)
class LatticeNode:
    """A scan pixel and the place the map puts it."""

    x: float
    y: float
    lat: float
    lng: float

    def as_record(self) -> dict[str, object]:
        return {"pixel": {"x": round(self.x, PIXEL_DIGITS), "y": round(self.y, PIXEL_DIGITS)}, "geo": {"lat": self.lat, "lng": self.lng}}

    def as_point(self) -> tuple[float, float, float, float]:
        """EPSG:3857 x, y and the pixel's column and row: what `gdal.GCP` takes."""
        return (*to_mercator(self.lng, self.lat), self.x, self.y)


@dataclass(frozen=True)
class Lattice:
    """`georef.lattice`: which map the nodes sample, and the nodes."""

    model: str
    nodes: tuple[LatticeNode, ...]

    def as_record(self) -> dict[str, object]:
        return {"model": self.model, "nodes": [node.as_record() for node in self.nodes]}


def sampled(to_lnglat: ToLngLat, width: float, height: float, side: int = LATTICE_SIDE) -> tuple[LatticeNode, ...]:
    """The map's nodes on `side` x `side` points over the scan, corners included."""
    x, y = numpy.meshgrid(numpy.linspace(0.0, width, side), numpy.linspace(0.0, height, side))
    lng, lat = to_lnglat(x.ravel(), y.ravel())
    found = zip(x.ravel().tolist(), y.ravel().tolist(), lat.tolist(), lng.tolist(), strict=True)
    return tuple(LatticeNode(px, py, round(place_lat, GEO_DIGITS), round(place_lng, GEO_DIGITS)) for px, py, place_lat, place_lng in found)
