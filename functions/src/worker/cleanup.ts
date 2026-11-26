/**
 * What `worker.claim` does for the worker's own computer besides a job (the resilience audit and the cleanup brief of
 * 2026-11-14; `docs/research/M7-local-worker.md` → *Cleanup and disk*):
 *
 * - **Its own orphan** (P1-3): a worker claims only when it runs nothing (`loop.py`: one job at a time, the claim before the run), so
 *   a job its document still says it runs, `starting` or `running` and claimed by this very worker, was orphaned by a power cut or
 *   a crash of this computer. It is queued again at once, its attempt given back (`lost-run.ts`), instead of waiting for its lease.
 * - **Job states** (cleanup item 1): for each job whose scratch folder the computer holds (`held`), its status now or `gone`, so the
 *   worker deletes only a folder no job needs any more.
 * - **Its disk** (cleanup item 6): what the worker's folder uses and the free bytes of its disk, recorded on its document; under its
 *   floor it takes no job (`lowDisk`). "Free space now" in the admin (`freeSpaceAskedAt`) is answered `freeSpace` until the worker
 *   says it freed space since (`freed`).
 */
import {
    FIRESTORE_PATHS,
    jobStatusOnlySchema,
    timestampFromDate,
    timestampToDate,
    type CallableRequest,
    type CallableResponse,
    type JobDoc,
    type WorkerDoc,
} from '@hcm/shared';

import { omit } from '../api/objects.js';
import { requeueLost, type LostRunDeps } from '../imagery/lost-run.js';
import { IN_RUN, type WorkerCall } from './holder.js';

type Request = CallableRequest<'worker.claim'>;
type Response = CallableResponse<'worker.claim'>;

/** What a claim says of the computer's disk and its last "Free space now". */
export interface DiskWord {
    readonly disk?: Request['disk'];
    readonly freed?: Request['freed'];
}

/** What the claim said of the disk and of the last "Free space now", only what it sent. */
export function diskWordOf({ disk, freed }: Request): DiskWord {
    return { ...(disk === undefined ? {} : { disk }), ...(freed === undefined ? {} : { freed }) };
}

/** True when the claim says the disk is below the worker's floor: it takes no job. */
export function diskLow(disk: Request['disk']): boolean {
    return disk !== undefined && disk.freeBytes < disk.floorBytes;
}

/** True while the admin's "Free space now" waits for the worker: asked, and nothing freed since. */
function asked(worker: WorkerDoc): boolean {
    const at = worker.freeSpaceAskedAt;
    return at !== undefined && (worker.freed === undefined || timestampToDate(worker.freed.at) < timestampToDate(at));
}

/** The worker's document with what the claim said of its disk (and when), and of what it freed; a request it answered dropped. */
export function withDisk(worker: WorkerDoc, word: DiskWord, now: Date): WorkerDoc {
    const disk = word.disk === undefined ? {} : { disk: { ...word.disk, at: timestampFromDate(now) } };
    const freed = word.freed === undefined ? {} : { freed: { bytes: word.freed.bytes, at: timestampFromDate(new Date(word.freed.at)) } };
    const next: WorkerDoc = { ...worker, ...disk, ...freed };
    return asked(next) ? next : omit(next, ['freeSpaceAskedAt']);
}

/** The claim's answer about the disk: `freeSpace` while the admin's request waits for this worker. */
export function freeSpaceOf(worker: WorkerDoc): Pick<Response, 'freeSpace'> {
    return asked(worker) ? { freeSpace: true } : {};
}

/** Each held job's status now, `gone` when it no longer exists; nothing when the claim named none. */
export async function jobStatesOf(deps: LostRunDeps, cityId: string, held: Request['held']): Promise<Pick<Response, 'jobStates'>> {
    if (held === undefined) {
        return {};
    }
    const states = await Promise.all(
        held.map(async (jobId) => {
            const job = await deps.documents.get(FIRESTORE_PATHS.job(cityId, jobId), jobStatusOnlySchema);
            return [jobId, job?.status ?? 'gone'] as const;
        }),
    );
    return { jobStates: Object.fromEntries(states) };
}

/**
 * P1-3: the job this worker's document says it runs, still `starting` or `running` and claimed by this worker, queued again with
 * its attempt given back (the worker claims only when it runs nothing, so its run died with the computer). Another worker's job,
 * or one that moved on, is left alone.
 */
export async function releaseOrphan(deps: LostRunDeps, call: WorkerCall, worker: WorkerDoc, now: Date): Promise<void> {
    const jobId = worker.state === 'busy' ? worker.jobId : undefined;
    if (jobId === undefined) {
        return;
    }
    const still = (job: JobDoc): boolean => IN_RUN.has(job.status) && job.worker?.id === call.workerId;
    if (await requeueLost(deps, { cityId: call.cityId, jobId, why: 'claim', still }, now)) {
        deps.log.info('worker released the job its computer stopped running', { cityId: call.cityId, workerId: call.workerId, jobId });
    }
}
