/**
 * The viewer store (docs/research/M1-interfaces.md §6): one observable state, the actions that change it, and the
 * map, the URL hash, the stored preferences and telemetry kept in step with it. Pure transitions live in `state.ts`,
 * `url-sync.ts` and the overlay model of @hcm/shared; the boot sequence (manifest, hash, preferences, map) is in
 * `boot.ts`. Every action ignores what it cannot apply (an unknown id, a call before the manifest) instead of throwing.
 */
import {
    clamp,
    PHOTOS_NEAR_WINDOWS,
    encodeHash,
    findOverlay,
    withOverlayVisibility,
    withVisibleOpaque,
    type DecodedHash,
    type LngLat,
    type ViewerLocale,
    type MapView,
    type MessageKey,
    type PhotoView,
} from '@hcm/shared';
import type { AccentChoice } from '@hcm/ui';
import type { MapLabels } from '@hcm/shared/map-labels';
import { Listeners, type CameraOffset, type Unsubscribe } from '@hcm/ui/map';

import type { Measurement } from '../telemetry/telemetry-port.js';
import { Boot, type BootHost } from './boot.js';
import { CompareDriver, type CompareDriverHost } from './compare-driver.js';
import { setOverlayGroup, setOverlayOpacityOf } from './overlay-groups.js';
import { faceBearing, resetNorth, watchCamera, zoomBy, type CompassActions } from './compass.js';
import { inputLogger, measureToast, shareLogger } from './viewer-analytics.js';
import { withWindowSize } from './window-size.js';
import type { MountedMap } from './compare-port.js';
import type { ViewerDeps } from './deps.js';
import { LocaleSwitch } from './locale-switch.js';
import { withRequestedLabels } from './map-labels.js';
import { Preferences } from './preferences.js';
import { accentChooser, themeChooser } from './theme-choice.js';
import {
    comparePosition,
    hasPoi,
    isCompareLayer,
    locateTarget,
    sheetAfterClosing,
    withFrontLayer,
    withLayerYear,
    withStory,
    withYear,
    type MyLocationState,
    type SheetName,
    type ThemeMode,
    type ViewerState,
} from './state.js';
import { encodeViewerHash, HashWriter } from './url-sync.js';
import { WikipediaFollower } from './wikipedia.js';

/** `#ring` while Show on map starts the camera. */
const LOCATING = -1;

export type { ViewerDeps, ViewerLocation } from './deps.js';
export { PHOTO_YEAR_WINDOW } from './timeline.js';
export type { SheetName, ThemeMode, ViewerError, ViewerState, ViewerStatus } from './state.js';

export interface ViewerActions {
    /** Fetch (or take the inline) manifest, check compat, validate, mount the map; errors land in state.error. */
    load(): Promise<void>;
    retry(): Promise<void>;
    setLocale(locale: ViewerLocale): void;
    setYear(year: number | null): void;
    /** V13: a date of the timeline's year picked: its layer's year on the timeline, that layer on top (V15). */
    pickLayer(layerId: string): void;
    /**
     * Any overlay id (layer, `photos`, POI category); without `visible` it toggles. The map follows; a layer switched on
     * moves the timeline to its year.
     */
    toggleOverlay(overlayId: string, visible?: boolean): void;
    /** A place category's sub-group on or off (`poi-groups.ts`); one turned on turns its category on. */
    toggleOverlayGroup(overlayId: string, group: string, visible: boolean): void;
    /** Live: the map follows on the next animation frame; `final` (slider released) also writes the hash. */
    setOverlayOpacity(overlayId: string, opacity: number, final?: boolean): void;
    openPhoto(photoId: string | null): void;
    /**
     * The photo sheet's Locate: the camera flies to the photo's place (a jump under reduced motion), zoomed in at least as far
     * as its view cone shows and no further than the city allows, the place `offset` px from the map's centre (beside the
     * sheet); a ring marks it until the camera moves again or a photo opens or closes. The URL hash follows the camera as
     * always. An unknown id, or no map, moves nothing.
     */
    locatePhoto(photoId: string, offset: CameraOffset): void;
    /** The open photo's thumbnail was decoded (`ok`) or failed (§76: `photo_timing`). */
    photoShown(ok: boolean): void;
    /** Opens the POI's details in the detail sheet (`sheet: 'poi'`); null closes; an unknown id is ignored. */
    openPoi(poiId: string | null): void;
    /** M17: the `stories` sheet with that story (null: their list), the timeline at its year; an unknown id says so. */
    openStory(storyId: string | null): void;
    /** The open photo's version (the URL hash's `pv=`). */
    setPhotoVersion(view: PhotoView): void;
    setLightbox(open: boolean): void;
    openSheet(sheet: SheetName): void;
    /** Minimizes the extra-large Layers pane to its rail (true) or restores it: for the session, not in the hash (V03). */
    setLayersHidden(hidden: boolean): void;
    /** Records the map's view (the `moveend` path); the camera does not move. */
    setView(view: MapView): void;
    /**
     * Moves the camera to `view` (animated unless reduced motion) and records it: "show my location" (CR-17). The URL hash
     * keeps the view it had until the camera moves elsewhere: the view is the visitor's position.
     */
    flyTo(view: MapView): void;
    /**
     * The zoom buttons: one level in (`step` 1) or out (-1) from the camera's own zoom, animated unless reduced motion,
     * within the city's zoom range; at its end nothing moves. The hash follows from the camera's `moveend` (`setView`).
     */
    zoomBy(step: number): void;
    /** The visitor shared the page (Web Share or the clipboard): the `share` analytics event (CR-17). */
    logShare(): void;
    /** A pad or a games console's browser is in use: the `input_device` event, once a page each (V65). */
    logInput(device: 'gamepad' | 'console'): void;
    setWindowSize(width: number, height: number): void;
    setTheme(theme: ThemeMode): void;
    /** The theme's colours: the device's accent or the map's own, remembered for the city. */
    setAccent(accent: AccentChoice): void;
    setConsent(consent: 'granted' | 'denied'): void;
    showToast(key: MessageKey, params?: Readonly<Record<string, string>>): void;
    dismissToast(): void;
    /**
     * Applies a decoded URL hash (on load and on `hashchange`; decoded with the manifest's overlay ids as
     * `overlayIds`); opacities through `withHashOpacity`; unknown ids are ignored, an unknown photo shows a toast.
     */
    applyHash(hash: DecodedHash): void;
    /**
     * M4 (V06): compares the map with `layerId` (null: today) as the main side; a layer the manifest does not have is
     * ignored; `position` places the divider (default: where it was, else the middle). While open it changes the side.
     */
    openCompare(layerId: string | null, position?: number): void;
    /** M4: the divider's settled place (0 to 1, clamped); nothing while compare is closed. */
    setComparePosition(position: number): void;
    /** M4: closes compare; its second map goes with it. */
    closeCompare(): void;
    /** The basemap's own labels, on every map, live: a kind this basemap does not have, or no map yet, is ignored (V31). */
    setMapLabels(labels: Partial<MapLabels>): void;
    /** Design B: only the photos within `window` years of the year (one of `PHOTOS_NEAR_WINDOWS`), or every photo (null). */
    setPhotosNear(window: number | null): void;
    /** Turns the single-key shortcuts on or off (V36), and remembers it for the city. */
    setShortcuts(enabled: boolean): void;
    /** "Show my location" (V10): the visitor's position for the maps' blue dot, kept in memory only (never in the hash). */
    setMyLocation(myLocation: MyLocationState): void;
}

export interface ViewerStore extends ViewerActions, CompassActions {
    getState(): ViewerState;
    subscribe(listener: (state: ViewerState, previous: ViewerState) => void): Unsubscribe;
    destroy(): void;
}

class Store implements ViewerStore, BootHost, CompareDriverHost {
    readonly deps: ViewerDeps;
    readonly preferences: Preferences;
    readonly hash: HashWriter;
    readonly #listeners: Listeners<[ViewerState, ViewerState]>;
    readonly #boot: Boot;
    readonly #compare: CompareDriver;
    readonly #wikipedia = new WikipediaFollower(this);
    readonly #unsubscribe: Unsubscribe[] = [];
    #state: ViewerState;
    #destroyed = false;
    readonly #locale: LocaleSwitch;
    /** Show my location's flight is under way: its own `moveend` keeps the hash's view wherever the flight ended. */
    #flying = false;
    /**
     * Show on map's ring: 2 while its flight is under way (that flight's own `moveend` keeps it), 1 while it shows, 0 without;
     * `LOCATING` while the camera starts, when Mapbox's `moveend`s are the stopped move's and a jump's own (they keep it).
     */
    #ring = 0;

    constructor(deps: ViewerDeps) {
        this.deps = deps;
        this.preferences = new Preferences(deps.storage, deps.log);
        this.#listeners = new Listeners((error) => {
            deps.log.error('state listener failed', { error: String(error) });
        });
        this.#boot = new Boot(this);
        this.#compare = new CompareDriver(this);
        this.#locale = new LocaleSwitch(this, (locale) => this.#boot.catalogue(locale));
        this.#state = this.#boot.initialState();
        this.hash = new HashWriter(deps.location, () => encodeViewerHash(this.#state, this.#boot.defaultLocale));
        this.#unsubscribe.push(
            deps.telemetry.onConsentChange((consent) => {
                this.set({ ...this.#state, consent });
            }),
        );
        const optional = [
            deps.colorScheme?.subscribe((systemDark) => {
                this.set({ ...this.#state, systemDark });
            }),
            deps.location.subscribe?.(() => {
                this.#boot.applyLocationHash();
            }),
        ];
        this.#unsubscribe.push(...optional.filter((stop) => stop !== undefined));
    }

    get destroyed(): boolean {
        return this.#destroyed;
    }

    getState(): ViewerState {
        return this.#state;
    }

    /** The one place the state changes: the map follows, then the subscribers, then telemetry's context. */
    set(next: ViewerState): void {
        const previous = this.#state;
        if (next === previous || this.#destroyed) {
            return;
        }
        this.#state = next;
        this.#boot.followState(previous, next);
        this.#compare.follow(next);
        this.#listeners.emit(next, previous);
        this.#wikipedia.follow(previous, next);
    }

    mountedMap(): MountedMap | null {
        return this.#boot.mountedMap();
    }

    subscribe(listener: (state: ViewerState, previous: ViewerState) => void): Unsubscribe {
        return this.#listeners.add(listener);
    }

    load(): Promise<void> {
        return this.#boot.load();
    }

    readonly retry = (): Promise<void> => this.#boot.load();

    /** The visitor's language, once its texts are here (`locale-switch.ts`). */
    setLocale(locale: ViewerLocale): void {
        this.#locale.choose(locale);
    }

    readonly setYear = (year: number | null): boolean => this.#moveTimeline(withYear(this.#state, year));
    readonly pickLayer = (layerId: string): boolean => this.#moveTimeline(withFrontLayer(this.#state, layerId));

    /** The timeline's stop or front changed: the state, `year_change` when the year did, then the hash; false: no change. */
    #moveTimeline(next: ViewerState): boolean {
        if (next === this.#state) {
            return false;
        }
        const changed = next.year !== this.#state.year;
        this.set(next);
        if (changed) {
            this.deps.telemetry.logEvent({ name: 'year_change', year: next.year });
        }
        this.hash.schedule();
        return true;
    }

    toggleOverlay(overlayId: string, visible?: boolean): void {
        const overlays = withVisibleOpaque(withOverlayVisibility(this.#state.overlays, overlayId, visible));
        const overlay = findOverlay(overlays, overlayId);
        if (overlays === this.#state.overlays || overlay === undefined) {
            return;
        }
        const year = this.#state.year;
        this.set(withLayerYear({ ...this.#state, overlays }, overlay));
        this.deps.telemetry.logEvent({ name: 'layer_toggle', layerId: overlayId, visible: overlay.visible });
        if (this.#state.year !== year) {
            this.deps.telemetry.logEvent({ name: 'year_change', year: this.#state.year });
        }
        this.hash.schedule();
    }

    readonly toggleOverlayGroup: ViewerStore['toggleOverlayGroup'] = (id, group, visible) => {
        setOverlayGroup(this, id, group, visible);
    };

    readonly setOverlayOpacity: ViewerStore['setOverlayOpacity'] = (id, opacity, final = false) => {
        setOverlayOpacityOf(this, id, opacity, final);
    };

    openPhoto(photoId: string | null): void {
        this.#unmark();
        const state = this.#state;
        if (photoId === null) {
            this.set({ ...state, selectedPhotoId: null, lightbox: false, sheet: sheetAfterClosing(state.sheet, 'photo') });
        } else if (state.manifest?.photos.some((photo) => photo.id === photoId) !== true) {
            this.showToast('error.unknownPhoto');
            return;
        } else if (photoId !== state.selectedPhotoId) {
            this.#measure({ kind: 'start', what: 'photo' });
            this.set({ ...state, selectedPhotoId: photoId, selectedPoiId: null, lightbox: false, sheet: 'photo' });
            this.deps.telemetry.logEvent({ name: 'photo_open', photoId });
        }
        this.hash.schedule();
    }

    locatePhoto(photoId: string, offset: CameraOffset): void {
        const target = this.#boot.mountedMap() === null ? null : locateTarget(this.#state, photoId);
        if (target !== null) {
            // Mapbox stops the move under way first, firing its `moveend` at once, and a jump fires its own before returning.
            this.#ring = LOCATING;
            this.#ring = this.#boot.flyMap(target, { offset }) ? 2 : 1;
            this.set({ ...this.#state, photoMark: target.center });
        }
    }

    /** Takes Show on map's ring away, if it shows. */
    #unmark(): void {
        this.#ring = 0;
        if (this.#state.photoMark !== null) {
            this.set({ ...this.#state, photoMark: null });
        }
    }

    /** The ring after a camera move: kept by the flight's own `moveend` (and while the camera starts), gone after the next. */
    #markAfterMove(mark: LngLat | null): LngLat | null {
        if (this.#ring === 2) {
            this.#ring = 1;
        } else if (this.#ring === 1) {
            this.#ring = 0;
            return null;
        }
        return mark;
    }

    /** A field measurement for telemetry (§76; a telemetry without `measure` takes none). */
    #measure(measurement: Measurement): void {
        this.deps.telemetry.measure?.(measurement);
    }

    /** The photo sheet's thumbnail was decoded or failed: the `photo_timing` field measurement ends. */
    photoShown(ok: boolean): void {
        this.#measure({ kind: 'end', what: 'photo', ok });
    }

    openPoi(poiId: string | null): void {
        const state = this.#state;
        if (poiId === null) {
            this.set({ ...state, selectedPoiId: null, sheet: sheetAfterClosing(state.sheet, 'poi') });
            return;
        }
        if (poiId === state.selectedPoiId || !hasPoi(state, poiId)) {
            return;
        }
        this.set({ ...state, selectedPoiId: poiId, selectedPhotoId: null, lightbox: false, sheet: 'poi' });
        this.deps.telemetry.logEvent({ name: 'poi_open', poiId });
        this.hash.schedule();
    }

    openStory(storyId: string | null): void {
        const next = withStory(this.#state, storyId);
        if (next === null) {
            this.showToast('error.unknownStory');
            return;
        }
        this.set(next);
        if (storyId !== null) {
            this.deps.telemetry.logEvent({ name: 'story_open', storyId });
        }
        this.hash.schedule();
    }

    /** The version of the open photo the visitor picked; the URL hash keeps it (`pv=`). */
    setPhotoVersion(view: PhotoView): void {
        this.set({ ...this.#state, photoVersion: view });
        this.hash.schedule();
    }

    setLightbox(open: boolean): void {
        if (!open || this.#state.selectedPhotoId !== null) {
            this.set(open === this.#state.lightbox ? this.#state : { ...this.#state, lightbox: open });
        }
    }

    openSheet(sheet: SheetName): void {
        const state = this.#state;
        if (sheet === state.sheet) {
            return;
        }
        const keepPhoto = sheet === 'photo' ? state.selectedPhotoId : null;
        const keepPoi = sheet === 'poi' ? state.selectedPoiId : null;
        this.set({ ...state, sheet, selectedPhotoId: keepPhoto, selectedPoiId: keepPoi, lightbox: false });
        this.hash.schedule();
    }

    setLayersHidden(layersHidden: boolean): void {
        this.set({ ...this.#state, layersHidden });
    }

    setView(view: MapView): void {
        const state = this.#state;
        // The hash's held view stays while the camera is where Show my location brought it: the flight's own `moveend`
        // (a pane opened mid-flight ends it off the position, half the width the map lost: Mapbox keeps the start's
        // centre point), then the same view at the hash's precision (a resize); it goes once the visitor moved it.
        const held = this.#flying || encodeHash({ view }) === encodeHash({ view: state.view });
        this.#flying = false;
        const photoMark = this.#markAfterMove(state.photoMark);
        this.set({ ...state, view, photoMark, hashView: held ? state.hashView : undefined });
        this.hash.schedule();
    }

    /** The camera goes to the visitor's position: the hash keeps the view it had until the camera moves again. */
    flyTo(view: MapView): void {
        const state = this.#state;
        this.set({ ...state, view, hashView: state.hashView ?? state.view });
        this.#flying = true;
        this.#boot.flyMap(view);
    }

    readonly resetNorth: CompassActions['resetNorth'] = () => resetNorth(this.deps.map, this.#boot, this.deps.telemetry);
    readonly faceBearing: CompassActions['faceBearing'] = (bearing) => faceBearing(this.deps.map, this.#boot, bearing);
    readonly watchCamera: CompassActions['watchCamera'] = (listener) => watchCamera(this.deps.map, listener);

    zoomBy(step: number): void {
        zoomBy(this.deps.map, this.#boot, this.#state.manifest?.city, step);
    }

    readonly logShare: ViewerStore['logShare'] = shareLogger(() => this.deps.telemetry);

    /** A pad or a games console's browser, reported once a page each (V65; `input_device`, after consent). */
    readonly logInput: ViewerStore['logInput'] = inputLogger(() => this.deps.telemetry);

    setWindowSize(width: number, height: number): void {
        const next = withWindowSize(this.#state, width, height);
        if (next !== this.#state) {
            this.set(next);
        }
    }

    readonly setTheme: ViewerStore['setTheme'] = themeChooser(this);
    readonly setAccent: ViewerStore['setAccent'] = accentChooser(this);

    setConsent(consent: 'granted' | 'denied'): void {
        this.deps.telemetry.setConsent(consent);
    }

    showToast(key: MessageKey, params?: Readonly<Record<string, string>>): void {
        this.set({ ...this.#state, toast: params === undefined ? { key } : { key, params } });
        measureToast(this.deps.telemetry, key);
    }

    dismissToast(): void {
        if (this.#state.toast !== null) {
            this.set({ ...this.#state, toast: null });
        }
    }

    applyHash(hash: DecodedHash): void {
        this.#boot.applyHash(hash);
    }

    openCompare(layerId: string | null, position?: number): void {
        const state = this.#state;
        if (state.manifest === null || !isCompareLayer(state.manifest, layerId)) {
            return;
        }
        if (state.compare === null) {
            this.#measure({ kind: 'start', what: 'compare' });
        }
        this.set({ ...state, compare: { layerId, position: comparePosition(state, position) } });
        if (state.compare === null) {
            this.deps.telemetry.logEvent({ name: 'compare_open' });
        }
        this.hash.schedule();
    }

    setComparePosition(position: number): void {
        const compare = this.#state.compare;
        const settled = clamp(position, 0, 1);
        const moved = compare !== null && settled !== compare.position;
        this.#setHashed(moved ? { ...this.#state, compare: { ...compare, position: settled } } : this.#state);
    }

    /** `next`, and its hash written once the view settles; nothing when it is the current state. */
    #setHashed(next: ViewerState): void {
        if (next !== this.#state) {
            this.set(next);
            this.hash.schedule();
        }
    }

    /** Swipe compare's second map is ready (or failed): the `compare_timing` field measurement ends. */
    compareReady(ok: boolean): void {
        this.#measure({ kind: 'end', what: 'compare', ok });
    }

    closeCompare(): void {
        this.#setHashed(this.#state.compare === null ? this.#state : { ...this.#state, compare: null });
    }

    setMapLabels(labels: Partial<MapLabels>): void {
        const mapLabels = withRequestedLabels(this.#state.mapLabels, labels);
        this.#setHashed(mapLabels === this.#state.mapLabels ? this.#state : { ...this.#state, mapLabels });
    }

    setPhotosNear(window: number | null): void {
        const offered = window === null || PHOTOS_NEAR_WINDOWS.some((each) => each === window);
        this.#setHashed(offered && window !== this.#state.photosNear ? { ...this.#state, photosNear: window } : this.#state);
    }

    setShortcuts(enabled: boolean): void {
        this.set({ ...this.#state, shortcuts: enabled });
        this.preferences.set(this.#state.manifest?.city.id ?? this.deps.config.cityId, 'shortcuts', enabled ? null : 'off');
    }

    setMyLocation(myLocation: MyLocationState): void {
        this.set({ ...this.#state, myLocation });
    }

    destroy(): void {
        if (this.#destroyed) {
            return;
        }
        this.#destroyed = true;
        this.hash.cancel();
        this.#compare.destroy();
        this.#boot.destroy();
        for (const unsubscribe of this.#unsubscribe) {
            unsubscribe();
        }
        this.#listeners.clear();
        this.deps.telemetry.destroy();
    }
}

/** The store of one viewer; `destroy` also removes the map and telemetry it was given. */
export function createViewerStore(deps: ViewerDeps): ViewerStore {
    return new Store(deps);
}
