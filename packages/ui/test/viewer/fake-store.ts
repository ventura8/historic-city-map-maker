/**
 * A recording viewer store for the element tests: it implements `ViewerStorePort` with the same overlay model the
 * engine store uses (`@hcm/shared`), records every action in `calls`, and lets a test move the state with `set`.
 * The engine's real store is tested in `packages/engine`; this one only has to be faithful enough to drive the UI.
 */
import { isCompactHeight, isDockable, windowClassFor } from '../../src/theme/tokens.js';
import type {
    AccentChoice,
    MapCamera,
    MyLocationState,
    SheetName,
    ThemeMode,
    ViewerState,
    ViewerStorePort,
} from '../../src/viewer/store-port.js';
import {
    overlaysFromManifest,
    withOverlayOpacity,
    withOverlayVisibility,
    withOverlayGroup,
    type Locale,
    type Manifest,
    type MapView,
    type MessageKey,
    type PhotoView,
} from '@hcm/shared';

import { testManifest } from './fixtures.js';

export interface StoreCall {
    readonly method: string;
    readonly args: readonly unknown[];
}

const VIEW: MapView = { center: [26.0853, 44.4271], zoom: 14.5, bearing: 0 };

/** A state before boot (no manifest yet). */
export function idleState(): ViewerState {
    return {
        status: 'idle',
        error: null,
        locale: 'ro',
        manifest: null,
        webgl: true,
        view: VIEW,
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
        theme: 'system',
        accent: 'device',
        consent: 'unknown',
        toast: null,
        compare: null,
        shortcuts: true,
        mapLabels: {
            shown: { streets: true, pois: true },
            defaults: { streets: true, pois: true },
            available: null,
        },
        photosNear: null,
        myLocation: null,
    };
}

/** A ready state with `manifest` (the test manifest by default) and its overlays at their defaults. */
export function readyState(manifest: Manifest = testManifest(), change: Partial<ViewerState> = {}): ViewerState {
    return { ...idleState(), status: 'ready', manifest, overlays: overlaysFromManifest(manifest), ...change };
}

export class FakeStore implements ViewerStorePort {
    readonly calls: StoreCall[] = [];
    #state: ViewerState;
    readonly #listeners = new Set<(state: ViewerState, previous: ViewerState) => void>();

    constructor(state: ViewerState = idleState()) {
        this.#state = state;
    }

    get listenerCount(): number {
        return this.#listeners.size;
    }

    getState(): ViewerState {
        return this.#state;
    }

    subscribe(listener: (state: ViewerState, previous: ViewerState) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    /** Moves the state and notifies the subscribers (the engine store's contract). */
    set(change: Partial<ViewerState>): void {
        const previous = this.#state;
        this.#state = { ...previous, ...change };
        for (const listener of [...this.#listeners]) {
            listener(this.#state, previous);
        }
    }

    /** The calls of one action, in order. */
    callsOf(method: string): readonly (readonly unknown[])[] {
        return this.calls.filter((call) => call.method === method).map((call) => call.args);
    }

    #record(method: string, ...args: unknown[]): void {
        this.calls.push({ method, args });
    }

    retry(): Promise<void> {
        this.#record('retry');
        return Promise.resolve();
    }

    setLocale(locale: Locale): void {
        this.#record('setLocale', locale);
        this.set({ locale });
    }

    setYear(year: number | null): void {
        this.#record('setYear', year);
        this.set({ year });
    }

    pickLayer(layerId: string): void {
        this.#record('pickLayer', layerId);
        const layer = this.#state.manifest?.layers.find((candidate) => candidate.id === layerId);
        this.set({ front: layerId, year: layer?.year ?? this.#state.year });
    }

    toggleOverlay(overlayId: string, visible?: boolean): void {
        this.#record('toggleOverlay', overlayId, visible);
        this.set({ overlays: withOverlayVisibility(this.#state.overlays, overlayId, visible) });
    }

    toggleOverlayGroup(overlayId: string, group: string, visible: boolean): void {
        this.#record('toggleOverlayGroup', overlayId, group, visible);
        this.set({ overlays: withOverlayGroup(this.#state.overlays, overlayId, group, visible) });
    }

    setOverlayOpacity(overlayId: string, opacity: number, final?: boolean): void {
        this.#record('setOverlayOpacity', overlayId, opacity, final);
        const overlays = withOverlayOpacity(this.#state.overlays, overlayId, opacity);
        if (overlays !== this.#state.overlays) {
            this.set({ overlays });
        }
    }

    openPhoto(photoId: string | null): void {
        this.#record('openPhoto', photoId);
        this.set({ selectedPhotoId: photoId, sheet: photoId === null ? 'none' : 'photo', lightbox: false });
    }

    locatePhoto(photoId: string, offset: readonly [number, number]): void {
        this.#record('locatePhoto', photoId, offset);
    }

    photoShown(ok: boolean): void {
        this.#record('photoShown', ok);
    }

    openStory(storyId: string | null): void {
        this.#record('openStory', storyId);
        this.set({ selectedStoryId: storyId, sheet: 'stories' });
    }

    openPoi(poiId: string | null): void {
        this.#record('openPoi', poiId);
        this.set({ selectedPoiId: poiId, sheet: poiId === null ? 'none' : 'poi' });
    }

    setPhotoVersion(view: PhotoView): void {
        this.#record('setPhotoVersion', view);
        this.set({ photoVersion: view });
    }

    setLightbox(open: boolean): void {
        this.#record('setLightbox', open);
        this.set({ lightbox: open });
    }

    openSheet(sheet: SheetName): void {
        this.#record('openSheet', sheet);
        this.set({ sheet });
    }

    setLayersHidden(hidden: boolean): void {
        this.#record('setLayersHidden', hidden);
        this.set({ layersHidden: hidden });
    }

    setView(view: MapView): void {
        this.#record('setView', view);
        this.set({ view });
    }

    flyTo(view: MapView): void {
        this.#record('flyTo', view);
        this.set({ view });
    }

    zoomBy(step: number): void {
        this.#record('zoomBy', step);
    }

    resetNorth(): void {
        this.#record('resetNorth');
    }

    faceBearing(bearing: number): void {
        this.#record('faceBearing', bearing);
    }

    /** The compass's camera: `moveCamera` plays a frame of the map's `move` to every watcher. */
    camera: MapCamera = { bearing: 0, pitch: 0 };
    readonly #cameraWatchers = new Set<(camera: MapCamera) => void>();

    get cameraWatchers(): number {
        return this.#cameraWatchers.size;
    }

    watchCamera(listener: (camera: MapCamera) => void): () => void {
        this.#cameraWatchers.add(listener);
        listener(this.camera);
        return () => {
            this.#cameraWatchers.delete(listener);
        };
    }

    moveCamera(camera: MapCamera): void {
        this.camera = camera;
        for (const listener of [...this.#cameraWatchers]) {
            listener(camera);
        }
    }

    setShortcuts(enabled: boolean): void {
        this.#record('setShortcuts', enabled);
        this.set({ shortcuts: enabled });
    }

    setMyLocation(myLocation: MyLocationState): void {
        this.#record('setMyLocation', myLocation);
        this.set({ myLocation });
    }

    logShare(): void {
        this.#record('logShare');
    }

    setWindowSize(width: number, height: number): void {
        this.#record('setWindowSize', width, height);
        this.set({ windowClass: windowClassFor(width), compactHeight: isCompactHeight(height), dockable: isDockable(width) });
    }

    setTheme(theme: ThemeMode): void {
        this.#record('setTheme', theme);
        this.set({ theme });
    }

    setAccent(accent: AccentChoice): void {
        this.#record('setAccent', accent);
        this.set({ accent });
    }

    setConsent(consent: 'granted' | 'denied'): void {
        this.#record('setConsent', consent);
        this.set({ consent });
    }

    showToast(key: MessageKey, params?: Readonly<Record<string, string>>): void {
        this.#record('showToast', key, params);
        this.set({ toast: params === undefined ? { key } : { key, params } });
    }

    dismissToast(): void {
        this.#record('dismissToast');
        this.set({ toast: null });
    }

    openCompare(layerId: string | null, position?: number): void {
        this.#record('openCompare', layerId, position);
        this.set({ compare: { layerId, position: position ?? this.#state.compare?.position ?? 0.5 } });
    }

    setComparePosition(position: number): void {
        this.#record('setComparePosition', position);
        const compare = this.#state.compare;
        if (compare !== null) {
            this.set({ compare: { ...compare, position } });
        }
    }

    setPhotosNear(window: number | null): void {
        this.#record('setPhotosNear', window);
        this.set({ photosNear: window });
    }

    setMapLabels(labels: Partial<ViewerState['mapLabels']['shown']>): void {
        this.#record('setMapLabels', labels);
        const { mapLabels } = this.getState();
        this.set({ mapLabels: { ...mapLabels, shown: { ...mapLabels.shown, ...labels } } });
    }

    closeCompare(): void {
        this.#record('closeCompare');
        this.set({ compare: null });
    }
}
