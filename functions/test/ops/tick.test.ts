/**
 * `ops.tick`: every step in order, each isolated (a failure is recorded with its code and the next step runs), the
 * tick record on `ops/guard`, the nightly bookkeeping, and the scheduled trigger.
 */
import { FIRESTORE_PATHS, OPS_STEPS, cityDocSchema, opsGuardDocSchema, timestampFromDate, type OpsGuardDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { opsFunctions } from '../../src/ops/index.js';
import { runTick, tickFunction } from '../../src/ops/tick.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { CITY_ID, cityDoc } from '../publish/city.js';
import { account, opsDeps, type OpsTestDeps } from './fakes.js';

const NIGHT = '2026-10-12T02:15:00.000Z';
const DAY = '2026-10-12T14:30:00.000Z';
const at = (iso: string) => timestampFromDate(new Date(iso));

async function guard(deps: OpsTestDeps): Promise<OpsGuardDoc | undefined> {
    return deps.documents.get(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema);
}

const allOk = OPS_STEPS.map((step) => ({ step, ok: true }));

describe('runTick', () => {
    it('happyPath_aFreshProjectGetsAGreenGuardAndItsFirstNightlyRun', async () => {
        const deps = opsDeps(NIGHT);
        await deps.documents.set(FIRESTORE_PATHS.city(CITY_ID), cityDocSchema, cityDoc());

        await expect(runTick(deps)).resolves.toEqual(allOk);

        expect(await guard(deps)).toEqual({
            state: 'green',
            since: at(NIGHT),
            lastNightlyAt: at(NIGHT),
            lastTick: { ranAt: at(NIGHT), steps: allOk },
            updatedBy: 'system:ops',
            updatedAt: at(NIGHT),
        });
        expect(deps.tasks.queued).toHaveLength(1);
    });

    it('happyPath_aDaytimeTickKeepsTheNightlyTimeAndARedGuard', async () => {
        const deps = opsDeps(DAY);
        await deps.documents.set(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema, {
            state: 'red',
            reason: 'budget',
            since: at('2026-10-12T10:00:00.000Z'),
            lastNightlyAt: at(NIGHT),
            updatedBy: 'system:ops',
            updatedAt: at('2026-10-12T10:00:00.000Z'),
        });

        await runTick(deps);

        expect(await guard(deps)).toMatchObject({ state: 'red', reason: 'budget', lastNightlyAt: at(NIGHT), lastTick: { ranAt: at(DAY) } });
        expect(deps.tasks.queued).toEqual([]);
    });

    it('badPath_aFailingStepIsRecordedAndTheNextStepsRun', async () => {
        const deps = opsDeps(DAY, { users: [account('u-stranger', '2026-10-01T00:00:00.000Z')] });
        deps.documents.recorder.failNext('query', new UpstreamError('firestore', 'unavailable'));
        await deps.secrets.write('mapbox-sk-bootstrap', 'sk.test-bootstrap-value');
        deps.documents.seed(FIRESTORE_PATHS.setupStatus, {
            mapbox: { state: 'ok', retiring: [{ tokenId: 'old1', retireAt: at('2026-10-12T14:00:00.000Z') }] },
            updatedBy: 'u-admin',
            updatedAt: at('2026-10-12T14:00:00.000Z'),
        });
        deps.auth.recorder.failNext('listUsers', new Error('bug'));

        const steps = await runTick(deps);

        expect(steps.filter((step) => !step.ok)).toEqual([
            { step: 'manifests', ok: false, detail: 'apiError.unavailable' },
            { step: 'tokens', ok: false, detail: 'apiError.mapbox.notConfigured' },
            { step: 'users', ok: false, detail: 'apiError.internal' },
        ]);
        expect((await guard(deps))?.lastTick?.steps).toEqual(steps);
        expect(
            deps.recording.records.filter((record) => record.message === 'ops step failed').map((record) => record.data?.['retryable']),
        ).toEqual([true, false, true]);
        expect((await guard(deps))?.lastNightlyAt).toBeUndefined();
    });

    it('badPath_aFailedGuardStepStillRecordsTheTickOnAGreenGuard', async () => {
        const deps = opsDeps(DAY);
        deps.documents.recorder.failNext('transaction', new UpstreamError('firestore', 'unavailable'));

        const steps = await runTick(deps);

        expect(steps[0]).toEqual({ step: 'guard', ok: false, detail: 'apiError.unavailable' });
        expect(await guard(deps)).toMatchObject({ state: 'green', since: at(DAY), lastTick: { steps } });
    });

    it('badPath_aGuardThatNoLongerValidatesIsNeverOverwritten', async () => {
        const deps = opsDeps(DAY);
        deps.documents.seed(FIRESTORE_PATHS.opsGuard, { state: 'purple' });

        await expect(runTick(deps)).rejects.toMatchObject({ name: 'InvalidDocumentError' });

        expect(deps.documents.peek(FIRESTORE_PATHS.opsGuard)).toEqual({ state: 'purple' });
    });
});

describe('ops-tick', () => {
    it('happyPath_theSchedulerRunsTheTick', async () => {
        const deps = opsDeps(DAY);

        await tickFunction(() => deps).run({ scheduleTime: DAY, jobName: 'firebase-schedule-ops-tick-us-central1' });

        expect((await guard(deps))?.lastTick?.steps).toEqual(allOk);
    });

    it('happyPath_everyFifteenMinutesInUtcWithoutRetry', () => {
        expect(tickFunction(() => opsDeps(DAY)).__endpoint.scheduleTrigger).toMatchObject({
            schedule: 'every 15 minutes',
            timeZone: 'UTC',
            retryConfig: { retryCount: 0 },
        });
    });

    it('happyPath_theGroupHasTheRegistryNames', () => {
        expect(Object.keys(opsFunctions(() => opsDeps(DAY))).sort((a, b) => a.localeCompare(b))).toEqual(['onBudget', 'onProbe', 'tick']);
    });
});
