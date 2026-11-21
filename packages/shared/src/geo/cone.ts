import { bearingBetween, destinationPoint, distanceMeters } from './bearing.js';
import { clamp, wrapBearing, type LngLat } from './math.js';

/** The view cone of a photo: where the camera looked, how wide, and how far the cone is drawn. */
export interface ViewCone {
    /** Degrees clockwise from north, `[0, 360)`. */
    readonly bearing: number;
    /** Horizontal field of view in degrees, `[MIN_FOV, MAX_FOV]`. */
    readonly fov: number;
    /** Length of the cone's sides in metres (a drawing choice, not a property of the photo). */
    readonly distanceM: number;
}

/** A cone recovered from a polygon, with the vertex it was measured from. */
export interface MeasuredCone extends ViewCone {
    readonly apex: LngLat;
}

/** The admin's default field of view for a new photo (PLAN: "default FOV 60°"). */
export const DEFAULT_FOV = 60;
export const MIN_FOV = 1;
export const MAX_FOV = 180;

/** The ring without its closing vertex (GeoJSON rings repeat the first position at the end). */
export function openRing(ring: readonly LngLat[]): LngLat[] {
    const [first, ...rest] = ring;
    const last = rest.at(-1);
    if (first === undefined || last === undefined) {
        return [...ring];
    }
    return first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : [...ring];
}

/** Every item paired with its successor, the last one with the first: `[a, b, c]` → `[[a, b], [b, c], [c, a]]`. */
function cyclicPairs<T>(items: readonly T[]): [T, T][] {
    const [first] = items;
    if (first === undefined) {
        return [];
    }
    const pairs: [T, T][] = [];
    let previous: T = first;
    for (const item of [...items.slice(1), first]) {
        pairs.push([previous, item]);
        previous = item;
    }
    return pairs;
}

/**
 * A closed polygon ring for a view cone: the apex at `location`, an arc of `segments` steps from
 * `bearing - fov/2` to `bearing + fov/2` at `distanceM`, and the apex again. The field of view is
 * clamped to `[MIN_FOV, MAX_FOV]` and at least one arc step is drawn.
 */
export function conePolygon(location: LngLat, cone: ViewCone, segments = 8): LngLat[] {
    const span = clamp(cone.fov, MIN_FOV, MAX_FOV);
    const steps = Math.max(1, Math.round(segments));
    const start = cone.bearing - span / 2;
    const arc = Array.from({ length: steps + 1 }, (_, step) =>
        destinationPoint(location, wrapBearing(start + (span * step) / steps), cone.distanceM),
    );
    return [location, ...arc, location];
}

/**
 * The smallest arc that holds every bearing: its first bearing (clockwise) and its width in degrees.
 * Fewer than two bearings span nothing.
 */
export function angularSpan(bearings: readonly number[]): { readonly start: number; readonly span: number } {
    const [first, ...rest] = bearings.map(wrapBearing).toSorted((a, b) => a - b);
    if (first === undefined || rest.length === 0) {
        return { start: first ?? 0, span: 0 };
    }
    return spanAround(first, rest);
}

/** The arc left over by the largest gap between consecutive sorted bearings (`first` ≤ every one of `rest`). */
function spanAround(first: number, rest: readonly number[]): { readonly start: number; readonly span: number } {
    let previous = first;
    let largestGap = 0;
    let start = first;
    for (const bearing of [...rest, first + 360]) {
        if (bearing - previous > largestGap) {
            largestGap = bearing - previous;
            start = wrapBearing(bearing);
        }
        previous = bearing;
    }
    return { start, span: 360 - largestGap };
}

function nearest(vertices: readonly LngLat[], target: LngLat): LngLat | undefined {
    let best: LngLat | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const vertex of vertices) {
        const distance = distanceMeters(vertex, target);
        if (distance < bestDistance) {
            best = vertex;
            bestDistance = distance;
        }
    }
    return best;
}

/**
 * Bearing, field of view and length of a cone drawn as a polygon whose apex is the photo's position.
 * The apex is the ring vertex nearest to `apexHint` (the photo point); the other vertices span the
 * cone. Returns null for a ring with fewer than three distinct vertices.
 */
export function coneFromPolygon(ring: readonly LngLat[], apexHint: LngLat): MeasuredCone | null {
    const vertices = openRing(ring);
    const apex = nearest(vertices, apexHint);
    const far = apex === undefined ? [] : vertices.filter((vertex) => distanceMeters(vertex, apex) > 0);
    if (apex === undefined || far.length < 2) {
        return null;
    }
    const { start, span } = angularSpan(far.map((vertex) => bearingBetween(apex, vertex)));
    const distanceM = far.reduce((sum, vertex) => sum + distanceMeters(apex, vertex), 0) / far.length;
    return { apex, bearing: wrapBearing(start + span / 2), fov: clamp(span, MIN_FOV, MAX_FOV), distanceM };
}

/**
 * The apex of a cone polygon drawn without its photo point: a view cone is isosceles, so the apex is
 * the vertex whose two sides are closest in length (the first such vertex in ring order on a tie).
 * Null for an empty ring.
 */
export function findConeApex(ring: readonly LngLat[]): LngLat | null {
    const vertices = openRing(ring);
    // Rotated right by one, so the corner list below starts at the ring's first vertex.
    const rotated = [...vertices.slice(-1), ...vertices.slice(0, -1)];
    let best: LngLat | null = null;
    let bestImbalance = Number.POSITIVE_INFINITY;
    for (const [[previous, vertex], [, next]] of cyclicPairs(cyclicPairs(rotated))) {
        const a = distanceMeters(previous, vertex);
        const b = distanceMeters(vertex, next);
        const imbalance = Math.abs(a - b) / Math.max(a, b, Number.MIN_VALUE);
        if (imbalance < bestImbalance) {
            best = vertex;
            bestImbalance = imbalance;
        }
    }
    return best;
}
