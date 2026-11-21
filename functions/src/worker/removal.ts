/**
 * W5, Remove this computer (`docs/research/M7-local-worker.md` *Household computers*; the owner, 2026-11-13: "clean up first,
 * disconnect second, and the user never has to run a command"). The admin's list asks it (`worker.manage` `remove`); the worker's
 * next claim is answered `remove` instead of a job; the worker says `accepted` and ends, and its supervisor (the starter) cleans the
 * computer up; then the worker, started once more for that, says `done`, and only then is it disconnected (its document and pairing
 * revoked in one transaction, as `worker.revoke`). A worker with no supervisor says `failed` (`no-starter`). A computer that is off
 * gets the order the next time it claims.
 */
import { FIRESTORE_PATHS, workerDocSchema, type CallableRequest, type CallableResponse, type WorkerDoc } from '@hcm/shared';

import type { Ports } from '../ports/index.js';
import { at, requireWorker, type WorkerCall } from './holder.js';
import { revokePairing } from './revoke.js';

type Said = NonNullable<CallableRequest<'worker.claim'>['removal']>;
type Deps = Pick<Ports, 'documents' | 'clock' | 'log'>;

/** The order a claim of this worker is answered with, while a removal is asked; undefined otherwise. */
export function removalOrder(worker: WorkerDoc): CallableResponse<'worker.claim'> | undefined {
    const removal = worker.removal;
    return removal?.step === 'asked' ? { job: null, remove: { docker: removal.docker, keep: removal.keep } } : undefined;
}

/** The worker's document as its word on the removal leaves it (a word with no removal asked: the computer's own Stop). */
function said(worker: WorkerDoc, word: Said, now: Date): WorkerDoc {
    const asked = worker.removal ?? { step: 'asked' as const, askedAt: at(now), docker: false, keep: false };
    const removal = { ...asked, step: word.step, ...(word.why === undefined ? {} : { why: word.why }) };
    const left = word.dockerLeft === true ? { dockerLeft: true } : {};
    const revoked = word.step === 'done' ? { revokedAt: at(now) } : {};
    return { ...worker, removal: { ...removal, ...left }, ...revoked, lastSeenAt: at(now), updatedBy: worker.uid, updatedAt: at(now) };
}

/** A claim that carries the worker's word on its removal: recorded; `done` disconnects the worker and its pairing. */
export async function reportRemoval(deps: Deps, call: WorkerCall, word: Said): Promise<CallableResponse<'worker.claim'>> {
    const now = deps.clock.now();
    const path = FIRESTORE_PATHS.worker(call.cityId, call.workerId);
    await deps.documents.transaction(async (transaction) => {
        const worker = await requireWorker(transaction, call);
        if (word.step === 'done') {
            await revokePairing(transaction, call.cityId, worker.pair, { updatedBy: call.uid, updatedAt: at(now) });
        }
        await transaction.set(path, workerDocSchema, said(worker, word, now));
    });
    deps.log.info('worker removal', { cityId: call.cityId, workerId: call.workerId, step: word.step, why: word.why ?? null });
    return { job: null };
}
