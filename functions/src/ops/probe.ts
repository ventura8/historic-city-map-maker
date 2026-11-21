import { runAs } from '../global-options.js';

import { BACKGROUND_FUNCTIONS, FIRESTORE_PATHS, opsProbeDocSchema, systemWriter, timestampFromDate } from '@hcm/shared';
import { onDocumentWritten } from 'firebase-functions/firestore';

import type { Ports } from '../ports/index.js';

/**
 * `ops.onProbe` (M6, finding 17 of `docs/research/manual-test-2026-10-25.md`; `docs/research/M6-interfaces.md` §3.2): the
 * other half of the self-test's `events` check. `setup.selfTest` writes `ops/probe` with a fresh nonce; Eventarc delivers
 * the change to this function with its own account (`fn-events@`), which needs `roles/run.invoker` on the project: the
 * role whose absence stopped the legacy import at 0 of 45 photos and that the emulators never check. The answer copies
 * the nonce to `receivedNonce`, so the check sees its own probe come back.
 */
export type ProbeDeps = Pick<Ports, 'log' | 'clock' | 'documents'>;

/**
 * Answers the probe that `ops/probe` holds now, once: read in a transaction, so an answer never overwrites a newer
 * probe, and this function's own write (which triggers it again) finds the nonce answered and writes nothing.
 */
export async function answerProbe(deps: ProbeDeps): Promise<'answered' | 'nothing'> {
    const at = timestampFromDate(deps.clock.now());
    const answered = await deps.documents.transaction(async (transaction) => {
        const probe = await transaction.get(FIRESTORE_PATHS.opsProbe, opsProbeDocSchema);
        if (probe === undefined || probe.receivedNonce === probe.nonce) {
            return false;
        }
        await transaction.set(FIRESTORE_PATHS.opsProbe, opsProbeDocSchema, {
            ...probe,
            receivedNonce: probe.nonce,
            receivedAt: at,
            updatedBy: systemWriter('ops'),
            updatedAt: at,
        });
        return true;
    });
    if (answered) {
        deps.log.info('events probe answered');
    }
    return answered ? 'answered' : 'nothing';
}

/** `ops-onProbe`: a Firestore trigger on `ops/probe`, one instance, no retry (the check asks again). */
export function onProbeFunction(getDeps: () => ProbeDeps) {
    const options = { document: BACKGROUND_FUNCTIONS['ops.onProbe'].source, retry: false, maxInstances: 1, ...runAs('ops.onProbe') };
    return onDocumentWritten(options, async () => {
        await answerProbe(getDeps());
    });
}
