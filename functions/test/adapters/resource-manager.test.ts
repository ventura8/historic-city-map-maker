/**
 * The Google identity adapter of `admin.claim`: tokeninfo (with the caller's token as a bearer header, as
 * google-auth-library's `getTokenInfo` sends it) and Resource Manager `testIamPermissions` against the fake of
 * `@hcm/test-support/fakes` (the access tokens of `GOOGLE_TOKENS` encode who granted them).
 */
import { FIXTURE_VALUES, fixtureResponse, type FixtureName } from '@hcm/test-support/api-fixtures';
import { createFakeFetch, createUpstreamFakes, GOOGLE_TOKENS, route, routeTable } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { GOOGLE_TOKENINFO_URL, RESOURCE_MANAGER_API, createGoogleIam } from '../../src/adapters/resource-manager.js';

const OWNER = String(FIXTURE_VALUES['ownerEmail']);
const CLIENT = String(FIXTURE_VALUES['oauthClientId']);
const SET_IAM_POLICY = 'resourcemanager.projects.setIamPolicy';

/** tokeninfo answering the fixture of the token in the bearer header (the e2e fake reads the query: CR-M2-17). */
function tokeninfo(byToken: Readonly<Record<string, FixtureName>>, merge?: Readonly<Record<string, unknown>>) {
    const upstream = createFakeFetch(
        routeTable([
            route('POST', GOOGLE_TOKENINFO_URL, 'google-oauth.tokeninfo', (request) => {
                const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
                return fixtureResponse(byToken[token] ?? 'google-oauth/tokeninfo.expired', merge === undefined ? {} : { merge });
            }),
        ]),
    );
    return { upstream, iam: createGoogleIam({ fetch: upstream.fetch }) };
}

describe('tokenInfo', () => {
    it('happyPath_readsWhoGrantedTheTokenForWhichClientWithWhichScopes', async () => {
        const { upstream, iam } = tokeninfo({ [GOOGLE_TOKENS.owner]: 'google-oauth/tokeninfo.owner' });

        await expect(iam.tokenInfo(GOOGLE_TOKENS.owner)).resolves.toEqual({
            email: OWNER,
            emailVerified: true,
            audience: CLIENT,
            scopes: [
                'openid',
                'https://www.googleapis.com/auth/userinfo.email',
                'https://www.googleapis.com/auth/cloud-platform.read-only',
            ],
            expiresInSeconds: 3599,
        });
        expect(upstream.calls[0]).toMatchObject({ method: 'POST', url: GOOGLE_TOKENINFO_URL, body: '' });
        expect(upstream.calls[0]?.url).not.toContain('access_token');
    });

    it('happyPath_theAudienceFallsBackToAud', async () => {
        const { iam } = tokeninfo(
            { [GOOGLE_TOKENS.owner]: 'google-oauth/tokeninfo.owner' },
            { azp: undefined, email_verified: false, scope: undefined, expires_in: 'soon' },
        );

        await expect(iam.tokenInfo(GOOGLE_TOKENS.owner)).resolves.toMatchObject({
            audience: CLIENT,
            emailVerified: false,
            scopes: [],
            expiresInSeconds: 0,
        });
    });

    it('badPath_anExpiredTokenIsUnauthorized', async () => {
        const { iam } = tokeninfo({});

        await expect(iam.tokenInfo(GOOGLE_TOKENS.expired)).rejects.toMatchObject({
            service: 'google-oauth',
            failure: 'unauthorized',
            status: 400,
        });
    });

    it.each([{ email: undefined }, { azp: undefined, aud: undefined }])(
        'badPath_aTokenThatCannotProveWhoGrantedItIsUnauthorized_%#',
        async (merge) => {
            const { iam } = tokeninfo({ [GOOGLE_TOKENS.owner]: 'google-oauth/tokeninfo.owner' }, merge);

            await expect(iam.tokenInfo(GOOGLE_TOKENS.owner)).rejects.toMatchObject({ failure: 'unauthorized', status: 200 });
        },
    );

    it('badPath_aGoogleOutageIsUnavailable', async () => {
        const { iam } = tokeninfo({ [GOOGLE_TOKENS.owner]: 'google/error.unavailable' });

        await expect(iam.tokenInfo(GOOGLE_TOKENS.owner)).rejects.toMatchObject({ failure: 'unavailable', status: 503 });
    });
});

describe('testProjectPermissions', () => {
    function world() {
        const upstream = createUpstreamFakes();
        return { upstream, iam: createGoogleIam({ fetch: upstream.fetch }) };
    }

    it('happyPath_theOwnerHoldsSetIamPolicy', async () => {
        const { upstream, iam } = world();

        await expect(iam.testProjectPermissions('demo-hcm', GOOGLE_TOKENS.owner, [SET_IAM_POLICY])).resolves.toEqual([SET_IAM_POLICY]);
        expect(upstream.calls[0]).toMatchObject({
            url: `${RESOURCE_MANAGER_API}/projects/demo-hcm:testIamPermissions`,
            headers: { authorization: `Bearer ${GOOGLE_TOKENS.owner}` },
            body: JSON.stringify({ permissions: [SET_IAM_POLICY] }),
        });
    });

    it('badPath_anEditorHoldsNone', async () => {
        await expect(world().iam.testProjectPermissions('demo-hcm', GOOGLE_TOKENS.editor, [SET_IAM_POLICY])).resolves.toEqual([]);
    });

    it('badPath_anAccountWithoutAccessHoldsNone', async () => {
        await expect(world().iam.testProjectPermissions('demo-hcm', GOOGLE_TOKENS.stranger, [SET_IAM_POLICY])).resolves.toEqual([]);
    });

    it('badPath_onlyThePermissionsAskedForCount', async () => {
        const fake = createFakeFetch(
            routeTable([
                route('POST', `${RESOURCE_MANAGER_API}/projects/{project}:testIamPermissions`, 'rm', () =>
                    fixtureResponse('resource-manager/test-iam-permissions.granted', {
                        merge: { permissions: [SET_IAM_POLICY, 'iam.everything'] },
                    }),
                ),
            ]),
        );

        await expect(
            createGoogleIam({ fetch: fake.fetch }).testProjectPermissions('demo-hcm', GOOGLE_TOKENS.owner, ['other']),
        ).resolves.toEqual([]);
    });

    it('badPath_anExpiredTokenIsUnauthorized', async () => {
        await expect(world().iam.testProjectPermissions('demo-hcm', GOOGLE_TOKENS.expired, [SET_IAM_POLICY])).rejects.toMatchObject({
            service: 'resource-manager',
            failure: 'unauthorized',
        });
    });
});
