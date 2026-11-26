import '../global-options.js';

import {
    FIRESTORE_PATHS,
    WORKER_HOUSEHOLD_PAIR_SECONDS,
    WORKER_PAIR_SECONDS,
    timestampToDate,
    workerPairingDocSchema,
    type CallableRequest,
    type CallableResponse,
    type WorkerPairingDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { Ports } from '../ports/index.js';
import { at } from './holder.js';
import { installedImage } from './installed-image.js';
import { newPairCode, pairIdOf } from './pairing.js';

export type PairCodeDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'jobs'>;

/** How many of the caller's own pairings one call looks at to delete the unused expired ones. */
const SWEEP_MAX = 50;

/** An unused code past its time: deleted when the same owner asks for a new one, so codes do not pile up. */
function stale(pairing: WorkerPairingDoc, now: Date): boolean {
    return pairing.pairedAt === undefined && timestampToDate(pairing.expiresAt) <= now;
}

async function sweep(deps: PairCodeDeps, cityId: string, uid: string, now: Date): Promise<void> {
    const mine = await deps.documents.query(FIRESTORE_PATHS.pairings(cityId), workerPairingDocSchema, {
        where: [['uid', '==', uid]],
        limit: SWEEP_MAX,
    });
    for (const { id } of mine.documents.filter((pairing) => stale(pairing.data, now))) {
        await deps.documents.delete(FIRESTORE_PATHS.pairing(cityId, id));
    }
}

/**
 * `worker.pairCode` (finding 67 of 2026-11-02, `docs/research/M7-local-worker.md` §2.6; S-A62-HAPPY-PAIR): when the
 * worker's panel shows the command, a one-time code for it (`--pair <code>`): 130 random bits, stored only as its id (a
 * SHA-256 prefix) with the caller, the installed pipeline image the command names and its expiry, `WORKER_PAIR_SECONDS`
 * from now. The caller's earlier codes that expired unused are deleted. W5 (household computers): `household` codes, for
 * "Add another computer"'s one-line command, last `WORKER_HOUSEHOLD_PAIR_SECONDS` (that computer installs Docker and pulls the
 * pipeline before its worker can spend the code); still one use, still bound to the caller and the city.
 */
async function workerPairCode(
    deps: PairCodeDeps,
    caller: VerifiedCaller,
    request: CallableRequest<'worker.pairCode'>,
): Promise<CallableResponse<'worker.pairCode'>> {
    const now = deps.clock.now();
    await sweep(deps, request.cityId, caller.uid, now);
    const code = newPairCode();
    const seconds = request.household === true ? WORKER_HOUSEHOLD_PAIR_SECONDS : WORKER_PAIR_SECONDS;
    const expiresAt = new Date(now.getTime() + seconds * 1000);
    const image = (await installedImage(deps))?.digest;
    await deps.documents.set(FIRESTORE_PATHS.pairing(request.cityId, pairIdOf(code)), workerPairingDocSchema, {
        uid: caller.uid,
        ...(image === undefined ? {} : { image }),
        expiresAt: at(expiresAt),
        updatedBy: caller.uid,
        updatedAt: at(now),
    });
    deps.log.info('worker pairing code minted', { cityId: request.cityId, household: request.household === true, seconds });
    return { code, expiresAt: expiresAt.toISOString() };
}

/** The `worker-pairCode` callable. */
export function pairCodeFunction(getDeps: () => PairCodeDeps & CallableDeps) {
    return defineCallable('worker.pairCode', workerPairCode, getDeps);
}
