import '../global-options.js';

import {
    FIRESTORE_PATHS,
    PAUSE_UNTIL_MAX_HOURS,
    jobDocSchema,
    runsOnPipeline,
    workerDocSchema,
    type CallableRequest,
    type CallableResponse,
    type JobDoc,
    type JobStatus,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { omit } from '../api/objects.js';
import type { Ports } from '../ports/index.js';
import { pausedWorker, resumedWorker } from '../worker/pause-state.js';
import { requireCity, stampOf, type Stamp } from './records.js';

/**
 * `imagery.pause` (a city editor; the owner's request of 2026-11-13; `docs/research/M7-local-worker.md` → *Pause*; S-A170-*, S-A171-*):
 *
 * - a job (`jobId`): Pause marks a queued, starting or running pipeline job `paused` (`{by, at}`, `inRun` when a run holds it): a
 *   queued one is claimed and dispatched by nobody, a running one stops at its next step boundary and goes back to `queued`
 *   (`runner.py`). Resume drops the mark (and gives back the attempt a paused run counted), and the job's own trigger dispatches it
 *   again where it left off. A finished job, or one waiting for USGS, points or the approval: `apiError.imagery.notPausable`.
 * - every job (no `jobId`, no `workerId`): Pause all and Resume all, over the city's pausable jobs.
 * - a computer (`workerId`): Pause marks the worker `paused` (until `until`, at most `PAUSE_UNTIL_MAX_HOURS` ahead, else
 *   `apiError.imagery.pauseUntil`): it claims nothing, and the job it runs is asked back (`releaseRequested`), so its run stops at
 *   its next checkpoint and `worker.end` `released` queues it without using an attempt. Resume drops both.
 *
 * `changed` counts the jobs or computers changed (0: there was nothing left to change).
 */
export type PauseDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'imagery.pause'>;
type Response = CallableResponse<'imagery.pause'>;

/** The statuses of a job Pause may stop: waiting for a computer or a machine, or running. */
const PAUSABLE: ReadonlySet<JobStatus> = new Set<JobStatus>(['queued', 'starting', 'running']);
/** The statuses of a job a run holds: its pause takes effect at the run's next step boundary. */
const IN_RUN: ReadonlySet<JobStatus> = new Set<JobStatus>(['starting', 'running']);
/** The most jobs Pause all and Resume all change at once (a city's queue is far smaller). */
const ALL_MAX = 500;
const HOUR_MS = 3_600_000;

/** A job Pause may stop: a pipeline job, queued or running, not being cancelled. */
function pausable(job: JobDoc): boolean {
    return PAUSABLE.has(job.status) && runsOnPipeline(job.type) && job.cancelRequested !== true;
}

/** The job paused by `uid`; a run holding it stops at its next step boundary. */
function pausedJob(job: JobDoc, stamp: Stamp): JobDoc {
    const inRun = IN_RUN.has(job.status) ? { inRun: true as const } : {};
    return { ...job, paused: { by: stamp.updatedBy, at: stamp.updatedAt, ...inRun }, ...stamp };
}

/** The job resumed: the mark dropped, and the attempt a paused run counted given back once that run stopped. */
function resumedJob(job: JobDoc, stamp: Stamp): JobDoc {
    const stopped = job.paused?.inRun === true && job.status === 'queued';
    const attempt = stopped ? { attempt: Math.max(0, (job.attempt ?? 0) - 1) } : {};
    return { ...omit(job, ['paused']), ...attempt, ...stamp };
}

/** What the action changes of one job, or undefined when there is nothing to change. */
function changedJob(job: JobDoc, action: Request['action'], stamp: Stamp): JobDoc | undefined {
    if (action === 'resume') {
        return job.paused === undefined ? undefined : resumedJob(job, stamp);
    }
    return job.paused === undefined && pausable(job) ? pausedJob(job, stamp) : undefined;
}

/** What one change is: the city, the action and its stamp (who, when). */
export interface Change {
    readonly cityId: string;
    readonly action: Request['action'];
    readonly stamp: Stamp;
}

/** One job paused or resumed in a transaction; true when it changed. */
function changeJob(deps: PauseDeps, change: Change, jobId: string): Promise<boolean> {
    const path = FIRESTORE_PATHS.job(change.cityId, jobId);
    return deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        const changed = job === undefined ? undefined : changedJob(job, change.action, change.stamp);
        if (changed !== undefined) {
            await transaction.set(path, jobDocSchema, changed);
        }
        return changed !== undefined;
    });
}

/** A Pause of a job it cannot stop (finished, or waiting for USGS, points or the approval): `apiError.imagery.notPausable`. */
function refuseUnpausable(job: JobDoc, action: Request['action']): void {
    if (action === 'pause' && job.paused === undefined && !pausable(job)) {
        throw new ApiError('apiError.imagery.notPausable');
    }
}

/** Pause or Resume of one job: a job Pause cannot stop is refused, with why. */
async function oneJob(deps: PauseDeps, request: Request, jobId: string, stamp: Stamp): Promise<Response> {
    const job = await deps.documents.get(FIRESTORE_PATHS.job(request.cityId, jobId), jobDocSchema);
    if (job === undefined) {
        throw new ApiError('apiError.notFound');
    }
    refuseUnpausable(job, request.action);
    const changed = (await changeJob(deps, { cityId: request.cityId, action: request.action, stamp }, jobId)) ? 1 : 0;
    deps.log.info(`job ${request.action}d`, { uid: stamp.updatedBy, cityId: request.cityId, jobId, changed });
    return { changed };
}

/** Pause all or Resume all: every job of the city still queued, starting or running. */
async function allJobs(deps: PauseDeps, request: Request, stamp: Stamp): Promise<Response> {
    const found = await deps.documents.query(FIRESTORE_PATHS.jobs(request.cityId), jobDocSchema, {
        where: [['status', 'in', [...PAUSABLE]]],
        limit: ALL_MAX,
    });
    let changed = 0;
    for (const { id } of found.documents) {
        changed += (await changeJob(deps, { cityId: request.cityId, action: request.action, stamp }, id)) ? 1 : 0;
    }
    deps.log.info(`every job ${request.action}d`, { uid: stamp.updatedBy, cityId: request.cityId, changed, found: found.documents.length });
    return { changed };
}

/** When a timed pause ends: within `PAUSE_UNTIL_MAX_HOURS` from now, else `apiError.imagery.pauseUntil`. */
function untilOf(until: string | undefined, now: Date): Date | undefined {
    if (until === undefined) {
        return undefined;
    }
    const end = new Date(until);
    if (end <= now || end.getTime() - now.getTime() > PAUSE_UNTIL_MAX_HOURS * HOUR_MS) {
        throw new ApiError('apiError.imagery.pauseUntil');
    }
    return end;
}

/** The job the computer runs asked back (Pause), or no longer (Resume), when the computer still holds it. */
export async function askBack(deps: PauseDeps, change: Change, jobId: string | undefined): Promise<void> {
    if (jobId === undefined) {
        return;
    }
    const { action, stamp } = change;
    const path = FIRESTORE_PATHS.job(change.cityId, jobId);
    await deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        if (job !== undefined && IN_RUN.has(job.status)) {
            const kept = omit(job, ['releaseRequested']);
            await transaction.set(path, jobDocSchema, { ...kept, ...(action === 'pause' ? { releaseRequested: true } : {}), ...stamp });
        }
    });
}

/** Pause this computer (until `until`) or Resume it; the job it runs is asked back, or no longer. */
async function oneWorker(deps: PauseDeps, request: Request, workerId: string, stamp: Stamp): Promise<Response> {
    const now = deps.clock.now();
    const until = untilOf(request.until, now);
    const path = FIRESTORE_PATHS.worker(request.cityId, workerId);
    const worker = await deps.documents.get(path, workerDocSchema);
    if (worker === undefined) {
        throw new ApiError('apiError.notFound');
    }
    const next = request.action === 'pause' ? pausedWorker(worker, stamp.updatedBy, now, until) : resumedWorker(worker);
    await deps.documents.set(path, workerDocSchema, { ...next, ...stamp });
    await askBack(deps, { cityId: request.cityId, action: request.action, stamp }, worker.state === 'busy' ? worker.jobId : undefined);
    deps.log.info(`computer ${request.action}d`, { uid: stamp.updatedBy, cityId: request.cityId, workerId, until: request.until });
    return { changed: 1 };
}

async function imageryPause(deps: PauseDeps, caller: VerifiedCaller, request: Request): Promise<Response> {
    await requireCity(deps.documents, request.cityId);
    const stamp = stampOf(caller.uid, deps.clock.now());
    if (request.workerId !== undefined) {
        return oneWorker(deps, request, request.workerId, stamp);
    }
    return request.jobId === undefined ? allJobs(deps, request, stamp) : oneJob(deps, request, request.jobId, stamp);
}

/** The `imagery-pause` callable. */
export function pauseFunction(getDeps: () => PauseDeps & CallableDeps) {
    return defineCallable('imagery.pause', imageryPause, getDeps);
}
