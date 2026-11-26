/**
 * The fake `fetch` and route table of `@hcm/test-support/fakes`: what adapter tests build their own small upstreams
 * with, and what the fake upstreams are made of.
 */
import { fixtureResponse } from '@hcm/test-support/api-fixtures';
import { createFakeFetch, jsonResponse, route, routeTable } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

describe('createFakeFetch', () => {
    it('happyPath_recordsEveryAnsweredCallWithItsOperation', async () => {
        const api = createFakeFetch(
            routeTable([route('POST', 'https://api.e2e.test/things', 'e2e.things.create', () => jsonResponse({ id: 1 }, 201))]),
        );

        const response = await api.fetch('https://api.e2e.test/things?x=1', {
            method: 'post',
            headers: { Authorization: 'Bearer e2e' },
            body: '{"name":"a"}',
        });

        expect(response.status).toBe(201);
        expect(api.calls).toEqual([
            {
                seq: 1,
                operation: 'e2e.things.create',
                method: 'POST',
                url: 'https://api.e2e.test/things?x=1',
                headers: { authorization: 'Bearer e2e', 'content-type': 'text/plain;charset=UTF-8' },
                body: '{"name":"a"}',
                status: 201,
            },
        ]);
        expect(api.callsTo('e2e.things')).toHaveLength(1);
    });

    it('happyPath_acceptsARequestObject', async () => {
        const api = createFakeFetch(routeTable([route('GET', 'https://api.e2e.test/ping', 'e2e.ping', () => new Response('pong'))]));

        await expect((await api.fetch(new Request('https://api.e2e.test/ping'))).text()).resolves.toBe('pong');
    });

    it('badPath_anUnknownRequestRejectsLikeANetworkFailureAndIsListed', async () => {
        const api = createFakeFetch(routeTable([]));

        await expect(api.fetch('https://api.e2e.test/missing?secret=x')).rejects.toThrow(
            'fetch failed: no fake answers GET https://api.e2e.test/missing',
        );
        expect(api.unhandled.map((call) => [call.operation, call.status])).toEqual([['unhandled', 0]]);
        expect(api.calls).toHaveLength(1);
    });

    it('happyPath_answerRecordsOnlyWhatAFakeKnows', async () => {
        const api = createFakeFetch(routeTable([route('GET', 'https://api.e2e.test/ping', 'e2e.ping', () => new Response('pong'))]));
        const request = (path: string) => ({
            method: 'GET',
            url: new URL(`https://api.e2e.test${path}`),
            headers: new Headers(),
            body: '',
        });

        expect(await api.answer(request('/nothing'))).toBeUndefined();
        expect((await api.answer(request('/ping')))?.operation).toBe('e2e.ping');
        expect(api.calls.map((call) => call.operation)).toEqual(['e2e.ping']);
        expect(api.unhandled).toEqual([]);
    });
});

describe('route', () => {
    const echo = (operation: string) => (_request: unknown, params: Readonly<Record<string, string>>) =>
        jsonResponse({ operation, params });

    const table = routeTable([
        route('POST', 'https://svc.e2e.test/v1/projects/{project}/services/{service}:enable', 'enable', echo('enable')),
        route('GET', 'https://svc.e2e.test/v1/projects/{project}/services/{service}', 'get', echo('get')),
        route('GET', 'https://svc.e2e.test/v1/{name*}/operations/{operation}', 'operation', echo('operation')),
    ]);

    async function call(method: string, path: string): Promise<unknown> {
        const answer = await table({ method, url: new URL(`https://svc.e2e.test${path}`), headers: new Headers(), body: '' });
        return answer === undefined ? undefined : answer.response.json();
    }

    it('happyPath_aCustomVerbSplitsFromItsParameter', async () => {
        await expect(call('POST', '/v1/projects/demo-hcm/services/run.googleapis.com:enable')).resolves.toEqual({
            operation: 'enable',
            params: { project: 'demo-hcm', service: 'run.googleapis.com' },
        });
    });

    it('happyPath_parametersArriveDecoded', async () => {
        await expect(call('GET', '/v1/projects/demo-hcm/services/a%40b')).resolves.toMatchObject({ params: { service: 'a@b' } });
    });

    it('happyPath_aStarParameterTakesSlashes', async () => {
        await expect(call('GET', '/v1/projects/1/locations/global/pools/p/operations/op-1')).resolves.toEqual({
            operation: 'operation',
            params: { name: 'projects/1/locations/global/pools/p', operation: 'op-1' },
        });
    });

    it('badPath_anotherMethodOrHostIsNotMatched', async () => {
        await expect(call('DELETE', '/v1/projects/demo-hcm/services/run.googleapis.com')).resolves.toBeUndefined();
        const other = await table({
            method: 'GET',
            url: new URL('https://elsewhere.e2e.test/v1/projects/p/services/s'),
            headers: new Headers(),
            body: '',
        });
        expect(other).toBeUndefined();
    });

    it('happyPath_aFixtureAnswersARoute', async () => {
        const api = createFakeFetch(
            routeTable([
                route('GET', 'https://api.mapbox.com/tokens/v2', 'mapbox.tokens.retrieve', () =>
                    fixtureResponse('mapbox/tokens.retrieve.invalid'),
                ),
            ]),
        );

        const response = await api.fetch('https://api.mapbox.com/tokens/v2?access_token=sk.e2e-bootstrap-revoked');

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual({ code: 'TokenInvalid' });
    });
});
