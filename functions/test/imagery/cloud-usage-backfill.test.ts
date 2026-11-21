/**
 * Finding 64 of 2026-11-02 (`functions/src/imagery/cloud-usage-backfill.ts`, `docs/research/M7-local-worker.md` §4.2):
 * the month's cloud runs that ended before Cloud Run's use was counted are added once, from their jobs' times, by the
 * first `imagery.tick` of the month; later ticks and later counts keep it.
 */
import { FIRESTORE_PATHS, cloudRunUsageDocSchema, type JobDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { countCloudRun } from '../../src/imagery/cloud-usage.js';
import { BACKFILL_RUN_MAX_SECONDS, backfillCloudUsage, backfillSeconds } from '../../src/imagery/cloud-usage-backfill.js';
import { runImageryTick } from '../../src/imagery/tick.js';
import { CITY, NOW, at, readyWorld, seedJob, type ImageryWorld } from './world.js';

function job(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'usgs-import',
        status: 'failed',
        params: { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' },
        createdBy: 'u-admin',
        createdAt: at('2026-10-20T08:00:00.000Z'),
        layerId: 'kh-4a-corona-1966',
        versionId: 'v',
        runOn: 'cloud',
        machine: 'std',
        attempt: 1,
        dispatchAt: at('2026-10-20T08:00:00.000Z'),
        finishedAt: at('2026-10-20T08:10:00.000Z'),
        updatedBy: 'system:pipeline',
        updatedAt: at('2026-10-20T08:10:00.000Z'),
        ...overrides,
    };
}

function usage(world: ImageryWorld) {
    return world.deps.documents.get(FIRESTORE_PATHS.cloudRunUsage('2026-10'), cloudRunUsageDocSchema);
}

describe("the month's uncounted cloud runs", () => {
    it('happyPath_theRunsBeforeTheCountAreAddedOnce @S-A63-HAPPY-BACKFILL', async () => {
        const world = await readyWorld();
        // Counted: a failed run of 600 s on std (its end recorded), and a run of 300 s waiting for points after georef, with
        // no machine named (std, before §82f), which ended at its last step.
        await seedJob(world, 'failed-std', job());
        const georef = { status: 'done', startedAt: at('2026-10-21T09:00:00.000Z'), finishedAt: at('2026-10-21T09:05:00.000Z') } as const;
        await seedJob(
            world,
            'waiting-points',
            job({
                status: 'awaiting_gcps',
                machine: undefined,
                finishedAt: undefined,
                dispatchAt: at('2026-10-21T09:00:00.000Z'),
                steps: { georef },
            }),
        );
        // Not counted: a run counted already, one on the owner's computer, one running now, one of last month.
        await seedJob(world, 'counted', job({ usageCountedAt: at('2026-10-20T08:00:00.000Z') }));
        await seedJob(world, 'local', job({ runOn: 'local' }));
        await seedJob(world, 'running', job({ status: 'running', finishedAt: undefined }));
        await seedJob(world, 'september', job({ dispatchAt: at('2026-09-30T08:00:00.000Z'), finishedAt: at('2026-09-30T09:00:00.000Z') }));

        expect(await backfillCloudUsage(world.deps, new Date(NOW))).toBe(true);

        // (600 + 300) s × 2 vCPU and × 8 GiB (`std` since 2026-11-12), two runs.
        expect(await usage(world)).toMatchObject({ month: '2026-10', vcpuSeconds: 1800, gibSeconds: 7200, runs: 2 });
        expect((await usage(world))?.backfilledAt).toBeDefined();

        // Once: the next tick adds nothing, and a run counted later keeps the mark.
        expect(await backfillCloudUsage(world.deps, new Date(NOW))).toBe(false);
        const before = job({ status: 'running', finishedAt: undefined, dispatchAt: at('2026-10-23T07:50:00.000Z') });
        await seedJob(world, 'later', { ...before, status: 'failed' });
        await countCloudRun(world.deps, CITY, 'later', { before, after: { ...before, status: 'failed' } });
        expect(await usage(world)).toMatchObject({ vcpuSeconds: 3000, gibSeconds: 12_000, runs: 3 });
        expect((await usage(world))?.backfilledAt).toBeDefined();
    });

    it('badPath_aJobWhoseTimesSayTooMuchOrNothingCountsAtMostTheCap', () => {
        expect(backfillSeconds(job({ finishedAt: at('2026-10-22T08:00:00.000Z') }))).toBe(BACKFILL_RUN_MAX_SECONDS);
        expect(backfillSeconds(job({ finishedAt: undefined }))).toBe(0);
        expect(backfillSeconds(job({ dispatchAt: undefined }))).toBe(0);
        expect(backfillSeconds(job({ finishedAt: at('2026-10-19T08:00:00.000Z') }))).toBe(0);
    });

    it('badPath_aMonthBackfilledMeanwhileIsNotAddedTwice @S-A63-BAD-BACKFILL-ONCE', async () => {
        const world = await readyWorld();
        await seedJob(world, 'failed-std', job());
        const documents = world.deps.documents;
        const transaction = documents.transaction.bind(documents);
        // Another writer marks the month between the read and the transaction.
        documents.transaction = async <R>(work: Parameters<typeof transaction<R>>[0]): Promise<R> => {
            await documents.set(FIRESTORE_PATHS.cloudRunUsage('2026-10'), cloudRunUsageDocSchema, {
                ...{ month: '2026-10', vcpuSeconds: 1, gibSeconds: 1, runs: 1, backfilledAt: at(NOW) },
                ...{ updatedBy: 'system:imagery', updatedAt: at(NOW) },
            });
            return transaction(work);
        };

        expect(await backfillCloudUsage(world.deps, new Date(NOW))).toBe(false);
        expect(await usage(world)).toMatchObject({ vcpuSeconds: 1, runs: 1 });
    });

    it('badPath_aBackfillThatFailsIsLoggedAndTheTickGoesOn', async () => {
        const world = await readyWorld();
        const documents = world.deps.documents;
        const get = documents.get.bind(documents);
        documents.get = <T>(path: string, schema: Parameters<typeof get<T>>[1]): Promise<T | undefined> =>
            path.startsWith('usage/cloudrun-') ? Promise.reject(new Error('unavailable')) : get(path, schema);

        expect(await runImageryTick(world.deps)).toEqual(['backfill']);
        expect(world.deps.recording.records.map((record) => record.message)).toContain('imagery tick part failed');
    });
});
