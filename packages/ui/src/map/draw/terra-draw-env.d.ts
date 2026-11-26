/**
 * What the declarations of `terra-draw` 1.39.0 and `terra-draw-mapbox-gl-adapter` 1.5.0 name without shipping it
 * (`skipLibCheck` is off, DECISIONS-for-review.md §34g): five GeoJSON types of the `geojson` module (RFC 7946, as
 * `@types/geojson` declares them; Terra Draw has that package as a dev dependency only), and the global namespace
 * `mapboxgl` of Mapbox GL JS's own declarations, whose `Map` the adapter takes. The Mapbox map reaches the adapter through
 * `nativeMap` (`../mapbox-adapter.ts`) and the structural `TerraDrawModules` of `terra-draw-types.ts`, so its type here
 * is opaque.
 */
declare module 'geojson' {
    export type Position = number[];

    export interface Point {
        type: 'Point';
        coordinates: Position;
        bbox?: number[];
    }

    export interface LineString {
        type: 'LineString';
        coordinates: Position[];
        bbox?: number[];
    }

    export interface Polygon {
        type: 'Polygon';
        coordinates: Position[][];
        bbox?: number[];
    }

    export interface Feature<G = Point | LineString | Polygon, P = Record<string, unknown> | null> {
        type: 'Feature';
        geometry: G;
        id?: string | number;
        properties: P;
        bbox?: number[];
    }
}

declare namespace mapboxgl {
    type Map = Readonly<Record<string, unknown>>;
}
