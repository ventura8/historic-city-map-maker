import '../global-options.js';

import { BACKGROUND_FUNCTIONS, CITY_ID_PATTERN, FIRESTORE_PATHS, jobDocSchema, validate, type JobDoc } from '@hcm/shared';
import { onDocumentWritten } from 'firebase-functions/firestore';

import { runAs } from '../global-options.js';
import type { Ports } from '../ports/index.js';
import { applyApprovalPolicy } from './approval.js';
import { cancelJob } from './cancel.js';
import { countCloudRun } from './cloud-usage.js';
import { dispatchJob } from './dispatch.js';
import { releaseCancelled } from './end.js';
import { noticeJobChange } from './job-notices.js';
import { datePlanChangedBy, rewriteDatePlan } from './join-plan.js';
import { cityIds } from './limits.js';
import { locateEnded, recordProvedPass } from './pass-calibration.js';

/**
 * `imagery.onJobWrite` (Firestore trigger on `cities/{city}/jobs/{job}`; `docs/research/M3-interfaces.md` §4.2): the
 * dispatcher, acting on transitions only (the job before and after compared), each in its own transaction that reads
 * the job again, so a redelivered event finds the job already moved and does nothing (S-A12-HAPPY-DISPATCH). A job that
 * becomes `queued` is dispatched; a cancellation the admin asks for is carried out; a job that reaches
 * `awaiting_approval` gets the approval policy; a job that becomes `cancelled` (the pipeline's SIGTERM handler, CR-M3-18)
 * has what it still held released, and so does one that becomes `failed` (lesson 739). M7 (`docs/research/M7-local-worker.md` §3, §4.2): a queued job whose place the admin
 * changed, or that got the admin's OK past the free tier, is dispatched again; a cloud run that ended is counted into
 * the month's Cloud Run use. M8 (`docs/research/M8-join-interfaces.md` §5): a frame that rendered, or a join published,
 * rewrites the plan of whole-city dates. M9 (`docs/research/M9-calibration.md` §2): a `locate` that ended proved leaves its model
 * for the next frame of its pass. 2026-11-12 (reports/resource-audit.md item 9): a run that ends frees its place, so the queued jobs
 * of every city are dispatched at once (a third job waiting for capacity, a join waiting for its frames), not at the next
 * `imagery.tick`, which runs every 15 minutes since.
 */
export type JobWriteDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'jobs' | 'tasks'>;

export interface JobChange {
    readonly before: unknown;
    readonly after: unknown;
}

/** What a transition calls for. */
export type JobTransition = 'dispatch' | 'cancel' | 'approval' | 'release' | 'none';

function parsed(data: unknown): JobDoc | undefined {
    const result = data === undefined ? undefined : validate(jobDocSchema, data);
    return result?.ok === true ? result.value : undefined;
}

type Acting = Exclude<JobTransition, 'none'>;

/** The conditions whose start calls for an action, the cancellation first (it wins over anything else the write did). */
const STARTS: readonly (readonly [Acting, (job: JobDoc) => boolean])[] = [
    ['cancel', (job) => job.cancelRequested === true],
    ['dispatch', (job) => job.status === 'queued'],
    ['approval', (job) => job.status === 'awaiting_approval'],
    ['release', (job) => job.status === 'cancelled' || job.status === 'failed'],
];

/** M7: the admin moved a placed job elsewhere (`imagery.runOn`). */
function movedElsewhere(before: JobDoc, after: JobDoc): boolean {
    return before.runOn !== undefined && before.runOn !== after.runOn;
}

/** M7: the admin gave the OK past the free tier. */
function okGiven(before: JobDoc, after: JobDoc): boolean {
    return before.freeTierOk === undefined && after.freeTierOk !== undefined;
}

function bothQueued(before: JobDoc | undefined, after: JobDoc): before is JobDoc {
    return before?.status === 'queued' && after.status === 'queued';
}

/** M7: a queued job that the admin moved, or that got the OK past the free tier, is dispatched again. */
function placeChanged(before: JobDoc | undefined, after: JobDoc): boolean {
    return bothQueued(before, after) && (movedElsewhere(before, after) || okGiven(before, after));
}

/**
 * The transition from `before` to `after`: the first condition that holds now and did not hold before, else a queued job
 * whose place or OK changed (M7).
 */
export function transitionOf(before: JobDoc | undefined, after: JobDoc): JobTransition {
    const started = STARTS.find(([, holds]) => holds(after) && !(before !== undefined && holds(before)))?.[0];
    return started ?? (placeChanged(before, after) ? 'dispatch' : 'none');
}

const ACTIONS: Readonly<Record<Acting, (deps: JobWriteDeps, cityId: string, jobId: string) => Promise<unknown>>> = {
    dispatch: dispatchJob,
    cancel: cancelJob,
    approval: applyApprovalPolicy,
    release: releaseCancelled,
};

interface JobWritten {
    readonly before: JobDoc | undefined;
    readonly after: JobDoc;
}

/** What a write leaves on record for later, each best-effort: a pass's proved model (M9), the plan of whole-city dates (M8). */
async function recordRests(deps: JobWriteDeps, cityId: string, jobId: string, written: JobWritten): Promise<void> {
    const { before, after } = written;
    if (locateEnded(before, after)) {
        await recordProvedPass(deps, cityId, jobId, after).catch((error: unknown) => {
            deps.log.warn('pass not recorded', { cityId, jobId, error: String(error) });
        });
    }
    if (datePlanChangedBy(before, after)) {
        await rewriteDatePlan(deps, cityId).catch((error: unknown) => {
            deps.log.warn('date plan not rewritten', { cityId, jobId, error: String(error) });
        });
    }
}

/** The statuses of a job that holds a place among `RUNNING_JOBS_MAX`, or will: its run's start or its run. */
const HOLDING: ReadonlySet<JobDoc['status']> = new Set<JobDoc['status']>(['starting', 'running']);

/** A run that ended, or went back to a wait: the place it held is free. */
export function placeFreed(before: JobDoc | undefined, after: JobDoc): boolean {
    return before !== undefined && HOLDING.has(before.status) && !HOLDING.has(after.status);
}

/** Every city's queued jobs dispatched (places are the project's, not a city's), each on its own: a failure is logged. */
async function dispatchQueued(deps: JobWriteDeps): Promise<void> {
    for (const cityId of await cityIds(deps.documents)) {
        const queued = await deps.documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, { where: [['status', '==', 'queued']] });
        for (const { id } of queued.documents) {
            await dispatchJob(deps, cityId, id).catch((error: unknown) => {
                deps.log.warn('queued job not dispatched', { cityId, jobId: id, error: String(error) });
            });
        }
    }
}

/** Runs the transition action; a lost release is soft-caught so the notice and Cloud Run count still run. */
async function runTransition(deps: JobWriteDeps, cityId: string, jobId: string, transition: JobTransition): Promise<void> {
    if (transition === 'release') {
        await releaseCancelled(deps, cityId, jobId).catch((error: unknown) => {
            deps.log.warn('cancelled job not released', { cityId, jobId, error: String(error) });
        });
        return;
    }
    if (transition !== 'none') {
        await ACTIONS[transition](deps, cityId, jobId);
    }
}

/** Acts on one write of a job; returns the transition it acted on. */
export async function onJobWrite(deps: JobWriteDeps, cityId: string, jobId: string, change: JobChange): Promise<JobTransition> {
    const after = parsed(change.after);
    if (after === undefined || !CITY_ID_PATTERN.test(cityId)) {
        return 'none';
    }
    const before = parsed(change.before);
    const transition = transitionOf(before, after);
    await runTransition(deps, cityId, jobId, transition);
    // M7 (docs/research/M7-local-worker.md §4.2): a cloud run that ended counts into the month's Cloud Run use.
    await countCloudRun(deps, cityId, jobId, { before, after }).catch((error: unknown) => {
        deps.log.warn('cloud run not counted', { cityId, jobId, error: String(error) });
    });
    // M4 (docs/research/M4-interfaces.md §5.1, assists-notify): a failed job, a version waiting for Approve or for points.
    await noticeJobChange(deps, { cityId, jobId, job: after }, before);
    await recordRests(deps, cityId, jobId, { before, after });
    if (placeFreed(before, after)) {
        await dispatchQueued(deps);
    }
    return transition;
}

/**
 * The `imagery-onJobWrite` trigger (`fn-events@`). No automatic retry: every action is idempotent and `imagery.tick`
 * catches up with what a lost event left (a queued job, a cancellation, an approval never evaluated).
 */
export function onJobWriteFunction(getDeps: () => JobWriteDeps) {
    return onDocumentWritten(
        { document: BACKGROUND_FUNCTIONS['imagery.onJobWrite'].source, retry: false, maxInstances: 5, ...runAs('imagery.onJobWrite') },
        async (event) => {
            const params = event.params as { readonly city: string; readonly id: string };
            await onJobWrite(getDeps(), params.city, params.id, { before: event.data?.before.data(), after: event.data?.after.data() });
        },
    );
}
