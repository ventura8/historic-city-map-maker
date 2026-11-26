/**
 * The geometric checks of the georeferencer's points and the crop polygon (`docs/research/M3-interfaces.md` §6.4;
 * S-A16-BAD-GCP-OUTSIDE): a point must lie on the scan and within the city's bounds plus half a degree; a crop ring
 * must touch the layer and must not cross itself (the page checks the same before Save).
 */
import type { BoundsRecord, Gcp } from '@hcm/shared';

/** How far outside the city's bounds a ground point may lie (the frame's edges reach past the city). */
const CITY_SLACK_DEG = 0.5;

interface Vertex {
    readonly lat: number;
    readonly lng: number;
}

function withinBounds(place: Vertex, bounds: BoundsRecord, slack: number): boolean {
    const lat = place.lat >= bounds.south - slack && place.lat <= bounds.north + slack;
    return lat && place.lng >= bounds.west - slack && place.lng <= bounds.east + slack;
}

/** True when a pair's pixel is on the scan and its place within the city (with slack). */
function inside(gcp: Pick<Gcp, 'pixel' | 'geo'>, scan: { readonly width: number; readonly height: number }, bounds: BoundsRecord): boolean {
    return gcp.pixel.x <= scan.width && gcp.pixel.y <= scan.height && withinBounds(gcp.geo, bounds, CITY_SLACK_DEG);
}

/** True when every pair lies on the scan and in the city. */
export function gcpsInside(
    gcps: readonly Pick<Gcp, 'pixel' | 'geo'>[],
    scan: { readonly width: number; readonly height: number },
    bounds: BoundsRecord,
): boolean {
    return gcps.every((gcp) => inside(gcp, scan, bounds));
}

/** True when the ring's box and `bounds` share a point (the crop touches the layer). */
export function ringTouches(ring: readonly Vertex[], bounds: BoundsRecord): boolean {
    const lats = ring.map((vertex) => vertex.lat);
    const lngs = ring.map((vertex) => vertex.lng);
    const box = { west: Math.min(...lngs), south: Math.min(...lats), east: Math.max(...lngs), north: Math.max(...lats) };
    return box.west <= bounds.east && bounds.west <= box.east && box.south <= bounds.north && bounds.south <= box.north;
}

/** The sign of the turn from → via → to (positive: counter-clockwise; 0: in a line). */
function turn(from: Vertex, via: Vertex, to: Vertex): number {
    return Math.sign((via.lng - from.lng) * (to.lat - from.lat) - (via.lat - from.lat) * (to.lng - from.lng));
}

/** True when segments ab and cd cross at a point inside both (touching ends do not count). */
function cross(a: Vertex, b: Vertex, c: Vertex, d: Vertex): boolean {
    return turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;
}

/** The ring's edges, the closing one included. */
function edges(ring: readonly Vertex[]): (readonly [Vertex, Vertex])[] {
    const next = [...ring.slice(1), ...ring.slice(0, 1)];
    return ring
        .map((vertex, index) => [vertex, next[index]] as const)
        .filter((edge): edge is readonly [Vertex, Vertex] => edge[1] !== undefined);
}

/** True when two edges of the (open) ring cross; neighbouring edges only touch at their shared vertex, which is no crossing. */
export function selfIntersects(ring: readonly Vertex[]): boolean {
    const sides = edges(ring);
    return sides.some(([a, b], index) => sides.slice(index + 2).some(([c, d]) => cross(a, b, c, d)));
}
