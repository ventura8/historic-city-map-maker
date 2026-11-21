/** One Google REST call: the bearer token, the JSON body, and failures that name a disabled API. */
import { fixtureResponse } from '@hcm/test-support/api-fixtures';
import { createFakeFetch, jsonResponse, route, routeTable } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { GoogleApiError, googleError, googleJson, googleSend } from '../../src/adapters/google-call.js';
import { UpstreamError } from '../../src/ports/errors.js';

const URL_OF = 'https://firebase.googleapis.com/v1beta1/projects/demo-hcm/webApps';
const TOKEN = 'e2e-service-account-token';

function fake(response: () => Response) {
    return createFakeFetch(
        routeTable([route('GET', URL_OF, 'firebase.list', response), route('POST', URL_OF, 'firebase.create', response)]),
    );
}

describe('googleJson', () => {
    it('happyPath_sendsTheBearerTokenAndReadsTheAnswer', async () => {
        const upstream = fake(() => jsonResponse({ apps: [] }));

        await expect(googleJson(upstream.fetch, 'firebase-management', URL_OF, { method: 'GET', accessToken: TOKEN })).resolves.toEqual({
            apps: [],
        });
        expect(upstream.calls[0]).toMatchObject({
            method: 'GET',
            body: '',
            headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        });
    });

    it('happyPath_sendsAJsonBody', async () => {
        const upstream = fake(() => jsonResponse({}));

        await googleSend(upstream.fetch, 'firebase-management', URL_OF, {
            method: 'POST',
            accessToken: TOKEN,
            body: { permissions: ['a'] },
        });

        expect(upstream.calls[0]?.body).toBe('{"permissions":["a"]}');
    });

    it('badPath_aDisabledApiIsNamed', async () => {
        const upstream = fake(() =>
            fixtureResponse('google/error.service-disabled', {
                values: { service: 'firebase.googleapis.com', serviceTitle: 'Firebase Management API' },
            }),
        );

        const failure = googleJson(upstream.fetch, 'firebase-management', URL_OF, { method: 'GET', accessToken: TOKEN });

        await expect(failure).rejects.toBeInstanceOf(UpstreamError);
        await expect(failure).rejects.toMatchObject({
            name: 'GoogleApiError',
            failure: 'forbidden',
            status: 403,
            api: 'firebase.googleapis.com',
        });
    });

    it.each([
        ['google/error.permission-denied', 'forbidden'],
        ['google/error.unauthenticated', 'unauthorized'],
        ['google/error.not-found', 'notFound'],
        ['google/error.unavailable', 'unavailable'],
    ] as const)('badPath_%s_isA_%s_withoutAnApi', async (name, failure) => {
        const upstream = fake(() => fixtureResponse(name));

        await expect(
            googleJson(upstream.fetch, 'firebase-management', URL_OF, { method: 'GET', accessToken: TOKEN }),
        ).rejects.toMatchObject({
            failure,
            api: undefined,
        });
    });

    it('happyPath_aCallerMayOverrideTheFailure', async () => {
        const error = await googleError('google-oauth', jsonResponse({ error: 'invalid_token' }, 400), 'unauthorized');

        expect(error).toEqual(new GoogleApiError('google-oauth', 'unauthorized', { status: 400 }, undefined));
        expect(error.message).toBe('google-oauth call failed: unauthorized (HTTP 400)');
    });
});
