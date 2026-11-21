/**
 * M20 (`docs/research/M20-import-local.md` §1.3; S-A120-BAD-DAILY-SPLITS): the archive series that wait for a later day's share of
 * new layers (`waitReason: 'daily'`) are let start by `imagery.tick`, as many as today's share has room for, in the archive's order
 * (the reference ladder: `params.order`, then the oldest). Each counts on the day it is released (`countedAt`), counted again inside
 * its own release (the turnstile `ops/daily`, so a concurrent import or release never spends the same room), then waits for the
 * owner's computer like any other local job. A job that moved meanwhile is left alone (the release is a transaction).
 * Since 2026-11-09 a local-only job (every archive series) is uncapped: it is released at once, whatever today's share, and
 * counts nothing (the series that waited before that are released by the first tick).
 */
import {
    FIRESTORE_PATHS,
    archiveSeriesParamsSchema,
    jobDocSchema,
    timestampFromDate,
    timestampToDate,
    validate,
    type JobDoc,
} from '@hcm/shared';

import type { DocumentTransaction, StoredDocument } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { dailyRoomIn, passTurnstile } from './limits.js';
import { IMAGERY_WRITER, stampOf } from './records.js';

export type DailyDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

/** The job's place in its archive's order (a job whose parameters cannot be read goes last). */
function orderOf(job: JobDoc): number {
    const params = validate(archiveSeriesParamsSchema, job.params);
    return params.ok ? params.value.order : Number.MAX_SAFE_INTEGER;
}

function byPlan(a: StoredDocument<JobDoc>, b: StoredDocument<JobDoc>): number {
    const order = orderOf(a.data) - orderOf(b.data);
    return order === 0 ? timestampToDate(a.data.createdAt).getTime() - timestampToDate(b.data.createdAt).getTime() : order;
}

/** What one release found: the job released, already moved, or today's share full. */
type Released = 'released' | 'moved' | 'full';

/** A local-only job is uncapped (2026-11-09): it needs no room and counts nothing. */
function uncapped(job: JobDoc): boolean {
    return job.localOnly === true;
}

/** Today's share has room for `job`: always for a local-only one, else counted inside `transaction` (`ops/daily`). */
async function roomFor(
    transaction: DocumentTransaction,
    deps: DailyDeps,
    job: JobDoc,
    day: { cityId: string; now: Date },
): Promise<boolean> {
    return uncapped(job) || (await dailyRoomIn(transaction, deps.documents, day.now, day.cityId)) > 0;
}

/** The job let start: waiting for the worker, counted today unless it is uncapped. */
function releasedJob(job: JobDoc, now: Date): JobDoc {
    const counted = uncapped(job) ? {} : { countedAt: timestampFromDate(now) };
    return { ...job, waitReason: 'worker', ...counted, ...stampOf(IMAGERY_WRITER, now) };
}

/** Releases one job if it still waits for its day and today's share has room, counted in the same transaction (`ops/daily`). */
async function release(deps: DailyDeps, cityId: string, jobId: string, now: Date): Promise<Released> {
    const path = FIRESTORE_PATHS.job(cityId, jobId);
    return deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        if (job?.status !== 'queued' || job.waitReason !== 'daily') {
            return 'moved';
        }
        if (!(await roomFor(transaction, deps, job, { cityId, now }))) {
            return 'full';
        }
        await transaction.set(path, jobDocSchema, releasedJob(job, now));
        await passTurnstile(transaction, now);
        return 'released';
    });
}

/** The city's archive series waiting for their day, released in the archive's order while today's share has room. */
export async function releaseDaily(deps: DailyDeps, cityId: string, now: Date): Promise<number> {
    const waiting = await deps.documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, { where: [['waitReason', '==', 'daily']] });
    let released = 0;
    for (const { id } of [...waiting.documents].sort(byPlan)) {
        const found = await release(deps, cityId, id, now);
        if (found === 'full') {
            break;
        }
        released += found === 'released' ? 1 : 0;
    }
    if (released > 0) {
        deps.log.info('archive series released for today', { cityId, released, waiting: waiting.documents.length - released });
    }
    return released;
}
