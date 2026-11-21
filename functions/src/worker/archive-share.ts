/**
 * M20 §22 (`docs/research/M20-import-local.md`; the owner's request of 2026-11-14): the computer that holds a local archive shares
 * its series with the city's other computers, from a thread of its own, also while it runs a job. Until then a copy was asked only
 * by the holder's claim, so a holder busy with a long job, or one that yields to a calmer computer, sent nothing, and eight queued
 * series waited while two other computers idled. `worker.archiveCopy` `wanted` names the next series to share: one a worker handed
 * back first (`copyFor`), else a queued one not copied yet when another computer could take it (`preseedFor`); `progress` says how
 * far the copy got; both, and `done`, keep the worker's `sharing` (the Computers card). Each computer shares at most
 * `ARCHIVE_SHARE_DAY_BYTES` a UTC day: every byte shared is downloaded once, the bucket's only billed traffic.
 */
import {
    ARCHIVE_SHARE_DAY_BYTES,
    FIRESTORE_PATHS,
    workerDocSchema,
    type CallableRequest,
    type CallableResponse,
    type WorkerDoc,
    type WorkerSharing,
} from '@hcm/shared';

import type { Ports } from '../ports/index.js';
import { copyFor, preseedFor, type Copy } from './archive-host.js';
import { at, requireWorker, type WorkerCall } from './holder.js';

export type ShareDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Response = CallableResponse<'worker.archiveCopy'>;
type Kind<K extends string> = Extract<CallableRequest<'worker.archiveCopy'>['copy'], { kind: K }>;

/** How long a computer counts as one that could take a shared series after it was last seen (a busy one's heartbeat refreshes it). */
const SHARE_PEER_SECONDS = 600;

/** How many of the city's computers seen lately one `wanted` looks at. */
const PEERS_MAX = 50;

/** The UTC day `at` falls on, as `YYYY-MM-DD`. */
export function dayOf(now: Date): string {
    return now.toISOString().slice(0, 10);
}

/** The bytes the worker shared today (none on a new day). */
export function spentToday(sharing: WorkerSharing | undefined, now: Date): number {
    return sharing?.day === dayOf(now) ? sharing.dayBytes : 0;
}

/** Neither paused, nor disconnected, nor being removed. */
function available(worker: WorkerDoc): boolean {
    return [worker.pausedAt, worker.paused, worker.revokedAt, worker.removal].every((field) => field === undefined);
}

/** The city's other computers that could take a shared series: seen in the last `SHARE_PEER_SECONDS`, and available. */
async function peersOf(deps: Pick<Ports, 'documents'>, call: WorkerCall, now: Date): Promise<number> {
    const since = at(new Date(now.getTime() - SHARE_PEER_SECONDS * 1000));
    const seen = await deps.documents.query(FIRESTORE_PATHS.workers(call.cityId), workerDocSchema, {
        where: [['lastSeenAt', '>=', since]],
        limit: PEERS_MAX,
    });
    return seen.documents.filter((peer) => peer.id !== call.workerId && available(peer.data)).length;
}

/** The worker's `sharing` changed by `next` in one transaction (a claim or a heartbeat may write the same document). */
async function keepSharing(deps: ShareDeps, call: WorkerCall, next: (before: WorkerSharing | undefined) => WorkerSharing | undefined) {
    const path = FIRESTORE_PATHS.worker(call.cityId, call.workerId);
    await deps.documents.transaction(async (transaction) => {
        const worker = await requireWorker(transaction, call);
        const sharing = next(worker.sharing);
        if (sharing !== undefined && sharing !== worker.sharing) {
            await transaction.set(path, workerDocSchema, { ...worker, sharing, updatedBy: call.uid, updatedAt: sharing.at });
        }
    });
}

/** The worker's sharing as it starts or goes on with `jobId`: the day's bytes carried, the computers counted now. */
function sending(
    before: WorkerSharing | undefined,
    now: Date,
    part: Pick<WorkerSharing, 'jobId' | 'computers' | 'sentBytes' | 'totalBytes'>,
) {
    return { state: 'sending' as const, ...part, day: dayOf(now), dayBytes: spentToday(before, now), at: at(now) };
}

/** Sharing settled: a copy that was being sent is over (`done`), or today's bytes are spent (`dayLimit`); unchanged otherwise. */
function settled(before: WorkerSharing | undefined, now: Date, state: 'done' | 'dayLimit'): WorkerSharing | undefined {
    if (before === undefined || (before.state === state && before.day === dayOf(now))) {
        return before;
    }
    return { ...before, state, day: dayOf(now), dayBytes: spentToday(before, now), at: at(now) };
}

/** Why no series is shared now, said to the worker and kept on its document. */
async function idle(deps: ShareDeps, call: WorkerCall, why: NonNullable<Response['idle']>, computers: number): Promise<Response> {
    const now = deps.clock.now();
    await keepSharing(deps, call, (before) => settled(before, now, why === 'dayLimit' ? 'dayLimit' : 'done'));
    return { idle: why, computers };
}

/** The next series to share: one handed back first, else (with another computer to take it) one not copied yet. */
async function nextCopy(deps: ShareDeps, call: WorkerCall, archives: readonly string[], computers: number): Promise<Copy | undefined> {
    return (await copyFor(deps, call.cityId, archives)) ?? (computers > 0 ? await preseedFor(deps, call.cityId, archives) : undefined);
}

/**
 * `wanted`: the next series this worker shares, or why none (`dayLimit`: today's bytes spent; `alone`: no other computer could take
 * one and none was handed back; `nothing`). The worker's document says it sends that series, for how many computers.
 */
export async function shareWanted(deps: ShareDeps, call: WorkerCall, wanted: Kind<'wanted'>): Promise<Response> {
    const now = deps.clock.now();
    const worker = await requireWorker(deps.documents, call);
    const computers = await peersOf(deps, call, now);
    if (spentToday(worker.sharing, now) >= ARCHIVE_SHARE_DAY_BYTES) {
        return idle(deps, call, 'dayLimit', computers);
    }
    const copy = await nextCopy(deps, call, wanted.archives, computers);
    if (copy === undefined) {
        return idle(deps, call, computers === 0 ? 'alone' : 'nothing', computers);
    }
    await keepSharing(deps, call, (before) => sending(before, now, { jobId: copy.jobId, computers, sentBytes: 0, totalBytes: 0 }));
    deps.log.info('worker shares an archive series', { cityId: call.cityId, workerId: call.workerId, computers, ...copy });
    return { copy, computers };
}

/** `progress`: how far the copy of `jobId` got, kept on the worker's document (the Computers card's line). */
export async function shareProgress(deps: ShareDeps, call: WorkerCall, jobId: string, progress: Kind<'progress'>): Promise<Response> {
    const now = deps.clock.now();
    const { sentBytes, totalBytes } = progress;
    await keepSharing(deps, call, (before) => sending(before, now, { jobId, computers: before?.computers ?? 0, sentBytes, totalBytes }));
    return {};
}

/** `done`: the copy is complete; the bytes count against today's share. */
export async function shareDone(deps: ShareDeps, call: WorkerCall, jobId: string, bytes: number): Promise<void> {
    const now = deps.clock.now();
    await keepSharing(deps, call, (before) => ({
        state: 'done',
        computers: before?.computers ?? 0,
        jobId,
        sentBytes: bytes,
        totalBytes: bytes,
        day: dayOf(now),
        dayBytes: spentToday(before, now) + bytes,
        at: at(now),
    }));
}
