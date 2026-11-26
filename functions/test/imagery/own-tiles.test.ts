/**
 * Publishing from the project's own bucket (`functions/src/imagery/publish-own.ts`, `docs/research/M12-own-tiles.md`): an approved
 * version's archive is copied to the public bucket and the layer points at it. Mapbox is never asked, its counters do not move, and only
 * the budget guard holds it. The preview address (`imagery.previewUrl`) lets the owner see the image before that.
 */
import {
    FIRESTORE_PATHS,
    IMAGERY_PUBLISH_QUEUE,
    STORAGE_PATHS,
    jobDocSchema,
    publicObjectUrl,
    type JobDoc,
    type LayerVersionDoc,
    type PublishTask,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { omit } from '../../src/api/objects.js';
import { rejectFunction } from '../../src/imagery/approve.js';
import { onJobWrite } from '../../src/imagery/on-job-write.js';
import { previewUrlFunction } from '../../src/imagery/preview-url.js';
import { OWN_TILES_CACHE_CONTROL } from '../../src/imagery/publish-own.js';
import { runPublishTask } from '../../src/imagery/publish.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import {
    CITY,
    NOW,
    at,
    goldenGeoref,
    goldenOutput,
    readJob,
    readLayer,
    readUsage,
    readVersion,
    readyWorld,
    renderedVersion,
    seedCity,
    seedGuard,
    seedJob,
    seedLayer,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const JOB = 'job-own-tiles';
const LAYER = 'kh-9-hexagon-1983';
const MONTH = NOW.slice(0, 7);
const ARCHIVE = new TextEncoder().encode('PMTiles archive');
const PRIVATE_PATH = `rasters/${CITY}/${LAYER}/${JOB}/tiles.pmtiles`;
const THUMB_PATH = `rasters/${CITY}/${LAYER}/${JOB}/thumb.webp`;
const PUBLIC_PATH = STORAGE_PATHS.layerTiles(CITY, LAYER, JOB);
const TILES = { path: PRIVATE_PATH, bytes: ARCHIVE.length, count: 1, sha256: 'd'.repeat(64), thumbPath: THUMB_PATH };
const TASK: PublishTask = { cityId: CITY, jobId: JOB, phase: 'start', poll: 0 };

function awaitingJob(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'usgs-import',
        status: 'awaiting_approval',
        params: { entityId: 'DZB00403', dataset: 'declassiii', sensor: 'KH-9-pan' },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: LAYER,
        versionId: JOB,
        waitReason: 'approval',
        updatedBy: 'system:pipeline',
        updatedAt: at(NOW),
        ...overrides,
    };
}

function approvedVersion(overrides: Partial<LayerVersionDoc> = {}): LayerVersionDoc {
    return renderedVersion({
        layerId: LAYER,
        jobId: JOB,
        output: { ...goldenOutput(), tiles: TILES },
        state: 'approved',
        approval: { auto: false, by: 'u-admin', at: at(NOW) },
        ...overrides,
    });
}

/** A city on the default path, its version approved, its archive in the private bucket. */
async function ownWorld(version: LayerVersionDoc = approvedVersion(), job: JobDoc = awaitingJob()): Promise<ImageryWorld> {
    const world = await readyWorld();
    await seedCity(world, { imagery: {} });
    await seedJob(world, JOB, job);
    await seedVersion(world, JOB, version);
    world.deps.blobs.put('private', PRIVATE_PATH, ARCHIVE, { contentType: 'application/vnd.pmtiles' });
    world.deps.blobs.put('private', THUMB_PATH, ARCHIVE, { contentType: 'image/webp' });
    return world;
}

const publicUrl = (world: ImageryWorld): string => publicObjectUrl(world.deps.config.buckets.public, PUBLIC_PATH);

function expectNothingAtMapbox(world: ImageryWorld): void {
    expect(world.tilesets.recorder.calls).toEqual([]);
    expect(world.uploads.recorder.calls).toEqual([]);
}

describe('publishing from the own bucket', () => {
    it('happyPath_approvedGoesToThePublicBucketAndTheLayerPointsAtIt @S-A70-HAPPY-PUBLISH', async () => {
        const world = await ownWorld();

        await runPublishTask(world.deps, TASK);

        expect(await world.deps.blobs.stat('public', PUBLIC_PATH)).toBeDefined();
        expect(world.deps.blobs.recorder.argsOf('copy')).toEqual([
            [{ bucket: 'private', path: PRIVATE_PATH }, { bucket: 'public', path: PUBLIC_PATH }, { cacheControl: OWN_TILES_CACHE_CONTROL }],
        ]);
        expect(await readLayer(world, LAYER)).toMatchObject({
            source: { type: 'pmtiles', url: publicUrl(world) },
            minzoom: goldenOutput().minzoom,
            maxzoom: goldenOutput().maxzoom,
            currentVersion: JOB,
            status: 'ready',
            published: true,
        });
        expect((await readLayer(world, LAYER))?.mapbox).toBeUndefined();
        const version = await readVersion(world, JOB);
        expect(version).toMatchObject({ state: 'published', own: { path: PUBLIC_PATH, url: publicUrl(world), bytes: ARCHIVE.length } });
        expect(version?.mapbox).toBeUndefined();
        expect(await readJob(world, JOB)).toMatchObject({
            status: 'succeeded',
            progress: 1,
            publishAttempts: 1,
            steps: {
                guard: { status: 'skipped' },
                upload: { status: 'skipped' },
                publish: { status: 'skipped' },
                finalize: { status: 'done' },
            },
        });
        expectNothingAtMapbox(world);
        expect(await readUsage(world, MONTH)).toBeUndefined();
    });

    it('happyPath_publishedItsTilesAreStoredOnceAndItsPictureStays @S-A70-HAPPY-STORED-ONCE', async () => {
        const world = await ownWorld();

        await runPublishTask(world.deps, TASK);

        expect(await world.deps.blobs.stat('public', PUBLIC_PATH)).toMatchObject({ size: ARCHIVE.length });
        expect(await world.deps.blobs.stat('private', PRIVATE_PATH)).toBeUndefined();
        expect(await world.deps.blobs.stat('private', THUMB_PATH)).toBeDefined();
    });

    it('happyPath_thePolicysOwnApprovalPublishesWithNoClick @S-A70-HAPPY-AUTO', async () => {
        const proved = { how: 'votes', tiles: { agreed: 412, tried: 500 }, crossValidatedM: 11.5, measuredPct: 85 } as const;
        const version = renderedVersion({
            layerId: LAYER,
            jobId: JOB,
            state: 'awaiting_approval',
            output: { ...goldenOutput(), tiles: TILES, coveragePct: 95 },
            georef: { ...goldenGeoref(), method: 'auto', checkpointKind: 'held-out', checkpointCount: 3, checkpointRmseM: 6 },
            calibration: proved,
        });
        const world = await ownWorld(version);

        await onJobWrite(world.deps, CITY, JOB, { before: { ...awaitingJob(), status: 'running' }, after: awaitingJob() });
        const queued = world.deps.tasks.queued.filter((task) => task.queue === IMAGERY_PUBLISH_QUEUE);
        expect(queued).toHaveLength(1);
        await runPublishTask(world.deps, TASK);

        expect(await readVersion(world, JOB)).toMatchObject({ state: 'published', approval: { auto: true } });
        expect(await readLayer(world, LAYER)).toMatchObject({ source: { type: 'pmtiles' } });
        expectNothingAtMapbox(world);
    });

    it('happyPath_aNewVersionReplacesATilesetLayerAndKeepsItsRecordForTheDeletion @S-A70-HAPPY-OVER-MAPBOX', async () => {
        const world = await ownWorld();
        const tilesetId = 'ventura86.hcm-bucharest-kh-9-hexagon-1983';
        await seedLayer(world, LAYER, { source: { type: 'mapbox', tilesetId }, mapbox: { tilesetId, origin: 'mts' } });

        await runPublishTask(world.deps, TASK);

        expect(await readLayer(world, LAYER)).toMatchObject({
            source: { type: 'pmtiles', url: publicUrl(world) },
            mapbox: { tilesetId, origin: 'mts' },
        });
        expectNothingAtMapbox(world);
    });

    it('happyPath_aVersionWithNoCogPublishesItsOwnWhateverTheCityChose @S-A70-HAPPY-NO-COG', async () => {
        const output = omit(goldenOutput(), ['cogPath', 'cogBytes', 'cogSha256', 'studioPath', 'studioBytes']);
        const world = await ownWorld(approvedVersion({ output: { ...output, tiles: TILES } }));
        await seedCity(world, { imagery: { publishThroughMapbox: true } });

        await runPublishTask(world.deps, TASK);

        expect(await readVersion(world, JOB)).toMatchObject({ state: 'published', own: { path: PUBLIC_PATH } });
        expectNothingAtMapbox(world);
    });
});

describe('publishing from the own bucket, what holds it', () => {
    it('badPath_aCityThatChoseMapboxStaysOnItsGuard @S-A70-BAD-CITY-CHOSE-MAPBOX', async () => {
        const world = await ownWorld();
        await seedCity(world, { imagery: { publishThroughMapbox: true } });
        world.deps.blobs.put('private', String(goldenOutput().cogPath), ARCHIVE, { contentType: 'image/tiff' });

        await runPublishTask(world.deps, TASK);

        expect(await world.deps.blobs.stat('public', PUBLIC_PATH)).toBeUndefined();
        expect(world.tilesets.published.length + world.uploads.recorder.calls.length).toBeGreaterThan(0);
        expect((await readVersion(world, JOB))?.own).toBeUndefined();
    });

    it('badPath_aPublishMapboxAlreadyWorksOnStaysThere @S-A70-BAD-AT-MAPBOX', async () => {
        const job = awaitingJob({ status: 'mts_processing', waitReason: 'mapbox' });
        const world = await ownWorld(approvedVersion({ state: 'publishing' }), job);
        world.deps.blobs.put('private', String(goldenOutput().cogPath), ARCHIVE, { contentType: 'image/tiff' });

        await runPublishTask(world.deps, TASK);

        expect(await world.deps.blobs.stat('public', PUBLIC_PATH)).toBeUndefined();
    });

    it('badPath_aRedBudgetGuardHoldsItAndNothingIsCopied @S-A70-BAD-GUARD-RED', async () => {
        const world = await ownWorld();
        await seedGuard(world, 'red');

        await runPublishTask(world.deps, TASK);

        expect(world.deps.blobs.recorder.argsOf('copy')).toEqual([]);
        expect(await readJob(world, JOB)).toMatchObject({ status: 'awaiting_approval', waitReason: 'guard' });
        expect(await readVersion(world, JOB)).toMatchObject({ state: 'approved' });
    });

    it('badPath_noTilesYetLeavesItApprovedForTheSweep @S-A70-BAD-NO-TILES', async () => {
        const world = await ownWorld(approvedVersion({ output: goldenOutput() }));

        await runPublishTask(world.deps, TASK);

        expect(world.deps.blobs.recorder.argsOf('copy')).toEqual([]);
        expect(await readVersion(world, JOB)).toMatchObject({ state: 'approved' });
        expect(await readJob(world, JOB)).toMatchObject({ status: 'awaiting_approval' });
        expectNothingAtMapbox(world);
    });

    it('badPath_theArchiveGoneFailsWithItsReasonAndRetryStays @S-A70-BAD-ARCHIVE-GONE', async () => {
        const world = await ownWorld();
        await world.deps.blobs.delete('private', PRIVATE_PATH);

        await runPublishTask(world.deps, TASK);

        expect(await readJob(world, JOB)).toMatchObject({ status: 'failed', error: { code: 'apiError.imagery.tilesGone' } });
        expect(await readVersion(world, JOB)).toMatchObject({ state: 'failed', error: { code: 'apiError.imagery.tilesGone' } });
    });

    it('badPath_aRejectionDuringTheCopyWinsAndItsCopyIsTakenBack @S-A70-BAD-REJECTED-MEANWHILE', async () => {
        const world = await ownWorld();
        const copy = world.deps.blobs.copy.bind(world.deps.blobs);
        const deps = {
            ...world.deps,
            blobs: {
                ...world.deps.blobs,
                copy: async (...args: Parameters<typeof copy>) => {
                    await copy(...args);
                    await rejectFunction(() => world.deps).run(adminCall({ cityId: CITY, versionId: JOB }));
                },
            },
        };

        await runPublishTask(deps, TASK);

        expect(await world.deps.blobs.stat('public', PUBLIC_PATH)).toBeUndefined();
        expect(await readLayer(world, LAYER)).toBeUndefined();
        expect(await readVersion(world, JOB)).toMatchObject({ state: 'rejected' });
    });

    it('badPath_aPublishThatKeepsFailingEndsItsAttemptsAndTakesAnEarlierCopyBack @S-A70-BAD-ATTEMPTS', async () => {
        const world = await ownWorld(approvedVersion(), awaitingJob({ publishAttempts: 6 }));
        // An earlier attempt copied, then died before its finalize.
        world.deps.blobs.put('public', PUBLIC_PATH, ARCHIVE);

        await runPublishTask(world.deps, TASK);

        expect(await world.deps.blobs.stat('public', PUBLIC_PATH)).toBeUndefined();
        expect(await readJob(world, JOB)).toMatchObject({
            status: 'failed',
            error: { code: 'apiError.imagery.attemptsExhausted', params: { attempts: '6' } },
        });
        expect(world.deps.blobs.recorder.argsOf('copy')).toEqual([]);
    });

    it('badPath_aTaskDeliveredAgainAfterTheEndDoesNothing @S-A70-BAD-REDELIVERED', async () => {
        const world = await ownWorld();
        await runPublishTask(world.deps, TASK);
        const after = await readJob(world, JOB);

        await runPublishTask(world.deps, TASK);

        expect(await readJob(world, JOB)).toEqual(after);
        expect(world.deps.blobs.recorder.argsOf('copy')).toHaveLength(1);
    });

    it('badPath_aCopyThatFailsIsRetriedByTheQueue @S-A70-BAD-COPY-FAILS', async () => {
        const world = await ownWorld();
        const deps = { ...world.deps, blobs: { ...world.deps.blobs, copy: () => Promise.reject(new Error('storage down')) } };

        await expect(runPublishTask(deps, TASK)).rejects.toThrow('storage down');

        expect(await readVersion(world, JOB)).toMatchObject({ state: 'approved' });
        expect(await world.deps.documents.get(FIRESTORE_PATHS.job(CITY, JOB), jobDocSchema)).toMatchObject({ publishAttempts: 1 });
    });
});

describe('publishing from the own bucket, a copy left behind', () => {
    it('badPath_aFinalizeThatThrowsTakesItsCopyBackAndARejectionThenLeavesNothingPublic @S-A70-BAD-FINALIZE-THROWS', async () => {
        const world = await ownWorld();
        let copied = false;
        const copy = world.deps.blobs.copy.bind(world.deps.blobs);
        const transaction = world.deps.documents.transaction.bind(world.deps.documents);
        const deps = {
            ...world.deps,
            blobs: {
                ...world.deps.blobs,
                copy: async (...args: Parameters<typeof copy>) => {
                    await copy(...args);
                    copied = true;
                },
            },
            documents: {
                ...world.deps.documents,
                transaction: <T>(work: Parameters<typeof transaction<T>>[0]) =>
                    copied ? Promise.reject(new Error('deadline exceeded')) : transaction(work),
            },
        };

        await expect(runPublishTask(deps, TASK)).rejects.toThrow('deadline exceeded');

        expect(await world.deps.blobs.stat('public', PUBLIC_PATH)).toBeUndefined();
        expect(await readVersion(world, JOB)).toMatchObject({ state: 'approved' });
        await rejectFunction(() => world.deps).run(adminCall({ cityId: CITY, versionId: JOB }));
        expect(await world.deps.blobs.stat('public', PUBLIC_PATH)).toBeUndefined();
    });

    it('badPath_aRejectionOrADismissalDeletesTheCopyADeadPublishLeft @S-A70-BAD-LEFT-COPY', async () => {
        const waiting = await ownWorld();
        waiting.deps.blobs.put('public', PUBLIC_PATH, ARCHIVE);
        await rejectFunction(() => waiting.deps).run(adminCall({ cityId: CITY, versionId: JOB }));

        const failed = await ownWorld(
            approvedVersion({ state: 'failed', error: { code: 'apiError.imagery.attemptsExhausted' } }),
            awaitingJob({ status: 'failed' }),
        );
        failed.deps.blobs.put('public', PUBLIC_PATH, ARCHIVE);
        await rejectFunction(() => failed.deps).run(adminCall({ cityId: CITY, versionId: JOB }));

        for (const world of [waiting, failed]) {
            expect(await world.deps.blobs.stat('public', PUBLIC_PATH)).toBeUndefined();
            expect(await world.deps.blobs.stat('private', PRIVATE_PATH)).toBeUndefined();
            expect(await readVersion(world, JOB)).toMatchObject({ state: 'rejected' });
        }
    });

    it('badPath_tilesOutsideTheVersionsFolderAreNeverCopiedSignedOrDeleted @S-A70-BAD-FOREIGN-TILES', async () => {
        const foreign = {
            ...TILES,
            path: 'rasters/bacau/l-other/v-other/tiles.pmtiles',
            thumbPath: 'rasters/bacau/l-other/v-other/thumb.webp',
        };
        const world = await ownWorld(approvedVersion({ output: { ...goldenOutput(), tiles: foreign } }));
        world.deps.blobs.put('private', foreign.path, ARCHIVE);
        world.deps.blobs.put('private', foreign.thumbPath, ARCHIVE);
        const call = adminCall({ cityId: CITY, versionId: JOB });

        expect((await failureOf(previewUrlFunction(() => world.deps).run(call))).details).toMatchObject({
            code: 'apiError.imagery.tilesGone',
        });
        await runPublishTask(world.deps, TASK);

        expect(world.deps.blobs.recorder.argsOf('copy')).toEqual([]);
        expect(await readVersion(world, JOB)).toMatchObject({ state: 'failed', error: { code: 'apiError.imagery.tilesGone' } });
        await rejectFunction(() => world.deps).run(call);
        expect(await world.deps.blobs.stat('private', foreign.path)).toBeDefined();
        expect(await world.deps.blobs.stat('private', foreign.thumbPath)).toBeDefined();
        expect(await world.deps.blobs.stat('private', PRIVATE_PATH)).toBeUndefined();
    });
});

describe('imagery.previewUrl', () => {
    it('happyPath_anHourOfTheImageBeforeAnyApproval @S-A70-HAPPY-PREVIEW', async () => {
        const world = await ownWorld(approvedVersion({ state: 'awaiting_approval' }));

        const answer = await previewUrlFunction(() => world.deps).run(adminCall({ cityId: CITY, versionId: JOB }));

        expect(answer.url).toContain(PRIVATE_PATH);
        expect(answer.bytes).toBe(ARCHIVE.length);
        expect(new Date(answer.expiresAt).getTime() - new Date(NOW).getTime()).toBe(3_600_000);
    });

    it('badPath_noTilesOrTilesGoneAnswerTheirReason @S-A70-BAD-PREVIEW-NO-TILES', async () => {
        const world = await ownWorld(approvedVersion({ state: 'awaiting_approval', output: goldenOutput() }));
        const call = adminCall({ cityId: CITY, versionId: JOB });
        expect((await failureOf(previewUrlFunction(() => world.deps).run(call))).details).toMatchObject({
            code: 'apiError.imagery.tilesMissing',
        });

        const gone = await ownWorld(approvedVersion({ state: 'awaiting_approval' }));
        await gone.deps.blobs.delete('private', PRIVATE_PATH);
        expect((await failureOf(previewUrlFunction(() => gone.deps).run(call))).details).toMatchObject({
            code: 'apiError.imagery.tilesGone',
        });
    });

    it('happyPath_aPublishedVersionIsSeenFromItsPublicCopy @S-A70-HAPPY-PREVIEW-PUBLISHED', async () => {
        const world = await ownWorld();
        await runPublishTask(world.deps, TASK);
        const buckets: string[] = [];
        const signer = world.deps.signer;
        const deps = {
            ...world.deps,
            signer: {
                ...signer,
                signedObject: (bucket: Parameters<typeof signer.signedObject>[0], request: Parameters<typeof signer.signedObject>[1]) => {
                    buckets.push(bucket);
                    return signer.signedObject(bucket, request);
                },
            },
        };

        const answer = await previewUrlFunction(() => deps).run(adminCall({ cityId: CITY, versionId: JOB }));

        expect(buckets).toEqual(['public']);
        expect(answer.url).toContain(PUBLIC_PATH);
        expect(answer.bytes).toBe(ARCHIVE.length);
    });
});
