/**
 * Mapbox's Uploads API adapter (`functions/src/adapters/mapbox-uploads.ts`, `docs/research/M7-local-worker.md` §6)
 * against a fake `fetch` answering the shared Mapbox fixtures: the temporary credentials, the streamed S3 `PUT` signed
 * with them (SigV4, unsigned payload, the session token), the upload and its status; and every failure as the
 * `UpstreamError('mapbox', …)` the publisher reads, never with the token or the credentials in it. The fake Mapbox of
 * the e2e worlds refuses the credentials to the tiles token Setup minted before M7 (no uploads scope).
 */
import { Readable } from 'node:stream';

import { FIXTURE_VALUES, fixtureBody, fixtureResponse } from '@hcm/test-support/api-fixtures';
import { MAPBOX_TOKENS, createFakeFetch, createUpstreamFakes, jsonResponse, route, routeTable, type Route } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { createMapboxUploads } from '../../src/adapters/mapbox-uploads.js';
import { UpstreamError } from '../../src/ports/errors.js';
import type { UploadCredentials } from '../../src/ports/mapbox-uploads.js';

const USER = String(FIXTURE_VALUES['mapboxUser']);
const TOKEN = 'sk.e2e-tiles-token';
const BASE = 'https://api.mapbox.com/uploads/v1';
const S3 = 'https://tilestream-tilesets-production.s3.amazonaws.com';
const NOW = new Date('2026-10-23T08:00:00.000Z');
const TILESET = `${USER}.hcm-bucharest-kh-4a-corona-1966`;
const VALUES = { tilesetId: TILESET, sourceId: 'hcm-bucharest-kh-4a-corona-1966', uploadId: 'cle2e00upload00000000000007' };

function adapter(routes: readonly Route[]) {
    const upstream = createFakeFetch(routeTable(routes));
    return { upstream, uploads: createMapboxUploads({ fetch: upstream.fetch, now: () => NOW }) };
}

function credentials(): UploadCredentials {
    return fixtureBody('mapbox/uploads.credentials.ok') as UploadCredentials;
}

function file(bytes: Uint8Array) {
    return {
        bytes: bytes.length,
        contentType: 'image/tiff',
        open: () => Promise.resolve(Readable.from([bytes.slice(0, 2), bytes.slice(2)])),
    };
}

function noSecretIn(error: unknown): void {
    const text = JSON.stringify(error) + String(error);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('e2e-secret-e2e-secret');
    expect(text).not.toContain('e2e-session-e2e-session');
}

describe('credentials', () => {
    it('happyPath_theTemporaryCredentialsOfTheStagingBucket', async () => {
        const { upstream, uploads } = adapter([
            route('POST', `${BASE}/{user}/credentials`, 'mapbox.uploads.credentials', () =>
                fixtureResponse('mapbox/uploads.credentials.ok'),
            ),
        ]);

        await expect(uploads.credentials(USER, TOKEN)).resolves.toEqual(credentials());
        expect(new URL(String(upstream.calls[0]?.url)).searchParams.get('access_token')).toBe(TOKEN);
    });

    it('badPath_anAnswerWithoutAFieldIsInvalid', async () => {
        const body = { ...credentials(), sessionToken: '' };
        const { uploads } = adapter([route('POST', `${BASE}/{user}/credentials`, 'mapbox.uploads.credentials', () => jsonResponse(body))]);

        await expect(uploads.credentials(USER, TOKEN)).rejects.toEqual(new UpstreamError('mapbox', 'invalid'));
    });

    it('badPath_theTilesTokenWithoutTheUploadsScopeIsForbidden @S-A64-BAD-NO-SCOPE', async () => {
        // The fake Mapbox of the e2e worlds: the tiles token holds only the tilesets scopes.
        const fakes = createUpstreamFakes();
        const uploads = createMapboxUploads({ fetch: fakes.fetch, now: () => NOW });

        const failure = await uploads.credentials(USER, MAPBOX_TOKENS.tiles).catch((error: unknown) => error);

        expect(failure).toMatchObject({ service: 'mapbox', failure: 'forbidden', status: 403 });
        expect(fakes.callsTo('mapbox.uploads.credentials')).toHaveLength(1);
    });
});

describe('the fake Mapbox with a token holding the uploads scopes', () => {
    it('happyPath_stageCreateAndPollUntilTheTilesAnswer', async () => {
        const fakes = createUpstreamFakes();
        const token = fakes.state.mapbox.accounts.get(USER)?.tokens.find((candidate) => candidate.value === MAPBOX_TOKENS.tiles);
        if (token !== undefined) {
            token.scopes = [...token.scopes, 'uploads:read', 'uploads:write'];
        }
        const uploads = createMapboxUploads({ fetch: fakes.fetch, now: () => NOW });

        const staged = await uploads.credentials(USER, MAPBOX_TOKENS.tiles);
        await uploads.stage(staged, file(new Uint8Array([1, 2, 3])));
        const created = await uploads.create(USER, MAPBOX_TOKENS.tiles, { tileset: TILESET, url: staged.url, name: VALUES.sourceId });
        const first = await uploads.status(USER, MAPBOX_TOKENS.tiles, created.id);
        const second = await uploads.status(USER, MAPBOX_TOKENS.tiles, created.id);

        expect([created.complete, first.complete, second.complete]).toEqual([false, false, true]);
        const tileJson = await fakes.fetch(`https://api.mapbox.com/v4/${TILESET}.json?access_token=${MAPBOX_TOKENS.tiles}`);
        expect(tileJson.status).toBe(200);
        // A PUT with another session's token, an unknown upload and an upload of a file never staged are refused.
        await expect(uploads.stage({ ...staged, sessionToken: 'another' }, file(new Uint8Array([1])))).rejects.toMatchObject({
            failure: 'forbidden',
        });
        await expect(uploads.status(USER, MAPBOX_TOKENS.tiles, 'cle2e00upload99999999999999')).rejects.toMatchObject({
            failure: 'notFound',
        });
        await expect(
            uploads.create(USER, MAPBOX_TOKENS.tiles, { tileset: TILESET, url: `${S3}/_pending/${USER}/never`, name: 'x' }),
        ).rejects.toMatchObject({
            failure: 'notFound',
        });
    });
});

describe('stage', () => {
    it('happyPath_theFileIsStreamedToS3SignedWithTheTemporaryCredentials', async () => {
        const bytes = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 1, 2, 3]);
        const { upstream, uploads } = adapter([
            route('PUT', `${S3}/_pending/{user}/{key}`, 'mapbox.uploads.stage', () => fixtureResponse('mapbox/uploads.stage.ok')),
        ]);

        await uploads.stage(credentials(), file(bytes));

        const call = upstream.calls[0];
        expect(call?.url).toBe(credentials().url);
        expect(call?.headers).toMatchObject({
            'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
            'x-amz-date': '20261023T080000Z',
            'x-amz-security-token': 'e2e-session-e2e-session',
            'content-type': 'image/tiff',
        });
        const authorization = String(call?.headers['authorization']);
        expect(authorization).toContain('AWS4-HMAC-SHA256 Credential=E2EUPLOADSACCESSKEYID/20261023/us-east-1/s3/aws4_request, ');
        expect(authorization).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token, ');
        expect(authorization).toMatch(/Signature=[0-9a-f]{64}$/);
        expect(call?.body).toHaveLength(bytes.length);
    });

    it('badPath_s3RefusingTheCredentialsIsForbidden', async () => {
        const { uploads } = adapter([
            route('PUT', `${S3}/_pending/{user}/{key}`, 'mapbox.uploads.stage', () => fixtureResponse('mapbox/uploads.stage.denied')),
        ]);

        const failure = await uploads.stage(credentials(), file(new Uint8Array([1]))).catch((error: unknown) => error);

        expect(failure).toMatchObject({ service: 'mapbox', failure: 'forbidden' });
        noSecretIn(failure);
    });

    it('badPath_aNetworkFailureIsUnavailable', async () => {
        const { uploads } = adapter([]);

        const failure = await uploads.stage(credentials(), file(new Uint8Array([1]))).catch((error: unknown) => error);

        expect(failure).toEqual(new UpstreamError('mapbox', 'unavailable'));
        noSecretIn(failure);
    });

    it('badPath_aStagingAddressInClearIsRefusedBeforeAnythingIsSent', async () => {
        const { upstream, uploads } = adapter([]);

        await expect(
            uploads.stage({ ...credentials(), url: 'http://tilestream.example/_pending/x' }, file(new Uint8Array([1]))),
        ).rejects.toEqual(new UpstreamError('mapbox', 'invalid'));
        expect(upstream.calls).toEqual([]);
    });
});

describe('create and status', () => {
    it('happyPath_theUploadIsCreatedAndPolledUntilComplete', async () => {
        const answers = ['mapbox/uploads.status.processing', 'mapbox/uploads.status.complete'] as const;
        const { upstream, uploads } = adapter([
            route('POST', `${BASE}/{user}`, 'mapbox.uploads.create', () => fixtureResponse('mapbox/uploads.create.ok', { values: VALUES })),
            route('GET', `${BASE}/{user}/{upload}`, 'mapbox.uploads.status', () =>
                fixtureResponse(answers[upstream.callsTo('mapbox.uploads.status').length] ?? 'mapbox/uploads.status.complete', {
                    values: VALUES,
                }),
            ),
        ]);
        const request = { tileset: TILESET, url: credentials().url, name: VALUES.sourceId };

        await expect(uploads.create(USER, TOKEN, request)).resolves.toEqual({ id: VALUES.uploadId, complete: false, progress: 0 });
        expect(JSON.parse(String(upstream.calls[0]?.body))).toEqual(request);
        await expect(uploads.status(USER, TOKEN, VALUES.uploadId)).resolves.toEqual({
            id: VALUES.uploadId,
            complete: false,
            progress: 0.5,
        });
        await expect(uploads.status(USER, TOKEN, VALUES.uploadId)).resolves.toEqual({ id: VALUES.uploadId, complete: true, progress: 1 });
        expect(new URL(String(upstream.calls[2]?.url)).pathname).toBe(`/uploads/v1/${USER}/${VALUES.uploadId}`);
    });

    it('badPath_anUploadThatEndedInAnErrorSaysWhy', async () => {
        const { uploads } = adapter([
            route('GET', `${BASE}/{user}/{upload}`, 'mapbox.uploads.status', () =>
                fixtureResponse('mapbox/uploads.status.error', { values: VALUES }),
            ),
        ]);

        await expect(uploads.status(USER, TOKEN, VALUES.uploadId)).resolves.toEqual({
            id: VALUES.uploadId,
            complete: false,
            progress: 0,
            error: 'Unknown error: the GeoTIFF could not be read',
        });
    });

    it('badPath_anMtsTilesetCannotBeReplacedByAnUpload', async () => {
        const { uploads } = adapter([
            route('POST', `${BASE}/{user}`, 'mapbox.uploads.create', () =>
                fixtureResponse('mapbox/uploads.create.mts-tileset', { values: VALUES }),
            ),
        ]);

        const failure = await uploads
            .create(USER, TOKEN, { tileset: TILESET, url: credentials().url, name: 'x' })
            .catch((error: unknown) => error);

        expect(failure).toMatchObject({ service: 'mapbox', failure: 'invalid', status: 422 });
        noSecretIn(failure);
    });

    it.each([
        ['no id', { complete: true }],
        ['a complete that is not a flag', { id: 'u1', complete: 'yes' }],
    ])('badPath_anUnreadableStatusIsInvalid_%s', async (_name, body) => {
        const { uploads } = adapter([route('GET', `${BASE}/{user}/{upload}`, 'mapbox.uploads.status', () => jsonResponse(body))]);

        await expect(uploads.status(USER, TOKEN, 'u1')).rejects.toEqual(new UpstreamError('mapbox', 'invalid'));
    });

    it('happyPath_aStatusWithoutProgressOrWithAnEmptyErrorIsStillProcessing', async () => {
        const { uploads } = adapter([
            route('GET', `${BASE}/{user}/{upload}`, 'mapbox.uploads.status', () => jsonResponse({ id: 'u1', complete: false, error: '' })),
        ]);

        await expect(uploads.status(USER, TOKEN, 'u1')).resolves.toEqual({ id: 'u1', complete: false, progress: 0 });
    });

    it('badPath_aRateLimitIsLeftToTheCaller', async () => {
        const { uploads } = adapter([
            route('GET', `${BASE}/{user}/{upload}`, 'mapbox.uploads.status', () => fixtureResponse('mapbox/error.rate-limited')),
        ]);

        const failure = await uploads.status(USER, TOKEN, 'u1').catch((error: unknown) => error);

        expect(failure).toMatchObject({ service: 'mapbox', failure: 'rateLimited' });
        noSecretIn(failure);
    });
});
