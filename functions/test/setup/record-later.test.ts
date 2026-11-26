/**
 * `setup.recordCloud`'s M6 setup-ux parts (`docs/research/M6-interfaces.md` §4.1, §3.1; scenarios A59 and A60): Do it
 * later on the USGS card, and a likely free-trial billing account with the owner's "It is a paid account".
 */
import { FIRESTORE_PATHS, recordCloudRequestSchema } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { recordCloud } from '../../src/setup/record-cloud.js';
import { ADMIN, NOW, createWorld, type World } from './world.js';

const CHECKED = { seconds: Date.parse(NOW) / 1000, nanoseconds: 0 };
const BILLING = {
    state: 'ok',
    budgetId: 'billingAccounts/0E2E00-0E2E00-0E2E01/budgets/0e2e0000-0000-4000-8000-000000000001',
    budgetAmount: 5,
    currency: 'USD',
} as const;
const A_DAY_BEFORE = new Date(Date.parse(NOW) - 86_400_000).toISOString();

function record(world: World, request: Parameters<typeof recordCloud>[2]) {
    return recordCloud(world.deps, ADMIN, request);
}

function seed(world: World, fields: Readonly<Record<string, unknown>>): void {
    world.documents.seed(FIRESTORE_PATHS.setupStatus, { ...fields, updatedBy: ADMIN.uid, updatedAt: CHECKED });
}

describe('setup.recordCloud: USGS later', () => {
    it('happyPath_doItLaterRecordsWhenOnAnAreaNeverChecked', async () => {
        const world = createWorld();

        const response = await record(world, { postponed: { usgs: true } });

        expect(response.status.usgs).toMatchObject({ state: 'missing', postponedAt: NOW });
        expect(world.status()?.usgs).toEqual({ state: 'missing', postponedAt: CHECKED });
    });

    it('happyPath_aRefusedTokenKeepsItsStateAndReasonWhenPostponed', async () => {
        const world = createWorld();
        seed(world, { usgs: { state: 'invalid', detail: 'apiError.usgs.credentials', checkedAt: CHECKED } });

        const response = await record(world, { postponed: { usgs: true } });

        expect(response.status.usgs).toMatchObject({ state: 'invalid', detail: 'apiError.usgs.credentials', postponedAt: NOW });
    });

    it('badPath_takenBackTheAreaIsToDoAgain', async () => {
        const world = createWorld();
        seed(world, { usgs: { state: 'missing', postponedAt: CHECKED } });

        const response = await record(world, { postponed: { usgs: false } });

        expect(response.status.usgs).not.toHaveProperty('postponedAt');
        expect(world.status()?.usgs).toEqual({ state: 'missing' });
    });
});

describe('setup.recordCloud: a likely free trial', () => {
    it('happyPath_theDayTheAccountAppearedIsRecordedWithTheBilling', async () => {
        const world = createWorld();

        const response = await record(world, { billing: BILLING, trial: { since: A_DAY_BEFORE } });

        expect(response.status.billing).toMatchObject({ ...BILLING, trialSince: A_DAY_BEFORE });
    });

    it('happyPath_aBillingReportKeepsTheTrialAndTheFirstDayWins', async () => {
        const world = createWorld();
        await record(world, { billing: BILLING, trial: { since: A_DAY_BEFORE } });

        await record(world, { billing: BILLING });
        const response = await record(world, { trial: { since: NOW } });

        expect(response.status.billing).toMatchObject({ state: 'ok', trialSince: A_DAY_BEFORE });
    });

    it('happyPath_itIsAPaidAccountIsRecordedForGood', async () => {
        const world = createWorld();
        await record(world, { billing: BILLING, trial: { since: A_DAY_BEFORE } });

        const response = await record(world, { trial: { paid: true } });
        await record(world, { billing: BILLING });

        expect(response.status.billing).toMatchObject({ trialSince: A_DAY_BEFORE, trialPaidAt: NOW });
        expect(world.status()?.billing).toMatchObject({ trialPaidAt: CHECKED });
    });

    it('badPath_aTrialSaidAfterAPaidAccountStartsAgainFromThatDay', async () => {
        // The owner's "This account is a free trial" after "It is a paid account" (finding 6 of the M6 review).
        const world = createWorld();
        await record(world, { billing: BILLING, trial: { since: '2026-01-01T00:00:00.000Z' } });
        await record(world, { trial: { paid: true } });

        const response = await record(world, { trial: { since: A_DAY_BEFORE } });

        expect(response.status.billing).toMatchObject({ trialSince: A_DAY_BEFORE });
        expect(response.status.billing).not.toHaveProperty('trialPaidAt');
    });

    it('badPath_aDayInTheFutureStartsTheTrialNow', async () => {
        const world = createWorld();

        const response = await record(world, { trial: { since: '2099-01-01T00:00:00.000Z' } });

        expect(response.status.billing).toMatchObject({ state: 'missing', trialSince: NOW });
    });

    it('badPath_anEmptyReportIsRefusedByTheSchema', () => {
        expect(recordCloudRequestSchema.safeParse({}).success).toBe(false);
        expect(recordCloudRequestSchema.safeParse({ trial: { since: NOW, paid: true } }).success).toBe(false);
        expect(recordCloudRequestSchema.safeParse({ postponed: { usgs: true } }).success).toBe(true);
    });
});
