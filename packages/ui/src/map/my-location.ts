/**
 * The visitor's position on the map ("Show my location", V10): a blue dot with a white ring, a translucent circle as wide as
 * the position's accuracy and, where the device gives a heading, a cone pointing that way. Our own GeoJSON source and two
 * layers on the global `mapboxgl` (nothing bundled), drawn on every map of the view (swipe compare's second map too) above
 * the photos in the `top` slot. They are in no overlay's registry, so a click passes through them. The canvas is not
 * repainted by forced colours: the white ring keeps the dot apart from any basemap, and nothing on it moves by itself.
 * The photo sheet's Show on map draws its ring around a photo's place the same way (`drawPhotoMark`), in the photos' cone
 * colour, on every map of the view too (the state's `photoMark`, drawn by the engine's `MapSync`).
 */
import { conePolygon, destinationPoint, type LngLat } from '@hcm/shared';

import type { MapboxMap } from './mapbox-types.js';
import { geometryIs } from './pois.js';

/** One position the browser gave: where, how sure (metres, the radius of 95 % confidence) and which way it moves. */
export interface MyLocationFix {
    readonly center: LngLat;
    readonly accuracy: number;
    /** Degrees clockwise from north; null when the device gives none (standing still, no compass in the position). */
    readonly heading: number | null;
}

export const MY_LOCATION_SOURCE = 'hcm-my-location';
/** The accuracy circle and the heading cone (one fill layer, each feature with its own opacity; a fill draws no Point). */
export const MY_LOCATION_AREA_LAYER = 'hcm-my-location-area';
/** The dot: filtered to the Point, or the circle layer would draw a dot at each vertex of the circle and the cone. */
export const MY_LOCATION_DOT_LAYER = 'hcm-my-location-dot';

const BLUE = '#1a73e8';
/** The heading cone's length and width: a pointer, not a measurement. */
const CONE = { fov: 60, distanceM: 40 };
/** Points of the accuracy circle (every 15 degrees). */
const CIRCLE_STEPS = 24;

function polygon(ring: readonly LngLat[], opacity: number): unknown {
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { o: opacity } };
}

/** A GeoJSON FeatureCollection of our own sources. */
interface FeatureCollection {
    readonly type: 'FeatureCollection';
    readonly features: readonly unknown[];
}

/** The features of `fix`: the accuracy circle, the cone when there is a heading, and the dot (none without a fix). */
export function myLocationData(fix: MyLocationFix | null): FeatureCollection {
    const features: unknown[] = [];
    if (fix !== null) {
        const { center, accuracy, heading } = fix;
        const circle = Array.from({ length: CIRCLE_STEPS + 1 }, (_, step) =>
            destinationPoint(center, (step * 360) / CIRCLE_STEPS, accuracy),
        );
        features.push(polygon(circle, 0.15));
        if (heading !== null) {
            features.push(polygon(conePolygon(center, { ...CONE, bearing: heading }), 0.4));
        }
        features.push(...pointData(center).features);
    }
    return { type: 'FeatureCollection', features };
}

/** The features of one point (the dot, Locate's ring), none without one. */
export function pointData(center: LngLat | null): FeatureCollection {
    const features = center === null ? [] : [{ type: 'Feature', geometry: { type: 'Point', coordinates: center }, properties: {} }];
    return { type: 'FeatureCollection', features };
}

/**
 * Sets `data` on our GeoJSON source `id` (the layers' too) in the `top` slot; the source and its `layers` are added the first
 * time there is a feature to draw.
 */
function drawSource(map: MapboxMap, id: string, data: FeatureCollection, layers: readonly Readonly<Record<string, unknown>>[]): void {
    const source = map.getSource(id);
    if (source !== undefined) {
        source.setData(data);
    } else if (data.features.length > 0) {
        map.addSource(id, { type: 'geojson', data });
        for (const layer of layers) {
            map.addLayer({ source: id, slot: 'top', ...layer });
        }
    }
}

/** Draws `fix` on `map` (null clears it); the source and its layers are added the first time a position comes. */
export function drawMyLocation(map: MapboxMap, fix: MyLocationFix | null): void {
    drawSource(map, MY_LOCATION_SOURCE, myLocationData(fix), [
        {
            id: MY_LOCATION_AREA_LAYER,
            type: 'fill',
            paint: { 'fill-color': BLUE, 'fill-opacity': ['get', 'o'], 'fill-emissive-strength': 1 },
        },
        {
            id: MY_LOCATION_DOT_LAYER,
            type: 'circle',
            // A circle layer draws a circle at every vertex of a polygon in its source: the dot keeps to the Point alone.
            filter: geometryIs('Point'),
            paint: {
                'circle-radius': 7,
                'circle-color': BLUE,
                'circle-stroke-width': 3,
                'circle-stroke-color': '#fff',
                'circle-emissive-strength': 1,
            },
        },
    ]);
}

/** Locate's ring around a photo's place: its source and its layer. */
export const PHOTO_MARK_SOURCE = 'hcm-photo-mark';

/** Rings `center` (the photo sheet's Locate) on `map`; null takes the ring away. */
export function drawPhotoMark(map: MapboxMap, center: LngLat | null): void {
    drawSource(map, PHOTO_MARK_SOURCE, pointData(center), [
        {
            id: PHOTO_MARK_SOURCE,
            type: 'circle',
            paint: {
                'circle-radius': 22,
                'circle-opacity': 0,
                'circle-stroke-width': 4,
                'circle-stroke-color': '#ffb74d',
                'circle-emissive-strength': 1,
            },
        },
    ]);
}
