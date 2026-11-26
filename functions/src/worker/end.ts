import '../global-options.js';

import {
    FIRESTORE_PATHS,
    isApiErrorCode,
    jobDocSchema,
    redactText,
    workerDocSchema,
    type ApiErrorCode,
    type CallableRequest,
    type CallableResponse,
    type JobDoc,
    type WorkerDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { omit } from '../api/objects.js';
import { endWork } from '../imagery/end.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { IN_RUN, PIPELINE_WRITER, at, holds, requireWorker, type WorkerCall } from './holder.js';
import { archiveOf, handedBack, returnsExhausted } from './archive-host.js';
import { filmHeldElsewhere } from './film-host.js';
import { paired } from './pairing.js';
import { activePause, afterCommand, releasedJob } from './pause-state.js';

export type EndDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'worker.end'>;

/** The code a crash outside a step fails the job with: the worker's, when it is an `apiError.*` code. */
function codeOf(error: Request['error']): ApiErrorCode {
    return error !== undefined && isApiErrorCode(error.code) ? error.code : 'apiError.imagery.processingFailed';
}

/** True while the worker's run still holds the job unfinished (the claim's `starting` or the lease's `running`). */
function stillRunning(job: JobDoc, call: WorkerCall, now: Date): boolean {
    return holds(job, call, now) && IN_RUN.has(job.status);
}

/** A run that crashed outside a step: its job and version `failed`, if the worker still holds the job unfinished. */
async function failHeld(deps: EndDeps, call: WorkerCall, request: Request, now: Date): Promise<void> {
    const code = codeOf(request.error);
    const message = redactText(request.error?.message ?? code);
    const ended = await endWork(deps, call.cityId, request.jobId, {
        status: 'failed',
        versionState: 'failed',
        by: PIPELINE_WRITER,
        error: { code, message },
        accept: (job) => stillRunning(job, call, now),
    });
    if (ended) {
        deps.log.warn('worker run failed outside a step', { cityId: call.cityId, jobId: request.jobId, code });
    }
}

/** Why a handed-back job cannot wait: its files are on no computer that could run it. */
type Lost = NonNullable<Request['error']> | undefined;

const ARCHIVE_LOST: Lost = {
    code: 'apiError.imagery.archiveMissing',
    message: 'the archive is not on its computer, and no copy reached this one',
};
const FILM_LOST: Lost = { code: 'apiError.imagery.filmMissing', message: 'the stitched film is on no computer of the city any more' };

/** A hand-back's job, the worker's call and what the other workers hold. */
interface Returning {
    readonly job: JobDoc;
    readonly call: WorkerCall;
    readonly jobId: string;
    readonly now: Date;
    readonly filmElsewhere: boolean;
}

/** An archive series goes back for a copy of its sheets, unless the returns are exhausted. */
async function returnArchive(deps: EndDeps, transaction: DocumentTransaction, back: Returning, archiveId: string): Promise<Lost> {
    if (await returnsExhausted(transaction, back.job, archiveId, back.call)) {
        return ARCHIVE_LOST;
    }
    await transaction.set(FIRESTORE_PATHS.job(back.call.cityId, back.jobId), jobDocSchema, handedBack(back.job, back.now));
    deps.log.info('worker handed back an archive job it has no sheets for', { cityId: back.call.cityId, jobId: back.jobId, archiveId });
    return undefined;
}

/** Any other job went back for its stitched film: it waits for the computer that holds it, or fails when none does. */
async function returnFilm(deps: EndDeps, transaction: DocumentTransaction, back: Returning): Promise<Lost> {
    if (!back.filmElsewhere) {
        return FILM_LOST;
    }
    await transaction.set(FIRESTORE_PATHS.job(back.call.cityId, back.jobId), jobDocSchema, handedBack(back.job, back.now, 'film-copy'));
    deps.log.info('worker handed back a job whose film is on another computer', { cityId: back.call.cityId, jobId: back.jobId });
    return undefined;
}

/**
 * M20 (2026-11-13): the worker has not the series' sheets and found no copy: it hands the job back, queued again with its attempt
 * given back, waiting for the computer that has the archive to send a copy. Only a job the worker still holds unfinished; the worker
 * the archive's report came from (its files are gone) and the `ARCHIVE_RETURNS_MAX`th return fail the job with `archiveMissing`
 * instead (no hand-back loop). Any other job came back for its stitched film (`film-host.ts`): it waits for the computer that holds
 * the film, or fails `filmMissing` when no worker of the city says it does.
 */
async function handBack(deps: EndDeps, call: WorkerCall, request: Request, now: Date): Promise<void> {
    const path = FIRESTORE_PATHS.job(call.cityId, request.jobId);
    const filmElsewhere = await filmHeldElsewhere(deps.documents, call, request.jobId, now);
    const lost = await deps.documents.transaction(async (transaction): Promise<Lost> => {
        const job = await transaction.get(path, jobDocSchema);
        if (job === undefined || !stillRunning(job, call, now)) {
            return undefined;
        }
        const back = { job, call, jobId: request.jobId, now, filmElsewhere };
        const archiveId = archiveOf(job);
        return archiveId === undefined ? returnFilm(deps, transaction, back) : returnArchive(deps, transaction, back, archiveId);
    });
    if (lost !== undefined) {
        await failHeld(deps, call, { ...request, error: lost }, now);
    }
}

/** The run that ended: its worker's call, the worker's document (its own page's pause applied) and the time. */
interface Ended {
    readonly call: WorkerCall;
    readonly worker: WorkerDoc;
    readonly now: Date;
}

/** True when the computer was asked to give the job back: it is paused, or its job was asked back (`releaseRequested`). */
function askedBack(job: JobDoc, worker: WorkerDoc, now: Date): boolean {
    return job.releaseRequested === true || activePause(worker, now) !== undefined;
}

/**
 * Pause this computer (2026-11-13): the paused computer's run stopped at a checkpoint and hands the job back, queued where it stopped.
 * The attempt its claim counted is given back only while the computer is paused or its job was asked back (a Resume that came
 * between the checkpoint and this call keeps it counted): a hand-back is never a way round the attempts. Only a job the worker still
 * holds unfinished. A run stopped by a full disk (`diskFull`, P1-6 of the resilience audit) also gets its attempt back: the job did
 * nothing wrong, and the worker takes no job until its disk has room again (`lowDisk` of `worker.claim`).
 */
async function release(deps: EndDeps, ended: Ended, request: Request): Promise<void> {
    const { call, worker, now } = ended;
    const path = FIRESTORE_PATHS.job(call.cityId, request.jobId);
    const released = await deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        if (job === undefined || !stillRunning(job, call, now)) {
            return false;
        }
        await transaction.set(
            path,
            jobDocSchema,
            releasedJob(job, PIPELINE_WRITER, now, request.diskFull === true || askedBack(job, worker, now)),
        );
        return true;
    });
    if (released) {
        const why = request.diskFull === true ? 'its disk is full' : 'it is paused';
        deps.log.info(`a computer handed its job back: ${why}`, { cityId: call.cityId, workerId: call.workerId, jobId: request.jobId });
    }
}

/** What the run's outcome does to the job: a crash fails it, a hand-back queues it again, `done` leaves it. */
async function settle(deps: EndDeps, ended: Ended, request: Request): Promise<void> {
    const { call, now } = ended;
    if (request.outcome === 'failed') {
        await failHeld(deps, call, request, now);
    } else if (request.outcome === 'returned') {
        await handBack(deps, call, request, now);
    } else if (request.outcome === 'released') {
        await release(deps, ended, request);
    }
}

/** The worker's last job as its panel shows it: a hand-back is no job it ran, so the one before stays. */
function lastJobOf(worker: WorkerDoc, request: Request, now: Date): Pick<WorkerDoc, 'lastJob'> {
    if (request.outcome === 'returned' || request.outcome === 'released') {
        return worker.lastJob === undefined ? {} : { lastJob: worker.lastJob };
    }
    return { lastJob: { id: request.jobId, outcome: request.outcome, at: at(now) } };
}

/**
 * `worker.end` (`docs/research/M7-local-worker.md` §1.2, §2.4): the run is over. `failed` ends a job the worker still
 * holds unfinished (the run crashed outside a step: `error.code`, else `apiError.imagery.processingFailed`); `done` leaves
 * the job as the run left it; `returned` hands an archive series back (`handBack`, M20). The worker is idle again with its last
 * job. `released` hands a paused computer's job back (`release`), the computer's own page's `pause` recorded first. Never paused by
 * the budget guard.
 */
async function workerEnd(deps: EndDeps, caller: VerifiedCaller, request: Request): Promise<CallableResponse<'worker.end'>> {
    const call = { cityId: request.cityId, workerId: request.workerId, uid: caller.uid };
    const now = deps.clock.now();
    // Pause: the computer's own page paused it during the run; recorded before the job is handed back.
    const worker = afterCommand(await requireWorker(deps.documents, call), request.pause, now);
    const path = FIRESTORE_PATHS.job(call.cityId, request.jobId);
    await settle(deps, { call, worker, now }, request);
    await deps.documents.set(FIRESTORE_PATHS.worker(call.cityId, call.workerId), workerDocSchema, {
        ...omit(worker, ['jobId', 'lastJob']),
        state: 'idle',
        ...lastJobOf(worker, request, now),
        lastSeenAt: at(now),
        updatedBy: caller.uid,
        updatedAt: at(now),
    });
    const job = await deps.documents.get(path, jobDocSchema);
    if (job === undefined) {
        throw new ApiError('apiError.notFound');
    }
    return { status: job.status };
}

/** The `worker-end` callable. */
export function endFunction(getDeps: () => EndDeps & CallableDeps) {
    return defineCallable('worker.end', paired(workerEnd), getDeps);
}
