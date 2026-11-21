import { PROVISION_ITEMS, PROVISION_SET_VERSION } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { isBootstrapRecord, type BootstrapRecord } from '../../src/setup/bootstrap-record.js';
import { applyBootstrapRecord, applyStatusView, bootstrapRecordOf, mergeItems, recordCloudRequestOf } from '../../src/setup/records.js';
import { initialSetupState, withStep } from '../../src/setup/state.js';
import { PROJECT_ID, START, createHarness, provisionedItems, statusView } from './harness.js';

const CHECKED = '2026-10-12T08:00:00.000Z';
const BUDGET = 'billingAccounts/AAAAAA-BBBBBB-CCCCCC/budgets/b-1';
const DAY = 86_400_000;

describe('mergeItems', () => {
    it('happyPath_anItemWaitingForAnotherNamesIt', () => {
        const items = mergeItems([
            { id: 'budget-alerts', state: 'pending', params: { item: 'billing' } },
            { id: 'iam', state: 'pending' },
        ]);

        expect(items.find((item) => item.id === 'budget-alerts')?.detail).toEqual({
            key: 'adminSetup.provision.waiting',
            params: { item: 'billing' },
        });
        expect(items.find((item) => item.id === 'iam')?.detail).toBeNull();
    });

    it('happyPath_everyItemInScreenOrderTheUnreportedOnesToDo', () => {
        const items = mergeItems([{ id: 'secrets', state: 'unavailable', detail: 'apiError.unavailable' }]);

        expect(items[0]).toEqual({ id: 'apis', state: 'missing', detail: null });
        expect(items.find((item) => item.id === 'secrets')).toEqual({
            id: 'secrets',
            state: 'unavailable',
            detail: { key: 'apiError.unavailable' },
        });
    });
});

describe('applyStatusView', () => {
    it('happyPath_theServersRecordFillsTheCards', () => {
        const view = statusView({
            billing: { state: 'ok', checkedAt: CHECKED, budgetId: BUDGET, budgetAmount: 25, currency: 'RON' },
            provision: { state: 'pending', checkedAt: CHECKED, items: provisionedItems() },
            mapbox: { state: 'ok', checkedAt: CHECKED, user: 'ventura86' },
            usgs: { state: 'pending', checkedAt: CHECKED, detail: 'apiError.usgs.accessPending', role: 'search', nextCheckAt: CHECKED },
            analytics: { state: 'ok', checkedAt: CHECKED, measurementId: 'G-ABC123' },
            crash: { state: 'ok', checkedAt: CHECKED, lastReportAt: CHECKED },
        });

        const state = applyStatusView(initialSetupState(createHarness().host, 'normal'), view, START);

        expect(['signIn', 'deploy', 'claim', 'billing', 'provision', 'mapbox'].map((id) => state.steps[id as 'signIn'].state)).toEqual(
            Array.from({ length: 6 }, () => 'ok'),
        );
        expect(state.steps.usgs.detail).toEqual({ key: 'apiError.usgs.accessPending' });
        expect(state.billing).toMatchObject({ budgetId: BUDGET, amount: 25, currency: 'RON' });
        expect(state.mapbox.user).toBe('ventura86');
        expect(state.usgs).toMatchObject({ role: 'search', nextCheckAt: CHECKED, tokenExpiresAt: null, expiresSoon: false });
        expect(state.analytics.measurementId).toBe('G-ABC123');
        expect(state.crashes.lastReportAt).toBe(CHECKED);
    });

    it('badPath_aRecordedItemKeepsTheReasonThePageKnowsForTheSameState', () => {
        const base = initialSetupState(createHarness().host, 'normal');
        const policy = { key: 'adminSetup.provision.orgPolicy', params: { constraint: 'storage.publicAccessPrevention' } } as const;
        const known = new Map<string, Partial<(typeof base.provision.items)[number]>>([
            ['buckets', { state: 'invalid', detail: policy }],
            ['secrets', { state: 'unavailable', detail: { key: 'apiError.unavailable' } }],
        ]);
        const shown = { ...base, provision: { items: base.provision.items.map((item) => ({ ...item, ...known.get(item.id) })) } };
        const view = statusView({
            provision: {
                state: 'invalid',
                checkedAt: CHECKED,
                items: [
                    { id: 'buckets', state: 'invalid' },
                    { id: 'secrets', state: 'ok' },
                ],
            },
        });

        const items = applyStatusView(shown, view, START).provision.items;

        expect(items.find((item) => item.id === 'buckets')).toEqual({ id: 'buckets', state: 'invalid', detail: policy });
        expect(items.find((item) => item.id === 'secrets')).toEqual({ id: 'secrets', state: 'ok', detail: null });
        expect(items.find((item) => item.id === 'apis')).toEqual({ id: 'apis', state: 'missing', detail: null });
    });

    it('badPath_anEmptyRecordKeepsTheDefaults', () => {
        const state = applyStatusView(initialSetupState(createHarness().host, 'normal'), statusView(), START);

        expect(state.steps.billing.state).toBe('missing');
        expect(state.billing).toMatchObject({ budgetId: null, amount: 5, currency: 'USD' });
        expect(state.mapbox.user).toBeNull();
        expect(state.usgs.role).toBeNull();
        expect(state.crashes.lastReportAt).toBeNull();
    });

    it('badPath_aUsgsTokenCloseToItsExpiryIsFlagged', () => {
        const soon = new Date(START + 10 * DAY).toISOString();
        const later = new Date(START + 30 * DAY).toISOString();
        const base = initialSetupState(createHarness().host, 'normal');

        expect(
            applyStatusView(base, statusView({ usgs: { state: 'ok', checkedAt: CHECKED, tokenExpiresAt: soon } }), START).usgs.expiresSoon,
        ).toBe(true);
        expect(
            applyStatusView(base, statusView({ usgs: { state: 'ok', checkedAt: CHECKED, tokenExpiresAt: later } }), START).usgs.expiresSoon,
        ).toBe(false);
    });
});

const RECORD: BootstrapRecord = {
    version: 1,
    projectId: PROJECT_ID,
    updatedAt: CHECKED,
    steps: {
        signIn: { state: 'ok', checkedAt: CHECKED },
        billing: { state: 'ok', checkedAt: CHECKED },
        provision: { state: 'invalid', checkedAt: CHECKED },
    },
    billing: { accountName: 'billingAccounts/AAAAAA-BBBBBB-CCCCCC', budgetId: BUDGET, budgetAmount: 25, currency: 'RON' },
    provision: {
        items: [
            { id: 'apis', state: 'ok' },
            { id: 'secrets', state: 'unavailable', detail: 'apiError.unavailable' },
            {
                id: 'buckets',
                state: 'invalid',
                detail: 'adminSetup.provision.orgPolicy',
                params: { constraint: 'storage.publicAccessPrevention' },
            },
            { id: 'iam', state: 'invalid', detail: 'apiError.cloud.permission', params: { role: 'roles/owner' } },
        ],
    },
    deploy: { ready: 4, total: 32, failed: ['admin-claim'] },
};

describe('applyBootstrapRecord', () => {
    it('happyPath_aReloadShowsWhatTheStepsFound', () => {
        const state = applyBootstrapRecord(initialSetupState(createHarness().host, 'bootstrap'), RECORD);

        expect([state.steps.signIn.state, state.steps.billing.state, state.steps.provision.state, state.steps.deploy.state]).toEqual([
            'ok',
            'ok',
            'invalid',
            'missing',
        ]);
        expect(state.billing).toMatchObject({ accountName: RECORD.billing?.accountName, budgetId: BUDGET, amount: 25, currency: 'RON' });
        expect(state.provision.items.find((item) => item.id === 'buckets')?.detail).toEqual({
            key: 'adminSetup.provision.orgPolicy',
            params: { constraint: 'storage.publicAccessPrevention' },
        });
        expect(state.deploy).toMatchObject({ ready: 4, total: 32, failed: ['admin-claim'] });
    });

    it('badPath_aRecordWithStepsOnlyKeepsTheDefaultSlices', () => {
        const state = applyBootstrapRecord(initialSetupState(createHarness().host, 'bootstrap'), {
            version: 1,
            projectId: PROJECT_ID,
            updatedAt: CHECKED,
            steps: {},
        });

        expect(state.billing).toMatchObject({ accountName: null, budgetId: null, amount: 5 });
        expect(state.deploy).toMatchObject({ ready: 0, failed: [] });
    });

    it('badPath_aPartialBillingRecordKeepsTheDefaultAmount', () => {
        const state = applyBootstrapRecord(initialSetupState(createHarness().host, 'bootstrap'), {
            ...RECORD,
            billing: { accountName: 'billingAccounts/AAAAAA-BBBBBB-CCCCCC' },
            deploy: { ready: 1, total: 32 },
        });

        expect(state.billing).toMatchObject({ budgetId: null, amount: 5, currency: 'USD' });
        expect(state.deploy.failed).toEqual([]);
    });

    it('badPath_aBudgetWithoutItsAccountKeepsNoAccount', () => {
        const state = applyBootstrapRecord(initialSetupState(createHarness().host, 'bootstrap'), {
            ...RECORD,
            billing: { budgetId: BUDGET },
        });

        expect(state.billing).toMatchObject({ accountName: null, budgetId: BUDGET });
    });
});

describe('bootstrapRecordOf', () => {
    it('happyPath_keepsTheCheckedStepsAndTheirRecordableReasons', () => {
        let state = applyBootstrapRecord(initialSetupState(createHarness().host, 'bootstrap'), RECORD);
        state = withStep(state, 'deploy', {
            state: 'pending',
            checkedAt: CHECKED,
            detail: { key: 'adminSetup.deploy.progress', params: { ready: '4', total: '32' } },
        });
        state = withStep(state, 'billing', { detail: { key: 'adminSetup.title' } });

        const record = bootstrapRecordOf(state, CHECKED);

        expect(isBootstrapRecord(record)).toBe(true);
        expect(Object.keys(record.steps)).toEqual(['signIn', 'billing', 'provision', 'deploy']);
        expect(record.steps.billing).toEqual({ state: 'ok', checkedAt: CHECKED });
        expect(record.steps.deploy?.detail).toBe('adminSetup.deploy.progress');
        expect(record.billing).toEqual(RECORD.billing);
        expect(record.provision?.items).toHaveLength(4);
    });

    it('badPath_nothingCheckedIsAnEmptyRecord', () => {
        const record = bootstrapRecordOf(initialSetupState(createHarness().host, 'bootstrap'), CHECKED);

        expect(record).toMatchObject({ steps: {}, billing: {}, provision: { items: [] } });
        expect(isBootstrapRecord(record)).toBe(true);
    });
});

describe('recordCloudRequestOf', () => {
    it('happyPath_aBootstrapThatBroughtEveryChangedItemToOkRecordsTheSetVersion @S-A04-HAPPY-UPDATE-PROVISION', () => {
        // Finding 65 of 2026-11-02: a project prepared by this admin from the start is at the current item set.
        const items = PROVISION_ITEMS.map((id) => ({ id, state: 'ok' as const }));

        expect(recordCloudRequestOf({ ...RECORD, provision: { items } })?.provision).toMatchObject({ setVersion: PROVISION_SET_VERSION });
        expect(
            applyStatusView(
                initialSetupState(createHarness().host, 'normal'),
                statusView({ provision: { state: 'ok', checkedAt: null, items: provisionedItems(), setVersion: 2 } }),
                START,
            ).provision.setVersion,
        ).toBe(2);
    });

    it('happyPath_billingWithItsBudgetAndTheItemsWithTheirApiReasons', () => {
        expect(recordCloudRequestOf(RECORD)).toEqual({
            billing: { state: 'ok', budgetId: BUDGET, budgetAmount: 25, currency: 'RON' },
            provision: {
                items: [
                    { id: 'apis', state: 'ok' },
                    { id: 'secrets', state: 'unavailable', detail: 'apiError.unavailable' },
                    { id: 'buckets', state: 'invalid' },
                    { id: 'iam', state: 'invalid', detail: 'apiError.cloud.permission', params: { role: 'roles/owner' } },
                ],
            },
        });
    });

    it('badPath_aBillingFailureIsRecordedWithoutABudget', () => {
        const request = recordCloudRequestOf({
            ...RECORD,
            steps: {
                billing: {
                    state: 'invalid',
                    checkedAt: CHECKED,
                    detail: 'apiError.cloud.permission',
                    params: { role: 'roles/billing.user' },
                },
            },
            billing: { accountName: 'billingAccounts/AAAAAA-BBBBBB-CCCCCC' },
            provision: { items: [] },
        });

        expect(request).toEqual({
            billing: { state: 'invalid', detail: 'apiError.cloud.permission', params: { role: 'roles/billing.user' } },
        });
    });

    it('badPath_aBudgetWithoutItsAmountIsRecordedById', () => {
        const request = recordCloudRequestOf({ ...RECORD, billing: { budgetId: BUDGET }, provision: { items: [] } });

        expect(request?.billing).toEqual({ state: 'ok', budgetId: BUDGET });
    });

    it('badPath_aBillingStepWithoutItsAccountRecordIsRecordedWithoutABudget', () => {
        const request = recordCloudRequestOf({
            version: 1,
            projectId: PROJECT_ID,
            updatedAt: CHECKED,
            steps: { billing: { state: 'missing', checkedAt: CHECKED } },
        });

        expect(request).toEqual({ billing: { state: 'missing' } });
    });

    it('badPath_nothingToRecordIsNull', () => {
        expect(
            recordCloudRequestOf({
                version: 1,
                projectId: PROJECT_ID,
                updatedAt: CHECKED,
                steps: { signIn: { state: 'ok', checkedAt: CHECKED } },
            }),
        ).toBeNull();
    });
});
