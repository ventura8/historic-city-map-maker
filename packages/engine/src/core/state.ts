/**
 * The viewer's state (docs/research/M1-interfaces.md §6) and the pure transitions the store applies. Every transition
 * returns the same object when nothing changed, so the store skips a render and the map is never touched for nothing.
 */
import {
    clamp,
    DEFAULT_COMPARE_POSITION,
    findOverlay,
    overlayLabel,
    overlaysFromManifest,
    wikipediaArticleOf,
    withOverlayVisibility,
    type LngLat,
    type ViewerLocale,
    type Manifest,
    type MapView,
    type MessageKey,
    type Overlay,
    type PhotoView,
    type Story,
    type WikipediaArticle,
} from '@hcm/shared';
import type { AccentChoice, WindowClass } from '@hcm/ui';
import { CONE_MIN_ZOOM, type MyLocationFix } from '@hcm/ui/map';

import type { ConsentState } from '../telemetry/telemetry-port.js';
import { mapLabelsOf, NO_MAP_LABELS, type MapLabelsState } from './map-labels.js';
import { layerIdsOfYear, snapYear, timelineYears, yearOfLayers } from './timeline.js';

export type ViewerStatus = 'idle' | 'loading' | 'ready' | 'error';
export type ThemeMode = 'system' | 'light' | 'dark';
/** M17: `stories` shows the list, or the story `selectedStoryId` names. */
export type SheetName =
    'none' | 'layers' | 'photo' | 'poi' | 'photos' | 'unplaced' | 'stories' | 'favorites' | 'about' | 'help' | 'settings' | 'licence';

export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

export interface ViewerError {
    readonly code: MessageKey;
    readonly retryable: boolean;
    readonly params?: Readonly<Record<string, string>>;
}

export interface Toast {
    readonly key: MessageKey;
    readonly params?: Readonly<Record<string, string>>;
}

/**
 * Swipe compare (M4, scenario V06; docs/ENGINE_API.md → Compare): the historical layer the compared side shows (null:
 * today) and the divider's settled place, from 0 (the compared side fills the map) to 1 (the main side does). A compact
 * window shows it as a toggle on the one map: 0 shows the compared side, anything else the main one.
 */
export interface CompareView {
    readonly layerId: string | null;
    readonly position: number;
}

/**
 * "Show my location" (V10): off (null), on and waiting for the first position, or the latest position, drawn as a blue dot
 * on every map of the view. Only in memory: never in the hash, the stored preferences or telemetry.
 */
export type MyLocationState = MyLocationFix | 'waiting' | null;

/** How compare shows: a second map behind a divider from 600 px wide, a toggle on the one map below. */
export type CompareMode = 'swipe' | 'toggle';

export interface ViewerState {
    readonly status: ViewerStatus;
    readonly error: ViewerError | null;
    readonly locale: ViewerLocale;
    readonly manifest: Manifest | null;
    readonly webgl: boolean;
    readonly view: MapView;
    /**
     * The view the URL hash carries instead of `view` while the camera sits where Show my location brought it (that view
     * is the visitor's position, so the address keeps the one it had); absent: the hash follows the camera.
     */
    readonly hashView?: MapView | undefined;
    /** The timeline stop; null is "today" (no historical layer). */
    readonly year: number | null;
    /**
     * V15: the layer the visitor brought to the front (switched on, or a date picked on the timeline), drawn above every
     * other while visible (`stack.ts`); null: the timeline's year on top, its last layer in manifest order highest.
     */
    readonly front: string | null;
    /**
     * Every overlay in list order (`overlaysFromManifest`: historical layers, photos, POI categories), updated only with
     * `withOverlayOpacity`, `withOverlayVisibility` and `withHashOpacity`; `[]` before the manifest loads.
     */
    readonly overlays: readonly Overlay[];
    readonly selectedPhotoId: string | null;
    readonly selectedPoiId: string | null;
    /** M17: the story the `stories` sheet shows; null shows their list. */
    readonly selectedStoryId: string | null;
    readonly lightbox: boolean;
    /** The photo version the visitor picked (`pv=`); null: each photo's default (improved, else the original). */
    readonly photoVersion: PhotoView | null;
    readonly sheet: SheetName;
    /** The extra-large Layers pane is minimized to its rail (V03): for the session, never in the hash. */
    readonly layersHidden: boolean;
    readonly windowClass: WindowClass;
    readonly compactHeight: boolean;
    /** The viewer is wide enough to dock a sheet beside the map (`isDockable`: a medium window from 760 px docks it too). */
    readonly dockable: boolean;
    readonly theme: ThemeMode;
    /** The theme's colours: the device's accent (the default, `@hcm/ui`'s `accentTokens`) or the map's own. */
    readonly accent: AccentChoice;
    readonly consent: ConsentState;
    readonly toast: Toast | null;
    /** Swipe compare, or null when the visitor does not compare (M4). */
    readonly compare: CompareView | null;
    /** The basemap's own labels, as the visitor chose them (`map-labels.ts`); the compared side draws the same. */
    readonly mapLabels: MapLabelsState;
    /** Design B (the owner, 2026-11-15): only the photos within this many years of the year are drawn; null: every photo. */
    readonly photosNear: number | null;
    /** The single-key shortcuts are on (the visitor's `shortcuts` preference, docs/research/viewer-input.md §2). */
    readonly shortcuts: boolean;
    /** `prefers-color-scheme: dark`, which the basemap's light follows under the `system` theme (`map-light.ts`). */
    readonly systemDark: boolean;
    readonly myLocation: MyLocationState;
    /** Show on map's ring around a photo's place (V51), on every map of the view; null without one. */
    readonly photoMark: LngLat | null;
    /** M31: the Wikipedia overlay's articles, loaded the first time it shows (`wikipedia.ts`). */
    readonly wikipedia: WikipediaState;
}

/** M31 (`docs/research/M31-wikipedia.md` §4): the Wikipedia file's articles and where their load is. */
export interface WikipediaState {
    readonly status: 'idle' | 'loading' | 'ready' | 'failed';
    readonly articles: readonly WikipediaArticle[];
}

const NO_WIKIPEDIA: WikipediaState = { status: 'idle', articles: [] };

const NO_VIEW: MapView = { center: [0, 0], zoom: 0, bearing: 0 };

export function initialState(locale: ViewerLocale, theme: ThemeMode, consent: ConsentState): ViewerState {
    return {
        status: 'idle',
        error: null,
        locale,
        manifest: null,
        webgl: true,
        view: NO_VIEW,
        year: null,
        front: null,
        overlays: [],
        selectedPhotoId: null,
        selectedPoiId: null,
        selectedStoryId: null,
        lightbox: false,
        photoVersion: null,
        sheet: 'none',
        layersHidden: false,
        windowClass: 'compact',
        compactHeight: false,
        dockable: false,
        theme,
        accent: 'device',
        consent,
        toast: null,
        compare: null,
        mapLabels: NO_MAP_LABELS,
        photosNear: null,
        shortcuts: true,
        systemDark: false,
        myLocation: null,
        photoMark: null,
        wikipedia: NO_WIKIPEDIA,
    };
}

/** The city's own view: its centre and zoom, north up. */
export function cityView(manifest: Manifest): MapView {
    return { center: manifest.city.center, zoom: manifest.city.zoom, bearing: 0 };
}

/**
 * Where Show on map takes the camera (V51): the photo's place, zoomed in at least as far as its view cone shows and never
 * beyond the city's `maxZoom`; null for an unknown photo or before the manifest.
 */
export function locateTarget(state: ViewerState, photoId: string): { readonly center: LngLat; readonly zoom: number } | null {
    const { manifest, view } = state;
    const photo = manifest?.photos.find((candidate) => candidate.id === photoId);
    if (manifest === null || photo === undefined) {
        return null;
    }
    return { center: [photo.location.lng, photo.location.lat], zoom: Math.min(Math.max(view.zoom, CONE_MIN_ZOOM), manifest.city.maxZoom) };
}

/** A freshly loaded manifest: overlays at their defaults, the city view, the stop of the default-visible layers. */
export function withManifest(state: ViewerState, manifest: Manifest): ViewerState {
    const overlays = overlaysFromManifest(manifest);
    const visible = overlays.filter((overlay) => overlay.kind === 'raster' && overlay.visible).map((overlay) => overlay.id);
    return {
        ...state,
        manifest,
        overlays,
        wikipedia: NO_WIKIPEDIA,
        view: cityView(manifest),
        year: yearOfLayers(manifest.layers, visible),
        front: null,
        selectedPhotoId: null,
        selectedPoiId: null,
        selectedStoryId: null,
        lightbox: false,
        sheet: 'none',
        compare: null,
        mapLabels: mapLabelsOf(manifest),
    };
}

/** Shows exactly the historical layers in `ids` (unknown ids ignored); other overlays keep their visibility. */
export function withVisibleLayers(overlays: readonly Overlay[], ids: ReadonlySet<string>): readonly Overlay[] {
    // A link that names a place category sets every category (named: on, else off); one that names none keeps their defaults.
    const placesNamed = overlays.some((overlay) => overlay.kind === 'poi' && ids.has(overlay.id));
    return overlays
        .filter((overlay) => overlay.kind === 'raster' || (placesNamed && overlay.kind === 'poi'))
        .reduce((list, overlay) => withOverlayVisibility(list, overlay.id, ids.has(overlay.id)), overlays);
}

/**
 * A historical layer switched on moves the timeline to its year, so that it shows (V03, the owner 2026-11-09), and comes to
 * the front, above a newer opaque one too (V15, the owner 2026-11-13); with several on, the last one switched on is the
 * timeline's. Switched off, or any other overlay, leaves the timeline as it is.
 */
export function withLayerYear(state: ViewerState, overlay: Overlay): ViewerState {
    const layer = overlay.visible ? state.manifest?.layers.find((candidate) => candidate.id === overlay.id) : undefined;
    return layer === undefined ? state : { ...state, year: layer.year, front: layer.id };
}

/** The timeline stop nearest `year`, with exactly its layers visible, the last of them in manifest order on top. */
export function withYear(state: ViewerState, year: number | null): ViewerState {
    const layers = state.manifest?.layers ?? [];
    const stop = snapYear(year, timelineYears(layers));
    const next = { ...state, year: stop, overlays: withVisibleLayers(state.overlays, layerIdsOfYear(layers, stop)), front: null };
    return sameStop(state, next) ? state : next;
}

/**
 * V13: a date picked on the timeline's year (a year with several layers): the timeline at that layer's year, exactly that
 * year's layers visible, the picked one on top (V15's front); an unknown id leaves the state as it is.
 */
export function withFrontLayer(state: ViewerState, layerId: string): ViewerState {
    const layer = state.manifest?.layers.find((candidate) => candidate.id === layerId);
    if (layer === undefined) {
        return state;
    }
    const next = { ...withYear(state, layer.year), front: layer.id };
    return sameFront(state, next) ? state : next;
}

/** Whether two states stand on the same stop with the same layers and the same chosen front. */
function sameFront(state: ViewerState, next: ViewerState): boolean {
    return next.year === state.year && next.overlays === state.overlays && state.front === next.front;
}

/** Whether two states stand on the same stop with the same layers and no chosen front. */
function sameStop(state: ViewerState, next: ViewerState): boolean {
    return next.year === state.year && next.overlays === state.overlays && state.front === null;
}

/**
 * M17 §5: the story `storyId` open (null: their list), the timeline at the stop nearest the story's first year; null when the
 * manifest has no such story.
 */
export function withStory(state: ViewerState, storyId: string | null): ViewerState | null {
    const story = storyId === null ? null : storyOf(state.manifest, storyId);
    if (story === undefined) {
        return null;
    }
    const open: ViewerState = {
        ...state,
        sheet: 'stories',
        selectedStoryId: storyId,
        selectedPhotoId: null,
        selectedPoiId: null,
        lightbox: false,
    };
    return story?.yearStart === undefined ? open : withYear(open, story.yearStart);
}

function storyOf(manifest: Manifest | null, storyId: string): Story | undefined {
    return (manifest?.stories ?? []).find((candidate) => candidate.id === storyId);
}

/** The overlay's label in the current language (`id` when the overlay is unknown). */
export function overlayName(state: ViewerState, id: string): string {
    const overlay = findOverlay(state.overlays, id);
    return overlay === undefined ? id : overlayLabel(overlay, state.locale);
}

/** Compare's mode at the state's window class: a compact window toggles on its one map. */
export function compareModeOf(state: Pick<ViewerState, 'windowClass'>): CompareMode {
    return state.windowClass === 'compact' ? 'toggle' : 'swipe';
}

/** Whether `layerId` can be the compared side: today (null) or a historical layer of the manifest. */
export function isCompareLayer(manifest: Manifest, layerId: string | null): boolean {
    return layerId === null || manifest.layers.some((layer) => layer.id === layerId);
}

/** The overlays as the compared side shows them: the same photos and places, of the historical layers only `layerId`. */
export function comparedOverlays(overlays: readonly Overlay[], layerId: string | null): readonly Overlay[] {
    return withVisibleLayers(overlays, new Set(layerId === null ? [] : [layerId]));
}

/**
 * What the viewer's map shows: the overlays, except while a compact window's toggle shows the compared side (position
 * 0), when its historical layers are the compared side's.
 */
export function displayedOverlays(state: Pick<ViewerState, 'overlays' | 'compare' | 'windowClass'>): readonly Overlay[] {
    const compare = state.compare;
    if (compare === null || compare.position > 0 || compareModeOf(state) === 'swipe') {
        return state.overlays;
    }
    return comparedOverlays(state.overlays, compare.layerId);
}

export function hasPoi(state: ViewerState, poiId: string): boolean {
    return (
        (state.manifest?.pois ?? []).some((poi) => poi.id === poiId) || wikipediaArticleOf(state.wikipedia.articles, poiId) !== undefined
    );
}

export function sheetAfterClosing(sheet: SheetName, closed: SheetName): SheetName {
    return sheet === closed ? 'none' : sheet;
}

/** Where compare's divider settles: `position` (clamped), else where it was, else the middle. */
export function comparePosition(state: ViewerState, position: number | undefined): number {
    return clamp(position ?? state.compare?.position ?? DEFAULT_COMPARE_POSITION, 0, 1);
}
