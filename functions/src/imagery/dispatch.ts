/**
 * The dispatcher (`docs/research/M3-interfaces.md` §4.2, §4.3; S-A12-HAPPY-DISPATCH): a `queued` pipeline job whose time
 * has come starts exactly one Cloud Run execution, while the budget guard is green and fewer than `RUNNING_JOBS_MAX`
 * jobs hold one (starting, or running with their lease held). The job moves to `starting` in a transaction before the
 * run call, so a redelivered trigger finds it moved and starts nothing; a failed run call puts it back to `queued` a
 * minute later. The cap is checked in that same transaction (CR-M3-47): it reads and writes the execution slots
 * (`ops/dispatch`), each slot's job read again to drop the ones that ended, so the five trigger instances and the tick
 * never all see one place free and each start a run (`S-A12-BAD-RACING-DISPATCH`). An import runs in two phases
 * (finding 56 of 2026-11-01): its download on the small `raster-fetch` job, which then queues the job again, and its
 * processing on `raster-pipeline` (or `-xl`); each phase is a dispatch like any other. M7
 * (`docs/research/M7-local-worker.md` §3, §4.3): first where the job runs (`runOn`, written the first time); a job for
 * the owner's computer waits for a worker (`waitReason: 'worker'`), and neither it nor a worker's run of it takes a
 * slot; a cloud run past the month's free tier waits for the admin's OK (`waitReason: 'free-tier'`). M8
 * (`docs/research/M8-join-interfaces.md` §5): a join waits for its frames (`waitReason: 'parts'`), and fails when one ended.
 */
import {
    CLOUD_RUN_JOBS,
    FIRESTORE_PATHS,
    JOB_MAX_ATTEMPTS,
    PIPELINE_RUN_ARGS,
    RUNNING_JOBS_MAX,
    WORKER_LEASE_PREFIX,
    jobDocSchema,
    opsDispatchDocSchema,
    runsOnPipeline,
    timestampFromDate,
    timestampToDate,
    type JobDoc,
    type JobMachine,
    type JobWaitReason,
    type OpsDispatchDoc,
    type RunPlace,
} from '@hcm/shared';

import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { endWork } from './end.js';
import { askForOk, needsFreeTierOk } from './free-tier.js';
import { cityIds } from './limits.js';
import { partRefusal, partsReady } from './join-parts.js';
import { handedOver, machineOf } from './machine.js';
import { placeFor } from './place.js';
import { enqueuePublish } from './publish-queue.js';
import { IMAGERY_WRITER, appendJobLog, guardIsRed, stampOf } from './records.js';

export { machineOf } from './machine.js';

export type DispatchDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'jobs' | 'tasks'>;

export type DispatchOutcome = 'started' | 'waiting' | 'not-due' | 'publish' | 'skipped' | 'failed';

/** A failed run call is tried again this much later. */
const RUN_RETRY_MS = 60_000;

/** True once neither `dispatchAt` nor `retryAt` lies in the future. */
function isDue(job: JobDoc, now: Date): boolean {
    return [job.dispatchAt, job.retryAt].every((at) => at === undefined || timestampToDate(at) <= now);
}

/**
 * True while a job holds a Cloud Run execution (CR-M3-45): `starting` (the run is asked for, or still booting), or
 * `running` with its lease held. A running job whose lease lapsed is a lost run that `imagery.tick` recovers; it holds no
 * capacity, so a run that stopped heartbeating never blocks the next one.
 */
function holdsExecution(job: JobDoc, now: Date): boolean {
    if (runsLocally(job)) {
        return false;
    }
    return job.status === 'starting' || (job.lease !== undefined && timestampToDate(job.lease.until) >= now);
}

/** M7 §3: a run on the owner's computer (a local job, or one a worker leased) takes no Cloud Run slot. */
function runsLocally(job: JobDoc): boolean {
    return job.runOn === 'local' || job.lease?.owner.startsWith(WORKER_LEASE_PREFIX) === true;
}

/** A job's key in the execution slots: `<city>/<job>`. */
function slotKey(cityId: string, jobId: string): string {
    return `${cityId}/${jobId}`;
}

/** What the dispatcher found before its transaction: the jobs holding an execution, and the project's cities. */
interface Busy {
    /** Keys of the jobs holding an execution, by the query (a run started before the slots, a seeded one). */
    readonly holding: ReadonlySet<string>;
    readonly cities: ReadonlySet<string>;
}

/** Jobs holding an execution in the whole project (the cap is per project). */
async function busyExecutions(deps: DispatchDeps): Promise<Busy> {
    const now = deps.clock.now();
    const cities = await cityIds(deps.documents);
    const keys = await Promise.all(
        cities.map(async (cityId) => {
            const jobs = await deps.documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, {
                where: [['status', 'in', ['starting', 'running']]],
            });
            return jobs.documents.filter((job) => holdsExecution(job.data, now)).map((job) => slotKey(cityId, job.id));
        }),
    );
    return { holding: new Set(keys.flat()), cities: new Set(cities) };
}

/** A slot's job, read in the transaction; undefined when its city is gone (a retired test world, a deleted city). */
function slotJob(transaction: DocumentTransaction, key: string, busy: Busy): Promise<JobDoc | undefined> | undefined {
    const cut = key.indexOf('/');
    const cityId = key.slice(0, cut);
    return busy.cities.has(cityId) ? transaction.get(FIRESTORE_PATHS.job(cityId, key.slice(cut + 1)), jobDocSchema) : undefined;
}

/** The slots as stored (none before the first dispatch). */
async function slotsIn(transaction: DocumentTransaction): Promise<OpsDispatchDoc['slots']> {
    return (await transaction.get(FIRESTORE_PATHS.opsDispatch, opsDispatchDocSchema))?.slots ?? {};
}

/** The slots whose job (read in the transaction) still holds an execution, in a city that still exists. */
async function liveSlots(transaction: DocumentTransaction, slots: OpsDispatchDoc['slots'], busy: Busy, now: Date) {
    const live: [string, OpsDispatchDoc['slots'][string]][] = [];
    for (const [key, slot] of Object.entries(slots)) {
        const job = await slotJob(transaction, key, busy);
        if (job !== undefined && holdsExecution(job, now)) {
            live.push([key, slot]);
        }
    }
    return Object.fromEntries(live);
}

/** `starting` for the queued job, if a place is free; the slots and the job written in one transaction. */
async function takeSlot(deps: DispatchDeps, cityId: string, jobId: string, busy: Busy): Promise<'started' | 'capacity' | 'moved'> {
    const path = FIRESTORE_PATHS.job(cityId, jobId);
    const now = deps.clock.now();
    return deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        const slots = await liveSlots(transaction, await slotsIn(transaction), busy, now);
        if (!isQueued(job)) {
            return 'moved';
        }
        if (new Set([...busy.holding, ...Object.keys(slots)]).size >= RUNNING_JOBS_MAX) {
            return 'capacity';
        }
        const held = { ...slots, [slotKey(cityId, jobId)]: { at: timestampFromDate(now) } };
        await transaction.set(FIRESTORE_PATHS.opsDispatch, opsDispatchDocSchema, { slots: held, ...stampOf(IMAGERY_WRITER, now) });
        await transaction.set(path, jobDocSchema, starting(job, now));
        return 'started';
    });
}

/** Changes a job in a transaction when it is still `queued`; false when it moved meanwhile. */
async function whileQueued(
    deps: DispatchDeps,
    cityId: string,
    jobId: string,
    change: (job: JobDoc) => JobDoc | undefined,
): Promise<boolean> {
    const path = FIRESTORE_PATHS.job(cityId, jobId);
    return deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        const changed = job?.status === 'queued' && job.cancelRequested !== true ? change(job) : undefined;
        if (changed !== undefined) {
            await transaction.set(path, jobDocSchema, changed);
        }
        return changed !== undefined;
    });
}

/** Leaves the job queued with why it waits (the tick tries again). */
async function wait(deps: DispatchDeps, cityId: string, jobId: string, reason: JobWaitReason): Promise<DispatchOutcome> {
    const stamp = stampOf(IMAGERY_WRITER, deps.clock.now());
    await whileQueued(deps, cityId, jobId, (job) => (alreadySays(job, reason) ? undefined : { ...job, waitReason: reason, ...stamp }));
    return 'waiting';
}

/** The job already says why it waits: an archive series waiting for its sheets' copy, or a job for its film, waits for a worker too. */
function alreadySays(job: JobDoc, reason: JobWaitReason): boolean {
    return job.waitReason === reason || (reason === 'worker' && (job.waitReason === 'archive-copy' || job.waitReason === 'film-copy'));
}

function starting(job: JobDoc, now: Date): JobDoc {
    const at = timestampFromDate(now);
    const kept = omit(job, ['waitReason', 'retryAt', 'executionName', 'lease']);
    return {
        ...kept,
        status: 'starting',
        dispatchAt: at,
        machine: machineOf(job),
        attempt: (job.attempt ?? 0) + (handedOver(job) ? 0 : 1),
        ...stampOf(IMAGERY_WRITER, now),
    };
}

/** Records the execution of a job still `starting` (a later state means the pipeline already took it). */
async function recordExecution(deps: DispatchDeps, cityId: string, jobId: string, executionName: string): Promise<void> {
    const path = FIRESTORE_PATHS.job(cityId, jobId);
    await deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        if (job?.status === 'starting' && job.executionName === undefined) {
            await transaction.set(path, jobDocSchema, { ...job, executionName, ...stampOf(IMAGERY_WRITER, deps.clock.now()) });
        }
    });
}

/** A run call that failed: the job goes back to `queued` and waits a minute (the attempt it used stays counted). */
async function requeueAfterFailedRun(deps: DispatchDeps, cityId: string, jobId: string, error: unknown): Promise<DispatchOutcome> {
    const path = FIRESTORE_PATHS.job(cityId, jobId);
    const now = deps.clock.now();
    await deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        if (job?.status === 'starting') {
            const retryAt = timestampFromDate(new Date(now.getTime() + RUN_RETRY_MS));
            await transaction.set(path, jobDocSchema, { ...job, status: 'queued', retryAt, ...stampOf(IMAGERY_WRITER, now) });
        }
    });
    deps.log.warn('pipeline execution not started', { cityId, jobId, error: String(error) });
    await appendJobLog(deps, cityId, jobId, {
        level: 'warn',
        message: `The pipeline did not start (${String(error)}); retrying in a minute.`,
    });
    return 'failed';
}

/** Starts the execution of a job that is now `starting`. */
async function run(deps: DispatchDeps, cityId: string, jobId: string, machine: JobMachine): Promise<DispatchOutcome> {
    try {
        const execution = await deps.jobs.run(
            CLOUD_RUN_JOBS[machine],
            { JOB_ID: jobId, CITY_ID: cityId },
            { args: [...PIPELINE_RUN_ARGS] },
        );
        await recordExecution(deps, cityId, jobId, execution.name);
        deps.log.info('pipeline execution started', { cityId, jobId, machine, execution: execution.name });
        return 'started';
    } catch (error) {
        return requeueAfterFailedRun(deps, cityId, jobId, error);
    }
}

/** What a queued job of a type that does not run on Cloud Run does: a republish goes to the publisher, a deletion waits. */
async function notOnPipeline(deps: DispatchDeps, cityId: string, jobId: string, job: JobDoc): Promise<DispatchOutcome> {
    if (job.type !== 'republish') {
        return 'skipped';
    }
    await enqueuePublish(deps.tasks, { cityId, jobId }, 'republish');
    return 'publish';
}

/** A job past `JOB_MAX_ATTEMPTS` fails instead of starting again. */
async function exhausted(deps: DispatchDeps, cityId: string, jobId: string, job: JobDoc): Promise<DispatchOutcome> {
    const attempts = String(job.attempt ?? 0);
    await endWork(deps, cityId, jobId, {
        status: 'failed',
        versionState: 'failed',
        by: IMAGERY_WRITER,
        error: { code: 'apiError.imagery.attemptsExhausted', params: { attempts } },
    });
    return 'failed';
}

/** The job moved to `starting` with its slot, or why not: the budget guard, the cap, or it is no longer queued. */
async function admit(deps: DispatchDeps, cityId: string, jobId: string): Promise<JobWaitReason | 'started' | 'moved'> {
    if (await guardIsRed(deps.documents)) {
        return 'guard';
    }
    return takeSlot(deps, cityId, jobId, await busyExecutions(deps));
}

/** Waiting for a later day's share (M20), or paused by the owner (2026-11-13). */
function held(job: JobDoc): boolean {
    return job.waitReason === 'daily' || job.paused !== undefined;
}

/**
 * A queued job that is not due yet (M20, `docs/research/M20-import-local.md` §1.3: an archive series waiting for a later day's
 * share is not due until `imagery.tick` releases it), or that used up its attempts. A job the owner paused (2026-11-13) waits for
 * Resume, whose write dispatches it again.
 */
function notYet(job: JobDoc, now: Date): 'not-due' | 'exhausted' | undefined {
    if (held(job) || !isDue(job, now)) {
        return 'not-due';
    }
    return (job.attempt ?? 0) >= JOB_MAX_ATTEMPTS ? 'exhausted' : undefined;
}

async function dispatchPipelineJob(deps: DispatchDeps, cityId: string, jobId: string, job: JobDoc): Promise<DispatchOutcome> {
    const early = notYet(job, deps.clock.now());
    if (early === 'not-due') {
        return 'not-due';
    }
    if (early === 'exhausted') {
        return exhausted(deps, cityId, jobId, job);
    }
    return job.type === 'layer-join' ? dispatchJoin(deps, cityId, jobId, job) : dispatchByPlace(deps, cityId, jobId, job);
}

/** M8: a join holds until its frames rendered (the tick asks again), and fails once one of them ended. */
async function dispatchJoin(deps: DispatchDeps, cityId: string, jobId: string, job: JobDoc): Promise<DispatchOutcome> {
    const ready = await partsReady(deps.documents, cityId, jobId, job);
    if (ready.kind === 'go') {
        return dispatchByPlace(deps, cityId, jobId, job);
    }
    if (ready.kind === 'hold') {
        return wait(deps, cityId, jobId, 'parts');
    }
    const error = { code: partRefusal(ready).code, params: { frame: ready.frame } };
    await endWork(deps, cityId, jobId, { status: 'failed', versionState: 'failed', by: IMAGERY_WRITER, error });
    return 'failed';
}

/** M7 §3: a job for the owner's computer waits for a worker; a cloud one goes on to Cloud Run. */
async function dispatchByPlace(deps: DispatchDeps, cityId: string, jobId: string, job: JobDoc): Promise<DispatchOutcome> {
    const place = await settlePlace(deps, cityId, jobId, job);
    if (place === 'cloud') {
        return dispatchToCloud(deps, cityId, jobId, job);
    }
    return place === 'local' ? wait(deps, cityId, jobId, 'worker') : 'skipped';
}

/** The free tier (M7 §4.3), then the budget guard and the capacity. */
async function dispatchToCloud(deps: DispatchDeps, cityId: string, jobId: string, job: JobDoc): Promise<DispatchOutcome> {
    if (await needsFreeTierOk(deps.documents, job, deps.clock.now())) {
        return waitForOk(deps, cityId, jobId, job);
    }
    const admitted = await admit(deps, cityId, jobId);
    if (admitted === 'started') {
        return run(deps, cityId, jobId, machineOf(job));
    }
    return admitted === 'moved' ? 'skipped' : wait(deps, cityId, jobId, admitted);
}

/**
 * Where the job runs (M7 §3): its own `runOn`, else the city's choice, written on the job the first time in a transaction
 * (a job for the computer waits for a worker from that same write); undefined when the job is no longer queued.
 */
async function settlePlace(deps: DispatchDeps, cityId: string, jobId: string, job: JobDoc): Promise<RunPlace | undefined> {
    if (job.runOn !== undefined) {
        return job.runOn;
    }
    const now = deps.clock.now();
    const place = await placeFor(deps.documents, cityId, now);
    const path = FIRESTORE_PATHS.job(cityId, jobId);
    return deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(path, jobDocSchema);
        if (!isQueued(current)) {
            return undefined;
        }
        if (current.runOn !== undefined) {
            return current.runOn;
        }
        const waits = place === 'local' ? { waitReason: 'worker' as const } : {};
        await transaction.set(path, jobDocSchema, { ...current, runOn: place, ...waits, ...stampOf(IMAGERY_WRITER, now) });
        return place;
    });
}

/** A cloud run past the free tier waits for the OK; an automated one also asks for it in the inbox (once). */
async function waitForOk(deps: DispatchDeps, cityId: string, jobId: string, job: JobDoc): Promise<DispatchOutcome> {
    const outcome = await wait(deps, cityId, jobId, 'free-tier');
    if (job.waitReason !== 'free-tier') {
        await askForOk(deps, cityId, jobId, job);
    }
    return outcome;
}

function isQueued(job: JobDoc | undefined): job is JobDoc {
    return job?.status === 'queued' && job.cancelRequested !== true;
}

/** Dispatches the job when it is queued and due (the trigger on a job becoming `queued`, and `imagery.tick`). */
export async function dispatchJob(deps: DispatchDeps, cityId: string, jobId: string): Promise<DispatchOutcome> {
    const job = await deps.documents.get(FIRESTORE_PATHS.job(cityId, jobId), jobDocSchema);
    if (!isQueued(job)) {
        return 'skipped';
    }
    return runsOnPipeline(job.type) ? dispatchPipelineJob(deps, cityId, jobId, job) : notOnPipeline(deps, cityId, jobId, job);
}
