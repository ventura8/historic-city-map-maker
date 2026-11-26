/**
 * `ops.onProbe` (M6, finding 17; `docs/research/M6-interfaces.md` §3.2): the self-test's `events` check writes `ops/probe`
 * with a nonce, and this trigger, delivered by Eventarc with `fn-events@`, sends the nonce back once.
 */
import { FIRESTORE_PATHS, opsProbeDocSchema, timestampFromDate, type OpsProbeDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { answerProbe, onProbeFunction } from '../../src/ops/probe.js';
import { opsDeps, type OpsTestDeps } from './fakes.js';

const NOW = '2026-10-25T16:40:00.000Z';
const ASKED = '2026-10-25T16:39:59.000Z';
const NONCE = '0123456789abcdef0123456789abcdef';

function probe(overrides: Partial<OpsProbeDoc> = {}): OpsProbeDoc {
    const at = timestampFromDate(new Date(ASKED));
    return { nonce: NONCE, requestedAt: at, updatedBy: 'system:ops', updatedAt: at, ...overrides };
}

async function stored(deps: OpsTestDeps): Promise<OpsProbeDoc | undefined> {
    return deps.documents.get(FIRESTORE_PATHS.opsProbe, opsProbeDocSchema);
}

describe('answerProbe', () => {
    it('happyPath_theNonceIsSentBackOnce', async () => {
        const deps = opsDeps(NOW);
        await deps.documents.set(FIRESTORE_PATHS.opsProbe, opsProbeDocSchema, probe());

        await expect(answerProbe(deps)).resolves.toBe('answered');

        const at = timestampFromDate(new Date(NOW));
        expect(await stored(deps)).toEqual({ ...probe(), receivedNonce: NONCE, receivedAt: at, updatedBy: 'system:ops', updatedAt: at });
        expect(deps.recording.records.at(-1)).toMatchObject({ level: 'info', message: 'events probe answered' });
        // Its own write triggers it again: nothing is left to answer, nothing is written.
        await expect(answerProbe(deps)).resolves.toBe('nothing');
    });

    it('happyPath_aNewProbeIsAnsweredAgain', async () => {
        const deps = opsDeps(NOW);
        await deps.documents.set(FIRESTORE_PATHS.opsProbe, opsProbeDocSchema, probe({ receivedNonce: NONCE }));
        const newer = 'fedcba9876543210fedcba9876543210';
        await deps.documents.set(FIRESTORE_PATHS.opsProbe, opsProbeDocSchema, probe({ nonce: newer }));

        await answerProbe(deps);

        expect((await stored(deps))?.receivedNonce).toBe(newer);
    });

    it('badPath_noProbeYetWritesNothing', async () => {
        const deps = opsDeps(NOW);

        await expect(answerProbe(deps)).resolves.toBe('nothing');

        expect(await stored(deps)).toBeUndefined();
    });
});

describe('onProbeFunction', () => {
    it('happyPath_theTriggerAnswersWhatTheDocumentHoldsNow', async () => {
        const deps = opsDeps(NOW);
        await deps.documents.set(FIRESTORE_PATHS.opsProbe, opsProbeDocSchema, probe());
        const fn = onProbeFunction(() => deps);

        await fn.run({} as Parameters<typeof fn.run>[0]);

        expect((await stored(deps))?.receivedNonce).toBe(NONCE);
    });

    it('happyPath_oneInstanceWithoutRetriesOnTheProbeDocument', () => {
        const endpoint = onProbeFunction(() => opsDeps(NOW)).__endpoint;

        expect(endpoint).toMatchObject({
            maxInstances: 1,
            serviceAccountEmail: 'fn-events@demo-hcm.iam.gserviceaccount.com',
            eventTrigger: { eventFilters: expect.objectContaining({ document: 'ops/probe' }) as unknown, retry: false },
        });
    });
});
