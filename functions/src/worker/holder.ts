/**
 * What every `worker.*` callable checks (`docs/research/M7-local-worker.md` §2.4): the budget guard, the caller's worker
 * document (a worker id belongs to the account that said hello with it), and whether that worker holds a job: it
 * claimed it (`job.worker` names its id and the caller's uid) and no other owner's lease is live.
 */
import {
    FIRESTORE_PATHS,
    WORKER_LEASE_PREFIX,
    jobDocSchema,
    systemWriter,
    timestampFromDate,
    timestampToDate,
    workerDocSchema,
    type JobDoc,
    type JobStatus,
    type TimestampLike,
    type WorkerDoc,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import type { DocumentReader } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { guardIsRed } from '../imagery/records.js';

/** Who a worker's run writes as: the same writer as a Cloud Run run (`docs/research/M7-local-worker.md` §2.5). */
export const PIPELINE_WRITER = systemWriter('pipeline');

/** The statuses of a job while a run holds it (the claim's `starting`, the lease's `running`). */
export const IN_RUN: ReadonlySet<JobStatus> = new Set<JobStatus>(['starting', 'running']);

/** The worker a call comes from: its city, its id and the signed-in account. */
export interface WorkerCall {
    readonly cityId: string;
    readonly workerId: string;
    readonly uid: string;
}

/** `worker:<workerId>`: the lease owner of a worker's run. */
export function leaseOwnerOf(workerId: string): string {
    return `${WORKER_LEASE_PREFIX}${workerId}`;
}

/** The time as the documents store it. */
export function at(date: Date): TimestampLike {
    return timestampFromDate(date);
}

function otherLeaseLive(job: JobDoc, workerId: string, now: Date): boolean {
    return job.lease !== undefined && job.lease.owner !== leaseOwnerOf(workerId) && timestampToDate(job.lease.until) > now;
}

/** True while `call`'s worker holds `job`: it claimed it (id and uid), and no other owner's lease is live. */
export function holds(job: JobDoc | undefined, call: WorkerCall, now: Date): job is JobDoc {
    const claimed = job?.worker?.id === call.workerId && job.worker.uid === call.uid;
    return claimed && !otherLeaseLive(job, call.workerId, now);
}

/** The job `call`'s worker holds, read by `reader` (a transaction or the store), or `apiError.worker.notHolder`. */
export async function requireHeld(reader: DocumentReader, call: WorkerCall, jobId: string, now: Date): Promise<JobDoc> {
    const job = await reader.get(FIRESTORE_PATHS.job(call.cityId, jobId), jobDocSchema);
    if (!holds(job, call, now)) {
        throw new ApiError('apiError.worker.notHolder');
    }
    return job;
}

/** `ops/guard` red pauses the worker family (`apiError.guardPaused`), except what ends a run. */
export async function requireGreen(documents: Ports['documents']): Promise<void> {
    if (await guardIsRed(documents)) {
        throw new ApiError('apiError.guardPaused');
    }
}

/**
 * The caller's worker document, refused (`apiError.worker.refused`) when another account said hello with the same id, or
 * (`apiError.worker.revoked`) once it was disconnected; undefined when there is none yet.
 */
export async function ownWorker(reader: DocumentReader, call: WorkerCall): Promise<WorkerDoc | undefined> {
    const worker = await reader.get(FIRESTORE_PATHS.worker(call.cityId, call.workerId), workerDocSchema);
    if (worker !== undefined && worker.uid !== call.uid) {
        throw new ApiError('apiError.worker.refused');
    }
    // Finding 67: Disconnect this computer (`worker.revoke`) refuses every later call of that worker.
    if (worker?.revokedAt !== undefined) {
        throw new ApiError('apiError.worker.revoked');
    }
    return worker;
}

/** The caller's worker document, which `worker.hello` must have made (`apiError.worker.refused` otherwise). */
export async function requireWorker(reader: DocumentReader, call: WorkerCall): Promise<WorkerDoc> {
    const worker = await ownWorker(reader, call);
    if (worker === undefined) {
        throw new ApiError('apiError.worker.refused');
    }
    return worker;
}
