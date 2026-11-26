/**
 * Where a job runs (`functions/src/imagery/{dispatch,place,on-job-write}.ts`, `docs/research/M7-local-worker.md` §3): the
 * dispatcher writes the place the first time it sees a queued job (the city's choice, `auto` meaning the computer while
 * one of its workers was seen within three minutes); a job for the computer waits for a worker, asks Cloud Run for
 * nothing and takes no slot; a queued job the admin moved, or gave the OK, is dispatched again by its trigger.
 */
import {
    FIRESTORE_PATHS,
    opsDispatchDocSchema,
    runChoiceDocSchema,
    workerDocSchema,
    type JobDoc,
    type RunChoice,
    type Schema,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { dispatchJob } from '../../src/imagery/dispatch.js';
import { onJobWrite, transitionOf } from '../../src/imagery/on-job-write.js';
import type { QueryOptions } from '../../src/ports/documents.js';
import { CITY, NOW, at, readJob, readyWorld, seedJob, type ImageryWorld } from './world.js';

const JOB = 'job-1966-0712';
const WORKER = 'w-0123456789abcdef';

function queued(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'usgs-import',
        status: 'queued',
        params: { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: 'kh-4a-corona-1966',
        versionId: JOB,
        updatedBy: 'u-admin',
        updatedAt: at(NOW),
        ...overrides,
    };
}

/** A worker of the city last seen at `lastSeen` (an ISO time). */
async function seedWorker(world: ImageryWorld, lastSeen: string, id = WORKER): Promise<void> {
    await world.deps.documents.set(FIRESTORE_PATHS.worker(CITY, id), workerDocSchema, {
        uid: 'u-admin',
        version: '0.7.0',
        startedAt: at('2026-10-23T07:00:00.000Z'),
        lastSeenAt: at(lastSeen),
        state: 'idle',
        updatedBy: 'u-admin',
        updatedAt: at(lastSeen),
    });
}

/** Runs `change` before every query of the store (a write that lands while the dispatcher decides). */
function beforeEachQuery(world: ImageryWorld, change: () => Promise<void>): void {
    const documents = world.deps.documents;
    const query = documents.query.bind(documents);
    documents.query = async <T>(path: string, schema: Schema<T>, options?: QueryOptions) => {
        await change();
        return query(path, schema, options);
    };
}

async function seedChoice(world: ImageryWorld, choice: RunChoice): Promise<void> {
    await world.deps.documents.set(FIRESTORE_PATHS.runChoice(CITY), runChoiceDocSchema, {
        choice,
        updatedBy: 'u-admin',
        updatedAt: at(NOW),
    });
}

describe('where a job runs', () => {
    it('happyPath_aNewJobGoesToTheComputerWhileAWorkerIsConnected @S-A62-HAPPY-DISPATCH-LOCAL', async () => {
        const world = await readyWorld();
        // Two minutes ago: within WORKER_FRESH_SECONDS (three minutes).
        await seedWorker(world, '2026-10-23T07:58:00.000Z');
        await seedJob(world, JOB, queued());

        expect(await dispatchJob(world.deps, CITY, JOB)).toBe('waiting');

        expect(await readJob(world, JOB)).toMatchObject({
            status: 'queued',
            runOn: 'local',
            waitReason: 'worker',
            updatedBy: 'system:imagery',
        });
        expect(world.jobs.runs).toEqual([]);
        expect(await world.deps.documents.get(FIRESTORE_PATHS.opsDispatch, opsDispatchDocSchema)).toBeUndefined();
        // The tick's next dispatch leaves it waiting, writing nothing more.
        const written = await readJob(world, JOB);
        expect(await dispatchJob(world.deps, CITY, JOB)).toBe('waiting');
        expect(await readJob(world, JOB)).toEqual(written);
    });

    it('happyPath_withoutAConnectedWorkerAutoMeansTheCloud', async () => {
        const world = await readyWorld();
        // Four minutes ago: no longer connected. The run choice document is not a worker.
        await seedWorker(world, '2026-10-23T07:56:00.000Z');
        await seedChoice(world, 'auto');
        await seedJob(world, JOB, queued());

        expect(await dispatchJob(world.deps, CITY, JOB)).toBe('started');

        expect(await readJob(world, JOB)).toMatchObject({ status: 'starting', runOn: 'cloud', machine: 'fetch' });
        expect(world.jobs.runs).toHaveLength(1);
    });

    it('happyPath_theCitysChoiceWinsOverAConnectedWorker', async () => {
        const world = await readyWorld();
        await seedWorker(world, NOW);
        await seedChoice(world, 'cloud');
        await seedJob(world, JOB, queued());

        expect(await dispatchJob(world.deps, CITY, JOB)).toBe('started');
        expect((await readJob(world, JOB))?.runOn).toBe('cloud');
    });

    it('happyPath_alwaysOnTheComputerWaitsWithoutAWorker', async () => {
        const world = await readyWorld();
        await seedChoice(world, 'local');
        await seedJob(world, JOB, queued());

        expect(await dispatchJob(world.deps, CITY, JOB)).toBe('waiting');
        expect(await readJob(world, JOB)).toMatchObject({ runOn: 'local', waitReason: 'worker' });
        expect(world.jobs.runs).toEqual([]);
    });

    it('happyPath_aPlacedJobKeepsItsPlace', async () => {
        const world = await readyWorld();
        await seedWorker(world, NOW);
        await seedJob(world, JOB, queued({ runOn: 'cloud' }));

        expect(await dispatchJob(world.deps, CITY, JOB)).toBe('started');
        expect((await readJob(world, JOB))?.runOn).toBe('cloud');
    });

    it('badPath_aJobTakenWhileItsPlaceIsDecidedIsLeftAlone', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, queued());
        // The job is cancelled between the dispatcher's read and its transaction.
        beforeEachQuery(world, () => seedJob(world, JOB, queued({ status: 'cancelled' })));

        expect(await dispatchJob(world.deps, CITY, JOB)).toBe('skipped');
        expect((await readJob(world, JOB))?.runOn).toBeUndefined();
    });

    it('badPath_aJobPlacedMeanwhileKeepsThePlaceItGot', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, queued());
        // The admin's choice lands between the dispatcher's read and its transaction.
        beforeEachQuery(world, () => seedJob(world, JOB, queued({ runOn: 'local' })));

        expect(await dispatchJob(world.deps, CITY, JOB)).toBe('waiting');
        expect(await readJob(world, JOB)).toMatchObject({ runOn: 'local', waitReason: 'worker' });
    });
});

describe('runs on the computer take no Cloud Run slot', () => {
    it('happyPath_localRunsLeaveTheCloudSlotsFree @S-A62-HAPPY-DISPATCH-LOCAL', async () => {
        const world = await readyWorld();
        const lease = { owner: `worker:${WORKER}`, until: at('2026-10-23T08:05:00.000Z') };
        // A local job a worker claimed (starting, no execution), one it runs, and a worker's run of a job placed before M7.
        await seedJob(world, 'claimed', queued({ status: 'starting', runOn: 'local', lease }));
        await seedJob(world, 'running', queued({ status: 'running', runOn: 'local', lease }));
        await seedJob(world, 'leased', queued({ status: 'running', lease }));
        await world.deps.documents.set(FIRESTORE_PATHS.opsDispatch, opsDispatchDocSchema, {
            slots: { [`${CITY}/claimed`]: { at: at(NOW) }, [`${CITY}/running`]: { at: at(NOW) } },
            updatedBy: 'system:imagery',
            updatedAt: at(NOW),
        });
        await seedJob(world, JOB, queued({ runOn: 'cloud' }));

        expect(await dispatchJob(world.deps, CITY, JOB)).toBe('started');

        expect(world.jobs.runs).toHaveLength(1);
        const slots = await world.deps.documents.get(FIRESTORE_PATHS.opsDispatch, opsDispatchDocSchema);
        expect(Object.keys(slots?.slots ?? {})).toEqual([`${CITY}/${JOB}`]);
    });
});

describe('a queued job moved or given the OK', () => {
    const placed = queued({ runOn: 'cloud', waitReason: 'free-tier' });

    it.each([
        ['moved to the computer', placed, queued({ runOn: 'local' }), 'dispatch'],
        ['given the OK', placed, queued({ runOn: 'cloud', freeTierOk: { by: 'u-admin', at: at(NOW) } }), 'dispatch'],
        ['placed the first time (the dispatcher itself)', queued(), queued({ runOn: 'cloud' }), 'none'],
        ['waiting for another reason', placed, queued({ runOn: 'cloud', waitReason: 'capacity' }), 'none'],
        ['moved while it waits for USGS', queued({ status: 'waiting_usgs', runOn: 'cloud' }), queued({ status: 'waiting_usgs' }), 'none'],
    ] as const)('transitionOf_%s', (_name, before, after, transition) => {
        expect(transitionOf(before, after)).toBe(transition);
    });

    it('happyPath_theTriggerDispatchesAJobTheAdminMovedToTheComputer', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, queued({ runOn: 'local' }));

        expect(await onJobWrite(world.deps, CITY, JOB, { before: placed, after: queued({ runOn: 'local' }) })).toBe('dispatch');
        expect(await readJob(world, JOB)).toMatchObject({ runOn: 'local', waitReason: 'worker' });
        expect(world.jobs.runs).toEqual([]);
    });
});
