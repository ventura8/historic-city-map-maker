import { EARTH_RADIUS_M, toDegrees, toRadians, wrapBearing, type LngLat } from './math.js';

/** Initial great-circle bearing from `from` to `to`, in degrees clockwise from north, `[0, 360)`. */
export function bearingBetween(from: LngLat, to: LngLat): number {
    const lat1 = toRadians(from[1]);
    const lat2 = toRadians(to[1]);
    const deltaLng = toRadians(to[0] - from[0]);
    const y = Math.sin(deltaLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
    return wrapBearing(toDegrees(Math.atan2(y, x)));
}

/** Great-circle (haversine) distance between two positions, in metres. */
export function distanceMeters(from: LngLat, to: LngLat): number {
    const lat1 = toRadians(from[1]);
    const lat2 = toRadians(to[1]);
    const sinLat = Math.sin((lat2 - lat1) / 2);
    const sinLng = Math.sin(toRadians(to[0] - from[0]) / 2);
    const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The position reached from `origin` after `distanceM` metres on the initial `bearing` (degrees). */
export function destinationPoint(origin: LngLat, bearing: number, distanceM: number): LngLat {
    const angular = distanceM / EARTH_RADIUS_M;
    const theta = toRadians(bearing);
    const lat1 = toRadians(origin[1]);
    const lng1 = toRadians(origin[0]);
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(theta));
    const lng2 =
        lng1 + Math.atan2(Math.sin(theta) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
    return [((toDegrees(lng2) + 540) % 360) - 180, toDegrees(lat2)];
}
