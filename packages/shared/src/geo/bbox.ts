import { clamp, MAX_MERCATOR_LAT, type LngLat } from './math.js';

/** South-west and north-east corners, as the manifest stores city and layer bounds: `[[w, s], [e, n]]`. */
export type BBox = readonly [southWest: LngLat, northEast: LngLat];

/**
 * The same box as Firestore stores it (Firestore has no nested arrays): `{west, south, east, north}`,
 * the shape `firebase/firestore.rules` validates.
 */
export interface BoundsRecord {
    readonly west: number;
    readonly south: number;
    readonly east: number;
    readonly north: number;
}

/** The smallest box around `points`, or null when there are none. Boxes never cross the antimeridian. */
export function bboxOf(points: readonly LngLat[]): BBox | null {
    if (points.length === 0) {
        return null;
    }
    const lngs = points.map((point) => point[0]);
    const lats = points.map((point) => point[1]);
    return [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
    ];
}

/** True when `point` lies inside `bbox` or on its edge. */
export function bboxContains(bbox: BBox, point: LngLat): boolean {
    const [[west, south], [east, north]] = bbox;
    return point[0] >= west && point[0] <= east && point[1] >= south && point[1] <= north;
}

/** True when the two boxes share at least one point. */
export function bboxIntersects(a: BBox, b: BBox): boolean {
    return a[0][0] <= b[1][0] && b[0][0] <= a[1][0] && a[0][1] <= b[1][1] && b[0][1] <= a[1][1];
}

/** `bbox` grown by `margin` degrees on every side, limited to the Web Mercator world. */
export function bboxExpand(bbox: BBox, margin: number): BBox {
    const [[west, south], [east, north]] = bbox;
    return [
        [clamp(west - margin, -180, 180), clamp(south - margin, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT)],
        [clamp(east + margin, -180, 180), clamp(north + margin, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT)],
    ];
}

/** The centre of `bbox` (arithmetic, fine for city-sized boxes). */
export function bboxCenter(bbox: BBox): LngLat {
    const [[west, south], [east, north]] = bbox;
    return [(west + east) / 2, (south + north) / 2];
}

/** `point` moved to the nearest position inside `bbox`. */
export function clampToBBox(point: LngLat, bbox: BBox): LngLat {
    const [[west, south], [east, north]] = bbox;
    return [clamp(point[0], west, east), clamp(point[1], south, north)];
}

export function bboxToRecord(bbox: BBox): BoundsRecord {
    const [[west, south], [east, north]] = bbox;
    return { west, south, east, north };
}

export function bboxFromRecord(record: BoundsRecord): BBox {
    return [
        [record.west, record.south],
        [record.east, record.north],
    ];
}
