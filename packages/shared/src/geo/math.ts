/**
 * Small numeric helpers shared by the geo functions, the URL-hash codec and the viewer.
 * Coordinates are always `[lng, lat]` tuples (GeoJSON and Mapbox order) unless a type says otherwise.
 */

/** A position in degrees, GeoJSON order: longitude first. */
export type LngLat = readonly [lng: number, lat: number];

/** Mean Earth radius in metres (IUGG), the sphere every distance and bearing here assumes. */
export const EARTH_RADIUS_M = 6_371_008.8;

/** The latitude limit of Web Mercator (EPSG:3857); Mapbox cannot show anything beyond it. */
export const MAX_MERCATOR_LAT = 85.051129;

/** `value` limited to `[min, max]`; NaN becomes `min`, so a malformed input never leaks through. */
export function clamp(value: number, min: number, max: number): number {
    if (Number.isNaN(value)) {
        return min;
    }
    return Math.min(max, Math.max(min, value));
}

/** Any angle in degrees mapped to `[0, 360)`; a non-finite angle becomes 0. */
export function wrapBearing(degrees: number): number {
    if (!Number.isFinite(degrees)) {
        return 0;
    }
    const wrapped = degrees % 360;
    return wrapped < 0 ? wrapped + 360 : wrapped + 0;
}

/** The signed difference `to - from` in degrees, in `(-180, 180]`. */
export function bearingDelta(from: number, to: number): number {
    const delta = wrapBearing(to - from);
    return delta > 180 ? delta - 360 : delta;
}

export function toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
}

export function toDegrees(radians: number): number {
    return (radians * 180) / Math.PI;
}

/** `value` rounded to `digits` decimals (for stable, short output in hashes and seeds). */
export function roundTo(value: number, digits: number): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor + 0;
}
