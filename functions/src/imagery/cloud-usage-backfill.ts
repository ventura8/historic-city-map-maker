/**
 * Finding 64 of 2026-11-02 (`docs/research/M7-local-worker.md` §4.2; S-A63-HAPPY-BACKFILL): Cloud Run's free-tier meter
 * showed 0 because counting (`cloud-usage.ts`) began with M7's release, after the month's first cloud runs had ended. Once
 * a month, the first `imagery.tick` that finds `usage/cloudrun-<month>` without `backfilledAt` adds the month's cloud runs
 * that ended uncounted, from their jobs' recorded times: each job of every city dispatched this month, not on the owner's
 * computer, not running now (that run is counted when it ends) and never counted (`usageCountedAt` absent), adds the
 * seconds from its `dispatchAt` to its end (`finishedAt`, else the last step's `finishedAt`; at most
 * `BACKFILL_RUN_MAX_SECONDS`) × its machine's vCPUs and GiB (`std`, the only machine before §82f, when it names none). An
 * earlier attempt of a job that ran again is not known any more: the backfill is an estimate, as the meter is.
 */
import {
    FIRESTORE_PATHS,
    JOB_MACHINE_SIZES,
    cloudRunUsageDocSchema,
    jobDocSchema,
    timestampFromDate,
    timestampToDate,
    usageMonth,
    type CloudRunUsageDoc,
    type JobDoc,
} from '@hcm/shared';

import type { Ports } from '../ports/index.js';
import { cityIds } from './limits.js';
import { IMAGERY_WRITER, stampOf } from './records.js';

export type BackfillDeps = Pick<Ports, 'documents' | 'log'>;

/** The longest run the backfill counts (a job's times may say more: a lost run noticed late, a wait after its run). */
export const BACKFILL_RUN_MAX_SECONDS = 3 * 3600;

const RUNNING: ReadonlySet<JobDoc['status']> = new Set(['starting', 'running']);

/** The month's use the backfill adds. */
interface Added {
    readonly vcpuSeconds: number;
    readonly gibSeconds: number;
    readonly runs: number;
}

const NOTHING: Added = { vcpuSeconds: 0, gibSeconds: 0, runs: 0 };

function monthStart(now: Date): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** When the job's last run ended: its `finishedAt`, else the latest `finishedAt` of its steps; undefined when none says. */
function endOf(job: JobDoc): Date | undefined {
    const steps = Object.values(job.steps ?? {}).flatMap((step) =>
        step.finishedAt === undefined ? [] : [timestampToDate(step.finishedAt)],
    );
    const ends = job.finishedAt === undefined ? steps : [timestampToDate(job.finishedAt)];
    return ends.length === 0 ? undefined : new Date(Math.max(...ends.map((end) => end.getTime())));
}

/** A cloud run of this month that ended and was never counted. */
function uncounted(job: JobDoc): boolean {
    return job.runOn !== 'local' && job.usageCountedAt === undefined && !RUNNING.has(job.status);
}

/** The seconds of the job's uncounted run (0 when its times say none). */
export function backfillSeconds(job: JobDoc): number {
    const end = endOf(job);
    if (job.dispatchAt === undefined || end === undefined || !uncounted(job)) {
        return 0;
    }
    const seconds = (end.getTime() - timestampToDate(job.dispatchAt).getTime()) / 1000;
    return Math.min(Math.max(0, seconds), BACKFILL_RUN_MAX_SECONDS);
}

function plus(total: Added, job: JobDoc): Added {
    const seconds = backfillSeconds(job);
    if (seconds === 0) {
        return total;
    }
    const size = JOB_MACHINE_SIZES[job.machine ?? 'std'];
    return {
        vcpuSeconds: total.vcpuSeconds + seconds * size.vcpu,
        gibSeconds: total.gibSeconds + seconds * size.gib,
        runs: total.runs + 1,
    };
}

/** Every city's jobs dispatched since the month began, summed. */
async function monthsRuns(deps: BackfillDeps, since: Date): Promise<Added> {
    let total = NOTHING;
    for (const cityId of await cityIds(deps.documents)) {
        const found = await deps.documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, {
            where: [['dispatchAt', '>=', timestampFromDate(since)]],
        });
        total = found.documents.reduce((sum, job) => plus(sum, job.data), total);
    }
    return total;
}

function withBackfill(usage: CloudRunUsageDoc | undefined, month: string, added: Added, now: Date): CloudRunUsageDoc {
    const before = usage ?? { vcpuSeconds: 0, gibSeconds: 0, runs: 0 };
    return {
        month,
        vcpuSeconds: before.vcpuSeconds + added.vcpuSeconds,
        gibSeconds: before.gibSeconds + added.gibSeconds,
        runs: before.runs + added.runs,
        backfilledAt: timestampFromDate(now),
        ...stampOf(IMAGERY_WRITER, now),
    };
}

/**
 * The month's backfill, once (`backfilledAt`): true when this call added it. Two ticks never overlap (one instance), and
 * the write is a transaction that finds the month still not backfilled.
 */
export async function backfillCloudUsage(deps: BackfillDeps, now: Date): Promise<boolean> {
    const month = usageMonth(now);
    const path = FIRESTORE_PATHS.cloudRunUsage(month);
    if ((await deps.documents.get(path, cloudRunUsageDocSchema))?.backfilledAt !== undefined) {
        return false;
    }
    const added = await monthsRuns(deps, monthStart(now));
    const done = await deps.documents.transaction(async (transaction) => {
        const usage = await transaction.get(path, cloudRunUsageDocSchema);
        if (usage?.backfilledAt !== undefined) {
            return false;
        }
        await transaction.set(path, cloudRunUsageDocSchema, withBackfill(usage, month, added, now));
        return true;
    });
    deps.log.info('cloud run use backfilled', { month, runs: added.runs, done });
    return done;
}
