import '../global-options.js';

import {
    FIRESTORE_PATHS,
    JOB_MAX_ATTEMPTS,
    LEASE_SECONDS,
    LOST_HAND_OVER_MS,
    jobDocSchema,
    runsOnPipeline,
    timestampToDate,
    workerDocSchema,
    type CallableRequest,
    type CallableResponse,
    type JobDoc,
    type WorkerDoc,
    type WorkerShare,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { omit } from '../api/objects.js';
import { IMAGERY_WRITER } from '../imagery/records.js';
import type { Ports } from '../ports/index.js';
import { archiveHere, copyFor } from './archive-host.js';
import { diskWordOf, freeSpaceOf, jobStatesOf, releaseOrphan, withDisk, type DiskWord } from './cleanup.js';
import { activePause, afterCommand, pauseAnswer } from './pause-state.js';
import { filmHere } from './film-host.js';
import { at, leaseOwnerOf, requireGreen, requireWorker, type WorkerCall } from './holder.js';
import { holdBack, type HoldBack } from './household.js';
import { imageState, paired } from './pairing.js';
import { removalOrder, reportRemoval } from './removal.js';

export type ClaimDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'jobs'>;

/** How many of the oldest queued local jobs one claim looks at (the rest wait for the next poll). */
const CLAIM_SCAN = 20;

/** What makes a queued job one a worker may take (`docs/research/M7-local-worker.md` §2.4), each rule on its own. */
const CLAIM_RULES: readonly ((job: JobDoc, now: Date) => boolean)[] = [
    (job) => job.status === 'queued' && job.runOn === 'local',
    (job) => job.cancelRequested !== true && runsOnPipeline(job.type),
    (job) => (job.attempt ?? 0) < JOB_MAX_ATTEMPTS,
    // M8 (docs/research/M8-join-interfaces.md §5): a join still waiting for its frames; the dispatcher moves it on.
    (job) => job.waitReason !== 'parts',
    // M20 (docs/research/M20-import-local.md §1.3): an archive series waiting for a later day's share; imagery.tick releases it.
    (job) => job.waitReason !== 'daily',
    (job, now) => [job.dispatchAt, job.retryAt].every((time) => time === undefined || timestampToDate(time) <= now),
    // Pause (the owner's request of 2026-11-13): a job the owner paused waits for Resume.
    (job) => job.paused === undefined,
];

/** The types the worker's pipeline runs, when it named them: an older image leaves a newer type queued for an updated one. */
type Runs = readonly string[] | undefined;

/** The jobs whose stitched film the worker holds (a job waiting for its film goes only to such a worker). */
type Films = readonly string[] | undefined;

/** The local archives the worker holds whole (a series waiting for its sheets' copy goes only to such a worker). */
type Archives = readonly string[] | undefined;

/**
 * The worker's call: the types it runs, its films, (W5) its governor's share, its own page's pause command (recorded with the
 * claim), and (cleanup item 6) its disk and what its last "Free space now" freed.
 */
type Claim = WorkerCall &
    DiskWord & {
        readonly runs: Runs;
        readonly films: Films;
        readonly archives: Archives;
        readonly share?: WorkerShare;
        readonly pause?: CallableRequest<'worker.claim'>['pause'];
    };

/** True when the worker's pipeline runs `type` (an older worker that named none runs every type). */
function runsHere(runs: Runs, type: string): boolean {
    return runs === undefined || runs.includes(type);
}

/**
 * Finding of 2026-11-14 (1923 plan-ghid): a computer that lost a run of the job takes it again only once the owner's other computers
 * had `LOST_HAND_OVER_MS` to take it (since it was queued again), so the one that keeps stopping on it is not the only one tried.
 */
function handedOver(job: JobDoc, now: Date, workerId: string): boolean {
    const lostHere = (job.lostOn ?? []).includes(workerId);
    return !lostHere || now.getTime() - timestampToDate(job.updatedAt).getTime() >= LOST_HAND_OVER_MS;
}

function claimable(
    job: JobDoc | undefined,
    now: Date,
    call: Pick<Claim, 'runs' | 'films' | 'archives' | 'workerId'>,
    jobId: string,
): job is JobDoc {
    return job !== undefined && CLAIM_RULES.every((rule) => rule(job, now)) && takesHere(job, now, call, jobId);
}

/** What the claiming worker itself decides: the computers that lost it, the types it runs, the films and archives it holds. */
function takesHere(job: JobDoc, now: Date, call: Pick<Claim, 'runs' | 'films' | 'archives' | 'workerId'>, jobId: string): boolean {
    return (
        handedOver(job, now, call.workerId) &&
        runsHere(call.runs, job.type) &&
        filmHere(job, jobId, call.films) &&
        archiveHere(job, call.archives)
    );
}

/** The job as the worker takes it: `starting`, one more attempt, leased to the worker, no Cloud Run machine. */
function claimed(job: JobDoc, call: WorkerCall, now: Date): JobDoc {
    return {
        ...omit(job, ['machine', 'waitReason', 'executionName', 'workerOverdueAt', 'releaseRequested']),
        status: 'starting',
        attempt: (job.attempt ?? 0) + 1,
        dispatchAt: at(now),
        lease: { owner: leaseOwnerOf(call.workerId), until: at(new Date(now.getTime() + LEASE_SECONDS * 1000)) },
        worker: { id: call.workerId, uid: call.uid, claimedAt: at(now) },
        updatedBy: IMAGERY_WRITER,
        updatedAt: at(now),
    };
}

/** The worker's document as last seen now: busy with `jobId`, or idle; its share and its disk as the claim said them. */
function seen(worker: WorkerDoc, call: WorkerCall & DiskWord & { readonly share?: WorkerShare }, now: Date, jobId?: string): WorkerDoc {
    const state = jobId === undefined ? { state: 'idle' as const } : { state: 'busy' as const, jobId };
    const share = call.share === undefined ? {} : { share: call.share };
    const base = { ...omit(worker, ['jobId']), ...share, ...state, lastSeenAt: at(now), updatedBy: call.uid, updatedAt: at(now) };
    return withDisk(base, call, now);
}

/** The first of the city's claimable jobs this worker takes, or null. */
async function takeFirst(deps: ClaimDeps, call: Claim, now: Date): Promise<string | null> {
    for (const jobId of await candidates(deps, call, now)) {
        if (await take(deps, call, jobId, now)) {
            return jobId;
        }
    }
    return null;
}

/**
 * Takes `jobId` for the worker in one transaction, if it is still claimable; false when another worker or event came first.
 * Only a worker the image check let through gets here: its document says `outdated: false` (live 2026-11-14, lesson 708: a
 * hello against a function instance's minute-old installed image left `outdated: true`, and the admin said "no jobs until it
 * updates itself" while the computer took job after job).
 */
function take(deps: ClaimDeps, call: Claim, jobId: string, now: Date): Promise<boolean> {
    const path = FIRESTORE_PATHS.job(call.cityId, jobId);
    return deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        const worker = afterCommand(await requireWorker(transaction, call), call.pause, now);
        if (!claimable(job, now, call, jobId)) {
            return false;
        }
        await transaction.set(path, jobDocSchema, claimed(job, call, now));
        await transaction.set(FIRESTORE_PATHS.worker(call.cityId, call.workerId), workerDocSchema, {
            ...seen(worker, call, now, jobId),
            outdated: false,
            ...filmsOf(call.films),
        });
        return true;
    });
}

/** The oldest queued local jobs of the city, oldest first (index `jobs`: `runOn`, `status`, `createdAt`). */
async function candidates(deps: ClaimDeps, call: Claim, now: Date): Promise<string[]> {
    const found = await deps.documents.query(FIRESTORE_PATHS.jobs(call.cityId), jobDocSchema, {
        where: [
            ['runOn', '==', 'local'],
            ['status', '==', 'queued'],
        ],
        orderBy: ['createdAt', 'asc'],
        limit: CLAIM_SCAN,
    });
    return found.documents.filter((job) => claimable(job.data, now, call, job.id)).map((job) => job.id);
}

/**
 * `worker.claim` (`docs/research/M7-local-worker.md` §1.2, §2.4; S-A62-HAPPY-CLAIM): the oldest due queued job of the city
 * chosen for the owner's computer, taken in one transaction (`starting`, its attempt counted, the lease and `worker`
 * naming this worker, no Cloud Run machine or wait), or none, of the types the worker said its pipeline runs (an older image
 * leaves a newer type queued; 2026-11-09); either way the worker is seen now. M20 (2026-11-13): a worker that holds an archive
 * whole is first given a series another worker waits for (`copy`), to send its sheets (`archive-host.ts`). Finding 67: a paired
 * worker whose image is no longer the installed pipeline's takes nothing (`outdated`) until the owner runs the new command.
 * W5 (household computers, `household.ts`): the claim records the computer's share; a computer paused in the admin's list
 * takes nothing (`paused`), and one whose person is busy leaves the job to a calm computer of the city (`yielded`); Remove this
 * computer is answered `remove` instead of a job, and the worker's word on it is a claim with `removal` (`removal.ts`).
 * Pause (2026-11-13): the computer's own page's `pause` command is recorded first (an expired pause dropped); a paused worker is
 * answered `paused` with who, when and until when (`pause`); a job the owner paused is taken by nobody.
 * Resilience (2026-11-14, `cleanup.ts`): the job this worker's document says it runs, still in its run, was orphaned by a power cut
 * or a crash of this computer (it claims only when it runs nothing) and is queued again with its attempt given back; a disk below
 * the worker's floor takes no job (`lowDisk`); the held jobs' states (`jobStates`) and the admin's "Free space now" (`freeSpace`)
 * come with the answer.
 */
async function workerClaim(
    deps: ClaimDeps,
    caller: VerifiedCaller,
    request: CallableRequest<'worker.claim'>,
): Promise<CallableResponse<'worker.claim'>> {
    const call = { cityId: request.cityId, workerId: request.workerId, uid: caller.uid };
    // W5: the worker's word on its removal is taken whatever the guard says (removal.ts).
    if (request.removal !== undefined) {
        return reportRemoval(deps, call, request.removal);
    }
    await requireGreen(deps.documents);
    const claim: Claim = {
        ...call,
        runs: request.types,
        films: request.films,
        archives: request.archives,
        ...(request.share === undefined ? {} : { share: request.share }),
        ...(request.pause === undefined ? {} : { pause: request.pause }),
        ...diskWordOf(request),
    };
    logCommand(deps, call, request.pause);
    return claimFor(deps, caller, claim, request);
}

/**
 * The claim of a worker in good standing: its own orphan released first (P1-3), then the removal's order, else a job, else why
 * none; with (cleanup items 1 and 6) the held jobs' states and the admin's "Free space now".
 */
async function claimFor(
    deps: ClaimDeps,
    caller: VerifiedCaller,
    claim: Claim,
    said: Pick<CallableRequest<'worker.claim'>, 'archives' | 'held' | 'shares'>,
): Promise<CallableResponse<'worker.claim'>> {
    const now = deps.clock.now();
    // Pause: the computer's own page's command first, an expired pause dropped (`pause-state.ts`).
    const worker = afterCommand(await requireWorker(deps.documents, claim), claim.pause, now);
    await releaseOrphan(deps, claim, worker, now);
    // M20 §22: a worker that shares from its own thread (`shares`) is never asked for a copy with its claim.
    const answer = await answerFor(deps, caller, { claim, worker, now }, said.shares === true ? undefined : said.archives);
    return { ...answer, ...freeSpaceOf(seen(worker, claim, now)), ...(await jobStatesOf(deps, claim.cityId, said.held)) };
}

/** The removal's order, else a job, else why none; the worker is seen now either way. */
async function answerFor(
    deps: ClaimDeps,
    caller: VerifiedCaller,
    { claim, worker, now }: { readonly claim: Claim; readonly worker: WorkerDoc; readonly now: Date },
    archives: readonly string[] | undefined,
): Promise<CallableResponse<'worker.claim'>> {
    const path = FIRESTORE_PATHS.worker(claim.cityId, claim.workerId);
    const order = removalOrder(worker);
    if (order !== undefined) {
        await deps.documents.set(path, workerDocSchema, seen(worker, claim, now));
        return order;
    }
    const { outdated, held } = await whyNot(deps, caller, { claim, worker: seen(worker, claim, now), now });
    if (outdated || held !== null) {
        await deps.documents.set(path, workerDocSchema, { ...seen(worker, claim, now), outdated });
        return withPause(noJob(deps, claim, outdated, held), worker, now);
    }
    const seenNow = { ...seen(worker, claim, now), outdated: false, ...filmsOf(claim.films) };
    return (await offerCopy(deps, claim, archives, seenNow)) ?? (await claimJob(deps, claim, seenNow, now));
}

/** The computer's own page paused or resumed it: said in the log with the worker's ids. */
function logCommand(deps: ClaimDeps, call: WorkerCall, command: CallableRequest<'worker.claim'>['pause']): void {
    if (command !== undefined) {
        deps.log.info(`worker ${command.action}d from its own page`, { cityId: call.cityId, workerId: call.workerId, ...command });
    }
}

/** The films the claim named, kept on the worker's document (a hand-back asks who holds a film); none kept when it named none. */
function filmsOf(films: Films): Pick<WorkerDoc, 'films'> {
    return films === undefined ? {} : { films: [...films] };
}

/** M20: a series another worker waits for, when this worker holds its archive whole; the worker is seen now. */
async function offerCopy(
    deps: ClaimDeps,
    call: WorkerCall,
    archives: readonly string[] | undefined,
    seenNow: WorkerDoc,
): Promise<CallableResponse<'worker.claim'> | undefined> {
    const copy = await copyFor(deps, call.cityId, archives);
    if (copy === undefined) {
        return undefined;
    }
    deps.log.info('worker asked to copy an archive series', { cityId: call.cityId, workerId: call.workerId, ...copy });
    await deps.documents.set(FIRESTORE_PATHS.worker(call.cityId, call.workerId), workerDocSchema, seenNow);
    return { job: null, copy };
}

/** The first claimable job taken, or none; the worker is seen now either way. */
async function claimJob(deps: ClaimDeps, call: Claim, seenNow: WorkerDoc, now: Date): Promise<CallableResponse<'worker.claim'>> {
    const jobId = await takeFirst(deps, call, now);
    if (jobId !== null) {
        deps.log.info('worker claimed a job', { cityId: call.cityId, workerId: call.workerId, jobId });
        return { job: { jobId } };
    }
    await deps.documents.set(FIRESTORE_PATHS.worker(call.cityId, call.workerId), workerDocSchema, seenNow);
    return { job: null };
}

/** Why the worker takes no job now: its image is outdated, or it is held back (paused, yielded); neither when it may. */
async function whyNot(
    deps: ClaimDeps,
    caller: VerifiedCaller,
    { claim, worker, now }: { readonly claim: Claim; readonly worker: WorkerDoc; readonly now: Date },
): Promise<{ readonly outdated: boolean; readonly held: HoldBack | null }> {
    // Finding 72: the image `worker.hello` recorded (the supervisor's), else the pairing's.
    const { outdated } = await imageState(deps, caller, claim.cityId, worker.image);
    return { outdated, held: outdated ? null : await holdBack(deps.documents, claim, worker, now) };
}

/** The answer of a claim that took no job: held back (paused, yielded), outdated, or nothing to do. */
function noJob(deps: ClaimDeps, claim: Claim, outdated: boolean, held: HoldBack | null): CallableResponse<'worker.claim'> {
    if (held !== null) {
        deps.log.info('worker holds back', { cityId: claim.cityId, workerId: claim.workerId, why: held, ...claim.disk });
        return { job: null, [held]: true };
    }
    return outdated ? { job: null, outdated } : { job: null };
}

/** A paused worker's answer also says who paused it, when and until when (`pause`), which its governor mirrors. */
function withPause(answer: CallableResponse<'worker.claim'>, worker: WorkerDoc, now: Date): CallableResponse<'worker.claim'> {
    const paused = activePause(worker, now);
    return paused === undefined ? answer : { ...answer, pause: pauseAnswer(paused) };
}

/** The `worker-claim` callable. */
export function claimFunction(getDeps: () => ClaimDeps & CallableDeps) {
    return defineCallable('worker.claim', paired(workerClaim), getDeps);
}
