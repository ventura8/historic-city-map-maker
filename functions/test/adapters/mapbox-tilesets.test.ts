/**
 * The Mapbox Tilesets adapter (`functions/src/adapters/mapbox-tilesets.ts`, CR-M3-4) against a fake `fetch` answering
 * the shared Mapbox fixtures: the account's tilesets, a source replaced by streaming a file as multipart, a tileset
 * created with its recipe or its recipe replaced, a publish and its job polled, the TileJSON, and deletions that accept
 * a missing tileset or source. The token only travels as `access_token` and never reaches an error.
 */
import { Readable } from 'node:stream';

import { FIXTURE_VALUES, fixtureBody, fixtureResponse } from '@hcm/test-support/api-fixtures';
import { createFakeFetch, jsonResponse, route, routeTable, type Route } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { MAPBOX_API, createMapboxTilesets } from '../../src/adapters/mapbox-tilesets.js';
import { UpstreamError } from '../../src/ports/errors.js';

const USER = String(FIXTURE_VALUES['mapboxUser']);
const TOKEN = 'sk.e2e-tiles-token';
const TILESET = `${USER}.hcm-bucharest-kh-4a-corona-1966`;
const SOURCE = 'hcm-bucharest-kh-4a-corona-1966';
const BASE = `${MAPBOX_API}/tilesets/v1`;
const VALUES = { tilesetId: TILESET, jobId: 'cle2e00job0000000000000001', mapboxUser: USER, sourceId: SOURCE };

function adapter(routes: readonly Route[]) {
    const upstream = createFakeFetch(routeTable(routes));
    return { upstream, tilesets: createMapboxTilesets({ fetch: upstream.fetch }) };
}

function file(bytes: Uint8Array) {
    return {
        bytes: bytes.length,
        contentType: 'image/tiff',
        open: () => Promise.resolve(Readable.from([bytes.slice(0, 3), bytes.slice(3)])),
    };
}

describe('listTilesets', () => {
    it('happyPath_listsTheAccountsTilesets', async () => {
        const { upstream, tilesets } = adapter([
            route('GET', `${BASE}/{user}`, 'mapbox.tilesets.list', () =>
                jsonResponse([
                    ...(fixtureBody('mapbox/tilesets.list.one', VALUES) as unknown[]),
                    { id: `${USER}.unnamed` },
                    { name: 'no id' },
                ]),
            ),
        ]);

        await expect(tilesets.listTilesets(USER, TOKEN, 100)).resolves.toEqual([
            { id: TILESET, name: 'e2e-1966', created: '2026-10-12T08:30:00.000Z' },
            { id: `${USER}.unnamed` },
        ]);
        expect(new URL(String(upstream.calls[0]?.url)).searchParams.get('limit')).toBe('100');
    });

    it('badPath_anAnswerThatIsNotAListIsInvalid', async () => {
        const { tilesets } = adapter([route('GET', `${BASE}/{user}`, 'mapbox.tilesets.list', () => jsonResponse({ message: 'x' }))]);

        await expect(tilesets.listTilesets(USER, TOKEN, 1)).rejects.toEqual(new UpstreamError('mapbox', 'invalid'));
    });

    it('badPath_aMissingScopeIsForbidden', async () => {
        const { tilesets } = adapter([
            route('GET', `${BASE}/{user}`, 'mapbox.tilesets.list', () => fixtureResponse('mapbox/error.forbidden')),
        ]);

        await expect(tilesets.listTilesets(USER, TOKEN, 1)).rejects.toMatchObject({ failure: 'forbidden' });
    });
});

describe('uploadSource', () => {
    it('happyPath_theSourceIsReplacedByTheStreamedFile', async () => {
        const bytes = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 1, 2, 3]);
        const { upstream, tilesets } = adapter([
            route('DELETE', `${BASE}/sources/{user}/{source}`, 'mapbox.tilesets.sources.delete', () => new Response(null, { status: 204 })),
            route('POST', `${BASE}/sources/{user}/{source}`, 'mapbox.tilesets.sources.create', () =>
                fixtureResponse('mapbox/tilesets.source.created', { values: VALUES, merge: { file_size: 7 } }),
            ),
        ]);

        await expect(tilesets.uploadSource(USER, TOKEN, SOURCE, file(bytes))).resolves.toEqual({ bytes: 7 });

        const upload = upstream.calls[1];
        expect(upstream.calls.map((call) => call.operation)).toEqual(['mapbox.tilesets.sources.delete', 'mapbox.tilesets.sources.create']);
        expect(upload?.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
        expect(upload?.body).toContain('Content-Disposition: form-data; name="file"; filename="source.tif"');
        expect(upload?.body).toContain('II*\u0000\u0001\u0002\u0003');
        expect(new URL(String(upload?.url)).searchParams.get('access_token')).toBe(TOKEN);
    });

    it('happyPath_aFirstUploadFindsNoSourceToDeleteAndMapboxNamesNoSize', async () => {
        const { tilesets } = adapter([
            route('DELETE', `${BASE}/sources/{user}/{source}`, 'mapbox.tilesets.sources.delete', () =>
                fixtureResponse('mapbox/error.not-found'),
            ),
            route('POST', `${BASE}/sources/{user}/{source}`, 'mapbox.tilesets.sources.create', () => jsonResponse({ id: 'x' })),
        ]);

        await expect(tilesets.uploadSource(USER, TOKEN, SOURCE, file(new Uint8Array(5)))).resolves.toEqual({ bytes: 5 });
    });

    it('badPath_aSourceTooLargeKeepsItsStatus', async () => {
        const { tilesets } = adapter([
            route('DELETE', `${BASE}/sources/{user}/{source}`, 'mapbox.tilesets.sources.delete', () => new Response(null, { status: 204 })),
            route('POST', `${BASE}/sources/{user}/{source}`, 'mapbox.tilesets.sources.create', () =>
                jsonResponse({ message: 'too large' }, 413),
            ),
        ]);

        await expect(tilesets.uploadSource(USER, TOKEN, SOURCE, file(new Uint8Array(5)))).rejects.toMatchObject({
            failure: 'invalid',
            status: 413,
        });
    });

    it('badPath_aConnectionThatDropsIsUnavailableWithoutTheToken', async () => {
        const { tilesets } = adapter([
            route('DELETE', `${BASE}/sources/{user}/{source}`, 'mapbox.tilesets.sources.delete', () => new Response(null, { status: 204 })),
        ]);

        const failure = await tilesets.uploadSource(USER, TOKEN, SOURCE, file(new Uint8Array(5))).catch((error: unknown) => error);

        expect(failure).toEqual(new UpstreamError('mapbox', 'unavailable'));
        expect(String(failure)).not.toContain(TOKEN);
    });

    it('badPath_aRefusedDeleteStopsTheUpload', async () => {
        const { upstream, tilesets } = adapter([
            route('DELETE', `${BASE}/sources/{user}/{source}`, 'mapbox.tilesets.sources.delete', () =>
                fixtureResponse('mapbox/error.unauthorized'),
            ),
        ]);

        await expect(tilesets.uploadSource(USER, TOKEN, SOURCE, file(new Uint8Array(5)))).rejects.toMatchObject({
            failure: 'unauthorized',
        });
        expect(upstream.calls).toHaveLength(1);
    });
});

describe('upsertTileset', () => {
    const request = { name: SOURCE, recipe: { version: 1, type: 'raster', minzoom: 10, maxzoom: 16 } };

    it('happyPath_aNewTilesetIsCreatedWithItsRecipe', async () => {
        const { upstream, tilesets } = adapter([
            route('POST', `${BASE}/{tileset}`, 'mapbox.tilesets.create', () =>
                fixtureResponse('mapbox/tilesets.create.ok', { values: VALUES }),
            ),
        ]);

        await expect(tilesets.upsertTileset(TOKEN, TILESET, request)).resolves.toBe('created');
        expect(JSON.parse(String(upstream.calls[0]?.body))).toEqual(request);
    });

    it('happyPath_anExistingTilesetGetsItsRecipeReplaced', async () => {
        const { upstream, tilesets } = adapter([
            route('POST', `${BASE}/{tileset}`, 'mapbox.tilesets.create', () =>
                fixtureResponse('mapbox/tilesets.create.exists', { values: VALUES }),
            ),
            route('PATCH', `${BASE}/{tileset}/recipe`, 'mapbox.tilesets.recipe.update', () => new Response(null, { status: 204 })),
        ]);

        await expect(tilesets.upsertTileset(TOKEN, TILESET, request)).resolves.toBe('updated');
        expect(JSON.parse(String(upstream.calls[1]?.body))).toEqual(request.recipe);
    });

    it.each([
        ['a refused recipe', jsonResponse({ message: 'Recipe is invalid' }, 400), 'invalid'],
        ['a missing scope', fixtureResponse('mapbox/error.forbidden'), 'forbidden'],
    ])('badPath_aCreateThatFailsOtherwiseFails_%s', async (_case, response, failure) => {
        const { tilesets } = adapter([route('POST', `${BASE}/{tileset}`, 'mapbox.tilesets.create', () => response)]);

        await expect(tilesets.upsertTileset(TOKEN, TILESET, request)).rejects.toMatchObject({ failure });
    });
});

describe('publish, job and tileJson', () => {
    it('happyPath_publishAnswersTheJobId', async () => {
        const { tilesets } = adapter([
            route('POST', `${BASE}/{tileset}/publish`, 'mapbox.tilesets.publish', () =>
                fixtureResponse('mapbox/tilesets.publish.ok', { values: VALUES }),
            ),
        ]);

        await expect(tilesets.publish(TOKEN, TILESET)).resolves.toEqual({ jobId: VALUES.jobId });
    });

    it('badPath_aPublishWithoutAJobIdIsInvalid', async () => {
        const { tilesets } = adapter([
            route('POST', `${BASE}/{tileset}/publish`, 'mapbox.tilesets.publish', () => jsonResponse({ message: 'x' })),
        ]);

        await expect(tilesets.publish(TOKEN, TILESET)).rejects.toMatchObject({ failure: 'invalid' });
    });

    it.each([
        ['queued', { stage: 'queued', errors: [] }],
        ['success', { stage: 'success', errors: [], precisions: { '1m': 1260 } }],
        ['failed', { stage: 'failed', errors: ['Invalid raster source: the GeoTIFF has no georeferencing.'], precisions: { '1m': 1260 } }],
    ] as const)('happyPath_aJobReadsAs_%s', async (stage, expected) => {
        const { tilesets } = adapter([
            route('GET', `${BASE}/{tileset}/jobs/{job}`, 'mapbox.tilesets.jobs.get', () =>
                fixtureResponse(`mapbox/tilesets.job.${stage}`, { values: VALUES }),
            ),
        ]);

        await expect(tilesets.job(TOKEN, TILESET, VALUES.jobId)).resolves.toEqual(expected);
    });

    it('happyPath_theTilesetsJobsAreListedNewestFirst', async () => {
        const { upstream, tilesets } = adapter([
            route('GET', `${BASE}/{tileset}/jobs`, 'mapbox.tilesets.jobs.list', () =>
                jsonResponse([
                    ...(fixtureBody('mapbox/tilesets.jobs.list', VALUES) as unknown[]),
                    { id: 'no-stage', created: 1 },
                    { id: 'no-time', stage: 'queued' },
                    { stage: 'success', created: 2 },
                ]),
            ),
        ]);

        await expect(tilesets.listJobs(TOKEN, TILESET, 10)).resolves.toEqual([
            { id: VALUES.jobId, stage: 'processing', createdAt: 1_791_793_800_000 },
        ]);
        expect(new URL(String(upstream.calls[0]?.url)).searchParams.get('limit')).toBe('10');
    });

    it('badPath_aJobsAnswerThatIsNotAListIsInvalid', async () => {
        const { tilesets } = adapter([
            route('GET', `${BASE}/{tileset}/jobs`, 'mapbox.tilesets.jobs.list', () => jsonResponse({ message: 'x' })),
        ]);

        await expect(tilesets.listJobs(TOKEN, TILESET, 10)).rejects.toEqual(new UpstreamError('mapbox', 'invalid'));
    });

    it('badPath_anUnknownStageIsInvalid', async () => {
        const { tilesets } = adapter([
            route('GET', `${BASE}/{tileset}/jobs/{job}`, 'mapbox.tilesets.jobs.get', () =>
                jsonResponse({ stage: 'exploded', tileset_precisions: 'x' }),
            ),
        ]);

        await expect(tilesets.job(TOKEN, TILESET, 'j')).rejects.toMatchObject({ failure: 'invalid' });
    });

    it('happyPath_theTileJsonGivesTheZoomRange', async () => {
        const { upstream, tilesets } = adapter([
            route('GET', `${MAPBOX_API}/v4/{tilejson}`, 'mapbox.tilejson', () =>
                jsonResponse({ tilejson: '2.2.0', minzoom: 10, maxzoom: 16 }),
            ),
        ]);

        await expect(tilesets.tileJson(TOKEN, TILESET)).resolves.toEqual({ minzoom: 10, maxzoom: 16 });
        expect(new URL(String(upstream.calls[0]?.url)).pathname).toBe(`/v4/${TILESET}.json`);
    });

    it('badPath_aTileJsonWithoutZoomsIsInvalid', async () => {
        const { tilesets } = adapter([
            route('GET', `${MAPBOX_API}/v4/{tilejson}`, 'mapbox.tilejson', () => jsonResponse({ tilejson: '2.2.0' })),
        ]);

        await expect(tilesets.tileJson(TOKEN, TILESET)).rejects.toMatchObject({ failure: 'invalid' });
    });
});

describe('deletions', () => {
    it('happyPath_deletingATilesetAndItsSourceAcceptsMissingOnes', async () => {
        const { upstream, tilesets } = adapter([
            route('DELETE', `${BASE}/sources/{user}/{source}`, 'mapbox.tilesets.sources.delete', () =>
                fixtureResponse('mapbox/error.not-found'),
            ),
            route('DELETE', `${BASE}/{tileset}`, 'mapbox.tilesets.delete', () => new Response(null, { status: 204 })),
        ]);

        await tilesets.deleteTileset(TOKEN, TILESET);
        await tilesets.deleteSource(USER, TOKEN, SOURCE);

        expect(upstream.calls.map((call) => [call.operation, call.status])).toEqual([
            ['mapbox.tilesets.delete', 204],
            ['mapbox.tilesets.sources.delete', 404],
        ]);
    });

    it('badPath_aDeletionMapboxRefusesFails', async () => {
        const { tilesets } = adapter([
            route('DELETE', `${BASE}/{tileset}`, 'mapbox.tilesets.delete', () => fixtureResponse('mapbox/error.unavailable')),
        ]);

        await expect(tilesets.deleteTileset(TOKEN, TILESET)).rejects.toMatchObject({ failure: 'unavailable' });
    });
});
