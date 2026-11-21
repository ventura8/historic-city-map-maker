/**
 * The engine's public JavaScript API and its auto-boot (docs/ENGINE_API.md → JavaScript API, config.js): `mount`
 * renders a `<hcm-map-viewer>` into an element and returns its controller; `bootViewer` boots an element the page
 * declared itself; `autoBoot` reads `window.HistoricCityMapConfig`.
 *
 * DOM-free logic: the document, the factories of the map, telemetry and store, the network, storage and the location
 * are injected (`MountEnvironment`; `index.ts` wires the browser's), so the node tests drive every path with fakes.
 */
import {
    DEFAULT_CONTAINER_SELECTOR,
    resolveViewerLocale,
    viewerLocaleOf,
    type EngineConfig,
    type Logger,
    type ViewerLocale,
} from '@hcm/shared';
import type { MapLabels } from '@hcm/shared/map-labels';
import {
    installFonts,
    sideLoadExtras,
    watchGamepads,
    type HcmMapViewer,
    type ViewerBootstrap,
    type ViewerController,
    type ViewerError,
    type ViewerReady,
    type ViewerStorePort,
} from '@hcm/ui';
import { createViewerMapPort, type Unsubscribe, type ViewerMapPort } from '@hcm/ui/map';
import type { GamepadSurface } from '@hcm/ui/viewer/gamepad';

import { configFromAttributes, readConfig, type Result } from './config/load.js';
import { EXTRAS_PART_FILE, EXTRAS_PART_INTEGRITY } from './extras-part.js';
import { catalogueLoader, type CatalogueLoader } from './core/catalogues.js';
import type { CompareModule } from './core/compare-port.js';
import type { ColorSchemeSource, ViewerDeps, ViewerLocation } from './core/deps.js';
import type { PreferenceStorage } from './core/preferences.js';
import { colorSchemeOf, locationOf, storageOf } from './core/page-sources.js';
import { createViewerStore, type ViewerState, type ViewerStore } from './core/store.js';
import { extraImports } from './extras/imports.js';
import { mapboxOf } from './mapbox-global.js';
import { bootLocale, failBoot, languageOf, withoutMapbox } from './mount-fail.js';
import { createTelemetry } from './telemetry/telemetry.js';
import type { TelemetryPort } from './telemetry/telemetry-port.js';

/** The tag `mount` renders (registered by `defineElements`). */
export const VIEWER_TAG = 'hcm-map-viewer';

/** The controller of one mounted viewer (docs/ENGINE_API.md → JavaScript API). */
export type HistoricCityMapController = ViewerController;

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

/** How `ready` settles for a state: ok once the map is ready, not ok once boot failed, else still pending (null). */
export function readyOutcome(state: Pick<ViewerState, 'status' | 'manifest' | 'error'>): ViewerReady | null {
    if (state.status === 'ready' && state.manifest !== null) {
        return { ok: true, cityId: state.manifest.city.id };
    }
    return state.status === 'error' && state.error !== null ? { ok: false, code: state.error.code } : null;
}

/**
 * The controller of a booted viewer: calls made before `ready` settles wait and run once the map is ready (they are
 * dropped when boot fails); after `destroy` every call does nothing.
 */
class Controller implements HistoricCityMapController {
    readonly ready: Promise<ViewerReady>;
    readonly #store: ViewerStore;
    readonly #teardown: () => void;
    readonly #resolve: (ready: ViewerReady) => void;
    readonly #queue: (() => void)[] = [];
    readonly #unsubscribe: Unsubscribe;
    #outcome: ViewerReady | null = null;
    #destroyed = false;

    constructor(store: ViewerStore, teardown: () => void) {
        const { promise, resolve } = deferred<ViewerReady>();
        this.ready = promise;
        this.#resolve = resolve;
        this.#store = store;
        this.#teardown = teardown;
        this.#unsubscribe = store.subscribe((state) => {
            this.#settle(readyOutcome(state));
        });
        this.#settle(readyOutcome(store.getState()));
    }

    setYear(year: number | null): void {
        this.#run(() => {
            this.#store.setYear(year);
        });
    }

    toggleLayer(layerId: string, visible?: boolean): void {
        this.#run(() => {
            this.#store.toggleOverlay(layerId, visible);
        });
    }

    setOverlayOpacity(overlayId: string, opacity: number): void {
        this.#run(() => {
            this.#store.setOverlayOpacity(overlayId, opacity, true);
        });
    }

    openPhoto(photoId: string | null): void {
        this.#run(() => {
            this.#store.openPhoto(photoId);
        });
    }

    openPoi(poiId: string | null): void {
        this.#run(() => {
            this.#store.openPoi(poiId);
        });
    }

    /** One of the viewer's languages by its code or a tag of it (`de`, `de-AT`); anything else is ignored. */
    setLang(lang: ViewerLocale): void {
        const locale = viewerLocaleOf(lang);
        this.#run(() => {
            if (locale !== undefined) {
                this.#store.setLocale(locale);
            }
        });
    }

    openCompare(layerId: string | null, options?: { readonly position?: number }): void {
        this.#run(() => {
            this.#store.openCompare(layerId, options?.position);
        });
    }

    setComparePosition(position: number): void {
        this.#run(() => {
            this.#store.setComparePosition(position);
        });
    }

    closeCompare(): void {
        this.#run(() => {
            this.#store.closeCompare();
        });
    }

    setMapLabels(labels: Partial<MapLabels>): void {
        this.#run(() => {
            this.#store.setMapLabels(labels);
        });
    }

    destroy(): void {
        if (this.#destroyed) {
            return;
        }
        this.#settle({ ok: false, code: 'error.generic' });
        this.#destroyed = true;
        this.#unsubscribe();
        this.#store.destroy();
        this.#teardown();
    }

    #settle(outcome: ViewerReady | null): void {
        if (this.#outcome !== null || outcome === null) {
            return;
        }
        this.#outcome = outcome;
        this.#resolve(outcome);
        const queued = this.#queue.splice(0);
        if (outcome.ok) {
            queued.forEach((action) => {
                action();
            });
        }
    }

    #run(action: () => void): void {
        if (this.#destroyed) {
            return;
        }
        if (this.#outcome === null) {
            this.#queue.push(action);
            return;
        }
        action();
    }
}

/**
 * The two calls `mount` makes on the document, each with the one signature it uses: the viewer's element by its tag, a
 * container by its selector (`Pick<Document, ...>` also brought in the DOM's deprecated overloads for legacy tag names,
 * which a test double then appeared to implement; typescript-eslint 8.72 reports that as `no-deprecated`).
 */
interface MountDocument {
    createElement(tagName: typeof VIEWER_TAG): HcmMapViewer;
    querySelector(selectors: string): Element | null;
}

/** Everything `mount` needs from the page; `index.ts` builds it from `window`. */
export interface MountEnvironment {
    readonly document: MountDocument;
    /** The Mapbox MapPort (throws when Mapbox GL JS is missing from the page). */
    readonly createMap: () => ViewerMapPort;
    readonly createTelemetry: (cityId: string | undefined) => TelemetryPort;
    readonly createStore: (deps: ViewerDeps) => ViewerStore;
    readonly fetch: ViewerDeps['fetch'];
    readonly storage: PreferenceStorage;
    readonly location: ViewerLocation;
    readonly log: Logger;
    readonly engineVersion: string;
    /** mapbox-gl.css of the pinned Mapbox GL JS version, linked inside the viewer's shadow root. */
    readonly mapboxCssUrl: string;
    readonly reducedMotion: () => boolean;
    /** Registers the kit's fonts, loaded from `<engineBase>fonts/` (`config.engineBase`, else next to the engine). */
    readonly installFonts: (engineBase: string | undefined) => void;
    /**
     * The viewer's languages, fetched from `<engineBase>i18n/` (`core/catalogues.ts`); without it only the languages the
     * page already has (the node tests: Romanian and English).
     */
    readonly catalogues?: (engineBase: string | undefined) => CatalogueLoader;
    /** M4: swipe compare's lazy chunk (`compare-<hash>.js` of the ES module build, inlined in the IIFE). */
    readonly loadCompare: () => Promise<CompareModule>;
    /** `prefers-color-scheme` of the page (the basemap's light under the `system` theme). */
    readonly colorScheme?: ColorSchemeSource;
    /** Listens for a gamepad, whose lazy chunk comes only once one connects; returns the function that stops it. */
    readonly watchGamepads?: (surface: GamepadSurface, map: ViewerMapPort, used: () => void) => () => void;
    /** Side-loads the full-size view from `<engineBase>engine.extras.js` (`config.engineBase`, else next to the engine). */
    readonly loadExtras?: (engineBase: string | undefined) => Promise<void>;
}

/** What `window.HistoricCityMapConfig` may name before it is validated: only its container is read early. */
function containerOf(raw: unknown): string {
    const container = typeof raw === 'object' && raw !== null ? (raw as { readonly container?: unknown }).container : undefined;
    return typeof container === 'string' && container.trim() !== '' ? container : DEFAULT_CONTAINER_SELECTOR;
}

/** The viewer elements drive the store through `ViewerStorePort`; this checks at compile time that it satisfies it. */
function storePort(store: ViewerStore): ViewerStorePort {
    return store;
}

/** The store's loader of the languages' texts, from `engineBase` (none without one: the node tests). */
function catalogueDeps(env: MountEnvironment, engineBase: string | undefined): Pick<ViewerDeps, 'catalogues'> {
    return env.catalogues === undefined ? {} : { catalogues: env.catalogues(engineBase) };
}

function createMap(env: MountEnvironment): ViewerMapPort | null {
    try {
        return env.createMap();
    } catch (error: unknown) {
        env.log.error('Mapbox GL JS is not available', { message: error instanceof Error ? error.message : String(error) });
        return null;
    }
}

/** The viewer side-loads the full-size view from the engine's folder (`config.engineBase`, else next to the engine). */
function withLightbox(viewer: HcmMapViewer, load: MountEnvironment['loadExtras'], engineBase: string | undefined): void {
    if (load !== undefined) {
        viewer.services = { ...viewer.services, loadExtras: () => load(engineBase) };
    }
}

/** Boots `viewer` with a validated configuration: the store, the map, telemetry, then the load after the first render. */
function start(viewer: HcmMapViewer, config: EngineConfig, env: MountEnvironment): HistoricCityMapController {
    const map = createMap(env);
    if (map === null) {
        return withoutMapbox(viewer, config, env);
    }
    viewer.manifestUrl = config.manifestUrl ?? '';
    viewer.engineVersion = env.engineVersion;
    viewer.mapboxCssUrl = env.mapboxCssUrl;
    env.installFonts(config.engineBase);
    withLightbox(viewer, env.loadExtras, config.engineBase);
    const store = env.createStore({
        config,
        fetch: env.fetch,
        map,
        telemetry: env.createTelemetry(config.cityId),
        storage: env.storage,
        location: env.location,
        log: env.log,
        engineVersion: env.engineVersion,
        mapContainer: () => viewer.mapContainer,
        reducedMotion: env.reducedMotion,
        compare: { load: env.loadCompare, createMap: env.createMap, mapboxCssUrl: env.mapboxCssUrl },
        ...(env.colorScheme === undefined ? {} : { colorScheme: env.colorScheme }),
        ...catalogueDeps(env, config.engineBase),
    });
    const stopGamepads = env.watchGamepads?.(viewer, map, () => {
        store.logInput('gamepad');
    });
    const controller = new Controller(store, () => {
        stopGamepads?.();
        viewer.detach();
        viewer.remove();
    });
    viewer.attach(storePort(store), controller);
    void viewer.updateComplete.then(() => store.load());
    return controller;
}

/** Boots `viewer` from a configuration read in a language: an invalid one shows its error card, for the city owner to fix. */
function bootViewer(
    viewer: HcmMapViewer,
    configIn: (locale: ViewerLocale) => Result<EngineConfig>,
    env: MountEnvironment,
    locale: ViewerLocale,
): HistoricCityMapController {
    const config = configIn(locale);
    const errorIn = (shown: ViewerLocale): ViewerError => {
        const read = configIn(shown);
        return read.ok ? { code: 'error.generic', retryable: false } : read.error;
    };
    return config.ok ? start(viewer, config.value, env) : failBoot(viewer, { errorIn, locale, catalogues: env.catalogues?.(undefined) });
}

/** `HistoricCityMap.mount(element, config)`: renders a viewer into `element` and returns its controller. */
export function mount(element: Element, config: unknown, env: MountEnvironment): HistoricCityMapController {
    const viewer = env.document.createElement(VIEWER_TAG);
    const locale = bootLocale(languageOf(config), env);
    const controller = bootViewer(viewer, (shown) => readConfig(config, shown), env, locale);
    element.append(viewer);
    return controller;
}

/**
 * Boots a `<hcm-map-viewer>` the page wrote itself: its `manifest-url`, `city-id`, `engine-base` attributes (or the
 * same properties set from script, which Lit keeps in step), its `lang` attribute and its `manifest` property.
 */
export function bootDeclared(viewer: HcmMapViewer, env: MountEnvironment): HistoricCityMapController {
    const attributes = {
        manifestUrl: viewer.manifestUrl,
        cityId: viewer.cityId,
        lang: viewer.getAttribute('lang'),
        engineBase: viewer.engineBase,
    };
    const locale = bootLocale(resolveViewerLocale(attributes.lang), env);
    return bootViewer(viewer, (shown) => configFromAttributes(attributes, viewer.manifest, shown), env, locale);
}

/**
 * The auto-boot of `config.js` (docs/ENGINE_API.md → Auto-boot): a configuration mounts into its container (a missing
 * container is logged, there is nowhere to draw); without one, a page that has the default container shows the
 * instructive "config.js is missing" card; otherwise nothing happens. Returns the controller, if a viewer was mounted.
 */
export function autoBoot(rawConfig: unknown, env: MountEnvironment): HistoricCityMapController | null {
    const selector = containerOf(rawConfig);
    const container = querySelector(env, selector);
    if (container === null) {
        if (rawConfig !== undefined) {
            // For the city owner, in the console: in English, the language of the engine's other console messages.
            env.log.error(`The map element “${selector}” does not exist on the page.`, { selector });
        }
        return null;
    }
    return mount(container, rawConfig, env);
}

/** A selector the page wrote may be invalid: that is "no such element", not a crash. */
function querySelector(env: MountEnvironment, selector: string): Element | null {
    try {
        return env.document.querySelector(selector);
    } catch {
        return null;
    }
}

/** Boots every declared `<hcm-map-viewer>` with the page's environment (the viewer's bootstrap). */
export function bootDeclaredIn(environment: () => MountEnvironment): ViewerBootstrap {
    return (element) => {
        bootDeclared(element, environment());
    };
}

/** The globals the engine reads from the page (`window` in a browser). */
export interface EngineScope {
    readonly document?: Pick<Document, 'readyState' | 'addEventListener'>;
    readonly customElements?: CustomElementRegistry;
    readonly HistoricCityMapConfig?: unknown;
}

/** Runs once the document is parsed (at once when it already is: a deferred or module script). */
function whenParsed(doc: Pick<Document, 'readyState' | 'addEventListener'>, run: () => void): void {
    if (doc.readyState === 'loading') {
        doc.addEventListener('DOMContentLoaded', run, { once: true });
        return;
    }
    run();
}

/**
 * What importing the engine does in a page: register the elements, then auto-boot from `config.js`. Nothing happens
 * without a document (a worker, the node tests).
 */
export function startEngine(
    scope: EngineScope,
    define: (registry: CustomElementRegistry) => void,
    environment: () => MountEnvironment,
): void {
    const { document: doc, customElements: registry } = scope;
    if (doc === undefined || registry === undefined) {
        return;
    }
    define(registry);
    whenParsed(doc, () => {
        autoBoot(scope.HistoricCityMapConfig, environment());
    });
}

/** Where the engine script was loaded from: the page parts `engineBaseOf` reads. */
export interface ScriptScope {
    readonly document?: Pick<Document, 'currentScript' | 'baseURI'>;
}

function scriptSource(scope: ScriptScope): string | undefined {
    const src = (scope.document?.currentScript as { readonly src?: unknown } | null | undefined)?.src;
    return typeof src === 'string' && src !== '' ? src : undefined;
}

/**
 * The folder of the engine script, where its own files (fonts) are: `import.meta.url` in the ES module build; in the
 * IIFE build (where `import.meta` is empty) the script that is running while the engine loads; else the page.
 * Read once, while the engine script runs (`currentScript` is null afterwards).
 */
export function engineBaseOf(moduleUrl: string | undefined, scope: ScriptScope): string {
    const source = moduleUrl ?? scriptSource(scope) ?? scope.document?.baseURI;
    return source === undefined ? '' : new URL('./', source).href;
}

/** The release facts `browserEnvironment` needs from `index.ts` (which keeps them, for the release checks). */
export interface EngineRelease {
    readonly engineVersion: string;
    readonly mapboxGlVersion: string;
    /** Where the engine's files (fonts) are when `config.engineBase` does not say: next to the engine script. */
    readonly engineBase: string;
}

function telemetryFactory(win: Window, log: Logger, release: string): MountEnvironment['createTelemetry'] {
    return (cityId) =>
        createTelemetry({
            window: win,
            storage: storageOf(win),
            fetch: (url, init) => win.fetch(url, init),
            log: log.child('telemetry'),
            release,
            ...(cityId === undefined ? {} : { cityId }),
        });
}

/** The real browser behind `mount`: Mapbox from the page's global, `fetch`, `localStorage`, the location, the fonts. */
export function browserEnvironment(
    win: Window & Pick<typeof globalThis, 'FontFace'>,
    release: EngineRelease,
    log: Logger,
): MountEnvironment {
    return {
        document: win.document,
        createMap: () => createViewerMapPort(mapboxOf(win, release.mapboxGlVersion)),
        createTelemetry: telemetryFactory(win, log, release.engineVersion),
        createStore: createViewerStore,
        fetch: (url, init) => win.fetch(url, init),
        storage: storageOf(win),
        location: locationOf(win),
        log,
        engineVersion: release.engineVersion,
        mapboxCssUrl: `https://api.mapbox.com/mapbox-gl-js/v${release.mapboxGlVersion}/mapbox-gl.css`,
        reducedMotion: () => win.matchMedia('(prefers-reduced-motion: reduce)').matches,
        installFonts: (engineBase) => {
            installFonts(win.document, `${engineBase ?? release.engineBase}fonts/`, win.FontFace);
        },
        catalogues: (engineBase) =>
            catalogueLoader({
                fetch: (url, init) => win.fetch(url, init),
                folder: `${engineBase ?? release.engineBase}i18n/`,
                engineVersion: release.engineVersion,
            }),
        loadCompare: () => extraImports.compare().then((chunk) => chunk.compareModule),
        colorScheme: colorSchemeOf(win),
        // The pad's chunk arrives once a pad connects: the `input_device` event says one was used (§200).
        watchGamepads: (surface, map, used) =>
            watchGamepads(
                win,
                async () => {
                    const chunk = await extraImports.gamepad();
                    used();
                    return chunk;
                },
                { surface, map, log: log.child('gamepad') },
            ),
        loadExtras: (engineBase) =>
            sideLoadExtras(
                win.document,
                {
                    url: `${engineBase ?? release.engineBase}${EXTRAS_PART_FILE}`,
                    integrity: EXTRAS_PART_INTEGRITY,
                },
                win.customElements,
            ),
    };
}
