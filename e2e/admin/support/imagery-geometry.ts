import { fixtureBody } from '@hcm/test-support/api-fixtures';

/**
 * The synthetic imagery world of the e2e admin tier (docs/research/M3-interfaces.md §13): the city's window, a scan of it
 * with a KNOWN transform (scan pixels ↔ WGS84, a 2° rotation), and the features both the scan and the references show,
 * which are the lines the fake Overpass answers (`overpass/interpreter.bucharest.json`). The stand-in runner draws its
 * images from this, its automatic pairs are these features through the transform, and a georeferencer spec places a
 * pair where a feature is in both panes (`scanPixelOf`), so every number a spec reads follows from one place.
 */

export interface LatLng {
    readonly lat: number;
    readonly lng: number;
}

export interface Pixel {
    readonly x: number;
    readonly y: number;
}

export interface Bounds {
    readonly west: number;
    readonly south: number;
    readonly east: number;
    readonly north: number;
}

/** The e2e city's bounds (e2e/admin/specs/settings/world.ts), the window a city without its own bounds gets. */
export const E2E_CITY_BOUNDS: Bounds = { west: 25.9, south: 44.3, east: 26.3, north: 44.6 };

/** The full-resolution scan the stand-in writes (`scan.tif`), and its preview's scale (`scan-preview.jpg`: 800 × 600). */
export const SCAN_SIZE = { width: 1600, height: 1200 } as const;
export const SCAN_PREVIEW_SCALE = 0.5;

/** M15, *Terrain*: scan pixels east a metre of height that the stand-in's frame over terrain shows, over ground 100 m up. */
export const TERRAIN_PARALLAX_PX = 0.5;
export const TERRAIN_HEIGHT_M = 100;

/** The scan's rotation against north, in radians (the film is never square to the map). */
export const ROTATION = (2 * Math.PI) / 180;

export function centre(bounds: Bounds): LatLng {
    return { lat: (bounds.south + bounds.north) / 2, lng: (bounds.west + bounds.east) / 2 };
}

/** A full-resolution scan pixel → its place on the ground (the transform the automatic pairs recover). */
export function scanToGeo(pixel: Pixel, bounds: Bounds = E2E_CITY_BOUNDS): LatLng {
    const du = pixel.x / SCAN_SIZE.width - 0.5;
    const dv = pixel.y / SCAN_SIZE.height - 0.5;
    const middle = centre(bounds);
    return {
        lng: middle.lng + (du * Math.cos(ROTATION) - dv * Math.sin(ROTATION)) * (bounds.east - bounds.west),
        lat: middle.lat - (du * Math.sin(ROTATION) + dv * Math.cos(ROTATION)) * (bounds.north - bounds.south),
    };
}

/** A place → the full-resolution scan pixel that shows it (the inverse of `scanToGeo`). */
export function scanPixelOf(place: LatLng, bounds: Bounds = E2E_CITY_BOUNDS): Pixel {
    const middle = centre(bounds);
    const a = (place.lng - middle.lng) / (bounds.east - bounds.west);
    const b = (middle.lat - place.lat) / (bounds.north - bounds.south);
    const du = a * Math.cos(ROTATION) + b * Math.sin(ROTATION);
    const dv = -a * Math.sin(ROTATION) + b * Math.cos(ROTATION);
    return { x: (du + 0.5) * SCAN_SIZE.width, y: (dv + 0.5) * SCAN_SIZE.height };
}

/** A place → a pixel of an image that covers `bounds` north up (the references, the warped preview). */
export function imagePixelOf(place: LatLng, bounds: Bounds, size: { readonly width: number; readonly height: number }): Pixel {
    return {
        x: ((place.lng - bounds.west) / (bounds.east - bounds.west)) * size.width,
        y: ((bounds.north - place.lat) / (bounds.north - bounds.south)) * size.height,
    };
}

export type FeatureKind = 'road' | 'river' | 'rail' | 'water';

/** One line (or a closed water area) of the world. */
export interface Feature {
    readonly id: number;
    readonly kind: FeatureKind;
    readonly name: string;
    readonly points: readonly LatLng[];
}

interface OverpassWay {
    readonly id: number;
    readonly tags: Readonly<Record<string, string>>;
    readonly geometry: readonly { readonly lat: number; readonly lon: number }[];
}

function kindOf(tags: Readonly<Record<string, string>>): FeatureKind {
    if (tags['waterway'] !== undefined) {
        return 'river';
    }
    if (tags['railway'] !== undefined) {
        return 'rail';
    }
    return tags['natural'] === 'water' ? 'water' : 'road';
}

/** The world's features: the ways the fake Overpass answers. */
export function worldFeatures(): readonly Feature[] {
    const ways = (fixtureBody('overpass/interpreter.bucharest') as { elements: OverpassWay[] }).elements;
    return ways.map((way) => ({
        id: way.id,
        kind: kindOf(way.tags),
        name: way.tags['name'] ?? `way ${String(way.id)}`,
        points: way.geometry.map((node) => ({ lat: node.lat, lng: node.lon })),
    }));
}

/** The vertices the automatic matcher "finds": every feature vertex inside the scan, in feature order. */
export function landmarks(bounds: Bounds = E2E_CITY_BOUNDS): readonly LatLng[] {
    return worldFeatures()
        .flatMap((feature) => feature.points)
        .filter((place) => {
            const pixel = scanPixelOf(place, bounds);
            return pixel.x > 0 && pixel.y > 0 && pixel.x < SCAN_SIZE.width && pixel.y < SCAN_SIZE.height;
        });
}

/** The ground area of a bounds box in km² (spherical, small boxes). */
export function areaKm2(bounds: Bounds): number {
    const kmPerDegree = 111.32;
    const middleLat = ((bounds.south + bounds.north) / 2) * (Math.PI / 180);
    return (bounds.east - bounds.west) * kmPerDegree * Math.cos(middleLat) * (bounds.north - bounds.south) * kmPerDegree;
}

/** The scan's four corners on the ground (NW, NE, SE, SW): the outline of the warped layer. */
export function scanCorners(bounds: Bounds = E2E_CITY_BOUNDS): readonly LatLng[] {
    const { width, height } = SCAN_SIZE;
    return [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
    ].map((pixel) => scanToGeo(pixel, bounds));
}

/** The north-up box around places. */
export function boundsOf(places: readonly LatLng[]): Bounds {
    const lats = places.map((place) => place.lat);
    const lngs = places.map((place) => place.lng);
    return { west: Math.min(...lngs), south: Math.min(...lats), east: Math.max(...lngs), north: Math.max(...lats) };
}
