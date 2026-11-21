/**
 * A published join and its frames (`functions/src/imagery/{finalize,finalize-join,tick-maintenance,layer-delete}.ts`,
 * `docs/research/M8-join-interfaces.md` §5): the frames end `joined`, their jobs succeed, every scene holds the join's layer so
 * the tick frees none; the sweep leaves their files, and the layer's deletion takes them with it.
 */
import { timestampFromDate, type JobDoc, type LayerVersionDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { finalizeVersion } from '../../src/imagery/finalize.js';
import { runLayerDelete } from '../../src/imagery/layer-delete.js';
import { releaseScenes } from '../../src/imagery/release-scene.js';
import { sweepEnded } from '../../src/imagery/tick-maintenance.js';
import { F039, F040, joinSource, joinVersion, partVersion, requireJob, requireVersion, seedJoinOfTwo, seedPart } from './join-world.js';
import {
    CITY,
    MAPBOX_USER,
    NOW,
    at,
    readJob,
    readLayer,
    readScene,
    readVersion,
    readyWorld,
    seedJob,
    seedLayer,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const JOIN = 'jn-1';
const TILESET = `${MAPBOX_USER}.hcm-bucharest-layer-join`;
const MAPBOX = { tilesetId: TILESET, origin: 'mts' as const, publishedAt: at(NOW) };

function finalize(world: ImageryWorld, layerless = JOIN) {
    return finalizeVersion(world.deps, { cityId: CITY, jobId: layerless, versionId: layerless, origin: 'mts', tilesetId: TILESET });
}

function goldenScan(path: string): NonNullable<LayerVersionDoc['scan']> {
    return { path, width: 10, height: 10, sha256: 'a'.repeat(64), previewPath: 'p', previewScale: 1 };
}

const LONG_AGO = timestampFromDate(new Date('2026-08-01T08:00:00.000Z'));

describe('finalizing a join', () => {
    it('happyPath_framesEndJoined_jobsSucceed_scenesHoldTheLayer_provenanceNamesThemAll @S-A65-HAPPY-FINALIZE-SCENES', async () => {
        const world = await readyWorld();
        await seedJoinOfTwo(world, JOIN, { state: 'publishing', approval: { auto: false, by: 'u-admin', at: at(NOW) } });

        await expect(finalize(world)).resolves.toBe(true);

        for (const version of ['v-f039', 'v-f040']) {
            expect((await readVersion(world, version))?.state).toBe('joined');
            const job = await readJob(world, version);
            expect(job).toMatchObject({ status: 'succeeded', finishedAt: at(NOW) });
            expect(job?.waitReason).toBeUndefined();
        }
        for (const entity of [F039, F040]) {
            expect(await readScene(world, entity)).toMatchObject({ status: 'imported', layerId: 'layer-join' });
        }
        const layer = await readLayer(world, 'layer-join');
        expect(layer).toMatchObject({
            kind: 'satellite',
            currentVersion: JOIN,
            provenance: { usgsEntityId: F039, usgsDataset: 'declassiii', usgsParts: [F039, F040] },
        });
        expect(layer?.attribution).toContain('USGS');
        expect((await readVersion(world, JOIN))?.state).toBe('published');
    });

    it('happyPath_theTickFreesNoSceneOfAPublishedJoin @S-A65-HAPPY-FINALIZE-SCENES', async () => {
        const world = await readyWorld();
        await seedJoinOfTwo(world, JOIN, { state: 'publishing', approval: { auto: false, by: 'u-admin', at: at(NOW) } });
        await finalize(world);

        await releaseScenes(world.deps, CITY);

        expect((await readScene(world, F040))?.status).toBe('imported');
    });

    it('happyPath_aFramePublishedOnTheLayerIsSuperseded_thePresentationStays', async () => {
        const world = await readyWorld();
        const f039 = await seedPart(
            world,
            F039,
            { state: 'published', mapbox: MAPBOX, partOf: JOIN },
            { status: 'succeeded', waitReason: undefined },
        );
        const f040 = await seedPart(world, F040, { partOf: JOIN });
        await seedLayer(world, f039.layerId, {
            currentVersion: f039.versionId,
            pendingVersion: JOIN,
            opacity: 0.4,
            provenance: { georef: { method: 'auto' } },
        });
        const parts = [
            { ...f039, entityId: F039 },
            { ...f040, entityId: F040 },
        ];
        const approval = { auto: false, by: 'u-admin', at: at(NOW) };
        await seedVersion(
            world,
            JOIN,
            joinVersion({ jobId: JOIN, layerId: f039.layerId, state: 'publishing', approval, source: joinSource(parts) }),
        );
        await seedJob(world, JOIN, {
            type: 'layer-join',
            status: 'mts_processing',
            params: {},
            createdBy: 'u-admin',
            createdAt: at(NOW),
            layerId: f039.layerId,
            versionId: JOIN,
            updatedBy: 'x',
            updatedAt: at(NOW),
        });

        await finalize(world);

        expect((await readVersion(world, f039.versionId))?.state).toBe('superseded');
        expect((await readVersion(world, f040.versionId))?.state).toBe('joined');
        const layer = await readLayer(world, f039.layerId);
        expect(layer).toMatchObject({ opacity: 0.4, currentVersion: JOIN });
        expect(layer?.pendingVersion).toBeUndefined();
        expect(layer?.provenance?.georef).toBeUndefined();
        expect(await readScene(world, F040)).toMatchObject({ layerId: f039.layerId });
    });

    it('badPath_aFrameThatEndedOrVanishedKeepsItsState_aSceneAloneMoves', async () => {
        const world = await readyWorld();
        await seedJoinOfTwo(world, JOIN, { state: 'publishing', approval: { auto: false, by: 'u-admin', at: at(NOW) } });
        await seedVersion(world, 'v-f039', partVersion('v-f039', F039, { state: 'cancelled', output: undefined }));
        await seedJob(world, 'v-f039', { ...(await requireJob(world, 'v-f039')), status: 'cancelled' });
        await world.deps.documents.delete(`cities/${CITY}/usgsScenes/${F040}`);

        await finalize(world);

        expect((await readVersion(world, 'v-f039'))?.state).toBe('cancelled');
        expect((await readJob(world, 'v-f039'))?.status).toBe('cancelled');
        expect((await readScene(world, F039))?.layerId).toBe('layer-join');
        expect(await readScene(world, F040)).toBeUndefined();
    });
});

describe('the files of a joined frame', () => {
    it('happyPath_theSweepLeavesAJoinedFrame_itTakesARejectedOne @S-A65-HAPPY-FINALIZE-SCENES', async () => {
        const world = await readyWorld();
        await seedVersion(world, 'v-joined', partVersion('v-joined', F039, { state: 'joined', updatedAt: LONG_AGO, layerId: 'layer-a' }));
        await seedVersion(
            world,
            'v-rejected',
            partVersion('v-rejected', F040, { state: 'rejected', updatedAt: LONG_AGO, layerId: 'layer-b' }),
        );
        world.deps.blobs.put('private', `rasters/${CITY}/layer-a/v-joined/scan.tif`, new Uint8Array([1]));
        world.deps.blobs.put('private', `rasters/${CITY}/layer-b/v-rejected/scan.tif`, new Uint8Array([1]));

        await sweepEnded(world.deps, CITY, new Date(NOW));

        expect(world.deps.blobs.paths('private', 'rasters/')).toEqual([`rasters/${CITY}/layer-a/v-joined/scan.tif`]);
    });

    /** A frame imported (`im`), its points fixed (`rg`): the new version's scan stays in the old one's folder. */
    const SCAN = `rasters/${CITY}/layer-a/im-1/scan.tif`;

    async function reGeoreferenced(world: ImageryWorld, state: LayerVersionDoc['state'], updatedAt = at(NOW)): Promise<void> {
        const scan = goldenScan(SCAN);
        const needed = {
            published: { mapbox: MAPBOX },
            failed: { output: undefined, error: { code: 'apiError.imagery.processingFailed' as const } },
        };
        const fields = state === 'published' || state === 'failed' ? needed[state] : {};
        await seedVersion(world, 'im-1', partVersion('im-1', F039, { state: 'cancelled', updatedAt: LONG_AGO, layerId: 'layer-a', scan }));
        await seedVersion(
            world,
            'rg-1',
            partVersion('rg-1', F039, { state, updatedAt, layerId: 'layer-a', scan, basedOn: 'im-1', ...fields }),
        );
        world.deps.blobs.put('private', SCAN, new Uint8Array([1]));
    }

    it.each(['awaiting_approval', 'published', 'joined', 'processing'] as const)(
        'badPath_theSweepLeavesAScanA_%s_VersionReadsFromAnEndedOnesFolder',
        async (state) => {
            const world = await readyWorld();
            await reGeoreferenced(world, state);

            await sweepEnded(world.deps, CITY, new Date(NOW));

            expect(world.deps.blobs.paths('private', 'rasters/')).toEqual([SCAN]);
            // The stamp did not move: the sweep takes the folder as soon as nothing reads it.
            expect((await readVersion(world, 'im-1'))?.updatedAt).toEqual(LONG_AGO);
        },
    );

    it('happyPath_theSweepTakesTheScanOnceItsReaderEndedAsLongAgo', async () => {
        const world = await readyWorld();
        await reGeoreferenced(world, 'rejected', LONG_AGO);

        await sweepEnded(world.deps, CITY, new Date(NOW));

        expect(world.deps.blobs.paths('private', 'rasters/')).toEqual([]);
    });

    it('badPath_aReaderThatEndedLatelyStillHoldsTheScan', async () => {
        const world = await readyWorld();
        await reGeoreferenced(world, 'failed');

        await sweepEnded(world.deps, CITY, new Date(NOW));

        expect(world.deps.blobs.paths('private', 'rasters/')).toEqual([SCAN]);
    });

    it('happyPath_theLayersDeletionTakesTheFolderAJoinedFramesScanLivesIn', async () => {
        const world = await readyWorld();
        const scan = goldenScan(`rasters/${CITY}/layer-f039/im-1/scan.tif`);
        await seedJoinOfTwo(world, JOIN, { state: 'publishing', approval: { auto: false, by: 'u-admin', at: at(NOW) } });
        const frame = await requireVersion(world, 'v-f039');
        await seedVersion(world, 'v-f039', { ...frame, scan });
        await finalize(world);
        await world.deps.documents.delete(`cities/${CITY}/layers/layer-join`);
        await seedJob(world, 'ld-1', deletion());
        world.deps.blobs.put('private', scan.path, new Uint8Array([1]));

        await expect(runLayerDelete(world.deps, CITY, 'ld-1')).resolves.toBe('succeeded');

        expect(world.deps.blobs.paths('private', 'rasters/')).toEqual([]);
    });

    function deletion(): JobDoc {
        return {
            type: 'layer-delete',
            status: 'queued',
            params: { layerId: 'layer-join', tilesetId: TILESET, sourceSha: 'b'.repeat(64) },
            createdBy: 'u-admin',
            createdAt: at(NOW),
            updatedBy: 'u-admin',
            updatedAt: at(NOW),
        };
    }

    it('happyPath_theLayersDeletionTakesTheFilesOfItsJoinedFrames_andFreesEveryScene @S-A65-HAPPY-FINALIZE-SCENES', async () => {
        const world = await readyWorld();
        await seedJoinOfTwo(world, JOIN, { state: 'publishing', approval: { auto: false, by: 'u-admin', at: at(NOW) } });
        await finalize(world);
        await world.deps.documents.delete(`cities/${CITY}/layers/layer-join`);
        await seedJob(world, 'ld-1', deletion());
        for (const path of ['layer-join/jn-1/cog.tif', 'layer-f039/v-f039/scan.tif', 'layer-f040/v-f040/cog.tif']) {
            world.deps.blobs.put('private', `rasters/${CITY}/${path}`, new Uint8Array([1]));
        }

        await expect(runLayerDelete(world.deps, CITY, 'ld-1')).resolves.toBe('succeeded');

        expect(world.deps.blobs.paths('private', 'rasters/')).toEqual([]);
        expect(await readScene(world, F039)).toMatchObject({ status: 'candidate' });
        expect((await readScene(world, F040))?.layerId).toBeUndefined();
    });

    it('badPath_aRejectedJoinsFrameKeepsItsFilesWhenItsLayerGoes', async () => {
        const world = await readyWorld();
        await seedJoinOfTwo(world, JOIN, { state: 'rejected' }, { status: 'cancelled', waitReason: undefined });
        await seedJob(world, 'ld-1', deletion());
        world.deps.blobs.put('private', `rasters/${CITY}/layer-f040/v-f040/scan.tif`, new Uint8Array([1]));

        await expect(runLayerDelete(world.deps, CITY, 'ld-1')).resolves.toBe('succeeded');

        expect(world.deps.blobs.paths('private', 'rasters/')).toEqual([`rasters/${CITY}/layer-f040/v-f040/scan.tif`]);
    });
});

describe('finalizing a join: the layers of its date (batch 4)', () => {
    it('happyPath_aFramesOwnPublishedLayerIsRetired_offTheMapAndKept_liveFeb1972 @S-A65-HAPPY-PUBLISHED-FRAMES', async () => {
        const world = await readyWorld();
        await seedJoinOfTwo(world, JOIN, { state: 'publishing', approval: { auto: false, by: 'u-admin', at: at(NOW) } });
        const f040 = await requireVersion(world, 'v-f040');
        await seedVersion(world, 'v-f040', { ...f040, state: 'published', mapbox: MAPBOX });
        await seedLayer(world, f040.layerId, { currentVersion: 'v-f040', published: true });

        await finalize(world);

        expect(await readLayer(world, f040.layerId)).toMatchObject({
            published: false,
            retired: { by: JOIN, at: at(NOW) },
            currentVersion: 'v-f040',
            source: { type: 'mapbox' },
        });
        expect((await readVersion(world, 'v-f040'))?.state).toBe('published');
        expect((await readScene(world, F040))?.layerId).toBe('layer-join');
        expect((await readLayer(world, 'layer-join'))?.published).toBe(true);
    });

    it('happyPath_aLayerAlreadyRetiredStaysAsItIs', async () => {
        const world = await readyWorld();
        await seedJoinOfTwo(world, JOIN, { state: 'publishing', approval: { auto: false, by: 'u-admin', at: at(NOW) } });
        const f040 = await requireVersion(world, 'v-f040');
        await seedLayer(world, f040.layerId, { published: false, retired: { by: 'jn-0', at: LONG_AGO } });

        await finalize(world);

        expect((await readLayer(world, f040.layerId))?.retired).toEqual({ by: 'jn-0', at: LONG_AGO });
    });

    it('happyPath_aFramePublishingAloneAfterItsJoinPublishedIsBornRetired @S-A65-HAPPY-PUBLISHED-FRAMES', async () => {
        const world = await readyWorld();
        const approval = { auto: false, by: 'u-admin', at: at(NOW) };
        await seedJoinOfTwo(world, JOIN, { state: 'published', mapbox: MAPBOX });
        const f040 = await requireVersion(world, 'v-f040');
        await seedVersion(world, 'v-f040', { ...f040, state: 'publishing', approval });
        await seedJob(world, 'v-f040', { ...(await requireJob(world, 'v-f040')), status: 'mts_processing', waitReason: undefined });

        await expect(finalize(world, 'v-f040')).resolves.toBe(true);

        expect(await readLayer(world, f040.layerId)).toMatchObject({ published: false, retired: { by: JOIN } });
        expect((await readVersion(world, 'v-f040'))?.state).toBe('published');
    });

    it('badPath_aFramePublishingAloneWhileItsJoinIsNotPublishedIsPublic', async () => {
        const world = await readyWorld();
        const approval = { auto: false, by: 'u-admin', at: at(NOW) };
        await seedJoinOfTwo(world, JOIN);
        const f040 = await requireVersion(world, 'v-f040');
        await seedVersion(world, 'v-f040', { ...f040, state: 'publishing', approval });

        await finalize(world, 'v-f040');

        const layer = await readLayer(world, f040.layerId);
        expect(layer?.published).toBe(true);
        expect(layer?.retired).toBeUndefined();
    });
});
