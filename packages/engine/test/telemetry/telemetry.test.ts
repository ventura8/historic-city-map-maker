import type { FirebaseApp } from 'firebase/app';
import type { Analytics } from 'firebase/analytics';
import { describe, expect, it } from 'vitest';

import type { FirebaseSdk } from '../../src/telemetry/analytics.js';
import { createTelemetry, loadFieldSdk, loadFirebaseSdk, type TelemetryDeps } from '../../src/telemetry/telemetry.js';
import { memoryStorage, recordingLog, settle } from '../core/support.js';
import { fakeField } from './support.js';
// Imported up front, so `loadFieldSdk` finds the module loaded (a cold transform of web-vitals is slow under load).
import { fieldSdk } from '../../src/telemetry/field-sdk.js';

const CONTEXT = {
    cityId: 'bucuresti',
    locale: 'ro',
    windowClass: 'compact',
    measurementId: 'G-TEST1234',
    errorEndpoint: 'https://errors.example.org/report',
    firebase: { apiKey: 'test-api-key', appId: '1:2:web:3', projectId: 'demo-hcm' },
};

/** `document.cookie` of a page that holds the cookies gtag.js wrote; a `Max-Age=0` write removes one. */
function cookieJar(cookies: readonly string[]): { cookie: string } {
    const jar = new Set(cookies);
    return {
        get cookie(): string {
            return [...jar].map((name) => `${name}=1`).join('; ');
        },
        set cookie(write: string) {
            if (write.includes('Max-Age=0')) {
                jar.delete(write.split('=', 1).join(''));
            }
        },
    };
}

function fakeWindow(cookies: readonly string[] = []): TelemetryDeps['window'] & EventTarget {
    return Object.assign(new EventTarget(), {
        innerWidth: 1280,
        innerHeight: 800,
        location: { origin: 'https://site.example.org', pathname: '/bucuresti/', hostname: 'site.example.org' },
        document: cookieJar(cookies),
    });
}

/** A `performance` that stands still at 500 ms. */
const STILL = { now: () => 500, mark: () => ({}) as PerformanceMark, measure: () => ({}) as PerformanceMeasure };

function sdk(events: string[], params: unknown[] = []): FirebaseSdk {
    return {
        initializeApp: () => ({}) as FirebaseApp,
        isSupported: () => Promise.resolve(true),
        setConsent: () => undefined,
        initializeAnalytics: () => ({}) as Analytics,
        logEvent: (_analytics, name, sent) => {
            events.push(name);
            params.push(sent);
        },
        setAnalyticsCollectionEnabled: () => undefined,
    };
}

function setup(
    stored: Readonly<Record<string, string>> = {},
    page = fakeWindow(),
): {
    telemetry: ReturnType<typeof createTelemetry>;
    events: string[];
    posts: [string, RequestInit][];
    page: ReturnType<typeof fakeWindow>;
    storage: ReturnType<typeof memoryStorage>;
    log: ReturnType<typeof recordingLog>;
    params: unknown[];
} {
    const events: string[] = [];
    const params: unknown[] = [];
    const posts: [string, RequestInit][] = [];
    const storage = memoryStorage(stored);
    const log = recordingLog();
    const telemetry = createTelemetry({
        window: page,
        storage,
        fetch: (url, init) => {
            posts.push([url, init]);
            return Promise.resolve();
        },
        log: log.log,
        release: '1.0.0',
        loadSdk: () => Promise.resolve(sdk(events, params)),
        loadField: () => Promise.resolve(fakeField()),
        now: () => 0,
        performance: STILL,
    });
    return { telemetry, events, posts, page, storage, log, params };
}

describe('telemetry', () => {
    it('badPath_noAnalyticsBeforeConsent', async () => {
        const { telemetry, events } = setup();
        telemetry.setContext?.(CONTEXT);

        telemetry.logEvent({ name: 'page_view' });
        await settle();

        expect(telemetry.consent).toBe('unknown');
        expect(events).toEqual([]);
    });

    it('happyPath_acceptingCountsThePageViewAndLaterEvents', async () => {
        const { telemetry, events, storage } = setup();
        const heard: string[] = [];
        telemetry.onConsentChange((consent) => heard.push(consent));
        telemetry.setContext?.(CONTEXT);
        telemetry.logEvent({ name: 'page_view' });

        telemetry.setConsent('granted');
        telemetry.logEvent({ name: 'share' });
        await settle();

        expect(events).toEqual(['page_view', 'share']);
        expect(heard).toEqual(['granted']);
        expect(storage.get('hcm:bucuresti:consent')).toBe('granted');
    });

    it('happyPath_aStoredConsentAppliesOnceTheCityIsKnown', async () => {
        const { telemetry, events } = setup({ 'hcm:bucuresti:consent': 'granted' });

        telemetry.setContext?.(CONTEXT);
        telemetry.logEvent({ name: 'page_view' });
        await settle();

        expect(telemetry.consent).toBe('granted');
        expect(events).toEqual(['page_view']);
    });

    it('happyPath_acceptingBeforeAnyPageViewSendsNone', async () => {
        const { telemetry, events } = setup();
        telemetry.setContext?.(CONTEXT);

        telemetry.setConsent('granted');
        await settle();

        expect(events).toEqual([]);
    });

    it('happyPath_uncaughtErrorsArePostedAsTextWithoutCredentials', () => {
        const { telemetry, posts, page } = setup();
        telemetry.setContext?.(CONTEXT);

        page.dispatchEvent(Object.assign(new Event('error'), { error: new Error('boom') }));
        telemetry.reportError(new Error('boundary'), { fatal: true, source: 'boundary' });

        expect(posts.map(([url]) => url)).toEqual(['https://errors.example.org/report', 'https://errors.example.org/report']);
        const [, init] = posts[0] ?? ['', {}];
        expect(init).toMatchObject({ method: 'POST', headers: { 'content-type': 'text/plain' }, keepalive: true, credentials: 'omit' });
        expect(JSON.parse(init.body as string)).toMatchObject({
            message: 'Error: boom',
            page: 'https://site.example.org/bucuresti/',
            viewport: { width: 1280, height: 800 },
        });
    });

    it('badPath_withoutAnErrorEndpointNothingIsPosted', () => {
        const { telemetry, posts } = setup();
        telemetry.setContext?.({ cityId: 'bucuresti', locale: 'ro', windowClass: 'compact' });

        telemetry.reportError(new Error('x'), { fatal: false, source: 'boundary' });

        expect(posts).toEqual([]);
    });

    it('badPath_afterDestroyNothingIsSentOrHooked', async () => {
        const { telemetry, posts, page, events } = setup();
        telemetry.setContext?.(CONTEXT);
        telemetry.destroy();
        telemetry.destroy();

        telemetry.setConsent('granted');
        telemetry.logEvent({ name: 'page_view' });
        telemetry.reportError(new Error('x'), { fatal: false, source: 'boundary' });
        page.dispatchEvent(Object.assign(new Event('error'), { error: new Error('late') }));
        await settle();

        expect(telemetry.consent).toBe('unknown');
        expect(posts).toEqual([]);
        expect(events).toEqual([]);
    });

    it('happyPath_theDefaultsUseTheRealClockAndTheLazyChunk', () => {
        const telemetry = createTelemetry({
            window: fakeWindow(),
            storage: memoryStorage(),
            fetch: () => Promise.resolve(),
            log: recordingLog().log,
            release: '1.0.0',
            cityId: 'bucuresti',
        });

        telemetry.reportError(new Error('x'), { fatal: false, source: 'boundary' });

        expect(telemetry.consent).toBe('unknown');
        telemetry.destroy();
    });

    it('happyPath_theFirebaseChunkHasOnlyAppAndAnalytics', async () => {
        const firebase = await loadFirebaseSdk();

        expect(Object.keys(firebase).sort((a, b) => a.localeCompare(b))).toEqual([
            'initializeAnalytics',
            'initializeApp',
            'isSupported',
            'logEvent',
            'setAnalyticsCollectionEnabled',
            'setConsent',
        ]);
        expect(await firebase.isSupported()).toBe(false);
    });
});

describe('telemetry: field measurements', () => {
    it('happyPath_aBootPhaseMeasuredBeforeConsentIsSentAfterItWithTheWindowClassAndRelease', async () => {
        const { telemetry, events, params } = setup();
        telemetry.setContext?.({ ...CONTEXT, windowClass: 'expanded' });
        telemetry.measure?.({ kind: 'phase', phase: 'manifest' });
        await settle();
        expect(events).toEqual([]);

        telemetry.setConsent('granted');
        await settle();

        expect(events).toEqual(['viewer_timing']);
        expect(params[0]).toEqual({
            phase: 'manifest',
            duration_ms: 0,
            since_start_ms: 500,
            app: 'viewer',
            window_class: 'expanded',
            release: '1.0.0',
            app_surface: 'viewer',
            page_location: 'https://site.example.org/bucuresti/',
        });
    });

    it('badPath_mapErrorsAreSummedUntilThePageIsHidden', async () => {
        const { telemetry, events, page, params } = setup({ 'hcm:bucuresti:consent': 'granted' });
        telemetry.setContext?.(CONTEXT);
        for (let tile = 0; tile < 25; tile += 1) {
            telemetry.measure?.({ kind: 'map_error', errorKind: 'tile' });
        }
        page.dispatchEvent(new Event('visibilitychange'));
        page.dispatchEvent(new Event('pagehide'));
        await settle();

        expect(events).toEqual(['map_errors', 'map_errors']);
        expect(params.map((sent) => (sent as Record<string, unknown>)['error_count'])).toEqual([1, 24]);
    });

    it('badPath_afterDestroyNothingIsMeasuredOrFlushed', async () => {
        const { telemetry, events, page } = setup({ 'hcm:bucuresti:consent': 'granted' });
        telemetry.setContext?.(CONTEXT);
        telemetry.measure?.({ kind: 'map_error', errorKind: 'tile' });
        telemetry.measure?.({ kind: 'map_error', errorKind: 'tile' });
        await settle();
        telemetry.destroy();

        telemetry.measure?.({ kind: 'phase', phase: 'map_idle' });
        page.dispatchEvent(new Event('pagehide'));
        await settle();

        expect(events).toEqual(['map_errors']);
    });

    it('happyPath_theFieldChunkHasTheGuardAndTheVitals', async () => {
        const field = await loadFieldSdk();

        expect(field).toBe(fieldSdk);
        expect(Object.keys(field).sort((a, b) => a.localeCompare(b))).toEqual(['createGuard', 'observeVitals']);
        expect(field.createGuard().check('share', { page_location: 'https://site.example.org/' })).toMatchObject({ ok: true });
    });
});

describe('telemetry: GA4 cookies', () => {
    it('happyPath_withdrawingExpiresTheGa4CookiesOfThePage', async () => {
        const page = fakeWindow(['_ga', '_ga_TEST1234', 'theme']);
        const { telemetry, events, log } = setup({ 'hcm:bucuresti:consent': 'granted' }, page);
        telemetry.setContext?.(CONTEXT);
        telemetry.logEvent({ name: 'page_view' });
        await settle();

        telemetry.setConsent('denied');
        await settle();

        expect(events).toEqual(['page_view']);
        expect(page.document.cookie).toBe('theme=1');
        expect(log.records.filter((record) => record.message === 'analytics cookies expired').map((record) => record.data)).toEqual([
            { count: 2 },
            { count: 0 },
        ]);
    });

    it('badPath_cookiesThatCannotBeReadAreLoggedNotThrown', () => {
        const page = fakeWindow();
        const sandboxed = {
            get cookie(): string {
                throw new DOMException('sandboxed', 'SecurityError');
            },
            set cookie(_write: string) {
                throw new DOMException('sandboxed', 'SecurityError');
            },
        };
        Object.defineProperty(page, 'document', { value: sandboxed });
        const { telemetry, log } = setup({ 'hcm:bucuresti:consent': 'granted' }, page);
        telemetry.setContext?.(CONTEXT);

        telemetry.setConsent('denied');

        expect(telemetry.consent).toBe('denied');
        expect(log.messages()).toContain('analytics cookies not expired');
    });
});

describe('telemetry: privacy signals and the settled year (§200)', () => {
    it('badPath_doNotTrackDeclinesWithoutAskingAndSendsNothing', async () => {
        // @S-V70-BAD-NO-EVENTS-BEFORE-CONSENT: a browser that asks not to be tracked gets no banner and no event.
        const { telemetry, events, storage } = setup({}, Object.assign(fakeWindow(), { navigator: { doNotTrack: '1' } }));
        telemetry.setContext?.(CONTEXT);
        telemetry.logEvent({ name: 'page_view' });
        telemetry.logEvent({ name: 'compass_reset' });
        await settle();

        expect(telemetry.consent).toBe('denied');
        expect(events).toEqual([]);
        expect(storage.has('hcm:bucuresti:consent')).toBe(false);

        telemetry.setConsent('granted');
        telemetry.logEvent({ name: 'share' });
        await settle();
        // Accepting counts the page view of this page (as without the signal), then what follows.
        expect(events).toEqual(['page_view', 'share']);
    });

    it('happyPath_theTimelinesYearLeavesOnceTheYearStaysOrThePageHides', async () => {
        const { telemetry, events, page, params } = setup({ 'hcm:bucuresti:consent': 'granted' });
        telemetry.setContext?.(CONTEXT);
        telemetry.logEvent({ name: 'year_change', year: 1950 });
        telemetry.logEvent({ name: 'year_change', year: 1966 });
        await settle();
        expect(events).toEqual([]);

        page.dispatchEvent(new Event('pagehide'));
        await settle();
        expect(events).toEqual(['year_change']);
        expect(params.at(-1)).toMatchObject({ year: 1966 });

        telemetry.logEvent({ name: 'year_change', year: 1970 });
        telemetry.destroy();
        page.dispatchEvent(new Event('pagehide'));
        await settle();
        expect(events).toEqual(['year_change']);
    });
});
