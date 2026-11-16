/**
 * Counting Cloud Run's use (`functions/src/imagery/{cloud-usage,on-job-write}.ts`, `docs/research/M7-local-worker.md`
 * §4.2): a cloud run that ends is counted once into `usage/cloudrun-<month>`, seconds from its dispatch × its machine's
 * vCPUs and GiB; a redelivered or late event counts nothing more, a run on the owner's computer nothing at all.
 */
import { FIRESTORE_PATHS, cloudRunUsageDocSchema, type JobDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { countCloudRun, endedCloudRun } from '../../src/imagery/cloud-usage.js';
import { onJobWrite } from '../../src/imagery/on-job-write.js';
import { CITY, NOW, at, readJob, readyWorld, seedJob, type ImageryWorld } from './world.js';

const JOB = 'job-1966-0712';
/** 1,000 seconds before `NOW`. */
const DISPATCHED = at('2026-10-23T07:43:20.000Z');

function job(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'usgs-import',
        status: 'running',
        params: { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: 'kh-4a-corona-1966',
        versionId: JOB,
        runOn: 'cloud',
        machine: 'std',
        attempt: 1,
        dispatchAt: DISPATCHED,
        updatedBy: 'system:pipeline',
        updatedAt: at(NOW),
        ...overrides,
    };
}

function usage(world: ImageryWorld) {
    return world.deps.documents.get(FIRESTORE_PATHS.cloudRunUsage('2026-10'), cloudRunUsageDocSchema);
}

describe('counting a cloud run', () => {
    it('happyPath_aRunIsCountedOnceWhenItEnds @S-A63-HAPPY-COUNTED', async () => {
        const world = await readyWorld();
        const ended = job({ status: 'awaiting_gcps' });
        await seedJob(world, JOB, ended);

        await onJobWrite(world.deps, CITY, JOB, { before: job(), after: ended });

        expect(await usage(world)).toMatchObject({ month: '2026-10', vcpuSeconds: 2000, gibSeconds: 8000, runs: 1 });
        // The job records the counted dispatch and keeps the pipeline's stamp.
        expect(await readJob(world, JOB)).toMatchObject({ usageCountedAt: DISPATCHED, updatedBy: 'system:pipeline' });

        // The redelivered event adds nothing.
        await onJobWrite(world.deps, CITY, JOB, { before: job(), after: ended });
        expect(await usage(world)).toMatchObject({ vcpuSeconds: 2000, gibSeconds: 8000, runs: 1 });
    });

    it('happyPath_aLocalRunIsNeverCounted @S-A63-HAPPY-COUNTED', async () => {
        const world = await readyWorld();
        const ended = job({ status: 'awaiting_gcps', runOn: 'local' });
        await seedJob(world, JOB, ended);

        await onJobWrite(world.deps, CITY, JOB, { before: job({ runOn: 'local' }), after: ended });

        expect(await usage(world)).toBeUndefined();
        expect((await readJob(world, JOB))?.usageCountedAt).toBeUndefined();
    });

    it('happyPath_theMonthAddsUpEveryRun', async () => {
        const world = await readyWorld();
        // A download on the small job handed over (back to queued), counted on top of an earlier run of the month.
        await world.deps.documents.set(FIRESTORE_PATHS.cloudRunUsage('2026-10'), cloudRunUsageDocSchema, {
            month: '2026-10',
            vcpuSeconds: 100,
            gibSeconds: 400,
            runs: 1,
            updatedBy: 'system:imagery',
            updatedAt: at(NOW),
        });
        const handedOver = job({ status: 'queued', machine: 'fetch' });
        await seedJob(world, JOB, handedOver);

        expect(await countCloudRun(world.deps, CITY, JOB, { before: job({ machine: 'fetch' }), after: handedOver })).toBe(true);

        expect(await usage(world)).toMatchObject({ vcpuSeconds: 1100, gibSeconds: 4400, runs: 2 });
    });

    it('badPath_aLateEventOfAnEarlierRunCountsNothing', async () => {
        const world = await readyWorld();
        // A later run was counted already (its dispatch after this one's).
        await seedJob(world, JOB, job({ status: 'queued', usageCountedAt: at('2026-10-23T07:50:00.000Z') }));

        expect(await countCloudRun(world.deps, CITY, JOB, { before: job(), after: job({ status: 'queued' }) })).toBe(false);
        expect(await usage(world)).toBeUndefined();
    });

    it('badPath_aJobThatIsGoneCountsNothing', async () => {
        const world = await readyWorld();

        expect(await countCloudRun(world.deps, CITY, JOB, { before: job(), after: job({ status: 'failed' }) })).toBe(false);
        expect(await usage(world)).toBeUndefined();
    });

    it('badPath_aCountThatFailsIsLoggedAndTheTriggerGoesOn', async () => {
        const world = await readyWorld();
        const ended = job({ status: 'awaiting_gcps' });
        await seedJob(world, JOB, ended);
        world.deps.documents.transaction = () => Promise.reject(new Error('contention'));

        await expect(onJobWrite(world.deps, CITY, JOB, { before: job(), after: ended })).resolves.toBe('none');
        expect(world.deps.recording.records.map((record) => record.message)).toContain('cloud run not counted');
    });

    it.each([
        ['a heartbeat', job(), job({ progress: 0.5 })],
        ['a start', job({ status: 'queued' }), job({ status: 'starting' })],
        ['a run handed from starting to running', job({ status: 'starting' }), job()],
        ['a job created already finished', undefined, job({ status: 'failed' })],
        ['a run without its machine', job({ machine: undefined }), job({ status: 'failed', machine: undefined })],
        ['a run without its dispatch', job({ dispatchAt: undefined }), job({ status: 'failed', dispatchAt: undefined })],
    ] as const)('endedCloudRun_nothingEnded_%s', (_name, before, after) => {
        expect(endedCloudRun(before, after)).toBeUndefined();
    });
});
