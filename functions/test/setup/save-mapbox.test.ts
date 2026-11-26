/**
 * `setup.saveMapbox` (M2-interfaces §3.3, onboarding review §2B; scenarios A05, A06) against the fake Mapbox and Secret
 * Manager: the pasted secret token is checked upstream, the public tokens are minted URL-restricted (or updated in
 * place), the tiles token minted once, and nothing is stored when Mapbox refuses. The secret never reaches a response,
 * a document or a log line.
 */
import { FIRESTORE_PATHS, MAPBOX_BOOTSTRAP_SCOPES, cityDocSchema, type ApiErrorCode } from '@hcm/shared';
import { jsonResponse, MAPBOX_TOKENS } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../src/api/api-error.js';
import { saveMapbox } from '../../src/setup/save-mapbox.js';
import { ADMIN, ADMIN_ORIGINS, CITY, VIEWER_ORIGINS, createWorld, rejection, type World } from './world.js';

const USER = 'e2e-mapbox';

function save(world: World, secretToken: string = MAPBOX_TOKENS.bootstrap, cityId = CITY) {
    return saveMapbox(world.deps, ADMIN, { cityId, secretToken });
}

function tokensOf(world: World, user = USER) {
    return world.upstream.state.mapbox.accounts.get(user)?.tokens ?? [];
}

function city(world: World) {
    return cityDocSchema.parse(world.documents.peek(FIRESTORE_PATHS.city(CITY)));
}

/** Answers the Mapbox calls `matches` picks with `answer`. */
function breaking(world: World, matches: (method: string, url: URL) => boolean, answer: () => Response): void {
    world.intercept = (method, url) => (url.hostname === 'api.mapbox.com' && matches(method, url) ? answer() : undefined);
}

async function failure(promise: Promise<unknown>): Promise<{ readonly code: ApiErrorCode; readonly params: unknown }> {
    const error = await rejection(promise);
    if (!(error instanceof ApiError)) {
        throw error;
    }
    return { code: error.code, params: error.params };
}

describe('setup.saveMapbox', () => {
    it('happyPath_validatesTheTokenMintsThePublicTokensAndStoresTheSecret', async () => {
        const world = createWorld();

        const response = await save(world);

        const minted = tokensOf(world).filter((token) => token.note.startsWith('historic-city-map demo-hcm'));
        const viewer = minted.find((token) => token.note === `historic-city-map demo-hcm viewer ${CITY} (auto)`);
        const admin = minted.find((token) => token.note === 'historic-city-map demo-hcm admin (auto)');
        const tiles = minted.find((token) => token.note === 'historic-city-map demo-hcm tiles (auto)');
        expect([viewer?.usage, viewer?.allowedUrls, viewer?.scopes]).toEqual([
            'pk',
            VIEWER_ORIGINS,
            ['styles:read', 'styles:tiles', 'fonts:read'],
        ]);
        expect([admin?.usage, admin?.allowedUrls, tiles?.usage, tiles?.allowedUrls, tiles?.scopes]).toEqual([
            'pk',
            ADMIN_ORIGINS,
            'sk',
            undefined,
            ['tilesets:read', 'tilesets:write', 'tilesets:list'],
        ]);
        expect(response).toEqual({
            mapbox: {
                state: 'ok',
                checkedAt: '2026-10-11T08:30:00.000Z',
                user: USER,
                scopes: [...MAPBOX_BOOTSTRAP_SCOPES],
                adminToken: admin?.value,
                adminAllowedUrls: ADMIN_ORIGINS,
            },
            viewer: { tokenId: viewer?.id, allowedUrls: VIEWER_ORIGINS },
            admin: { tokenId: admin?.id, allowedUrls: ADMIN_ORIGINS },
        });
        expect(city(world).mapbox).toEqual({
            user: USER,
            publicToken: viewer?.value,
            publicTokenId: viewer?.id,
            allowedUrls: VIEWER_ORIGINS,
        });
        expect(world.status()).toMatchObject({
            mapbox: { state: 'ok', user: USER, tilesTokenId: tiles?.id, adminTokenId: admin?.id },
            secretsRev: 1,
            updatedBy: ADMIN.uid,
        });
        expect([world.upstream.secretValue('mapbox-sk-bootstrap'), world.upstream.secretValue('mapbox-sk-tiles')]).toEqual([
            MAPBOX_TOKENS.bootstrap,
            tiles?.value,
        ]);
        const everything =
            JSON.stringify([
                response,
                world.documents.peek(FIRESTORE_PATHS.setupStatus),
                world.documents.peek(FIRESTORE_PATHS.city(CITY)),
            ]) + world.logged();
        expect(everything).not.toContain(MAPBOX_TOKENS.bootstrap);
        expect(everything).not.toContain(String(tiles?.value));
    });

    it('badPath_savingAgainUpdatesTheSameTokens @S-A06-BAD-SAVED-TWICE', async () => {
        const world = createWorld();
        const first = await save(world);
        const count = tokensOf(world).length;

        const second = await save(world);

        expect(tokensOf(world)).toHaveLength(count);
        expect([second.viewer.tokenId, second.admin.tokenId]).toEqual([first.viewer.tokenId, first.admin.tokenId]);
        expect(world.upstream.callsTo('mapbox.tokens.update')).toHaveLength(2);
        expect(world.upstream.callsTo('mapbox.tokens.create')).toHaveLength(3);
        expect(world.status()?.secretsRev).toBe(2);
    });

    it('happyPath_aSaveThatStoppedHalfWayIsFinishedWithoutExtraTokens', async () => {
        const world = createWorld();
        world.upstream.fail('secret-manager', 'unavailable');
        await expect(failure(save(world))).resolves.toMatchObject({ code: 'apiError.unavailable' });
        const halfWay = tokensOf(world).length;
        world.upstream.fail('secret-manager', null);

        await save(world);

        expect(tokensOf(world)).toHaveLength(halfWay);
        expect(world.upstream.callsTo('mapbox.tokens.delete')).toHaveLength(1);
        expect(world.status()?.mapbox?.state).toBe('ok');
    });

    it('happyPath_theRetiringTokensOfARotationAreKept', async () => {
        const world = createWorld();
        await save(world);
        const status = world.status();
        const retiring = [{ tokenId: 'cle2e00old', retireAt: { seconds: 1, nanoseconds: 0 } }];
        world.documents.seed(FIRESTORE_PATHS.setupStatus, { ...status, mapbox: { ...status?.mapbox, retiring } });

        await save(world);

        expect(world.status()?.mapbox?.retiring).toEqual(retiring);
    });

    it.each([
        ['a public token', MAPBOX_TOKENS.defaultPublic, 'apiError.mapbox.publicToken'],
        ['anything else', 'not-a-mapbox-token', 'apiError.mapbox.tokenFormat'],
    ])('badPath_%s_isExplainedBeforeAnyCall', async (_label, token, code) => {
        const world = createWorld();

        await expect(failure(save(world, token))).resolves.toEqual({ code, params: undefined });
        expect(world.upstream.calls).toEqual([]);
        expect(world.status()).toBeUndefined();
    });
});

describe('setup.saveMapbox refusals', () => {
    it('badPath_anUnknownCityIsNotFoundBeforeAnyCall', async () => {
        const world = createWorld({ city: false });

        await expect(failure(save(world))).resolves.toMatchObject({ code: 'apiError.notFound' });
        expect(world.upstream.calls).toEqual([]);
    });

    it('badPath_aRevokedTokenIsReportedAndTheChipTurnsInvalid', async () => {
        const world = createWorld();

        await expect(failure(save(world, MAPBOX_TOKENS.revoked))).resolves.toMatchObject({ code: 'apiError.mapbox.tokenInvalid' });
        expect(world.status()?.mapbox).toEqual({
            state: 'invalid',
            detail: 'apiError.mapbox.tokenInvalid',
            checkedAt: { seconds: 1791707400, nanoseconds: 0 },
        });
        expect(world.upstream.secretValue('mapbox-sk-bootstrap')).toBeUndefined();
    });

    it('badPath_aBadPasteNeverHidesAWorkingConnection', async () => {
        const world = createWorld();
        await save(world);

        await expect(failure(save(world, MAPBOX_TOKENS.revoked))).resolves.toMatchObject({ code: 'apiError.mapbox.tokenInvalid' });

        expect(world.status()?.mapbox?.state).toBe('ok');
        expect(world.upstream.secretValue('mapbox-sk-bootstrap')).toBe(MAPBOX_TOKENS.bootstrap);
    });

    it('badPath_aFailureAfterAFailureReplacesTheReason', async () => {
        const world = createWorld();
        await failure(save(world, MAPBOX_TOKENS.missingScopes));

        await failure(save(world, MAPBOX_TOKENS.revoked));

        expect(world.status()?.mapbox).toEqual({
            state: 'invalid',
            detail: 'apiError.mapbox.tokenInvalid',
            checkedAt: { seconds: 1791707400, nanoseconds: 0 },
        });
    });

    it('badPath_missingScopesAreListedByNameAndNothingIsStored', async () => {
        const world = createWorld();

        await expect(failure(save(world, MAPBOX_TOKENS.missingScopes))).resolves.toEqual({
            code: 'apiError.mapbox.missingScopes',
            params: { scopes: 'tilesets:write, tokens:write' },
        });
        expect(world.upstream.callsTo('mapbox.tokens.create')).toEqual([]);
        expect(world.upstream.secretValue('mapbox-sk-bootstrap')).toBeUndefined();
        expect(world.status()?.mapbox).toMatchObject({ state: 'invalid', params: { scopes: 'tilesets:write, tokens:write' } });
    });

    it.each([
        ['a demo account (403)', MAPBOX_TOKENS.trial, 'e2e-mapbox-trial'],
        ['unconfirmed billing details (422)', MAPBOX_TOKENS.billingPending, 'e2e-mapbox-billing'],
    ])('badPath_%s_refusesTheMintAndStoresNothing', async (_label, token, user) => {
        const world = createWorld();
        const before = tokensOf(world, user).length;

        await expect(failure(save(world, token))).resolves.toMatchObject({ code: 'apiError.mapbox.mintRefused' });
        expect(tokensOf(world, user)).toHaveLength(before);
        expect(world.upstream.secretValue('mapbox-sk-bootstrap')).toBeUndefined();
        expect(city(world).mapbox).toBeUndefined();
    });

    it('badPath_aMapboxOutageOffersRetryAndHalfSavesNothing', async () => {
        const world = createWorld();
        world.upstream.fail('mapbox', 'unavailable');

        await expect(failure(save(world))).resolves.toMatchObject({ code: 'apiError.mapbox.unavailable' });
        expect(world.status()?.mapbox).toMatchObject({ state: 'unavailable', detail: 'apiError.mapbox.unavailable' });
        expect(world.upstream.secretValue('mapbox-sk-bootstrap')).toBeUndefined();
    });

    it('badPath_secretsThatCannotBeSavedAreReported', async () => {
        const world = createWorld({ provisioned: false });

        await expect(failure(save(world))).resolves.toMatchObject({ code: 'apiError.secrets.unavailable' });
        expect(world.status()?.mapbox).toMatchObject({ state: 'invalid', detail: 'apiError.secrets.unavailable' });
    });
});

describe('setup.saveMapbox odd answers', () => {
    it('badPath_aSecretTokenThatMapboxCallsPublicIsRefused', async () => {
        const world = createWorld();
        breaking(
            world,
            (method, url) => method === 'GET' && url.pathname === '/tokens/v2',
            () => jsonResponse({ code: 'TokenValid', token: { usage: 'pk', user: USER, authorization: 'x' } }),
        );

        await expect(failure(save(world))).resolves.toMatchObject({ code: 'apiError.mapbox.tokenFormat' });
    });

    it('badPath_aTokenThatCannotReadTheTokenListLacksTokensRead', async () => {
        const world = createWorld();
        breaking(
            world,
            (method, url) => method === 'GET' && url.pathname === `/tokens/v2/${USER}`,
            () => jsonResponse({ message: 'Forbidden' }, 403),
        );

        await expect(failure(save(world))).resolves.toEqual({ code: 'apiError.mapbox.missingScopes', params: { scopes: 'tokens:read' } });
    });

    it('badPath_aTokenMissingFromItsOwnListAsksForARetry', async () => {
        const world = createWorld();
        breaking(
            world,
            (method, url) => method === 'GET' && url.pathname === `/tokens/v2/${USER}`,
            () => jsonResponse([]),
        );

        await expect(failure(save(world))).resolves.toMatchObject({ code: 'apiError.mapbox.unavailable' });
        expect(world.records.some((record) => record.message === 'the pasted mapbox token is not in its account token list yet')).toBe(
            true,
        );
    });

    it('badPath_aLeftoverTokenThatCannotBeDeletedIsLoggedAndTheSaveSucceeds', async () => {
        const world = createWorld();
        world.upstream.fail('secret-manager', 'unavailable');
        await failure(save(world));
        world.upstream.fail('secret-manager', null);
        breaking(
            world,
            (method) => method === 'DELETE',
            () => jsonResponse({ message: 'Service Unavailable' }, 503),
        );

        await expect(save(world)).resolves.toMatchObject({ mapbox: { state: 'ok' } });
        expect(world.records.filter((record) => record.message === 'a leftover mapbox tiles token was not deleted')).toHaveLength(1);
    });

    it('badPath_aFailureThatCannotBeRecordedStillReachesTheAdmin', async () => {
        const world = createWorld();
        world.documents.recorder.failNext('transaction', new Error('firestore is down'));

        await expect(failure(save(world, MAPBOX_TOKENS.revoked))).resolves.toMatchObject({ code: 'apiError.mapbox.tokenInvalid' });
        expect(world.records.at(-1)).toMatchObject({
            level: 'warn',
            message: 'the failed setup attempt was not recorded',
            data: { area: 'mapbox', error: 'Error: firestore is down' },
        });
    });

    it('badPath_anUnexpectedErrorIsNotRecorded', async () => {
        const world = createWorld();
        world.documents.seed(FIRESTORE_PATHS.setupStatus, { mapbox: { state: 'nonsense' } });

        const error = await rejection(save(world));

        expect(error).toMatchObject({ name: 'InvalidDocumentError', path: 'setup/status' });
        expect(world.documents.peek(FIRESTORE_PATHS.setupStatus)).toEqual({ mapbox: { state: 'nonsense' } });
    });
});
