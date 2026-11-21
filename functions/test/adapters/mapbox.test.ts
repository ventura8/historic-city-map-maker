/**
 * The Mapbox adapter against the fake Mapbox of `@hcm/test-support/fakes` (accounts with a plan, their tokens, the
 * Tokens API's scope checks): token checks, the token list, minting and updating, deleting, and
 * every failure shape the Setup Assistant explains (a revoked token, a demo account, unconfirmed billing, an outage).
 */
import { FIXTURE_VALUES } from '@hcm/test-support/api-fixtures';
import { createFakeFetch, createUpstreamFakes, jsonResponse, MAPBOX_TOKENS, route, routeTable } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { MAPBOX_API, createMapboxApi } from '../../src/adapters/mapbox.js';
import { UpstreamError } from '../../src/ports/errors.js';

const USER = String(FIXTURE_VALUES['mapboxUser']);
const BOOTSTRAP_ID = String(FIXTURE_VALUES['tokenId']);
const PUBLIC_REQUEST = {
    note: 'e2e viewer',
    scopes: ['styles:read', 'styles:tiles', 'fonts:read'],
    allowedUrls: ['https://ventura8.github.io'],
};

function world() {
    const upstream = createUpstreamFakes();
    return { upstream, mapbox: createMapboxApi({ fetch: upstream.fetch }) };
}

describe('retrieveToken', () => {
    it('happyPath_aSecretTokenNamesItsUserAndId', async () => {
        const { upstream, mapbox } = world();

        await expect(mapbox.retrieveToken(MAPBOX_TOKENS.bootstrap)).resolves.toEqual({ user: USER, usage: 'sk', tokenId: BOOTSTRAP_ID });
        expect(upstream.calls[0]?.url).toBe(`${MAPBOX_API}/tokens/v2?access_token=${MAPBOX_TOKENS.bootstrap}`);
    });

    it('happyPath_aPublicTokenSaysSo', async () => {
        await expect(world().mapbox.retrieveToken(MAPBOX_TOKENS.defaultPublic)).resolves.toMatchObject({ usage: 'pk' });
    });

    it('badPath_aRevokedTokenIsUnauthorized', async () => {
        await expect(world().mapbox.retrieveToken(MAPBOX_TOKENS.revoked)).rejects.toMatchObject({
            service: 'mapbox',
            failure: 'unauthorized',
            status: 401,
        });
    });

    it('badPath_aCodeOtherThanTokenValidIsUnauthorized', async () => {
        const mapbox = createMapboxApi({ fetch: () => Promise.resolve(jsonResponse({ code: 'TokenExpired' })) });

        await expect(mapbox.retrieveToken('sk.e2e-expired-token')).rejects.toMatchObject({ failure: 'unauthorized', status: 200 });
    });

    it.each([
        { code: 'TokenValid' },
        { code: 'TokenValid', token: { user: 'e2e-mapbox', usage: 'xx', authorization: 'id' } },
        { code: 'TokenValid', token: { usage: 'sk', authorization: 'id' } },
        { code: 'TokenValid', token: { user: 'e2e-mapbox', usage: 'sk' } },
    ])('badPath_anIncompleteAnswerIsInvalid_%#', async (body) => {
        const mapbox = createMapboxApi({ fetch: () => Promise.resolve(jsonResponse(body)) });

        await expect(mapbox.retrieveToken('sk.e2e-odd-answer')).rejects.toEqual(new UpstreamError('mapbox', 'invalid'));
    });

    it('badPath_anOutageIsUnavailable', async () => {
        const { upstream, mapbox } = world();
        upstream.fail('mapbox', 'unavailable');

        await expect(mapbox.retrieveToken(MAPBOX_TOKENS.bootstrap)).rejects.toMatchObject({ failure: 'unavailable', status: 503 });
    });
});

describe('listTokens', () => {
    it('happyPath_listsTheAccountsTokensWithoutTheirValues', async () => {
        const tokens = await world().mapbox.listTokens(USER, MAPBOX_TOKENS.bootstrap);

        expect(tokens.find((token) => token.id === BOOTSTRAP_ID)).toEqual({
            id: BOOTSTRAP_ID,
            usage: 'sk',
            note: 'historic-map-server',
            scopes: [
                'styles:read',
                'styles:tiles',
                'fonts:read',
                'tilesets:read',
                'tilesets:write',
                'tilesets:list',
                'tokens:read',
                'tokens:write',
            ],
        });
        expect(JSON.stringify(tokens)).not.toContain(MAPBOX_TOKENS.defaultPublic);
    });

    it('happyPath_followsTheNextPageOnMapboxOnly', async () => {
        const page = (body: unknown[], link?: string) => jsonResponse(body, 200, link === undefined ? {} : { link });
        const second = `${MAPBOX_API}/tokens/v2/${USER}?start=b&limit=100`;
        const upstream = createFakeFetch(
            routeTable([
                route('GET', `${MAPBOX_API}/tokens/v2/{user}`, 'mapbox.tokens.list', (request) =>
                    request.url.searchParams.get('start') === 'b'
                        ? page(
                              [{ id: 'b', usage: 'pk', note: 'two', scopes: ['styles:read'], allowedUrls: ['https://e2e.test'] }],
                              '<https://evil.e2e.test/x>; rel="next"',
                          )
                        : page(
                              [{ id: 'a', usage: 'sk' }, { usage: 'sk' }, { id: 'c', usage: 'zz' }],
                              `<${second}>; rel="next", <${MAPBOX_API}/x>; rel="last"`,
                          ),
                ),
            ]),
        );

        const tokens = await createMapboxApi({ fetch: upstream.fetch }).listTokens(USER, MAPBOX_TOKENS.bootstrap);

        expect(tokens).toEqual([
            { id: 'a', usage: 'sk', note: '', scopes: [] },
            { id: 'b', usage: 'pk', note: 'two', scopes: ['styles:read'], allowedUrls: ['https://e2e.test'] },
        ]);
        expect(upstream.calls.map((call) => new URL(call.url).searchParams.get('access_token'))).toEqual([
            MAPBOX_TOKENS.bootstrap,
            MAPBOX_TOKENS.bootstrap,
        ]);
    });

    it('happyPath_readsAtMostFivePages', async () => {
        const upstream = createFakeFetch(
            routeTable([
                route('GET', `${MAPBOX_API}/tokens/v2/{user}`, 'mapbox.tokens.list', () =>
                    jsonResponse([], 200, { link: `<${MAPBOX_API}/tokens/v2/${USER}?start=z>; rel="next"` }),
                ),
            ]),
        );

        await createMapboxApi({ fetch: upstream.fetch }).listTokens(USER, MAPBOX_TOKENS.bootstrap);

        expect(upstream.calls).toHaveLength(5);
    });

    it('badPath_aTokenWithoutTokensReadIsForbidden', async () => {
        const { upstream, mapbox } = world();
        upstream.fail('mapbox', 'forbidden');

        await expect(mapbox.listTokens(USER, MAPBOX_TOKENS.bootstrap)).rejects.toMatchObject({ failure: 'forbidden', status: 403 });
    });

    it('badPath_anAnswerThatIsNotAListIsInvalid', async () => {
        const mapbox = createMapboxApi({ fetch: () => Promise.resolve(jsonResponse({ message: 'odd' })) });

        await expect(mapbox.listTokens(USER, MAPBOX_TOKENS.bootstrap)).rejects.toEqual(new UpstreamError('mapbox', 'invalid'));
    });
});

describe('createToken and updateToken', () => {
    it('happyPath_mintsAUrlRestrictedPublicToken', async () => {
        const { upstream, mapbox } = world();

        const minted = await mapbox.createToken(USER, MAPBOX_TOKENS.bootstrap, PUBLIC_REQUEST);

        expect(minted).toEqual({ id: 'cle2e00minted0000000000001', token: 'pk.e2e-minted-token-0001' });
        expect(JSON.parse(String(upstream.callsTo('mapbox.tokens.create')[0]?.body))).toEqual(PUBLIC_REQUEST);
    });

    it('happyPath_mintsASecretTokenWithoutUrls', async () => {
        const { upstream, mapbox } = world();

        await expect(
            mapbox.createToken(USER, MAPBOX_TOKENS.bootstrap, { note: 'tiles', scopes: ['tilesets:read'] }),
        ).resolves.toMatchObject({
            token: 'sk.e2e-minted-token-0001',
        });
        expect(upstream.callsTo('mapbox.tokens.create')[0]?.body).toBe('{"note":"tiles","scopes":["tilesets:read"]}');
    });

    it('happyPath_updatesATokenInPlace', async () => {
        const { upstream, mapbox } = world();
        const minted = await mapbox.createToken(USER, MAPBOX_TOKENS.bootstrap, PUBLIC_REQUEST);

        const updated = await mapbox.updateToken(USER, MAPBOX_TOKENS.bootstrap, minted.id, {
            ...PUBLIC_REQUEST,
            allowedUrls: ['https://e2e.test'],
        });

        expect(updated).toEqual(minted);
        expect(upstream.callsTo('mapbox.tokens.update')[0]).toMatchObject({
            method: 'PATCH',
            url: expect.stringContaining(`/tokens/v2/${USER}/${minted.id}?`) as unknown,
        });
    });

    it('badPath_aDemoAccountMayNotCreateTokens', async () => {
        const mapbox = world().mapbox;

        await expect(mapbox.createToken('e2e-mapbox-trial', MAPBOX_TOKENS.trial, PUBLIC_REQUEST)).rejects.toMatchObject({
            failure: 'forbidden',
            status: 403,
        });
    });

    it('badPath_unconfirmedBillingDetailsRefuseTheToken', async () => {
        const mapbox = world().mapbox;

        await expect(mapbox.createToken('e2e-mapbox-billing', MAPBOX_TOKENS.billingPending, PUBLIC_REQUEST)).rejects.toMatchObject({
            failure: 'invalid',
            status: 422,
        });
    });

    it('badPath_anAnswerWithoutTheTokenIsInvalid', async () => {
        const mapbox = createMapboxApi({ fetch: () => Promise.resolve(jsonResponse({ id: 'x' }, 201)) });

        await expect(mapbox.createToken(USER, MAPBOX_TOKENS.bootstrap, PUBLIC_REQUEST)).rejects.toEqual(
            new UpstreamError('mapbox', 'invalid'),
        );
    });

    it('badPath_theRateLimitCarriesItsRetryAfter', async () => {
        const { upstream, mapbox } = world();
        upstream.fail('mapbox', 'rateLimited');

        await expect(mapbox.updateToken(USER, MAPBOX_TOKENS.bootstrap, 'x', PUBLIC_REQUEST)).rejects.toMatchObject({
            failure: 'rateLimited',
            retryAfterSeconds: 60,
        });
    });
});

describe('deleteToken', () => {
    it('happyPath_deletesAToken', async () => {
        const { upstream, mapbox } = world();
        const minted = await mapbox.createToken(USER, MAPBOX_TOKENS.bootstrap, PUBLIC_REQUEST);

        await mapbox.deleteToken(USER, MAPBOX_TOKENS.bootstrap, minted.id);

        expect(upstream.state.mapbox.accounts.get(USER)?.tokens.some((token) => token.id === minted.id)).toBe(false);
    });

    it('happyPath_deletingAMissingTokenIsNotAnError', async () => {
        await expect(world().mapbox.deleteToken(USER, MAPBOX_TOKENS.bootstrap, 'cle2e00gone')).resolves.toBeUndefined();
    });

    it('badPath_aRevokedBootstrapTokenCannotDelete', async () => {
        await expect(world().mapbox.deleteToken(USER, MAPBOX_TOKENS.revoked, 'x')).rejects.toMatchObject({ failure: 'unauthorized' });
    });
});
