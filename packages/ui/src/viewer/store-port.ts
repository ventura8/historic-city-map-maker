/**
 * What the viewer elements need from the engine's viewer store (docs/research/M1-interfaces.md §6).
 *
 * `@hcm/ui` sits below `@hcm/engine` (dependency-cruiser `ui-below-apps`), so the viewer elements cannot import the
 * engine-core types. This file mirrors them structurally: `createViewerStore` of `@hcm/engine` returns an object
 * that is assignable to `ViewerStorePort`, which `packages/engine/src/mount.ts` checks at compile time. The viewer
 * renders `getState()` and calls the actions; it never touches the map or the URL hash itself.
 */
import type { LngLat, ViewerLocale, Manifest, MapView, MessageKey, Overlay, PhotoView, WikipediaArticle } from '@hcm/shared';
import type { MapLabelKind, MapLabels } from '@hcm/shared/map-labels';

import type { CameraOffset } from '../map/mapbox-types.js';
import type { ThemeMode } from '../theme/apply.js';
import type { AccentChoice } from '../theme/device-accent.js';
import type { WindowClass } from '../theme/tokens.js';

export type { ThemeMode } from '../theme/apply.js';
export type { AccentChoice } from '../theme/device-accent.js';

/** One of Settings' theme choices (`hcm-theme-change`): the mode or the colours. */
export interface ThemeChoice {
    readonly theme?: ThemeMode;
    readonly accent?: AccentChoice;
}

export type ViewerStatus = 'idle' | 'loading' | 'ready' | 'error';
export type SheetName = 'none' | 'layers' | 'photo' | 'poi' | 'photos' | 'unplaced' | 'stories' | 'about' | 'help' | 'settings';
export type ConsentState = 'unknown' | 'granted' | 'denied';
export type Unsubscribe = () => void;

/** Placeholder values of a message (`{count}`, `{detail}`, ...). */
export type MessageParams = Readonly<Record<string, string>>;

export interface ViewerError {
    readonly code: MessageKey;
    readonly retryable: boolean;
    readonly params?: MessageParams;
}

export interface ViewerToast {
    readonly key: MessageKey;
    readonly params?: MessageParams;
}

/** One position the browser gave (`MyLocationFix` of `@hcm/ui/map`): metres of accuracy, a heading or null. */
export interface MyLocationFix {
    readonly center: LngLat;
    readonly accuracy: number;
    readonly heading: number | null;
}

/** The compass's camera (`MapCamera` of the engine): degrees clockwise from north, `[0, 360)`, and the tilt in degrees. */
export interface MapCamera {
    readonly bearing: number;
    readonly pitch: number;
}

/** "Show my location" (V10): off, on and waiting for the first position, or the latest position (memory only). */
export type MyLocationState = MyLocationFix | 'waiting' | null;

export interface ViewerState {
    readonly status: ViewerStatus;
    readonly error: ViewerError | null;
    readonly locale: ViewerLocale;
    readonly manifest: Manifest | null;
    readonly webgl: boolean;
    readonly view: MapView;
    /** The timeline stop; null is "today" (no historical layer). */
    readonly year: number | null;
    /** V15: the layer the visitor brought to the front (a layer switched on, a date picked); null: the year's last on top. */
    readonly front: string | null;
    /** Every overlay in list order (historical layers, photos, POI categories); `[]` before the manifest loads. */
    readonly overlays: readonly Overlay[];
    readonly selectedPhotoId: string | null;
    readonly selectedPoiId: string | null;
    /** M17: the story the `stories` sheet shows; null shows their list. */
    readonly selectedStoryId: string | null;
    readonly lightbox: boolean;
    /** The photo version the visitor picked; null: each photo's default (improved, else the original). */
    readonly photoVersion: PhotoView | null;
    readonly sheet: SheetName;
    /** The extra-large Layers pane is minimized to its rail: for the session, never in the hash. */
    readonly layersHidden: boolean;
    readonly windowClass: WindowClass;
    readonly compactHeight: boolean;
    /** Wide enough to dock a sheet beside the map (a medium window from 760 px too: `layoutFor`). */
    readonly dockable: boolean;
    readonly theme: ThemeMode;
    /** The theme's colours: the device's accent (the default) or the map's own (`theme/device-accent.ts`). */
    readonly accent: AccentChoice;
    readonly consent: ConsentState;
    readonly toast: ViewerToast | null;
    /**
     * Swipe compare (M4, V06): the compared side's historical layer (null: today) and the divider's settled place (0..1,
     * the main side's share); null when the visitor does not compare.
     */
    readonly compare: { readonly layerId: string | null; readonly position: number } | null;
    /**
     * The basemap's own labels (V31): what is drawn, what the city's basemap draws by itself, and the kinds it has (null
     * until a map has answered: no switch shows).
     */
    /** The single-key shortcuts are on (docs/research/viewer-input.md §2); the visitor can turn them off. */
    readonly shortcuts: boolean;
    readonly mapLabels: {
        readonly shown: MapLabels;
        readonly defaults: MapLabels;
        readonly available: readonly MapLabelKind[] | null;
    };
    /** Design B (the owner, 2026-11-15): only the photos within this many years of the year are drawn; null: every photo. */
    readonly photosNear: number | null;
    readonly myLocation: MyLocationState;
    /** M31: the Wikipedia overlay's articles once loaded (absent before the engine had any). */
    readonly wikipedia?: { readonly articles: readonly WikipediaArticle[] };
}

/** The store actions the viewer elements call (a subset of the engine's `ViewerActions`). */
export interface ViewerStorePort {
    getState(): ViewerState;
    subscribe(listener: (state: ViewerState, previous: ViewerState) => void): Unsubscribe;
    retry(): Promise<void>;
    setLocale(locale: ViewerLocale): void;
    setYear(year: number | null): void;
    /** V13: a date of a timeline year picked: that layer's year, the layer on top. */
    pickLayer(layerId: string): void;
    toggleOverlay(overlayId: string, visible?: boolean): void;
    /** A place category's sub-group on or off (`poi-groups.ts` of @hcm/shared). */
    toggleOverlayGroup(overlayId: string, group: string, visible: boolean): void;
    setOverlayOpacity(overlayId: string, opacity: number, final?: boolean): void;
    openPhoto(photoId: string | null): void;
    /** The photo sheet's Locate: the camera goes to the photo's place, `offset` px from the map's centre (x right, y down). */
    locatePhoto(photoId: string, offset: CameraOffset): void;
    /** The open photo's thumbnail was decoded (`ok`) or failed: ends the `photo_timing` field measurement. */
    photoShown?(ok: boolean): void;
    openPoi(poiId: string | null): void;
    /** M17: opens a story (null: the list of stories); an unknown id shows `error.unknownStory`. */
    openStory(storyId: string | null): void;
    /** The open photo's version (the URL hash's `pv=`). */
    setPhotoVersion(view: PhotoView): void;
    setLightbox(open: boolean): void;
    openSheet(sheet: SheetName): void;
    /** Minimizes the extra-large Layers pane to its rail (true) or restores it. */
    setLayersHidden(hidden: boolean): void;
    setView(view: MapView): void;
    /** Moves the camera (and records the view): "show my location"; the URL hash keeps the view it had until the camera moves. */
    flyTo(view: MapView): void;
    /** The zoom buttons: one level in (1) or out (-1), within the city's zoom range (the hash follows the camera). */
    zoomBy(step: number): void;
    /** The compass (V64): back to north up and level, animated unless reduced motion; already there, nothing moves. */
    resetNorth(): void;
    /** The compass's needle: the camera now and on every frame it moves; the result stops it. */
    watchCamera(listener: (camera: MapCamera) => void): Unsubscribe;
    /** Logs the `share` analytics event after the page was shared or its link copied. */
    logShare(): void;
    /** A pad or a games console's browser is in use (the `input_device` analytics event, once a page each; V65). */
    logInput?(device: 'gamepad' | 'console'): void;
    setWindowSize(width: number, height: number): void;
    setTheme(theme: ThemeMode): void;
    setAccent(accent: AccentChoice): void;
    setConsent(consent: 'granted' | 'denied'): void;
    showToast(key: MessageKey, params?: MessageParams): void;
    dismissToast(): void;
    /** M4: compares the map with `layerId` (null: today). */
    openCompare(layerId: string | null, position?: number): void;
    setComparePosition(position: number): void;
    closeCompare(): void;
    /** The basemap's own labels, live on every map; a kind the basemap does not have is ignored. */
    setMapLabels(labels: Partial<MapLabels>): void;
    /** Only the photos within `window` years of the year (5, 10 or 25), or every photo (null); kept in the hash. */
    setPhotosNear(window: number | null): void;
    /** Turns the single-key shortcuts on or off, and remembers it for the city. */
    setShortcuts(enabled: boolean): void;
    /** The visitor's position for the maps' blue dot (`my-location.ts` keeps it up to date). */
    setMyLocation(myLocation: MyLocationState): void;
}

/** How `ready` settles (docs/ENGINE_API.md → JavaScript API). */
export type ViewerReady = { readonly ok: true; readonly cityId: string } | { readonly ok: false; readonly code: MessageKey };

/** The public controller of one mounted viewer: `HistoricCityMap.mount` returns it, `<hcm-map-viewer>.controller` too. */
export interface ViewerController {
    /** Settles once: the map is ready, or boot failed (it never rejects). */
    readonly ready: Promise<ViewerReady>;
    setYear(year: number | null): void;
    toggleLayer(layerId: string, visible?: boolean): void;
    setOverlayOpacity(overlayId: string, opacity: number): void;
    openPhoto(photoId: string | null): void;
    openPoi(poiId: string | null): void;
    setLang(lang: ViewerLocale): void;
    /** M4: compares the map with `layerId` (null: today, no historical layer); an unknown id is ignored. */
    openCompare(layerId: string | null, options?: { readonly position?: number }): void;
    /** M4: moves compare's divider (0: the compared side fills the map, 1: the main side does; clamped). */
    setComparePosition(position: number): void;
    /** M4: closes compare and destroys its second map. */
    closeCompare(): void;
    /** Draws or hides the basemap's street names and points of interest; a kind the basemap does not have is ignored. */
    setMapLabels(labels: { readonly streets?: boolean; readonly pois?: boolean }): void;
    destroy(): void;
}
