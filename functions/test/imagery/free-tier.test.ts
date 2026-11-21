/**
 * Cloud Run's free tier before a dispatch (`functions/src/imagery/{free-tier,dispatch}.ts`, `docs/research/M7-local-worker.md`
 * §4.3): a cloud run whose estimate would carry the month's counted use past the free tier waits for the admin's OK; one
 * made by automation (a server writer, the order watch) also leaves an inbox item, once; the OK and a hand-over from the
 * download job are never asked again.
 */
import {
    CLOUD_RUN_FREE_TIER,
    FIRESTORE_PATHS,
    cloudRunUsageDocSchema,
    notificationEventDocSchema,
    notificationEventId,
    type JobDoc,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { dispatchJob } from '../../src/imagery/dispatch.js';
import { estimateCloudRun, passesFreeTier } from '../../src/imagery/free-tier.js';
import { CITY, NOW, at, readJob, readyWorld, renderedVersion, seedJob, seedScene, seedVersion, type ImageryWorld } from './world.js';

const JOB = 'job-1966-0712';
/** An import's download phase done (the small job hands the job over for its processing). */
const DOWNLOADED: JobDoc['steps'] = { fetch: { status: 'done' }, extract: { status: 'done' } };

function queued(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'usgs-import',
        status: 'queued',
        params: { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: 'kh-4a-corona-1966',
        versionId: JOB,
        runOn: 'cloud',
        updatedBy: 'u-admin',
        updatedAt: at(NOW),
        ...overrides,
    };
}

/** This month's counted use: 175,000 of the 180,000 vCPU-seconds (an import's estimate, 7,200 since 2026-11-12, passes the rest). */
async function seedUse(world: ImageryWorld, vcpuSeconds = 175_000, gibSeconds = 100_000): Promise<void> {
    await world.deps.documents.set(FIRESTORE_PATHS.cloudRunUsage('2026-10'), cloudRunUsageDocSchema, {
        month: '2026-10',
        vcpuSeconds,
        gibSeconds,
        runs: 12,
        updatedBy: 'system:imagery',
        updatedAt: at(NOW),
    });
}

async function events(world: ImageryWorld) {
    return (await world.deps.documents.query(FIRESTORE_PATHS.notificationEvents, notificationEventDocSchema)).documents;
}

async function overTheTier(job: JobDoc): Promise<ImageryWorld> {
    const world = await readyWorld();
    await seedUse(world);
    await seedJob(world, JOB, job);
    await seedVersion(world, JOB, renderedVersion({ state: 'processing', output: undefined }));
    return world;
}

describe('the free tier before a cloud run', () => {
    it('badPath_anAutomatedRunPastTheFreeTierWaitsWithAnInboxItem @S-A63-BAD-AUTOMATION-WAITS', async () => {
        const world = await overTheTier(queued({ createdBy: 'system:imagery' }));

        expect(await dispatchJob(world.deps, CITY, JOB)).toBe('waiting');

        expect(await readJob(world, JOB)).toMatchObject({ status: 'queued', waitReason: 'free-tier' });
        expect(world.jobs.runs).toEqual([]);
        const found = await events(world);
        expect(found.map((event) => event.id)).toEqual([notificationEventId('job.needsOk', CITY, JOB)]);
        expect(found[0]?.data).toMatchObject({
            kind: 'job.needsOk',
            severity: 'warning',
            cityId: CITY,
            params: { label: 'KH-4A Corona, 12 iulie 1966' },
            link: `#/imagery/version/${JOB}`,
        });
        // The tick's next dispatch keeps it waiting and asks no second time.
        expect(await dispatchJob(world.deps, CITY, JOB)).toBe('waiting');
        expect(await events(world)).toHaveLength(1);
    });

    it('badPath_aRunStartedByAClickWaitsWithoutAnInboxItem @S-A63-BAD-AUTOMATION-WAITS', async () => {
        const world = await overTheTier(queued());

        expect(await dispatchJob(world.deps, CITY, JOB)).toBe('waiting');

        expect((await readJob(world, JOB))?.waitReason).toBe('free-tier');
        expect(await events(world)).toEqual([]);
    });

    it('badPath_anImportTheOrderWatchStartedAsksForTheOk @S-A63-BAD-AUTOMATION-WAITS', async () => {
        const world = await overTheTier(queued());
        await seedScene(world, 'DS1035-1057DA023', {
            status: 'imported',
            layerId: 'kh-4a-corona-1966',
            order: {
                state: 'importing',
                orderedAt: at('2026-10-01T08:00:00.000Z'),
                orderedBy: 'u-admin',
                checks: 3,
                nextCheckAt: at(NOW),
                remindersSent: [],
                importJobId: JOB,
            },
        });

        expect(await dispatchJob(world.deps, CITY, JOB)).toBe('waiting');
        expect((await events(world)).map((event) => event.data.kind)).toEqual(['job.needsOk']);
    });

    it('happyPath_withTheOkTheRunStarts @S-A63-BAD-AUTOMATION-WAITS', async () => {
        const world = await overTheTier(queued({ createdBy: 'system:imagery', freeTierOk: { by: 'u-admin', at: at(NOW) } }));

        expect(await dispatchJob(world.deps, CITY, JOB)).toBe('started');
        expect(world.jobs.runs).toHaveLength(1);
        expect(await events(world)).toEqual([]);
    });

    it('happyPath_aHandOverFromTheDownloadJobIsNeverAskedAgain @S-A63-BAD-AUTOMATION-WAITS', async () => {
        const world = await overTheTier(queued({ machine: 'fetch', attempt: 1, steps: DOWNLOADED }));

        expect(await dispatchJob(world.deps, CITY, JOB)).toBe('started');
        expect(await readJob(world, JOB)).toMatchObject({ status: 'starting', machine: 'std', attempt: 1 });
    });

    it('happyPath_withinTheFreeTierTheRunStarts', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, queued({ createdBy: 'system:imagery' }));

        expect(await dispatchJob(world.deps, CITY, JOB)).toBe('started');
        expect(await events(world)).toEqual([]);
    });

    it('badPath_anUploadByAClickAndAnUnreadableSceneAskNothing', async () => {
        const world = await overTheTier(queued({ type: 'geotiff-import', params: { uploadPath: 'uploads/bucharest/u1/plan.tif' } }));
        await seedJob(world, 'job-2', queued());
        world.deps.documents.seed(FIRESTORE_PATHS.usgsScene(CITY, 'DS1035-1057DA023'), { status: 'not a scene' });

        expect(await dispatchJob(world.deps, CITY, JOB)).toBe('waiting');
        expect(await dispatchJob(world.deps, CITY, 'job-2')).toBe('waiting');
        expect(await events(world)).toEqual([]);
    });

    it('badPath_anAutomatedJobWithAnUnreadableVersionIsNamedByItsType', async () => {
        const world = await overTheTier(queued({ createdBy: 'system:imagery' }));
        world.deps.documents.seed(FIRESTORE_PATHS.layerVersion(CITY, JOB), { state: 'not a version' });

        expect(await dispatchJob(world.deps, CITY, JOB)).toBe('waiting');
        expect((await events(world))[0]?.data.params).toEqual({ label: 'usgs-import' });
    });

    it('badPath_anAutomatedJobWithoutItsVersionIsNamedByItsType', async () => {
        const world = await readyWorld();
        await seedUse(world);
        await seedJob(world, JOB, queued({ type: 'regeoref', params: { basedOn: 'job-1966-0101' }, createdBy: 'system:imagery' }));

        expect(await dispatchJob(world.deps, CITY, JOB)).toBe('waiting');
        expect((await events(world))[0]?.data.params).toEqual({ label: 'regeoref' });
    });
});

describe('estimateCloudRun', () => {
    it.each([
        ['an import still to download (fetch, then std)', queued(), { vcpuSeconds: 1800 + 5400, gibSeconds: 7200 + 21_600 }],
        [
            'a downloaded KH-9 panoramic frame (xl)',
            queued({ params: { sensor: 'KH-9-pan' }, steps: DOWNLOADED }),
            { vcpuSeconds: 14_400, gibSeconds: 57_600 },
        ],
        [
            'an escalated import still to download (both on xl)',
            queued({ machine: 'xl' }),
            { vcpuSeconds: 7200 + 14_400, gibSeconds: 28_800 + 57_600 },
        ],
        ['an upload (no download)', queued({ type: 'geotiff-import', params: {} }), { vcpuSeconds: 5400, gibSeconds: 21_600 }],
    ] as const)('estimateCloudRun_%s', (_name, job, estimate) => {
        expect(estimateCloudRun(job)).toEqual(estimate);
    });

    it('passesFreeTier_eitherFigurePassingIsEnough', () => {
        const none = { vcpuSeconds: 0, gibSeconds: 0 };
        expect(passesFreeTier(none, { vcpuSeconds: CLOUD_RUN_FREE_TIER.vcpuSeconds, gibSeconds: 0 })).toBe(false);
        expect(passesFreeTier(none, { vcpuSeconds: CLOUD_RUN_FREE_TIER.vcpuSeconds + 1, gibSeconds: 0 })).toBe(true);
        expect(passesFreeTier({ vcpuSeconds: 0, gibSeconds: CLOUD_RUN_FREE_TIER.gibSeconds }, { vcpuSeconds: 0, gibSeconds: 1 })).toBe(
            true,
        );
    });
});
