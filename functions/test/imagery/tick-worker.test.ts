/**
 * Finding 68 of 2026-11-02 (`functions/src/imagery/tick-worker.ts`, `docs/research/M7-local-worker.md` §3.1): a job placed
 * on the owner's computer that waited `WORKER_WAIT_MINUTES` with no worker of the city seen is marked `workerOverdueAt`
 * (its page offers Run in Google Cloud instead) and leaves one inbox item, `job.noWorker`; a worker about, a job not yet
 * that late or already marked, and a cloud job are left alone. The tick runs it while the guard is green.
 */
import {
    FIRESTORE_PATHS,
    WORKER_WAIT_MINUTES,
    notificationEventDocSchema,
    notificationEventId,
    workerDocSchema,
    type JobDoc,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { offerCloud } from '../../src/imagery/tick-worker.js';
import { runImageryTick } from '../../src/imagery/tick.js';
import { CITY, NOW, at, readJob, readyWorld, renderedVersion, seedJob, seedVersion, type ImageryWorld } from './world.js';

const JOB = 'job-1966-0712';
const MINUTE = 60_000;

function ago(minutes: number) {
    return at(new Date(Date.parse(NOW) - minutes * MINUTE).toISOString());
}

/** A job waiting for the computer since `minutes` ago. */
function waiting(minutes: number, overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'usgs-import',
        status: 'queued',
        params: { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' },
        createdBy: 'u-admin',
        createdAt: ago(minutes),
        layerId: 'kh-4a-corona-1966',
        versionId: JOB,
        runOn: 'local',
        waitReason: 'worker',
        updatedBy: 'system:imagery',
        updatedAt: ago(minutes),
        ...overrides,
    };
}

async function events(world: ImageryWorld) {
    return (await world.deps.documents.query(FIRESTORE_PATHS.notificationEvents, notificationEventDocSchema)).documents;
}

async function seedWorkerSeen(world: ImageryWorld, minutes: number): Promise<void> {
    await world.deps.documents.set(FIRESTORE_PATHS.worker(CITY, 'w-0123456789abcdef'), workerDocSchema, {
        ...{ uid: 'u-admin', version: '1.0.0', startedAt: ago(minutes), lastSeenAt: ago(minutes), state: 'idle' },
        ...{ updatedBy: 'u-admin', updatedAt: ago(minutes) },
    });
}

describe('a local job no computer came for', () => {
    it('happyPath_isMarkedAndToldOnceWithTheCloudOffer @S-A62-HAPPY-NO-WORKER-OFFER', async () => {
        const world = await readyWorld();
        await seedVersion(world, JOB, renderedVersion());
        await seedJob(world, JOB, waiting(WORKER_WAIT_MINUTES + 1));
        await seedWorkerSeen(world, 60);

        await runImageryTick(world.deps);
        await offerCloud(world.deps, CITY, new Date(NOW));

        await expect(readJob(world, JOB)).resolves.toMatchObject({ status: 'queued', runOn: 'local', workerOverdueAt: at(NOW) });
        const told = await events(world);
        expect(told.map((event) => event.id)).toEqual([notificationEventId('job.noWorker', CITY, JOB)]);
        expect(told[0]?.data).toMatchObject({
            kind: 'job.noWorker',
            params: { minutes: String(WORKER_WAIT_MINUTES) },
            link: `#/imagery/version/${JOB}`,
        });
    });

    it.each([
        ['not yet that late', waiting(WORKER_WAIT_MINUTES - 1)],
        ['already marked', waiting(60, { workerOverdueAt: ago(30) })],
        ['in the cloud', waiting(60, { runOn: 'cloud', waitReason: 'capacity' })],
        ['running', waiting(60, { status: 'running' })],
    ])('badPath_aJob%sIsLeftAlone @S-A62-BAD-NO-WORKER-QUIET', async (_name, job) => {
        const world = await readyWorld();
        await seedJob(world, JOB, job);

        await offerCloud(world.deps, CITY, new Date(NOW));

        await expect(readJob(world, JOB)).resolves.toEqual(job);
        await expect(events(world)).resolves.toEqual([]);
    });

    it('badPath_aLocalOnlyJobIsNeverOfferedTheCloud @S-A121-BAD-LOCAL-ONLY-CLOUD', async () => {
        const world = await readyWorld();
        const job = waiting(60, { localOnly: true });
        await seedJob(world, JOB, job);

        await offerCloud(world.deps, CITY, new Date(NOW));

        await expect(readJob(world, JOB)).resolves.toEqual(job);
        await expect(events(world)).resolves.toEqual([]);
    });

    it('badPath_aWorkerSeenLatelyWillClaimItSoNothingIsSaid @S-A62-BAD-NO-WORKER-QUIET', async () => {
        const world = await readyWorld();
        const job = waiting(60);
        await seedJob(world, JOB, job);
        await seedWorkerSeen(world, 1);

        await offerCloud(world.deps, CITY, new Date(NOW));

        await expect(readJob(world, JOB)).resolves.toEqual(job);
        await expect(events(world)).resolves.toEqual([]);
    });

    it('badPath_aJobClaimedBetweenTheQueryAndTheMarkIsNotMarked', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, waiting(60));
        const { documents } = world.deps;
        const racing: typeof documents = {
            ...documents,
            transaction: (work) => {
                documents.seed(FIRESTORE_PATHS.job(CITY, JOB), waiting(60, { status: 'starting' }));
                return documents.transaction(work);
            },
        };

        await offerCloud({ ...world.deps, documents: racing }, CITY, new Date(NOW));

        await expect(readJob(world, JOB)).resolves.not.toHaveProperty('workerOverdueAt');
        await expect(events(world)).resolves.toEqual([]);
    });
});
