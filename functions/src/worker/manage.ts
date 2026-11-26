import '../global-options.js';

import {
    FIRESTORE_PATHS,
    timestampToDate,
    workerDocSchema,
    type CallableRequest,
    type CallableResponse,
    type WorkerDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { Ports } from '../ports/index.js';
import { askBack } from '../imagery/pause.js';
import { at } from './holder.js';
import { pausedWorker, resumedWorker } from './pause-state.js';

export type ManageDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'worker.manage'>;
type Stamp = Pick<WorkerDoc, 'updatedBy' | 'updatedAt'>;

/** The worker's document as each action leaves it. */
const CHANGES: {
    readonly [A in Request['action']]: (worker: WorkerDoc, request: Extract<Request, { action: A }>, stamp: Stamp) => WorkerDoc;
} = {
    rename: (worker, request, stamp) => ({ ...worker, name: request.name, ...stamp }),
    remove: (worker, request, stamp) => {
        const removal = { step: 'asked' as const, askedAt: stamp.updatedAt, docker: request.docker, keep: request.keep };
        return { ...worker, removal, ...stamp };
    },
    // Pause (2026-11-13): one pause for the list and imagery.pause (`pause-state.ts`): who, when; Resume drops it.
    pause: (worker, _request, stamp) =>
        worker.paused === undefined ? { ...pausedWorker(worker, stamp.updatedBy, timestampToDate(stamp.updatedAt)), ...stamp } : worker,
    resume: (worker, _request, stamp) => ({ ...resumedWorker(worker), ...stamp }),
    // Cleanup item 6 (2026-11-14): Free space now; the worker's next claim is answered `freeSpace` until it says what it freed.
    freeSpace: (worker, _request, stamp) => ({ ...worker, freeSpaceAskedAt: stamp.updatedAt, ...stamp }),
};

/** The worker's document as the action leaves it. */
function changed(worker: WorkerDoc, request: Request, stamp: Stamp): WorkerDoc {
    const change = CHANGES[request.action] as (worker: WorkerDoc, request: Request, stamp: Stamp) => WorkerDoc;
    return change(worker, request, stamp);
}

/** Pause: the job the computer runs is asked back (it hands it back at its next checkpoint), or, on Resume, no longer. */
async function askBackOnPause(deps: ManageDeps, request: Request, stamp: Stamp, worker: WorkerDoc): Promise<void> {
    if (request.action !== 'pause' && request.action !== 'resume') {
        return;
    }
    const busy = worker.state === 'busy' ? worker.jobId : undefined;
    await askBack(deps, { cityId: request.cityId, action: request.action, stamp }, busy);
}

/**
 * `worker.manage` (W5, household computers: `docs/research/M7-local-worker.md` *Household computers*; S-A143-HAPPY-MANAGE,
 * S-A143-BAD-MANAGE-REMOVED): the admin's list of the city's computers renames one (its name in the list only), pauses it (its
 * claims are given no job: `worker.claim` answers `paused`) or resumes it, asks it to free space now (`freeSpace`, cleanup item 6:
 * its next claim is answered `freeSpace`; S-A62-HAPPY-FREE-SPACE), or asks it to remove itself (`removal.ts`: its
 * worker cleans the computer up at its next claim, then is disconnected; S-A143-HAPPY-REMOVE). A computer that is unknown or
 * already disconnected is left alone: false.
 */
async function workerManage(deps: ManageDeps, caller: VerifiedCaller, request: Request): Promise<CallableResponse<'worker.manage'>> {
    const path = FIRESTORE_PATHS.worker(request.cityId, request.workerId);
    const stamp = { updatedBy: caller.uid, updatedAt: at(deps.clock.now()) };
    const done = await deps.documents.transaction(async (transaction) => {
        const worker = await transaction.get(path, workerDocSchema);
        if (worker === undefined || worker.revokedAt !== undefined) {
            return false;
        }
        await transaction.set(path, workerDocSchema, changed(worker, request, stamp));
        return worker;
    });
    if (done !== false) {
        await askBackOnPause(deps, request, stamp, done);
    }
    deps.log.info('worker managed', {
        cityId: request.cityId,
        workerId: request.workerId,
        action: request.action,
        changed: done !== false,
    });
    return { changed: done !== false };
}

/** The `worker-manage` callable. */
export function manageFunction(getDeps: () => ManageDeps & CallableDeps) {
    return defineCallable('worker.manage', workerManage, getDeps);
}
