/** The Firebase Management adapter against the fake of `@hcm/test-support/fakes`: web apps and their public config. */
import { FIXTURE_VALUES } from '@hcm/test-support/api-fixtures';
import { createFakeFetch, createUpstreamFakes, jsonResponse, route, routeTable } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { FIREBASE_MANAGEMENT_API, IDENTITY_TOOLKIT_API, createFirebaseManagement } from '../../src/adapters/firebase-management.js';
import { UpstreamError } from '../../src/ports/errors.js';

const TOKEN = 'e2e-service-account-token';
const APP_ID = String(FIXTURE_VALUES['appId']);
const tokens = { accessToken: () => Promise.resolve(TOKEN) };

function world() {
    const upstream = createUpstreamFakes();
    return { upstream, firebase: createFirebaseManagement({ tokens, fetch: upstream.fetch }) };
}

function answering(answer: (request: { readonly url: URL }) => Response) {
    const upstream = createFakeFetch(
        routeTable([route('GET', `${FIREBASE_MANAGEMENT_API}/projects/{project}/webApps`, 'webApps.list', answer)]),
    );
    return { upstream, firebase: createFirebaseManagement({ tokens, fetch: upstream.fetch }) };
}

describe('listWebApps', () => {
    it('happyPath_listsTheProjectsWebApp', async () => {
        const { upstream, firebase } = world();

        await expect(firebase.listWebApps('demo-hcm')).resolves.toEqual([
            { appId: APP_ID, displayName: 'historic-city-map', state: 'ACTIVE' },
        ]);
        expect(upstream.calls[0]).toMatchObject({
            url: `${FIREBASE_MANAGEMENT_API}/projects/demo-hcm/webApps?pageSize=100`,
            headers: { authorization: `Bearer ${TOKEN}` },
        });
    });

    it('happyPath_readsEveryPage', async () => {
        const { upstream, firebase } = answering((request) =>
            request.url.searchParams.get('pageToken') === 'p2'
                ? jsonResponse({ apps: [{ appId: '1:1:web:b', state: 'DELETED' }, { displayName: 'no id' }], nextPageToken: '' })
                : jsonResponse({ apps: [{ appId: '1:1:web:a', state: 'ACTIVE' }], nextPageToken: 'p2' }),
        );

        await expect(firebase.listWebApps('demo-hcm')).resolves.toEqual([
            { appId: '1:1:web:a', state: 'ACTIVE' },
            { appId: '1:1:web:b', state: 'DELETED' },
        ]);
        expect(upstream.calls).toHaveLength(2);
    });

    it('happyPath_stopsAfterFivePages', async () => {
        const { upstream, firebase } = answering(() => jsonResponse({ apps: [], nextPageToken: 'again' }));

        await firebase.listWebApps('demo-hcm');

        expect(upstream.calls).toHaveLength(5);
    });

    it('happyPath_aProjectWithoutWebAppsListsNone', async () => {
        const { upstream, firebase } = world();
        upstream.scenario('firebase-management.noWebApp');

        await expect(firebase.listWebApps('demo-hcm')).resolves.toEqual([]);
    });

    it('badPath_aMissingRoleIsForbidden', async () => {
        const { upstream, firebase } = world();
        upstream.fail('firebase-management', 'forbidden');

        await expect(firebase.listWebApps('demo-hcm')).rejects.toMatchObject({
            service: 'firebase-management',
            failure: 'forbidden',
            api: undefined,
        });
    });

    it('badPath_aDisabledApiIsNamed', async () => {
        const { upstream, firebase } = world();
        upstream.fail('firebase-management', 'apiDisabled');

        await expect(firebase.listWebApps('demo-hcm')).rejects.toMatchObject({ failure: 'forbidden', api: 'firebase.googleapis.com' });
    });
});

describe('webAppConfig', () => {
    it('happyPath_readsThePublicIdsAndTheMeasurementId', async () => {
        const { upstream, firebase } = world();
        upstream.scenario('firebase-management.analyticsLinked');

        const config = await firebase.webAppConfig('demo-hcm', APP_ID);

        expect(config).toEqual({
            projectId: 'demo-hcm',
            appId: APP_ID,
            apiKey: String(FIXTURE_VALUES['apiKey']),
            measurementId: String(FIXTURE_VALUES['measurementId']),
        });
    });

    it('badPath_withoutAnalyticsThereIsNoMeasurementId', async () => {
        const config = await world().firebase.webAppConfig('demo-hcm', APP_ID);

        expect(config).not.toHaveProperty('measurementId');
    });

    it('badPath_anIncompleteConfigIsInvalid', async () => {
        const firebase = createFirebaseManagement({
            tokens,
            fetch: () => Promise.resolve(jsonResponse({ projectId: 'demo-hcm', appId: APP_ID })),
        });

        await expect(firebase.webAppConfig('demo-hcm', APP_ID)).rejects.toEqual(new UpstreamError('firebase-management', 'invalid'));
    });

    it('badPath_anUnknownAppIsNotFound', async () => {
        await expect(world().firebase.webAppConfig('demo-hcm', '1:1:web:gone')).rejects.toMatchObject({ failure: 'notFound' });
    });
});

describe('googleSignInClientId', () => {
    const IDP = `${IDENTITY_TOOLKIT_API}/projects/{project}/defaultSupportedIdpConfigs/google.com`;

    it('happyPath_readsTheGoogleProvidersClientOncePerInstance', async () => {
        const { upstream, firebase } = world();

        await expect(firebase.googleSignInClientId('demo-hcm')).resolves.toBe(String(FIXTURE_VALUES['oauthClientId']));
        await expect(firebase.googleSignInClientId('demo-hcm')).resolves.toBe(String(FIXTURE_VALUES['oauthClientId']));

        expect(upstream.calls.filter((call) => call.operation === 'firebase-management.googleIdpConfig')).toHaveLength(1);
        expect(upstream.calls[0]).toMatchObject({ headers: { authorization: `Bearer ${TOKEN}` } });
    });

    it('badPath_withoutGoogleSignInThereIsNoClient', async () => {
        const { upstream, firebase } = world();
        upstream.scenario('firebase-management.googleSignInOff');

        await expect(firebase.googleSignInClientId('demo-hcm')).resolves.toBeNull();
    });

    it('badPath_aProviderWithoutAClientIdHasNone', async () => {
        const upstream = createFakeFetch(routeTable([route('GET', IDP, 'idp', () => jsonResponse({ enabled: true }))]));

        await expect(createFirebaseManagement({ tokens, fetch: upstream.fetch }).googleSignInClientId('demo-hcm')).resolves.toBeNull();
    });

    it('badPath_aFailedReadIsForgottenSoTheNextCallTriesAgain', async () => {
        let calls = 0;
        const upstream = createFakeFetch(
            routeTable([
                route('GET', IDP, 'idp', () => {
                    calls += 1;
                    return calls === 1
                        ? jsonResponse({ error: { code: 503, status: 'UNAVAILABLE' } }, 503)
                        : jsonResponse({ clientId: 'c-2' });
                }),
            ]),
        );
        const firebase = createFirebaseManagement({ tokens, fetch: upstream.fetch });

        await expect(firebase.googleSignInClientId('demo-hcm')).rejects.toBeInstanceOf(UpstreamError);
        await expect(firebase.googleSignInClientId('demo-hcm')).resolves.toBe('c-2');
    });
});
