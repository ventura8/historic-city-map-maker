/**
 * `worker.end` (`functions/src/worker/end.ts`, `docs/research/M7-local-worker.md` §1.2, §2.4): the run is over. `done`
 * leaves the job as the run left it; `failed` ends a job the worker still holds unfinished (its code when it is an
 * `apiError.*` code, else `apiError.imagery.processingFailed`) with its version; the worker is idle with its last job.
 */
import { describe, expect, it } from 'vitest';

import { endFunction } from '../../src/worker/end.js';
import { failureOf } from '../admin/world.js';
import { readJob, readVersion, seedGuard } from '../imagery/world.js';
import { JOB, NOW, OTHER, WORKER, at, callAs, seedHeld, seedWorker, workerWorld, type WorkerWorld } from './world.js';

function end(world: WorkerWorld, data: Record<string, unknown>, uid?: string): Promise<{ readonly status: string }> {
    return callAs<{ readonly status: string }>(world, endFunction, { workerId: WORKER, jobId: JOB, ...data }, uid);
}

async function held(job: Parameters<typeof seedHeld>[1] = {}): Promise<WorkerWorld> {
    const world = await workerWorld();
    await seedHeld(world, job);
    return world;
}

describe('worker.end', () => {
    it('happyPath_aDoneRunLeavesTheJobAndTheWorkerIsIdleWithItsLastJob', async () => {
        const world = await held({ status: 'awaiting_approval', waitReason: 'approval' });

        await expect(end(world, { outcome: 'done' })).resolves.toEqual({ status: 'awaiting_approval' });
        const worker = await world.deps.documents.peek(`cities/bucharest/workers/${WORKER}`);
        expect(worker).toMatchObject({ state: 'idle', lastJob: { id: JOB, outcome: 'done', at: at(NOW) }, lastSeenAt: at(NOW) });
        expect(worker).not.toHaveProperty('jobId');
    });

    it('happyPath_aCrashOutsideAStepFailsTheJobWithItsCode', async () => {
        const world = await held();

        await expect(
            end(world, { outcome: 'failed', error: { code: 'apiError.usgs.unavailable', message: 'M2M did not answer' } }),
        ).resolves.toEqual({
            status: 'failed',
        });
        await expect(readJob(world, JOB)).resolves.toMatchObject({
            status: 'failed',
            error: { code: 'apiError.usgs.unavailable', message: 'M2M did not answer' },
            updatedBy: 'system:pipeline',
        });
        await expect(readVersion(world, JOB)).resolves.toMatchObject({ state: 'failed', error: { code: 'apiError.usgs.unavailable' } });
    });

    it.each([
        ['a code that is not an API code', { code: 'KeyError', message: 'boom' }],
        ['no error at all', undefined],
    ])('happyPath_%sFailsItAsAProcessingFailure', async (_name, error) => {
        const world = await held({ status: 'starting' });

        await end(world, { outcome: 'failed', ...(error === undefined ? {} : { error }) });

        await expect(readJob(world, JOB)).resolves.toMatchObject({
            status: 'failed',
            error: { code: 'apiError.imagery.processingFailed' },
        });
    });

    it('happyPath_theRunEndsEvenWhileTheGuardIsRed', async () => {
        const world = await held();
        await seedGuard(world, 'red');

        await expect(end(world, { outcome: 'failed' })).resolves.toEqual({ status: 'failed' });
    });

    it.each([
        ['a job the run already ended', { status: 'waiting_usgs' as const }],
        ['a job another worker took over', { worker: { id: 'w-fedcba9876543210', uid: OTHER, claimedAt: at(NOW) } }],
    ])('badPath_%sIsNotFailed', async (_name, job) => {
        const world = await held(job);
        const before = await readJob(world, JOB);

        await end(world, { outcome: 'failed' });

        await expect(readJob(world, JOB)).resolves.toEqual(before);
    });

    it('badPath_aJobThatIsGoneIsNotFound', async () => {
        const world = await held();
        await world.deps.documents.delete(`cities/bucharest/jobs/${JOB}`);

        await expect(failureOf(end(world, { outcome: 'done' }))).resolves.toMatchObject({ details: { code: 'apiError.notFound' } });
    });

    it('badPath_anotherAccountsWorkerIsRefused', async () => {
        const world = await held();
        await seedWorker(world, WORKER, { uid: OTHER });

        await expect(failureOf(end(world, { outcome: 'failed' }, 'u-admin'))).resolves.toMatchObject({
            details: { code: 'apiError.worker.refused' },
        });
        await expect(readJob(world, JOB)).resolves.toMatchObject({ status: 'running' });
    });
});
