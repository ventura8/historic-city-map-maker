/**
 * Pause this computer on the worker's side (`functions/src/worker/{claim,end,pause-state}.ts`, `docs/research/M7-local-worker.md` →
 * *Pause*): the computer's own page's command rides on `worker.claim` and `worker.end`; a paused worker is answered `paused` and
 * takes nothing; a pause past its `until` ends on its own; `worker.end` `released` queues the job again where it stopped, with the
 * attempt given back only while the computer was paused or its job asked back.
 */
import { describe, expect, it } from 'vitest';

import { claimFunction } from '../../src/worker/claim.js';
import { endFunction } from '../../src/worker/end.js';
import { readJob, seedJob } from '../imagery/world.js';
import {
    JOB,
    NOW,
    WORKER,
    at,
    callAs,
    localJob,
    minutes,
    readWorker,
    seedHeld,
    seedWorker,
    workerWorld,
    type WorkerWorld,
} from './world.js';

const LATER = new Date(Date.parse(NOW) + 3_600_000).toISOString();

function claim(world: WorkerWorld, extra: Record<string, unknown> = {}) {
    return callAs<{ readonly job: unknown; readonly paused?: unknown; readonly pause?: unknown }>(world, claimFunction, {
        workerId: WORKER,
        ...extra,
    });
}

function end(world: WorkerWorld, data: Record<string, unknown>) {
    return callAs<{ readonly status: string }>(world, endFunction, { workerId: WORKER, jobId: JOB, ...data });
}

describe('worker.claim: Pause this computer', () => {
    it('happyPath_theComputersOwnPagePausesItWithItsClaimAndResumesItWithALaterOne @S-P32-HAPPY-PAUSE-PAGE', async () => {
        const world = await workerWorld();
        await seedWorker(world);
        await seedJob(world, JOB, localJob());

        await expect(claim(world, { pause: { action: 'pause', until: LATER } })).resolves.toEqual({
            job: null,
            paused: true,
            pause: { by: 'computer', at: NOW, until: LATER },
        });
        expect((await readWorker(world))?.paused).toMatchObject({ by: 'computer', at: at(NOW), until: at(LATER) });

        await expect(claim(world, { pause: { action: 'resume' } })).resolves.toEqual({ job: { jobId: JOB } });
        expect((await readWorker(world))?.paused).toBeUndefined();
    });

    it('badPath_aPausePastItsUntilEndsOnItsOwnAndTheClaimTakesTheJob @S-P32-BAD-PAUSE-EXPIRED', async () => {
        const world = await workerWorld();
        await seedWorker(world, WORKER, { paused: { by: 'u-admin', at: minutes(-90), until: minutes(-30) } });
        await seedJob(world, JOB, localJob());

        await expect(claim(world)).resolves.toEqual({ job: { jobId: JOB } });
        expect((await readWorker(world))?.paused).toBeUndefined();
    });

    it('badPath_aJobAskedBackEarlierIsClaimedWithoutTheStaleRequest', async () => {
        const world = await workerWorld();
        await seedWorker(world);
        await seedJob(world, JOB, localJob({ releaseRequested: true }));

        await claim(world);

        expect((await readJob(world, JOB))?.releaseRequested).toBeUndefined();
    });
});

describe('worker.end: released', () => {
    it('happyPath_aPausedComputersJobIsQueuedAgainWithItsAttemptGivenBack @S-P32-HAPPY-RELEASED', async () => {
        const world = await workerWorld();
        await seedHeld(world, { attempt: 2, releaseRequested: true });

        await expect(end(world, { outcome: 'released' })).resolves.toEqual({ status: 'queued' });

        const job = await readJob(world, JOB);
        expect(job).toMatchObject({ status: 'queued', attempt: 1 });
        expect(job?.lease).toBeUndefined();
        expect(job?.worker).toBeUndefined();
        expect(job?.releaseRequested).toBeUndefined();
        expect(await readWorker(world)).toMatchObject({ state: 'idle' });
    });

    it('happyPath_theOwnPagesPauseComesWithTheEndAndCountsAsAskingBack', async () => {
        const world = await workerWorld();
        await seedHeld(world, { attempt: 1 });

        await end(world, { outcome: 'released', pause: { action: 'pause' } });

        expect(await readJob(world, JOB)).toMatchObject({ status: 'queued', attempt: 0 });
        expect((await readWorker(world))?.paused).toEqual({ by: 'computer', at: at(NOW) });
    });

    it('badPath_aReleaseNobodyAskedForKeepsTheAttemptCounted @S-P32-BAD-RELEASED-UNASKED', async () => {
        const world = await workerWorld();
        await seedHeld(world, { attempt: 2 });

        await end(world, { outcome: 'released' });

        expect(await readJob(world, JOB)).toMatchObject({ status: 'queued', attempt: 2 });
    });

    it('badPath_aJobTheWorkerNoLongerHoldsIsNotTouched', async () => {
        const world = await workerWorld();
        await seedHeld(world, { status: 'awaiting_approval', waitReason: 'approval', releaseRequested: true });

        await expect(end(world, { outcome: 'released' })).resolves.toEqual({ status: 'awaiting_approval' });
    });
});
