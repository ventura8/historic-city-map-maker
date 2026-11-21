/**
 * M20 (`docs/research/M20-import-local.md` §4.1; live report of 2026-11-13): an archive series reads scanned maps that were imported
 * on one computer (`<work>/import/<archiveId>/`), yet any of the city's workers may run it. A worker without the series' sheets looks
 * for a copy in the bucket; when there is none it hands the job back (`worker.end` `returned`): queued again, its attempt given back,
 * waiting for a copy (`waitReason: 'archive-copy'`). The next claim of a worker that holds the archive whole (`archives`) gets the
 * series to send (`copy`) before any job; `worker.archiveCopy` signs the copy's files under `tmp/archive-copies/` (deleted after a
 * day) and, once it is complete, lets the job be claimed again. The computer the archive's report came from never hands it back
 * (its files are gone: `archiveMissing`), and neither does a job handed back `ARCHIVE_RETURNS_MAX` times.
 * M20 §22 (2026-11-14): the holder shares from a thread of its own (`archive-share.ts`), also while it runs a job, and before any
 * worker hands the series back: any queued series of its archive not copied yet is `sharable` when another computer could take it.
 */
import { FIRESTORE_PATHS, archiveDocSchema, jobDocSchema, type CallableResponse, type JobDoc } from '@hcm/shared';

import { omit } from '../api/objects.js';
import type { DocumentReader } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { IMAGERY_WRITER, stampOf } from '../imagery/records.js';
import type { WorkerCall } from './holder.js';

/**
 * A file of an archive series' copy (`tmp/archive-copies/{city}/{job}/<name>`): a sheet by its SHA-256, or the manifest. The
 * pipeline's side: `pipeline/src/hcm_pipeline/archive/copy.py` `copy_path`.
 */
export const ARCHIVE_COPY_FILE = /^(?:[0-9a-f]{64}|manifest\.json)$/;

/** How often a job may go back for a copy before it fails `archiveMissing` (a copy that never arrives, or never reads). */
export const ARCHIVE_RETURNS_MAX = 5;

/** How many jobs waiting for a copy one claim looks at. */
const COPY_SCAN = 20;

/** The local archive a job reads its files from, or undefined: only an archive series needs one. */
export function archiveOf(job: JobDoc): string | undefined {
    const value = job.type === 'archive-series' ? job.params['archiveId'] : undefined;
    return typeof value === 'string' ? value : undefined;
}

/** The worker whose scan reported the archive, or undefined when the archive has no record. */
async function reporterOf(reader: DocumentReader, cityId: string, archiveId: string): Promise<string | undefined> {
    return (await reader.get(FIRESTORE_PATHS.archive(cityId, archiveId), archiveDocSchema))?.workerId;
}

/**
 * Whether a worker may take `job` for the sheets it waits on: a series waiting for its sheets' copy (`archive-copy`) goes only to a
 * worker that holds its archive whole (M20 §22: the holder runs it itself when it cannot share it, e.g. past today's limit); every
 * other job, to any worker.
 */
export function archiveHere(job: JobDoc, archives: readonly string[] | undefined): boolean {
    return job.waitReason !== 'archive-copy' || (archives ?? []).includes(String(archiveOf(job)));
}

/** A queued archive series waiting for its sheets' copy. */
function awaitingCopy(job: JobDoc | undefined): job is JobDoc {
    return job?.status === 'queued' && job.waitReason === 'archive-copy' && job.cancelRequested !== true && archiveOf(job) !== undefined;
}

/** What makes a job one whose sheets the holder may put in the bucket for another computer (M20 §22), each rule on its own. */
const SHARABLE_RULES: readonly ((job: JobDoc) => boolean)[] = [
    (job) => job.status === 'queued' && archiveOf(job) !== undefined,
    (job) => job.cancelRequested !== true && job.paused === undefined,
    // A series waiting for a later day's share runs later; a copy now would expire before it.
    (job) => job.waitReason !== 'daily',
    // One copy a job: a series copied already is not sent again, unless a worker handed it back for a new one.
    (job) => job.waitReason === 'archive-copy' || job.archiveCopy === undefined,
];

/** A queued archive series whose copy may be sent now: waiting for it, or (M20 §22) not copied yet. */
export function sharable(job: JobDoc | undefined): job is JobDoc {
    return job !== undefined && SHARABLE_RULES.every((rule) => rule(job));
}

export type Copy = NonNullable<CallableResponse<'worker.claim'>['copy']>;

/** The copy duty of a job of an archive series (its archive and series from its parameters). */
function dutyOf(jobId: string, job: JobDoc): Copy {
    return { jobId, archiveId: String(archiveOf(job)), seriesId: String(job.params['seriesId']) };
}

/** The oldest series waiting for a copy whose archive the claiming worker holds whole, or undefined. */
export async function copyFor(
    deps: Pick<Ports, 'documents'>,
    cityId: string,
    archives: readonly string[] | undefined,
): Promise<Copy | undefined> {
    if (archives === undefined || archives.length === 0) {
        return undefined;
    }
    const waiting = await deps.documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, {
        where: [['waitReason', '==', 'archive-copy']],
        limit: COPY_SCAN,
    });
    const copies = waiting.documents.filter((job) => awaitingCopy(job.data)).map((job) => dutyOf(job.id, job.data));
    return copies.find((copy) => archives.includes(copy.archiveId));
}

/**
 * M20 §22: a queued series of an archive the worker holds whole, not copied yet, for another computer to run: the newest of the
 * oldest `COPY_SCAN` queued local jobs (the holder's own claim takes the oldest), or undefined.
 */
export async function preseedFor(deps: Pick<Ports, 'documents'>, cityId: string, archives: readonly string[]): Promise<Copy | undefined> {
    const queued = await deps.documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, {
        where: [
            ['runOn', '==', 'local'],
            ['status', '==', 'queued'],
        ],
        orderBy: ['createdAt', 'asc'],
        limit: COPY_SCAN,
    });
    const copies = queued.documents.filter((job) => sharable(job.data)).map((job) => dutyOf(job.id, job.data));
    return copies.toReversed().find((copy) => archives.includes(copy.archiveId));
}

/** True when the job's next return ends it: the computer its archive came from lost the files, or the copies never helped. */
export async function returnsExhausted(reader: DocumentReader, job: JobDoc, archive: string, call: WorkerCall): Promise<boolean> {
    if ((job.archiveReturns ?? 0) + 1 >= ARCHIVE_RETURNS_MAX) {
        return true;
    }
    return (await reporterOf(reader, call.cityId, archive)) === call.workerId;
}

/**
 * The job handed back by a worker without its sheets: queued again, the attempt its claim counted given back, no lease or worker,
 * waiting for a new copy (the last one, if any, did not reach this worker or expired), or for the computer that holds its stitched
 * film (`film-copy`, `film-host.ts`).
 */
export function handedBack(job: JobDoc, now: Date, reason: 'archive-copy' | 'film-copy' = 'archive-copy'): JobDoc {
    return {
        ...omit(job, ['lease', 'worker', 'retryAt', 'archiveCopy']),
        status: 'queued',
        attempt: Math.max(0, (job.attempt ?? 0) - 1),
        archiveReturns: (job.archiveReturns ?? 0) + 1,
        waitReason: reason,
        ...stampOf(IMAGERY_WRITER, now),
    };
}

/** The job once its copy is complete: claimable by any worker again, the copy recorded. */
export function copied(job: JobDoc, by: string, bytes: number, now: Date): JobDoc {
    const stamp = stampOf(IMAGERY_WRITER, now);
    return { ...job, waitReason: 'worker', archiveCopy: { by, at: stamp.updatedAt, bytes }, ...stamp };
}
