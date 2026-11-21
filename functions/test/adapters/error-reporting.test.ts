/**
 * The `ErrorReporter` adapter (`functions/src/adapters/error-reporting.ts`): the structured ERROR entry Cloud Error
 * Reporting groups, and `groupStats` over REST against a scripted `fetch` with Error Reporting's own response and
 * failure shapes (no network). Every value is a generated test value.
 */
import { REPORTED_ERROR_EVENT_TYPE, listGroupsResponseSchema, type ReportedErrorEvent } from '@hcm/shared';
import type { LogEntry } from 'firebase-functions/logger';
import { describe, expect, it } from 'vitest';

import { ERROR_REPORTING_API, createErrorReporter } from '../../src/adapters/error-reporting.js';
import { UpstreamError } from '../../src/ports/errors.js';

const EVENT: ReportedErrorEvent = {
    '@type': REPORTED_ERROR_EVENT_TYPE,
    message: 'TypeError: boom\n    at draw (https://viewer.e2e.test/engine.mjs:10:5)',
    serviceContext: { service: 'viewer', version: '1.0.0' },
    context: {
        httpRequest: { url: 'https://viewer.e2e.test/bucharest/' },
        reportLocation: { filePath: 'https://viewer.e2e.test/engine.mjs', lineNumber: 10, functionName: 'draw' },
    },
    hcm: {
        cityId: 'bucharest',
        windowClass: 'compact',
        locale: 'ro',
        viewport: { width: 360, height: 800 },
        fatal: true,
        source: 'window',
    },
};

/** Two groups as `groupStats.list` answers them (int64 as strings, microsecond times), plus one it cannot read. */
const GROUP_STATS = {
    errorGroupStats: [
        {
            group: { name: 'projects/demo-hcm/groups/e2e-group-1', groupId: 'e2e-group-1', resolutionStatus: 'ACKNOWLEDGED' },
            count: '12',
            affectedUsersCount: '3',
            firstSeenTime: '2026-10-10T08:00:00.123456Z',
            lastSeenTime: '2026-10-12T08:00:00Z',
            representative: {
                serviceContext: { service: 'viewer', version: '1.0.0' },
                message: 'TypeError: boom\n    at draw (https://viewer.e2e.test/engine.mjs:10:5)\n    not a frame',
                context: { httpRequest: { url: 'https://viewer.e2e.test/bucharest/', userAgent: 'Firefox 145 mobile' } },
            },
        },
        {
            group: { groupId: 'e2e-group-2', resolutionStatus: 'SOMETHING_NEW' },
            count: 'many',
            firstSeenTime: '2026-10-11T08:00:00Z',
            lastSeenTime: '2026-10-11T09:00:00Z',
            representative: { message: 'x'.repeat(600) },
        },
        { group: { groupId: 'e2e-group-3' }, count: '1', firstSeenTime: '2026-10-11T08:00:00Z', lastSeenTime: '2026-10-11T08:00:00Z' },
        { group: { groupId: 'e2e-group-without-times' }, count: '1' },
        'not a group',
    ],
    nextPageToken: 'e2e-next-page',
};

interface Call {
    readonly url: string;
    readonly init: RequestInit | undefined;
}

function urlOf(input: string | URL | Request): string {
    if (typeof input === 'string') {
        return input;
    }
    return input instanceof URL ? input.href : input.url;
}

/** A `fetch` that answers every call with `answer` and records it. */
function scriptedFetch(answer: () => Promise<Response>): { readonly fetch: typeof fetch; readonly calls: Call[] } {
    const calls: Call[] = [];
    const fake: typeof fetch = (input, init) => {
        calls.push({ url: urlOf(input), init });
        return answer();
    };
    return { fetch: fake, calls };
}

function reporter(answer: () => Promise<Response>) {
    const scripted = scriptedFetch(answer);
    const entries: LogEntry[] = [];
    const errors = createErrorReporter({
        projectId: 'demo-hcm',
        tokens: { accessToken: () => Promise.resolve('e2e-service-account-token') },
        fetch: scripted.fetch,
        write: (entry) => entries.push(entry),
    });
    return { errors, entries, calls: scripted.calls };
}

const json =
    (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    () =>
        Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } }));

describe('report', () => {
    it('happyPath_writesOneErrorEntryWhosePayloadIsTheEvent', () => {
        const { errors, entries, calls } = reporter(json({}));

        errors.report(EVENT);

        expect(entries).toEqual([{ severity: 'ERROR', ...EVENT }]);
        expect(calls).toEqual([]);
    });
});

describe('listGroups', () => {
    it('happyPath_readsTheNewestGroupsOfThePeriod', async () => {
        const { errors, calls } = reporter(json(GROUP_STATS));

        const page = await errors.listGroups({ hours: 168, pageSize: 20 });

        expect(listGroupsResponseSchema.safeParse(page).success).toBe(true);
        expect(page).toEqual({
            groups: [
                {
                    groupId: 'e2e-group-1',
                    message: 'TypeError: boom',
                    frames: ['at draw (https://viewer.e2e.test/engine.mjs:10:5)'],
                    page: 'https://viewer.e2e.test/bucharest/',
                    client: 'Firefox 145 mobile',
                    affectedUsers: 3,
                    service: 'viewer',
                    version: '1.0.0',
                    count: 12,
                    firstSeen: '2026-10-10T08:00:00.123Z',
                    lastSeen: '2026-10-12T08:00:00.000Z',
                    resolution: 'ACKNOWLEDGED',
                },
                {
                    groupId: 'e2e-group-2',
                    message: 'x'.repeat(500),
                    service: 'unknown',
                    count: 0,
                    firstSeen: '2026-10-11T08:00:00.000Z',
                    lastSeen: '2026-10-11T09:00:00.000Z',
                    resolution: 'OPEN',
                },
                {
                    groupId: 'e2e-group-3',
                    message: '',
                    service: 'unknown',
                    count: 1,
                    firstSeen: '2026-10-11T08:00:00.000Z',
                    lastSeen: '2026-10-11T08:00:00.000Z',
                    resolution: 'OPEN',
                },
            ],
            nextPageToken: 'e2e-next-page',
        });
        const url = new URL(calls[0]?.url ?? '');
        expect(`${url.origin}${url.pathname}`).toBe(`${ERROR_REPORTING_API}/projects/demo-hcm/groupStats`);
        expect(Object.fromEntries(url.searchParams)).toEqual({
            'timeRange.period': 'PERIOD_1_WEEK',
            pageSize: '20',
            order: 'LAST_SEEN_DESC',
        });
        expect(calls[0]?.init?.headers).toEqual({ authorization: 'Bearer e2e-service-account-token' });
    });

    it('happyPath_aLaterPageAndAnEmptyProject', async () => {
        const { errors, calls } = reporter(json({}));

        await expect(errors.listGroups({ hours: 24, pageSize: 5, pageToken: 'e2e-next-page' })).resolves.toEqual({ groups: [] });
        await errors.listGroups({ hours: 720, pageSize: 5 });

        expect(new URL(calls[0]?.url ?? '').searchParams.get('pageToken')).toBe('e2e-next-page');
        expect(new URL(calls[0]?.url ?? '').searchParams.get('timeRange.period')).toBe('PERIOD_1_DAY');
        expect(new URL(calls[1]?.url ?? '').searchParams.get('timeRange.period')).toBe('PERIOD_30_DAYS');
    });

    it.each([
        [401, 'unauthorized'],
        [403, 'forbidden'],
        [404, 'notFound'],
        [400, 'invalid'],
        [503, 'unavailable'],
    ] as const)('badPath_httpStatus_%i_is_%s', async (status, failure) => {
        const { errors } = reporter(json({ error: { code: status, status: 'E2E' } }, status));

        const error = await errors.listGroups({ hours: 24, pageSize: 5 }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(UpstreamError);
        expect(error).toMatchObject({ service: 'error-reporting', failure, status });
    });

    it('badPath_aDisabledApiIsNamedInItsRefusal', async () => {
        const body = {
            error: {
                code: 403,
                status: 'PERMISSION_DENIED',
                details: [{ reason: 'SERVICE_DISABLED', metadata: { service: 'clouderrorreporting.googleapis.com' } }],
            },
        };
        const { errors } = reporter(json(body, 403));

        await expect(errors.listGroups({ hours: 24, pageSize: 5 })).rejects.toMatchObject({
            failure: 'forbidden',
            api: 'clouderrorreporting.googleapis.com',
        });
    });

    it('badPath_aRateLimitCarriesItsRetryAfter', async () => {
        const { errors } = reporter(json({}, 429, { 'retry-after': '30' }));

        await expect(errors.listGroups({ hours: 24, pageSize: 5 })).rejects.toMatchObject({
            failure: 'rateLimited',
            retryAfterSeconds: 30,
        });
    });

    it('badPath_aNetworkFailureIsUnavailableAndAnUnreadableBodyInvalid', async () => {
        const down = reporter(() => Promise.reject(new TypeError('fetch failed')));
        const garbled = reporter(() => Promise.resolve(new Response('<html>', { status: 200 })));

        await expect(down.errors.listGroups({ hours: 24, pageSize: 5 })).rejects.toMatchObject({ failure: 'unavailable' });
        await expect(garbled.errors.listGroups({ hours: 24, pageSize: 5 })).rejects.toMatchObject({ failure: 'invalid', status: 200 });
    });
});
