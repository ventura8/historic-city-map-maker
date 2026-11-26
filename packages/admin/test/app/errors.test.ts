import { errorReportSchema } from '@hcm/shared';
import { describe, expect, it, vi } from 'vitest';

import {
    AdminErrorReporter,
    DEDUPE_WINDOW_MS,
    errorEndpointFor,
    installErrorHooks,
    MAX_REPORTS_PER_PAGE,
    routeOfHash,
} from '../../src/app/errors.js';
import { FakeClock, testLog } from './fakes.js';

function reporter(endpoint: string | null = 'https://us-central1-demo-hcm.cloudfunctions.net/telemetry-reportError', route?: string) {
    const clock = new FakeClock();
    const posts: { readonly url: string; readonly body: string }[] = [];
    const exceptions: { readonly description: string; readonly fatal: boolean }[] = [];
    const { log, recording } = testLog();
    const post = vi.fn((url: string, body: string) => {
        posts.push({ url, body });
        return Promise.resolve();
    });
    const errors = new AdminErrorReporter({
        release: 'abc123',
        log,
        now: () => clock.now(),
        endpoint: () => endpoint,
        page: () => 'https://demo-hcm.web.app/',
        viewport: () => ({ width: 1440, height: 900 }),
        context: () => ({ locale: 'ro', windowClass: 'large', route }),
        post,
        exception: (description, fatal) => {
            exceptions.push({ description, fatal });
        },
    });
    return { clock, posts, exceptions, errors, post, recording };
}

describe('AdminErrorReporter', () => {
    it('happyPath_aCrashIsPostedRedactedAndValidAsTheAdminsService', () => {
        const r = reporter();
        const error = new Error('token ya29.e2e-secret-access-token-value for owner@e2e.test failed');

        r.errors.report(error, { fatal: true, source: 'window' });

        const report = errorReportSchema.parse(JSON.parse(r.posts[0]?.body ?? '{}'));
        expect(r.posts[0]?.url).toBe('https://us-central1-demo-hcm.cloudfunctions.net/telemetry-reportError');
        expect(report).toMatchObject({ release: 'abc123', cityId: '', locale: 'ro', windowClass: 'large', fatal: true, source: 'window' });
        expect(JSON.stringify(report)).not.toContain('ya29.e2e-secret');
        expect(JSON.stringify(report)).not.toContain('owner@e2e.test');
        expect(r.exceptions[0]?.fatal).toBe(true);
    });

    it('badPath_anErrorStormIsCappedAndRepeatsAreDropped', () => {
        const r = reporter();

        r.errors.report('same', { fatal: false, source: 'promise' });
        r.errors.report('same', { fatal: false, source: 'promise' });
        r.clock.advance(DEDUPE_WINDOW_MS);
        r.errors.report('same', { fatal: false, source: 'promise' });
        for (let index = 0; index < 10; index += 1) {
            r.errors.report(new TypeError(`error ${String(index)}`), { fatal: false, source: 'boundary' });
        }

        expect(r.posts).toHaveLength(MAX_REPORTS_PER_PAGE);
        expect(JSON.parse(r.posts[2]?.body ?? '{}')).toMatchObject({ message: 'TypeError: error 0' });
    });

    it('badPath_withoutAnEndpointNothingIsPostedButGa4StillHears', () => {
        const r = reporter(null);

        r.errors.report(42, { fatal: false, source: 'window' });

        expect(r.posts).toEqual([]);
        expect(r.exceptions).toEqual([{ description: 'Non-error value thrown', fatal: false }]);
    });

    it('badPath_aFailedDeliveryOrAThrowingHookIsOnlyLogged', async () => {
        const r = reporter();
        r.post.mockRejectedValueOnce(new Error('offline'));

        r.errors.report('first', { fatal: false, source: 'window' });
        await Promise.resolve();
        const broken = new AdminErrorReporter({
            ...{
                release: 'x',
                log: testLog().log,
                now: () => 0,
                endpoint: () => null,
                page: () => '',
                viewport: () => ({ width: 0, height: 0 }),
            },
            context: () => ({ locale: '', windowClass: '' }),
            post: () => Promise.resolve(),
            exception: () => {
                throw new Error('gtag');
            },
        });

        expect(() => {
            broken.report('second', { fatal: false, source: 'window' });
        }).not.toThrow();
        expect(r.recording.records.map((record) => record.message)).toContain('error report not delivered');
    });
});

describe('installErrorHooks', () => {
    it('happyPath_uncaughtErrorsAndRejectionsAreReportedUntilStopped', () => {
        const target = new EventTarget();
        const report = vi.fn();
        const stop = installErrorHooks(target, { report });
        const thrown = new Error('boom');

        target.dispatchEvent(Object.assign(new Event('error'), { error: thrown }));
        target.dispatchEvent(Object.assign(new Event('error'), { error: null }));
        target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'nope' }));
        stop();
        target.dispatchEvent(Object.assign(new Event('error'), { error: thrown }));

        expect(report.mock.calls).toEqual([
            [thrown, { fatal: false, source: 'window' }],
            ['nope', { fatal: false, source: 'promise' }],
        ]);
    });
});

describe('crash noise and the route', () => {
    it('badPath_aScriptTheBrowserInjectedIsLoggedWithItsReasonNeverPosted', () => {
        const r = reporter();
        const injected = new Error("Can't find variable: __firefox__");
        injected.stack = 'global code@https://demo-hcm.web.app/admin/:1:12';
        const aborted = new DOMException('The operation was aborted.', 'AbortError');

        r.errors.report(injected, { fatal: false, source: 'window' });
        r.errors.report(aborted, { fatal: false, source: 'promise' });

        expect(r.posts).toEqual([]);
        expect(r.exceptions).toEqual([]);
        expect(r.recording.records.map((record) => record.data?.['reason'])).toEqual(['injected', 'aborted']);
    });

    it('happyPath_aReportNamesTheAreaRouteOnly', () => {
        const r = reporter(undefined, routeOfHash('#/georef/im-1-DS1103'));
        r.errors.report(new Error('georef failed'), { fatal: false, source: 'window' });
        expect(errorReportSchema.parse(JSON.parse(r.posts[0]?.body ?? '{}')).route).toBe('georef');
    });

    it('badPath_aHashWithoutAnAreaGivesNoRoute', () => {
        expect(routeOfHash('')).toBeUndefined();
        expect(routeOfHash('#/')).toBeUndefined();
        expect(routeOfHash('#/Bad Route')).toBeUndefined();
        expect(routeOfHash('#setup')).toBe('setup');
        expect(routeOfHash(`#/${'a'.repeat(41)}`)).toBeUndefined();
    });
});

describe('errorEndpointFor', () => {
    it('happyPath_theProjectsFunctionOrTheEmulators', () => {
        expect(errorEndpointFor('demo-hcm', false)).toBe('https://us-central1-demo-hcm.cloudfunctions.net/telemetry-reportError');
        expect(errorEndpointFor('demo-hcm', true)).toBe('http://127.0.0.1:5001/demo-hcm/us-central1/telemetry-reportError');
    });
});
