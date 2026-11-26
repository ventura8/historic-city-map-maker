/**
 * How well a set of points spreads (`docs/research/M3-interfaces.md` §6.1): a fit is **degenerate** when its enabled
 * pixels (or places) are collinear or coincident, which the area of their convex hull tells against the area of their
 * bounding box (under 1 % is degenerate), and the normalization every fit runs on (centred on the points' mean, scaled by
 * their root-mean-square distance from it), so the design matrices stay well conditioned whatever the scan's size.
 */
import type { PlanePoint } from './mercator.js';

/** A hull smaller than this share of the bounding box is a line (or a point), not an area. */
const MIN_HULL_SHARE = 0.01;

function cross(origin: PlanePoint, a: PlanePoint, b: PlanePoint): number {
    return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

/** Drops the kept points that would make a right turn (or none) before `point`. */
function dropRightTurns(kept: PlanePoint[], point: PlanePoint): void {
    for (;;) {
        const [a, b] = kept.slice(-2);
        if (a === undefined || b === undefined || cross(a, b, point) > 0) {
            return;
        }
        kept.pop();
    }
}

/** One half of the monotone chain: the points kept while turning left. */
function chain(points: readonly PlanePoint[]): PlanePoint[] {
    const kept: PlanePoint[] = [];
    for (const point of points) {
        dropRightTurns(kept, point);
        kept.push(point);
    }
    return kept;
}

/** The convex hull, counter-clockwise (Andrew's monotone chain). */
export function convexHull(points: readonly PlanePoint[]): PlanePoint[] {
    const sorted = points.toSorted((a, b) => a.x - b.x || a.y - b.y);
    const lower = chain(sorted);
    const upper = chain(sorted.toReversed());
    return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

const ORIGIN: PlanePoint = { x: 0, y: 0 };

/** The area of a simple polygon (the shoelace formula; an empty ring has none). */
export function polygonArea(ring: readonly PlanePoint[]): number {
    let twice = 0;
    let previous = ring.at(-1) ?? ORIGIN;
    for (const point of ring) {
        twice += previous.x * point.y - point.x * previous.y;
        previous = point;
    }
    return Math.abs(twice) / 2;
}

function boxArea(points: readonly PlanePoint[]): number {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
}

/** True when the points span no area: coincident, collinear, or a hull under `MIN_HULL_SHARE` of their box. */
export function isDegenerateSpread(points: readonly PlanePoint[]): boolean {
    const box = boxArea(points);
    return box <= 0 || polygonArea(convexHull(points)) < MIN_HULL_SHARE * box;
}

/** How a fit centres and scales its inputs. */
export interface Normalizer {
    readonly cx: number;
    readonly cy: number;
    readonly scale: number;
}

export function normalizerOf(points: readonly PlanePoint[]): Normalizer {
    const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    const spread = points.reduce((sum, point) => sum + (point.x - cx) ** 2 + (point.y - cy) ** 2, 0) / points.length;
    return { cx, cy, scale: Math.max(Math.sqrt(spread), Number.MIN_VALUE) };
}

export function normalize(normalizer: Normalizer, point: PlanePoint): PlanePoint {
    return { x: (point.x - normalizer.cx) / normalizer.scale, y: (point.y - normalizer.cy) / normalizer.scale };
}

/** The mean of the points (a fit's output offset). */
export function centroid(points: readonly PlanePoint[]): PlanePoint {
    const { cx, cy } = normalizerOf(points);
    return { x: cx, y: cy };
}
