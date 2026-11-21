/**
 * M20's archive copies (`functions/src/worker/{archive-host,archive-copy}.ts`; live report of 2026-11-13): any worker claims an
 * archive series; one without its sheets hands it back (`worker.end` `returned`) without spending an attempt, waiting for a copy;
 * the next claim of the worker holding the archive whole gets the series to copy (`copy`); `worker.archiveCopy` signs the copy's
 * files and, once `done`, lets any worker claim the job again; the job's worker reads the copy through `worker.urls`.
 */
import { FIRESTORE_PATHS, archiveDocSchema, type JobDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { omit } from '../../src/api/objects.js';
import { dispatchJob } from '../../src/imagery/dispatch.js';
import { archiveCopyFunction } from '../../src/worker/archive-copy.js';
import { ARCHIVE_RETURNS_MAX, archiveOf, handedBack } from '../../src/worker/archive-host.js';
import { claimFunction } from '../../src/worker/claim.js';
import { endFunction } from '../../src/worker/end.js';
import { urlsFunction } from '../../src/worker/urls.js';
import { failureOf } from '../admin/world.js';
import { ARCHIVE, archiveDoc } from '../imagery/archive-world.js';
import { readJob, seedGuard, seedJob } from '../imagery/world.js';
import {
    CITY,
    JOB,
    OTHER,
    OTHER_WORKER,
    WORKER,
    callAs,
    localJob,
    minutes,
    readWorker,
    seedHeld,
    seedWorker,
    workerWorld,
    type WorkerWorld,
} from './world.js';

const PARAMS = {
    archiveId: ARCHIVE,
    seriesId: 's-0123456789ab',
    class: 'grid',
    sheets: 4,
    encoding: 'lineart',
    order: 0,
    referenceLayerIds: [],
};
const SHA = 'a'.repeat(64);
const COPY = `tmp/archive-copies/${CITY}/ar-series`;

function archiveJob(overrides: Partial<JobDoc> = {}): JobDoc {
    return localJob({ type: 'archive-series', params: PARAMS, localOnly: true, createdAt: minutes(-200), ...overrides });
}

/** The archive reported by `WORKER` (the laptop), its series queued, and both workers seen. */
async function world(job: Partial<JobDoc> = {}): Promise<WorkerWorld> {
    const made = await workerWorld();
    await seedWorker(made);
    await seedWorker(made, OTHER_WORKER, { uid: OTHER, updatedBy: OTHER });
    await made.deps.documents.set(FIRESTORE_PATHS.archive(CITY, ARCHIVE), archiveDocSchema, archiveDoc(1, { workerId: WORKER }));
    await seedJob(made, 'ar-series', archiveJob(job));
    return made;
}

function claimBy(made: WorkerWorld, workerId: string, uid: string | undefined, archives?: string[]) {
    return callAs(made, claimFunction, { workerId, ...(archives === undefined ? {} : { archives }) }, uid);
}

function copyCall(made: WorkerWorld, copy: Record<string, unknown>, workerId = WORKER, uid?: string) {
    return callAs(made, archiveCopyFunction, { workerId, jobId: 'ar-series', copy }, uid);
}

describe('archive series on any computer', () => {
    it('happyPath_anyComputerClaimsAnArchiveSeries @S-A120-HAPPY-ARCHIVE-COPY', async () => {
        const made = await world();

        await expect(claimBy(made, OTHER_WORKER, OTHER, [])).resolves.toEqual({ job: { jobId: 'ar-series' } });
        await expect(readJob(made, 'ar-series')).resolves.toMatchObject({ status: 'starting', worker: { id: OTHER_WORKER } });
    });

    it('happyPath_theHolderSendsTheCopyThenAnyComputerClaimsTheSeries @S-A120-HAPPY-ARCHIVE-COPY', async () => {
        const made = await world({ waitReason: 'archive-copy', archiveReturns: 1 });

        await expect(claimBy(made, OTHER_WORKER, OTHER, [])).resolves.toEqual({ job: null });
        await expect(claimBy(made, WORKER, undefined, [ARCHIVE])).resolves.toEqual({
            job: null,
            copy: { jobId: 'ar-series', archiveId: ARCHIVE, seriesId: PARAMS.seriesId },
        });
        const signed = await copyCall(made, {
            kind: 'objects',
            objects: [
                { path: `${COPY}/${SHA}`, method: 'PUT', contentType: 'application/octet-stream' },
                { path: `${COPY}/manifest.json`, method: 'GET' },
            ],
        });
        expect(signed).toMatchObject({ objects: [{ path: `${COPY}/${SHA}`, method: 'PUT' }, { path: `${COPY}/manifest.json` }] });

        await expect(copyCall(made, { kind: 'done', bytes: 4096 })).resolves.toEqual({ status: 'queued' });
        await expect(readJob(made, 'ar-series')).resolves.toMatchObject({
            waitReason: 'worker',
            archiveCopy: { by: WORKER, bytes: 4096 },
        });
        await expect(claimBy(made, OTHER_WORKER, OTHER, [])).resolves.toEqual({ job: { jobId: 'ar-series' } });
    });

    it('happyPath_theJobsWorkerReadsItsCopyAndNoOtherJobs @S-A120-HAPPY-ARCHIVE-COPY', async () => {
        const made = await workerWorld();
        await seedHeld(made, { type: 'archive-series', params: PARAMS, localOnly: true });
        const urls = (path: string) =>
            callAs(made, urlsFunction, { workerId: WORKER, jobId: JOB, request: { kind: 'objects', objects: [{ path, method: 'GET' }] } });

        await expect(urls(`tmp/archive-copies/${CITY}/${JOB}/manifest.json`)).resolves.toMatchObject({ objects: [{ exists: false }] });
        await expect(failureOf(urls(`tmp/archive-copies/${CITY}/other-job/manifest.json`))).resolves.toMatchObject({
            details: { code: 'apiError.worker.refused' },
        });
        await expect(failureOf(urls(`tmp/archive-copies/${CITY}/${JOB}/../x`))).resolves.toBeDefined();
    });

    it('badPath_aCopyIsSignedOnlyForASeriesThatStillTakesItAndOnlyItsOwnFiles @S-A120-BAD-ARCHIVE-COPY', async () => {
        const made = await world({ status: 'succeeded' });
        const put = (path: string) => ({ kind: 'objects', objects: [{ path, method: 'PUT', contentType: 'application/octet-stream' }] });

        await expect(failureOf(copyCall(made, put(`${COPY}/${SHA}`)))).resolves.toMatchObject({
            details: { code: 'apiError.worker.refused' },
        });
        await expect(failureOf(copyCall(made, { kind: 'done', bytes: 1 }))).resolves.toMatchObject({
            details: { code: 'apiError.worker.refused' },
        });
        await seedJob(made, 'ar-series', archiveJob({ waitReason: 'archive-copy' }));
        for (const path of [`${COPY}/notes.txt`, `tmp/archive-copies/${CITY}/other/${SHA}`, `rasters/${CITY}/l/v/scan.tif`]) {
            await expect(failureOf(copyCall(made, put(path)))).resolves.toBeDefined();
        }
        await expect(
            failureOf(copyCall(made, { kind: 'objects', objects: [{ path: `${COPY}/${SHA}`, method: 'PUT' }] })),
        ).resolves.toMatchObject({ details: { code: 'apiError.worker.refused' } });
        await seedGuard(made, 'red');
        await expect(failureOf(copyCall(made, put(`${COPY}/${SHA}`)))).resolves.toMatchObject({
            details: { code: 'apiError.guardPaused' },
        });
    });

    it('badPath_aWorkerHoldingNoArchiveIsNeverAskedForACopy', async () => {
        const made = await world({ waitReason: 'archive-copy' });

        await expect(claimBy(made, OTHER_WORKER, OTHER, ['ar-fedcba9876543210'])).resolves.toEqual({ job: null });
        await expect(claimBy(made, OTHER_WORKER, OTHER)).resolves.toEqual({ job: null });
        expect(archiveOf(localJob())).toBeUndefined();
        expect(archiveOf(archiveJob({ params: omit(PARAMS, ['archiveId']) }))).toBeUndefined();
        expect(handedBack(omit(archiveJob(), ['attempt']), new Date(0))).toMatchObject({ attempt: 0, archiveReturns: 1 });
    });

    it('badPath_theDispatcherKeepsTheWaitForTheCopy @S-A120-BAD-ARCHIVE-COPY', async () => {
        const made = await world({ waitReason: 'archive-copy' });

        await dispatchJob(made.deps, CITY, 'ar-series');

        await expect(readJob(made, 'ar-series')).resolves.toMatchObject({ waitReason: 'archive-copy' });
    });
});

describe('worker.end returned', () => {
    async function heldBy(reporter: string, job: Partial<JobDoc> = {}) {
        const made = await workerWorld();
        await made.deps.documents.set(FIRESTORE_PATHS.archive(CITY, ARCHIVE), archiveDocSchema, archiveDoc(1, { workerId: reporter }));
        await seedHeld(made, { type: 'archive-series', params: PARAMS, localOnly: true, attempt: 2, step: 'gather', ...job });
        return made;
    }

    function end(made: WorkerWorld) {
        return callAs<{ readonly status: string }>(made, endFunction, { workerId: WORKER, jobId: JOB, outcome: 'returned' });
    }

    it('badPath_aWorkerWithoutTheSheetsHandsTheJobBackWithoutSpendingAnAttempt @S-A120-BAD-ARCHIVE-COPY', async () => {
        const made = await heldBy(OTHER_WORKER, { archiveCopy: { by: OTHER_WORKER, at: minutes(-2000), bytes: 10 } });
        const before = await readWorker(made);

        await expect(end(made)).resolves.toEqual({ status: 'queued' });

        const job = await readJob(made, JOB);
        expect(job).toMatchObject({ status: 'queued', attempt: 1, archiveReturns: 1, waitReason: 'archive-copy' });
        for (const gone of ['lease', 'worker', 'error', 'archiveCopy']) {
            expect(job).not.toHaveProperty(gone);
        }
        await expect(readWorker(made)).resolves.toMatchObject({ state: 'idle' });
        expect((await readWorker(made))?.lastJob).toEqual(before?.lastJob);
    });

    it.each([
        ['the computer the archive came from (its files are gone)', WORKER, 0],
        ['a job handed back too often', OTHER_WORKER, ARCHIVE_RETURNS_MAX - 1],
    ])('badPath_%sFailsArchiveMissingInsteadOfLooping', async (_name, reporter, returns) => {
        const made = await heldBy(reporter, { archiveReturns: returns });

        await expect(end(made)).resolves.toEqual({ status: 'failed' });

        await expect(readJob(made, JOB)).resolves.toMatchObject({ status: 'failed', error: { code: 'apiError.imagery.archiveMissing' } });
    });

    it('badPath_aJobNoLongerHeldIsLeftAsItIs', async () => {
        const made = await heldBy(OTHER_WORKER, { status: 'succeeded' });

        await expect(end(made)).resolves.toEqual({ status: 'succeeded' });
    });

    it('badPath_aReturnKeepsTheWorkersLastJob', async () => {
        const made = await heldBy(OTHER_WORKER);
        await seedWorker(made, WORKER, { state: 'busy', jobId: JOB, lastJob: { id: 'j-before', outcome: 'done', at: minutes(-30) } });

        await end(made);

        await expect(readWorker(made)).resolves.toMatchObject({ lastJob: { id: 'j-before', outcome: 'done' } });
    });
});
