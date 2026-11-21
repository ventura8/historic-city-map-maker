/**
 * `worker.hello` and `worker.claim` (`functions/src/worker/{hello,claim}.ts`, `docs/research/M7-local-worker.md` §1.2,
 * §2.4): a worker introduces itself, then takes the oldest due queued job of its city chosen for the owner's computer,
 * leased to it in one transaction; nothing else (a cloud job, a job not due, cancelled or out of attempts) is ever taken.
 */
import {
    FIRESTORE_PATHS,
    HEARTBEAT_SECONDS,
    JOB_MAX_ATTEMPTS,
    LEASE_SECONDS,
    WORKER_FRESH_SECONDS,
    WORKER_IDLE_POLL_SECONDS,
    WORKER_POLL_SECONDS,
    jobDocSchema,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { omit } from '../../src/api/objects.js';
import { claimFunction } from '../../src/worker/claim.js';
import { helloFunction } from '../../src/worker/hello.js';
import { failureOf } from '../admin/world.js';
import { readJob, seedGuard, seedJob } from '../imagery/world.js';
import {
    CITY,
    NOW,
    OTHER,
    OTHER_WORKER,
    WORKER,
    at,
    callAs,
    localJob,
    minutes,
    readWorker,
    seedWorker,
    workerWorld,
    type WorkerWorld,
} from './world.js';

const THIRD_WORKER = 'w-1111111111111111';

const ARCHIVE_PARAMS = {
    archiveId: 'ar-0123456789abcdef',
    seriesId: 's-0123456789ab',
    class: 'grid',
    sheets: 4,
    encoding: 'lineart',
    order: 0,
    referenceLayerIds: [],
};

function claim(world: WorkerWorld, workerId = WORKER, uid?: string) {
    return callAs(world, claimFunction, { workerId }, uid);
}

function hello(world: WorkerWorld, version = '1.0.0', uid?: string) {
    return callAs(world, helloFunction, { workerId: WORKER, version }, uid);
}

/** Two queued local jobs (`j-old` the older) and an older cloud job; both workers said hello. */
async function queuedWorld(): Promise<WorkerWorld> {
    const world = await workerWorld();
    await seedWorker(world);
    await seedWorker(world, OTHER_WORKER, { uid: OTHER, updatedBy: OTHER });
    await seedJob(world, 'j-cloud', localJob({ runOn: 'cloud', createdAt: minutes(-300), waitReason: 'capacity' }));
    await seedJob(world, 'j-old', localJob({ createdAt: minutes(-120), machine: 'std', retryAt: minutes(-5) }));
    await seedJob(world, 'j-new', omit(localJob({ createdAt: minutes(-60) }), ['attempt']));
    return world;
}

describe('worker.claim', () => {
    it('badPath_aJoinWaitingForItsFramesIsNotClaimed_onceTheyAreThereItIs @S-A65-BAD-PART-NEEDS-POINTS', async () => {
        const world = await workerWorld();
        await seedWorker(world);
        const parts = [
            { versionId: 'v-f039', layerId: 'l-f039' },
            { versionId: 'v-f040', layerId: 'l-f040' },
        ];
        const held = localJob({ type: 'layer-join', params: { parts, sensor: 'KH-9-pan' }, waitReason: 'parts' });
        await seedJob(world, 'jn-1', held);

        await expect(claim(world)).resolves.toEqual({ job: null });
        expect((await readJob(world, 'jn-1'))?.status).toBe('queued');

        await seedJob(world, 'jn-1', { ...held, waitReason: 'worker' });
        await expect(claim(world)).resolves.toEqual({ job: { jobId: 'jn-1' } });
    });

    it('happyPath_aWorkerClaimsTheOldestDueLocalJob @S-A62-HAPPY-CLAIM', async () => {
        const world = await queuedWorld();

        await expect(claim(world)).resolves.toEqual({ job: { jobId: 'j-old' } });

        const job = await readJob(world, 'j-old');
        expect(job).toMatchObject({
            status: 'starting',
            attempt: 1,
            dispatchAt: at(NOW),
            lease: { owner: `worker:${WORKER}`, until: at(new Date(Date.parse(NOW) + LEASE_SECONDS * 1000).toISOString()) },
            worker: { id: WORKER, uid: 'u-admin', claimedAt: at(NOW) },
            updatedBy: 'system:imagery',
        });
        expect(job).not.toHaveProperty('machine');
        expect(job).not.toHaveProperty('waitReason');
        await expect(readWorker(world)).resolves.toMatchObject({ state: 'busy', jobId: 'j-old', lastSeenAt: at(NOW) });
    });

    it('happyPath_anotherWorkerGetsTheNextOneAndThenThereIsNone @S-A62-HAPPY-CLAIM', async () => {
        const world = await queuedWorld();
        await claim(world);

        await expect(claim(world, OTHER_WORKER, OTHER)).resolves.toEqual({ job: { jobId: 'j-new' } });
        // A worker claims only when it runs nothing (a busy one's claim releases its orphan: cleanup.test.ts): a third one finds none.
        await seedWorker(world, THIRD_WORKER, { uid: OTHER, updatedBy: OTHER });
        await expect(claim(world, THIRD_WORKER, OTHER)).resolves.toEqual({ job: null });

        expect(await readJob(world, 'j-new')).toMatchObject({ attempt: 1, worker: { id: OTHER_WORKER, uid: OTHER } });
        await expect(readJob(world, 'j-cloud')).resolves.toMatchObject({ status: 'queued', waitReason: 'capacity' });
        const third = await readWorker(world, THIRD_WORKER);
        expect(third).toMatchObject({ state: 'idle', lastSeenAt: at(NOW) });
        expect(third).not.toHaveProperty('jobId');
    });

    it.each([
        ['not due yet', localJob({ retryAt: minutes(5) })],
        ['dispatched later', localJob({ dispatchAt: minutes(5) })],
        ['asked to cancel', localJob({ cancelRequested: true })],
        ['out of attempts', localJob({ attempt: JOB_MAX_ATTEMPTS })],
        ['a layer deletion', localJob({ type: 'layer-delete', params: { layerId: 'kh-4a-corona-1966' } })],
        ['already starting', localJob({ status: 'starting' })],
    ])('badPath_aLocalJob%sIsNotTaken @S-A62-HAPPY-CLAIM', async (_name, job) => {
        const world = await workerWorld();
        await seedWorker(world);
        await seedJob(world, 'j-1', job);

        await expect(claim(world)).resolves.toEqual({ job: null });
        await expect(readJob(world, 'j-1')).resolves.toEqual(job);
    });

    it('happyPath_aWorkerTakesOnlyTheTypesItsPipelineRuns_theOtherStaysQueued @S-A12-HAPPY-RETRY-OUTDATED', async () => {
        const world = await queuedWorld();
        await seedJob(world, 'j-archive', localJob({ type: 'archive-series', params: ARCHIVE_PARAMS, createdAt: minutes(-200) }));

        await expect(callAs(world, claimFunction, { workerId: WORKER, types: ['usgs-import'] })).resolves.toEqual({
            job: { jobId: 'j-old' },
        });

        await expect(readJob(world, 'j-archive')).resolves.toMatchObject({ status: 'queued' });
    });

    it('badPath_aWorkerWhosePipelineRunsNoneOfTheQueuedTypesTakesNothing @S-A12-HAPPY-RETRY-OUTDATED', async () => {
        const world = await queuedWorld();

        await expect(callAs(world, claimFunction, { workerId: WORKER, types: ['layer-tiles'] })).resolves.toEqual({ job: null });
    });

    it('badPath_aJobAnotherWorkerTookFirstIsNotTakenAgain', async () => {
        const world = await queuedWorld();
        const { documents } = world.deps;
        const racing: typeof documents = {
            ...documents,
            transaction: (work) => {
                documents.seed(FIRESTORE_PATHS.job(CITY, 'j-old'), { ...localJob({ createdAt: minutes(-120) }), status: 'starting' });
                documents.seed(FIRESTORE_PATHS.job(CITY, 'j-new'), { ...localJob(), status: 'starting' });
                return documents.transaction(work);
            },
        };
        const raced: WorkerWorld = { ...world, deps: { ...world.deps, documents: racing } };

        await expect(claim(raced)).resolves.toEqual({ job: null });
        await expect(documents.get(FIRESTORE_PATHS.job(CITY, 'j-old'), jobDocSchema)).resolves.not.toHaveProperty('worker');
    });

    it.each([
        ['no hello first', async (world: WorkerWorld) => world.deps.documents.delete(FIRESTORE_PATHS.worker(CITY, WORKER))],
        ['a worker id another account said hello with', (world: WorkerWorld) => seedWorker(world, WORKER, { uid: OTHER })],
    ])('badPath_%sIsRefused', async (_name, arrange) => {
        const world = await queuedWorld();
        await arrange(world);

        await expect(failureOf(claim(world))).resolves.toMatchObject({ details: { code: 'apiError.worker.refused' } });
        await expect(readJob(world, 'j-old')).resolves.toMatchObject({ status: 'queued' });
    });

    it('badPath_nothingIsClaimedWhileTheGuardIsRed', async () => {
        const world = await queuedWorld();
        await seedGuard(world, 'red');

        await expect(failureOf(claim(world))).resolves.toMatchObject({ details: { code: 'apiError.guardPaused' } });
        await expect(readJob(world, 'j-old')).resolves.toMatchObject({ status: 'queued' });
    });
});

describe('worker.hello', () => {
    it('happyPath_anIdleWorkersLongestWaitWithItsJitterKeepsItConnected @S-P31-HAPPY-CLAIM-BACKOFF', () => {
        // The worker waits up to a tenth more than `idlePollSeconds` (`pipeline/src/hcm_pipeline/worker/pace.py`): it must be seen again
        // well within the time it counts as connected.
        expect(WORKER_IDLE_POLL_SECONDS * 1.1 + 2 * WORKER_POLL_SECONDS).toBeLessThan(WORKER_FRESH_SECONDS);
        // A new job never waits more than a minute (the owner, 2026-11-13).
        expect(WORKER_IDLE_POLL_SECONDS).toBeLessThanOrEqual(60);
    });

    it('happyPath_aNewWorkerIsRecordedIdleAndToldItsIntervals', async () => {
        const world = await workerWorld();

        await expect(hello(world)).resolves.toEqual({
            pollSeconds: WORKER_POLL_SECONDS,
            // An idle worker may ask less often, but never so rarely that one wait (a tenth longer with its jitter) disconnects it.
            idlePollSeconds: WORKER_IDLE_POLL_SECONDS,
            heartbeatSeconds: HEARTBEAT_SECONDS,
            outdated: false,
        });
        await expect(readWorker(world)).resolves.toEqual({
            uid: 'u-admin',
            version: '1.0.0',
            startedAt: at(NOW),
            lastSeenAt: at(NOW),
            state: 'idle',
            outdated: false,
            updatedBy: 'u-admin',
            updatedAt: at(NOW),
        });
    });

    it('happyPath_aSecondHelloKeepsWhenItStartedAndWhatItDoes', async () => {
        const world = await workerWorld();
        await seedWorker(world, WORKER, { state: 'busy', jobId: 'j-1' });

        await hello(world, '1.0.1');

        await expect(readWorker(world)).resolves.toMatchObject({
            version: '1.0.1',
            startedAt: minutes(-30),
            lastSeenAt: at(NOW),
            state: 'busy',
            jobId: 'j-1',
        });
    });

    it('badPath_anotherAccountCannotTakeOverAWorkerId', async () => {
        const world = await workerWorld();
        await seedWorker(world);

        await expect(failureOf(hello(world, '1.0.0', OTHER))).resolves.toMatchObject({ details: { code: 'apiError.worker.refused' } });
        await expect(readWorker(world)).resolves.toMatchObject({ uid: 'u-admin' });
    });

    it('badPath_aWorkerCannotStartWhileTheGuardIsRed', async () => {
        const world = await workerWorld();
        await seedGuard(world, 'red');

        await expect(failureOf(hello(world))).resolves.toMatchObject({ details: { code: 'apiError.guardPaused' } });
        await expect(readWorker(world)).resolves.toBeUndefined();
    });
});
