import { describe, expect, it } from 'vitest';

import { DEDUPE_WINDOW_MS, ErrorReporter, installErrorHooks, MAX_REPORTS_PER_PAGE } from '../../src/telemetry/errors.js';
import type { ErrorReportPayload } from '../../src/telemetry/telemetry-port.js';
import { recordingLog, settle } from '../core/support.js';

/** Test values shaped like credentials, assembled so no scanner mistakes them for real ones. */
const GOOGLE_KEY = ['AIza', 'SyA-1234567890abcdefghijklmn'].join('');
const ACCESS_TOKEN = ['ya29', 'a0-scenario-test-value'].join('.');

interface Setup {
    readonly reporter: ErrorReporter;
    readonly posts: [string, ErrorReportPayload][];
    readonly exceptions: [string, boolean][];
    readonly log: ReturnType<typeof recordingLog>;
    readonly advance: (ms: number) => void;
}

function setup(post?: () => Promise<unknown>): Setup {
    let now = 1_000_000;
    const posts: [string, ErrorReportPayload][] = [];
    const exceptions: [string, boolean][] = [];
    const log = recordingLog();
    const reporter = new ErrorReporter({
        release: '1.2.3',
        log: log.log,
        now: () => now,
        page: () => 'https://site.example.org/bucuresti/',
        viewport: () => ({ width: 390, height: 844 }),
        post:
            post ??
            ((url, body) => {
                posts.push([url, JSON.parse(body) as ErrorReportPayload]);
                return Promise.resolve();
            }),
        exception: (description, fatal) => {
            exceptions.push([description, fatal]);
        },
    });
    reporter.setContext({ cityId: 'bucuresti', locale: 'ro', windowClass: 'compact', endpoint: 'https://errors.example.org/report' });
    return {
        reporter,
        posts,
        exceptions,
        log,
        advance: (ms) => {
            now += ms;
        },
    };
}

describe('error reporter', () => {
    it('happyPath_aCrashIsPostedRedactedWithItsContext', () => {
        const { reporter, posts, exceptions } = setup();
        // A generated test token, joined at run time so the source holds no token query literal (gitleaks).
        const query = ['access_token', 'pk.test-redaction-token'].join('=');
        const error = new TypeError(`cannot read tiles of https://api.mapbox.com/v4/x.json?${query}`);

        reporter.report(error, { fatal: true, source: 'boundary' });

        expect(posts).toHaveLength(1);
        const [url, payload] = posts[0] ?? ['', {} as ErrorReportPayload];
        expect(url).toBe('https://errors.example.org/report');
        expect(payload).toMatchObject({
            message: 'TypeError: cannot read tiles of https://api.mapbox.com/v4/x.json',
            release: '1.2.3',
            cityId: 'bucuresti',
            page: 'https://site.example.org/bucuresti/',
            viewport: { width: 390, height: 844 },
            windowClass: 'compact',
            locale: 'ro',
            fatal: true,
            source: 'boundary',
        });
        expect(payload.stack).toContain('TypeError');
        expect(payload.stack).not.toContain('access_token');
        expect(exceptions).toEqual([['TypeError: cannot read tiles of https://api.mapbox.com/v4/x.json', true]]);
    });

    it('badPath_errorsThePageDidNotCauseAreLoggedWithTheirReasonNeverSent', () => {
        const { reporter, posts, exceptions, log } = setup();
        // The Crashes group of 2026-11-11: Firefox for iOS's reader-mode script, injected into the page.
        const injected = new TypeError("undefined is not an object (evaluating 'window.__firefox__.reader')");
        injected.stack = 'global code@https://site.example.org/:1:19';
        const extension = new Error('boom');
        extension.stack = 'Error: boom\n    at run (moz-extension://abc/content.js:1:2)';

        reporter.report(injected, { fatal: false, source: 'window' });
        reporter.report(extension, { fatal: false, source: 'window' });

        expect(posts).toEqual([]);
        expect(exceptions).toEqual([]);
        expect(log.records.map((record) => record.data?.['reason'])).toEqual(['injected', 'extension']);
    });

    it('happyPath_tokensAndEmailsAreRedactedWithTheSharedRules', () => {
        // CR-M2-4: the reporter applies `redactText` of @hcm/shared, the endpoint's own rules (Google access tokens too).
        const { reporter, posts } = setup();

        reporter.report(new Error(`pk.eyJ1IjoieCJ9.abcdef ${ACCESS_TOKEN} for jane.doe@example.org`), { fatal: false, source: 'window' });
        reporter.report(`${GOOGLE_KEY} token=abc&x=1 at https://site.example.org/p#16/44.4/26.1&photo=x`, {
            fatal: false,
            source: 'promise',
        });

        expect(posts.map(([, payload]) => payload.message)).toEqual([
            'Error: [redacted] [redacted] for [redacted]',
            '[redacted] [redacted]&x=1 at https://site.example.org/p',
        ]);
    });

    it('happyPath_nonErrorsAreReportedByTheirText', () => {
        const { reporter, posts } = setup();

        reporter.report('plain failure', { fatal: false, source: 'promise' });
        reporter.report({ odd: true }, { fatal: false, source: 'promise' });

        expect(posts.map(([, payload]) => [payload.message, payload.stack])).toEqual([
            ['plain failure', undefined],
            ['Non-error value thrown', undefined],
        ]);
    });

    it('badPath_theSameMessageIsSentOncePerWindow', () => {
        const { reporter, posts, advance } = setup();

        reporter.report(new Error('again'), { fatal: false, source: 'window' });
        reporter.report(new Error('again'), { fatal: false, source: 'window' });
        advance(DEDUPE_WINDOW_MS);
        reporter.report(new Error('again'), { fatal: false, source: 'window' });

        expect(posts).toHaveLength(2);
    });

    it('badPath_atMostFiveReportsPerPage', () => {
        const { reporter, posts } = setup();

        for (let index = 0; index < MAX_REPORTS_PER_PAGE + 3; index += 1) {
            reporter.report(new Error(`error ${String(index)}`), { fatal: false, source: 'window' });
        }

        expect(posts).toHaveLength(MAX_REPORTS_PER_PAGE);
    });

    it('badPath_withoutAnEndpointOnlyGa4HearsOfIt', () => {
        const { reporter, posts, exceptions } = setup();
        reporter.setContext({ cityId: 'bucuresti', locale: 'en', windowClass: 'large' });

        reporter.report(new Error('x'), { fatal: false, source: 'window' });

        expect(posts).toEqual([]);
        expect(exceptions).toHaveLength(1);
    });

    it('badPath_aReporterThatIsDownNeverBreaksTheViewer', async () => {
        const { reporter, log } = setup(() => Promise.reject(new Error('503')));

        reporter.report(new Error('x'), { fatal: false, source: 'window' });
        await settle();

        expect(log.messages()).toEqual(['error report not delivered']);
    });

    it('badPath_aThrowingReporterPartIsSwallowed', () => {
        const { reporter, log } = setup(() => {
            throw new Error('post exploded');
        });

        expect(() => {
            reporter.report(new Error('x'), { fatal: false, source: 'window' });
        }).not.toThrow();
        expect(log.messages()).toEqual(['error report failed']);
    });
});

describe('global error hooks', () => {
    function target(): EventTarget & { count(type: string): number } {
        const events = new EventTarget();
        const counts = new Map<string, number>();
        const add = events.addEventListener.bind(events);
        const remove = events.removeEventListener.bind(events);
        return Object.assign(events, {
            addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
                counts.set(type, (counts.get(type) ?? 0) + 1);
                add(type, listener);
            },
            removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
                counts.set(type, (counts.get(type) ?? 0) - 1);
                remove(type, listener);
            },
            count: (type: string) => counts.get(type) ?? 0,
        });
    }

    function event<T extends object>(type: string, fields: T): Event & T {
        return Object.assign(new Event(type), fields);
    }

    it('happyPath_uncaughtErrorsAndRejectionsAreReported', () => {
        const { reporter, posts } = setup();
        const page = target();

        const stop = installErrorHooks(page, reporter);
        page.dispatchEvent(event('error', { error: new Error('boom') }));
        page.dispatchEvent(event('unhandledrejection', { reason: new Error('nope') }));

        expect(posts.map(([, payload]) => [payload.message, payload.source])).toEqual([
            ['Error: boom', 'window'],
            ['Error: nope', 'promise'],
        ]);
        stop();
        expect(page.count('error')).toBe(0);
        expect(page.count('unhandledrejection')).toBe(0);
    });

    it('badPath_aCrossOriginScriptErrorWithoutDetailsIsSkipped', () => {
        const { reporter, posts } = setup();
        const page = target();
        installErrorHooks(page, reporter);

        page.dispatchEvent(event('error', { error: null, message: 'Script error.' }));
        page.dispatchEvent(event('error', { message: 'Script error.' }));

        expect(posts).toEqual([]);
    });
});
