/**
 * A local run lost because its computer stopped (P0-1 and P1-3 of the resilience audit, 2026-11-14; `docs/research/M7-local-worker.md`
 * §3): a power cut or a crash never reaches `worker.end`, so the job is found later, by `imagery.tick` (its lease lapsed or its
 * heartbeat stopped) or by the same computer's next `worker.claim` (it claims only when it runs nothing). Either way the job goes
 * back to `queued`, waiting for a worker, its worker and lease removed, and the attempt its claim counted is given back, as a pause's
 * hand-back does, while the job has had fewer than `LOST_RUN_REFUNDS` such refunds (`lostRuns`); after that a lost run counts, so a
 * job that stops its computer every time still ends at `JOB_MAX_ATTEMPTS`. The job's log says which of the two happened. Finding of
 * 2026-11-14 (1923 plan-ghid, lost four times on one computer): the job remembers the computer (`lostOn`), the claim leaves it to the
 * owner's other computers for `LOST_HAND_OVER_MS` (`worker/claim.ts`), and a computer that lost it before is named in plain words.
 */
import { FIRESTORE_PATHS, LOST_RUN_REFUNDS, jobDocSchema, type JobDoc } from '@hcm/shared';

import { omit } from '../api/objects.js';
import type { Ports } from '../ports/index.js';
import { IMAGERY_WRITER, appendJobLog, stampOf } from './records.js';

/** How many of the computers that lost a run the job remembers (`JobDoc.lostOn`). */
const LOST_ON_KEPT = 10;

export type LostRunDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

/** The computers that lost the job's runs, this one last (finding of 2026-11-14: the claim leaves it to the others first). */
function lostOnOf(job: JobDoc): Pick<JobDoc, 'lostOn'> {
    const worker = job.worker?.id;
    return worker === undefined ? {} : { lostOn: [...(job.lostOn ?? []), worker].slice(-LOST_ON_KEPT) };
}

/** The same computer lost this job before: the log says so in plain words (`apiError.imagery.workerLostAgain`). */
function lostAgain(job: JobDoc): boolean {
    const worker = job.worker?.id;
    return worker !== undefined && (job.lostOn ?? []).includes(worker);
}

/** The job a lost run leaves, whether its attempt was given back, and whether its computer lost it before. */
function lostJob(job: JobDoc, now: Date): { readonly job: JobDoc; readonly refunded: boolean; readonly again: boolean } {
    const lostRuns = job.lostRuns ?? 0;
    const attempt = job.attempt ?? 0;
    const refunded = lostRuns < LOST_RUN_REFUNDS;
    const counted = refunded ? { attempt: Math.max(0, attempt - 1), lostRuns: lostRuns + 1 } : {};
    const kept = omit(job, ['lease', 'worker', 'executionName', 'retryAt', 'waitReason']);
    const next: JobDoc = { ...kept, ...counted, ...lostOnOf(job), status: 'queued', waitReason: 'worker', ...stampOf(IMAGERY_WRITER, now) };
    return { job: next, refunded, again: lostAgain(job) };
}

/** What the job's log says of a lost run. */
function lostMessage(lost: { readonly refunded: boolean; readonly again: boolean }): string {
    if (lost.again) {
        return 'apiError.imagery.workerLostAgain';
    }
    return lost.refunded ? 'apiError.imagery.workerLostRefunded' : 'apiError.imagery.workerLost';
}

/** Which job, what for (the log), and the test it must still pass inside the transaction. */
interface LostRun {
    readonly cityId: string;
    readonly jobId: string;
    readonly why: 'lease' | 'heartbeat' | 'claim';
    readonly still: (job: JobDoc) => boolean;
}

/**
 * Queues the lost run again in one transaction that finds it still lost (`still`), then says so in the log and the job's log;
 * false when it was not (the worker renewed it, or it ended, meanwhile).
 */
export async function requeueLost(deps: LostRunDeps, lost: LostRun, now: Date): Promise<boolean> {
    const { cityId, jobId } = lost;
    const path = FIRESTORE_PATHS.job(cityId, jobId);
    const outcome = await deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        if (job === undefined || !lost.still(job)) {
            return undefined;
        }
        const next = lostJob(job, now);
        await transaction.set(path, jobDocSchema, next.job);
        return next;
    });
    if (outcome === undefined) {
        return false;
    }
    deps.log.warn('lost local run', { cityId, jobId, why: lost.why, refunded: outcome.refunded, again: outcome.again });
    await appendJobLog(deps, cityId, jobId, { level: 'warn', message: lostMessage(outcome) });
    return true;
}
