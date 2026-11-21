/**
 * An admin's Cancel (`cancelRequested`, `docs/research/M3-interfaces.md` §4.2, §4.5): a job that waits (queued, waiting
 * for USGS, for points or for approval) is cancelled at once with its version, its reservation released and its scene
 * freed; so is a publish that has not reached Mapbox yet (its job `mts_processing` with no publish call made: CR-M3-47),
 * checked in the same transaction that ends it; a starting or running one gets its Cloud Run execution cancelled, and
 * the pipeline's SIGTERM handler finishes the cancellation (the tick does when no heartbeat follows); Mapbox's
 * processing, once asked for, can no longer be stopped. M8 (`docs/research/M8-join-interfaces.md` §5): a frame a live join holds
 * does not stop: ending it would free its scene under a join that goes on with its pixels. The request is withdrawn and its log
 * says why (`apiError.imagery.joinPartHeld`: reject or cancel the join first).
 */
import {
    FINISHED_JOB_STATUSES,
    FIRESTORE_PATHS,
    isSideJob,
    jobDocSchema,
    layerVersionReadSchema,
    type JobDoc,
    type JobStatus,
} from '@hcm/shared';

import { omit } from '../api/objects.js';
import type { Ports } from '../ports/index.js';
import { endWork } from './end.js';
import { liveJoinOf } from './join-parts.js';
import { IMAGERY_WRITER, appendJobLog, stampOf, versionIdOf } from './records.js';

export type CancelDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'jobs'>;

export type CancelOutcome = 'cancelled' | 'signalled' | 'finishing' | 'skipped';

/** The statuses whose job ends as soon as the admin asks. */
const WAITING: ReadonlySet<JobStatus> = new Set<JobStatus>(['queued', 'waiting_usgs', 'awaiting_gcps', 'awaiting_approval']);

const FINISHED: ReadonlySet<JobStatus> = new Set(FINISHED_JOB_STATUSES);

/** The publish steps' states that mean Mapbox was asked (the call under way, or made). */
const CALLED: ReadonlySet<string> = new Set(['running', 'done']);

function publishCalled(job: Pick<JobDoc, 'steps'>): boolean {
    const publish = job.steps?.['publish'];
    return publish !== undefined && CALLED.has(publish.status);
}

/** A publish that has not asked Mapbox for anything billable yet: no MTS job, and no publish call under way. */
export function beforeMapbox(job: Pick<JobDoc, 'status' | 'mapboxJobId' | 'steps'>): boolean {
    return job.status === 'mts_processing' && job.mapboxJobId === undefined && !publishCalled(job);
}

/** A job with something left to stop: not gone, not finished (a dismissal marks its failed job `cancelRequested`). */
function unfinished(job: JobDoc | undefined): job is JobDoc {
    return job !== undefined && !FINISHED.has(job.status);
}

/** True while a live join holds the job's version. */
async function heldByAJoin(deps: CancelDeps, cityId: string, jobId: string, job: JobDoc): Promise<boolean> {
    // M12: a side job's ending leaves its version where it stands, so a join has nothing to fear from it.
    if (isSideJob(job.type)) {
        return false;
    }
    const version = await deps.documents.get(FIRESTORE_PATHS.layerVersion(cityId, versionIdOf(jobId, job)), layerVersionReadSchema);
    return version !== undefined && (await liveJoinOf(deps.documents, cityId, version)) !== undefined;
}

/** The request taken back, so the tick does not ask again, and the job's log says why. */
async function withdraw(deps: CancelDeps, cityId: string, jobId: string): Promise<void> {
    const path = FIRESTORE_PATHS.job(cityId, jobId);
    const withdrawn = await deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        if (job !== undefined) {
            await transaction.set(path, jobDocSchema, { ...omit(job, ['cancelRequested']), ...stampOf(IMAGERY_WRITER, deps.clock.now()) });
        }
        return job !== undefined;
    });
    if (withdrawn) {
        await appendJobLog(deps, cityId, jobId, { level: 'warn', message: 'apiError.imagery.joinPartHeld' });
    }
    deps.log.info('cancel of a held frame withdrawn', { cityId, jobId });
}

/** Cancels the job as far as its status allows. */
export async function cancelJob(deps: CancelDeps, cityId: string, jobId: string): Promise<CancelOutcome> {
    const job = await deps.documents.get(FIRESTORE_PATHS.job(cityId, jobId), jobDocSchema);
    if (!unfinished(job)) {
        return 'skipped';
    }
    if (await heldByAJoin(deps, cityId, jobId, job)) {
        await withdraw(deps, cityId, jobId);
        return 'skipped';
    }
    return stop(deps, cityId, jobId, job);
}

/** Stops the job as far as its status allows. */
function stop(deps: CancelDeps, cityId: string, jobId: string, job: JobDoc): Promise<CancelOutcome> {
    if (WAITING.has(job.status)) {
        return cancelNow(deps, cityId, jobId, (current) => WAITING.has(current.status));
    }
    if (job.status === 'mts_processing') {
        return cancelPublish(deps, cityId, jobId);
    }
    return job.executionName === undefined ? Promise.resolve('skipped') : signal(deps, cityId, jobId, job.executionName);
}

/** Ends a waiting job and its version (the reservation, the pending version and the scene released). */
async function cancelNow(deps: CancelDeps, cityId: string, jobId: string, accept: (job: JobDoc) => boolean): Promise<CancelOutcome> {
    const ending = { status: 'cancelled', versionState: 'cancelled', by: IMAGERY_WRITER, accept } as const;
    const ended = await endWork(deps, cityId, jobId, ending);
    deps.log.info('raster job cancelled', { cityId, jobId, ended });
    return ended ? 'cancelled' : 'skipped';
}

/** A publish is cancelled while it has not reached Mapbox; once it has, Mapbox finishes it. */
async function cancelPublish(deps: CancelDeps, cityId: string, jobId: string): Promise<CancelOutcome> {
    if ((await cancelNow(deps, cityId, jobId, beforeMapbox)) === 'cancelled') {
        return 'cancelled';
    }
    await appendJobLog(deps, cityId, jobId, { level: 'warn', message: 'apiError.imagery.mapboxFinishing' });
    return 'finishing';
}

/** Asks Cloud Run to stop the execution (SIGTERM); the pipeline records the cancellation itself. */
async function signal(deps: CancelDeps, cityId: string, jobId: string, executionName: string): Promise<CancelOutcome> {
    try {
        await deps.jobs.cancel(executionName);
    } catch (error) {
        deps.log.warn('pipeline execution not cancelled', { cityId, jobId, error: String(error) });
        return 'skipped';
    }
    deps.log.info('pipeline execution cancelled', { cityId, jobId });
    return 'signalled';
}
