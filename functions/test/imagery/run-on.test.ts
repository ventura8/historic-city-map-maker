/**
 * `imagery.runOn` (`functions/src/imagery/run-on.ts`, `docs/research/M7-local-worker.md` §3, §4.3): the city's
 * remembered choice, and a job's place (with the city's choice) while it holds no run; the OK past the free tier; a
 * running job, a job that is not there and `auto` for a job are refused, nothing changed.
 */
import { FIRESTORE_PATHS, runChoiceDocSchema, type JobDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { runOnFunction } from '../../src/imagery/run-on.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import { CITY, NOW, at, readJob, readyWorld, seedJob, type ImageryWorld } from './world.js';

const JOB = 'job-1966-0712';
const WORKER = { id: 'w-0123456789abcdef', uid: 'u-admin', claimedAt: at(NOW) };

function queued(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'usgs-import',
        status: 'queued',
        params: { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' },
        createdBy: 'system:imagery',
        createdAt: at(NOW),
        layerId: 'kh-4a-corona-1966',
        versionId: JOB,
        runOn: 'cloud',
        waitReason: 'free-tier',
        updatedBy: 'system:imagery',
        updatedAt: at(NOW),
        ...overrides,
    };
}

function runOn(world: ImageryWorld, data: Record<string, unknown>) {
    return runOnFunction(() => world.deps).run(adminCall({ cityId: CITY, ...data }));
}

function choice(world: ImageryWorld) {
    return world.deps.documents.get(FIRESTORE_PATHS.runChoice(CITY), runChoiceDocSchema);
}

describe('imagery.runOn: the files of a parked job', () => {
    const parked = { status: 'awaiting_gcps', steps: { extract: { status: 'done', gcsPath: 'work/c/j/segments/a.tif' } } } as const;

    it('badPath_aParkedCloudJobMovedToTheComputerLeavesItsFilesBehindAndMovedBackHasThemAgain @S-A69-BAD-FILES-ELSEWHERE', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, queued(parked));

        await runOn(world, { jobId: JOB, runOn: 'local' });
        expect(await readJob(world, JOB)).toMatchObject({ runOn: 'local', filesOn: 'cloud' });

        await runOn(world, { jobId: JOB, runOn: 'cloud' });
        const back = await readJob(world, JOB);
        expect(back?.runOn).toBe('cloud');
        expect(back?.filesOn).toBeUndefined();
    });

    it('badPath_aParkedLocalJobMovedToTheCloudLeavesItsFilesOnTheComputer @S-A69-BAD-FILES-ELSEWHERE', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, queued({ ...parked, runOn: 'local' }));

        await runOn(world, { jobId: JOB, runOn: 'cloud' });

        expect(await readJob(world, JOB)).toMatchObject({ runOn: 'cloud', filesOn: 'local' });
    });

    it('happyPath_aJobNotParkedTakesItsFilesAlongAsItRunsThereFromTheStart', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, queued());

        await runOn(world, { jobId: JOB, runOn: 'local' });

        expect((await readJob(world, JOB))?.filesOn).toBeUndefined();
    });

    it('happyPath_movedWhileQueuedAfterItsPointsTheFilesStayWhereTheyAre', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, queued({ runOn: 'local', filesOn: 'cloud' }));

        await runOn(world, { jobId: JOB, runOn: 'cloud' });

        expect((await readJob(world, JOB))?.filesOn).toBeUndefined();
    });
});

describe('imagery.runOn', () => {
    it('happyPath_theCitysChoiceIsRemembered', async () => {
        const world = await readyWorld();

        await expect(runOn(world, { runOn: 'auto' })).resolves.toEqual({ choice: 'auto' });
        expect(await choice(world)).toEqual({ choice: 'auto', updatedBy: 'u-admin', updatedAt: at(NOW) });
        await expect(runOn(world, { runOn: 'local' })).resolves.toEqual({ choice: 'local' });
        expect((await choice(world))?.choice).toBe('local');
    });

    it('happyPath_theOkRunsAJobInTheCloudPastTheFreeTier', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, queued());

        await expect(runOn(world, { jobId: JOB, runOn: 'cloud', freeTierOk: true })).resolves.toEqual({ choice: 'cloud', runOn: 'cloud' });

        const job = await readJob(world, JOB);
        expect(job).toMatchObject({ status: 'queued', runOn: 'cloud', freeTierOk: { by: 'u-admin', at: at(NOW) }, updatedBy: 'u-admin' });
        expect(job?.waitReason).toBeUndefined();
        expect((await choice(world))?.choice).toBe('cloud');
    });

    it('happyPath_aJobMovedToTheComputerDropsItsWorkerAndAnEarlierOk', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, queued({ status: 'awaiting_gcps', worker: WORKER, freeTierOk: { by: 'u-other', at: at(NOW) } }));

        await expect(runOn(world, { jobId: JOB, runOn: 'local', freeTierOk: true })).resolves.toEqual({ choice: 'local', runOn: 'local' });

        const job = await readJob(world, JOB);
        expect(job).toMatchObject({ status: 'awaiting_gcps', runOn: 'local' });
        expect([job?.worker, job?.waitReason, job?.freeTierOk]).toEqual([undefined, undefined, undefined]);
        expect((await choice(world))?.choice).toBe('local');
    });

    it('happyPath_movedToTheCloudWithoutTheOkKeepsAnEarlierOne', async () => {
        const world = await readyWorld();
        const ok = { by: 'u-other', at: at('2026-10-22T08:00:00.000Z') };
        await seedJob(world, JOB, queued({ status: 'waiting_usgs', runOn: 'local', freeTierOk: ok }));

        await runOn(world, { jobId: JOB, runOn: 'cloud' });

        expect(await readJob(world, JOB)).toMatchObject({ runOn: 'cloud', freeTierOk: ok });
    });

    it('badPath_aRunningJobCannotMove @S-A62-BAD-RUNNING', async () => {
        const world = await readyWorld();
        const running = queued({ status: 'running', waitReason: undefined, worker: WORKER, runOn: 'local' });
        await seedJob(world, JOB, running);

        const failure = await failureOf(runOn(world, { jobId: JOB, runOn: 'cloud' }));

        expect(failure).toMatchObject({ code: 'failed-precondition', details: { code: 'apiError.imagery.versionState' } });
        expect(await readJob(world, JOB)).toEqual(running);
        expect(await choice(world)).toBeUndefined();
    });

    it('badPath_autoIsNoPlaceForAJob @S-A62-BAD-RUNNING', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, queued());

        const failure = await failureOf(runOn(world, { jobId: JOB, runOn: 'auto' }));

        expect(failure).toMatchObject({ code: 'invalid-argument', details: { code: 'apiError.invalidRequest' } });
        expect(await readJob(world, JOB)).toEqual(queued());
    });

    it('badPath_aJobOrACityThatIsNotThereIsNotFound', async () => {
        const world = await readyWorld();

        expect(await failureOf(runOn(world, { jobId: 'job-missing', runOn: 'local' }))).toMatchObject({
            details: { code: 'apiError.notFound' },
        });
        await world.deps.documents.delete(FIRESTORE_PATHS.city(CITY));
        expect(await failureOf(runOn(world, { runOn: 'local' }))).toMatchObject({ details: { code: 'apiError.notFound' } });
        expect(await choice(world)).toBeUndefined();
    });
});
