/**
 * `imagery.approve`, `imagery.reject`, `imagery.choose` and `imagery.studioDone` (`functions/src/imagery/{approve,
 * studio}.ts`, `docs/research/M3-interfaces.md` §7.1, §7.2, §7.5): the one click when a version did not publish on its
 * own; Reject ends the version and frees what it held; over budget, the admin chooses the free Studio upload, next month
 * or paying the overage (never at the tileset cap), and Studio's tileset is found by its name and becomes the layer's.
 */
import { MAX_TILESETS, jobRetryable, type JobDoc, type LayerVersionDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { approveFunction, rejectFunction } from '../../src/imagery/approve.js';
import { onJobWrite } from '../../src/imagery/on-job-write.js';
import { releaseScenes } from '../../src/imagery/release-scene.js';
import { chooseFunction, studioDoneFunction } from '../../src/imagery/studio.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import {
    CITY,
    MAPBOX_USER,
    NOW,
    at,
    goldenOutput,
    readJob,
    readLayer,
    readScene,
    readUsage,
    readVersion,
    readyWorld,
    renderedVersion,
    seedJob,
    seedLayer,
    seedScene,
    seedSetup,
    seedUsage,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const JOB = 'job-1966-0712';
const LAYER = 'kh-4a-corona-1966';
const REQUEST = { cityId: CITY, versionId: JOB };
/** The job's scratch files, another job's whose id starts the same, another city's and a delivery any city may share. */
const SCRATCH = [
    `work/${CITY}/${JOB}/segments/a.tif`,
    `work/${CITY}/${JOB}/frame.json`,
    `work/${CITY}/${JOB}0/segments/a.tif`,
    `work/iasi/${JOB}/segments/a.tif`,
    'usgs-raw/corona2/DS1035-1057DA023/a.tgz',
] as const;
const KEPT = [...SCRATCH.slice(2)].sort((left, right) => left.localeCompare(right));

function awaitingJob(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'usgs-import',
        status: 'awaiting_approval',
        params: { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' },
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

async function versionWorld(version: LayerVersionDoc = renderedVersion(), job: JobDoc = awaitingJob()): Promise<ImageryWorld> {
    const world = await readyWorld();
    await seedJob(world, JOB, job);
    await seedVersion(world, JOB, version);
    return world;
}

function overBudget(choice?: 'studio' | 'defer' | 'pay', verdict: 'over' | 'tileset-limit' | 'too-large' = 'over'): LayerVersionDoc {
    const guard = {
        verdict,
        available: 2,
        overageUsd: 20.25,
        checkedAt: at(NOW),
        ...(choice === undefined ? {} : { choice, chosenBy: 'u-admin' }),
    };
    return renderedVersion({
        state: 'approved',
        approval: { auto: false, by: 'u-admin', at: at(NOW) },
        estimate: { computeUnits: 24.5, precision: '30cm', areaKm2: 612.5, at: at(NOW) },
        guard,
    });
}

describe('imagery.approve', () => {
    it('happyPath_oneClickApprovesAndQueuesThePublish', async () => {
        const world = await versionWorld();

        const response = await approveFunction(() => world.deps).run(adminCall(REQUEST));

        expect(response).toEqual({ state: 'approved', jobId: JOB });
        expect(await readVersion(world, JOB)).toMatchObject({
            state: 'approved',
            approval: { auto: false, by: 'u-admin', at: at(NOW) },
            estimate: { computeUnits: 24.5 },
            updatedBy: 'u-admin',
        });
        expect(world.deps.tasks.queued).toEqual([
            {
                queue: 'imagery-publish',
                payload: { cityId: CITY, jobId: JOB, phase: 'start', poll: 0 },
                options: { id: `${CITY}-${JOB}-approved` },
            },
        ]);
    });

    it('badPath_onlyAVersionAwaitingApprovalCanBeApproved', async () => {
        const world = await versionWorld(renderedVersion({ state: 'published', mapbox: { tilesetId: 'e2e-mapbox.x', origin: 'mts' } }));

        const twice = await failureOf(approveFunction(() => world.deps).run(adminCall(REQUEST)));
        const missing = await failureOf(approveFunction(() => world.deps).run(adminCall({ cityId: CITY, versionId: 'nope' })));

        expect(twice).toMatchObject({ code: 'failed-precondition', details: { code: 'apiError.imagery.versionState' } });
        expect(missing).toMatchObject({ code: 'not-found' });
        expect(world.deps.tasks.queued).toEqual([]);
    });
});

describe('imagery.reject', () => {
    it('happyPath_aRejectedImportFreesItsSceneAndItsLayerId', async () => {
        const world = await versionWorld();
        await seedScene(world, 'DS1035-1057DA023', { status: 'imported', layerId: LAYER });

        await expect(rejectFunction(() => world.deps).run(adminCall(REQUEST))).resolves.toEqual({ state: 'rejected' });

        expect((await readVersion(world, JOB))?.state).toBe('rejected');
        expect(await readJob(world, JOB)).toMatchObject({ status: 'cancelled', updatedBy: 'u-admin' });
        expect(await readScene(world, 'DS1035-1057DA023')).toMatchObject({ status: 'candidate' });
    });

    it('happyPath_aDismissedFailedImportCanBeImportedAgain @S-A12-HAPPY-DISMISS-IMPORT-AGAIN', async () => {
        const world = await versionWorld();
        await seedVersion(world, JOB, renderedVersion({ state: 'failed', error: { code: 'apiError.imagery.cityNotFound' } }));
        await seedScene(world, 'DS1035-1057DA023', { status: 'imported', layerId: LAYER });

        await expect(rejectFunction(() => world.deps).run(adminCall(REQUEST))).resolves.toEqual({ state: 'rejected' });

        const scene = await readScene(world, 'DS1035-1057DA023');
        expect(scene).toMatchObject({ status: 'candidate' });
        expect(scene?.layerId).toBeUndefined();
    });

    it('badPath_aDismissedVersionLeavesASceneAnotherVersionOrItsLayerHolds @S-A12-BAD-DISMISS-SCENE-HELD', async () => {
        const world = await versionWorld();
        await seedVersion(world, JOB, renderedVersion({ state: 'failed', error: { code: 'apiError.imagery.cityNotFound' } }));
        await seedVersion(
            world,
            'job-other',
            renderedVersion({ state: 'failed', jobId: 'job-other', error: { code: 'apiError.imagery.cityNotFound' } }),
        );
        await seedScene(world, 'DS1035-1057DA023', { status: 'imported', layerId: LAYER });

        await rejectFunction(() => world.deps).run(adminCall(REQUEST));

        expect(await readScene(world, 'DS1035-1057DA023')).toMatchObject({ status: 'imported', layerId: LAYER });
    });

    it('happyPath_theTickFreesASceneAnEarlierDismissalLeftReserved', async () => {
        const world = await versionWorld();
        await seedVersion(world, JOB, renderedVersion({ state: 'rejected' }));
        await seedScene(world, 'DS1035-1057DA023', { status: 'imported', layerId: LAYER });
        await seedScene(world, 'DS-NO-LAYER-ID', { status: 'candidate' });

        await releaseScenes(world.deps, CITY);

        expect(await readScene(world, 'DS1035-1057DA023')).toMatchObject({ status: 'candidate' });
    });

    it('badPath_aSceneWhoseLayerExistsOrThatReservedNoneStaysImported', async () => {
        const world = await versionWorld();
        await seedVersion(world, JOB, renderedVersion({ state: 'rejected' }));
        await seedLayer(world, LAYER);
        await seedScene(world, 'DS1035-1057DA023', { status: 'imported', layerId: LAYER });
        await seedScene(world, 'DS-NO-LAYER-ID', { status: 'imported' });

        await releaseScenes(world.deps, CITY);

        expect(await readScene(world, 'DS1035-1057DA023')).toMatchObject({ status: 'imported', layerId: LAYER });
        expect(await readScene(world, 'DS-NO-LAYER-ID')).toMatchObject({ status: 'imported' });
    });

    it.each([
        [
            'a published version',
            renderedVersion({ state: 'published', mapbox: { tilesetId: 'e2e-mapbox.x', origin: 'mts' } }),
            awaitingJob({ status: 'succeeded' }),
        ],
        ['a version at Mapbox', overBudget(), awaitingJob({ status: 'mts_processing' })],
        ['a version whose job is gone', renderedVersion({ jobId: 'gone' }), awaitingJob()],
    ])('badPath_cannotBeRejected_%s', async (_case, version, job) => {
        const world = await versionWorld(version, job);

        const failure = await failureOf(rejectFunction(() => world.deps).run(adminCall(REQUEST)));

        expect(failure).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
    });

    it('happyPath_aFailedVersionIsDismissed @S-A12-BAD-FAILED-DISMISSED', async () => {
        const failedJob = awaitingJob({ status: 'failed', error: { code: 'apiError.imagery.mtsRefused', message: 'x' } });
        const world = await versionWorld(renderedVersion({ state: 'failed', error: { code: 'apiError.imagery.mtsRefused' } }), failedJob);

        await expect(rejectFunction(() => world.deps).run(adminCall(REQUEST))).resolves.toEqual({ state: 'rejected' });

        expect(await readVersion(world, JOB)).toMatchObject({ state: 'rejected', updatedBy: 'u-admin' });
        expect((await readJob(world, JOB))?.status).toBe('failed');
    });

    it('badPath_aVersionThatLeftFailedMeanwhileIsNotDismissed @S-A12-BAD-FAILED-DISMISSED', async () => {
        const world = await versionWorld(renderedVersion({ state: 'failed', error: { code: 'apiError.imagery.mtsRefused' } }));
        const original = world.deps.documents.transaction.bind(world.deps.documents);
        world.deps.documents.transaction = (async (work: Parameters<typeof original>[0]) => {
            await seedVersion(world, JOB, renderedVersion({ state: 'processing' }));
            return original(work);
        }) as typeof original;

        const failure = await failureOf(rejectFunction(() => world.deps).run(adminCall(REQUEST)));

        expect(failure).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
        expect((await readVersion(world, JOB))?.state).toBe('processing');
    });

    it('badPath_aVersionTheGuardSentToMapboxMeanwhileIsNotRejected @S-A12-BAD-CANCEL-BEFORE-MAPBOX', async () => {
        const world = await versionWorld(overBudget());
        await seedUsage(world, '2026-10', { reservations: { [JOB]: { computeUnits: 24.5, at: at(NOW) } } });
        const original = world.deps.documents.transaction.bind(world.deps.documents);
        world.deps.documents.transaction = (async (work: Parameters<typeof original>[0]) => {
            await seedJob(world, JOB, awaitingJob({ status: 'mts_processing', waitReason: 'mapbox' }));
            return original(work);
        }) as typeof original;

        const failure = await failureOf(rejectFunction(() => world.deps).run(adminCall(REQUEST)));

        expect(failure).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
        expect((await readJob(world, JOB))?.status).toBe('mts_processing');
        expect((await readUsage(world, '2026-10'))?.reservations).toEqual({ [JOB]: { computeUnits: 24.5, at: at(NOW) } });
    });

    it('badPath_aJobThatFinishedMeanwhileIsNotRejectedTwice', async () => {
        const world = await versionWorld();
        const original = world.deps.documents.transaction.bind(world.deps.documents);
        world.deps.documents.transaction = (async (work: Parameters<typeof original>[0]) => {
            await seedJob(world, JOB, awaitingJob({ status: 'cancelled' }));
            return original(work);
        }) as typeof original;

        const failure = await failureOf(rejectFunction(() => world.deps).run(adminCall(REQUEST)));

        expect(failure).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
    });
});

describe('imagery.reject: what a dismissal leaves', () => {
    it('happyPath_aDismissalReleasesOnlyItsOwnScene_theTickTheOthers', async () => {
        const world = await versionWorld();
        await seedVersion(world, JOB, renderedVersion({ state: 'failed', error: { code: 'apiError.imagery.cityNotFound' } }));
        await seedScene(world, 'DS1035-1057DA023', { status: 'imported', layerId: LAYER });
        await seedScene(world, 'DS-LEFT-BEHIND', { status: 'imported', layerId: 'no-such-layer' });

        await rejectFunction(() => world.deps).run(adminCall(REQUEST));

        expect(await readScene(world, 'DS1035-1057DA023')).toMatchObject({ status: 'candidate' });
        expect(await readScene(world, 'DS-LEFT-BEHIND')).toMatchObject({ status: 'imported' });

        await releaseScenes(world.deps, CITY);

        expect(await readScene(world, 'DS-LEFT-BEHIND')).toMatchObject({ status: 'candidate' });
    });

    it('badPath_aDismissedUploadHasNoSceneToRelease', async () => {
        const world = await versionWorld();
        const source = { kind: 'upload', uploadPath: 'uploads/rasters/bucharest/u/x/a.tif', bytes: 10 } as const;
        await seedVersion(
            world,
            JOB,
            renderedVersion({ state: 'failed', origin: 'upload', source, error: { code: 'apiError.imagery.cityNotFound' } }),
        );
        await seedScene(world, 'DS1035-1057DA023', { status: 'imported', layerId: LAYER });

        await expect(rejectFunction(() => world.deps).run(adminCall(REQUEST))).resolves.toEqual({ state: 'rejected' });

        expect(await readScene(world, 'DS1035-1057DA023')).toMatchObject({ status: 'imported' });
    });

    it('happyPath_aDismissedVersionsFailedJobOffersNoRetry @S-A12-BAD-RETRY-DISMISSED', async () => {
        const failure = { code: 'apiError.imagery.cityNotFound', message: 'x' };
        const world = await versionWorld(
            renderedVersion({ state: 'failed', error: { code: 'apiError.imagery.cityNotFound' } }),
            awaitingJob({ status: 'failed', waitReason: undefined, error: failure }),
        );

        await rejectFunction(() => world.deps).run(adminCall(REQUEST));

        const job = await readJob(world, JOB);
        expect(job).toMatchObject({ status: 'failed', cancelRequested: true, error: failure, updatedBy: 'u-admin' });
        expect(job === undefined ? true : jobRetryable(job)).toBe(false);
    });

    it('badPath_theDismissalsMarkStopsNoRunAndAsksNothing @S-A12-BAD-RETRY-DISMISSED', async () => {
        const failure = { code: 'apiError.imagery.cityNotFound', message: 'x' };
        const job = awaitingJob({ status: 'failed', waitReason: undefined, error: failure, executionName: 'runs/ended' });
        const world = await versionWorld(renderedVersion({ state: 'failed', error: { code: 'apiError.imagery.cityNotFound' } }), job);

        await rejectFunction(() => world.deps).run(adminCall(REQUEST));
        const after = await readJob(world, JOB);
        expect(await onJobWrite(world.deps, CITY, JOB, { before: job, after })).toBe('cancel');

        expect(world.jobs.recorder.argsOf('cancel')).toEqual([]);
        expect(await readJob(world, JOB)).toMatchObject({ status: 'failed', cancelRequested: true });
    });

    it('happyPath_aDismissalDeletesItsJobsScratchFilesOnly', async () => {
        const world = await versionWorld();
        await seedVersion(world, JOB, renderedVersion({ state: 'failed', error: { code: 'apiError.imagery.cityNotFound' } }));
        for (const path of SCRATCH) {
            world.deps.blobs.put('private', path, new Uint8Array([1]));
        }

        await rejectFunction(() => world.deps).run(adminCall(REQUEST));

        expect(world.deps.blobs.paths('private', '')).toEqual(KEPT);
    });

    it('happyPath_aRejectionDeletesItsJobsScratchFiles', async () => {
        const world = await versionWorld();
        for (const path of SCRATCH) {
            world.deps.blobs.put('private', path, new Uint8Array([1]));
        }

        await rejectFunction(() => world.deps).run(adminCall(REQUEST));

        expect(world.deps.blobs.paths('private', '')).toEqual(KEPT);
    });

    it('badPath_scratchFilesThatCannotBeDeletedAreLeftToTheLifecycle', async () => {
        const world = await versionWorld();
        await seedVersion(world, JOB, renderedVersion({ state: 'failed', error: { code: 'apiError.imagery.cityNotFound' } }));
        world.deps.blobs.put('private', SCRATCH[0], new Uint8Array([1]));
        world.deps.blobs.recorder.failNext('list', new UpstreamError('cloud-storage', 'unavailable', { status: 503 }));

        await expect(rejectFunction(() => world.deps).run(adminCall(REQUEST))).resolves.toEqual({ state: 'rejected' });

        expect(world.deps.blobs.paths('private', 'work/')).toEqual([SCRATCH[0]]);
        expect(world.deps.recording.records.map((record) => record.message)).toContain('scratch files left to the lifecycle');
    });

    it('happyPath_theTickReadsOneLayerForASceneWhoseLayerExists', async () => {
        const world = await versionWorld();
        await seedLayer(world, LAYER);
        await seedScene(world, 'DS1035-1057DA023', { status: 'imported', layerId: LAYER });
        const recorder = world.deps.documents.recorder;
        const queries = () => recorder.argsOf('query').length;
        const [queriesBefore, transactionsBefore] = [queries(), recorder.argsOf('transaction').length];

        await releaseScenes(world.deps, CITY);

        expect(queries() - queriesBefore).toBe(1);
        expect(recorder.argsOf('transaction')).toHaveLength(transactionsBefore);
    });

    it('badPath_aSceneOfALayerInItsDeletionsGraceStaysImported', async () => {
        const world = await versionWorld();
        await seedVersion(world, JOB, renderedVersion({ state: 'published', mapbox: { tilesetId: 'a.b', origin: 'mts' } }));
        await seedJob(world, 'ld-1', {
            type: 'layer-delete',
            status: 'queued',
            params: { layerId: LAYER },
            createdBy: 'u-admin',
            createdAt: at(NOW),
            updatedBy: 'u-admin',
            updatedAt: at(NOW),
        });
        await seedScene(world, 'DS1035-1057DA023', { status: 'imported', layerId: LAYER });

        await releaseScenes(world.deps, CITY);

        expect(await readScene(world, 'DS1035-1057DA023')).toMatchObject({ status: 'imported', layerId: LAYER });
    });
});

describe('imagery.choose', () => {
    function choose(world: ImageryWorld, choice: 'studio' | 'defer' | 'pay') {
        return chooseFunction(() => world.deps).run(adminCall({ ...REQUEST, choice }));
    }

    it('happyPath_deferWaitsForTheFirstOfNextMonth @S-A42-HAPPY-DEFER', async () => {
        const world = await versionWorld(overBudget());

        await expect(choose(world, 'defer')).resolves.toEqual({ state: 'approved', deferUntil: '2026-11-01T00:00:00.000Z' });

        expect(await readVersion(world, JOB)).toMatchObject({
            guard: { verdict: 'over', choice: 'defer', chosenBy: 'u-admin', chosenAt: at(NOW), deferUntil: at('2026-11-01T00:00:00.000Z') },
        });
        expect(await readJob(world, JOB)).toMatchObject({ waitReason: 'deferred' });
        expect(world.deps.tasks.queued).toEqual([]);
    });

    it('happyPath_studioGivesTheFileToUpload', async () => {
        const world = await versionWorld(overBudget());

        await expect(choose(world, 'studio')).resolves.toEqual({ state: 'approved', studioPath: goldenOutput().studioPath });
        expect((await readVersion(world, JOB))?.guard?.choice).toBe('studio');
    });

    it('happyPath_payAddsTheOverageAndReservesTheEstimate', async () => {
        const world = await versionWorld(overBudget());
        await seedUsage(world, '2026-10', { computeUnits: 18 });

        await expect(choose(world, 'pay')).resolves.toEqual({ state: 'approved' });

        expect(await readUsage(world, '2026-10')).toMatchObject({
            overageComputeUnits: 22.5,
            reservations: { [JOB]: { computeUnits: 24.5, at: at(NOW) } },
        });
        expect(world.deps.tasks.queued).toEqual([
            {
                queue: 'imagery-publish',
                payload: { cityId: CITY, jobId: JOB, phase: 'start', poll: 0 },
                options: { id: `${CITY}-${JOB}-paid` },
            },
        ]);
    });

    it('happyPath_payOnAMonthWithoutACounterStartsOne', async () => {
        const world = await versionWorld(overBudget());

        await choose(world, 'pay');

        expect(await readUsage(world, '2026-10')).toMatchObject({
            month: '2026-10',
            computeUnits: 0,
            computeUnitBudget: 20,
            overageComputeUnits: 4.5,
        });
    });

    it('badPath_noPayChoiceAtTheTilesetCap @S-A42-BAD-TILESET-LIMIT', async () => {
        const world = await versionWorld(overBudget(undefined, 'tileset-limit'));

        const failure = await failureOf(choose(world, 'pay'));

        expect(failure).toMatchObject({
            code: 'failed-precondition',
            details: { code: 'apiError.imagery.tilesetLimit', params: { limit: String(MAX_TILESETS) } },
        });
        expect(await readUsage(world, '2026-10')).toBeUndefined();
        // Waiting a month frees no tileset either: only the Studio way is left.
        expect(await failureOf(choose(world, 'defer'))).toMatchObject({ details: { code: 'apiError.imagery.tilesetLimit' } });
        await expect(choose(world, 'studio')).resolves.toMatchObject({ state: 'approved' });
    });

    it('badPath_aFileTooLargeForMapboxHasOnlyTheStudioWay @S-A42-BAD-SOURCE-TOO-LARGE', async () => {
        const world = await versionWorld(overBudget(undefined, 'too-large'));

        expect(await failureOf(choose(world, 'pay'))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
        expect(await failureOf(choose(world, 'defer'))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
        await expect(choose(world, 'studio')).resolves.toEqual({ state: 'approved', studioPath: goldenOutput().studioPath });
    });

    it('badPath_aVersionThatFitsHasNothingToChoose', async () => {
        const world = await versionWorld(renderedVersion());

        expect(await failureOf(choose(world, 'studio'))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
        expect(
            await failureOf(chooseFunction(() => world.deps).run(adminCall({ cityId: CITY, versionId: 'nope', choice: 'defer' }))),
        ).toMatchObject({
            code: 'not-found',
        });
    });

    it('happyPath_aStudioVersionWithoutAStudioFileAnswersItsState', async () => {
        const world = await versionWorld({ ...overBudget(), output: { ...goldenOutput(), studioPath: undefined } });

        await expect(choose(world, 'studio')).resolves.toEqual({ state: 'approved' });
    });

    it('happyPath_aDeferredJobThatIsGoneStillRecordsTheChoice', async () => {
        const world = await versionWorld(overBudget());
        await world.deps.documents.delete(`cities/${CITY}/jobs/${JOB}`);

        await expect(choose(world, 'defer')).resolves.toMatchObject({ deferUntil: '2026-11-01T00:00:00.000Z' });
    });
});

describe('imagery.studioDone', () => {
    function done(world: ImageryWorld) {
        return studioDoneFunction(() => world.deps).run(adminCall(REQUEST));
    }

    it('happyPath_theStudioTilesetBecomesTheLayersTiles', async () => {
        const world = await versionWorld(overBudget('studio'));
        world.tilesets.listed.push({ id: `${MAPBOX_USER}.cl-studio-upload`, name: `hcm-${CITY}-${LAYER}` });

        await expect(done(world)).resolves.toEqual({ tilesetId: `${MAPBOX_USER}.cl-studio-upload`, layerId: LAYER });

        expect(await readLayer(world, LAYER)).toMatchObject({
            source: { type: 'mapbox', tilesetId: `${MAPBOX_USER}.cl-studio-upload` },
            mapbox: { tilesetId: `${MAPBOX_USER}.cl-studio-upload`, origin: 'studio' },
            currentVersion: JOB,
            published: true,
        });
        expect((await readLayer(world, LAYER))?.mapbox?.publishedSourceSha).toBeUndefined();
        expect(await readVersion(world, JOB)).toMatchObject({ state: 'published', mapbox: { origin: 'studio' } });
        expect(await readUsage(world, '2026-10')).toMatchObject({ studioUploads: 1, computeUnits: 0, publishes: 0 });
        expect((await readJob(world, JOB))?.status).toBe('succeeded');
    });

    it('badPath_aTilesetNotFoundIsSaid', async () => {
        const world = await versionWorld(overBudget('studio'));
        world.tilesets.listed.push({ id: `${MAPBOX_USER}.other`, name: 'something-else' });

        expect(await failureOf(done(world))).toMatchObject({ code: 'not-found', details: { code: 'apiError.imagery.studioNotFound' } });
    });

    it('badPath_theLayersOwnMtsTilesetIsNotAStudioUpload @S-A42-BAD-STUDIO-NOT-UPLOADED', async () => {
        const world = await versionWorld(overBudget('studio'));
        const own = `${MAPBOX_USER}.hcm-${CITY}-${LAYER}`;
        await seedLayer(world, LAYER, { mapbox: { tilesetId: own, origin: 'mts' }, source: { type: 'mapbox', tilesetId: own } });
        world.tilesets.listed.push({ id: own, name: `hcm-${CITY}-${LAYER}` });

        expect(await failureOf(done(world))).toMatchObject({ details: { code: 'apiError.imagery.studioNotFound' } });
        expect((await readVersion(world, JOB))?.state).toBe('approved');
    });

    it('badPath_aTilesetOlderThanTheChoiceIsNotTheUpload @S-A42-BAD-STUDIO-NOT-UPLOADED', async () => {
        const world = await versionWorld({
            ...overBudget('studio'),
            guard: { ...overBudget('studio').guard, chosenAt: at(NOW) } as LayerVersionDoc['guard'],
        });
        world.tilesets.listed.push({ id: `${MAPBOX_USER}.cl-old`, name: `hcm-${CITY}-${LAYER}`, created: '2026-10-01T00:00:00.000Z' });

        expect(await failureOf(done(world))).toMatchObject({ details: { code: 'apiError.imagery.studioNotFound' } });

        world.tilesets.listed.push({ id: `${MAPBOX_USER}.cl-new`, name: `hcm-${CITY}-${LAYER}`, created: '2026-10-23T08:10:00.000Z' });
        await expect(done(world)).resolves.toEqual({ tilesetId: `${MAPBOX_USER}.cl-new`, layerId: LAYER });
    });

    it('badPath_onlyAfterTheStudioChoice', async () => {
        const world = await versionWorld(overBudget('defer'));

        expect(await failureOf(done(world))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
    });

    it('badPath_withoutMapboxItCannotLook', async () => {
        const world = await versionWorld(overBudget('studio'));
        await seedSetup(world, { mapbox: { state: 'missing' } });

        expect(await failureOf(done(world))).toMatchObject({ details: { code: 'apiError.mapbox.notConfigured' } });
    });

    it('badPath_aCounterOfTheMonthIsCreatedForTheUpload', async () => {
        const world = await versionWorld(overBudget('studio'));
        await seedUsage(world, '2026-10', { studioUploads: 2, computeUnits: 5 });
        world.tilesets.listed.push({ id: `${MAPBOX_USER}.hcm-${CITY}-${LAYER}` });

        await done(world);

        expect(await readUsage(world, '2026-10')).toMatchObject({ studioUploads: 3, computeUnits: 5 });
    });
});
