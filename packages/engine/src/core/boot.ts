/**
 * The store's boot sequence and its links to the outside (docs/ENGINE_API.md → Errors and validation, URL hash, Language):
 * the first language (URL, stored choice, `config.lang`, Romanian) and its texts, fetched beside the manifest (Romanian
 * when they cannot be, `catalogues.ts`), the manifest (`config/load.ts`), the URL hash and
 * the stored preferences of the city, telemetry's context, then the map (unless WebGL is missing: the photo list
 * still works, scenario V02) and its events. A newer `load` (Retry) supersedes an older one still in flight. Each
 * step is a field measurement for telemetry (`telemetry.measure`, docs/ARCHITECTURE.md → *Field measurements*).
 */
import {
    decodeHash,
    resolveViewerLocale,
    VIEWER_LOCALES,
    type DecodedHash,
    type Manifest,
    type MapView,
    type MessageKey,
    type ViewerLocale,
} from '@hcm/shared';
import { accentOf } from '@hcm/ui';
import type { FlyOptions, MapEventMap, Unsubscribe } from '@hcm/ui/map';

import { loadManifest, type Result } from '../config/load.js';
import type { Measurement, TelemetryContext } from '../telemetry/telemetry-port.js';
import { firstCatalogue, presentCatalogue } from './catalogues.js';
import type { MountedMap } from './compare-port.js';
import { readMapLabels, withMapAnswer } from './map-labels.js';
import { mapLight } from './map-light.js';
import { mapOptions } from './map-specs.js';
import { MapSync } from './map-sync.js';
import type { ViewerDeps } from './deps.js';
import type { Preferences } from './preferences.js';
import { initialState, overlayName, THEME_MODES, withManifest, type ThemeMode, type ViewerError, type ViewerState } from './state.js';
import { applyDecodedHash, hashLimits, unknownToast, type AppliedHash, type HashWriter } from './url-sync.js';

/** What the boot sequence needs from the store. */
export interface BootHost {
    readonly deps: ViewerDeps;
    readonly preferences: Preferences;
    readonly hash: HashWriter;
    readonly destroyed: boolean;
    getState(): ViewerState;
    set(next: ViewerState): void;
    showToast(key: MessageKey, params?: Readonly<Record<string, string>>): void;
    setLocale(locale: ViewerLocale): void;
    openPhoto(photoId: string | null): void;
    openPoi(poiId: string | null): void;
    setView(view: MapView): void;
}

function exactLocale(value: string | null | undefined): ViewerLocale | null {
    return VIEWER_LOCALES.find((locale) => locale === value) ?? null;
}

/** The language the page address asks for (`#…&lang=`, else `?lang=`), or null: it wins over every other choice. */
export function urlLocaleOf(location: { readonly hash: string; readonly search?: string | undefined }): ViewerLocale | null {
    return decodeHash(location.hash).lang ?? exactLocale(new URLSearchParams(location.search ?? '').get('lang'));
}

function themeOf(value: string | null): ThemeMode {
    return THEME_MODES.find((mode) => mode === value) ?? 'system';
}

/** The manifest's absolute address (relative asset URLs resolve against it), or the page's for an inline manifest. */
function assetBase(manifestUrl: string | undefined, href: string | undefined): string | undefined {
    if (href === undefined) {
        return manifestUrl;
    }
    return manifestUrl === undefined || !URL.canParse(manifestUrl, href) ? href : new URL(manifestUrl, href).href;
}

/** The manifest's analytics ids (the Firebase web app ids too, CR-9), each present only when the manifest has it. */
function analyticsIds(analytics: Manifest['city']['analytics']): Pick<TelemetryContext, 'measurementId' | 'errorEndpoint' | 'firebase'> {
    const { measurementId, errorEndpoint, firebase } = analytics;
    return {
        ...(measurementId === undefined ? {} : { measurementId }),
        ...(errorEndpoint === undefined ? {} : { errorEndpoint }),
        ...(firebase === undefined ? {} : { firebase }),
    };
}

export class Boot {
    readonly #host: BootHost;
    /** The page's language (`config.lang`): the hash names the language only when it differs. */
    readonly defaultLocale: ViewerLocale;
    /** The language the URL asked for, which wins over the stored choice. */
    readonly #urlLocale: ViewerLocale | null;
    #loadId = 0;
    #sync: MapSync | null = null;
    /** The mounted map's container and asset base (swipe compare's anchor), null without a mounted map. */
    #mounted: MountedMap | null = null;
    #mapEvents: Unsubscribe[] = [];

    constructor(host: BootHost) {
        this.#host = host;
        const { config, location } = host.deps;
        this.defaultLocale = resolveViewerLocale(config.lang);
        this.#urlLocale = urlLocaleOf(location);
    }

    initialState(): ViewerState {
        const { config, telemetry } = this.#host.deps;
        const stored = exactLocale(this.#host.preferences.get(config.cityId, 'lang'));
        const theme = themeOf(this.#host.preferences.get(config.cityId, 'theme'));
        const state = initialState(this.#urlLocale ?? stored ?? this.defaultLocale, theme, telemetry.consent);
        const accent = accentOf(this.#host.preferences.get(config.cityId, 'accent'));
        return { ...state, accent, systemDark: this.#host.deps.colorScheme?.dark() === true };
    }

    async load(): Promise<void> {
        const host = this.#host;
        if (host.destroyed) {
            return;
        }
        this.#loadId += 1;
        const id = this.#loadId;
        this.#closeMap();
        host.set({ ...host.getState(), status: 'loading', error: null });
        // The language's texts come beside the manifest; once here, the skeleton says what it waits for.
        const [result] = await Promise.all([
            loadManifest(host.deps.config, { fetch: host.deps.fetch, engineVersion: host.deps.engineVersion }),
            this.catalogue(host.getState().locale).then((ok) => {
                this.#textsArrived(id, ok);
            }),
        ]);
        if (this.#current(id)) {
            await this.#loaded(id, result);
        }
    }

    /** The manifest in the state (or its error), the language's texts, then the map. */
    async #loaded(id: number, result: Result<Manifest>): Promise<void> {
        if (result.ok) {
            this.#enter(result.value);
        }
        if (!(await this.#language(id, result.ok ? null : result.error))) {
            return;
        }
        if (!result.ok) {
            this.#measure({ kind: 'manifest_error', code: result.error.code, retryable: result.error.retryable });
            this.#fail(result.error);
            return;
        }
        this.#measure({ kind: 'phase', phase: 'manifest' });
        await this.#mount(id, result.value);
    }

    /** A render with the texts that just arrived, while the boot `id` still waits for its manifest. */
    #textsArrived(id: number, ok: boolean): void {
        if (ok && this.#current(id)) {
            this.#host.set({ ...this.#host.getState() });
        }
    }

    /** Fetches a language's texts (once; at once when the page has them). */
    catalogue(locale: ViewerLocale): Promise<boolean> {
        return (this.#host.deps.catalogues ?? presentCatalogue)(locale);
    }

    /**
     * The boot's language: the one asked for, else Romanian, saying so; false when not even Romanian's texts load, which
     * leaves the only words the engine carries, its bilingual card (`viewer-render.ts`), and Retry. The boot's error is
     * still the one reported (`hcm-error`): the manifest's, if it failed too (a page opened from the disk).
     */
    async #language(id: number, error: ViewerError | null): Promise<boolean> {
        const host = this.#host;
        const wanted = host.getState().locale;
        const locale = await firstCatalogue((each) => this.catalogue(each), wanted);
        if (!this.#current(id)) {
            return false;
        }
        if (locale === null) {
            this.#fail(error ?? { code: 'error.generic', retryable: true });
            return false;
        }
        host.set({ ...host.getState(), locale });
        if (locale !== wanted) {
            host.showToast('language.unavailable');
        }
        return true;
    }

    #measure(measurement: Measurement): void {
        this.#host.deps.telemetry.measure?.(measurement);
    }

    #current(id: number): boolean {
        return id === this.#loadId && !this.#host.destroyed;
    }

    #fail(error: ViewerError): void {
        this.#host.deps.log.warn('viewer failed', { code: error.code });
        this.#host.set({ ...this.#host.getState(), status: 'error', error });
    }

    /** The manifest in the state, then the URL hash and the city's stored preferences on top of it. */
    #enter(manifest: Manifest): void {
        const host = this.#host;
        const hash = decodeHash(host.deps.location.hash, hashLimits(manifest));
        const applied = applyDecodedHash(withManifest(host.getState(), manifest), hash);
        host.set(this.#withCityPreferences(applied.state, manifest.city.id));
        this.#telemetryContext(host.getState());
        this.#toastUnknown(applied);
        if (hash.legacy) {
            host.hash.flush();
        }
    }

    /** The city's stored language (unless the URL named one), theme and accent. */
    #withCityPreferences(state: ViewerState, cityId: string): ViewerState {
        const stored = exactLocale(this.#host.preferences.get(cityId, 'lang'));
        const theme = this.#host.preferences.get(cityId, 'theme');
        const locale = this.#urlLocale ?? stored ?? state.locale;
        const shortcuts = this.#host.preferences.get(cityId, 'shortcuts') !== 'off';
        const accent = accentOf(this.#host.preferences.get(cityId, 'accent'));
        return { ...state, locale, shortcuts, accent, theme: theme === null ? state.theme : themeOf(theme) };
    }

    async #mount(id: number, manifest: Manifest): Promise<void> {
        const { deps } = this.#host;
        if (!deps.map.isWebGLSupported()) {
            this.#measure({ kind: 'map_unavailable', reason: 'unsupported' });
            this.#ready(false);
            return;
        }
        const container = deps.mapContainer();
        if (container === null) {
            this.#measure({ kind: 'map_unavailable', reason: 'container' });
            this.#ready(null);
            return;
        }
        const state = this.#host.getState();
        const reducedMotion = deps.reducedMotion?.() === true;
        try {
            await deps.map.mount(
                container,
                mapOptions(manifest, {
                    view: state.view,
                    locale: state.locale,
                    reducedMotion,
                    labels: state.mapLabels.shown,
                    light: mapLight(state),
                }),
            );
        } catch (error) {
            this.#mountFailed(id, error);
            return;
        }
        this.#onMounted(id, container);
    }

    /** The mounted map's container and asset base (M4: swipe compare starts beside it), or null without a mounted map. */
    mountedMap(): MountedMap | null {
        return this.#mounted;
    }

    #onMounted(id: number, container: HTMLElement): void {
        const { deps } = this.#host;
        if (this.#current(id)) {
            const state = this.#host.getState();
            this.#host.set({ ...state, mapLabels: withMapAnswer(state.mapLabels, readMapLabels(deps.map)) });
            const base = assetBase(deps.config.manifestUrl, deps.location.href);
            this.#sync = new MapSync(deps.map, base);
            this.#mounted = { anchor: container, assetBase: base };
            this.#listenToMap();
            this.#measure({ kind: 'phase', phase: 'map_render' });
            this.#sync.render(this.#host.getState());
            this.#ready(true);
        }
    }

    #mountFailed(id: number, error: unknown): void {
        if (!this.#current(id)) {
            return;
        }
        const webgl = error instanceof Error && error.message === 'webgl';
        this.#host.deps.log.warn('map failed to load', { error: String(error) });
        this.#measure({ kind: 'map_unavailable', reason: webgl ? 'webgl' : 'style' });
        // A map whose style failed still holds a WebGL context and a canvas: it goes now, Retry makes a new one.
        this.#host.deps.map.destroy();
        this.#ready(webgl ? false : null);
    }

    /** `webgl` false: no map, the photo list (V02); null: the map container or the basemap failed (Retry). */
    #ready(webgl: boolean | null): void {
        const host = this.#host;
        if (webgl === null) {
            this.#fail({ code: 'error.mapLoad', retryable: true });
            return;
        }
        host.set({ ...host.getState(), status: 'ready', webgl });
        host.deps.telemetry.logEvent({ name: 'page_view' });
        host.hash.schedule();
    }

    #listenToMap(): void {
        const host = this.#host;
        const { map } = host.deps;
        this.#mapEvents = [
            map.onPhotoClick((photoId) => {
                host.openPhoto(photoId);
            }),
            map.onPoiClick((poiId) => {
                host.openPoi(poiId);
            }),
            map.on('moveend', (view) => {
                host.setView(view);
            }),
            map.on('error', (event) => {
                this.#mapError(event);
            }),
            map.on('webglcontextlost', () => {
                this.#measure({ kind: 'map_unavailable', reason: 'context_lost' });
                host.set({ ...host.getState(), webgl: false });
            }),
            map.on('idle', () => {
                this.#measure({ kind: 'phase', phase: 'map_idle' });
            }),
            map.on('webglcontextrestored', () => {
                host.set({ ...host.getState(), webgl: true });
            }),
        ];
    }

    /** A layer that fails names itself in a toast; other tile failures get the generic one; the map survives (V03, V16). */
    #mapError(event: MapEventMap['error']): void {
        const host = this.#host;
        host.deps.log.warn('map error', { kind: event.kind, layerId: event.layerId, message: event.message });
        this.#measure({ kind: 'map_error', errorKind: event.kind });
        const toast = host.getState().toast;
        if (event.layerId !== undefined && toast === null) {
            host.showToast('error.layer', { name: overlayName(host.getState(), event.layerId) });
        } else if (event.kind === 'tile' && toast === null) {
            host.showToast('error.tiles');
        }
    }

    /** After every state change: the map follows; telemetry learns a new language or window class. */
    followState(previous: ViewerState, next: ViewerState): void {
        this.#sync?.update(previous, next);
        if (next.locale !== previous.locale || next.windowClass !== previous.windowClass) {
            this.#telemetryContext(next);
        }
    }

    #telemetryContext(state: ViewerState): void {
        const city = state.manifest?.city;
        if (city !== undefined) {
            this.#host.deps.telemetry.setContext?.({
                cityId: city.id,
                locale: state.locale,
                windowClass: state.windowClass,
                ...analyticsIds(city.analytics),
            });
        }
    }

    /** A hash the visitor typed or navigated to (`hashchange`). */
    applyLocationHash(): void {
        this.#host.hash.sync();
        const manifest = this.#host.getState().manifest;
        if (manifest !== null) {
            this.applyHash(decodeHash(this.#host.deps.location.hash, hashLimits(manifest)));
        }
    }

    /** A hash's unknown photo or (M17) story says so. */
    #toastUnknown(applied: AppliedHash): void {
        const toast = unknownToast(applied);
        if (toast !== null) {
            this.#host.showToast(toast);
        }
    }

    /** `ViewerActions.applyHash`: the state, then the map's view, then the toast of an unknown photo or story. */
    applyHash(hash: DecodedHash): void {
        const host = this.#host;
        // A language in the hash goes through `setLocale`: its texts may have to be fetched first.
        const { lang, ...rest } = hash;
        const applied = applyDecodedHash(host.getState(), rest);
        host.set(applied.state);
        if (lang !== undefined) {
            host.setLocale(lang);
        }
        this.moveMap(hash.view);
        this.#toastUnknown(applied);
    }

    /** Moves a mounted map to a view from the hash, without animation. */
    moveMap(view: MapView | undefined): void {
        if (this.#sync !== null && view !== undefined) {
            this.#host.deps.map.flyTo(view, { animate: false });
        }
    }

    /**
     * Flies a mounted map to `view`, or jumps under reduced motion, read now: a visitor may switch it after the map loaded,
     * and Mapbox, which reads it on every move, would otherwise jump without the offset. True when it flew; before the map
     * nothing moves.
     */
    flyMap(view: Partial<MapView>, options?: FlyOptions): boolean {
        if (this.#sync === null) {
            return false;
        }
        const animate = this.#host.deps.reducedMotion?.() !== true;
        this.#host.deps.map.flyTo(view, { ...options, animate });
        return animate;
    }

    #closeMap(): void {
        for (const unsubscribe of this.#mapEvents) {
            unsubscribe();
        }
        this.#mapEvents = [];
        this.#mounted = null;
        if (this.#sync !== null) {
            this.#sync = null;
            this.#host.deps.map.destroy();
        }
    }

    /** Destroys the map exactly once: `#closeMap` destroys a mounted one, a map still mounting is destroyed here. */
    destroy(): void {
        this.#loadId += 1;
        const mounted = this.#sync !== null;
        this.#closeMap();
        if (!mounted) {
            this.#host.deps.map.destroy();
        }
    }
}
