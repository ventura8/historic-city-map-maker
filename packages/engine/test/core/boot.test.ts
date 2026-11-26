import type { MapOptions, RasterLayerSpec } from '@hcm/ui/map';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HASH_WRITE_DELAY_MS } from '../../src/core/url-sync.js';
import { layer, manifest } from './fixtures.js';
import { harness, loaded, MANIFEST_URL } from './harness.js';
import { jsonResponse, settle } from './support.js';

describe('viewer boot', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('happyPath_loadsTheManifestMountsTheMapAndIsReady', async () => {
        const { store, map, telemetry, fetch, location, container } = await loaded();

        expect(store.getState()).toMatchObject({ status: 'ready', error: null, webgl: true, locale: 'ro' });
        expect(store.getState().manifest?.city.id).toBe('bucuresti');
        expect(fetch).toHaveBeenCalledWith(MANIFEST_URL, { signal: expect.any(AbortSignal) as AbortSignal });
        const [mountedIn, options] = map.callsOf('mount')[0] as [HTMLElement, MapOptions];
        expect(mountedIn).toBe(container);
        expect(options).toMatchObject({
            style: 'mapbox://styles/mapbox/standard-satellite',
            accessToken: 'pk.test-viewer-token',
            locale: 'ro',
            reducedMotion: false,
        });
        expect(map.callsOf('addRasterLayer')).toHaveLength(2);
        expect(map.mapLoadCount).toBe(1);
        expect(telemetry.contexts[0]).toEqual({
            cityId: 'bucuresti',
            locale: 'ro',
            windowClass: 'compact',
            measurementId: 'G-TEST1234',
            errorEndpoint: 'https://errors.example.org/report',
        });
        expect(telemetry.events).toEqual([{ name: 'page_view' }]);
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);
        expect(location.written).toEqual(['#14.5/44.42704/26.0853']);
    });

    it('happyPath_aCityWithoutAnalyticsGivesTelemetryOnlyItsContext', async () => {
        const { telemetry } = await loaded({ manifest: manifest({ analytics: {} }) });
        const { telemetry: errorsOnly } = await loaded({
            manifest: manifest({ analytics: { errorEndpoint: 'https://errors.example.org/r' } }),
        });

        expect(telemetry.contexts[0]).toEqual({ cityId: 'bucuresti', locale: 'ro', windowClass: 'compact' });
        expect(errorsOnly.contexts[0]).toEqual({
            cityId: 'bucuresti',
            locale: 'ro',
            windowClass: 'compact',
            errorEndpoint: 'https://errors.example.org/r',
        });
    });

    it('happyPath_theFirebaseWebAppIdsReachTelemetry', async () => {
        const firebase = { apiKey: ['AI', 'za', 'test'.padEnd(35, '0')].join(''), appId: '1:1234:web:abcd', projectId: 'demo-hcm' };
        const { telemetry } = await loaded({ manifest: manifest({ analytics: { measurementId: 'G-TEST1234', firebase } }) });

        expect(telemetry.contexts[0]).toEqual({
            cityId: 'bucuresti',
            locale: 'ro',
            windowClass: 'compact',
            measurementId: 'G-TEST1234',
            firebase,
        });
    });

    it('happyPath_isLoadingWhileTheManifestIsOnItsWay', () => {
        const { store } = harness({ response: () => new Promise<Response>(() => undefined) });

        const pending = store.load();

        expect(pending).toBeInstanceOf(Promise);
        expect(store.getState().status).toBe('loading');
    });

    it('badPath_a404ShowsNotFoundAndRetryLoadsAgain', async () => {
        let answer = jsonResponse({}, 404);
        const parts = harness({ response: () => Promise.resolve(answer) });

        await parts.store.load();

        expect(parts.store.getState()).toMatchObject({
            status: 'error',
            error: { code: 'error.manifest.notFound', retryable: true, params: { detail: '404' } },
        });
        expect(parts.map.callsOf('mount')).toEqual([]);
        expect(parts.log.messages()).toContain('viewer failed');
        answer = jsonResponse(manifest());
        await parts.store.retry();
        expect(parts.store.getState()).toMatchObject({ status: 'ready', error: null });
    });

    it('badPath_anInvalidManifestIsRefusedWithItsIssueCount', async () => {
        const { store, map } = await loaded({ manifest: { version: 1, city: {}, layers: [], photos: [] } });

        expect(store.getState().error).toMatchObject({ code: 'error.manifest.invalid', retryable: false });
        expect(Number(store.getState().error?.params?.['count'])).toBeGreaterThan(5);
        expect(map.calls).toEqual([]);
    });

    it('badPath_aManifestForANewerEngineNamesTheVersion', async () => {
        const city = manifest();
        const { store } = await loaded({ manifest: { ...city, city: { ...city.city, engine: { minVersion: '9.0.0' } } } });

        expect(store.getState().error).toEqual({ code: 'error.manifest.engineTooOld', retryable: false, params: { version: '9.0.0' } });
    });

    it('badPath_aCityIdThatDoesNotMatchIsReported', async () => {
        const { store } = await loaded({ config: { cityId: 'cluj' } });

        expect(store.getState().error).toEqual({
            code: 'error.config.cityMismatch',
            retryable: false,
            params: { cityId: 'cluj', manifestCityId: 'bucuresti' },
        });
    });

    it('happyPath_anInlineManifestNeedsNoFetch', async () => {
        const { store, fetch, map } = await loaded({
            inline: true,
            manifest: manifest({ layers: [layer({ source: { type: 'pmtiles', url: 'tiles/kh4.pmtiles' } })] }),
        });

        expect(fetch).not.toHaveBeenCalled();
        expect(store.getState().status).toBe('ready');
        expect((map.callsOf('addRasterLayer')[0]?.[0] as RasterLayerSpec).source).toEqual({
            type: 'pmtiles',
            url: 'https://site.example.org/bucuresti/tiles/kh4.pmtiles',
        });
    });

    it('happyPath_assetsResolveAgainstTheManifestAddress', async () => {
        const pmtiles = manifest({ layers: [layer({ source: { type: 'pmtiles', url: 'tiles/kh4.pmtiles' } })] });
        const relative = await loaded({ manifest: pmtiles, config: { manifestUrl: 'data/manifest.json' } });
        const noPage = await loaded({ manifest: pmtiles, href: null });
        const unparsable = await loaded({ manifest: pmtiles, config: { manifestUrl: 'https://[broken' } });

        const source = (parts: { map: { callsOf(method: string): readonly (readonly unknown[])[] } }): unknown =>
            (parts.map.callsOf('addRasterLayer')[0]?.[0] as RasterLayerSpec).source;
        expect(source(relative)).toEqual({ type: 'pmtiles', url: 'https://site.example.org/bucuresti/data/tiles/kh4.pmtiles' });
        expect(source(noPage)).toEqual({ type: 'pmtiles', url: 'https://storage.example.org/cities/bucuresti/tiles/kh4.pmtiles' });
        expect(source(unparsable)).toEqual({ type: 'pmtiles', url: 'https://site.example.org/bucuresti/tiles/kh4.pmtiles' });
    });
});

describe('viewer boot: the map', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('badPath_withoutWebGlThePhotoListStillWorks', async () => {
        const { store, map, telemetry } = await loaded({ map: { webgl: false } });

        expect(store.getState()).toMatchObject({ status: 'ready', webgl: false, error: null });
        expect(map.callsOf('mount')).toEqual([]);
        expect(telemetry.events).toEqual([{ name: 'page_view' }]);
    });

    it('badPath_aMapThatCannotCreateWebGlFallsBackToThePhotoList', async () => {
        const { store, log } = await loaded({ map: { mountError: new Error('webgl') } });

        expect(store.getState()).toMatchObject({ status: 'ready', webgl: false });
        expect(log.messages()).toContain('map failed to load');
    });

    it('badPath_aBasemapThatFailsShowsMapLoadWithRetry', async () => {
        const { store, map } = await loaded({ map: { mountError: new Error('style') } });

        expect(store.getState()).toMatchObject({ status: 'error', error: { code: 'error.mapLoad', retryable: true } });
        expect(map.callsOf('destroy')).toHaveLength(1);
    });

    it('badPath_anyOtherMountFailureIsAMapLoadFailure', async () => {
        const { store } = await loaded({ map: { mountError: new TypeError('odd') } });

        expect(store.getState().error?.code).toBe('error.mapLoad');
    });

    it('badPath_withoutAContainerTheMapCannotLoad', async () => {
        const { store, map } = await loaded({ container: null });

        expect(store.getState().error).toEqual({ code: 'error.mapLoad', retryable: true });
        expect(map.callsOf('mount')).toEqual([]);
    });

    it('happyPath_theHashOpensItsViewLayersAndPhoto', async () => {
        const { store, map } = await loaded({ hash: '#16/44.43/26.1&layers=kh9-1980&photo=mihai-voda-1978' });

        expect(store.getState()).toMatchObject({ year: 1980, selectedPhotoId: 'mihai-voda-1978', sheet: 'photo' });
        expect((map.callsOf('mount')[0]?.[1] as MapOptions).view).toEqual({ center: [26.1, 44.43], zoom: 16, bearing: 0 });
    });

    it('badPath_anUnknownPhotoInTheHashShowsAToast', async () => {
        const { store } = await loaded({ hash: '#photo=nope' });

        expect(store.getState().toast).toEqual({ key: 'error.unknownPhoto' });
        expect(store.getState().selectedPhotoId).toBeNull();
    });

    it('happyPath_aLegacyHashIsRewrittenAtOnce', async () => {
        const { location } = await loaded({ hash: '#15/44.43/26.1/0/!a3!p2' });

        expect(location.written[0]).toBe('#15/44.43/26.1');
    });
});

describe('viewer boot: language and theme', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('happyPath_theUrlLanguageWinsOverTheStoredOne', async () => {
        const fromHash = await loaded({ hash: '#lang=en', stored: { 'hcm:bucuresti:lang': 'ro' } });
        const fromQuery = await loaded({ search: '?lang=en', stored: { 'hcm:bucuresti:lang': 'ro' } });

        expect(fromHash.store.getState().locale).toBe('en');
        expect(fromQuery.store.getState().locale).toBe('en');
    });

    it('happyPath_theStoredLanguageAndThemeOfTheCityApply', async () => {
        const before = harness({
            config: { cityId: 'bucuresti' },
            stored: { 'hcm:bucuresti:lang': 'en', 'hcm:bucuresti:theme': 'dark', 'hcm:bucuresti:accent': 'map' },
        });
        const after = await loaded({
            stored: { 'hcm:bucuresti:lang': 'en', 'hcm:bucuresti:theme': 'light', 'hcm:bucuresti:accent': 'map' },
        });

        expect(before.store.getState()).toMatchObject({ locale: 'en', theme: 'dark', accent: 'map' });
        expect(after.store.getState()).toMatchObject({ locale: 'en', theme: 'light', accent: 'map' });
    });

    it('badPath_anUnsupportedLanguageOrThemeFallsBack', async () => {
        const { store } = await loaded({
            search: '?lang=fr',
            config: { lang: 'de' },
            stored: { 'hcm:bucuresti:lang': 'xx', 'hcm:bucuresti:theme': 'neon', 'hcm:bucuresti:accent': 'neon' },
        });

        // Follow my device and its accent: the defaults.
        expect(store.getState()).toMatchObject({ locale: 'ro', theme: 'system', accent: 'device' });
    });

    it('happyPath_thePageLanguageIsTheDefault', async () => {
        const { store, location } = await loaded({ config: { lang: 'en-GB' } });

        expect(store.getState().locale).toBe('en');
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);
        expect(location.written.at(-1)).not.toContain('lang=');
    });

    it('happyPath_reducedMotionReachesTheMap', async () => {
        const { map } = await loaded({ reducedMotion: true });

        expect((map.callsOf('mount')[0]?.[1] as MapOptions).reducedMotion).toBe(true);
    });
});

describe('viewer boot: concurrency', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('badPath_aNewerLoadSupersedesAnOlderOne', async () => {
        let release: ((response: Response) => void) | undefined;
        let first = true;
        const parts = harness({
            response: () => {
                if (first) {
                    first = false;
                    return new Promise<Response>((resolve) => {
                        release = resolve;
                    });
                }
                return Promise.resolve(jsonResponse(manifest()));
            },
        });

        const slow = parts.store.load();
        await parts.store.retry();
        release?.(jsonResponse({}, 404));
        await slow;

        expect(parts.store.getState().status).toBe('ready');
        expect(parts.map.mapLoadCount).toBe(1);
    });

    it('badPath_destroyedDuringLoadingNothingHappens', async () => {
        const parts = harness();

        const loading = parts.store.load();
        parts.store.destroy();
        await loading;
        await parts.store.load();

        expect(parts.map.callsOf('mount')).toEqual([]);
        expect(parts.telemetry.destroyed).toBe(true);
    });

    it('badPath_destroyedWhileTheMapMountsNothingIsDrawn', async () => {
        const parts = harness();
        let finish: (() => void) | undefined;
        parts.map.mount = () =>
            new Promise<void>((resolve) => {
                finish = resolve;
            });

        const loading = parts.store.load();
        await settle();
        parts.store.destroy();
        finish?.();
        await loading;

        expect(parts.map.callsOf('addRasterLayer')).toEqual([]);
        expect(parts.map.callsOf('destroy')).toHaveLength(1);
    });

    it('badPath_aMountFailureAfterDestroyIsIgnored', async () => {
        const parts = harness();
        let fail: ((error: Error) => void) | undefined;
        parts.map.mount = () =>
            new Promise<void>((_resolve, reject) => {
                fail = reject;
            });

        const loading = parts.store.load();
        await settle();
        parts.store.destroy();
        fail?.(new Error('style'));
        await loading;

        expect(parts.store.getState().status).toBe('loading');
    });

    it('happyPath_retryReplacesTheMountedMap', async () => {
        const { store, map } = await loaded();

        await store.retry();

        expect(map.callsOf('destroy').length).toBeGreaterThan(0);
        expect(map.mapLoadCount).toBe(2);
        expect(store.getState().status).toBe('ready');
    });
});
