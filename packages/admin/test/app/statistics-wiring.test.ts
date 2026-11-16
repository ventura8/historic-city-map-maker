import { createLogger, type AnalyticsConfigResponse } from '@hcm/shared';
import { createUpstreamFakes, GOOGLE_TOKENS } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import type { GoogleOutcome } from '../../src/auth/google-service.js';
import { statisticsSourceOf } from '../../src/app/statistics-wiring.js';
import { createMeasurementReports } from '../../src/google/analytics-reports.js';
import { GOOGLE_SCOPES, type GoogleScope } from '../../src/google/scopes.js';
import { FakeCallables, FakeClock } from './fakes.js';

/** §203: the Statistics view's source over the shell's Google consent, `setup.analyticsConfig` and the Data API chunk. */

const ACCESS = { token: GOOGLE_TOKENS.owner, scopes: [GOOGLE_SCOPES.analyticsRead], expiresAt: 4_000_000_000_000 };

function world(outcome: GoogleOutcome, live: boolean) {
    const fakes = createUpstreamFakes();
    fakes.scenario('firebase-management.analyticsLinked');
    fakes.scenario('analytics-data.sample');
    const requested: (GoogleScope | null)[] = [];
    const lives: { readonly scope: GoogleScope; readonly min: number | undefined }[] = [];
    const callables = new FakeCallables();
    const clock = new FakeClock();
    const measured: unknown[] = [];
    const source = statisticsSourceOf({
        google: {
            request: (scope) => {
                requested.push(scope);
                return Promise.resolve(outcome);
            },
            live: (scope, min) => {
                lives.push({ scope, min });
                return live ? ACCESS : null;
            },
        },
        callables,
        cityId: () => 'bucharest',
        fetch: fakes.fetch,
        clock,
        log: createLogger('test', { minLevel: 'error' }),
        measure: (event) => {
            measured.push(event);
        },
    });
    return { fakes, source, requested, lives, callables, clock, measured };
}

const CONFIG: AnalyticsConfigResponse = {
    analytics: { state: 'ok', checkedAt: '2026-11-13T10:00:00.000Z' },
    measurementId: 'G-E2E0000000',
    firebase: { apiKey: 'e2e-api-key', appId: '1:1:web:e2e', projectId: 'demo-hcm' },
    manifestQueued: false,
};

describe('statisticsSourceOf', () => {
    it('happyPath_aReasonCodeIsOneUiErrorOfTheCrashesRoute', () => {
        const { source, measured } = world({ granted: true, access: ACCESS }, true);

        source.report?.('statistics_notReady');

        expect(measured).toEqual([{ name: 'ui_error', params: { code: 'statistics_notReady', route: 'crashes' } }]);
    });

    it('happyPath_theReadOnlyScopeIsAskedTheIdReadAndTheNumbersComeFromTheDataApi', async () => {
        const { fakes, source, requested, lives, callables } = world({ granted: true, access: ACCESS }, true);
        callables.answer('setup.analyticsConfig', () => CONFIG);
        await createMeasurementReports(
            { fetch: fakes.fetch, token: () => ACCESS.token, sleep: () => Promise.resolve(), log: createLogger('t') },
            'G-E2E0000000',
        );

        expect(source.latest?.()).toBeNull();
        const consent = await source.ask();
        const id = await source.measurementId();
        const numbers = await source.read({ token: ACCESS.token, expiresAt: ACCESS.expiresAt }, String(id), 28);

        expect(consent).toEqual({ granted: true, access: { token: ACCESS.token, expiresAt: ACCESS.expiresAt } });
        expect(requested).toEqual(['analyticsRead']);
        expect(source.live()).toEqual({ token: ACCESS.token, expiresAt: ACCESS.expiresAt });
        expect(lives).toEqual([{ scope: 'analyticsRead', min: 300_000 }]);
        expect(callables.calls[0]).toMatchObject({ name: 'setup.analyticsConfig', request: { cityId: 'bucharest' } });
        expect(numbers.visitors).toBe(120);
        // Home's Visitors card reads the last answer, never Google.
        expect(source.latest?.()).toEqual({ days: 28, numbers });
    });

    it('badPath_aRefusalAnEmptyGrantAndAnalyticsNotSetUp', async () => {
        const refused = world({ granted: false, failure: 'scopeDenied', notice: { key: 'adminShell.oauth.scopeDenied' } }, false);
        await expect(refused.source.ask()).resolves.toEqual({ granted: false, failure: 'scopeDenied' });
        expect(refused.source.live()).toBeNull();

        const empty = world({ granted: true, access: null }, false);
        await expect(empty.source.ask()).resolves.toEqual({ granted: false, failure: 'failed' });

        empty.callables.answer('setup.analyticsConfig', () => ({
            ...CONFIG,
            analytics: { state: 'missing', checkedAt: CONFIG.analytics.checkedAt },
        }));
        await expect(empty.source.measurementId()).resolves.toBeNull();
    });

    it('badPath_aRetriedReadWaitsOnTheInjectedClock', async () => {
        const { fakes, source, clock } = world({ granted: true, access: ACCESS }, true);
        fakes.fail('analytics-admin', 'unavailable');

        const read = source.read({ token: ACCESS.token, expiresAt: ACCESS.expiresAt }, 'G-E2E0000000', 7).catch((error: unknown) => error);
        for (let round = 0; round < 10; round += 1) {
            await new Promise((resolve) => setImmediate(resolve));
            clock.advance(10_000);
        }

        await expect(read).resolves.toMatchObject({ kind: 'unavailable' });
    });
});
