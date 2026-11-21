/**
 * The job parts of `imagery.tick` (`docs/research/M3-interfaces.md` §4.5, §4.6 steps 1–3; S-A12-BAD-LOST-EXECUTION): due
 * jobs dispatched, USGS waits resumed, stale starts and lost executions recovered (a lapsed lease, or a heartbeat three
 * beats late whose execution ended: finding 58; an out-of-memory exit runs again on the next larger job; past
 * `JOB_MAX_ATTEMPTS` the job fails), cancellations and approvals a lost event left behind carried
 * out, and the MTS jobs whose poll went missing polled again. M7 (`docs/research/M7-local-worker.md` §3,
 * S-A62-BAD-WORKER-LOST): a local run whose worker stopped beating (its lease lapsed, or, P1-3 of 2026-11-14, its heartbeat three
 * beats late, `starting` or `running`) waits for a worker again (`lost-run.ts`: its attempt given back while the job had fewer than
 * `LOST_RUN_REFUNDS` such losses, S-A62-HAPPY-LOST-REFUND); Cloud Run is never asked about it.
 */
import {
    FIRESTORE_PATHS,
    HEARTBEAT_SECONDS,
    JOB_MAX_ATTEMPTS,
    PUBLISH_POLL_SECONDS,
    STARTING_STALE_MINUTES,
    jobDocSchema,
    layerVersionDocSchema,
    timestampToDate,
    type ApiErrorCode,
    type JobDoc,
    type JobStatus,
    type TimestampLike,
} from '@hcm/shared';

import { omit } from '../api/objects.js';
import type { ExecutionStatus } from '../ports/cloud-run-jobs.js';
import type { StoredDocument } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { applyApprovalPolicy } from './approval.js';
import { beforeMapbox, cancelJob } from './cancel.js';
import { releaseDaily } from './daily.js';
import { dispatchJob } from './dispatch.js';
import { endWork, type Ending } from './end.js';
import { enqueuePublish } from './publish-queue.js';
import { requeueLost } from './lost-run.js';
import { IMAGERY_WRITER, stampOf, versionIdOf } from './records.js';

export type TickJobsDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'jobs' | 'tasks'>;

const MINUTE_MS = 60_000;
/** A running job's heartbeat is late after this many beats without a write. */
const HEARTBEAT_LATE_BEATS = 3;
/** The statuses whose job ends as soon as a cancellation is asked. */
const WAITING: ReadonlySet<JobStatus> = new Set<JobStatus>(['queued', 'waiting_usgs', 'awaiting_gcps', 'awaiting_approval']);
/** An MTS job not polled for this long lost its poll task (the longest poll delay plus five minutes). */
const POLL_STALE_MS = (Math.max(...PUBLISH_POLL_SECONDS) + 300) * 1000;
/** The poll index whose delay is the longest one. */
const LAST_POLL = PUBLISH_POLL_SECONDS.length - 1;

async function jobsIn(deps: TickJobsDeps, cityId: string, statuses: readonly JobStatus[]): Promise<readonly StoredDocument<JobDoc>[]> {
    return (await deps.documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, { where: [['status', 'in', [...statuses]]] })).documents;
}

function earlier(at: TimestampLike | undefined, limit: Date): boolean {
    return at !== undefined && timestampToDate(at) < limit;
}

/** The job a recovery moves back to `queued`, and the status it must still be in. */
interface Requeue {
    readonly cityId: string;
    readonly jobId: string;
    readonly from: JobStatus;
}

/** Moves a job back to `queued` (attempt kept) when it is still in `from`. */
async function requeue(deps: TickJobsDeps, { cityId, jobId, from }: Requeue, changes: Partial<JobDoc> = {}): Promise<boolean> {
    const path = FIRESTORE_PATHS.job(cityId, jobId);
    return deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        if (job?.status !== from) {
            return false;
        }
        const kept = omit(job, ['lease', 'executionName', 'retryAt', 'waitReason']);
        await transaction.set(path, jobDocSchema, { ...kept, ...changes, status: 'queued', ...stampOf(IMAGERY_WRITER, deps.clock.now()) });
        return true;
    });
}

/** A USGS wait whose `retryAt` has come (one without a time is due). */
function usgsWaitOver(job: JobDoc, now: Date): boolean {
    return job.retryAt === undefined || timestampToDate(job.retryAt) <= now;
}

/**
 * A start that never got its execution's name (a run call that died with its instance). A local run has none: it is lost
 * when its worker's lease lapses (`recoverLost`).
 */
function staleStart(job: JobDoc, now: Date): boolean {
    const stale = job.executionName === undefined && earlier(job.dispatchAt, new Date(now.getTime() - STARTING_STALE_MINUTES * MINUTE_MS));
    return stale && job.runOn !== 'local';
}

function resumable(job: JobDoc, now: Date): boolean {
    return job.status === 'waiting_usgs' ? usgsWaitOver(job, now) : staleStart(job, now);
}

/**
 * Step 1: due queued jobs dispatched; USGS waits past `retryAt` and stale starts back to `queued` first, and (M20) the archive
 * series today's share has room for released from their `daily` wait.
 */
export async function dispatchDue(deps: TickJobsDeps, cityId: string, now: Date): Promise<void> {
    await releaseDaily(deps, cityId, now);
    for (const { id, data } of await jobsIn(deps, cityId, ['waiting_usgs', 'starting'])) {
        if (resumable(data, now)) {
            await requeue(deps, { cityId, jobId: id, from: data.status });
        }
    }
    for (const { id } of await jobsIn(deps, cityId, ['queued'])) {
        await dispatchJob(deps, cityId, id);
    }
}

type Ended =
    | { readonly kind: 'cancel' }
    | { readonly kind: 'fail'; readonly code: ApiErrorCode; readonly params?: Readonly<Record<string, string>> };
type LostAction = { readonly kind: 'wait' } | { readonly kind: 'requeue'; readonly machine?: 'std' | 'xl' } | Ended;

/** The machine after an out-of-memory exit (finding 56: the small download job escalates to `std`, `std` to `xl`). */
function largerThan(machine: JobDoc['machine']): 'std' | 'xl' {
    return machine === 'fetch' ? 'std' : 'xl';
}

/** A lost execution's run again: on the next larger machine after running out of memory. */
function again(job: JobDoc, status: ExecutionStatus): LostAction {
    return status.failure === 'oom' ? { kind: 'requeue', machine: largerThan(job.machine) } : { kind: 'requeue' };
}

function attemptsOf(job: JobDoc): number {
    return job.attempt ?? 0;
}

/**
 * A lost execution that failed: again (on the next larger machine after running out of memory: `fetch` → `std` → `xl`),
 * or failed for good.
 */
function retryOrFail(job: JobDoc, status: ExecutionStatus): LostAction {
    if (status.failure === 'oom' && job.machine === 'xl') {
        return { kind: 'fail', code: 'apiError.imagery.outOfMemory' };
    }
    if (attemptsOf(job) >= JOB_MAX_ATTEMPTS) {
        return { kind: 'fail', code: 'apiError.imagery.attemptsExhausted', params: { attempts: String(attemptsOf(job)) } };
    }
    return again(job, status);
}

/** What a running job whose lease lapsed needs, by its execution's outcome. */
export function lostAction(job: JobDoc, status: ExecutionStatus): LostAction {
    if (status.state === 'running') {
        return { kind: 'wait' };
    }
    if (status.state === 'cancelled' || job.cancelRequested === true) {
        return { kind: 'cancel' };
    }
    return retryOrFail(job, status);
}

async function executionOf(deps: TickJobsDeps, job: JobDoc): Promise<ExecutionStatus> {
    return job.executionName === undefined ? { state: 'failed', failure: 'exit' } : deps.jobs.get(job.executionName);
}

function endingOf(action: Ended): Ending {
    if (action.kind === 'cancel') {
        return { status: 'cancelled', versionState: 'cancelled', by: IMAGERY_WRITER };
    }
    const params = action.params === undefined ? {} : { params: action.params };
    return { status: 'failed', versionState: 'failed', by: IMAGERY_WRITER, error: { code: action.code, ...params } };
}

/** Back to `queued` (on a larger machine after an out-of-memory exit), then dispatched at once. */
async function runAgain(deps: TickJobsDeps, cityId: string, jobId: string, machine: 'std' | 'xl' | undefined): Promise<void> {
    if (await requeue(deps, { cityId, jobId, from: 'running' }, machine === undefined ? {} : { machine })) {
        await dispatchJob(deps, cityId, jobId);
    }
}

async function recover(deps: TickJobsDeps, cityId: string, jobId: string, job: JobDoc): Promise<void> {
    const action = lostAction(job, await executionOf(deps, job));
    deps.log.warn('lost pipeline execution', { cityId, jobId, action: action.kind });
    if (action.kind === 'requeue') {
        await runAgain(deps, cityId, jobId, action.machine);
        return;
    }
    if (action.kind !== 'wait') {
        await endWork(deps, cityId, jobId, endingOf(action));
    }
}

function leaseLapsed(job: JobDoc, now: Date): boolean {
    return job.lease === undefined || timestampToDate(job.lease.until) < now;
}

/**
 * A running job not written for `HEARTBEAT_LATE_BEATS` heartbeats (finding 58 of 2026-11-01): its execution may have died
 * (an out-of-memory kill writes nothing) long before its lease lapses, so Cloud Run is asked at once.
 */
function heartbeatLate(job: JobDoc, now: Date): boolean {
    return earlier(job.updatedAt, new Date(now.getTime() - HEARTBEAT_LATE_BEATS * HEARTBEAT_SECONDS * 1000));
}

/** A Cloud Run execution that may be lost: running, its lease lapsed or its heartbeat late. */
function cloudLost(job: JobDoc, now: Date): boolean {
    return job.status === 'running' && (leaseLapsed(job, now) || heartbeatLate(job, now));
}

/**
 * A local run whose computer stopped: its lease lapsed, or (P1-3) its heartbeat is three beats late. The worker's heartbeat
 * (`lease.py`, through `worker.step`, which stamps `updatedAt` at the server's time) writes every `HEARTBEAT_SECONDS`, so a
 * silent run is lost after three minutes instead of the lease's ten.
 */
function localLost(job: JobDoc, now: Date): 'lease' | 'heartbeat' | undefined {
    if (leaseLapsed(job, now)) {
        return 'lease';
    }
    return heartbeatLate(job, now) ? 'heartbeat' : undefined;
}

/** Where a starting or running job's run was lost, if it was: on the owner's computer or in Cloud Run. */
function lostRun(job: JobDoc, now: Date): 'local' | 'cloud' | undefined {
    if (job.runOn === 'local') {
        return localLost(job, now) === undefined ? undefined : 'local';
    }
    return cloudLost(job, now) ? 'cloud' : undefined;
}

/**
 * A local run whose worker stopped (M7, `docs/research/M7-local-worker.md` §3): back to `queued`, waiting for a worker, the
 * worker and the lease removed, its attempt given back while it had fewer than `LOST_RUN_REFUNDS` such losses (`lost-run.ts`),
 * in one transaction that finds it still where it was and still lost.
 */
async function loseLocal(deps: TickJobsDeps, { cityId, jobId, from }: Requeue, seen: JobDoc, now: Date): Promise<void> {
    const why = localLost(seen, now) ?? 'lease';
    await requeueLost(deps, { cityId, jobId, why, still: (job) => job.status === from && localLost(job, now) !== undefined }, now);
}

/**
 * Step 2: running jobs whose lease lapsed or whose heartbeat is late: their execution is asked how it ended (one still
 * running is left alone); local runs whose worker's lease lapsed or whose heartbeat is late wait for a worker again (M7, P1-3).
 */
export async function recoverLost(deps: TickJobsDeps, cityId: string, now: Date): Promise<void> {
    for (const { id, data } of await jobsIn(deps, cityId, ['running', 'starting'])) {
        const lost = lostRun(data, now);
        if (lost === 'local') {
            await loseLocal(deps, { cityId, jobId: id, from: data.status }, data, now);
        } else if (lost === 'cloud') {
            await recover(deps, cityId, id, data);
        }
    }
}

/** A job a cancellation still ends at once: waiting, or a publish that has not reached Mapbox. */
function endsAtOnce(job: JobDoc): boolean {
    return WAITING.has(job.status) || beforeMapbox(job);
}

/** Cancellations a lost event left behind (a waiting job whose admin asked it to stop). */
export async function cancelAsked(deps: TickJobsDeps, cityId: string): Promise<void> {
    const asked = await deps.documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, { where: [['cancelRequested', '==', true]] });
    for (const { id } of asked.documents.filter((job) => endsAtOnce(job.data))) {
        await cancelJob(deps, cityId, id);
    }
}

/** Approvals a lost event never evaluated (a rendered version without its estimate). */
export async function pendingApprovals(deps: TickJobsDeps, cityId: string): Promise<void> {
    for (const { id, data } of await jobsIn(deps, cityId, ['awaiting_approval'])) {
        const version = await deps.documents.get(FIRESTORE_PATHS.layerVersion(cityId, versionIdOf(id, data)), layerVersionDocSchema);
        if (version?.state === 'awaiting_approval' && version.estimate === undefined) {
            await applyApprovalPolicy(deps, cityId, id);
        }
    }
}

/**
 * Step 3: MTS jobs whose poll went missing are polled again (a publish that never reached Mapbox is started again). The
 * task is named after the job's last write (`stale-<ms>`), so a job that stays stale is queued once, not on every tick;
 * each start counts an attempt on the job (which moves its stamp), so the recovery ends at `PUBLISH_MAX_ATTEMPTS`.
 */
export async function pollStale(deps: TickJobsDeps, cityId: string, now: Date): Promise<void> {
    const limit = new Date(now.getTime() - POLL_STALE_MS);
    for (const { id, data } of await jobsIn(deps, cityId, ['mts_processing'])) {
        if (earlier(data.updatedAt, limit)) {
            const task =
                data.mapboxJobId === undefined ? { cityId, jobId: id } : { cityId, jobId: id, phase: 'poll' as const, poll: LAST_POLL };
            await enqueuePublish(deps.tasks, task, `stale-${String(timestampToDate(data.updatedAt).getTime())}`);
        }
    }
}
