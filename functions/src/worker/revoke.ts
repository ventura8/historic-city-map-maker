import '../global-options.js';

import {
    FIRESTORE_PATHS,
    workerDocSchema,
    workerPairingDocSchema,
    type CallableRequest,
    type CallableResponse,
    type TimestampLike,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { at } from './holder.js';

export type RevokeDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

/** The worker's pairing revoked with it (one made with a Google sign-in on its page has none). */
export async function revokePairing(
    transaction: DocumentTransaction,
    cityId: string,
    pair: string | undefined,
    stamp: Stamp,
): Promise<void> {
    if (pair === undefined) {
        return;
    }
    const path = FIRESTORE_PATHS.pairing(cityId, pair);
    const pairing = await transaction.get(path, workerPairingDocSchema);
    if (pairing !== undefined && pairing.revokedAt === undefined) {
        await transaction.set(path, workerPairingDocSchema, { ...pairing, revokedAt: stamp.updatedAt, ...stamp });
    }
}

export interface Stamp {
    readonly updatedBy: string;
    readonly updatedAt: TimestampLike;
}

/**
 * `worker.revoke`, Disconnect this computer (finding 67 of 2026-11-02, `docs/research/M7-local-worker.md` §2.6, §10;
 * S-A62-HAPPY-DISCONNECT): the worker's document and the pairing it signed in with are revoked in one transaction, so
 * every later call of that worker, and of any process signed in with that pairing (a restart reads it from its volume),
 * is refused (`apiError.worker.revoked`); the worker then forgets its session. The owner's own sign-ins are untouched
 * (Firebase's `revokeRefreshTokens` would sign the owner out everywhere). False when there is no such worker.
 */
async function workerRevoke(
    deps: RevokeDeps,
    caller: VerifiedCaller,
    request: CallableRequest<'worker.revoke'>,
): Promise<CallableResponse<'worker.revoke'>> {
    const stamp: Stamp = { updatedBy: caller.uid, updatedAt: at(deps.clock.now()) };
    const path = FIRESTORE_PATHS.worker(request.cityId, request.workerId);
    const revoked = await deps.documents.transaction(async (transaction) => {
        const worker = await transaction.get(path, workerDocSchema);
        if (worker === undefined) {
            return false;
        }
        await revokePairing(transaction, request.cityId, worker.pair, stamp);
        await transaction.set(path, workerDocSchema, { ...worker, revokedAt: worker.revokedAt ?? stamp.updatedAt, ...stamp });
        return true;
    });
    deps.log.info('worker revoked', { cityId: request.cityId, workerId: request.workerId, revoked });
    return { revoked };
}

/** The `worker-revoke` callable. */
export function revokeFunction(getDeps: () => RevokeDeps & CallableDeps) {
    return defineCallable('worker.revoke', workerRevoke, getDeps);
}
