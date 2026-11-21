import { createAdminGuard, type GaParams } from '@hcm/shared';
import { describe, expect, it, vi } from 'vitest';

import { CONSENT_DENIED, CONSENT_GRANTED, createAnalytics, surfaceOf, type AnalyticsSdk } from '../../src/firebase/analytics.js';
import { settle, testLog } from '../app/fakes.js';

const CONTEXT = { app: 'admin', window_class: 'large', release: '1.2.0' } as const;

/** The real guard of `@hcm/shared`; Core Web Vitals observers that only record their reporter. */
function fakeField() {
    const reporters: ((params: GaParams) => void)[] = [];
    return { reporters, createGuard: createAdminGuard, observeVitals: (report: (params: GaParams) => void) => reporters.push(report) };
}

function fakeSdk(supported = true) {
    const sdk = {
        isSupported: vi.fn(() => Promise.resolve(supported)),
        setConsent: vi.fn(),
        initializeAnalytics: vi.fn(() => ({ id: 'ga' })),
        logEvent:
            vi.fn<
                (analytics: { readonly id: string }, name: string, params: Readonly<Record<string, string | number | boolean>>) => void
            >(),
        setAnalyticsCollectionEnabled: vi.fn(),
    } satisfies AnalyticsSdk<{ readonly app: true }, { readonly id: string }>;
    return sdk;
}

function analytics(sdk: ReturnType<typeof fakeSdk>, load = vi.fn(() => Promise.resolve(sdk)), field = fakeField()) {
    const { log, recording } = testLog();
    const port = createAnalytics({
        app: { app: true },
        load,
        loadField: () => Promise.resolve(field),
        fieldContext: () => CONTEXT,
        log,
        pageLocation: () => 'https://demo-hcm.web.app/',
        surface: () => 'admin_owner',
    });
    return { port, load, recording, field };
}

describe('createAnalytics', () => {
    it('happyPath_afterConsentGa4LoadsOnceWithoutAdvertisingOrTheHash', async () => {
        const sdk = fakeSdk();
        const a = analytics(sdk);

        a.port.setConsent(true);
        a.port.log('page_view', { route: 'setup' });
        a.port.log('setup_step', { step: 'billing', state: 'ok' });
        await settle();

        expect(a.load).toHaveBeenCalledTimes(1);
        expect(sdk.setConsent).toHaveBeenCalledWith(CONSENT_GRANTED);
        expect(sdk.initializeAnalytics).toHaveBeenCalledWith(
            { app: true },
            {
                config: {
                    send_page_view: false,
                    page_location: 'https://demo-hcm.web.app/',
                    cookie_prefix: 'hcm_admin',
                    allow_google_signals: false,
                    allow_ad_personalization_signals: false,
                },
            },
        );
        expect(sdk.logEvent.mock.calls.map(([, name]) => name)).toEqual(['page_view', 'setup_step']);
        expect(sdk.logEvent.mock.calls[0]?.[2]).toEqual({
            route: 'setup',
            app_surface: 'admin_owner',
            page_location: 'https://demo-hcm.web.app/',
        });
    });

    it('badPath_withoutConsentNothingLoads', async () => {
        const sdk = fakeSdk();
        const a = analytics(sdk);

        a.port.log('page_view', { route: 'setup' });
        a.port.setConsent(false);
        await settle();

        expect(a.load).not.toHaveBeenCalled();
    });

    it('badPath_aWithdrawalTurnsCollectionOffAndDropsLaterEvents', async () => {
        const sdk = fakeSdk();
        const a = analytics(sdk);
        a.port.setConsent(true);
        a.port.log('page_view', { route: 'setup' });
        await settle();

        a.port.setConsent(false);
        a.port.log('page_view', { route: 'admins' });
        await settle();

        expect(sdk.setConsent).toHaveBeenLastCalledWith(CONSENT_DENIED);
        expect(sdk.setAnalyticsCollectionEnabled).toHaveBeenLastCalledWith({ id: 'ga' }, false);
        expect(sdk.logEvent).toHaveBeenCalledTimes(1);
    });

    it('happyPath_aGrantAfterAWithdrawalTurnsCollectionBackOn', async () => {
        const sdk = fakeSdk();
        const a = analytics(sdk);
        a.port.setConsent(true);
        a.port.log('page_view', { route: 'setup' });
        await settle();

        a.port.setConsent(false);
        a.port.setConsent(true);
        await settle();

        expect(sdk.setConsent).toHaveBeenLastCalledWith(CONSENT_GRANTED);
        expect(sdk.setAnalyticsCollectionEnabled).toHaveBeenLastCalledWith({ id: 'ga' }, true);
    });

    it('badPath_aWithdrawalWhileLoadingStartsGa4Denied', async () => {
        const sdk = fakeSdk();
        let release: () => void = () => undefined;
        const load = vi.fn(
            () =>
                new Promise<typeof sdk>((resolve) => {
                    release = () => {
                        resolve(sdk);
                    };
                }),
        );
        const a = analytics(sdk, load);
        a.port.setConsent(true);
        a.port.log('page_view', { route: 'setup' });

        a.port.setConsent(false);
        release();
        await settle();

        expect(sdk.setConsent).toHaveBeenCalledWith(CONSENT_DENIED);
        expect(sdk.logEvent).not.toHaveBeenCalled();
    });

    it('badPath_anUnsupportedBrowserOrAFailedLoadSendsNothing', async () => {
        const unsupported = fakeSdk(false);
        const a = analytics(unsupported);
        a.port.setConsent(true);
        a.port.log('page_view', { route: 'setup' });
        await settle();
        const failing = analytics(
            fakeSdk(),
            vi.fn(() => Promise.reject(new Error('chunk'))),
        );
        failing.port.setConsent(true);
        failing.port.log('page_view', { route: 'setup' });
        await settle();

        expect(unsupported.initializeAnalytics).not.toHaveBeenCalled();
        expect(a.recording.records.map((record) => record.message)).toContain('analytics unsupported in this browser');
        expect(failing.recording.records.map((record) => record.message)).toContain('analytics failed to load');
    });

    it('badPath_aThrowingSdkCallIsLogged', async () => {
        const sdk = fakeSdk();
        sdk.logEvent.mockImplementation(() => {
            throw new Error('gtag');
        });
        const a = analytics(sdk);
        a.port.setConsent(true);

        a.port.log('page_view', { route: 'setup' });
        await settle();

        expect(a.recording.records.map((record) => record.message)).toContain('analytics call failed');
    });
});

describe('createAnalytics: field measurements', () => {
    it('happyPath_aFieldMeasurementCarriesItsContextAndTheVitalsReport', async () => {
        const sdk = fakeSdk();
        const a = analytics(sdk);
        a.port.setConsent(true);
        a.port.field('admin_ready', { duration_ms: 1800, restored: true });
        await settle();
        a.field.reporters[0]?.({
            metric_name: 'INP',
            metric_value: 180,
            metric_delta: 180,
            metric_id: 'v6-1-2',
            metric_rating: 'good',
            navigation_type: 'navigate',
            value: 180,
        });
        await settle();

        expect(a.field.reporters).toHaveLength(1);
        expect(sdk.logEvent.mock.calls.map(([, name, params]) => [name, params])).toEqual([
            [
                'admin_ready',
                { duration_ms: 1800, restored: true, ...CONTEXT, app_surface: 'admin_owner', page_location: 'https://demo-hcm.web.app/' },
            ],
            [
                'web_vitals',
                expect.objectContaining({ metric_name: 'INP', window_class: 'large', page_location: 'https://demo-hcm.web.app/' }),
            ],
        ]);
    });

    it('badPath_anEventTheGuardRefusesIsDroppedAndSaidOnce', async () => {
        const sdk = fakeSdk();
        const a = analytics(sdk);
        a.port.setConsent(true);

        a.port.log('exception', { description: 'mail owner@example.org', fatal: false });
        a.port.log('exception', { description: 'at #/photos?x=1', fatal: false });
        a.port.field('editor_save', { area: 'photos', operation: 'update', outcome: 'ok', duration_ms: -5 });
        await settle();

        expect(sdk.logEvent).not.toHaveBeenCalled();
        expect(a.recording.records.filter((record) => record.message === 'analytics event dropped').map((record) => record.data)).toEqual([
            { name: 'exception', reason: 'privacy' },
            { name: 'editor_save', reason: 'schema' },
        ]);
    });

    it('badPath_aFloodOfOneMeasurementIsCapped', async () => {
        const sdk = fakeSdk();
        const a = analytics(sdk);
        a.port.setConsent(true);

        for (let index = 0; index < 50; index += 1) {
            a.port.field('install_build', { target: 'server', outcome: 'failed' });
        }
        await settle();

        expect(sdk.logEvent).toHaveBeenCalledTimes(20);
    });
});

describe('surfaceOf', () => {
    it('happyPath_theOpenCitysRoleNamesTheAdmin_andNoRoleIsTheAdminAlone', () => {
        expect(surfaceOf('uploader')).toBe('admin_uploader');
        expect(surfaceOf(null)).toBe('admin');
    });
});
