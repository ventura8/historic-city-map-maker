import '../global-options.js';

import {
    FIRESTORE_PATHS,
    WORKER_PAIR_ATTEMPTS,
    WORKER_PAIR_WINDOW_SECONDS,
    systemWriter,
    timestampToDate,
    workerPairLimitDocSchema,
    workerPairingDocSchema,
    type CallableRequest,
    type CallableResponse,
    type WorkerPairingDoc,
    type WorkerPairLimitDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { Ports } from '../ports/index.js';
import { at } from './holder.js';
import { pairIdOf } from './pairing.js';

export type PairDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'auth'>;

type Request = CallableRequest<'worker.pair'>;

/** `pairings/limit` as the next attempt leaves it: a new window when the last one is over, else one more attempt. */
function counted(limit: WorkerPairLimitDoc | undefined, now: Date): WorkerPairLimitDoc {
    const windowOver =
        limit === undefined || timestampToDate(limit.windowStart).getTime() + WORKER_PAIR_WINDOW_SECONDS * 1000 <= now.getTime();
    const base = windowOver ? { windowStart: at(now), attempts: 0 } : limit;
    return { windowStart: base.windowStart, attempts: base.attempts + 1, updatedBy: systemWriter('imagery'), updatedAt: at(now) };
}

/**
 * At most `WORKER_PAIR_ATTEMPTS` attempts per city in `WORKER_PAIR_WINDOW_SECONDS`, counted before the code is looked at
 * (`apiError.rateLimited` past it): the callable needs no sign-in, and 130-bit codes leave guessing hopeless anyway.
 */
async function countAttempt(deps: PairDeps, cityId: string, now: Date): Promise<void> {
    const path = FIRESTORE_PATHS.pairLimit(cityId);
    const next = await deps.documents.transaction(async (transaction) => {
        const limit = counted(await transaction.get(path, workerPairLimitDocSchema), now);
        await transaction.set(path, workerPairLimitDocSchema, limit);
        return limit;
    });
    if (next.attempts > WORKER_PAIR_ATTEMPTS) {
        deps.log.warn('worker pairing attempts limited', { cityId });
        throw new ApiError('apiError.rateLimited');
    }
}

/** A code that can still be exchanged: known, never used, not revoked, not expired. */
function exchangeable(pairing: WorkerPairingDoc | undefined, now: Date): pairing is WorkerPairingDoc {
    const open = pairing !== undefined && pairing.pairedAt === undefined && pairing.revokedAt === undefined;
    return open && timestampToDate(pairing.expiresAt) > now;
}

/** The code's pairing marked used, in one transaction (a second exchange of the same code finds it used). */
async function exchange(deps: PairDeps, cityId: string, pairId: string, now: Date): Promise<WorkerPairingDoc> {
    const path = FIRESTORE_PATHS.pairing(cityId, pairId);
    return deps.documents.transaction(async (transaction) => {
        const pairing = await transaction.get(path, workerPairingDocSchema);
        if (!exchangeable(pairing, now)) {
            throw new ApiError('apiError.worker.pairCode');
        }
        await transaction.set(path, workerPairingDocSchema, { ...pairing, pairedAt: at(now), updatedBy: pairing.uid, updatedAt: at(now) });
        return pairing;
    });
}

/** What a pairing's exchange acts on: the city, the new pairing's id and owner, and when. */
interface Exchange {
    readonly cityId: string;
    readonly pairId: string;
    readonly uid: string;
    readonly now: Date;
}

/** The pairing the computer held before (a new command on it): revoked when it is the same owner's and still stands. */
async function revokeReplaced(deps: PairDeps, exchanged: Exchange, replaces: string): Promise<void> {
    const { cityId, uid, now } = exchanged;
    const path = FIRESTORE_PATHS.pairing(cityId, replaces);
    const old = await deps.documents.get(path, workerPairingDocSchema);
    if (old?.uid === uid && old.revokedAt === undefined) {
        await deps.documents.set(path, workerPairingDocSchema, { ...old, revokedAt: at(now), updatedBy: uid, updatedAt: at(now) });
    }
}

/** The pairing's owner must still have a role in the city (else the code is refused as any bad code is). */
async function requireMember(deps: CallableDeps, uid: string, cityId: string): Promise<void> {
    const membership = await deps.admins.membership(uid);
    if ((membership?.roleIn(cityId) ?? null) === null) {
        throw new ApiError('apiError.worker.pairCode');
    }
}

/**
 * `worker.pair` (finding 67 of 2026-11-02, `docs/research/M7-local-worker.md` §2.6; S-A62-HAPPY-PAIR, S-A62-BAD-PAIR-*):
 * no sign-in, App Check off. The worker sends the one-time code of its command; once (a used, expired, revoked or unknown
 * code is one answer, `apiError.worker.pairCode`), while its owner is still a member of the city, it gets a Firebase custom
 * token of that owner with the claims `worker: true`, `city` and `pair` (the pairing's id), which it signs in with. That
 * sign-in works for the worker's callables of that city only: every other callable and the rules want a Google sign-in.
 */
async function workerPair(
    deps: PairDeps & CallableDeps,
    _caller: VerifiedCaller,
    request: Request,
): Promise<CallableResponse<'worker.pair'>> {
    const now = deps.clock.now();
    await countAttempt(deps, request.cityId, now);
    const pairId = pairIdOf(request.code);
    const pairing = await exchange(deps, request.cityId, pairId, now);
    await requireMember(deps, pairing.uid, request.cityId);
    if (request.replaces !== undefined && request.replaces !== pairId) {
        await revokeReplaced(deps, { cityId: request.cityId, pairId, uid: pairing.uid, now }, request.replaces);
    }
    const token = await deps.auth.createCustomToken(pairing.uid, { worker: true, city: request.cityId, pair: pairId });
    deps.log.info('worker paired', { cityId: request.cityId });
    return { token, pairId };
}

/** The `worker-pair` callable. */
export function pairFunction(getDeps: () => PairDeps & CallableDeps) {
    return defineCallable('worker.pair', workerPair, getDeps);
}
