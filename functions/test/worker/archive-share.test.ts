/**
 * M20 §22 (`functions/src/worker/archive-share.ts`; the owner's request of 2026-11-14): the computer holding scanned maps shares
 * their series from a thread of its own, also while it runs a job or leaves its jobs to a calmer computer. `worker.archiveCopy`
 * `wanted` names a series handed back first, else a queued one not copied yet when another computer could take it; `progress`
 * and `done` keep the worker's `sharing` (the Computers card); each computer shares at most `ARCHIVE_SHARE_DAY_BYTES` a day.
 */
import { ARCHIVE_SHARE_DAY_BYTES, FIRESTORE_PATHS, archiveDocSchema, type JobDoc, type WorkerDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { archiveCopyFunction } from '../../src/worker/archive-copy.js';
import { archiveHere } from '../../src/worker/archive-host.js';
import { dayOf, spentToday } from '../../src/worker/archive-share.js';
import { claimFunction } from '../../src/worker/claim.js';
import { failureOf } from '../admin/world.js';
import { ARCHIVE, archiveDoc } from '../imagery/archive-world.js';
import { readJob, seedGuard, seedJob } from '../imagery/world.js';
import {
    CITY,
    NOW,
    OTHER,
    OTHER_WORKER,
    WORKER,
    callAs,
    localJob,
    minutes,
    readWorker,
    seedWorker,
    workerWorld,
    type WorkerWorld,
} from './world.js';

const SERIES = 's-0123456789ab';
const PARAMS = { archiveId: ARCHIVE, seriesId: SERIES, class: 'grid', sheets: 4, encoding: 'lineart', order: 0, referenceLayerIds: [] };
const SHA = 'b'.repeat(64);
const TODAY = NOW.slice(0, 10);
const BUSY_AND_PRESSED: Partial<WorkerDoc> = {
    state: 'busy',
    jobId: 'im-elsewhere',
    share: { profile: 'quiet', why: 'user-active', cores: 16, threads: 4, memoryMb: 4096 },
};

function archiveJob(overrides: Partial<JobDoc> = {}): JobDoc {
    return localJob({ type: 'archive-series', params: PARAMS, localOnly: true, createdAt: minutes(-200), ...overrides });
}

/** The holder (`WORKER`, busy and pressed by its person), the archive's record, and the other computer seen as `other` says. */
async function world(other: Partial<WorkerDoc> | null = {}): Promise<WorkerWorld> {
    const made = await workerWorld();
    await seedWorker(made, WORKER, BUSY_AND_PRESSED);
    if (other !== null) {
        await seedWorker(made, OTHER_WORKER, { uid: OTHER, updatedBy: OTHER, ...other });
    }
    await made.deps.documents.set(FIRESTORE_PATHS.archive(CITY, ARCHIVE), archiveDocSchema, archiveDoc(1, { workerId: WORKER }));
    return made;
}

function share(made: WorkerWorld, copy: Record<string, unknown>, jobId?: string) {
    return callAs(made, archiveCopyFunction, { workerId: WORKER, ...(jobId === undefined ? {} : { jobId }), copy });
}

const wanted = (made: WorkerWorld) => share(made, { kind: 'wanted', archives: [ARCHIVE] });

describe('sharing scanned maps while busy', () => {
    it('happyPath_aBusyHolderSharesAQueuedSeriesBeforeAnyComputerHandsItBack @S-A120-HAPPY-ARCHIVE-SHARE', async () => {
        const made = await world();
        await seedJob(made, 'ar-new', archiveJob());

        await expect(wanted(made)).resolves.toEqual({ copy: { jobId: 'ar-new', archiveId: ARCHIVE, seriesId: SERIES }, computers: 1 });
        await expect(readWorker(made)).resolves.toMatchObject({
            state: 'busy',
            sharing: { state: 'sending', computers: 1, jobId: 'ar-new', sentBytes: 0, day: TODAY, dayBytes: 0 },
        });
        const put = { path: `tmp/archive-copies/${CITY}/ar-new/${SHA}`, method: 'PUT', contentType: 'application/octet-stream' };
        await expect(share(made, { kind: 'objects', objects: [put] }, 'ar-new')).resolves.toMatchObject({ objects: [{ method: 'PUT' }] });
        await expect(share(made, { kind: 'progress', sentBytes: 300, totalBytes: 1000 }, 'ar-new')).resolves.toEqual({});
        await expect(readWorker(made)).resolves.toMatchObject({
            sharing: { state: 'sending', computers: 1, sentBytes: 300, totalBytes: 1000 },
        });

        await expect(share(made, { kind: 'done', bytes: 1000 }, 'ar-new')).resolves.toEqual({ status: 'queued' });

        await expect(readJob(made, 'ar-new')).resolves.toMatchObject({ waitReason: 'worker', archiveCopy: { by: WORKER, bytes: 1000 } });
        await expect(readWorker(made)).resolves.toMatchObject({ sharing: { state: 'done', sentBytes: 1000, dayBytes: 1000 } });
        await expect(callAs(made, claimFunction, { workerId: OTHER_WORKER, archives: [] }, OTHER)).resolves.toEqual({
            job: { jobId: 'ar-new' },
        });
    });

    it('happyPath_aSeriesHandedBackGoesFirstAndThenTheNewestNotCopiedYet @S-A120-HAPPY-ARCHIVE-SHARE', async () => {
        const made = await world();
        await seedJob(made, 'ar-oldest', archiveJob({ createdAt: minutes(-300) }));
        await seedJob(made, 'ar-newest', archiveJob({ createdAt: minutes(-100) }));
        await seedJob(made, 'ar-copied', archiveJob({ createdAt: minutes(-50), archiveCopy: { by: WORKER, at: minutes(-5), bytes: 4 } }));
        await seedJob(made, 'ar-back', archiveJob({ createdAt: minutes(-400), waitReason: 'archive-copy', archiveReturns: 1 }));

        await expect(wanted(made)).resolves.toMatchObject({ copy: { jobId: 'ar-back' } });
        await share(made, { kind: 'done', bytes: 10 }, 'ar-back');
        await expect(wanted(made)).resolves.toMatchObject({ copy: { jobId: 'ar-newest' } });
        await expect(readWorker(made)).resolves.toMatchObject({ sharing: { state: 'sending', jobId: 'ar-newest', dayBytes: 10 } });
    });

    it('happyPath_aNewDayStartsTheSharedBytesAgain @S-A120-HAPPY-ARCHIVE-SHARE', async () => {
        const made = await world();
        await seedWorker(made, WORKER, { sharing: sharing({ day: '2026-10-22', dayBytes: ARCHIVE_SHARE_DAY_BYTES }) });
        await seedJob(made, 'ar-new', archiveJob());

        await expect(wanted(made)).resolves.toMatchObject({ copy: { jobId: 'ar-new' } });
        expect(dayOf(new Date(NOW))).toBe(TODAY);
        expect(spentToday(undefined, new Date(NOW))).toBe(0);
    });

    it('happyPath_theHolderRunsASeriesWaitingForItsCopyItselfAndIsNotAskedWithItsClaim @S-A120-HAPPY-ARCHIVE-SHARE', async () => {
        const made = await world();
        await seedWorker(made, WORKER);
        await seedJob(made, 'ar-back', archiveJob({ waitReason: 'archive-copy', archiveReturns: 1 }));

        await expect(callAs(made, claimFunction, { workerId: OTHER_WORKER, archives: [] }, OTHER)).resolves.toEqual({ job: null });
        await expect(callAs(made, claimFunction, { workerId: WORKER, archives: [ARCHIVE], shares: true })).resolves.toEqual({
            job: { jobId: 'ar-back' },
        });
        expect(archiveHere(archiveJob(), undefined)).toBe(true);
        expect(archiveHere(archiveJob({ waitReason: 'archive-copy' }), undefined)).toBe(false);
    });
});

function sharing(overrides: Partial<NonNullable<WorkerDoc['sharing']>> = {}): NonNullable<WorkerDoc['sharing']> {
    return { state: 'done', computers: 1, sentBytes: 0, totalBytes: 0, day: TODAY, dayBytes: 0, at: minutes(-5), ...overrides };
}

describe('sharing refused or idle', () => {
    it.each([
        ['no other computer seen lately', { lastSeenAt: minutes(-30) }],
        ['the other computer is paused', { pausedAt: minutes(-5) }],
        ['no other computer at all', null],
    ])('badPath_%sLeavesQueuedSeriesToTheHolder @S-A120-BAD-ARCHIVE-SHARE', async (_name, other) => {
        const made = await world(other);
        await seedJob(made, 'ar-new', archiveJob());

        await expect(wanted(made)).resolves.toEqual({ idle: 'alone', computers: 0 });
        await expect(readWorker(made)).resolves.not.toHaveProperty('sharing');
    });

    it('badPath_nothingToShareEndsTheLastCopysLine @S-A120-BAD-ARCHIVE-SHARE', async () => {
        const made = await world();
        await seedWorker(made, WORKER, { sharing: sharing({ state: 'sending', jobId: 'ar-gone', dayBytes: 7 }) });
        for (const job of [
            { status: 'running' as const },
            { cancelRequested: true },
            { waitReason: 'daily' as const },
            { paused: { by: OTHER, at: minutes(-1) } },
        ]) {
            await seedJob(made, 'ar-new', archiveJob(job));
            await expect(wanted(made)).resolves.toEqual({ idle: 'nothing', computers: 1 });
        }
        await expect(readWorker(made)).resolves.toMatchObject({ sharing: { state: 'done', dayBytes: 7 } });
    });

    it('badPath_todaysLimitStopsSharingUntilTomorrow @S-A120-BAD-ARCHIVE-SHARE-DAY', async () => {
        const made = await world();
        await seedWorker(made, WORKER, { sharing: sharing({ dayBytes: ARCHIVE_SHARE_DAY_BYTES }) });
        await seedJob(made, 'ar-new', archiveJob({ waitReason: 'archive-copy', archiveReturns: 1 }));

        await expect(wanted(made)).resolves.toEqual({ idle: 'dayLimit', computers: 1 });
        await expect(wanted(made)).resolves.toEqual({ idle: 'dayLimit', computers: 1 });

        await expect(readWorker(made)).resolves.toMatchObject({ sharing: { state: 'dayLimit', dayBytes: ARCHIVE_SHARE_DAY_BYTES } });
        await expect(callAs(made, claimFunction, { workerId: WORKER, archives: [ARCHIVE], shares: true })).resolves.toEqual({
            job: { jobId: 'ar-new' },
        });
    });

    it('badPath_aCopysOtherKindsNeedTheirJobAndAJobThatStillTakesIt @S-A120-BAD-ARCHIVE-SHARE', async () => {
        const made = await world();
        await seedJob(made, 'ar-run', archiveJob({ status: 'running' }));
        const refused = { details: { code: 'apiError.worker.refused' } };

        await expect(failureOf(share(made, { kind: 'progress', sentBytes: 1, totalBytes: 2 }))).resolves.toMatchObject(refused);
        await expect(failureOf(share(made, { kind: 'wanted', archives: [ARCHIVE] }, 'ar-run'))).resolves.toMatchObject(refused);
        await expect(failureOf(share(made, { kind: 'progress', sentBytes: 1, totalBytes: 2 }, 'ar-run'))).resolves.toMatchObject(refused);
        await expect(failureOf(share(made, { kind: 'done', bytes: 2 }, 'ar-run'))).resolves.toMatchObject(refused);
        await expect(readWorker(made)).resolves.not.toHaveProperty('sharing');
        await seedGuard(made, 'red');
        await expect(failureOf(wanted(made))).resolves.toMatchObject({ details: { code: 'apiError.guardPaused' } });
    });
});
