import '../global-options.js';

import { FIRESTORE_PATHS, opsGuardDocSchema, timestampFromDate, type CallableResponse } from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { omit } from '../api/objects.js';
import type { Ports } from '../ports/index.js';

/**
 * `imagery.resumeGuard` (admin, App Check consume; CR-M3-47): the way out of a budget pause. `ops.onBudget` turns
 * `ops/guard` red when the month's Google Cloud cost reaches the budget, which pauses imports, retries, the georeferencer's
 * saves, crops and publishes; the admin's banner in Imagery and Jobs shows the spend and **Resume processing**, which
 * turns it green again (the public map never stopped). The admin accepts that budget period's spend (`resumedFor`): its
 * repeated alerts leave the guard green, the next period's pause it again. Waiting work starts on the next tick (within 15 minutes).
 */
export type ResumeGuardDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

async function imageryResumeGuard(deps: ResumeGuardDeps, caller: VerifiedCaller): Promise<CallableResponse<'imagery.resumeGuard'>> {
    const now = timestampFromDate(deps.clock.now());
    const resumed = await deps.documents.transaction(async (transaction) => {
        const guard = await transaction.get(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema);
        if (guard?.state !== 'red') {
            return false;
        }
        const interval = guard.spend?.interval;
        await transaction.set(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema, {
            ...omit(guard, ['reason', 'since', 'spend', 'resumedFor']),
            state: 'green',
            resumedBy: caller.uid,
            resumedAt: now,
            ...(interval === undefined ? {} : { resumedFor: interval }),
            updatedBy: caller.uid,
            updatedAt: now,
        });
        return true;
    });
    deps.log.info('budget guard resumed', { uid: caller.uid, resumed });
    return { state: 'green' };
}

/** The `imagery-resumeGuard` callable. */
export function resumeGuardFunction(getDeps: () => ResumeGuardDeps & CallableDeps) {
    return defineCallable('imagery.resumeGuard', imageryResumeGuard, getDeps);
}
