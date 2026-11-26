/**
 * The Setup Assistant's M6 setup-ux behaviours (`docs/research/M6-interfaces.md` §3.1, §4.1; findings 3, 7, 16, 18,
 * 19 and 24 of the live test of 2026-10-25): the billing card's wait with its last check and the likely free trial, Do
 * it later on USGS and what "done" then means, the import's snackbar, and the live scopes behind the consent note.
 */
import { SITE_PUBLISH_TRANSFER_MB, SITE_PUBLISH_TRANSFER_TRIMMED_MB, type SetupStatusView } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { createBillingFlow } from '../../src/setup/billing.js';
import { readBootstrapRecord, type BootstrapRecord } from '../../src/setup/bootstrap-record.js';
import { createSetupContext, createSetupStore } from '../../src/setup/context.js';
import { createLegacyImportFlow } from '../../src/setup/legacy-import.js';
import type { BillingAccount } from '../../src/setup/ports.js';
import { applyBootstrapRecord, applyStatusView, recordCloudRequestOf } from '../../src/setup/records.js';
import { initialSetupState, withStep, type SetupState } from '../../src/setup/state.js';
import { createUsgsFlow } from '../../src/setup/usgs.js';
import { START, createHarness, functionsError, provisionedItems, statusView, type Harness } from './harness.js';

const USD: BillingAccount = { name: 'billingAccounts/AAAAAA-BBBBBB-CCCCCC', displayName: 'Card', currency: 'USD' };
const BUDGET = 'billingAccounts/AAAAAA-BBBBBB-CCCCCC/budgets/b-1';
const NOW_ISO = new Date(START).toISOString();
const OK = { state: 'ok', checkedAt: NOW_ISO } as const;
const EMPTY_RECORD: BootstrapRecord = { version: 1, projectId: 'demo-hcm', updatedAt: NOW_ISO, steps: {} };

function context(harness: Harness, state: SetupState) {
    return createSetupContext(harness.deps, createSetupStore(state));
}

function billingSetup(mode: 'bootstrap' | 'normal' = 'bootstrap') {
    const harness = createHarness();
    const base = withStep(initialSetupState(harness.host, mode), 'signIn', { state: 'ok' });
    const ctx = context(harness, { ...base, openStep: 'billing' });
    ctx.mirrorBootstrap();
    return { harness, ctx, flow: createBillingFlow(ctx) };
}

/** Normal mode with everything but USGS done, the USGS card open. */
function normalSetup(usgs: SetupStatusView['usgs'] = { state: 'missing', checkedAt: null }) {
    const harness = createHarness();
    const view = statusView({
        billing: OK,
        provision: { ...OK, items: provisionedItems() },
        mapbox: OK,
        usgs,
    });
    const ctx = context(harness, { ...applyStatusView(initialSetupState(harness.host, 'normal'), view, START), openStep: 'usgs' });
    return { harness, ctx };
}

describe('billing: the wait, said in words (finding 3)', () => {
    it('happyPath_eachLookAtTheAccountsIsTheLastCheckAndANewAccountIsALikelyTrial', async () => {
        const { harness, ctx, flow } = billingSetup();
        harness.cloud.observeBilling.mockResolvedValueOnce({ linkedAccount: null, accounts: [] });
        harness.cloud.observeBilling.mockResolvedValueOnce({ linkedAccount: null, accounts: [] });
        harness.cloud.observeBilling.mockResolvedValueOnce({ linkedAccount: null, accounts: [USD] });

        await flow.link();
        expect(ctx.state().billing).toMatchObject({ waitingForAccount: true, trialSince: null });
        await harness.clock.advance(10_000);
        expect(ctx.state().steps.billing.checkedAt).toBe(new Date(START + 10_000).toISOString());

        await harness.clock.advance(10_000);

        expect(ctx.state().steps.billing.state).toBe('ok');
        expect(ctx.state().billing.trialSince).toBe(new Date(START + 20_000).toISOString());
        expect(ctx.state().billing.createUrl).toBe('https://console.cloud.google.com/billing/create');
        // The bootstrap record keeps it for the claim, which records it with the billing.
        const since = new Date(START + 20_000).toISOString();
        const record = readBootstrapRecord(harness.session, harness.host.projectId) ?? EMPTY_RECORD;
        expect(record.billing?.trialSince).toBe(since);
        expect(recordCloudRequestOf(record)).toMatchObject({ trial: { since } });
        expect(applyBootstrapRecord(initialSetupState(harness.host, 'bootstrap'), record).billing.trialSince).toBe(since);
        expect(recordCloudRequestOf(EMPTY_RECORD)).toBeNull();
    });

    it('happyPath_normalModeRecordsTheTrialWithTheBilling', async () => {
        const { harness, flow } = billingSetup('normal');
        harness.cloud.observeBilling.mockResolvedValueOnce({ linkedAccount: null, accounts: [] });
        harness.cloud.observeBilling.mockResolvedValueOnce({ linkedAccount: null, accounts: [USD] });
        harness.backend.recordCloud.mockResolvedValue({ status: statusView({ billing: { ...OK, budgetId: BUDGET } }) });

        await flow.link();
        await harness.clock.advance(10_000);

        expect(harness.backend.recordCloud).toHaveBeenCalledWith({
            billing: { state: 'ok', budgetId: BUDGET, budgetAmount: 5, currency: 'USD' },
            trial: { since: new Date(START + 10_000).toISOString() },
        });
    });

    it('badPath_anAccountListedAtTheFirstLookIsNoTrial', async () => {
        const { harness, ctx, flow } = billingSetup();
        harness.cloud.observeBilling.mockResolvedValue({ linkedAccount: null, accounts: [USD] });

        await flow.link();

        expect(ctx.state().steps.billing.state).toBe('ok');
        expect(ctx.state().billing.trialSince).toBeNull();
        expect(readBootstrapRecord(harness.session, harness.host.projectId)?.billing).not.toHaveProperty('trialSince');
    });

    it('badPath_aTrialTheOwnerCalledPaidIsNoLongerShown', () => {
        const harness = createHarness();
        const view = statusView({ billing: { ...OK, trialSince: NOW_ISO, trialPaidAt: NOW_ISO } });

        expect(applyStatusView(initialSetupState(harness.host, 'normal'), view, START).billing.trialSince).toBeNull();
        expect(
            applyStatusView(initialSetupState(harness.host, 'normal'), statusView({ billing: { ...OK, trialSince: NOW_ISO } }), START),
        ).toMatchObject({ billing: { trialSince: NOW_ISO } });
    });
});

describe('USGS: Do it later (A59)', () => {
    it('happyPath_oneInputPostponesUsgsSetupIsDoneAndTheNextStepOpens', async () => {
        const { harness, ctx } = normalSetup();
        const flow = createUsgsFlow(ctx);
        expect(ctx.state()).toMatchObject({ ready: false, later: 0, doneNote: null });
        harness.backend.recordCloud.mockResolvedValue({
            status: statusView({
                billing: OK,
                provision: { ...OK, items: provisionedItems() },
                mapbox: OK,
                usgs: { state: 'missing', checkedAt: null, postponedAt: NOW_ISO },
            }),
        });

        await flow.postpone();

        expect(harness.backend.recordCloud).toHaveBeenCalledWith({ postponed: { usgs: true } });
        expect(ctx.state().steps.usgs).toMatchObject({ state: 'missing', postponed: true, busy: false, used: { inputs: 1 } });
        expect(ctx.state()).toMatchObject({ ready: true, later: 1, doneNote: 'usgsLater' });
        // The next step not done opens (USGS waits: it is settled for the step order, CR-M6-4).
        const next = ctx.state().openStep ?? 'usgs';
        expect(next).not.toBe('usgs');
        expect(ctx.state().steps[next].state).not.toBe('ok');
        expect(ctx.state().usgs.postponedAt).toBe(NOW_ISO);
    });

    it('happyPath_aTokenWaitingForApprovalIsDoneWithTheApprovalPending', () => {
        const { ctx } = normalSetup({
            state: 'pending',
            checkedAt: NOW_ISO,
            detail: 'apiError.usgs.accessPending',
            pendingSince: NOW_ISO,
        });

        expect(ctx.state()).toMatchObject({ ready: true, later: 0, doneNote: 'usgsPending' });
        expect(ctx.state().usgs.pendingSince).toBe(NOW_ISO);
    });

    it('happyPath_postponedFromAnotherCardLeavesThatCardOpen', async () => {
        const { harness, ctx } = normalSetup();
        ctx.update((state) => ({ ...state, openStep: 'analytics' }));
        harness.backend.recordCloud.mockResolvedValue({
            status: statusView({ usgs: { state: 'missing', checkedAt: null, postponedAt: NOW_ISO } }),
        });

        await createUsgsFlow(ctx).postpone();

        expect(ctx.state().openStep).toBe('analytics');
        expect(ctx.state().steps.usgs.postponed).toBe(true);
    });

    it('badPath_aRefusedRecordLeavesTheStepToDoWithTheReason', async () => {
        const { harness, ctx } = normalSetup();
        harness.backend.recordCloud.mockRejectedValue(functionsError('apiError.unavailable'));

        await createUsgsFlow(ctx).postpone();

        expect(ctx.state().steps.usgs).toMatchObject({ postponed: false, busy: false, error: { key: 'apiError.unavailable' } });
        expect(ctx.state()).toMatchObject({ ready: false, openStep: 'usgs' });
    });

    it('badPath_aRefusedTokenIsNotDoneUnlessPostponed', () => {
        const { ctx } = normalSetup({ state: 'invalid', checkedAt: NOW_ISO, detail: 'apiError.usgs.credentials' });

        expect(ctx.state()).toMatchObject({ ready: false, doneNote: null });
    });
});

describe('the import says how it ended (finding 19)', () => {
    it('happyPath_everyPhotoOnTheMapIsSaidInTheSnackbar', async () => {
        const harness = createHarness();
        const ctx = context(harness, initialSetupState(harness.host, 'normal'));

        await createLegacyImportFlow(ctx).run();

        expect(harness.notify).toHaveBeenCalledWith({ key: 'adminSetup.import.allOnMap', params: { count: '45' } });
        // §73k: with every old photo imported a publish leaves the originals out; the site card says the smaller transfer.
        expect(ctx.state().install.siteTransferMegabytes).toBe(SITE_PUBLISH_TRANSFER_TRIMMED_MB);
    });

    it('badPath_failuresSayHowManyAreOnTheMapAndOpenTheCard', async () => {
        const harness = createHarness();
        harness.importer.run.mockResolvedValue({
            done: 43,
            total: 45,
            failed: [
                { id: 'a', detail: 'apiError.photo.unreadable' },
                { id: 'b', detail: 'apiError.photo.unreadable' },
            ],
        });
        const ctx = context(harness, { ...initialSetupState(harness.host, 'normal'), openStep: 'analytics' });

        await createLegacyImportFlow(ctx).run();

        const [notice] = harness.notify.mock.calls.at(-1) ?? [];
        expect(notice).toMatchObject({ key: 'adminSetup.import.someOnMap', params: { done: '43', total: '45' } });
        expect(notice?.action?.key).toBe('adminSetup.import.open');
        notice?.action?.run();
        expect(ctx.state().openStep).toBe('legacyImport');
        expect(ctx.state().install.siteTransferMegabytes).toBe(SITE_PUBLISH_TRANSFER_MB);
    });
});

describe('the scopes a live token holds (finding 7)', () => {
    it('happyPath_aGrantedTokenIsLiveWithEveryScopeItSatisfies', () => {
        const harness = createHarness();
        const ctx = context(harness, initialSetupState(harness.host, 'bootstrap'));
        harness.google.grant('cloudPlatform');

        ctx.patchStep('provision', { state: 'ok' });

        expect(ctx.state().liveScopes).toEqual(['cloudReadOnly', 'cloudBilling', 'cloudPlatform']);
    });

    it('badPath_aTokenAboutToExpireOrDroppedIsNotLive', async () => {
        const harness = createHarness();
        const ctx = context(harness, initialSetupState(harness.host, 'bootstrap'));
        harness.google.grant('cloudPlatform');
        ctx.patchStep('provision', { state: 'ok' });

        await harness.clock.advance(56 * 60_000);
        ctx.patchStep('deploy', { busy: true });
        expect(ctx.state().liveScopes).toEqual([]);

        harness.google.grant('analyticsEdit');
        ctx.patchStep('deploy', { busy: false });
        harness.google.drop();
        ctx.patchStep('deploy', { busy: true });
        expect(ctx.state().liveScopes).toEqual([]);
    });
});
