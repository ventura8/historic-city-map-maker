/**
 * The USGS M2M adapter against the fake M2M of `@hcm/test-support/fakes`: the body is read on every status, so JSON
 * errors (HTTP 500 with an `errorCode`), the gateway's HTML 403 and the maintenance page each become the failure the
 * Setup Assistant explains; the application token and the API key never reach a log line.
 */
import { createLogger, type LogRecord } from '@hcm/shared';
import { createRecordingSink } from '@hcm/test-support';
import { fixtureResponse } from '@hcm/test-support/api-fixtures';
import { createFakeFetch, createUpstreamFakes, route, routeTable, USGS_CREDENTIALS } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { USGS_M2M_API, createUsgsApi } from '../../src/adapters/usgs.js';
import { UpstreamError } from '../../src/ports/errors.js';

function world(fetchOverride?: typeof fetch) {
    const upstream = createUpstreamFakes();
    const recording = createRecordingSink();
    const usgs = createUsgsApi({
        fetch: fetchOverride ?? upstream.fetch,
        log: createLogger('functions', { sink: recording.sink, minLevel: 'debug' }),
    });
    return { upstream, usgs, records: recording.records };
}

/** An M2M that answers every endpoint with `response`. */
function answering(response: () => Response): typeof fetch {
    return createFakeFetch(routeTable([route('POST', `${USGS_M2M_API}/{endpoint}`, 'usgs.any', response)])).fetch;
}

function secretFree(records: readonly LogRecord[]): string {
    return JSON.stringify(records);
}

describe('login, permissions and logout', () => {
    it('happyPath_anApprovedAccountGetsAKeyAndTheDownloadPermission', async () => {
        const { upstream, usgs } = world();

        const apiKey = await usgs.login(USGS_CREDENTIALS.approved.username, USGS_CREDENTIALS.approved.applicationToken);
        const permissions = await usgs.permissions(apiKey);
        await usgs.logout(apiKey);

        expect([apiKey, permissions]).toEqual(['e2e-usgs-api-key-0001', ['user', 'download', 'order']]);
        expect(upstream.calls.map((call) => [call.operation, call.headers['x-auth-token']])).toEqual([
            ['usgs.login-token', undefined],
            ['usgs.permissions', apiKey],
            ['usgs.logout', apiKey],
        ]);
        expect(JSON.parse(String(upstream.calls[0]?.body))).toEqual({ username: 'e2e-ok', token: 'e2e-usgs-app-token-ok' });
        expect(upstream.state.usgs.sessions.size).toBe(0);
    });

    it('happyPath_anAccountAwaitingApprovalHasNoDownloadPermission', async () => {
        const { usgs } = world();
        const apiKey = await usgs.login(USGS_CREDENTIALS.pending.username, USGS_CREDENTIALS.pending.applicationToken);

        await expect(usgs.permissions(apiKey)).resolves.toEqual(['user']);
    });
});

describe('failures', () => {
    it('badPath_anExpiredTokenGetsTheHtml403AndIsUnauthorized', async () => {
        const { usgs, records } = world();

        await expect(usgs.login(USGS_CREDENTIALS.expired.username, USGS_CREDENTIALS.expired.applicationToken)).rejects.toMatchObject({
            service: 'usgs',
            failure: 'unauthorized',
            status: 403,
        });
        expect(records).toEqual([
            {
                level: 'warn',
                scope: 'functions',
                message: 'usgs m2m call failed',
                data: { endpoint: 'login-token', status: 403, errorCode: undefined },
            },
        ]);
        expect(secretFree(records)).not.toContain(USGS_CREDENTIALS.expired.applicationToken);
    });

    it('badPath_unknownCredentialsAreAuthInvalid', async () => {
        const { usgs, records } = world();

        await expect(usgs.login(USGS_CREDENTIALS.unknown.username, USGS_CREDENTIALS.unknown.applicationToken)).rejects.toMatchObject({
            failure: 'unauthorized',
            status: 500,
        });
        expect(records[0]?.data).toEqual({ endpoint: 'login-token', status: 500, errorCode: 'AUTH_INVALID' });
    });

    it('badPath_theMaintenancePageIsMaintenance', async () => {
        const { upstream, usgs } = world();
        upstream.fail('usgs', 'maintenance');

        await expect(usgs.login(USGS_CREDENTIALS.approved.username, USGS_CREDENTIALS.approved.applicationToken)).rejects.toMatchObject({
            failure: 'maintenance',
            status: 503,
        });
    });

    it('badPath_theRateLimitIsRateLimitedWithItsRetryAfter', async () => {
        const { upstream, usgs } = world();
        upstream.fail('usgs', 'rateLimited');

        await expect(usgs.permissions('e2e-usgs-api-key-0001')).rejects.toMatchObject({ failure: 'rateLimited', retryAfterSeconds: 60 });
    });

    it('badPath_aGatewayErrorIsUnavailable', async () => {
        const { upstream, usgs } = world();
        upstream.fail('usgs', 'unavailable');

        await expect(usgs.login('e2e-ok', 'e2e-usgs-app-token-ok')).rejects.toMatchObject({ failure: 'unavailable', status: 502 });
    });

    it('badPath_anAccountWithoutM2mAccessIsForbidden', async () => {
        const { usgs } = world(
            answering(() => fixtureResponse('usgs/login-token.auth-invalid', { merge: { errorCode: 'AUTH_UNAUTHORIZED' } })),
        );

        await expect(usgs.login('e2e-no-m2m', 'e2e-usgs-app-token-no-m2m')).rejects.toMatchObject({ failure: 'forbidden' });
    });

    it.each([
        ['AUTH_UNAUTHROIZED', 'forbidden'],
        ['AUTH_KEY_INVALID', 'unauthorized'],
        ['RATE_LIMIT_USER_DL', 'rateLimited'],
        ['DOWNLOAD_ERROR', 'invalid'],
    ] as const)('badPath_errorCode_%s_is_%s', async (errorCode, failure) => {
        const { usgs } = world(answering(() => fixtureResponse('usgs/login-token.auth-invalid', { merge: { errorCode } })));

        await expect(usgs.permissions('e2e-usgs-api-key-0001')).rejects.toMatchObject({ failure });
    });

    it('badPath_aFailedStatusWithoutAnErrorCodeIsMappedByItsStatus', async () => {
        const { usgs } = world(answering(() => fixtureResponse('usgs/logout.ok', { status: 504 })));

        await expect(usgs.permissions('e2e-usgs-api-key-0001')).rejects.toMatchObject({ failure: 'unavailable', status: 504 });
    });

    it.each([
        ['an empty key', null],
        ['a key that is not a string', 42],
    ])('badPath_aLoginAnswerWith_%s_isInvalid', async (_label, data) => {
        const { usgs } = world(answering(() => fixtureResponse('usgs/logout.ok', { merge: { data } })));

        await expect(usgs.login('e2e-ok', 'e2e-usgs-app-token-ok')).rejects.toEqual(new UpstreamError('usgs', 'invalid'));
    });

    it('badPath_permissionsThatAreNotAListAreInvalid', async () => {
        const { usgs } = world(answering(() => fixtureResponse('usgs/logout.ok', { merge: { data: { download: true } } })));

        await expect(usgs.permissions('e2e-usgs-api-key-0001')).rejects.toEqual(new UpstreamError('usgs', 'invalid'));
    });

    it('badPath_anHtmlAnswerWithStatus200IsInvalid', async () => {
        const { usgs } = world(answering(() => new Response('<html></html>', { status: 200 })));

        await expect(usgs.permissions('e2e-usgs-api-key-0001')).rejects.toMatchObject({ failure: 'invalid', status: 200 });
    });
});

describe('logout', () => {
    it('happyPath_aFailedLogoutIsIgnoredAndLoggedWithoutTheKey', async () => {
        const { upstream, usgs, records } = world();
        upstream.fail('usgs', 'unavailable');

        await expect(usgs.logout('e2e-usgs-api-key-0042')).resolves.toBeUndefined();
        expect(records.map((record) => [record.level, record.message])).toEqual([
            ['warn', 'usgs m2m call failed'],
            ['debug', 'usgs logout failed (the key expires by itself)'],
        ]);
        expect(secretFree(records)).not.toContain('0042');
    });

    it('happyPath_aNetworkFailureOnLogoutIsIgnored', async () => {
        const { usgs } = world(() => Promise.reject(new TypeError('fetch failed')));

        await expect(usgs.logout('e2e-usgs-api-key-0001')).resolves.toBeUndefined();
    });
});

describe('request (M7: the local worker’s M2M call through the server)', () => {
    it('happyPath_anyEndpointIsPostedWithTheKeyAndAnswersItsData', async () => {
        const data = { availableDownloads: [{ entityId: 'DS1035-1057DA023', url: 'https://dds.cr.usgs.gov/e2e/frame.tgz' }] };
        const fake = createFakeFetch(
            routeTable([
                route('POST', `${USGS_M2M_API}/{endpoint}`, 'usgs.any', () => fixtureResponse('usgs/logout.ok', { merge: { data } })),
            ]),
        );
        const { usgs } = world(fake.fetch);

        await expect(usgs.request('e2e-usgs-api-key-0001', 'download-request', { label: 'hcm-job-1' })).resolves.toEqual(data);
        expect(fake.calls.map((call) => [call.url, call.headers['x-auth-token'], call.body])).toEqual([
            [`${USGS_M2M_API}/download-request`, 'e2e-usgs-api-key-0001', JSON.stringify({ label: 'hcm-job-1' })],
        ]);
    });

    it('badPath_anM2MErrorFailsTheRequestAsEveryCall', async () => {
        const { usgs } = world(answering(() => fixtureResponse('usgs/login-token.auth-invalid', { merge: { errorCode: 'RATE_LIMIT' } })));

        await expect(usgs.request('e2e-usgs-api-key-0001', 'download-options', {})).rejects.toMatchObject({ failure: 'rateLimited' });
    });
});
