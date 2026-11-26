/**
 * Test helpers of the viewer's analytics: a recording Firebase SDK, a field chunk with the real guard of `@hcm/shared` and
 * recorded Core Web Vitals observers, and an `AnalyticsLoader` over them.
 */
import { createViewerGuard, type FieldChunk, type GaParams } from '@hcm/shared';
import type { FirebaseApp } from 'firebase/app';
import type { Analytics, ConsentSettings } from 'firebase/analytics';

import { AnalyticsLoader, FIREBASE_APP_NAME, type FirebaseSdk } from '../../src/telemetry/analytics.js';
import { recordingLog } from '../core/support.js';

export const IDS = { apiKey: 'test-api-key', appId: '1:2:web:3', projectId: 'demo-hcm' };
export const PAGE = 'https://site.example.org/bucuresti/';

export interface FakeSdk extends FirebaseSdk {
    readonly log: string[];
    readonly consents: ConsentSettings[];
    readonly events: [string, unknown][];
}

interface FakeSdkOptions {
    readonly supported?: boolean;
    readonly throwOnLog?: boolean;
}

export function fakeSdk(options: FakeSdkOptions = {}): FakeSdk {
    const log: string[] = [];
    const consents: ConsentSettings[] = [];
    const events: [string, unknown][] = [];
    const app: FirebaseApp = { name: FIREBASE_APP_NAME, options: {}, automaticDataCollectionEnabled: false };
    const analytics: Analytics = { app };
    return {
        log,
        consents,
        events,
        initializeApp: (appOptions, name) => {
            log.push(`initializeApp ${name} ${JSON.stringify(appOptions)}`);
            return app;
        },
        isSupported: () => Promise.resolve(options.supported ?? true),
        setConsent: (settings) => {
            consents.push(settings);
        },
        initializeAnalytics: (_app, settings) => {
            log.push(`initializeAnalytics ${JSON.stringify(settings)}`);
            return analytics;
        },
        logEvent: (_analytics, name, params) => {
            if (options.throwOnLog === true) {
                throw new Error('gtag missing');
            }
            events.push([name, params]);
        },
        setAnalyticsCollectionEnabled: (_analytics, enabled) => {
            log.push(`collection ${String(enabled)}`);
        },
    };
}

export interface Loader {
    readonly analytics: AnalyticsLoader;
    readonly loads: () => number;
    /** How often the loader asked for GA4's cookies to be expired. */
    readonly cookieClears: () => number;
}

export function loader(sdk: FirebaseSdk | Error, log = recordingLog(), field: FieldChunk | Error = fakeField()): Loader {
    let loads = 0;
    let clears = 0;
    const analytics = new AnalyticsLoader({
        loadSdk: () => {
            loads += 1;
            return sdk instanceof Error ? Promise.reject(sdk) : Promise.resolve(sdk);
        },
        log: log.log,
        pageLocation: () => PAGE,
        pagePath: () => '/bucuresti/',
        clearCookies: () => {
            clears += 1;
        },
        loadField: () => (field instanceof Error ? Promise.reject(field) : Promise.resolve(field)),
        fieldContext: () => FIELD_CONTEXT,
    });
    return { analytics, loads: () => loads, cookieClears: () => clears };
}

/** What GA4 receives with every event: the page without its hash. */
export function withPage(params: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
    return { ...params, app_surface: 'viewer', page_location: PAGE };
}

/** What the viewer adds to every field measurement in these tests. */
export const FIELD_CONTEXT = { app: 'viewer', window_class: 'compact', release: '1.2.0' } as const;

export interface FakeField extends FieldChunk {
    /** The reporters the observers were registered with (one per page). */
    readonly reporters: ((params: GaParams) => void)[];
}

/** The real guard of `@hcm/shared`; Core Web Vitals observers that only record their reporter. */
export function fakeField(): FakeField {
    const reporters: ((params: GaParams) => void)[] = [];
    return {
        reporters,
        createGuard: createViewerGuard,
        observeVitals: (report) => {
            reporters.push(report);
        },
    };
}
