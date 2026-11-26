/**
 * The fake Mapbox, USGS M2M and Nominatim of `createUpstreamFakes()`: the token checks and mints of the Mapbox card,
 * the MTS publish flow, the USGS login and M2M approval, scene search and downloads, reverse geocoding.
 */
import { createUpstreamFakes, MAPBOX_TOKENS, USGS_CREDENTIALS, type UpstreamFakes } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

const TOKENS = 'https://api.mapbox.com/tokens/v2';
const M2M = 'https://m2m.cr.usgs.gov/api/api/json/stable';

async function call(
    fakes: UpstreamFakes,
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown; text: string }> {
    const response = await fakes.fetch(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    const json = response.headers.get('content-type')?.includes('json') === true && text !== '' ? (JSON.parse(text) as unknown) : undefined;
    return { status: response.status, body: json, text };
}

const sk = (token: string): string => `access_token=${token}`;

describe('Mapbox tokens', () => {
    it('happyPath_aSecretTokenIsValidListedAndMintsScopedTokens', async () => {
        const fakes = createUpstreamFakes();

        const retrieved = await call(fakes, 'GET', `${TOKENS}?${sk(MAPBOX_TOKENS.bootstrap)}`);
        const listed = await call(fakes, 'GET', `${TOKENS}/e2e-mapbox?${sk(MAPBOX_TOKENS.bootstrap)}`);
        const viewer = await call(fakes, 'POST', `${TOKENS}/e2e-mapbox?${sk(MAPBOX_TOKENS.bootstrap)}`, {
            note: 'bucharest viewer (auto)',
            scopes: ['styles:read', 'styles:tiles', 'fonts:read'],
            allowedUrls: ['https://ventura8.github.io'],
        });
        const tiles = await call(fakes, 'POST', `${TOKENS}/e2e-mapbox?${sk(MAPBOX_TOKENS.bootstrap)}`, {
            note: 'tiles',
            scopes: ['tilesets:read', 'tilesets:write', 'tilesets:list'],
        });

        expect(retrieved).toMatchObject({
            status: 200,
            body: { code: 'TokenValid', token: { usage: 'sk', user: 'e2e-mapbox', authorization: 'cle2e00token00000000000001' } },
        });
        expect(
            (listed.body as { id: string; scopes: string[]; token?: string }[]).find((token) => token.id === 'cle2e00token00000000000001'),
        ).not.toHaveProperty('token');
        expect(viewer).toMatchObject({
            status: 201,
            body: { usage: 'pk', token: 'pk.e2e-minted-token-0001', allowedUrls: ['https://ventura8.github.io'] },
        });
        expect(tiles).toMatchObject({ status: 201, body: { usage: 'sk', token: 'sk.e2e-minted-token-0002' } });
        expect(await call(fakes, 'GET', `${TOKENS}?access_token=pk.e2e-minted-token-0001`)).toMatchObject({
            body: { token: { usage: 'pk' } },
        });
        expect(fakes.callsTo('mapbox.tokens.create')).toHaveLength(2);
    });

    it('badPath_aPublicARevokedAndAShortScopedToken', async () => {
        const fakes = createUpstreamFakes();

        expect(await call(fakes, 'GET', `${TOKENS}?${sk(MAPBOX_TOKENS.defaultPublic)}`)).toMatchObject({
            body: { token: { usage: 'pk' } },
        });
        expect(await call(fakes, 'GET', `${TOKENS}?${sk(MAPBOX_TOKENS.revoked)}`)).toMatchObject({
            status: 401,
            body: { code: 'TokenInvalid' },
        });
        const listed = (await call(fakes, 'GET', `${TOKENS}/e2e-mapbox?${sk(MAPBOX_TOKENS.missingScopes)}`)).body as {
            id: string;
            scopes: string[];
        }[];
        expect(listed.find((token) => token.id === 'cle2e00token00000000000002')?.scopes).not.toContain('tokens:write');
        expect(
            (await call(fakes, 'POST', `${TOKENS}/e2e-mapbox?${sk(MAPBOX_TOKENS.missingScopes)}`, { scopes: ['styles:read'] })).status,
        ).toBe(403);
        expect((await call(fakes, 'GET', `${TOKENS}/e2e-mapbox-trial?${sk(MAPBOX_TOKENS.bootstrap)}`)).status).toBe(403);
        expect((await call(fakes, 'GET', `${TOKENS}/e2e-mapbox?${sk(MAPBOX_TOKENS.revoked)}`)).status).toBe(401);
        fakes.scenario('mapbox.bootstrapRevoked');
        expect((await call(fakes, 'GET', `${TOKENS}?${sk(MAPBOX_TOKENS.bootstrap)}`)).status).toBe(401);
    });

    it('badPath_aDemoAccountCannotMintUntilItIsUpgraded', async () => {
        const fakes = createUpstreamFakes();
        const mint = (token: string, user: string) =>
            call(fakes, 'POST', `${TOKENS}/${user}?${sk(token)}`, { scopes: ['styles:read'], note: 'viewer' });

        expect(await mint(MAPBOX_TOKENS.trial, 'e2e-mapbox-trial')).toMatchObject({
            status: 403,
            body: { message: expect.stringContaining('payment method') as unknown },
        });
        expect((await mint(MAPBOX_TOKENS.billingPending, 'e2e-mapbox-billing')).status).toBe(422);
        fakes.scenario('mapbox.upgraded');
        expect((await mint(MAPBOX_TOKENS.trial, 'e2e-mapbox-trial')).status).toBe(201);
    });

    it('badPath_aTokenCannotGrantWhatItLacksNorRestrictASecretToken', async () => {
        const fakes = createUpstreamFakes();
        const mint = (body: unknown) => call(fakes, 'POST', `${TOKENS}/e2e-mapbox?${sk(MAPBOX_TOKENS.bootstrap)}`, body);

        expect(await mint({ scopes: ['uploads:write'] })).toMatchObject({
            status: 400,
            body: { message: expect.stringContaining('uploads:write') as unknown },
        });
        expect((await mint({ scopes: ['tilesets:read'], allowedUrls: ['https://e2e.test'] })).status).toBe(400);
        expect((await mint({ scopes: [] })).status).toBe(400);
    });

    it('happyPath_aTokenIsUpdatedInPlaceAndDeleted', async () => {
        const fakes = createUpstreamFakes();
        const minted = (
            await call(fakes, 'POST', `${TOKENS}/e2e-mapbox?${sk(MAPBOX_TOKENS.bootstrap)}`, {
                scopes: ['styles:read'],
                allowedUrls: ['https://a.e2e.test'],
            })
        ).body as { id: string };

        const updated = await call(fakes, 'PATCH', `${TOKENS}/e2e-mapbox/${minted.id}?${sk(MAPBOX_TOKENS.bootstrap)}`, {
            allowedUrls: ['https://b.e2e.test'],
        });
        const deleted = await call(fakes, 'DELETE', `${TOKENS}/e2e-mapbox/${minted.id}?${sk(MAPBOX_TOKENS.bootstrap)}`);

        expect(updated).toMatchObject({
            status: 200,
            body: { id: minted.id, allowedUrls: ['https://b.e2e.test'], token: 'pk.e2e-minted-token-0001' },
        });
        expect(deleted.status).toBe(204);
        expect((await call(fakes, 'DELETE', `${TOKENS}/e2e-mapbox/${minted.id}?${sk(MAPBOX_TOKENS.bootstrap)}`)).status).toBe(404);
        expect((await call(fakes, 'PATCH', `${TOKENS}/e2e-mapbox/${minted.id}?${sk(MAPBOX_TOKENS.bootstrap)}`, {})).status).toBe(404);
        expect(
            (
                await call(fakes, 'PATCH', `${TOKENS}/e2e-mapbox/cle2e0000default0000000001?${sk(MAPBOX_TOKENS.bootstrap)}`, {
                    scopes: ['uploads:write'],
                })
            ).status,
        ).toBe(400);
    });

    it('badPath_anOutageAnswersEveryMapboxCall', async () => {
        const fakes = createUpstreamFakes();
        fakes.fail('mapbox', 'unavailable');

        expect(await call(fakes, 'GET', `${TOKENS}?${sk(MAPBOX_TOKENS.bootstrap)}`)).toMatchObject({
            status: 503,
            body: { message: 'Service Unavailable' },
        });
        fakes.fail('mapbox', 'rateLimited');
        const limited = await fakes.fetch(`${TOKENS}?${sk(MAPBOX_TOKENS.bootstrap)}`);
        expect([limited.status, limited.headers.get('retry-after')]).toEqual([429, '60']);
    });
});

describe('Mapbox tilesets and styles', () => {
    const TILESETS = 'https://api.mapbox.com/tilesets/v1';

    it('happyPath_aTilesetIsCreatedPublishedAndItsJobSucceeds', async () => {
        const fakes = createUpstreamFakes();
        const auth = sk(MAPBOX_TOKENS.bootstrap);

        expect((await call(fakes, 'POST', `${TILESETS}/sources/e2e-mapbox/e2e-1966?${auth}`, {})).body).toMatchObject({
            id: 'mapbox://tileset-source/e2e-mapbox/e2e-1966',
        });
        expect(
            (await call(fakes, 'POST', `${TILESETS}/e2e-mapbox.e2e-1966?${auth}`, { recipe: { version: 1 }, name: 'e2e 1966' })).status,
        ).toBe(200);
        const job = (await call(fakes, 'POST', `${TILESETS}/e2e-mapbox.e2e-1966/publish?${auth}`, {})).body as { jobId: string };
        const stages = [];
        for (let poll = 0; poll < 4; poll += 1) {
            stages.push(
                ((await call(fakes, 'GET', `${TILESETS}/e2e-mapbox.e2e-1966/jobs/${job.jobId}?${auth}`)).body as { stage: string }).stage,
            );
        }

        expect(stages).toEqual(['queued', 'processing', 'success', 'success']);
        expect(await call(fakes, 'GET', `${TILESETS}/e2e-mapbox?limit=1&${auth}`)).toMatchObject({
            body: [{ id: 'e2e-mapbox.e2e-1966', name: 'e2e 1966' }],
        });
        expect((await call(fakes, 'DELETE', `${TILESETS}/e2e-mapbox.e2e-1966?${auth}`)).status).toBe(204);
        expect((await call(fakes, 'DELETE', `${TILESETS}/e2e-mapbox.e2e-1966?${auth}`)).status).toBe(404);
    });

    it('badPath_aFailedJobAMissingTilesetAndAMissingScope', async () => {
        const fakes = createUpstreamFakes();
        const auth = sk(MAPBOX_TOKENS.bootstrap);
        fakes.scenario('mapbox.jobsFail');
        await call(fakes, 'POST', `${TILESETS}/e2e-mapbox.e2e-1966?${auth}`, { recipe: {}, name: 'x' });
        const job = (await call(fakes, 'POST', `${TILESETS}/e2e-mapbox.e2e-1966/publish?${auth}`, {})).body as { jobId: string };

        await call(fakes, 'GET', `${TILESETS}/e2e-mapbox.e2e-1966/jobs/${job.jobId}?${auth}`);
        await call(fakes, 'GET', `${TILESETS}/e2e-mapbox.e2e-1966/jobs/${job.jobId}?${auth}`);
        expect(await call(fakes, 'GET', `${TILESETS}/e2e-mapbox.e2e-1966/jobs/${job.jobId}?${auth}`)).toMatchObject({
            body: { stage: 'failed', errors: [expect.any(String)] as unknown },
        });
        expect((await call(fakes, 'POST', `${TILESETS}/e2e-mapbox.e2e-1966?${auth}`, { recipe: {}, name: 'x' })).status).toBe(400);
        expect((await call(fakes, 'POST', `${TILESETS}/e2e-mapbox.other?${auth}`, { name: 'no recipe' })).status).toBe(400);
        expect((await call(fakes, 'POST', `${TILESETS}/e2e-mapbox.missing/publish?${auth}`, {})).status).toBe(404);
        expect((await call(fakes, 'GET', `${TILESETS}/e2e-mapbox.e2e-1966/jobs/unknown?${auth}`)).status).toBe(404);
        expect((await call(fakes, 'GET', `https://api.mapbox.com/styles/v1/e2e-mapbox?${auth}`)).status).toBe(403);
    });

    it('happyPath_stylesWithAScopedToken', async () => {
        const fakes = createUpstreamFakes();
        const minted = (await call(fakes, 'POST', `${TOKENS}/e2e-mapbox?${sk(MAPBOX_TOKENS.bootstrap)}`, { scopes: ['styles:read'] }))
            .body as { token: string };
        fakes.state.mapbox.accounts.get('e2e-mapbox')?.tokens.push({
            id: 'styles',
            usage: 'sk',
            note: 'styles',
            scopes: ['styles:list', 'styles:write'],
            allowedUrls: undefined,
            value: 'sk.e2e-styles-token-0001',
            isDefault: false,
        });

        expect(await call(fakes, 'GET', 'https://api.mapbox.com/styles/v1/e2e-mapbox?access_token=sk.e2e-styles-token-0001')).toEqual(
            expect.objectContaining({ status: 200, body: [] }),
        );
        expect(
            await call(fakes, 'POST', 'https://api.mapbox.com/styles/v1/e2e-mapbox?access_token=sk.e2e-styles-token-0001', {
                name: 'City',
            }),
        ).toMatchObject({ body: { name: 'City', owner: 'e2e-mapbox' } });
        expect(minted.token).toMatch(/^pk\./);
    });
});

describe('USGS M2M', () => {
    const login = (fakes: UpstreamFakes, credentials: { username: string; applicationToken: string }) =>
        call(fakes, 'POST', `${M2M}/login-token`, { username: credentials.username, token: credentials.applicationToken });

    it('happyPath_anApprovedUserLogsInHoldsDownloadAndLogsOut', async () => {
        const fakes = createUpstreamFakes();

        const apiKey = ((await login(fakes, USGS_CREDENTIALS.approved)).body as { data: string }).data;
        const permissions = await call(fakes, 'POST', `${M2M}/permissions`, {}, { 'X-Auth-Token': apiKey });
        await call(fakes, 'POST', `${M2M}/logout`, {}, { 'X-Auth-Token': apiKey });

        expect(apiKey).toMatch(/^e2e-usgs-api-key-\d{4}$/);
        expect(permissions).toMatchObject({ status: 200, body: { data: ['user', 'download', 'order'], errorCode: null } });
        expect(await call(fakes, 'POST', `${M2M}/permissions`, {}, { 'X-Auth-Token': apiKey })).toMatchObject({
            status: 500,
            body: { errorCode: 'AUTH_KEY_INVALID' },
        });
    });

    it('badPath_pendingUntilTheScenarioApprovesTheM2mAccess', async () => {
        const fakes = createUpstreamFakes();
        const apiKey = ((await login(fakes, USGS_CREDENTIALS.pending)).body as { data: string }).data;
        const permissions = () => call(fakes, 'POST', `${M2M}/permissions`, {}, { 'X-Auth-Token': apiKey });

        expect(await permissions()).toMatchObject({ body: { data: ['user'] } });
        expect(await call(fakes, 'POST', `${M2M}/download-request`, { downloads: [] }, { 'X-Auth-Token': apiKey })).toMatchObject({
            status: 500,
            body: { errorCode: 'AUTH_UNAUTHROIZED' },
        });
        fakes.scenario('usgs.m2mApproved');
        expect(await permissions()).toMatchObject({ body: { data: ['user', 'download', 'order'] } });
    });

    it('badPath_anAccountWithoutM2mAccessCannotLogInUntilApproved', async () => {
        const fakes = createUpstreamFakes();

        const refused = await login(fakes, USGS_CREDENTIALS.noAccess);
        fakes.scenario('usgs.m2mApproved');

        expect(refused).toMatchObject({ status: 500, body: { errorCode: 'AUTH_UNAUTHROIZED', data: null } });
        expect((await login(fakes, USGS_CREDENTIALS.noAccess)).status).toBe(200);
    });

    it('badPath_wrongCredentialsAnExpiredTokenMaintenanceAndRateLimit', async () => {
        const fakes = createUpstreamFakes();

        expect(await login(fakes, USGS_CREDENTIALS.unknown)).toMatchObject({ status: 500, body: { errorCode: 'AUTH_INVALID' } });
        expect(await login(fakes, { username: USGS_CREDENTIALS.approved.username, applicationToken: 'wrong' })).toMatchObject({
            status: 500,
        });
        const expired = await login(fakes, USGS_CREDENTIALS.expired);
        expect([expired.status, expired.text]).toEqual([403, expect.stringContaining('Forbidden')]);
        fakes.fail('usgs', 'maintenance');
        const offline = await login(fakes, USGS_CREDENTIALS.approved);
        expect([offline.status, offline.text]).toEqual([503, expect.stringContaining('Application Offline')]);
        fakes.fail('usgs', 'rateLimited');
        expect(await login(fakes, USGS_CREDENTIALS.approved)).toMatchObject({ status: 429, body: { errorCode: 'RATE_LIMIT' } });
        fakes.fail('usgs', null);
        fakes.scenario('usgs.tokenExpired');
        expect((await login(fakes, USGS_CREDENTIALS.approved)).status).toBe(403);
    });

    it('happyPath_scenesAreFoundAndAScannedOneDownloads', async () => {
        const fakes = createUpstreamFakes();
        const apiKey = ((await login(fakes, USGS_CREDENTIALS.approved)).body as { data: string }).data;
        const keyed = (endpoint: string, body: unknown) => call(fakes, 'POST', `${M2M}/${endpoint}`, body, { 'X-Auth-Token': apiKey });

        expect(await keyed('dataset-search', { datasetName: 'declass' })).toMatchObject({
            body: { data: [{ datasetAlias: 'corona2' }, { datasetAlias: 'declassii' }] },
        });
        expect(await keyed('scene-search', { datasetName: 'corona2' })).toMatchObject({ body: { data: { totalHits: 3 } } });
        expect(await keyed('scene-search', { datasetName: 'other' })).toMatchObject({ body: { data: { totalHits: 0 } } });
        const options = (await keyed('download-options', { datasetName: 'corona2', entityIds: ['DS1105-1071DF075', 'DS1105-1071DF076'] }))
            .body as { data: { entityId: string; available: boolean }[] };
        expect(options.data.map((option) => [option.entityId, option.available])).toEqual([
            ['DS1105-1071DF075', true],
            ['DS1105-1071DF076', false],
        ]);
        const requested = (await keyed('download-request', { downloads: [{ entityId: 'DS1105-1071DF075' }], label: 'e2e' })).body as {
            data: { availableDownloads: { url: string }[] };
        };
        const url = String(requested.data.availableDownloads[0]?.url);
        const retrieved = (await keyed('download-retrieve', { label: 'e2e' })).body as { data: { available: { url: string }[] } };
        expect(new URL(String(retrieved.data.available[0]?.url)).pathname).toBe(new URL(url).pathname);
        expect((await call(fakes, 'GET', url)).text).toBe('E2E-SCAN-300000001');
        expect(await call(fakes, 'POST', `${M2M}/scene-search`, {}, { 'X-Auth-Token': 'unknown' })).toMatchObject({
            body: { errorCode: 'AUTH_KEY_INVALID' },
        });
        expect(fakes.snapshot()['usgs']).toMatchObject({ sessions: 1 });
    });

    it('badPath_aGatewayFailureIsNotTheMaintenancePage', async () => {
        const fakes = createUpstreamFakes();
        fakes.fail('usgs', 'unavailable');

        const failed = await login(fakes, USGS_CREDENTIALS.approved);

        expect([failed.status, failed.text]).toEqual([502, expect.stringContaining('Bad Gateway')]);
    });
});

describe('Nominatim', () => {
    const reverse = (fakes: UpstreamFakes, query: string) =>
        call(fakes, 'GET', `https://nominatim.openstreetmap.org/reverse?format=jsonv2&${query}`);

    it('happyPath_aPointInBucharestHasAnAddress', async () => {
        const fakes = createUpstreamFakes();

        expect(await reverse(fakes, 'lat=44.4355&lon=26.0974')).toMatchObject({
            status: 200,
            body: { display_name: expect.stringContaining('București') as unknown, lat: '44.4355', lon: '26.0974' },
        });
    });

    it('badPath_theSeaAMissingPointAndAnOutage', async () => {
        const fakes = createUpstreamFakes();

        expect(await reverse(fakes, 'lat=43.0&lon=31.0')).toEqual({
            status: 200,
            body: { error: 'Unable to geocode' },
            text: '{"error":"Unable to geocode"}',
        });
        expect((await reverse(fakes, 'lat=&lon=26')).status).toBe(400);
        fakes.fail('nominatim', 'rateLimited');
        expect((await reverse(fakes, 'lat=44.4&lon=26.1')).status).toBe(429);
        fakes.fail('nominatim', 'unavailable');
        expect((await reverse(fakes, 'lat=44.4&lon=26.1')).status).toBe(503);
    });
});
