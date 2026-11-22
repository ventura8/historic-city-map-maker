/**
 * The only map surface the engine core and the admin's editors see (docs/research/M1-interfaces.md §4,
 * M2c-interfaces.md §3). `mapbox-adapter.ts` implements it on the global `mapboxgl` (Mapbox GL JS 3.34.1, never
 * bundled); `FakeMap` (`@hcm/test-support`) implements it for the unit tests. Paint property names never appear in
 * the core: the adapter takes them from `overlayOpacityPaint` and `rasterAdjustmentPaint` of `@hcm/shared`.
 */
import type { BBox, Geometry, LayerAdjustments, LayerSource, LngLat, ViewerLocale, MapView, RasterAdjustmentPaint } from '@hcm/shared';

import type { CameraOffset } from './mapbox-types.js';

/** The overlay id of the photo markers and cones (PLAN Addendum 3); defined once, in @hcm/shared. */
export { PHOTOS_OVERLAY_ID } from '@hcm/shared';

/** Mapbox Standard style slots: bottom (above polygons), middle (above roads, below 3D buildings), top (above POI labels). */
export type MapSlot = 'bottom' | 'middle' | 'top';

export interface RasterLayerSpec {
    /** The manifest layer id; the adapter derives its own ids from it (`hcm-raster-<id>`, `hcm-source-<id>`). */
    readonly id: string;
    /** `mapbox` becomes `mapbox://<tilesetId>`; `xyz` a raster source with `tiles` and `tileSize`; `pmtiles` a custom source reading its archive (`pmtiles-source.ts`). */
    readonly source: LayerSource;
    readonly minzoom: number;
    readonly maxzoom: number;
    readonly bounds?: BBox;
    readonly visible: boolean;
    /** 0..1, `raster-opacity`. */
    readonly opacity: number;
    /** Applied as `rasterAdjustmentPaint(adjustments)` (all four `raster-*` values, absent ones neutral). */
    readonly adjustments?: LayerAdjustments;
    /** Higher draws on top of lower within the slot: the viewer passes the layer's place in its stack (the timeline's on top, then by year). */
    readonly order: number;
    /** Added to the attribution control while the layer is visible. */
    readonly attribution: string;
    /** M12: from this zoom on the picture's pixels are drawn square (the admin's look at what it approves); smooth when absent. */
    readonly sharpFrom?: number;
}

/** Properties of a photo point; titles are already in the current locale. */
export interface PhotoPointProperties {
    readonly id: string;
    readonly title: string;
    readonly year: number | null;
    /** Rotates the camera icon; null draws an unrotated marker and no cone. */
    readonly bearing: number | null;
    /** True for a photo taken from above: its own marker (an aeroplane), never rotated. */
    readonly aerial?: boolean;
}

export interface PhotoPointFeature {
    readonly type: 'Feature';
    readonly geometry: { readonly type: 'Point'; readonly coordinates: LngLat };
    readonly properties: PhotoPointProperties;
}

/** A view cone (`conePolygon` from @hcm/shared), shown from zoom 17. */
export interface PhotoConeFeature {
    readonly type: 'Feature';
    readonly geometry: { readonly type: 'Polygon'; readonly coordinates: readonly (readonly LngLat[])[] };
    readonly properties: { readonly id: string };
}

/**
 * An aerial photo's viewed area (the owner, 2026-11-22): the ground the photo shows, drawn only while the photo is
 * selected (`focus`, set by the viewer) or hovered (set by the adapter).
 */
export interface PhotoAreaFeature {
    readonly type: 'Feature';
    readonly geometry: { readonly type: 'Polygon'; readonly coordinates: readonly (readonly LngLat[])[] };
    readonly properties: { readonly id: string; readonly area: true; readonly focus?: true };
}

/** Points, cones and viewed areas in one collection; the adapter splits them (points are clustered, the rest are not). */
export interface PhotoFeatureCollection {
    readonly type: 'FeatureCollection';
    readonly features: readonly (PhotoPointFeature | PhotoConeFeature | PhotoAreaFeature)[];
}

/** One POI on the map; the title is already in the current locale (the label from zoom 16). */
export interface PoiFeature {
    readonly type: 'Feature';
    readonly geometry: Geometry;
    readonly properties: { readonly id: string; readonly title: string };
}

/**
 * A vector overlay (PLAN Addendum 3): today one POI category. The adapter draws its points as `symbol` (icon + label)
 * with a `circle` behind the icon from a clustered GeoJSON source (a cluster is a disc with its count), its LineStrings and
 * polygon outlines as `line` and its polygons as `fill` from a second one, in the category colour; the store passes every
 * POI of the category, whatever the timeline year.
 */
export interface VectorOverlaySpec {
    /** The overlay id: the POI category id. */
    readonly id: string;
    readonly kind: 'poi';
    readonly features: readonly PoiFeature[];
    /** `#rrggbb`. */
    readonly color: string;
    /** A bundled Material Symbols name (`poiIcon(category.icon)`), rasterised once per name with `addImage`. */
    readonly icon: string;
    readonly visible: boolean;
    /** 0..1, applied with `overlayOpacityPaint('poi', opacity, base)`. */
    readonly opacity: number;
    /** False: clicks pass through to the map (`onMapClick`), as the admin's drawing needs; true by default. */
    readonly clickable?: boolean;
}

export interface MapOptions {
    /** `basemap.style` of the manifest. */
    readonly style: string;
    /** Mapbox Standard configuration, set on the `basemap` import. */
    readonly config?: Readonly<Record<string, string | number | boolean>>;
    readonly accessToken: string;
    readonly view: MapView;
    readonly minZoom: number;
    readonly maxZoom: number;
    readonly maxBounds?: BBox;
    readonly locale: ViewerLocale;
    /** True with `prefers-reduced-motion: reduce` at mount: a flyTo without `animate` jumps instead of animating. */
    readonly reducedMotion: boolean;
}

export type MapErrorKind = 'style' | 'source' | 'tile' | 'webgl' | 'unknown';

export interface MapEventMap {
    /**
     * The camera moved (M4, swipe compare's camera sync; docs/research/M4-interfaces.md §3.4): Mapbox's own `move`, which
     * it fires once per rendered frame while the camera moves, with the view of that frame. Forwarded at once, not a frame
     * later, so a map that follows another draws the same camera in the same frame.
     */
    move: MapView;
    moveend: MapView;
    error: { readonly kind: MapErrorKind; readonly layerId?: string; readonly message: string };
    webglcontextlost: undefined;
    webglcontextrestored: undefined;
    /**
     * Mapbox's `idle`: the map rendered everything its style and the view need (tiles loaded, no transition running).
     * The viewer times its first one (`viewer_timing` `map_idle`, docs/ARCHITECTURE.md → *Field measurements*).
     */
    idle: undefined;
}

export type Unsubscribe = () => void;

/** The map's padding in CSS px: `flyTo` and `fitBounds` centre in what is left (the compact editor's bottom sheet). */
export interface MapPadding {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
}

/** How `MapPort.flyTo` moves. */
export interface FlyOptions {
    readonly animate?: boolean;
    readonly offset?: CameraOffset;
    /** The camera's tilt in degrees at the end (the viewer's compass resets it to 0); unset keeps the tilt. */
    readonly pitch?: number;
}

export interface MapPort {
    /** False without WebGL (`mapboxgl.supported()`); the viewer then shows the photo list (scenario V02). */
    isWebGLSupported(): boolean;
    /** Creates the map in `container`; resolves when the style has loaded, rejects with a MapErrorKind message. */
    mount(container: HTMLElement, options: MapOptions): Promise<void>;
    /** Adds or replaces (same id) a historical raster layer in `slot` (the viewer uses 'middle'). */
    addRasterLayer(spec: RasterLayerSpec, slot: MapSlot): void;
    /** Adds or replaces (same id: new features after a year change) a vector overlay in `slot` (the viewer uses 'top'). */
    addVectorOverlay(spec: VectorOverlaySpec, slot: MapSlot): void;
    /** Any overlay id: a raster layer id, PHOTOS_OVERLAY_ID or a vector overlay id; an unknown id is ignored. */
    setOverlayVisibility(overlayId: string, visible: boolean): void;
    /**
     * Any overlay id; clamped to 0..1; coalesced to one paint update per animation frame while a slider moves. Paints
     * `overlayOpacityPaint(kind, opacity, base)` on every map layer of the overlay, `base` being that map layer's
     * designed opacity (a view cone's fill is translucent at full overlay opacity). An unknown id is ignored.
     */
    setOverlayOpacity(overlayId: string, opacity: number): void;
    /** Live raster image adjustments (the admin's preview, the viewer on load); an unknown layer id is ignored. */
    setLayerPaint(layerId: string, paint: RasterAdjustmentPaint): void;
    /** Moves a raster layer to `order` in its slot (`RasterLayerSpec.order`), its tiles kept; an unknown id is ignored. */
    setLayerOrder(layerId: string, order: number): void;
    /** A raster layer or vector overlay id. */
    removeLayer(layerId: string): void;
    /** Replaces every photo marker and cone. */
    setPhotosData(data: PhotoFeatureCollection): void;
    /** A click on a photo marker or cone (a cluster click zooms in instead). */
    onPhotoClick(handler: (photoId: string) => void): Unsubscribe;
    /** A click on a POI's icon, line or fill. */
    onPoiClick(handler: (poiId: string) => void): Unsubscribe;
    /** A click (or tap) on the map that hit no photo marker or POI, as a position: the admin's selection and picks. */
    onMapClick(handler: (position: LngLat) => void): Unsubscribe;
    /**
     * Moves the camera; `animate` decides (true animates even under reduced motion: the caller read the preference), without
     * it the move animates unless `reducedMotion`. `offset`: the target ends that many px from the map's centre (x right,
     * y down), not under it (the viewer's Show on map beside a sheet).
     */
    flyTo(view: Partial<MapView>, options?: FlyOptions): void;
    /** Fits the camera to a box (the city, an edited geometry); animated unless `reducedMotion` or `animate: false`. */
    fitBounds(bounds: BBox, options?: { readonly padding?: number; readonly animate?: boolean }): void;
    /** Kept across a new mount; `flyTo` and `fitBounds` then centre above the padding (M2c-interfaces §3.2). */
    setPadding(padding: MapPadding): void;
    getView(): MapView;
    on<E extends keyof MapEventMap>(event: E, handler: (payload: MapEventMap[E]) => void): Unsubscribe;
    /**
     * The visitor switched the language: Mapbox's own UI strings (the canvas's accessible name, the logo link, the
     * attribution toggle) and the basemap's labels follow it (the tour found the first language's left behind).
     */
    setLocale(locale: ViewerLocale): void;
    /** Called by the viewer's ResizeObserver. */
    resize(): void;
    /** Removes the map and every listener; mount may be called again (a new map load). */
    destroy(): void;
    /** How many maps this port has created (each is a billed Mapbox map load): 1 per view. */
    readonly mapLoadCount: number;
}
