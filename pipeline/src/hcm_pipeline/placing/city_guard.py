"""The city guard: a placement lands in the city or it is never offered as sure (docs/LESSONS.md, the 1974 archive maps).

The single-map search looks over the city's bounds grown by half (`reference.CITY_MARGIN`), so a dense street grid outside the city
(a suburb, a repeated block pattern) can win the coarse search. Its junctions then sit within a few pixels of OpenStreetMap's junctions
there, and a score made only of that closeness read "high, 98 %" for 100 pairs 18 km north-west of Bucharest. A placement lands in the
city when its centre lies inside the city's bounds grown by `CITY_CENTRE_MARGIN` and at least `CITY_INSIDE_MIN_SHARE` of the smaller of
the two boxes is shared (a district map lies mostly inside the city, a regional map holds most of it). The Python twin of `landsInCity`
in `packages/shared/src/schemas/autogcp.ts`, with the same constants.
"""

from typing import Final

from hcm_pipeline.geo import MercatorBox

CITY_INSIDE_MIN_SHARE: Final = 0.5
CITY_CENTRE_MARGIN: Final = 0.25


def _area(box: MercatorBox) -> float:
    return max(0.0, box.width) * max(0.0, box.height)


def _overlap(a: MercatorBox, b: MercatorBox) -> float:
    width = min(a.right, b.right) - max(a.left, b.left)
    height = min(a.top, b.top) - max(a.bottom, b.bottom)
    return width * height if width > 0 and height > 0 else 0.0


def lands_in_city(footprint: MercatorBox, city: MercatorBox) -> bool:
    """True when a map placed on `footprint` lands in the city of bounds `city` (not grown)."""
    grown = city.expanded(CITY_CENTRE_MARGIN)
    x, y = (footprint.left + footprint.right) / 2, (footprint.bottom + footprint.top) / 2
    if not (grown.left <= x <= grown.right and grown.bottom <= y <= grown.top):
        return False
    smaller = min(_area(footprint), _area(city))
    return smaller == 0 or _overlap(footprint, city) >= CITY_INSIDE_MIN_SHARE * smaller
