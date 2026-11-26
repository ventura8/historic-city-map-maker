/**
 * The part of the Mapbox GL JS 3.34.1 API the adapter uses, typed structurally. The page loads Mapbox GL from
 * api.mapbox.com as the global `mapboxgl` (never bundled), so the engine depends on this shape, not on the npm
 * package: `mapbox-gl@3.34.1` joins as a dev dependency only for the browser tests (CR-2), which then also check
 * that the real global satisfies these types. `FakeMapboxGl` (`@hcm/test-support`) implements them for the node tests.
 */
import type { LngLat } from '@hcm/shared';

/** A raster image for `addImage`: RGBA bytes, `width * height * 4` long. */
export interface MapImage {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8ClampedArray;
}

export interface MapPoint {
    readonly x: number;
    readonly y: number;
}

/** A rendered feature as `queryRenderedFeatures` returns it. */
export interface MapboxFeature {
    readonly properties?: Readonly<Record<string, unknown>> | null;
    readonly layer?: { readonly id: string };
    readonly geometry?: { readonly type: string; readonly coordinates?: unknown };
}

/** The fields of a Mapbox event the adapter reads (mouse, error and `styleimagemissing` events). */
export interface MapboxEvent {
    readonly point?: MapPoint;
    /** Where a mouse or touch event happened on the map (Mapbox's `LngLat` object). */
    readonly lngLat?: { readonly lng: number; readonly lat: number };
    readonly features?: readonly MapboxFeature[];
    readonly error?: unknown;
    readonly sourceId?: string;
    readonly tile?: unknown;
}

export type MapboxListener = (event: MapboxEvent) => void;

/** A GeoJSON source (`getSource` of a `geojson` source). */
export interface MapboxGeoJsonSource {
    setData(data: unknown): unknown;
    getClusterExpansionZoom?(clusterId: number, callback: (error: unknown, zoom: number) => void): unknown;
}

export interface MapboxCameraOptions {
    readonly center?: LngLat;
    readonly zoom?: number;
    readonly bearing?: number;
    /** The tilt in degrees (0 looks straight down). */
    readonly pitch?: number;
    /** Where the target ends, in px from the container's centre (the viewer's Locate, beside a sheet). */
    readonly offset?: CameraOffset;
    /** `easeTo` only: 0 jumps (`jumpTo` takes no offset). */
    readonly duration?: number;
    /** Animates even under `prefers-reduced-motion` (the caller already read the preference). */
    readonly essential?: boolean;
}

/** Screen pixels, x right and y down. */
export type CameraOffset = readonly [number, number];

export interface MapboxMapOptions {
    readonly container: HTMLElement;
    readonly style: string;
    readonly accessToken: string;
    readonly center: LngLat;
    readonly zoom: number;
    readonly bearing: number;
    readonly minZoom: number;
    readonly maxZoom: number;
    readonly maxBounds?: readonly [LngLat, LngLat];
    /** Mapbox Standard labels in the visitor's language. */
    readonly language: string;
    /** Mapbox's own UI strings (the canvas's name, the attribution toggle, the logo link) in the visitor's language. */
    readonly locale: Readonly<Record<string, string>>;
    /** Standard style configuration per import id (`{basemap: {...}}`). */
    readonly config?: Readonly<Record<string, Readonly<Record<string, string | number | boolean>>>>;
    readonly attributionControl: true;
    readonly performanceMetricsCollection: false;
}

export interface MapboxMap {
    on(type: string, listener: MapboxListener): unknown;
    off(type: string, listener: MapboxListener): unknown;
    addSource(id: string, source: Readonly<Record<string, unknown>>): unknown;
    getSource(id: string): MapboxGeoJsonSource | undefined;
    removeSource(id: string): unknown;
    addLayer(layer: Readonly<Record<string, unknown>>, beforeId?: string): unknown;
    getLayer(id: string): unknown;
    removeLayer(id: string): unknown;
    moveLayer(id: string, beforeId?: string): unknown;
    setLayoutProperty(layerId: string, name: string, value: unknown): unknown;
    setPaintProperty(layerId: string, name: string, value: unknown): unknown;
    getConfigProperty(importId: string, name: string): unknown;
    setConfigProperty(importId: string, name: string, value: unknown): unknown;
    hasImage(id: string): boolean;
    addImage(id: string, image: MapImage, options?: { readonly pixelRatio?: number }): unknown;
    updateImage(id: string, image: MapImage): unknown;
    /** Draws a new frame; `updateImage` alone does not repaint an idle map. */
    triggerRepaint(): unknown;
    flyTo(options: MapboxCameraOptions): unknown;
    fitBounds(bounds: readonly [LngLat, LngLat], options: { readonly padding: number; readonly animate: boolean }): unknown;
    setPadding(padding: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number }): unknown;
    jumpTo(options: MapboxCameraOptions): unknown;
    easeTo(options: MapboxCameraOptions): unknown;
    getCenter(): { readonly lng: number; readonly lat: number };
    getZoom(): number;
    getBearing(): number;
    getPitch(): number;
    /** Screen CSS px of a lon/lat (admin projection helper, Terra Draw). */
    project(lngLat: { readonly lng: number; readonly lat: number }): MapPoint;
    unproject(point: MapPoint): { readonly lng: number; readonly lat: number };
    queryRenderedFeatures(
        geometry: MapPoint | readonly [MapPoint, MapPoint],
        options: { readonly layers: readonly string[] },
    ): readonly MapboxFeature[];
    getCanvas(): HTMLElement;
    /** The basemap's label language (reloads the sources); Mapbox's UI strings stay as created. */
    setLanguage(language: string): unknown;
    resize(): unknown;
    remove(): void;
}

/** The global `mapboxgl`. */
export interface MapboxGl {
    readonly Map: new (options: MapboxMapOptions) => MapboxMap;
    readonly supported?: (failIfMajorPerformanceCaveat?: boolean) => boolean;
}
