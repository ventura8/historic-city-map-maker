/**
 * Finding 68 of 2026-11-02 (`docs/research/M7-local-worker.md` §3.1; S-A62-HAPPY-NO-WORKER-OFFER, S-A62-BAD-NO-WORKER-QUIET):
 * a job placed on the owner's computer that waited `WORKER_WAIT_MINUTES` for it, while no worker of the city was seen
 * within `WORKER_FRESH_SECONDS`, is marked `workerOverdueAt` (its page then offers Run in Google Cloud instead) and leaves
 * one inbox item, `job.noWorker`, whose link opens the version. It is never moved by itself: the cloud costs, the owner
 * decides with one click.
 */
import {
    FIRESTORE_PATHS,
    WORKER_FRESH_SECONDS,
    WORKER_WAIT_MINUTES,
    jobDocSchema,
    layerVersionDocSchema,
    timestampToDate,
    workerDocSchema,
    type JobDoc,
} from '@hcm/shared';

import { emitNotification, type EmitDeps } from '../api/notification-event.js';
import { labelParams } from './job-notices.js';
import { stampOf, IMAGERY_WRITER, versionIdOf } from './records.js';

const MINUTE_MS = 60_000;

function waitsForWorker(job: JobDoc): boolean {
    return job.status === 'queued' && job.runOn === 'local' && job.waitReason === 'worker' && job.paused === undefined;
}

/**
 * A local job still waiting for the computer, not yet marked, untouched for `WORKER_WAIT_MINUTES`. A local-only job (an archive's
 * series, whose files are only on the computer) is never offered the cloud: `imagery.runOn` would refuse it (`localOnly`).
 */
function overdue(job: JobDoc, now: Date): boolean {
    const waiting = waitsForWorker(job) && job.localOnly !== true;
    return (
        waiting &&
        job.workerOverdueAt === undefined &&
        timestampToDate(job.updatedAt) <= new Date(now.getTime() - WORKER_WAIT_MINUTES * MINUTE_MS)
    );
}

/** Whether one of the city's workers was seen within `WORKER_FRESH_SECONDS` (it will claim the job soon). */
async function workerFresh(deps: EmitDeps, cityId: string, now: Date): Promise<boolean> {
    const seen = await deps.documents.query(FIRESTORE_PATHS.workers(cityId), workerDocSchema, {
        orderBy: ['lastSeenAt', 'desc'],
        limit: 1,
    });
    const last = seen.documents[0]?.data.lastSeenAt;
    return last !== undefined && timestampToDate(last).getTime() + WORKER_FRESH_SECONDS * 1000 > now.getTime();
}

/** Marks the job overdue in one transaction that finds it still waiting; true when this tick marked it. */
async function mark(deps: EmitDeps, cityId: string, jobId: string, now: Date): Promise<JobDoc | undefined> {
    const path = FIRESTORE_PATHS.job(cityId, jobId);
    return deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        if (job === undefined || !overdue(job, now)) {
            return undefined;
        }
        const marked: JobDoc = { ...job, workerOverdueAt: stampOf(IMAGERY_WRITER, now).updatedAt, ...stampOf(IMAGERY_WRITER, now) };
        await transaction.set(path, jobDocSchema, marked);
        return marked;
    });
}

async function tell(deps: EmitDeps, cityId: string, jobId: string, job: JobDoc): Promise<void> {
    const versionId = versionIdOf(jobId, job);
    const version = await deps.documents.get(FIRESTORE_PATHS.layerVersion(cityId, versionId), layerVersionDocSchema);
    await emitNotification(deps, 'imagery', {
        kind: 'job.noWorker',
        parts: [cityId, jobId],
        params: { ...labelParams(version, job), minutes: String(WORKER_WAIT_MINUTES) },
        link: `#/imagery/version/${versionId}`,
        cityId,
    });
}

/** The tick's part: every overdue local job of the city marked and told once, unless a worker is about. */
export async function offerCloud(deps: EmitDeps, cityId: string, now: Date): Promise<void> {
    const queued = await deps.documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, {
        where: [
            ['runOn', '==', 'local'],
            ['status', '==', 'queued'],
        ],
    });
    const late = queued.documents.filter((job) => overdue(job.data, now));
    if (late.length === 0 || (await workerFresh(deps, cityId, now))) {
        return;
    }
    for (const { id } of late) {
        const marked = await mark(deps, cityId, id, now);
        if (marked !== undefined) {
            deps.log.info('local job waits for a worker that is not connected', { cityId, jobId: id });
            await tell(deps, cityId, id, marked);
        }
    }
}
