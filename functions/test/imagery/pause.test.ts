/**
 * `imagery.pause` (`functions/src/imagery/pause.ts`, `docs/research/M7-local-worker.md` → *Pause*): Pause and Resume of one job,
 * of every job of the city, and of a computer. A queued job paused is claimed and dispatched by nobody; a running one is marked and
 * stops at its next step boundary (the pipeline's part); Resume gives back the attempt a paused run counted. A computer paused asks
 * its job back. A finished job, an unknown one and a pause past two days are refused, nothing changed.
 */
import { describe, expect, it } from 'vitest';

import { pauseFunction } from '../../src/imagery/pause.js';
import { claimFunction } from '../../src/worker/claim.js';
import { failureOf } from '../admin/world.js';
import { readJob, seedJob } from './world.js';
import {
    JOB,
    NOW,
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
} from '../worker/world.js';

type World = Awaited<ReturnType<typeof workerWorld>>;

function pause(world: World, data: Record<string, unknown>) {
    return callAs<{ readonly changed: number }>(world, pauseFunction, data);
}

function claim(world: World) {
    return callAs<{ readonly job: unknown; readonly paused?: unknown; readonly pause?: unknown }>(world, claimFunction, {
        workerId: WORKER,
    });
}

describe('imagery.pause: a job', () => {
    it('happyPath_aQueuedJobPausedIsClaimedByNobodyAndResumedIsClaimedAgain @S-A170-HAPPY', async () => {
        const world = await workerWorld();
        await seedWorker(world);
        await seedJob(world, JOB, localJob());

        await expect(pause(world, { action: 'pause', jobId: JOB })).resolves.toEqual({ changed: 1 });
        expect((await readJob(world, JOB))?.paused).toEqual({ by: 'u-admin', at: at(NOW) });
        await expect(claim(world)).resolves.toEqual({ job: null });

        await expect(pause(world, { action: 'resume', jobId: JOB })).resolves.toEqual({ changed: 1 });
        expect((await readJob(world, JOB))?.paused).toBeUndefined();
        await expect(claim(world)).resolves.toEqual({ job: { jobId: JOB } });
    });

    it('happyPath_aRunningJobIsMarkedInRunAndItsResumeGivesBackTheAttemptOnceTheRunStopped @S-A170-HAPPY', async () => {
        const world = await workerWorld();
        await seedJob(world, JOB, heldJob({ attempt: 2 }));

        await pause(world, { action: 'pause', jobId: JOB });
        expect((await readJob(world, JOB))?.paused).toEqual({ by: 'u-admin', at: at(NOW), inRun: true });

        // The run stopped at its step boundary (`runner.py`): queued, the mark kept.
        const stopped = await readJob(world, JOB);
        await seedJob(world, JOB, { ...heldJob({ attempt: 2 }), status: 'queued', paused: stopped?.paused });
        await pause(world, { action: 'resume', jobId: JOB });

        expect(await readJob(world, JOB)).toMatchObject({ status: 'queued', attempt: 1 });
    });

    it('happyPath_aResumeBeforeTheRunReachedItsBoundaryKeepsTheAttempt', async () => {
        const world = await workerWorld();
        await seedJob(world, JOB, heldJob({ attempt: 2, paused: { by: 'u-admin', at: at(NOW), inRun: true } }));

        await pause(world, { action: 'resume', jobId: JOB });

        const job = await readJob(world, JOB);
        expect(job).toMatchObject({ status: 'running', attempt: 2 });
        expect(job?.paused).toBeUndefined();
    });

    it('badPath_aFinishedJobIsNotPausableAndNothingChanges @S-A170-BAD-FINISHED', async () => {
        const world = await workerWorld();
        await seedJob(world, JOB, localJob({ status: 'awaiting_approval', waitReason: 'approval' }));

        await expect(failureOf(pause(world, { action: 'pause', jobId: JOB }))).resolves.toMatchObject({
            details: { code: 'apiError.imagery.notPausable' },
        });
        expect((await readJob(world, JOB))?.paused).toBeUndefined();
    });

    it('badPath_anUnknownJobIsNotFound', async () => {
        const world = await workerWorld();

        await expect(failureOf(pause(world, { action: 'pause', jobId: 'job-none' }))).resolves.toMatchObject({
            details: { code: 'apiError.notFound' },
        });
    });

    it('badPath_pausingAPausedJobOrResumingOneNotPausedChangesNothing', async () => {
        const world = await workerWorld();
        await seedJob(world, JOB, localJob({ paused: { by: 'u-other', at: minutes(-5) } }));

        await expect(pause(world, { action: 'pause', jobId: JOB })).resolves.toEqual({ changed: 0 });
        expect((await readJob(world, JOB))?.paused?.by).toBe('u-other');
        await pause(world, { action: 'resume', jobId: JOB });
        await expect(pause(world, { action: 'resume', jobId: JOB })).resolves.toEqual({ changed: 0 });
    });
});

describe('imagery.pause: every job', () => {
    it('happyPath_pauseAllPausesTheQueuedAndRunningPipelineJobsAndResumeAllResumesThem @S-A170-HAPPY-ALL', async () => {
        const world = await workerWorld();
        await seedJob(world, 'j-a', localJob());
        await seedJob(world, 'j-b', heldJob());
        await seedJob(world, 'j-c', localJob({ status: 'failed' }));
        await seedJob(world, 'j-d', localJob({ cancelRequested: true }));

        await expect(pause(world, { action: 'pause' })).resolves.toEqual({ changed: 2 });
        expect((await readJob(world, 'j-c'))?.paused).toBeUndefined();
        expect((await readJob(world, 'j-d'))?.paused).toBeUndefined();

        await expect(pause(world, { action: 'resume' })).resolves.toEqual({ changed: 2 });
        expect((await readJob(world, 'j-a'))?.paused).toBeUndefined();
    });

    it('badPath_pauseAllWithNothingToPauseChangesNothing @S-A170-BAD-NOTHING', async () => {
        const world = await workerWorld();
        await seedJob(world, 'j-c', localJob({ status: 'succeeded' }));

        await expect(pause(world, { action: 'pause' })).resolves.toEqual({ changed: 0 });
    });
});

describe('imagery.pause: a computer', () => {
    it('happyPath_aPausedComputerClaimsNothingItsJobIsAskedBackAndResumeDropsBoth @S-A171-HAPPY', async () => {
        const world = await workerWorld();
        await seedHeld(world);
        const until = new Date(Date.parse(NOW) + 3_600_000).toISOString();

        await expect(pause(world, { action: 'pause', workerId: WORKER, until })).resolves.toEqual({ changed: 1 });
        expect((await readWorker(world))?.paused).toEqual({ by: 'u-admin', at: at(NOW), until: at(until) });
        expect((await readWorker(world))?.pausedAt).toEqual(at(NOW));
        expect((await readJob(world, JOB))?.releaseRequested).toBe(true);

        await pause(world, { action: 'resume', workerId: WORKER });
        expect((await readWorker(world))?.paused).toBeUndefined();
        expect((await readJob(world, JOB))?.releaseRequested).toBeUndefined();
    });

    it('happyPath_anIdleComputerPausedUntilIResumeIsAnsweredPausedByItsClaim', async () => {
        const world = await workerWorld();
        await seedWorker(world);
        await seedJob(world, JOB, localJob());

        await pause(world, { action: 'pause', workerId: WORKER });

        await expect(claim(world)).resolves.toEqual({ job: null, paused: true, pause: { by: 'u-admin', at: NOW } });
        expect((await readJob(world, JOB))?.status).toBe('queued');
    });

    it('badPath_aPauseEndingPastTwoDaysOrInThePastIsRefused @S-A171-BAD-UNTIL', async () => {
        const world = await workerWorld();
        await seedWorker(world);

        for (const until of [new Date(Date.parse(NOW) + 49 * 3_600_000).toISOString(), new Date(Date.parse(NOW) - 1000).toISOString()]) {
            await expect(failureOf(pause(world, { action: 'pause', workerId: WORKER, until }))).resolves.toMatchObject({
                details: { code: 'apiError.imagery.pauseUntil' },
            });
        }
        expect((await readWorker(world))?.paused).toBeUndefined();
    });

    it('badPath_anUnknownComputerIsNotFound', async () => {
        const world = await workerWorld();

        await expect(failureOf(pause(world, { action: 'resume', workerId: WORKER }))).resolves.toMatchObject({
            details: { code: 'apiError.notFound' },
        });
    });

    it('badPath_aBusyComputerWhoseJobAlreadyEndedAsksNothingBack', async () => {
        const world = await workerWorld();
        await seedWorker(world, WORKER, { state: 'busy', jobId: JOB });
        await seedJob(world, JOB, localJob({ status: 'awaiting_gcps', waitReason: 'gcps' }));

        await pause(world, { action: 'pause', workerId: WORKER });

        expect((await readJob(world, JOB))?.releaseRequested).toBeUndefined();
    });
});
