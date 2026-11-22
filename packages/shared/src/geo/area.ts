/**
 * The viewed area of an aerial photo (the owner, 2026-11-22): the ground the photo shows, a quadrilateral of four
 * corners in order around it. A vertical photo shows a rectangle, an oblique one a trapezoid; either way the shape is
 * convex and never crosses itself, which `isConvexQuad` checks in the plane of longitude and latitude (good enough at a
 * city's scale).
 */
import { destinationPoint } from './bearing.js';
import { wrapBearing, type LngLat } from './math.js';

/** The four corners of a viewed area. */
const VIEWED_AREA_CORNERS = 4;

/** How far the default area starts and ends in front of the camera, in metres. */
export const AREA_NEAR_M = 100;
export const AREA_FAR_M = 400;

/** The sign of the turn a → b → c: 1 left, -1 right, 0 straight. */
function turn(a: LngLat, b: LngLat, c: LngLat): number {
    return Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
}

/**
 * Whether `corners` are four positions forming a convex quadrilateral: every turn goes the same way and none is straight.
 * With four corners that also means the edges never cross (a crossed "bow tie" turns both ways).
 */
export function isConvexQuad(corners: readonly LngLat[]): boolean {
    if (corners.length !== VIEWED_AREA_CORNERS) {
        return false;
    }
    const next = [...corners.slice(1), ...corners.slice(0, 1)];
    const after = [...corners.slice(2), ...corners.slice(0, 2)];
    const turns = corners.map((corner, index) => turn(corner, next[index] ?? corner, after[index] ?? corner));
    const first = turns[0] ?? 0;
    return first !== 0 && turns.every((sign) => sign === first);
}

/**
 * The area a new aerial photo starts from: a trapezoid in front of the camera, between `AREA_NEAR_M` and `AREA_FAR_M`
 * along `bearing`, as wide as the field of view (capped below 180° so the sides stay apart). Corners go near left, far
 * left, far right, near right.
 */
export function areaAhead(location: LngLat, bearing: number, fov: number): LngLat[] {
    const half = Math.min(Math.max(fov, 10), 170) / 2;
    const left = wrapBearing(bearing - half);
    const right = wrapBearing(bearing + half);
    return [
        destinationPoint(location, left, AREA_NEAR_M),
        destinationPoint(location, left, AREA_FAR_M),
        destinationPoint(location, right, AREA_FAR_M),
        destinationPoint(location, right, AREA_NEAR_M),
    ];
}
