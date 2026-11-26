/**
 * The georeferencing's one convention (`docs/research/M3-interfaces.md` §6.1): fits run from scan pixels to **EPSG:3857
 * metres** (spherical Web Mercator, R = 6,378,137 m), the warp's target; residuals and RMSE are **ground metres**, the
 * EPSG:3857 distance times the cosine of the pair's latitude. The raster pipeline (`hcm_pipeline.georef`) spells the same.
 */
import { clamp, MAX_MERCATOR_LAT, toRadians } from '../geo/math.js';

/** The sphere of EPSG:3857 (not the mean Earth radius of `EARTH_RADIUS_M`). */
export const WEB_MERCATOR_RADIUS_M = 6_378_137;

/** A WGS84 place, as the documents store it. */
export interface GeoPoint {
    readonly lat: number;
    readonly lng: number;
}

/** A point in EPSG:3857 metres (or any plane: a scan pixel, normalized coordinates). */
export interface PlanePoint {
    readonly x: number;
    readonly y: number;
}

const DEGREES = 180 / Math.PI;

export function geoToMercator(geo: GeoPoint): PlanePoint {
    const lat = toRadians(clamp(geo.lat, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT));
    return {
        x: WEB_MERCATOR_RADIUS_M * toRadians(geo.lng),
        y: WEB_MERCATOR_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + lat / 2)),
    };
}

export function mercatorToGeo(point: PlanePoint): GeoPoint {
    return {
        lat: (2 * Math.atan(Math.exp(point.y / WEB_MERCATOR_RADIUS_M)) - Math.PI / 2) * DEGREES,
        lng: (point.x / WEB_MERCATOR_RADIUS_M) * DEGREES,
    };
}

/** Ground metres of an EPSG:3857 offset `(dx, dy)` at latitude `lat`. */
export function groundMetres(dx: number, dy: number, lat: number): number {
    return Math.hypot(dx, dy) * Math.cos(toRadians(lat));
}
