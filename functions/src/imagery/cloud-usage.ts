/**
 * Counting Cloud Run's use (`docs/research/M7-local-worker.md` §4.2; S-A63-HAPPY-COUNTED): when a cloud run ends (a job
 * leaves `starting` or `running`), the seconds from its dispatch to now × its machine's vCPUs and GiB are added to the
 * month's `usage/cloudrun-<month>` (one more run), in one transaction that also records on the job, as `usageCountedAt`,
 * the run's `dispatchAt`. A redelivered event (or a late one, after a newer run was counted) finds `usageCountedAt` at or
 * past that dispatch and counts nothing; a run on the owner's computer is never counted. The document is the project's:
 * every city's runs, an estimate against the free tier (the billing report is the truth).
 */
import {
    FIRESTORE_PATHS,
    JOB_MACHINE_SIZES,
    cloudRunUsageDocSchema,
    jobDocSchema,
    timestampToDate,
    usageMonth,
    type CloudRunUsageDoc,
    type JobDoc,
    type JobMachine,
    type TimestampLike,
} from '@hcm/shared';

import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { IMAGERY_WRITER, stampOf } from './records.js';

export type CloudUsageDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

const RUNNING: ReadonlySet<JobDoc['status']> = new Set(['starting', 'running']);

/** The cloud run a write ended: its machine and its dispatch, or undefined when the write ended none. */
interface EndedRun {
    readonly machine: JobMachine;
    readonly dispatchAt: TimestampLike;
}

/** The write took the job out of `starting` or `running`. */
function leftARun(before: JobDoc | undefined, after: JobDoc): before is JobDoc {
    return before !== undefined && RUNNING.has(before.status) && !RUNNING.has(after.status);
}

/** The run this write ended: the job left `starting` or `running`, ran in the cloud, and says on what since when. */
export function endedCloudRun(before: JobDoc | undefined, after: JobDoc): EndedRun | undefined {
    if (!leftARun(before, after) || after.runOn === 'local') {
        return undefined;
    }
    const { machine, dispatchAt } = before;
    return machine === undefined || dispatchAt === undefined ? undefined : { machine, dispatchAt };
}

/** True when the job's counted dispatch is this one or a later one. */
function countedAlready(job: JobDoc, run: EndedRun): boolean {
    const counted = job.usageCountedAt;
    return counted !== undefined && timestampToDate(counted) >= timestampToDate(run.dispatchAt);
}

function added(usage: CloudRunUsageDoc | undefined, month: string, run: EndedRun, now: Date): CloudRunUsageDoc {
    const seconds = Math.max(0, (now.getTime() - timestampToDate(run.dispatchAt).getTime()) / 1000);
    const size = JOB_MACHINE_SIZES[run.machine];
    const before = usage ?? { vcpuSeconds: 0, gibSeconds: 0, runs: 0 };
    return {
        month,
        vcpuSeconds: before.vcpuSeconds + seconds * size.vcpu,
        gibSeconds: before.gibSeconds + seconds * size.gib,
        runs: before.runs + 1,
        // Finding 64: the month's one backfill is kept.
        ...(usage?.backfilledAt === undefined ? {} : { backfilledAt: usage.backfilledAt }),
        ...stampOf(IMAGERY_WRITER, now),
    };
}

async function countIn(transaction: DocumentTransaction, path: string, run: EndedRun, now: Date): Promise<boolean> {
    const job = await transaction.get(path, jobDocSchema);
    if (job === undefined || countedAlready(job, run)) {
        return false;
    }
    const month = usageMonth(now);
    const usagePath = FIRESTORE_PATHS.cloudRunUsage(month);
    const usage = await transaction.get(usagePath, cloudRunUsageDocSchema);
    await transaction.set(usagePath, cloudRunUsageDocSchema, added(usage, month, run, now));
    // Bookkeeping only: the job keeps its stamp (the tick's stale checks and the Jobs page read who last moved it).
    await transaction.set(path, jobDocSchema, { ...job, usageCountedAt: run.dispatchAt });
    return true;
}

/** Counts the cloud run this write of job `jobId` ended, once; true when this call counted it. */
export async function countCloudRun(
    deps: CloudUsageDeps,
    cityId: string,
    jobId: string,
    change: { readonly before: JobDoc | undefined; readonly after: JobDoc },
): Promise<boolean> {
    const run = endedCloudRun(change.before, change.after);
    if (run === undefined) {
        return false;
    }
    const now = deps.clock.now();
    const counted = await deps.documents.transaction((transaction) => countIn(transaction, FIRESTORE_PATHS.job(cityId, jobId), run, now));
    deps.log.info('cloud run counted', { cityId, jobId, machine: run.machine, counted });
    return counted;
}
