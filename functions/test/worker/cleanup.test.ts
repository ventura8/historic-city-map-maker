/**
 * What `worker.claim` does for the worker's own computer besides a job (`functions/src/worker/cleanup.ts`, the resilience audit and
 * the cleanup brief of 2026-11-14): a job its computer stopped running (a power cut or a crash) is queued again at the next claim with
 * its attempt given back; the held jobs' states come with the answer (`gone` for one that no longer exists); the disk is recorded
 * and, below the worker's floor, no job is taken (`lowDisk`); "Free space now" (`worker.manage` `freeSpace`) is answered
 * `freeSpace` until the worker says what it freed.
 */
import { FIRESTORE_PATHS, LOST_HAND_OVER_MS, jobLogDocSchema } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { claimFunction } from '../../src/worker/claim.js';
import { manageFunction } from '../../src/worker/manage.js';
import { failureOf } from '../admin/world.js';
import { readJob, seedJob } from '../imagery/world.js';
import {
    CITY,
    JOB,
    NOW,
    OTHER,
    OTHER_WORKER,
    WORKER,
    at,
    callAs,
    heldJob,
    localJob,
    minutes,
    readWorker,
    seedHeld,
    seedWorker,
    workerWorld,
    type WorkerWorld,
} from './world.js';

const GB = 1024 ** 3;
const ROOMY = { workBytes: 12 * GB, freeBytes: 41 * GB, floorBytes: 10 * GB };
const FULL = { workBytes: 80 * GB, freeBytes: 4 * GB, floorBytes: 10 * GB };

function claim(world: WorkerWorld, extra: Readonly<Record<string, unknown>> = {}) {
    return callAs(world, claimFunction, { workerId: WORKER, ...extra });
}

async function logMessages(world: WorkerWorld, jobId = JOB): Promise<string[]> {
    const lines = await world.deps.documents.query(FIRESTORE_PATHS.jobLogs(CITY, jobId), jobLogDocSchema);
    return lines.documents.map((line) => line.data.message);
}

describe('worker.claim: its own orphan', () => {
    it('happyPath_aJobItsComputerStoppedRunningIsQueuedAgainWithItsAttemptBack @S-A62-HAPPY-OWN-ORPHAN', async () => {
        const world = await workerWorld();
        await seedHeld(world, { attempt: 2 });

        // Finding of 2026-11-14 (1923 plan-ghid): the computer that lost it leaves it to the owner's other computers first.
        await expect(claim(world)).resolves.toEqual({ job: null });

        await expect(readJob(world, JOB)).resolves.toMatchObject({ status: 'queued', attempt: 1, lostRuns: 1, lostOn: [WORKER] });
        await expect(logMessages(world)).resolves.toEqual(['apiError.imagery.workerLostRefunded']);
        await seedWorker(world, OTHER_WORKER);
        await expect(callAs(world, claimFunction, { workerId: OTHER_WORKER })).resolves.toEqual({ job: { jobId: JOB } });
    });

    it('happyPath_theComputerThatLostItTakesItAgainOnceTheOthersHadTheirTurn @S-A62-HAPPY-LOST-HAND-OVER', async () => {
        const world = await workerWorld();
        await seedWorker(world);
        await seedJob(world, JOB, { ...localJob(), status: 'queued', lostOn: [WORKER], updatedAt: minutes(-LOST_HAND_OVER_MS / 60_000) });

        await expect(claim(world)).resolves.toEqual({ job: { jobId: JOB } });
    });

    it('badPath_aComputerThatLosesTheSameJobAgainIsSaidSoInPlainWords @S-A62-BAD-LOST-AGAIN', async () => {
        const world = await workerWorld();
        await seedHeld(world, { attempt: 2, lostRuns: 1, lostOn: [WORKER] });

        await expect(claim(world)).resolves.toEqual({ job: null });

        await expect(readJob(world, JOB)).resolves.toMatchObject({ status: 'queued', lostRuns: 2, lostOn: [WORKER, WORKER] });
        await expect(logMessages(world)).resolves.toEqual(['apiError.imagery.workerLostAgain']);
    });

    it('happyPath_aStartingOrphanIsReleasedToo_andNothingElseIsTaken @S-A62-HAPPY-OWN-ORPHAN', async () => {
        const world = await workerWorld();
        await seedHeld(world, { status: 'starting', attempt: 1, cancelRequested: true });

        await expect(claim(world)).resolves.toEqual({ job: null });

        await expect(readJob(world, JOB)).resolves.toMatchObject({ status: 'queued', waitReason: 'worker', attempt: 0, lostRuns: 1 });
        await expect(readWorker(world)).resolves.toMatchObject({ state: 'idle', lastSeenAt: at(NOW) });
    });

    it.each([
        ['another worker claimed', heldJob({ worker: { id: OTHER_WORKER, uid: OTHER, claimedAt: minutes(-5) } })],
        ['it already ended', heldJob({ status: 'succeeded' })],
        ['it waits for points', heldJob({ status: 'awaiting_gcps' })],
    ])('badPath_aJobThat%sIsLeftAlone @S-A62-BAD-OWN-ORPHAN', async (_name, job) => {
        const world = await workerWorld();
        await seedWorker(world, WORKER, { state: 'busy', jobId: JOB });
        await seedJob(world, JOB, job);

        await expect(claim(world)).resolves.toEqual({ job: null });

        await expect(readJob(world, JOB)).resolves.toEqual(job);
        await expect(logMessages(world)).resolves.toEqual([]);
    });

    it('badPath_aJobThatNoLongerExistsIsNoOrphan @S-A62-BAD-OWN-ORPHAN', async () => {
        const world = await workerWorld();
        await seedWorker(world, WORKER, { state: 'busy', jobId: 'j-deleted' });

        await expect(claim(world)).resolves.toEqual({ job: null });
        await expect(readWorker(world)).resolves.toMatchObject({ state: 'idle' });
    });
});

describe('worker.claim: the held jobs’ states', () => {
    it('happyPath_eachHeldJobIsAnsweredWithItsStatusOrGone @S-A62-HAPPY-JOB-STATES', async () => {
        const world = await workerWorld();
        await seedWorker(world);
        await seedJob(world, 'j-done', localJob({ status: 'succeeded' }));
        await seedJob(world, 'j-points', localJob({ status: 'awaiting_gcps' }));

        await expect(claim(world, { held: ['j-done', 'j-points', 'j-gone'] })).resolves.toEqual({
            job: null,
            jobStates: { 'j-done': 'succeeded', 'j-points': 'awaiting_gcps', 'j-gone': 'gone' },
        });
    });

    it('badPath_aClaimWithoutHeldJobsGetsNoStatesAndReadsNone @S-A62-BAD-JOB-STATES', async () => {
        const world = await workerWorld();
        await seedWorker(world);

        await expect(claim(world)).resolves.not.toHaveProperty('jobStates');
        await expect(claim(world, { held: [] })).resolves.toEqual({ job: null, jobStates: {} });
    });

    it('badPath_aHeldListOverTheLimitIsRefused @S-A62-BAD-JOB-STATES', async () => {
        const world = await workerWorld();
        await seedWorker(world);
        const held = Array.from({ length: 201 }, (_unused, index) => `j-${String(index)}`);

        await expect(failureOf(claim(world, { held }))).resolves.toMatchObject({ code: 'invalid-argument' });
    });
});

describe('worker.claim: the disk', () => {
    it('happyPath_theDiskIsRecordedAndAJobTakenWhileThereIsRoom @S-A62-HAPPY-LOW-DISK', async () => {
        const world = await workerWorld();
        await seedWorker(world);
        await seedJob(world, 'j-next', localJob());

        await expect(claim(world, { disk: ROOMY })).resolves.toEqual({ job: { jobId: 'j-next' } });
        await expect(readWorker(world)).resolves.toMatchObject({ state: 'busy', disk: { ...ROOMY, at: at(NOW) } });
    });

    it('badPath_aDiskBelowItsFloorTakesNoJob_butTheWorkerIsSeen @S-A62-BAD-LOW-DISK', async () => {
        const world = await workerWorld();
        await seedWorker(world);
        await seedJob(world, 'j-next', localJob());

        await expect(claim(world, { disk: FULL })).resolves.toEqual({ job: null, lowDisk: true });

        await expect(readJob(world, 'j-next')).resolves.toMatchObject({ status: 'queued' });
        await expect(readWorker(world)).resolves.toMatchObject({ state: 'idle', lastSeenAt: at(NOW), disk: { ...FULL, at: at(NOW) } });
    });

    it('badPath_aPausedComputerIsSaidPausedEvenWithAFullDisk', async () => {
        const world = await workerWorld();
        await seedWorker(world, WORKER, { pausedAt: minutes(-1) });

        await expect(claim(world, { disk: FULL })).resolves.toMatchObject({ job: null, paused: true });
    });
});

describe('Free space now', () => {
    it('happyPath_askedInTheAdmin_answeredAtTheNextClaim_clearedOnceFreed @S-A62-HAPPY-FREE-SPACE', async () => {
        const world = await workerWorld();
        await seedWorker(world, WORKER, { freed: { bytes: 1, at: minutes(-60) } });

        await expect(callAs(world, manageFunction, { workerId: WORKER, action: 'freeSpace' })).resolves.toEqual({ changed: true });
        await expect(readWorker(world)).resolves.toMatchObject({ freeSpaceAskedAt: at(NOW) });

        // An older outcome does not answer the new request.
        await expect(claim(world, { disk: ROOMY })).resolves.toEqual({ job: null, freeSpace: true });

        const freed = { bytes: 3 * GB, at: new Date(Date.parse(NOW) + 1000).toISOString() };
        await expect(claim(world, { disk: ROOMY, freed })).resolves.toEqual({ job: null });
        const worker = await readWorker(world);
        expect(worker).toMatchObject({ freed: { bytes: 3 * GB, at: at(freed.at) } });
        expect(worker).not.toHaveProperty('freeSpaceAskedAt');
    });

    it('happyPath_aFirstRequestIsAnsweredWhenNothingWasFreedYet @S-A62-HAPPY-FREE-SPACE', async () => {
        const world = await workerWorld();
        await seedWorker(world, WORKER, { freeSpaceAskedAt: minutes(-1) });

        await expect(claim(world)).resolves.toEqual({ job: null, freeSpace: true });
    });

    it('badPath_anUnknownOrDisconnectedComputerIsNotAsked @S-A62-BAD-FREE-SPACE', async () => {
        const world = await workerWorld();
        await seedWorker(world, WORKER, { revokedAt: minutes(-1) });

        await expect(callAs(world, manageFunction, { workerId: WORKER, action: 'freeSpace' })).resolves.toEqual({ changed: false });
        await expect(callAs(world, manageFunction, { workerId: OTHER_WORKER, action: 'freeSpace' })).resolves.toEqual({
            changed: false,
        });
        await expect(readWorker(world)).resolves.not.toHaveProperty('freeSpaceAskedAt');
    });
});
