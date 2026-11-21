/**
 * `imagery.onRasterUpload` (`functions/src/imagery/on-raster-upload.ts`, `docs/research/M3-interfaces.md` §8.1): an
 * admin's GeoTIFF becomes a `geotiff-import` job named after its upload, with its version; the bytes decide, not the
 * name; a replacement keeps its layer's label and marks it pending; every refusal is recorded on the job the page
 * watches, and a redelivered event changes nothing.
 */
import { FIRESTORE_PATHS, RASTER_PATHS } from '@hcm/shared';
import type { StorageEvent } from 'firebase-functions/storage';
import { describe, expect, it, vi } from 'vitest';

import { onRasterUploadFunction, processRasterUpload, uploadMetadataOf } from '../../src/imagery/on-raster-upload.js';
import { CITY, NOW, at, readJob, readLayer, readVersion, readyWorld, seedGuard, seedJob, seedLayer, type ImageryWorld } from './world.js';

const UPLOAD = 'up-plan1911';
const PATH = RASTER_PATHS.upload(CITY, 'u-admin', UPLOAD, 'Qx7mP2rT9w.tif');
const TIFF = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const BIGTIFF = new Uint8Array([0x4d, 0x4d, 0x00, 0x2b, 0, 8, 0, 0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function uploaded(
    world: ImageryWorld,
    bytes: Uint8Array,
    metadata: Record<string, string> = { originalName: 'Planul Bucureștilor 1911.tif' },
    path = PATH,
) {
    world.deps.blobs.put('private', path, bytes, { contentType: 'image/tiff', customMetadata: metadata });
    return { name: path, size: bytes.length, metadata };
}

describe('imagery.onRasterUpload', () => {
    it('happyPath_aGeotiffBecomesAnImportJobNamedAfterItsUpload', async () => {
        const world = await readyWorld();

        await processRasterUpload(world.deps, uploaded(world, TIFF));

        expect(await readJob(world, UPLOAD)).toEqual({
            type: 'geotiff-import',
            status: 'queued',
            params: { uploadPath: PATH, originalName: 'Planul Bucureștilor 1911.tif', replaces: false },
            createdBy: 'u-admin',
            createdAt: at(NOW),
            layerId: 'planul-bucurestilor-1911',
            versionId: UPLOAD,
            updatedBy: 'u-admin',
            updatedAt: at(NOW),
        });
        expect(await readVersion(world, UPLOAD)).toMatchObject({
            origin: 'upload',
            state: 'processing',
            source: { kind: 'upload', uploadPath: PATH, originalName: 'Planul Bucureștilor 1911.tif', bytes: TIFF.length },
            label: { ro: 'Planul Bucureștilor 1911' },
            year: 1911,
        });
        expect(world.deps.blobs.object('private', PATH)).toBeDefined();
    });

    it('happyPath_theStorageSdksDownloadTokenInTheMetadataIsIgnored', async () => {
        const world = await readyWorld();
        // The Firebase Storage SDK (the emulator as production) adds its own key to the dialog's (CR-M3-32).
        const metadata = { originalName: 'Planul Bucureștilor 1911.tif', firebaseStorageDownloadTokens: 'e2e' };

        await processRasterUpload(world.deps, uploaded(world, TIFF, metadata));

        expect(await readJob(world, UPLOAD)).toMatchObject({
            type: 'geotiff-import',
            status: 'queued',
            layerId: 'planul-bucurestilor-1911',
        });
        expect(await readVersion(world, UPLOAD)).toMatchObject({ year: 1911, state: 'processing' });
    });

    it('happyPath_aBigTiffWithTheDialogsYearIsAccepted', async () => {
        const world = await readyWorld();

        await processRasterUpload(world.deps, uploaded(world, BIGTIFF, { originalName: 'ortofoto.tif', year: '1938' }));

        expect(await readVersion(world, UPLOAD)).toMatchObject({ label: { ro: 'ortofoto' }, year: 1938 });
    });

    it('happyPath_aReplacementKeepsTheLayersLabelAndMarksItPending', async () => {
        const world = await readyWorld();
        await seedLayer(world, 'plan-1911', { label: { ro: 'Planul din 1911' }, year: 1911, kind: 'map' });

        await processRasterUpload(world.deps, uploaded(world, TIFF, { originalName: 'scan nou.tif', layerId: 'plan-1911' }));

        expect(await readJob(world, UPLOAD)).toMatchObject({ params: { replaces: true }, layerId: 'plan-1911' });
        expect(await readVersion(world, UPLOAD)).toMatchObject({ label: { ro: 'Planul din 1911' }, year: 1911, layerId: 'plan-1911' });
        expect((await readLayer(world, 'plan-1911'))?.pendingVersion).toBe(UPLOAD);
    });

    it('badPath_twoReplacementsRacingPastTheBusyCheckAreToldApart @S-A14-BAD-REPLACE-RACE', async () => {
        const world = await readyWorld();
        await seedLayer(world, 'plan-1911', { label: { ro: 'Planul din 1911' }, year: 1911, kind: 'map' });
        // Another Replace wrote the layer's pending version between this upload's busy check and its transaction.
        const transaction = world.deps.documents.transaction.bind(world.deps.documents);
        world.deps.documents.transaction = (async (work: Parameters<typeof transaction>[0]) => {
            await seedLayer(world, 'plan-1911', { label: { ro: 'Planul din 1911' }, year: 1911, kind: 'map', pendingVersion: 'up-other' });
            return transaction(work);
        }) as typeof transaction;

        await processRasterUpload(world.deps, uploaded(world, TIFF, { originalName: 'scan nou.tif', layerId: 'plan-1911' }));

        expect(await readJob(world, UPLOAD)).toMatchObject({ status: 'failed', error: { code: 'apiError.layers.busy' } });
        expect(await readVersion(world, UPLOAD)).toBeUndefined();
        expect((await readLayer(world, 'plan-1911'))?.pendingVersion).toBe('up-other');
    });
});

describe('uploadMetadataOf', () => {
    it('happyPath_keepsTheDialogsThreeKeysAndDropsStoragesOwn', () => {
        expect(uploadMetadataOf({ originalName: 'a.tif', year: '1938', layerId: 'l1', firebaseStorageDownloadTokens: 'e2e' })).toEqual({
            originalName: 'a.tif',
            year: '1938',
            layerId: 'l1',
        });
    });

    it('badPath_anObjectWithoutTheDialogsKeysGivesNone', () => {
        expect(uploadMetadataOf({ firebaseStorageDownloadTokens: 'e2e' })).toEqual({});
    });
});

describe('imagery.onRasterUpload: refusals', () => {
    it('badPath_theServerSniffsTheBytesNotTheName @S-A14-BAD-SNIFFED-NOT-TIFF', async () => {
        const world = await readyWorld();

        await processRasterUpload(world.deps, uploaded(world, PNG));

        expect(await readJob(world, UPLOAD)).toMatchObject({
            type: 'geotiff-import',
            status: 'failed',
            error: { code: 'apiError.imagery.notTiff' },
            createdBy: 'u-admin',
            finishedAt: at(NOW),
        });
        expect(world.deps.blobs.object('private', PATH)).toBeUndefined();
        expect(await readVersion(world, UPLOAD)).toBeUndefined();
    });

    it.each([
        ['a replacement whose layer is gone', { originalName: 'x 1911.tif', layerId: 'gone' }, 'apiError.notFound', undefined],
        ['a replacement of a busy layer', { originalName: 'x 1911.tif', layerId: 'busy' }, 'apiError.layers.busy', 'busy'],
        ['metadata the schema refuses', { originalName: 'x 1911.tif', year: '19' }, 'apiError.invalidRequest', undefined],
        ['a name and a dialog without a year', { originalName: 'plan.tif' }, 'apiError.invalidRequest', undefined],
    ])('badPath_aRefusedUploadIsRecordedOnItsJob_%s', async (_case, metadata, code, busyLayer) => {
        const world = await readyWorld();
        if (busyLayer !== undefined) {
            await seedLayer(world, busyLayer);
            await seedJob(world, 'running', {
                type: 'regeoref',
                status: 'running',
                params: { basedOn: 'v1' },
                createdBy: 'u-admin',
                createdAt: at(NOW),
                layerId: busyLayer,
                updatedBy: 'system:pipeline',
                updatedAt: at(NOW),
            });
        }

        await processRasterUpload(world.deps, uploaded(world, TIFF, metadata));

        expect(await readJob(world, UPLOAD)).toMatchObject({ status: 'failed', error: { code } });
        expect(world.deps.blobs.object('private', PATH)).toBeUndefined();
    });

    it('badPath_theBudgetGuardRefusesUploadsToo', async () => {
        const world = await readyWorld();
        await seedGuard(world, 'red');

        await processRasterUpload(world.deps, uploaded(world, TIFF));

        expect(await readJob(world, UPLOAD)).toMatchObject({ status: 'failed', error: { code: 'apiError.guardPaused' } });
    });

    it('badPath_anUploadForAMissingCityIsRefused', async () => {
        const world = await readyWorld();
        await world.deps.documents.delete(FIRESTORE_PATHS.city(CITY));

        await processRasterUpload(world.deps, uploaded(world, TIFF));

        expect(await readJob(world, UPLOAD)).toMatchObject({ status: 'failed', error: { code: 'apiError.notFound' } });
    });

    it('happyPath_aRedeliveredEventChangesNothing', async () => {
        const world = await readyWorld();
        const object = uploaded(world, TIFF);
        await processRasterUpload(world.deps, object);
        const writes = world.deps.documents.writes.length;

        await processRasterUpload(world.deps, object);

        expect(world.deps.documents.writes).toHaveLength(writes);
    });

    it('happyPath_aJobCreatedMeanwhileByAnotherEventIsLeftAsItIs', async () => {
        const world = await readyWorld();
        const object = uploaded(world, TIFF);
        const original = world.deps.documents.transaction.bind(world.deps.documents);
        world.deps.documents.transaction = (async (work: Parameters<typeof original>[0]) => {
            await seedJob(world, UPLOAD, {
                type: 'geotiff-import',
                status: 'running',
                params: {},
                createdBy: 'u-admin',
                createdAt: at(NOW),
                updatedBy: 'x',
                updatedAt: at(NOW),
            });
            return original(work);
        }) as typeof original;

        await processRasterUpload(world.deps, object);

        expect((await readJob(world, UPLOAD))?.status).toBe('running');
        expect(world.deps.blobs.object('private', PATH)).toBeDefined();
    });

    it('happyPath_otherObjectsOfTheBucketAreIgnored', async () => {
        const world = await readyWorld();

        await processRasterUpload(world.deps, { name: 'uploads/photos/bucharest/u-admin/p1/Qx7mP2rT9w.jpg', size: 3, metadata: {} });

        expect(world.deps.documents.paths(FIRESTORE_PATHS.jobs(CITY))).toEqual([]);
    });

    it('happyPath_theTriggerWatchesThePrivateBucket', async () => {
        const world = await readyWorld();
        const object = uploaded(world, TIFF);
        const trigger = onRasterUploadFunction(() => world.deps, 'demo-hcm.firebasestorage.app');
        const event = {
            data: { name: object.name, size: String(object.size), metadata: object.metadata, bucket: 'demo-hcm.firebasestorage.app' },
        };

        await trigger.run(event as unknown as StorageEvent);

        expect((await readJob(world, UPLOAD))?.status).toBe('queued');
        expect(trigger.__endpoint).toMatchObject({
            serviceAccountEmail: 'fn-events@demo-hcm.iam.gserviceaccount.com',
            maxInstances: 5,
            concurrency: 1,
        });
    });

    it('happyPath_withoutABucketItWatchesTheProjectsDefaultBucketAndIgnoresOtherObjects', async () => {
        const world = await readyWorld();
        vi.stubEnv('FIREBASE_CONFIG', JSON.stringify({ projectId: 'demo-hcm', storageBucket: 'demo-hcm.firebasestorage.app' }));
        const trigger = onRasterUploadFunction(() => world.deps);
        vi.unstubAllEnvs();

        await trigger.run({ data: { name: 'tmp/selftest', size: '1' } } as unknown as StorageEvent);

        expect(trigger.__endpoint.eventTrigger?.eventFilters).toEqual({ bucket: 'demo-hcm.firebasestorage.app' });
        expect(world.deps.documents.paths(FIRESTORE_PATHS.jobs(CITY))).toEqual([]);
    });
});

describe('imagery.onRasterUpload: what a refusal records', () => {
    it('badPath_anInvalidRequestNamesHowManyProblemsItsTextCounts', async () => {
        const world = await readyWorld();

        await processRasterUpload(world.deps, uploaded(world, TIFF, { originalName: 'x 1911.tif', year: '19', layerId: 'Not An Id!' }));
        const schema = (await readJob(world, UPLOAD))?.error;
        await world.deps.documents.delete(FIRESTORE_PATHS.job(CITY, UPLOAD));
        await processRasterUpload(world.deps, uploaded(world, TIFF, { originalName: 'plan.tif' }));

        expect(schema).toEqual({ code: 'apiError.invalidRequest', message: 'apiError.invalidRequest', params: { count: '2' } });
        expect((await readJob(world, UPLOAD))?.error).toEqual({
            code: 'apiError.invalidRequest',
            message: 'apiError.invalidRequest',
            params: { count: '1' },
        });
    });
});
