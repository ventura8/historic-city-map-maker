/**
 * `imagery.tick`'s lost local runs (`functions/src/imagery/{tick-jobs,lost-run}.ts`, `docs/research/M7-local-worker.md` §3): a job
 * running on the owner's computer whose worker stopped beating (its lease lapsed, or its heartbeat three beats late; `running` or
 * still `starting`) goes back to `queued` waiting for a worker. P0-1 (2026-11-14): the computer stopped (a power cut or a crash),
 * so the attempt its claim counted is given back, with `apiError.imagery.workerLostRefunded` in its log, while the job had fewer
 * than `LOST_RUN_REFUNDS` such losses; after that the attempt counts (`apiError.imagery.workerLost`). Cloud Run is never asked
 * about it, and a local run whose lease is live and whose heartbeat is on time is left alone however old its start.
 */
import { FIRESTORE_PATHS, HEARTBEAT_SECONDS, LOST_RUN_REFUNDS, jobLogDocSchema, type JobDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { runImageryTick } from '../../src/imagery/tick.js';
import { heldJob, minutes, workerWorld, type WorkerWorld } from '../worker/world.js';
import { CITY, readJob, renderedVersion, seedJob, seedVersion } from './world.js';

const JOB = 'job-1966-0712';

async function localRun(job: Partial<JobDoc>): Promise<WorkerWorld> {
    const world = await workerWorld();
    await seedVersion(world, JOB, { ...renderedVersion(), state: 'processing' });
    await seedJob(world, JOB, heldJob(job));
    return world;
}

async function logMessages(world: WorkerWorld): Promise<string[]> {
    const lines = await world.deps.documents.query(FIRESTORE_PATHS.jobLogs(CITY, JOB), jobLogDocSchema);
    return lines.documents.map((line) => line.data.message);
}

describe('imagery.tick: lost local runs', () => {
    it.each([
        ['running', { status: 'running' as const }],
        ['still starting', { status: 'starting' as const, startedAt: undefined }],
    ])(
        'badPath_aLocalRun%sWhoseWorkerStoppedWaitsForAWorkerAgain @S-A62-BAD-WORKER-LOST @S-A62-HAPPY-LOST-REFUND',
        async (_name, state) => {
            const world = await localRun({ ...state, lease: { owner: 'worker:w-0123456789abcdef', until: minutes(-1) }, attempt: 2 });

            await runImageryTick(world.deps);

            const job = await readJob(world, JOB);
            // The power cut is not the job's fault: the attempt its claim counted is given back, and the loss is counted.
            expect(job).toMatchObject({ status: 'queued', waitReason: 'worker', runOn: 'local', attempt: 1, lostRuns: 1 });
            expect(job).toMatchObject({ updatedBy: 'system:imagery' });
            expect(job).not.toHaveProperty('worker');
            expect(job).not.toHaveProperty('lease');
            await expect(logMessages(world)).resolves.toEqual(['apiError.imagery.workerLostRefunded']);
            expect(world.jobs.recorder.calls).toEqual([]);
        },
    );

    it('happyPath_aLocalRunWhoseHeartbeatIsThreeBeatsLateIsLostBeforeItsLeaseLapses @S-A62-HAPPY-LOST-REFUND', async () => {
        const world = await localRun({ updatedAt: minutes(-((3 * HEARTBEAT_SECONDS) / 60 + 1)), attempt: 1 });

        await runImageryTick(world.deps);

        await expect(readJob(world, JOB)).resolves.toMatchObject({ status: 'queued', waitReason: 'worker', attempt: 0, lostRuns: 1 });
        await expect(logMessages(world)).resolves.toEqual(['apiError.imagery.workerLostRefunded']);
    });

    it('badPath_aJobThatKeepsStoppingItsComputerCountsItsAttemptOnceTheRefundsAreSpent @S-A62-BAD-LOST-REFUND-CAP', async () => {
        const lease = { owner: 'worker:w-0123456789abcdef', until: minutes(-1) };
        const world = await localRun({ lease, attempt: 2, lostRuns: LOST_RUN_REFUNDS });

        await runImageryTick(world.deps);

        await expect(readJob(world, JOB)).resolves.toMatchObject({ status: 'queued', attempt: 2, lostRuns: LOST_RUN_REFUNDS });
        await expect(logMessages(world)).resolves.toEqual(['apiError.imagery.workerLost']);
    });

    it('badPath_aLostRunWithNoAttemptCountedStaysAtZero', async () => {
        const lease = { owner: 'worker:w-0123456789abcdef', until: minutes(-1) };
        const world = await localRun({ lease, attempt: undefined });

        await runImageryTick(world.deps);

        await expect(readJob(world, JOB)).resolves.toMatchObject({ status: 'queued', attempt: 0, lostRuns: 1 });
    });

    it('happyPath_aLocalRunWithItsLeaseLiveAndItsHeartbeatOnTimeIsLeftAloneHoweverOldItsStart @S-A62-BAD-WORKER-LOST', async () => {
        const world = await localRun({ status: 'starting', dispatchAt: minutes(-30), updatedAt: minutes(-1), startedAt: undefined });
        const before = await readJob(world, JOB);

        await runImageryTick(world.deps);

        await expect(readJob(world, JOB)).resolves.toEqual(before);
        await expect(logMessages(world)).resolves.toEqual([]);
        expect(world.jobs.recorder.calls).toEqual([]);
    });

    it('badPath_aRunTheWorkerRenewedMeanwhileIsNotLost', async () => {
        const world = await localRun({ lease: { owner: 'worker:w-0123456789abcdef', until: minutes(-1) } });
        const { documents } = world.deps;
        const renewed = heldJob();
        const racing: typeof documents = {
            ...documents,
            transaction: (work) => {
                documents.seed(FIRESTORE_PATHS.job(CITY, JOB), renewed);
                return documents.transaction(work);
            },
        };

        await runImageryTick({ ...world.deps, documents: racing });

        await expect(readJob(world, JOB)).resolves.toEqual(renewed);
        await expect(logMessages(world)).resolves.toEqual([]);
    });
});
