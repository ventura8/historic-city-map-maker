/**
 * The New city flow's rectangle (`docs/research/M5-interfaces.md` §1.6): one drag on the admin map, from one corner to
 * the opposite one, read on the map's own view. The admin map is flat (no pitch), so a screen point is the Web Mercator
 * position of the view's centre plus the point's offset from the map's middle, turned back by the map's bearing.
 * Two clicks (pointer down and up without a move, twice) make the same rectangle: the single-pointer way (WCAG 2.5.7).
 */
import { roundTo, type CityBounds, type Geometry, type LngLat, type MapView } from '@hcm/shared';

export interface ScreenPoint {
    readonly x: number;
    readonly y: number;
}

export interface ScreenSize {
    readonly width: number;
    readonly height: number;
}

/** Mapbox's tiles are 512 px: the world is 512 × 2^zoom px wide. */
const TILE_PX = 512;
const DECIMALS = 5;
const MAX_LAT = 85.051_129;

function worldSize(zoom: number): number {
    return TILE_PX * 2 ** zoom;
}

/** A position on the world plane (0 at the antimeridian and the north edge). */
function project([lng, lat]: LngLat, size: number): ScreenPoint {
    const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
    const y = Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
    return { x: ((lng + 180) / 360) * size, y: (0.5 - y / (2 * Math.PI)) * size };
}

function unproject(point: ScreenPoint, size: number): LngLat {
    const lng = (point.x / size) * 360 - 180;
    const lat = (2 * Math.atan(Math.exp(Math.PI * (1 - (2 * point.y) / size))) - Math.PI / 2) * (180 / Math.PI);
    return [lng, lat];
}

/** The longitude and latitude under `point` of a map of `size` showing `view` (bearing in degrees, clockwise). */
export function screenToLngLat(view: MapView, size: ScreenSize, point: ScreenPoint): LngLat {
    const world = worldSize(view.zoom);
    const centre = project(view.center, world);
    const dx = point.x - size.width / 2;
    const dy = point.y - size.height / 2;
    const angle = (view.bearing * Math.PI) / 180;
    const rotated = { x: dx * Math.cos(angle) - dy * Math.sin(angle), y: dx * Math.sin(angle) + dy * Math.cos(angle) };
    return unproject({ x: centre.x + rotated.x, y: centre.y + rotated.y }, world);
}

/** The rectangle of two opposite corners, west to east and south to north, rounded to 5 decimals (about a metre). */
export function boundsOfCorners(first: LngLat, second: LngLat): CityBounds {
    return {
        west: roundTo(Math.min(first[0], second[0]), DECIMALS),
        south: roundTo(Math.min(first[1], second[1]), DECIMALS),
        east: roundTo(Math.max(first[0], second[0]), DECIMALS),
        north: roundTo(Math.max(first[1], second[1]), DECIMALS),
    };
}

/** The rectangle a drag (or two clicks) from `from` to `to` makes on the map. */
export function dragBounds(view: MapView, size: ScreenSize, from: ScreenPoint, to: ScreenPoint): CityBounds {
    return boundsOfCorners(screenToLngLat(view, size, from), screenToLngLat(view, size, to));
}

/** The rectangle around a drawn area's positions (the drawing tools' rectangle once moved), or null for any other shape. */
export function boundsOfShape(geometry: Geometry | undefined): CityBounds | null {
    if (geometry?.type !== 'Polygon') {
        return null;
    }
    const positions = geometry.coordinates.flat();
    const lngs = positions.map(([lng]) => lng);
    const lats = positions.map(([, lat]) => lat);
    return boundsOfCorners([Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]);
}
