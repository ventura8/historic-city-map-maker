/**
 * The `layer-delete` job (`functions/src/imagery/layer-delete.ts`, `docs/research/M3-interfaces.md` §4.6 step 5, §7.6;
 * CR-M2c-13): after the grace the layer's tileset and source go at Mapbox and its files in our bucket, with retries; a
 * layer restored meanwhile cancels the job; a tileset of another account and a linked layer's tileset are left alone.
 */
import { FIRESTORE_PATHS, jobDocSchema, timestampFromDate, type JobDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { runLayerDelete } from '../../src/imagery/layer-delete.js';
import { releaseScenes } from '../../src/imagery/release-scene.js';
import { runImageryTick } from '../../src/imagery/tick.js';
import { deletionsPending } from '../../src/imagery/versions.js';
import { UpstreamError } from '../../src/ports/errors.js';
import {
    CITY,
    MAPBOX_USER,
    NOW,
    at,
    readJob,
    readScene,
    readyWorld,
    renderedVersion,
    seedJob,
    seedLayer,
    seedScene,
    seedSetup,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const TILESET = `${MAPBOX_USER}.hcm-bucharest-corona-1968`;
const SOURCE = 'hcm-bucharest-corona-1968';

function deletion(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'layer-delete',
        status: 'queued',
        params: { layerId: 'corona-1968', tilesetId: TILESET, sourceSha: 'b'.repeat(64) },
        createdBy: 'u-admin',
        createdAt: timestampFromDate(new Date('2026-10-15T08:00:00.000Z')),
        dispatchAt: timestampFromDate(new Date('2026-10-22T08:00:00.000Z')),
        updatedBy: 'u-admin',
        updatedAt: timestampFromDate(new Date('2026-10-15T08:00:00.000Z')),
        ...overrides,
    };
}

async function dueWorld(overrides: Partial<JobDoc> = {}): Promise<ImageryWorld> {
    const world = await readyWorld();
    await seedJob(world, 'ld-1', deletion(overrides));
    await world.tilesets.tilesets.upsertTileset(world.tilesets.token, TILESET, { name: SOURCE, recipe: { minzoom: 10, maxzoom: 16 } });
    world.tilesets.sources.set(`${MAPBOX_USER}/${SOURCE}`, 10);
    world.deps.blobs.put('private', 'rasters/bucharest/corona-1968/v1/cog.tif', new Uint8Array([1, 2]));
    world.deps.blobs.put('private', 'rasters/bucharest/corona-1968/v1/preview.png', new Uint8Array([3]));
    world.deps.blobs.put('private', 'rasters/bucharest/corona-19680/v1/cog.tif', new Uint8Array([4]));
    // The deleted layer's own version, made before the deletion.
    await seedVersion(
        world,
        'v1',
        renderedVersion({
            jobId: 'v1',
            layerId: 'corona-1968',
            state: 'published',
            mapbox: { tilesetId: TILESET, origin: 'mts' },
            createdAt: at('2026-10-01T08:00:00.000Z'),
        }),
    );
    return world;
}

describe('layer-delete: the scene of the deleted layer', () => {
    it('happyPath_theSuccessfulDeletionFreesTheLayersScene @S-A33-HAPPY-TILESET-DELETED', async () => {
        const world = await dueWorld();
        await seedScene(world, 'DS-PUBLISHED', {
            status: 'imported',
            layerId: 'corona-1968',
            order: {
                state: 'imported',
                orderedAt: at(NOW),
                orderedBy: 'u-admin',
                checks: 1,
                nextCheckAt: at(NOW),
                remindersSent: [],
            },
        });
        await seedScene(world, 'DS-OTHER', { status: 'imported', layerId: 'corona-1969' });

        expect(await runLayerDelete(world.deps, CITY, 'ld-1')).toBe('succeeded');

        const scene = await readScene(world, 'DS-PUBLISHED');
        expect(scene).toMatchObject({ status: 'candidate' });
        expect(scene?.layerId).toBeUndefined();
        expect(scene?.order).toBeUndefined();
        expect(await readScene(world, 'DS-OTHER')).toMatchObject({ status: 'imported', layerId: 'corona-1969' });
    });

    it('badPath_aDeletionFailedForGoodKeepsTheSceneOnEveryTickAndTheIdForALaterImport @S-A33-BAD-DELETE-FAILED-KEEPS-SCENE', async () => {
        const world = await dueWorld({ status: 'failed' });
        await seedScene(world, 'S-1', { status: 'imported', layerId: 'corona-1968' });

        // The layer's tiles are still at Mapbox and a revert can bring it back, though its document is gone.
        await releaseScenes(world.deps, CITY);

        expect((await readScene(world, 'S-1'))?.status).toBe('imported');
        expect(await deletionsPending(world.deps.documents, CITY)).toEqual(['corona-1968']);
    });

    it('happyPath_aFailedDeletionThatALaterOneFinishedFreesTheSceneAndTheId @S-A33-BAD-DELETE-FAILED-KEEPS-SCENE', async () => {
        const world = await dueWorld({ status: 'failed' });
        await seedJob(world, 'ld-2', deletion({ status: 'succeeded' }));
        await seedScene(world, 'S-1', { status: 'imported', layerId: 'corona-1968' });

        await releaseScenes(world.deps, CITY);

        expect((await readScene(world, 'S-1'))?.status).toBe('candidate');
        expect(await deletionsPending(world.deps.documents, CITY)).toEqual([]);
    });

    it('badPath_aDeletionWhoseParametersCannotBeReadHoldsNoId', async () => {
        const world = await dueWorld({ params: { layerId: '../nope' } });

        expect(await deletionsPending(world.deps.documents, CITY)).toEqual([]);
    });

    it('badPath_aDeletionThatFailedOrWasCancelledKeepsTheScene @S-A33-HAPPY-TILESET-DELETED', async () => {
        const world = await dueWorld();
        await seedScene(world, 'DS-PUBLISHED', { status: 'imported', layerId: 'corona-1968' });
        world.tilesets.recorder.failNext('deleteTileset', new UpstreamError('mapbox', 'unavailable', { status: 503 }));

        expect(await runLayerDelete(world.deps, CITY, 'ld-1')).toBe('retry');
        expect(await readScene(world, 'DS-PUBLISHED')).toMatchObject({ status: 'imported', layerId: 'corona-1968' });

        await seedLayer(world, 'corona-1968');

        expect(await runLayerDelete(world.deps, CITY, 'ld-1')).toBe('cancelled');
        expect(await readScene(world, 'DS-PUBLISHED')).toMatchObject({ status: 'imported', layerId: 'corona-1968' });
    });
});

describe('layer-delete', () => {
    it('happyPath_afterTheGraceTheTilesetItsSourceAndTheFilesGo @S-A33-HAPPY-TILESET-DELETED', async () => {
        const world = await dueWorld();

        await runImageryTick(world.deps);

        expect(world.tilesets.recipes.has(TILESET)).toBe(false);
        expect(world.tilesets.sources.has(`${MAPBOX_USER}/${SOURCE}`)).toBe(false);
        expect(world.deps.blobs.paths('private', 'rasters/')).toEqual(['rasters/bucharest/corona-19680/v1/cog.tif']);
        expect(await readJob(world, 'ld-1')).toMatchObject({ status: 'succeeded', steps: { delete: { status: 'done' } } });
    });

    it('happyPath_aLayerRestoredMeanwhileCancelsTheDeletion @S-A33-HAPPY-TILESET-DELETED', async () => {
        const world = await dueWorld();
        await seedLayer(world, 'corona-1968');

        expect(await runLayerDelete(world.deps, CITY, 'ld-1')).toBe('cancelled');

        expect((await readJob(world, 'ld-1'))?.status).toBe('cancelled');
        expect(world.tilesets.recipes.has(TILESET)).toBe(true);
        expect(world.deps.blobs.paths('private', 'rasters/bucharest/corona-1968/')).toHaveLength(2);
    });

    it('happyPath_aFailureIsTriedAgainThenFails @S-A33-HAPPY-TILESET-DELETED', async () => {
        const world = await dueWorld();
        const outage = new UpstreamError('mapbox', 'unavailable', { status: 503 });
        world.tilesets.recorder.failNext('deleteTileset', outage, outage, outage);

        expect(await runLayerDelete(world.deps, CITY, 'ld-1')).toBe('retry');
        expect(await readJob(world, 'ld-1')).toMatchObject({
            status: 'queued',
            attempt: 1,
            error: { code: 'apiError.mapbox.unavailable' },
        });
        expect(await runLayerDelete(world.deps, CITY, 'ld-1')).toBe('retry');
        expect(await runLayerDelete(world.deps, CITY, 'ld-1')).toBe('failed');
        expect(await readJob(world, 'ld-1')).toMatchObject({ status: 'failed', attempt: 3 });
    });

    it('badPath_aVersionThatTookTheIdMakesTheDeletionWait @S-A33-BAD-ID-REUSED', async () => {
        const world = await dueWorld();
        await seedVersion(
            world,
            'v-new',
            renderedVersion({
                jobId: 'v-new',
                layerId: 'corona-1968',
                state: 'awaiting_approval',
                createdAt: at('2026-10-20T08:00:00.000Z'),
            }),
        );
        world.deps.blobs.put('private', 'rasters/bucharest/corona-1968/v-new/cog.tif', new Uint8Array([5]));

        expect(await runLayerDelete(world.deps, CITY, 'ld-1')).toBe('waiting');

        expect((await readJob(world, 'ld-1'))?.status).toBe('queued');
        expect(world.tilesets.recipes.has(TILESET)).toBe(true);
        expect(world.deps.blobs.paths('private', 'rasters/bucharest/corona-1968/')).toHaveLength(3);
    });

    it('happyPath_onlyTheDeletedLayersOwnVersionsLoseTheirFiles @S-A33-BAD-ID-REUSED', async () => {
        const world = await dueWorld();
        await seedVersion(
            world,
            'v-late',
            renderedVersion({
                jobId: 'v-late',
                layerId: 'corona-1968',
                state: 'failed',
                error: { code: 'apiError.internal' },
                createdAt: at('2026-10-20T08:00:00.000Z'),
            }),
        );
        world.deps.blobs.put('private', 'rasters/bucharest/corona-1968/v-late/scan.tif', new Uint8Array([6]));

        expect(await runLayerDelete(world.deps, CITY, 'ld-1')).toBe('succeeded');

        expect(world.deps.blobs.paths('private', 'rasters/bucharest/corona-1968/')).toEqual([
            'rasters/bucharest/corona-1968/v-late/scan.tif',
        ]);
    });

    it('happyPath_aLinkedLayerLeavesItsTilesetInTheAccount', async () => {
        const world = await dueWorld({ params: { layerId: 'corona-1968' } });

        expect(await runLayerDelete(world.deps, CITY, 'ld-1')).toBe('succeeded');

        expect(world.tilesets.recipes.has(TILESET)).toBe(true);
        expect(world.tilesets.recorder.calls).toEqual([expect.objectContaining({ method: 'upsertTileset' })]);
    });

    it('badPath_aTilesetOfAnotherAccountIsNeverTouched', async () => {
        const world = await dueWorld({ params: { layerId: 'corona-1968', tilesetId: 'someone-else.corona' } });

        expect(await runLayerDelete(world.deps, CITY, 'ld-1')).toBe('succeeded');

        expect(world.tilesets.recorder.argsOf('deleteTileset')).toEqual([]);
        expect(world.deps.recording.records.map((record) => record.message)).toContain('tileset of another account left alone');
    });

    it('badPath_withoutMapboxTheDeletionWaitsAndSaysWhy', async () => {
        const world = await dueWorld();
        await seedSetup(world, { mapbox: { state: 'missing' } });

        expect(await runLayerDelete(world.deps, CITY, 'ld-1')).toBe('retry');
        expect((await readJob(world, 'ld-1'))?.error?.code).toBe('apiError.mapbox.notConfigured');
    });

    it.each([
        ['before its grace', deletion({ dispatchAt: timestampFromDate(new Date(Date.parse(NOW) + 60_000)) })],
        ['already done', deletion({ status: 'succeeded' })],
        ['another type', deletion({ type: 'regeoref', params: { basedOn: 'v1' } })],
        ['with params the schema refuses', deletion({ params: { layerId: '../x' } })],
    ])('badPath_nothingHappens_%s', async (_case, job) => {
        const world = await readyWorld();
        await world.deps.documents.set(FIRESTORE_PATHS.job(CITY, 'ld-1'), jobDocSchema, job);

        expect(await runLayerDelete(world.deps, CITY, 'ld-1')).toBe('skipped');
        expect(world.tilesets.recorder.calls).toEqual([]);
    });

    it('happyPath_aDeletionWithoutAGraceTimeRunsAtOnce', async () => {
        const world = await dueWorld({ dispatchAt: undefined });

        expect(await runLayerDelete(world.deps, CITY, 'ld-1')).toBe('succeeded');
    });
});
