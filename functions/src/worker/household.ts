/**
 * W5, household computers (`docs/research/M7-local-worker.md` *Household computers*): which of the city's computers takes the
 * next job. A computer paused in the admin's list takes none. A computer whose person is at it, whose other programs are busy,
 * that runs on battery or runs hot (its governor's share, said with each claim: M26) leaves the job to another computer of the
 * city that is calm now: connected, not paused or removed, idle, and at full share. With no calm computer it takes the job
 * anyway, at the governor's quiet pace: a job is never left waiting for a computer that is not there. A computer whose disk is below
 * the floor its worker said (cleanup item 6) takes none either (`lowDisk`) until there is room.
 */
import {
    FIRESTORE_PATHS,
    timestampToDate,
    WORKER_FRESH_SECONDS,
    workerDocSchema,
    type CallableRequest,
    type WorkerDoc,
    type WorkerShare,
} from '@hcm/shared';

import type { Ports } from '../ports/index.js';
import { diskLow } from './cleanup.js';

/** Why a computer takes no job now: paused in the admin, its disk below its floor (cleanup item 6), or left to a calmer computer. */
export type HoldBack = 'paused' | 'lowDisk' | 'yielded';

/** How many idle computers of the city one claim looks at. */
const PEERS_MAX = 20;

/** The governor's reasons that mean "someone needs this computer now" (M26 `WORKER_PROFILE_WHYS`). */
const PRESSED_WHYS: ReadonlySet<WorkerShare['why']> = new Set<WorkerShare['why']>([
    'user-active',
    'others-busy',
    'battery',
    'thermal',
    'gpu-busy',
]);

/** True when the computer's governor holds it back for its person (or its heat), not by the owner's choice. */
function pressed(share: WorkerShare | undefined): boolean {
    return share !== undefined && share.profile !== 'full' && PRESSED_WHYS.has(share.why);
}

/** A computer that could take the job at once: seen lately, not paused or removed, idle, at full share. */
function calm(worker: WorkerDoc, now: Date): boolean {
    const fresh = timestampToDate(worker.lastSeenAt).getTime() + WORKER_FRESH_SECONDS * 1000 > now.getTime();
    return fresh && free(worker) && worker.share?.profile === 'full';
}

/** Idle, and neither paused nor removed. */
function free(worker: WorkerDoc): boolean {
    return worker.state === 'idle' && worker.pausedAt === undefined && worker.revokedAt === undefined;
}

/** Another computer of the city that is calm now. */
async function calmPeer(documents: Ports['documents'], cityId: string, workerId: string, now: Date): Promise<boolean> {
    const found = await documents.query(FIRESTORE_PATHS.workers(cityId), workerDocSchema, {
        where: [['state', '==', 'idle']],
        limit: PEERS_MAX,
    });
    return found.documents.some((peer) => peer.id !== workerId && calm(peer.data, now));
}

/** Why this computer takes no job now, or null when it may take one. */
export async function holdBack(
    documents: Ports['documents'],
    call: { readonly cityId: string; readonly workerId: string; readonly disk?: CallableRequest<'worker.claim'>['disk'] },
    worker: WorkerDoc,
    now: Date,
): Promise<HoldBack | null> {
    if (worker.pausedAt !== undefined) {
        return 'paused';
    }
    if (diskLow(call.disk)) {
        return 'lowDisk';
    }
    if (!pressed(worker.share)) {
        return null;
    }
    return (await calmPeer(documents, call.cityId, call.workerId, now)) ? 'yielded' : null;
}
