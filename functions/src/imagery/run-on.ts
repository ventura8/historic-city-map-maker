import '../global-options.js';

import {
    FIRESTORE_PATHS,
    jobDocSchema,
    runChoiceDocSchema,
    type CallableRequest,
    type CallableResponse,
    type JobDoc,
    type JobStatus,
    type RunPlace,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { countsOnMove, refuseCloudMove } from './limits.js';
import { requireCity, stampOf, type Stamp } from './records.js';

/**
 * `imagery.runOn` (a city editor; App Check enforced; `docs/research/M7-local-worker.md` §3, §4.3; S-A62-*): without a
 * job, the city's remembered choice of where its raster jobs run (`auto`, `local`, `cloud`); with a job, where that job
 * runs (`local` or `cloud`) and the city's choice with it, only while the job holds no run (`queued`, `waiting_usgs`,
 * `awaiting_gcps`; else `apiError.imagery.versionState`). The job's worker and wait reason are cleared; `freeTierOk`
 * with `cloud` is the admin's OK past the month's free tier (`{by, at}`), and moving the job to the computer drops an
 * earlier OK. A `queued` job is then dispatched again by its own trigger (`imagery.onJobWrite`). A job that parked for points
 * leaves its segments where it ran, which the other place cannot read: `filesOn` records them while it is elsewhere, for
 * `imagery.locateAgain`. A counted job moved from the computer to the cloud is checked against the budget guard and today's
 * caps first and counts on the day of the move (`refuseCloudMove`, `docs/research/M7-local-worker.md` §4.5; S-A12-BAD-RUNON-CLOUD-PAST-CAP).
 */
export type RunOnDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'imagery.runOn'>;

/** The statuses in which a job holds no run, so where it runs may still change. */
const MOVABLE: ReadonlySet<JobStatus> = new Set<JobStatus>(['queued', 'waiting_usgs', 'awaiting_gcps']);

/** The waits a move keeps: M8's join for its frames, M20's archive series for a later day's share (a move must not skip the cap). */
const HELD_WAITS: ReadonlySet<JobDoc['waitReason']> = new Set<JobDoc['waitReason']>(['parts', 'daily']);

/** Which job moves where, by whom, with or without the OK. */
interface Move {
    readonly cityId: string;
    readonly jobId: string;
    readonly place: RunPlace;
    readonly ok: boolean;
    readonly uid: string;
}

/** Where a job waiting for points ran, and so where its files lie. */
function parkedOn(job: JobDoc): RunPlace | undefined {
    return job.status === 'awaiting_gcps' ? (job.runOn ?? 'cloud') : undefined;
}

/** Where the files of a moved job are, when that is not where it now runs: only a parked job has any to leave behind. */
function filesLeftOn(job: JobDoc, place: RunPlace): Pick<JobDoc, 'filesOn'> {
    const filesOn = job.filesOn ?? parkedOn(job) ?? place;
    return filesOn === place ? {} : { filesOn };
}

/** A counted job moved from the computer to the cloud counts on the day of the move (`countsOnMove`). */
function countedOnMove(job: JobDoc, move: Move, stamp: Stamp): Pick<JobDoc, 'countedAt'> {
    return move.place === 'cloud' && countsOnMove(job) ? { countedAt: stamp.updatedAt } : {};
}

/**
 * The job as moved: its worker and wait reason cleared, the OK recorded or dropped. M8: a join's wait for its frames stays,
 * or a worker could claim it before they rendered (the dispatcher moves it on once they did).
 */
function movedJob(job: JobDoc, move: Move, stamp: Stamp): JobDoc {
    const kept = omit(
        job,
        move.place === 'local' ? ['worker', 'waitReason', 'freeTierOk', 'workerOverdueAt'] : ['worker', 'waitReason', 'workerOverdueAt'],
    );
    const okay = move.place === 'cloud' && move.ok ? { freeTierOk: { by: move.uid, at: stamp.updatedAt } } : {};
    const held = HELD_WAITS.has(job.waitReason) ? { waitReason: job.waitReason } : {};
    const counted = countedOnMove(job, move, stamp);
    return { ...omit(kept, ['filesOn']), runOn: move.place, ...okay, ...held, ...counted, ...filesLeftOn(job, move.place), ...stamp };
}

async function moveJob(transaction: DocumentTransaction, move: Move, stamp: Stamp): Promise<void> {
    const path = FIRESTORE_PATHS.job(move.cityId, move.jobId);
    const job = await transaction.get(path, jobDocSchema);
    if (job === undefined) {
        throw new ApiError('apiError.notFound');
    }
    if (!MOVABLE.has(job.status)) {
        throw new ApiError('apiError.imagery.versionState');
    }
    // M20 (docs/research/M20-import-local.md §1.1): an archive's originals never leave the owner's computer.
    if (job.localOnly === true && move.place === 'cloud') {
        throw new ApiError('apiError.imagery.localOnly');
    }
    await transaction.set(path, jobDocSchema, movedJob(job, move, stamp));
    await transaction.set(FIRESTORE_PATHS.runChoice(move.cityId), runChoiceDocSchema, { choice: move.place, ...stamp });
}

/** A move to the cloud of a job that ran on the computer must fit today's caps and the budget guard (`refuseCloudMove`). */
async function refuseMoveOverCap(deps: RunOnDeps, move: Move): Promise<void> {
    const job = move.place === 'cloud' ? await deps.documents.get(FIRESTORE_PATHS.job(move.cityId, move.jobId), jobDocSchema) : undefined;
    if (job !== undefined) {
        await refuseCloudMove(deps.documents, deps.clock.now(), move.cityId, job);
    }
}

async function imageryRunOn(deps: RunOnDeps, caller: VerifiedCaller, request: Request): Promise<CallableResponse<'imagery.runOn'>> {
    await requireCity(deps.documents, request.cityId);
    const stamp = stampOf(caller.uid, deps.clock.now());
    const jobId = request.jobId;
    if (jobId === undefined) {
        await deps.documents.set(FIRESTORE_PATHS.runChoice(request.cityId), runChoiceDocSchema, { choice: request.runOn, ...stamp });
        deps.log.info('run choice saved', { uid: caller.uid, cityId: request.cityId, choice: request.runOn });
        return { choice: request.runOn };
    }
    // The request's schema refuses `auto` with a job: a job runs in one place.
    const place: RunPlace = request.runOn === 'local' ? 'local' : 'cloud';
    const move: Move = { cityId: request.cityId, jobId, place, ok: request.freeTierOk === true, uid: caller.uid };
    await refuseMoveOverCap(deps, move);
    await deps.documents.transaction((transaction) => moveJob(transaction, move, stamp));
    deps.log.info('job place chosen', { uid: caller.uid, cityId: request.cityId, jobId, runOn: place, ok: move.ok });
    return { choice: place, runOn: place };
}

/** The `imagery-runOn` callable. */
export function runOnFunction(getDeps: () => RunOnDeps & CallableDeps) {
    return defineCallable('imagery.runOn', imageryRunOn, getDeps);
}
