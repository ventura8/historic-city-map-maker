import { createLogger } from '@hcm/shared';
import { FakeMap, FakeMapboxGl } from '@hcm/test-support/fake-map';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mapboxOf } from '../src/mapbox-global.js';
import { autoBoot, browserEnvironment, engineBaseOf, startEngine, type EngineRelease } from '../src/mount.js';
import { recordingLog } from './core/support.js';
import { FakeContainer, config, testEnvironment } from './mount-support.js';

const RELEASE: EngineRelease = { engineVersion: '1.2.3', mapboxGlVersion: '3.34.1', engineBase: 'https://example.org/engine/' };

type PageWindow = Window & typeof globalThis;

interface FakePage {
    readonly window: PageWindow;
    readonly replaced: string[];
    readonly fonts: string[];
    readonly listeners: Map<string, () => void>;
}

function fakePage(change: Record<string, unknown> = {}): FakePage {
    const replaced: string[] = [];
    const fonts: string[] = [];
    const listeners = new Map<string, () => void>();
    const location = {
        hash: '#14/44.43/26.1',
        href: 'https://example.org/city/?lang=en#14/44.43/26.1',
        search: '?lang=en',
        pathname: '/city/',
        origin: 'https://example.org',
    };
    class FontFaceDouble {
        readonly source: string;
        constructor(_family: string, source: string) {
            this.source = source;
        }
    }
    const page = {
        location,
        history: {
            state: null,
            replaceState: (_state: unknown, _title: string, url: string) => {
                replaced.push(url);
            },
        },
        localStorage: { getItem: () => 'stored', setItem: () => undefined, removeItem: () => undefined },
        document: {
            baseURI: 'https://example.org/city/',
            readyState: 'interactive',
            querySelector: () => null,
            fonts: { add: (face: FontFaceDouble) => fonts.push(face.source) },
        },
        FontFace: FontFaceDouble,
        fetch: (url: string) => Promise.resolve(new Response(url)),
        matchMedia: (query: string) => ({ matches: query.includes('reduce') }),
        addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
        removeEventListener: (type: string) => listeners.delete(type),
        innerWidth: 1024,
        innerHeight: 768,
        ...change,
    };
    return { window: page as unknown as PageWindow, replaced, fonts, listeners };
}

describe('the gamepad and the colour scheme of the page', () => {
    function schemePage(matches: boolean): {
        readonly window: PageWindow;
        readonly query: { matches: boolean; onchange: ((event: { matches: boolean }) => void) | null };
    } {
        const query = { matches, onchange: null };
        const events = new EventTarget();
        const page = fakePage({
            matchMedia: () => query,
            addEventListener: events.addEventListener.bind(events),
            removeEventListener: events.removeEventListener.bind(events),
            navigator: { getGamepads: () => [] },
        });
        return { window: page.window, query };
    }

    it('happyPath_theSchemeIsReadAndFollowedUntilUnsubscribed', () => {
        const { window, query } = schemePage(true);
        const scheme = browserEnvironment(window, RELEASE, createLogger('test')).colorScheme;
        const seen: boolean[] = [];

        expect(scheme?.dark()).toBe(true);
        const stop = scheme?.subscribe((dark) => seen.push(dark));
        query.onchange?.({ matches: false });
        stop?.();

        expect(seen).toEqual([false]);
        expect(query.onchange).toBeNull();
    });

    it('happyPath_theWatcherLoadsNothingWithoutAPad', () => {
        const { window } = schemePage(false);
        const env = browserEnvironment(window, RELEASE, createLogger('test'));
        const surface = {
            renderRoot: {} as Element,
            runInput: vi.fn(),
            mapCovered: () => true,
            toast: vi.fn(),
            navigate: vi.fn(),
            activate: vi.fn(),
        };

        const stop = env.watchGamepads?.(surface, new FakeMap(), vi.fn());

        expect(stop).toBeTypeOf('function');
        stop?.();
    });
});

/** A `<script>` as the full-size view's loader uses it. */
class ScriptDouble extends EventTarget {
    src = '';
    integrity = '';
    crossOrigin: string | null = null;

    remove(): void {
        // Nothing to detach from.
    }
}

describe('browserEnvironment', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('happyPath_wiresThePagesLocationStorageFetchAndMotion', async () => {
        const page = fakePage();
        const env = browserEnvironment(page.window, RELEASE, createLogger('test'));

        expect([env.location.hash, env.location.href, env.location.search]).toEqual([
            '#14/44.43/26.1',
            'https://example.org/city/?lang=en#14/44.43/26.1',
            '?lang=en',
        ]);
        env.location.replaceHash('#15/44.4/26.1');
        env.location.replaceHash('');
        expect(page.replaced).toEqual(['#15/44.4/26.1', '/city/?lang=en']);
        const listener = vi.fn();
        const stop = env.location.subscribe?.(listener);
        page.listeners.get('hashchange')?.();
        stop?.();
        expect(listener).toHaveBeenCalledTimes(1);
        expect(page.listeners.has('hashchange')).toBe(false);
        expect(env.storage.getItem('hcm:bucuresti:lang')).toBe('stored');
        expect(env.reducedMotion()).toBe(true);
        await expect((await env.fetch('https://example.org/m.json', { signal: new AbortController().signal })).text()).resolves.toBe(
            'https://example.org/m.json',
        );
        expect(env).toMatchObject({ engineVersion: '1.2.3', mapboxCssUrl: 'https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.css' });
    });

    it('happyPath_fontsLoadFromTheEngineFolderOrTheConfiguredBase', () => {
        const page = fakePage();
        const env = browserEnvironment(page.window, RELEASE, createLogger('test'));

        env.installFonts(undefined);
        const next = fakePage();
        browserEnvironment(next.window, RELEASE, createLogger('test')).installFonts('https://cdn.example.org/hcm/');

        expect(page.fonts.every((source) => source.startsWith('url("https://example.org/engine/fonts/'))).toBe(true);
        expect(next.fonts.every((source) => source.startsWith('url("https://cdn.example.org/hcm/fonts/'))).toBe(true);
        expect(page.fonts.length).toBeGreaterThan(0);
    });

    it('happyPath_theFullSizeViewIsAddedBesideTheEngine', async () => {
        const appended: ScriptDouble[] = [];
        const script = new ScriptDouble();
        const document = { createElement: () => script, head: { append: (element: ScriptDouble) => appended.push(element) } };
        const page = fakePage({ document, customElements: { get: () => undefined } });
        const env = browserEnvironment(page.window, RELEASE, createLogger('test'));

        const loading = env.loadExtras?.(undefined);
        script.dispatchEvent(new Event('load'));
        await loading;

        expect(appended.map((element) => element.src)).toEqual(['https://example.org/engine/engine.extras.js']);
    });

    it('happyPath_compareIsTheLazyChunk', async () => {
        const env = browserEnvironment(fakePage().window, RELEASE, createLogger('test'));

        const chunk = await env.loadCompare();

        expect(typeof chunk.startCompare).toBe('function');
        expect(typeof chunk.createCompareUi).toBe('function');
    });

    it('happyPath_theMapComesFromThePagesMapboxGl', () => {
        const page = fakePage({ mapboxgl: new FakeMapboxGl() });
        const map = browserEnvironment(page.window, RELEASE, createLogger('test')).createMap();

        expect(map.mapLoadCount).toBe(0);
    });

    it('badPath_withoutMapboxGlCreatingTheMapThrows', () => {
        const env = browserEnvironment(fakePage().window, RELEASE, createLogger('test'));

        expect(() => env.createMap()).toThrow(
            'mapboxgl is not defined: load https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.js first',
        );
    });

    it('badPath_aBlockedLocalStorageStoresNothing', () => {
        const blocked = fakePage();
        Object.defineProperty(blocked.window, 'localStorage', {
            get: () => {
                throw new DOMException('blocked', 'SecurityError');
            },
        });
        const env = browserEnvironment(blocked.window, RELEASE, createLogger('test'));

        env.storage.setItem('hcm:x:lang', 'en');
        env.storage.removeItem('hcm:x:lang');
        expect(env.storage.getItem('hcm:x:lang')).toBeNull();
    });

    it('happyPath_telemetryIsMadeForTheCityOrWithoutOne', () => {
        const env = browserEnvironment(fakePage().window, RELEASE, recordingLog().log);

        const withCity = env.createTelemetry('bucuresti');
        const withoutCity = env.createTelemetry(undefined);

        expect([withCity.consent, withoutCity.consent]).toEqual(['unknown', 'unknown']);
        withCity.destroy();
        withoutCity.destroy();
    });
});

/** A page whose `mapbox-gl.js` loads `async`: its script element, and the page's `readyState`. */
function loadingPage(readyState: DocumentReadyState): { readonly window: Window & { mapboxgl?: unknown }; readonly script: EventTarget } {
    const script = new EventTarget();
    const page = { document: { readyState, querySelector: (selector: string) => (selector.includes('mapbox-gl-js') ? script : null) } };
    return { window: page as unknown as Window & { mapboxgl?: unknown }, script };
}

describe('mapboxOf', () => {
    it('happyPath_aMapboxGlStillLoadingIsAwaited', async () => {
        // The cold load of 2026-11-12: the page loads Mapbox GL async, so the engine may run before it.
        const { window: page, script } = loadingPage('interactive');
        const pending = mapboxOf(page, '3.34.1');
        const gl = new FakeMapboxGl();
        page.mapboxgl = gl;
        script.dispatchEvent(new Event('load'));

        await expect(pending).resolves.toBe(gl);
    });

    it('badPath_aScriptThatFailsOrDefinesNothingRejects', async () => {
        const failed = loadingPage('interactive');
        const pending = mapboxOf(failed.window, '3.34.1');
        failed.script.dispatchEvent(new Event('error'));
        const empty = loadingPage('interactive');
        const loaded = mapboxOf(empty.window, '3.34.1');
        empty.script.dispatchEvent(new Event('load'));

        await expect(pending).rejects.toThrow('mapboxgl is not defined');
        await expect(loaded).rejects.toThrow('mapboxgl is not defined');
        expect(() => mapboxOf(loadingPage('complete').window, '3.34.1')).toThrow('mapboxgl is not defined');
    });
});

describe('autoBoot', () => {
    it('happyPath_aConfigurationMountsIntoItsContainer', async () => {
        const world = testEnvironment();
        const container = new FakeContainer();
        world.containers.set('#harta', container);

        const controller = autoBoot(config({ container: '#harta' }), world.env);

        expect(container.children).toEqual([world.viewer]);
        await expect(controller?.ready).resolves.toEqual({ ok: true, cityId: 'bucuresti' });
    });

    it('badPath_aMissingContainerIsLoggedAndNothingIsDrawn', () => {
        const world = testEnvironment();

        expect(autoBoot(config({ container: '#nope', lang: 'en' }), world.env)).toBeNull();
        expect(autoBoot(config({ container: '!invalid' }), world.env)).toBeNull();

        expect(world.log.messages()).toEqual([
            'The map element “#nope” does not exist on the page.',
            // In English whatever the configuration's language: the engine has no catalogue before it fetches one.
            'The map element “!invalid” does not exist on the page.',
        ]);
        expect(world.created).toEqual([]);
    });

    it('badPath_noConfigurationOnAPageWithTheDefaultContainerShowsTheMissingCard', () => {
        const world = testEnvironment();
        const container = new FakeContainer();
        world.containers.set('#historic-city-map', container);

        autoBoot(undefined, world.env);

        expect(world.viewer.bootError?.code).toBe('error.config.missing');
        expect(container.children).toHaveLength(1);
    });

    it('badPath_noConfigurationAndNoContainerDoesNothing', () => {
        const world = testEnvironment();

        expect(autoBoot(undefined, world.env)).toBeNull();
        expect(autoBoot({ container: 42 }, world.env)).toBeNull();
        expect(world.log.messages()).toEqual(['The map element “#historic-city-map” does not exist on the page.']);
    });
});

describe('startEngine', () => {
    it('happyPath_registersThenBootsOnceTheDocumentIsParsed', () => {
        const world = testEnvironment();
        const define = vi.fn();
        const registry = {} as CustomElementRegistry;
        const listeners: (() => void)[] = [];
        const doc = {
            readyState: 'loading' as DocumentReadyState,
            addEventListener: (_type: string, run: () => void) => listeners.push(run),
        };

        startEngine(
            { document: doc as unknown as Document, customElements: registry, HistoricCityMapConfig: config() },
            define,
            () => world.env,
        );

        expect(define).toHaveBeenCalledWith(registry);
        expect(world.created).toEqual([]);
        listeners.forEach((run) => {
            run();
        });
        expect(world.log.messages()).toContain('The map element “#historic-city-map” does not exist on the page.');
    });

    it('happyPath_aParsedDocumentBootsAtOnce', () => {
        const world = testEnvironment();
        const container = new FakeContainer();
        world.containers.set('#historic-city-map', container);
        const doc = { readyState: 'interactive' as DocumentReadyState, addEventListener: vi.fn() };

        startEngine(
            { document: doc, customElements: {} as CustomElementRegistry, HistoricCityMapConfig: config() },
            vi.fn(),
            () => world.env,
        );

        expect(container.children).toEqual([world.viewer]);
        expect(doc.addEventListener).not.toHaveBeenCalled();
    });

    it('badPath_withoutADocumentNothingHappens', () => {
        const define = vi.fn();

        startEngine({}, define, () => testEnvironment().env);
        startEngine({ document: {} as Document }, define, () => testEnvironment().env);

        expect(define).not.toHaveBeenCalled();
    });
});

describe('engineBaseOf', () => {
    it('happyPath_theModuleUrlOrTheRunningScript', () => {
        expect(engineBaseOf('https://example.org/city/engine/engine.mjs', {})).toBe('https://example.org/city/engine/');
        const doc = { currentScript: { src: 'https://cdn.example.org/hcm@1.2.3/engine.iife.js' }, baseURI: 'https://example.org/' };
        expect(engineBaseOf(undefined, { document: doc as unknown as Document })).toBe('https://cdn.example.org/hcm@1.2.3/');
    });

    it('badPath_withoutAScriptAddressThePageOrNothing', () => {
        const inline = { currentScript: { src: '' }, baseURI: 'https://example.org/city/index.html' };
        expect(engineBaseOf(undefined, { document: inline as unknown as Document })).toBe('https://example.org/city/');
        expect(engineBaseOf(undefined, { document: { currentScript: null, baseURI: 'https://example.org/a/b' } })).toBe(
            'https://example.org/a/',
        );
        expect(engineBaseOf(undefined, {})).toBe('');
    });
});
