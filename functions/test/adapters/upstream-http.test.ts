/** The HTTP plumbing of the fn-setup adapters: failures by status, the timeout-wrapped call, lenient JSON reading. */
import { describe, expect, it, vi } from 'vitest';

import {
    at,
    errorDetails,
    failureOfStatus,
    list,
    readJson,
    send,
    stringAt,
    TIMED_OUT_REASON,
    strings,
    upstreamError,
    UPSTREAM_TIMEOUT_MS,
} from '../../src/adapters/upstream-http.js';
import { UpstreamError } from '../../src/ports/errors.js';

describe('failureOfStatus', () => {
    it.each([
        [400, 'invalid'],
        [401, 'unauthorized'],
        [403, 'forbidden'],
        [404, 'notFound'],
        [409, 'conflict'],
        [412, 'conflict'],
        [422, 'invalid'],
        [429, 'rateLimited'],
        [500, 'unavailable'],
        [503, 'unavailable'],
        [418, 'invalid'],
        [200, 'invalid'],
    ])('happyPath_status_%i_is_%s', (status, failure) => {
        expect(failureOfStatus(status)).toBe(failure);
    });
});

describe('upstreamError', () => {
    it('happyPath_carriesTheStatusAndTheRetryAfterHint', () => {
        const error = upstreamError('mapbox', new Response(null, { status: 429, headers: { 'retry-after': '60' } }));

        expect([error.failure, error.status, error.retryAfterSeconds, error.message]).toEqual([
            'rateLimited',
            429,
            60,
            'mapbox call failed: rateLimited (HTTP 429)',
        ]);
    });

    it.each(['Wed, 21 Oct 2026 07:28:00 GMT', '-1', ''])('badPath_aRetryAfterThatIsNotSeconds_%j_isIgnored', (value) => {
        expect(errorDetails(new Response(null, { status: 503, headers: { 'retry-after': value } }))).toEqual({ status: 503 });
    });

    it('happyPath_theCallerMayNameABetterFailure', () => {
        expect(upstreamError('usgs', new Response('<html></html>', { status: 503 }), 'maintenance').failure).toBe('maintenance');
    });
});

describe('send', () => {
    it('happyPath_passesTheRequestWithATimeoutSignal', async () => {
        const seen: RequestInit[] = [];
        const response = await send(
            (_url, init) => {
                seen.push(init ?? {});
                return Promise.resolve(new Response('ok'));
            },
            'mapbox',
            'https://api.mapbox.com/tokens/v2',
            { method: 'GET' },
        );

        expect(await response.text()).toBe('ok');
        expect(seen[0]).toMatchObject({ method: 'GET' });
        expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
        expect(UPSTREAM_TIMEOUT_MS).toBe(20_000);
    });

    it('badPath_aNetworkFailureIsUnavailableAndNeverRepeatsTheUrl', async () => {
        const url = 'https://api.mapbox.com/tokens/v2?access_token=sk.e2e-never-in-an-error';

        const failure = send(() => Promise.reject(new TypeError(`fetch failed: ${url}`)), 'mapbox', url, { method: 'GET' });

        await expect(failure).rejects.toEqual(new UpstreamError('mapbox', 'unavailable'));
        await expect(failure).rejects.not.toThrow(/e2e-never/);
    });

    it('badPath_aRequestPastItsOwnTimeoutIsAbortedAndSaysItTimedOut', async () => {
        vi.useFakeTimers();
        try {
            const hanging = (_url: string | URL | Request, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => {
                        reject(new DOMException('aborted', 'AbortError'));
                    });
                });
            const failure = send(hanging, 'usgs', 'https://m2m.cr.usgs.gov/api/api/json/stable/scene-search', {
                method: 'POST',
                timeoutMs: 5000,
            });
            const caught = failure.catch((error: unknown) => error);
            await vi.advanceTimersByTimeAsync(5000);

            expect(await caught).toMatchObject({ service: 'usgs', failure: 'unavailable', reason: TIMED_OUT_REASON });
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('readJson', () => {
    it('happyPath_readsAJsonBody', async () => {
        await expect(readJson(new Response('{"code":"TokenValid"}'))).resolves.toEqual({ code: 'TokenValid' });
    });

    it.each([
        ['an HTML page', new Response('<!DOCTYPE html><title>Application Offline</title>', { status: 503 })],
        ['an empty 204', new Response(null, { status: 204 })],
    ])('badPath_%s_readsAsUndefined', async (_label, response) => {
        await expect(readJson(response)).resolves.toBeUndefined();
    });

    it('badPath_aBrokenStreamReadsAsUndefined', async () => {
        const broken = new ReadableStream({
            start: (controller) => {
                controller.error(new Error('connection reset'));
            },
        });

        await expect(readJson(new Response(broken))).resolves.toBeUndefined();
    });
});

describe('reading answers', () => {
    const body = { token: { user: 'e2e-mapbox', usage: 7 }, scopes: ['styles:read', 3, 'fonts:read'], list: 'x' };

    it('happyPath_atWalksNestedObjects', () => {
        expect([at(body, 'token', 'user'), stringAt(body, 'token', 'user')]).toEqual(['e2e-mapbox', 'e2e-mapbox']);
    });

    it('badPath_atStopsAtAnythingThatIsNotAnObject', () => {
        expect([at(body, 'list', 'x'), at(null, 'a'), at(body, 'scopes', '0'), stringAt(body, 'token', 'usage')]).toEqual([
            undefined,
            undefined,
            undefined,
            undefined,
        ]);
    });

    it('happyPath_stringsKeepsTheStringsOfAnArray', () => {
        expect([strings(body.scopes), strings('styles:read'), list(body.scopes).length, list({})]).toEqual([
            ['styles:read', 'fonts:read'],
            [],
            3,
            [],
        ]);
    });
});
