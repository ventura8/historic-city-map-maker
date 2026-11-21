import { createLogger } from '@hcm/shared';
import { createRecordingSink } from '@hcm/test-support';
import { fixtureResponse } from '@hcm/test-support/api-fixtures';
import { createFakeFetch, jsonResponse, route, routeTable, type FakeFetch, type Route } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import {
    API_PROPAGATION_RETRY_MS,
    createApiWaits,
    createGoogleTransport,
    createOnce,
    withApiPropagation,
    type GoogleTransport,
} from '../../src/google/transport.js';

/** The one way the admin calls Google (M2b §3.4): bearer token, JSON, retries with backoff, pages, long-running operations. */

const URL_BASE = 'https://example.googleapis.com/v1';
const TOKEN = 'e2e-transport-token';

interface Harness {
    readonly transport: GoogleTransport;
    readonly fake: FakeFetch;
    readonly slept: number[];
    readonly warnings: () => readonly unknown[];
}

function harness(
    routes: readonly Route[],
    options: { readonly token?: string | null; readonly retries?: number; readonly polls?: number } = {},
): Harness {
    const fake = createFakeFetch(routeTable(routes));
    const slept: number[] = [];
    const sink = createRecordingSink();
    const transport = createGoogleTransport({
        fetch: fake.fetch,
        token: () => (options.token === undefined ? TOKEN : options.token),
        sleep: (ms) => {
            slept.push(ms);
            return Promise.resolve();
        },
        log: createLogger('google', { sink: sink.sink }),
        ...(options.retries === undefined ? {} : { retries: options.retries }),
        ...(options.polls === undefined ? {} : { operationPolls: options.polls }),
    });
    return { transport, fake, slept, warnings: () => sink.records.filter((record) => record.level === 'warn') };
}

/** Answers `answers` in turn, the last one for every later call. */
function inTurn(method: string, url: string, operation: string, answers: readonly (() => Response)[]): Route {
    let index = 0;
    return route(method, url, operation, () => {
        const answer = answers[Math.min(index, answers.length - 1)] as () => Response;
        index += 1;
        return answer();
    });
}

describe('call', () => {
    it('happyPath_theTokenIsABearerHeaderAndTheBodyJson', async () => {
        const { transport, fake } = harness([
            route('POST', `${URL_BASE}/things`, 'things.create', () => jsonResponse({ name: 'things/1' })),
        ]);

        const body = await transport.call({
            operation: 'things.create',
            method: 'POST',
            url: `${URL_BASE}/things`,
            query: { a: ['1', '2'], b: undefined, c: 3 },
            body: { x: 1 },
        });

        expect(body).toEqual({ name: 'things/1' });
        expect(fake.calls[0]).toMatchObject({
            url: `${URL_BASE}/things?a=1&a=2&c=3`,
            headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
            body: '{"x":1}',
        });
    });

    it('happyPath_anEmptyAnswerIsUndefinedAndAGetSendsNoBody', async () => {
        const { transport, fake } = harness([route('GET', `${URL_BASE}/empty`, 'empty.get', () => new Response(null, { status: 204 }))]);

        await expect(transport.call({ operation: 'empty.get', url: `${URL_BASE}/empty` })).resolves.toBeUndefined();
        expect(fake.calls[0]?.headers['content-type']).toBeUndefined();
    });

    it('happyPath_a503AndARateLimitAreRetriedWithBackoffAndRetryAfter', async () => {
        const { transport, slept, warnings } = harness([
            inTurn('GET', `${URL_BASE}/flaky`, 'flaky.get', [
                () => fixtureResponse('google/error.unavailable'),
                () => fixtureResponse('google/error.rate-limited'),
                () => jsonResponse({ ok: true }),
            ]),
        ]);

        await expect(transport.call({ operation: 'flaky.get', url: `${URL_BASE}/flaky` })).resolves.toEqual({ ok: true });
        expect(slept).toEqual([1000, 30_000]);
        expect(warnings()).toHaveLength(2);
    });

    it('badPath_retriesStopAfterTheLimitAndNetworkFailuresAreUnavailable', async () => {
        const { transport, fake, slept } = harness([], { retries: 4 });

        const failure = await transport
            .call({ operation: 'gone.get', url: `${URL_BASE}/gone`, role: 'roles/owner' })
            .catch((error: unknown) => error);

        // Finding 48 of 2026-11-01: no answer at all names the host the request could not reach (never its path or query).
        expect(failure).toMatchObject({
            kind: 'unavailable',
            status: 0,
            role: 'roles/owner',
            operation: 'gone.get',
            host: 'example.googleapis.com',
        });
        expect(fake.unhandled).toHaveLength(5);
        expect(slept).toEqual([1000, 2000, 4000, 8000]);
        expect(String(failure)).not.toContain('example.googleapis.com');
    });

    it('badPath_aClientErrorIsNeverRetried', async () => {
        const { transport, fake } = harness([
            route('GET', `${URL_BASE}/denied`, 'denied.get', () => fixtureResponse('google/error.permission-denied')),
        ]);

        await expect(transport.call({ operation: 'denied.get', url: `${URL_BASE}/denied`, role: 'roles/x' })).rejects.toMatchObject({
            kind: 'forbidden',
            role: 'roles/x',
        });
        expect(fake.calls).toHaveLength(1);
    });

    it('badPath_aDroppedTokenFailsUnauthorizedWithoutAnyCall', async () => {
        const { transport, fake } = harness([], { token: null });

        await expect(transport.call({ operation: 'x.get', url: `${URL_BASE}/x` })).rejects.toMatchObject({
            kind: 'unauthorized',
            status: 0,
        });
        await expect(transport.call({ operation: 'x.get', url: `${URL_BASE}/x`, role: 'roles/y' })).rejects.toMatchObject({
            role: 'roles/y',
        });
        expect(fake.calls).toEqual([]);
    });

    it('badPath_anErrorThatIsNotGooglesIsRethrownAtOnce', async () => {
        const transport = createGoogleTransport({
            fetch: () => Promise.resolve(new Response('{}')),
            token: () => {
                throw new RangeError('broken store');
            },
            sleep: () => Promise.resolve(),
            log: createLogger('google', { sink: () => undefined }),
        });

        await expect(transport.call({ operation: 'x.get', url: `${URL_BASE}/x` })).rejects.toThrow(RangeError);
    });
});

describe('an unreadable answer', () => {
    it('badPath_aBodyThatBreaksWhileReadIsNoJson', async () => {
        const broken = (): Response =>
            new Response(
                new ReadableStream({
                    start: (controller) => {
                        controller.error(new Error('connection reset'));
                    },
                }),
            );
        const { transport } = harness([route('GET', `${URL_BASE}/broken`, 'broken.get', broken)]);

        await expect(transport.call({ operation: 'broken.get', url: `${URL_BASE}/broken` })).resolves.toBeUndefined();
    });
});

describe('find', () => {
    it('happyPath_a404IsUndefinedAndAnyOtherFailureThrows', async () => {
        const { transport } = harness([
            route('GET', `${URL_BASE}/missing`, 'missing.get', () => fixtureResponse('google/error.not-found')),
            route('GET', `${URL_BASE}/denied`, 'denied.get', () => fixtureResponse('google/error.permission-denied')),
        ]);

        await expect(transport.find({ operation: 'missing.get', url: `${URL_BASE}/missing` })).resolves.toBeUndefined();
        await expect(transport.find({ operation: 'denied.get', url: `${URL_BASE}/denied` })).rejects.toMatchObject({ kind: 'forbidden' });
    });
});

describe('pages', () => {
    it('happyPath_everyPageIsReadFollowingTheToken', async () => {
        const { transport, fake } = harness([
            route('GET', `${URL_BASE}/items`, 'items.list', (request) =>
                jsonResponse(
                    request.url.searchParams.get('pageToken') === 'p2'
                        ? { items: [3], nextPageToken: '' }
                        : { items: [1, 2], nextPageToken: 'p2' },
                ),
            ),
        ]);

        await expect(
            transport.pages({ operation: 'items.list', url: `${URL_BASE}/items`, query: { pageSize: 2 } }, 'items'),
        ).resolves.toEqual([1, 2, 3]);
        expect(fake.calls.map((call) => call.url)).toEqual([`${URL_BASE}/items?pageSize=2`, `${URL_BASE}/items?pageSize=2&pageToken=p2`]);
    });
});

describe('operation', () => {
    it('happyPath_anUnfinishedOperationIsPolledUntilDone', async () => {
        const { transport, slept } = harness([
            inTurn('GET', `${URL_BASE}/operations/op-1`, 'op.get', [
                () => jsonResponse({ name: 'operations/op-1' }),
                () => jsonResponse({ name: 'operations/op-1', done: true, response: { email: 'a@b' } }),
            ]),
        ]);

        await expect(transport.operation(URL_BASE, { name: 'operations/op-1' }, { operation: 'op.get' })).resolves.toEqual({
            email: 'a@b',
        });
        expect(slept).toEqual([2000, 2000]);
    });

    it('badPath_anOperationThatFailedOrNeverFinishesOrHasNoNameIsAFailure', async () => {
        const { transport } = harness(
            [route('GET', `${URL_BASE}/operations/slow`, 'op.get', () => jsonResponse({ name: 'operations/slow' }))],
            {
                polls: 2,
            },
        );

        await expect(
            transport.operation(URL_BASE, { done: true, error: { code: 9, message: 'no' } }, { operation: 'op', role: 'roles/z' }),
        ).rejects.toMatchObject({
            kind: 'invalid',
            role: 'roles/z',
        });
        await expect(transport.operation(URL_BASE, { name: 'operations/slow' }, { operation: 'op' })).rejects.toMatchObject({
            kind: 'unavailable',
        });
        await expect(transport.operation(URL_BASE, {}, { operation: 'op' })).rejects.toMatchObject({ kind: 'unavailable', status: 0 });
    });
});

describe('createOnce', () => {
    it('happyPath_aCreateOrAnExistingResourceIsSuccessAndAnythingElseThrows', async () => {
        const { transport } = harness([
            route('POST', `${URL_BASE}/new`, 'new.create', () => jsonResponse({})),
            route('POST', `${URL_BASE}/old`, 'old.create', () => fixtureResponse('google/error.already-exists')),
            route('POST', `${URL_BASE}/bad`, 'bad.create', () => fixtureResponse('google/error.invalid-argument')),
        ]);

        await expect(createOnce(transport, { operation: 'new.create', method: 'POST', url: `${URL_BASE}/new` })).resolves.toBe(true);
        await expect(createOnce(transport, { operation: 'old.create', method: 'POST', url: `${URL_BASE}/old` })).resolves.toBe(false);
        await expect(createOnce(transport, { operation: 'bad.create', method: 'POST', url: `${URL_BASE}/bad` })).rejects.toMatchObject({
            kind: 'invalid',
        });
    });
});

describe('an API Google is still switching on (M6, finding 4)', () => {
    const SERVICE = 'https://serviceusage.googleapis.com/v1/projects/123456789012/services/iam.googleapis.com';
    const disabled = (): Response =>
        fixtureResponse('google/error.service-disabled', { values: { service: 'iam.googleapis.com', serviceTitle: 'IAM API' } });

    function propagating(routes: readonly Route[]) {
        const fake = createFakeFetch(routeTable(routes));
        const slept: number[] = [];
        const heard: string[] = [];
        const waits = createApiWaits();
        waits.listen((api) => heard.push(api));
        const transport = createGoogleTransport(
            withApiPropagation(
                {
                    fetch: fake.fetch,
                    token: () => TOKEN,
                    sleep: (ms) => {
                        slept.push(ms);
                        return Promise.resolve();
                    },
                    log: createLogger('google', { sink: createRecordingSink().sink }),
                },
                '123456789012',
                waits,
            ),
        );
        return { transport, slept, heard, waits };
    }

    it('happyPath_aRefusalOfAnEnabledApiIsWaitedOutAndEachWaitHeard', async () => {
        const { transport, slept, heard } = propagating([
            route('GET', SERVICE, 'service-usage.get', () => jsonResponse({ state: 'ENABLED' })),
            inTurn('GET', `${URL_BASE}/accounts`, 'accounts.list', [disabled, disabled, () => jsonResponse({ accounts: [] })]),
        ]);

        await expect(transport.call({ operation: 'accounts.list', url: `${URL_BASE}/accounts` })).resolves.toEqual({ accounts: [] });
        expect(slept).toEqual([10_000, 20_000]);
        expect(heard).toEqual(['iam.googleapis.com', 'iam.googleapis.com']);
    });

    it('badPath_afterTheLastWaitTheFailureSaysTheApiIsStillPropagating', async () => {
        const { transport, slept, waits, heard } = propagating([
            route('GET', SERVICE, 'service-usage.get', () => jsonResponse({ state: 'ENABLED' })),
            route('GET', `${URL_BASE}/accounts`, 'accounts.list', disabled),
        ]);
        waits.listen(undefined);

        const failure = await transport.call({ operation: 'accounts.list', url: `${URL_BASE}/accounts` }).catch((error: unknown) => error);

        expect(failure).toMatchObject({ kind: 'forbidden', api: 'iam.googleapis.com', reason: 'API_PROPAGATING' });
        expect(slept).toEqual(API_PROPAGATION_RETRY_MS);
        expect(heard).toEqual([]);
    });

    it('badPath_aServiceUsageThatCannotBeReadCountsAsOffAndNothingIsWaited', async () => {
        const { transport, slept } = propagating([
            route('GET', SERVICE, 'service-usage.get', () => fixtureResponse('google/error.permission-denied')),
            route('GET', `${URL_BASE}/accounts`, 'accounts.list', disabled),
        ]);

        const failure = await transport.call({ operation: 'accounts.list', url: `${URL_BASE}/accounts` }).catch((error: unknown) => error);

        expect(failure).toMatchObject({ kind: 'forbidden', api: 'iam.googleapis.com', reason: 'SERVICE_DISABLED' });
        expect(slept).toEqual([]);
    });

    it('badPath_anotherRefusalIsNeverWaitedFor', async () => {
        const { transport, slept } = propagating([
            route('GET', `${URL_BASE}/accounts`, 'accounts.list', () => fixtureResponse('google/error.permission-denied')),
        ]);

        await expect(transport.call({ operation: 'accounts.list', url: `${URL_BASE}/accounts` })).rejects.toMatchObject({
            kind: 'forbidden',
        });
        expect(slept).toEqual([]);
    });
});
