/**
 * `telemetry.reportError` (`functions/src/telemetry/report-error.ts`, M2-interfaces §3.4): the public crash endpoint,
 * driven from outside with the request a browser sends, Error Reporting faked (`fakeErrors` records each event).
 */
import { ERROR_REPORT_LIMITS, ERROR_REPORT_MAX_BYTES, apiErrorDetailsSchema, createLogger, type ErrorReport } from '@hcm/shared';
import { createRecordingSink } from '@hcm/test-support';
import { describe, expect, it } from 'vitest';

import { createRateLimiter, type RateLimiter } from '../../src/telemetry/rate-limit.js';
import {
    handleErrorReport,
    reportErrorFunction,
    serveErrorReports,
    type HttpRequest,
    type HttpResponse,
    type ReportErrorDeps,
    type ReportRequest,
} from '../../src/telemetry/report-error.js';
import { CONFIG, fakeErrors, fixedClock, type FakeErrors } from '../admin/world.js';

const VIEWER = CONFIG.viewerOrigins[0] ?? '';
const ADMIN = CONFIG.adminOrigins[0] ?? '';

const REPORT: ErrorReport = {
    message: 'TypeError: boom for ana@example.test',
    stack: 'TypeError: boom for ana@example.test\n    at draw (https://viewer.e2e.test/engine.mjs?v=1:10:5)',
    release: '1.0.0',
    cityId: 'bucharest',
    page: 'https://viewer.e2e.test/bucharest/',
    viewport: { width: 360, height: 800 },
    windowClass: 'compact',
    locale: 'ro',
    fatal: true,
    source: 'window',
};

function world(): {
    readonly deps: ReportErrorDeps;
    readonly errors: FakeErrors;
    readonly logged: () => number;
    readonly reasons: () => unknown[];
} {
    const recording = createRecordingSink();
    const errors = fakeErrors();
    const deps = { errors, config: CONFIG, clock: fixedClock(), log: createLogger('functions', { sink: recording.sink }) };
    return {
        deps,
        errors,
        logged: () => recording.records.length,
        reasons: () => recording.records.map((record) => record.data?.['reason']),
    };
}

function post(body: unknown, origin: string | undefined = VIEWER): ReportRequest {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { method: 'POST', origin, client: '203.0.113.7', body: new TextEncoder().encode(text) };
}

describe('telemetry.reportError: noise, browser and route', () => {
    it('badPath_aScriptTheBrowserInjectedIsDroppedWithItsReason @S-A24-BAD-NOISE-DROPPED', () => {
        // The Crashes groups of 2026-11-11, sent by a page older than the client-side filter.
        const { deps, errors, reasons } = world();
        const injected = {
            ...REPORT,
            message: "ReferenceError: Can't find variable: __firefox__",
            stack: 'global code@https://viewer.e2e.test/:1:12',
        };
        const aborted = { ...REPORT, message: 'AbortError: The operation was aborted.', stack: undefined };

        expect(handleErrorReport(deps, createRateLimiter('e2e-salt'), post(injected)).status).toBe(204);
        expect(handleErrorReport(deps, createRateLimiter('e2e-salt'), post(aborted)).status).toBe(204);

        expect(errors.reports).toEqual([]);
        expect(reasons()).toEqual(['injected', 'aborted']);
    });

    it('happyPath_theBrowserIsLoggedAsItsLabelAndTheRouteKept @S-A24-HAPPY-CLIENT-LABEL', () => {
        const { deps, errors } = world();
        const userAgent =
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/145.0 Mobile/15E148 Safari/605.1.15';

        handleErrorReport(deps, createRateLimiter('e2e-salt'), { ...post({ ...REPORT, route: 'photo' }), userAgent });

        expect(errors.reports[0]?.context.httpRequest).toEqual({
            url: 'https://viewer.e2e.test/bucharest/',
            userAgent: 'Firefox 145 mobile',
        });
        expect(errors.reports[0]?.hcm.route).toBe('photo');
        expect(JSON.stringify(errors.reports)).not.toContain('iPhone OS');
    });
});

describe('telemetry.reportError', () => {
    it('happyPath_aReportFromTheSiteReachesErrorReportingRedacted @S-A24-HAPPY', () => {
        const { deps, errors } = world();

        const answer = handleErrorReport(deps, createRateLimiter('e2e-salt'), post(REPORT));

        expect(answer).toEqual({ status: 204, headers: { 'access-control-allow-origin': VIEWER, vary: 'Origin' } });
        expect(errors.reports).toHaveLength(1);
        expect(errors.reports[0]).toMatchObject({
            serviceContext: { service: 'viewer', version: '1.0.0' },
            context: { reportLocation: { filePath: 'https://viewer.e2e.test/engine.mjs', lineNumber: 10, functionName: 'draw' } },
        });
        expect(JSON.stringify(errors.reports)).not.toContain('ana@example.test');
        expect(JSON.stringify(errors.reports)).not.toContain('?v=1');
    });

    it('happyPath_theAdminOriginReportsAsTheAdminService', () => {
        const { deps, errors } = world();
        const limiter = createRateLimiter('e2e-salt');

        handleErrorReport(deps, limiter, post({ ...REPORT, page: `${ADMIN}/admin/` }, ADMIN));
        // A pre-M6 admin at the root of an origin that serves no viewer.
        handleErrorReport(deps, limiter, post({ ...REPORT, page: `${ADMIN}/` }, ADMIN));

        expect(errors.reports.map((report) => report.serviceContext.service)).toEqual(['admin', 'admin']);
    });

    it('badPath_anyOtherMethodIsNotAllowed', () => {
        const { deps } = world();
        const limiter = createRateLimiter('e2e-salt');

        expect(handleErrorReport(deps, limiter, { method: 'GET', origin: VIEWER, client: 'x', body: undefined })).toEqual({
            status: 405,
            headers: { allow: 'POST, OPTIONS' },
        });
        expect(
            handleErrorReport(deps, limiter, { method: 'OPTIONS', origin: 'https://evil.example', client: 'x', body: undefined }).status,
        ).toBe(405);
    });

    it('badPath_aReportFromAnUnknownSiteIsRefused @S-A24-BAD-FOREIGN-ORIGIN', () => {
        const { deps, errors, logged } = world();
        const limiter = createRateLimiter('e2e-salt');

        const foreign = handleErrorReport(deps, limiter, post(REPORT, 'https://evil.example'));
        const missing = handleErrorReport(deps, limiter, { ...post(REPORT), origin: undefined });

        expect(foreign).toEqual({ status: 403, headers: {}, body: { code: 'apiError.telemetry.origin' } });
        expect(missing.status).toBe(403);
        expect([errors.reports.length, logged()]).toEqual([0, 0]);
    });

    it('badPath_anOversizedReportIsRefusedBeforeItIsParsed @S-A24-BAD-TOO-LARGE', () => {
        const { deps, errors, logged } = world();
        const oversized = { method: 'POST', origin: VIEWER, client: 'x', body: new Uint8Array(ERROR_REPORT_MAX_BYTES + 1).fill(123) };

        const answer = handleErrorReport(deps, createRateLimiter('e2e-salt'), oversized);

        expect(answer).toEqual({
            status: 413,
            headers: { 'access-control-allow-origin': VIEWER, vary: 'Origin' },
            body: { code: 'apiError.telemetry.tooLarge' },
        });
        expect([errors.reports.length, logged()]).toEqual([0, 0]);
    });

    it('badPath_anErrorStormIsCappedPerClient @S-A24-BAD-RATE-LIMITED', () => {
        const { deps, errors } = world();
        const limiter = createRateLimiter('e2e-salt');

        const answers = Array.from({ length: ERROR_REPORT_LIMITS.perClientPerMinute + 1 }, () =>
            handleErrorReport(deps, limiter, post(REPORT)),
        );

        expect(answers.at(-1)).toEqual({
            status: 429,
            headers: { 'access-control-allow-origin': VIEWER, vary: 'Origin', 'retry-after': '60' },
            body: { code: 'apiError.rateLimited' },
        });
        expect(errors.reports).toHaveLength(ERROR_REPORT_LIMITS.perClientPerMinute);
    });

    it.each([
        ['invalid JSON', '{"message":', 'validation.json', ''],
        ['an unknown field', { ...REPORT, email: 'ana@example.test' }, 'validation.unknownKey', 'email'],
        [
            'a page address with its hash',
            { ...REPORT, page: 'https://viewer.e2e.test/bucharest/#15/44.4/26.1' },
            'validation.format',
            'page',
        ],
        ['an empty body', '', 'validation.json', ''],
    ])('badPath_%s_isRefused @S-A24-BAD-INVALID-BODY', (_case, body, code, path) => {
        const { deps, errors, logged } = world();

        const answer = handleErrorReport(deps, createRateLimiter('e2e-salt'), post(body));

        expect(answer.status).toBe(400);
        expect(apiErrorDetailsSchema.safeParse(answer.body).success).toBe(true);
        expect(answer.body).toMatchObject({ code: 'apiError.invalidRequest', issues: [{ path, code }] });
        expect([errors.reports.length, logged()]).toEqual([0, 1]);
    });
});

interface Sent {
    status?: number;
    headers?: Readonly<Record<string, string>>;
    json?: unknown;
    ended: boolean;
}

function httpRequest(headers: Readonly<Record<string, string>>, ip: string | undefined, rawBody?: Uint8Array): HttpRequest {
    return { method: 'POST', ip, ...(rawBody === undefined ? {} : { rawBody }), get: (name) => headers[name.toLowerCase()] };
}

function httpResponse(): { readonly response: HttpResponse; readonly sent: Sent } {
    const sent: Sent = { ended: false };
    const response: HttpResponse = {
        status(code) {
            sent.status = code;
            return this;
        },
        set(headers) {
            sent.headers = headers;
            return this;
        },
        json: (body) => {
            sent.json = body;
        },
        end: () => {
            sent.ended = true;
        },
    };
    return { response, sent };
}

/** A limiter that admits everything and remembers whom it was asked about. */
function recordingLimiter(): RateLimiter & { readonly clients: string[] } {
    const clients: string[] = [];
    return {
        clients,
        allow: (client) => {
            clients.push(client);
            return true;
        },
    };
}

describe('a POST without a body', () => {
    it('badPath_isAnInvalidRequest', () => {
        const { deps, errors } = world();

        const answer = handleErrorReport(deps, createRateLimiter('e2e-salt'), {
            method: 'POST',
            origin: VIEWER,
            client: 'x',
            body: undefined,
        });

        expect(answer.body).toEqual({
            code: 'apiError.invalidRequest',
            params: { count: '1' },
            issues: [{ path: '', code: 'validation.json' }],
        });
        expect(errors.reports).toEqual([]);
    });
});

describe('serveErrorReports', () => {
    it('happyPath_answersTheBrowserAndLimitsByTheAddressGoogleSaw', () => {
        const { deps, errors } = world();
        const limiter = recordingLimiter();
        const serve = serveErrorReports(() => deps, limiter);
        const body = new TextEncoder().encode(JSON.stringify(REPORT));
        const first = httpResponse();
        const second = httpResponse();
        const third = httpResponse();

        serve(httpRequest({ origin: VIEWER, 'x-forwarded-for': '198.51.100.1, 203.0.113.9' }, '192.0.2.1', body), first.response);
        serve(httpRequest({ origin: VIEWER }, '192.0.2.2', body), second.response);
        serve(httpRequest({ origin: VIEWER, 'x-forwarded-for': ' ' }, undefined, body), third.response);

        expect(first.sent).toEqual({ status: 204, headers: { 'access-control-allow-origin': VIEWER, vary: 'Origin' }, ended: true });
        expect(limiter.clients).toEqual(['203.0.113.9', '192.0.2.2', 'unknown']);
        expect(errors.reports).toHaveLength(3);
    });

    it('badPath_aRefusalCarriesItsJsonDetails', () => {
        const { deps } = world();
        const { response, sent } = httpResponse();

        serveErrorReports(() => deps, recordingLimiter())(httpRequest({ origin: 'https://evil.example' }, '192.0.2.1'), response);

        expect(sent).toEqual({ status: 403, headers: {}, json: { code: 'apiError.telemetry.origin' }, ended: false });
    });
});

describe('reportErrorFunction', () => {
    it('happyPath_aPublicEndpointWithItsRegistryInstanceCap', () => {
        const fn = reportErrorFunction((): never => {
            throw new Error('the dependencies are created by the first request');
        });

        expect(fn.__endpoint).toMatchObject({ maxInstances: 2, httpsTrigger: { invoker: ['public'] } });
    });
});

// M6 (docs/research/M6-interfaces.md §2.3): the public map at the Hosting root and the admin under /admin/ share an origin.
describe('telemetry.reportError on one origin', () => {
    it('happyPath_onOneOriginThePagesPathTellsTheAdminFromTheViewer @S-A24-HAPPY-SAME-ORIGIN', () => {
        // M6 (docs/research/M6-interfaces.md §2.3): the public map at the Hosting root, the admin under /admin/.
        const { deps, errors } = world();
        const shared = { ...deps, config: { ...deps.config, viewerOrigins: [...deps.config.viewerOrigins, ADMIN] } };
        const limiter = createRateLimiter('e2e-salt');

        for (const path of ['/admin/', '/admin', '/', '/bacau/', '/administration/']) {
            expect(handleErrorReport(shared, limiter, post({ ...REPORT, page: `${ADMIN}${path}` }, ADMIN)).status).toBe(204);
        }

        expect(errors.reports.map((report) => report.serviceContext.service)).toEqual(['admin', 'admin', 'viewer', 'viewer', 'viewer']);
    });

    it('badPath_aReportWhosePageIsNotOnItsOwnOriginIsRefused @S-A24-BAD-PAGE-ORIGIN-MISMATCH', () => {
        const { deps, errors, logged } = world();
        const limiter = createRateLimiter('e2e-salt');

        const elsewhere = handleErrorReport(deps, limiter, post({ ...REPORT, page: 'https://evil.example/admin/' }, VIEWER));
        const adminPageFromTheViewer = handleErrorReport(deps, limiter, post({ ...REPORT, page: `${ADMIN}/admin/` }, VIEWER));
        const noAddress = handleErrorReport(deps, limiter, post({ ...REPORT, page: 'https://[' }, VIEWER));

        expect(elsewhere).toEqual({
            status: 403,
            headers: { 'access-control-allow-origin': VIEWER, vary: 'Origin' },
            body: { code: 'apiError.telemetry.origin' },
        });
        expect([adminPageFromTheViewer.status, noAddress.status]).toEqual([403, 403]);
        expect([errors.reports.length, logged()]).toEqual([0, 0]);
    });

    it('happyPath_aPreflightFromAnAllowedOriginIsAnswered', () => {
        const { deps } = world();

        const answer = handleErrorReport(deps, createRateLimiter('e2e-salt'), {
            method: 'OPTIONS',
            origin: ADMIN,
            client: 'x',
            body: undefined,
        });

        expect(answer).toEqual({
            status: 204,
            headers: {
                'access-control-allow-origin': ADMIN,
                'access-control-allow-methods': 'POST',
                'access-control-allow-headers': 'content-type',
                'access-control-max-age': '3600',
                vary: 'Origin',
            },
        });
    });
});
