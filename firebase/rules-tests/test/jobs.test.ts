/**
 * cities/{city}/jobs/{job} (+ logs), cities/{city}/layerVersions/{version} and cities/{city}/usgsScenes/{scene}: since M3
 * no client queues a job (`CLIENT_WRITES.job.create` is empty: the imagery callables and triggers create every job with
 * its checks, CR-M3-2); admins ask an unfinished job to stop, read the layer versions and triage harvested USGS scenes.
 * The dispatcher, the pipeline, the publisher and the harvest own every other field.
 */
import { FIRESTORE_PATHS, JOB_STATUSES, JOB_TYPES, USGS_SCENE_STATUSES } from '@hcm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { jobDoc, layerDoc, layerVersionDoc, newJob, runChoiceDoc, usgsSceneDoc, workerDoc } from './support/documents.js';
import { createWorld, deleted, serverTime, stampedBy, verdict, withChanges, type Data, type Verdict, type World } from './support/world.js';

const CITY_ID = 'rules-jobs';
const FINISHED = ['succeeded', 'failed', 'cancelled'];
/** What an admin's client may set (M4: `ordered` and `available` are the order callables' and the harvest's). */
const TRIAGE = ['candidate', 'rejected'];

let world: World;
let sequence = 0;

function nextId(): string {
    sequence += 1;
    return `j${String(sequence)}`;
}

function queue(changes: Data, id = nextId()): Promise<Verdict> {
    const job = withChanges(newJob(world.uid('admin')), changes);
    return verdict(
        world
            .db('admin')
            .doc(`${FIRESTORE_PATHS.jobs(CITY_ID)}/${id}`)
            .set(job),
    );
}

async function seeded(path: string, data: Data): Promise<string> {
    await world.seed(path, data);
    return path;
}

async function cancel(status: string, changes: Data = { cancelRequested: true }): Promise<Verdict> {
    const path = await seeded(FIRESTORE_PATHS.job(CITY_ID, nextId()), jobDoc(world.uid('admin'), status));
    return verdict(
        world
            .db('admin')
            .doc(path)
            .update({ ...stampedBy(world.uid('admin')), ...changes }),
    );
}

async function triage(changes: Data, status = 'candidate'): Promise<Verdict> {
    const path = await seeded(FIRESTORE_PATHS.usgsScene(CITY_ID, nextId()), usgsSceneDoc(status));
    return verdict(
        world
            .db('admin')
            .doc(path)
            .update({ ...stampedBy(world.uid('admin')), ...changes }),
    );
}

beforeAll(async () => {
    world = await createWorld('jobs');
});

afterAll(async () => {
    await world.close();
});

describe('queue a job', () => {
    it.each(JOB_TYPES)('badPath_noClientQueuesAJob_%s', async (type) => {
        expect(await queue({ type })).toBe('deny');
    });

    it('badPath_noClientDeletesALayerOrQueuesItsTilesetDeletion @S-A33-BAD-CLIENT-LAYER-DELETE', async () => {
        const layer = await seeded(FIRESTORE_PATHS.layer(CITY_ID, 'l1960'), layerDoc());
        const removal = await verdict(world.db('admin').doc(layer).delete());

        expect({ job: await queue({ type: 'layer-delete', params: { layerId: 'l1960' } }), removal }).toEqual({
            job: 'deny',
            removal: 'deny',
        });
        expect(JOB_TYPES).toContain('layer-delete');
    });

    it.each([
        ['an unknown type', { type: 'shell' }],
        ['a status other than queued', { status: 'running' }],
        ['a runner-owned field', { step: 'publish' }],
    ])('badPath_adminCannotQueueWith_%s', async (_label, changes) => {
        expect(await queue(changes)).toBe('deny');
    });
});

describe('layer versions', () => {
    it('happyPath_adminReadsALayerVersionAndNoClientWritesOne', async () => {
        const path = await seeded(FIRESTORE_PATHS.layerVersion(CITY_ID, 'v1'), layerVersionDoc());
        const read = await verdict(world.db('admin').doc(path).get());
        const edit = await verdict(
            world
                .db('admin')
                .doc(path)
                .update({ state: 'approved', ...stampedBy(world.uid('admin')) }),
        );
        const create = await verdict(world.db('admin').doc(FIRESTORE_PATHS.layerVersion(CITY_ID, 'v2')).set(layerVersionDoc()));
        const removal = await verdict(world.db('admin').doc(path).delete());

        expect({ read, edit, create, removal }).toEqual({ read: 'allow', edit: 'deny', create: 'deny', removal: 'deny' });
    });
});

describe('cancel a job', () => {
    it.each(JOB_STATUSES.filter((status) => !FINISHED.includes(status)))('happyPath_adminCancelsAJobThatIs_%s', async (status) => {
        expect(await cancel(status)).toBe('allow');
    });

    it.each(FINISHED)('badPath_aFinishedJobCannotBeCancelled_%s', async (status) => {
        expect(await cancel(status)).toBe('deny');
    });

    it.each([
        ['a cancellation withdrawn', { cancelRequested: false }],
        ['a status change', { cancelRequested: true, status: 'succeeded' }],
        ['new params', { cancelRequested: true, params: {} }],
        ['another editor', { cancelRequested: true, updatedBy: 'someone-else' }],
        ['a rewritten createdAt', { cancelRequested: true, createdAt: serverTime() }],
    ])('badPath_adminCannotSend_%s', async (_label, changes) => {
        expect(await cancel('running', changes)).toBe('deny');
    });

    it('badPath_aCancellationMustBeStamped', async () => {
        const path = await seeded(FIRESTORE_PATHS.job(CITY_ID, nextId()), jobDoc(world.uid('admin')));

        expect(await verdict(world.db('admin').doc(path).update({ cancelRequested: true }))).toBe('deny');
    });
});

// Pause (the owner's request of 2026-11-13): only imagery.pause pauses or resumes a job or a computer; a paused job can be cancelled.
describe('pause a job or a computer @S-A170-BAD-CLIENT-WRITE', () => {
    it('happyPath_aPausedQueuedJobCanStillBeCancelled', async () => {
        expect(await cancel('queued')).toBe('allow');
    });

    it.each([
        ['a pause', { paused: { by: 'someone', at: serverTime() } }],
        ['a resume', { paused: deleted() }],
        ['a computer asked back', { releaseRequested: deleted() }],
        ['a pause beside a cancel', { cancelRequested: true, paused: deleted() }],
    ])('badPath_noClientSends_%s', async (_label, changes) => {
        expect(await cancel('running', changes)).toBe('deny');
    });

    it('badPath_noClientPausesOrResumesAComputer', async () => {
        const worker = await seeded(FIRESTORE_PATHS.worker(CITY_ID, 'w-2222222222222222'), workerDoc(world.uid('admin')));
        const member = world.db('admin');

        expect({
            resume: await verdict(member.doc(worker).update({ paused: deleted(), ...stampedBy(world.uid('admin')) })),
            pause: await verdict(member.doc(worker).update({ paused: { by: 'x', at: serverTime() }, ...stampedBy(world.uid('admin')) })),
        }).toEqual({ resume: 'deny', pause: 'deny' });
    });
});

// Review of M18 item 3: an editor placing points on a parked frame marks its job, so imagery.tick leaves it waiting.
describe('mark a parked frame as getting points', () => {
    async function mark(status: string, changes: Data = { placingPoints: true }, stamp = true): Promise<Verdict> {
        const unmarked = Object.fromEntries(Object.entries(jobDoc(world.uid('admin'), status)).filter(([key]) => key !== 'placingPoints'));
        const path = await seeded(FIRESTORE_PATHS.job(CITY_ID, nextId()), unmarked);
        const update = stamp ? { ...stampedBy(world.uid('admin')), ...changes } : changes;
        return verdict(world.db('admin').doc(path).update(update));
    }

    it('happyPath_anEditorMarksAFrameWaitingForPoints', async () => {
        expect(await mark('awaiting_gcps')).toBe('allow');
    });

    it.each([
        ['a job not waiting for points', 'running', { placingPoints: true }, true],
        ['a mark withdrawn', 'awaiting_gcps', { placingPoints: false }, true],
        ['another field with it', 'awaiting_gcps', { placingPoints: true, searchedWith: `sha256:${'cd'.repeat(32)}` }, true],
        ['an unstamped mark', 'awaiting_gcps', { placingPoints: true }, false],
    ] as const)('badPath_noMarkFor_%s', async (_label, status, changes, stamp) => {
        expect(await mark(status, changes, stamp)).toBe('deny');
    });
});

describe('triage a USGS scene', () => {
    it.each(TRIAGE)('happyPath_adminMarksASceneAs_%s', async (status) => {
        expect(await triage({ status, note: 'Comandat pe 2026-10-11.' })).toBe('allow');
    });

    it.each(USGS_SCENE_STATUSES)('happyPath_adminAnnotatesASceneThatIs_%s', async (status) => {
        expect(await triage({ note: 'Acoperire parțială.' }, status)).toBe('allow');
    });

    it('happyPath_adminRemovesANote', async () => {
        expect(await triage({ note: deleted() })).toBe('allow');
    });

    it.each(USGS_SCENE_STATUSES.filter((status) => !TRIAGE.includes(status)))('badPath_onlyTheHarvestSetsStatus_%s', async (status) => {
        expect(await triage({ status })).toBe('deny');
    });

    it.each([
        ['the status ordered', { status: 'ordered', note: 'Comandat pe 2026-10-11.' }],
        ['the status available', { status: 'available' }],
        ['an order', { order: { state: 'ordered' } }],
        ['an order taken back', { order: deleted() }],
        ['an EarthExplorer id', { eeDatasetId: 'abc123def4567890' }],
    ])('badPath_onlyTheOrderCallablesMarkAnOrder_%s @S-A13-BAD-CLIENT-ORDERED-STATUS', async (_label, changes) => {
        expect(await triage(changes)).toBe('deny');
    });

    it.each([
        ['a not-useful mark', { status: 'rejected', unusable: { reason: 'clouds', at: new Date() } }],
        ['a not-useful mark taken back', { status: 'candidate', unusable: deleted() }],
        ['a cloud estimate', { cloudEstimate: { percent: 0, version: 1 } }],
    ])('badPath_onlyTheServerWrites_%s @S-A152-BAD-CLIENT-MARK', async (_label, changes) => {
        expect(await triage(changes)).toBe('deny');
    });

    it.each([
        ['a note over 1000 characters', { status: 'rejected', note: 'x'.repeat(1001) }],
        ['an empty note', { note: '' }],
        ['a harvested field', { status: 'rejected', downloadAvailable: false }],
        ['another editor', { status: 'rejected', updatedBy: 'someone-else' }],
    ])('badPath_adminCannotSet_%s', async (_label, changes) => {
        expect(await triage(changes)).toBe('deny');
    });
});

describe('local workers (M7, docs/research/M7-local-worker.md §2.4, §3)', () => {
    it('happyPath_theCitysMembersReadItsWorkersAndItsRunChoice', async () => {
        const worker = await seeded(FIRESTORE_PATHS.worker(CITY_ID, 'w-0123456789abcdef'), workerDoc(world.uid('admin')));
        const choice = await seeded(FIRESTORE_PATHS.runChoice(CITY_ID), runChoiceDoc(world.uid('admin')));
        const member = world.db('admin');

        expect({
            worker: await verdict(member.doc(worker).get()),
            choice: await verdict(member.doc(choice).get()),
            list: await verdict(member.collection(FIRESTORE_PATHS.workers(CITY_ID)).get()),
        }).toEqual({ worker: 'allow', choice: 'allow', list: 'allow' });
    });

    it('badPath_noClientWritesAWorkerOrTheChoiceAndOtherCitiesReadNeither', async () => {
        const worker = await seeded(FIRESTORE_PATHS.worker(CITY_ID, 'w-fedcba9876543210'), workerDoc(world.uid('admin')));
        const member = world.db('admin');

        expect({
            createWorker: await verdict(
                member.doc(FIRESTORE_PATHS.worker(CITY_ID, 'w-1111111111111111')).set(workerDoc(world.uid('admin'))),
            ),
            refreshWorker: await verdict(member.doc(worker).update({ lastSeenAt: serverTime(), ...stampedBy(world.uid('admin')) })),
            setChoice: await verdict(
                member.doc(FIRESTORE_PATHS.runChoice(CITY_ID)).set({ choice: 'local', ...stampedBy(world.uid('admin')) }),
            ),
            deleteWorker: await verdict(member.doc(worker).delete()),
            outsiderReads: await verdict(world.db('outsider').doc(worker).get()),
            outsiderLists: await verdict(world.db('outsider').collection(FIRESTORE_PATHS.workers(CITY_ID)).get()),
            anonymousReads: await verdict(world.db('anonymous').doc(worker).get()),
        }).toEqual({
            createWorker: 'deny',
            refreshWorker: 'deny',
            setChoice: 'deny',
            deleteWorker: 'deny',
            outsiderReads: 'deny',
            outsiderLists: 'deny',
            anonymousReads: 'deny',
        });
    });
});
