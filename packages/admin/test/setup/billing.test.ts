import { describe, expect, it } from 'vitest';

import { BILLING_APIS, createBillingFlow } from '../../src/setup/billing.js';
import { createSetupContext, createSetupStore } from '../../src/setup/context.js';
import type { BillingAccount } from '../../src/setup/ports.js';
import { initialSetupState, withStep } from '../../src/setup/state.js';
import { createHarness, flush, functionsError, googleError, statusView } from './harness.js';

const USD: BillingAccount = { name: 'billingAccounts/AAAAAA-BBBBBB-CCCCCC', displayName: 'Card', currency: 'USD' };
const RON: BillingAccount = { name: 'billingAccounts/DDDDDD-EEEEEE-FFFFFF', displayName: 'Firma', currency: 'RON' };
const BUDGET = 'billingAccounts/AAAAAA-BBBBBB-CCCCCC/budgets/b-1';

function setup(mode: 'bootstrap' | 'normal' = 'bootstrap') {
    const harness = createHarness();
    const base = withStep(initialSetupState(harness.host, mode), 'signIn', { state: 'ok' });
    const ctx = createSetupContext(harness.deps, createSetupStore({ ...base, openStep: 'billing' }));
    return { harness, ctx, flow: createBillingFlow(ctx) };
}

describe('billing: one account', () => {
    it('happyPath_oneClickOneConsentLinksTheAccountAndCreatesTheBudget', async () => {
        const { harness, ctx, flow } = setup();
        harness.cloud.observeBilling.mockResolvedValue({ linkedAccount: null, accounts: [RON] });

        await flow.link();

        expect(harness.google.requests).toEqual(['cloudBilling']);
        expect(harness.cloud.linkBilling).toHaveBeenCalledWith(harness.google.current, RON.name);
        expect(harness.cloud.ensureBudget).toHaveBeenCalledWith(harness.google.current, {
            accountName: RON.name,
            amount: 25,
            currency: 'RON',
        });
        expect(ctx.state().steps.billing).toMatchObject({ state: 'ok', busy: false, used: { inputs: 1, consents: 1 } });
        expect(ctx.state().billing).toMatchObject({ accountName: RON.name, budgetId: BUDGET, amount: 25, currency: 'RON' });
        expect(ctx.state().openStep).toBe('provision');
        expect(harness.backend.recordCloud).not.toHaveBeenCalled();
    });

    it('happyPath_anAlreadyLinkedProjectOnlyGetsItsBudget', async () => {
        const { harness, ctx, flow } = setup();
        harness.cloud.observeBilling.mockResolvedValue({ linkedAccount: USD.name, accounts: [USD, RON] });

        await flow.link();

        expect(harness.cloud.linkBilling).not.toHaveBeenCalled();
        expect(harness.cloud.ensureBudget).toHaveBeenCalledWith(harness.google.current, {
            accountName: USD.name,
            amount: 5,
            currency: 'USD',
        });
        expect(ctx.state().steps.billing.state).toBe('ok');
    });

    it('badPath_aLinkedAccountThatIsNotListedGetsTheDollarBudget', async () => {
        const { harness, flow } = setup();
        harness.cloud.observeBilling.mockResolvedValue({ linkedAccount: USD.name, accounts: [] });

        await flow.link();

        expect(harness.cloud.ensureBudget).toHaveBeenCalledWith(harness.google.current, {
            accountName: USD.name,
            amount: 5,
            currency: 'USD',
        });
    });

    it('happyPath_normalModeRecordsTheResultAtOnce', async () => {
        const { harness, ctx, flow } = setup('normal');
        harness.cloud.observeBilling.mockResolvedValue({ linkedAccount: null, accounts: [USD] });
        harness.backend.recordCloud.mockResolvedValue({
            status: statusView({ billing: { state: 'ok', checkedAt: null, budgetId: BUDGET } }),
        });

        await flow.link();

        expect(harness.google.requests).toEqual(['cloudPlatform']);
        expect(harness.backend.recordCloud).toHaveBeenCalledWith({
            billing: { state: 'ok', budgetId: BUDGET, budgetAmount: 5, currency: 'USD' },
        });
        expect(ctx.state().steps.billing.state).toBe('ok');
    });

    it('badPath_aRecordThatFailsIsShown', async () => {
        const { harness, ctx, flow } = setup('normal');
        harness.cloud.observeBilling.mockResolvedValue({ linkedAccount: null, accounts: [USD] });
        harness.backend.recordCloud.mockRejectedValue(functionsError('apiError.unavailable'));

        await flow.link();

        expect(ctx.state().steps.billing.error).toEqual({ key: 'apiError.unavailable' });
    });

    it('badPath_aClosedPopupCallsNothing', async () => {
        const { harness, ctx, flow } = setup();
        harness.google.answer = () => Promise.resolve(null);

        await flow.link();

        expect(harness.cloud.observeBilling).not.toHaveBeenCalled();
        expect(ctx.state().steps.billing).toMatchObject({ state: 'missing', busy: false, error: { key: 'adminShell.oauth.popupClosed' } });
    });
});

describe('billing: refusals', () => {
    it('badPath_anAccountAtItsProjectQuotaIsExplainedAndNothingChanges', async () => {
        const { harness, ctx, flow } = setup();
        harness.cloud.observeBilling.mockResolvedValue({ linkedAccount: null, accounts: [USD] });
        harness.cloud.linkBilling.mockRejectedValue(googleError('invalid'));

        await flow.link();

        expect(ctx.state().steps.billing).toMatchObject({ state: 'missing', error: { key: 'adminSetup.billing.quota' } });
        expect(harness.cloud.ensureBudget).not.toHaveBeenCalled();
    });

    it('badPath_aMissingBillingRoleNamesIt', async () => {
        const { harness, ctx, flow } = setup();
        harness.cloud.observeBilling.mockResolvedValue({ linkedAccount: null, accounts: [USD] });
        harness.cloud.linkBilling.mockRejectedValue(googleError('forbidden'));

        await flow.link();

        expect(ctx.state().steps.billing.error).toEqual({ key: 'apiError.cloud.permission', params: { role: 'roles/billing.user' } });
    });

    it('badPath_aRefusedBudgetLeavesBillingLinkedAndRetryCreatesOnlyTheBudget', async () => {
        const { harness, ctx, flow } = setup();
        harness.cloud.observeBilling.mockResolvedValueOnce({ linkedAccount: null, accounts: [USD] });
        harness.cloud.ensureBudget.mockRejectedValueOnce(googleError('forbidden', { role: 'roles/billing.admin' }));

        await flow.link();
        const message = { key: 'apiError.cloud.permission', params: { role: 'roles/billing.costsManager' } };
        expect(ctx.state().steps.billing).toMatchObject({ state: 'invalid', detail: message, error: message });

        harness.cloud.observeBilling.mockResolvedValueOnce({ linkedAccount: USD.name, accounts: [USD] });
        await flow.link();

        expect(harness.cloud.linkBilling).toHaveBeenCalledTimes(1);
        expect(ctx.state().steps.billing).toMatchObject({ state: 'ok', error: null, used: { inputs: 2, consents: 1 } });
    });

    it('badPath_aFailedLookupIsShown', async () => {
        const { harness, ctx, flow } = setup();
        harness.cloud.observeBilling.mockRejectedValue(googleError('forbidden', { api: 'cloudbilling.googleapis.com' }));

        await flow.link();

        expect(ctx.state().steps.billing.error).toEqual({
            key: 'apiError.cloud.apiDisabled',
            params: { api: 'cloudbilling.googleapis.com' },
        });
    });

    it('badPath_aServerErrorDuringTheLookupKeepsItsOwnMessage', async () => {
        const { harness, ctx, flow } = setup();
        harness.cloud.observeBilling.mockRejectedValue(googleError('unavailable'));

        await flow.link();

        expect(ctx.state().steps.billing.error).toEqual({ key: 'apiError.unavailable' });
    });
});

describe('billing: several accounts', () => {
    it('badPath_severalAccountsAreAChoiceWithTheFirstPreselected', async () => {
        const { harness, ctx, flow } = setup();
        harness.cloud.observeBilling.mockResolvedValue({ linkedAccount: null, accounts: [USD, RON] });

        await flow.link();
        expect(ctx.state().billing).toMatchObject({ accounts: [USD, RON], chosen: USD.name });
        expect(ctx.state().steps.billing.detail).toEqual({ key: 'adminSetup.billing.chooseAccount' });
        expect(harness.cloud.linkBilling).not.toHaveBeenCalled();

        await flow.confirm();

        expect(harness.cloud.linkBilling).toHaveBeenCalledWith(harness.google.current, USD.name);
        expect(ctx.state().billing).toMatchObject({ accounts: [], chosen: null, accountName: USD.name });
        expect(ctx.state().steps.billing.used).toEqual({ inputs: 2, consents: 1 });
    });

    it('badPath_anotherChoiceIsLinkedInstead', async () => {
        const { harness, ctx, flow } = setup();
        harness.cloud.observeBilling.mockResolvedValue({ linkedAccount: null, accounts: [USD, RON] });

        await flow.link();
        flow.choose(RON.name);
        await flow.confirm();

        expect(harness.cloud.linkBilling).toHaveBeenCalledWith(harness.google.current, RON.name);
        expect(ctx.state().steps.billing.used.inputs).toBe(3);
    });

    it('badPath_confirmingWithoutAChoiceLinksNothing', async () => {
        const { harness, flow } = setup();

        await flow.confirm();

        expect(harness.cloud.linkBilling).not.toHaveBeenCalled();
    });
});

describe('billing: no account yet', () => {
    it('badPath_theCardWaitsForTheNewAccountAndLinksItByItself', async () => {
        const { harness, ctx, flow } = setup();
        harness.cloud.observeBilling.mockResolvedValueOnce({ linkedAccount: null, accounts: [] });
        harness.cloud.observeBilling.mockResolvedValueOnce({ linkedAccount: null, accounts: [] });
        harness.cloud.observeBilling.mockResolvedValueOnce({ linkedAccount: null, accounts: [USD] });

        await flow.link();
        expect(ctx.state().billing.waitingForAccount).toBe(true);
        expect(ctx.state().steps.billing.detail).toEqual({ key: 'adminSetup.billing.noAccount' });

        await harness.clock.advance(20_000);

        expect(harness.cloud.observeBilling).toHaveBeenCalledTimes(3);
        expect(ctx.state().billing.waitingForAccount).toBe(false);
        expect(ctx.state().steps.billing.state).toBe('ok');
        expect(harness.google.requests).toEqual(['cloudBilling']);
        expect(ctx.state().steps.billing.used.inputs).toBe(1);
    });

    it('badPath_thirtyMinutesWithoutAnAccountAskToCheckAgain', async () => {
        const { harness, ctx, flow } = setup();

        await flow.link();
        await harness.clock.advance(31 * 60_000);

        expect(ctx.state().billing.waitingForAccount).toBe(false);
        expect(ctx.state().steps.billing.detail).toEqual({ key: 'adminSetup.billing.waitTimeout' });
        flow.dispose();
    });

    it('badPath_aTokenThatExpiresWhileWaitingStopsTheWaitWithContinue', async () => {
        const { harness, ctx, flow } = setup();

        await flow.link();
        harness.google.drop();
        await harness.clock.advance(10_000);

        expect(ctx.state().billing.waitingForAccount).toBe(false);
        expect(ctx.state().steps.billing.needsContinue).toBe(true);
        expect(harness.clock.pending()).toBe(0);
    });
});

describe('billing: disabled APIs', () => {
    it('happyPath_disabledBillingApisAskTheBroaderScopeAndAreEnabledFirst', async () => {
        const { harness, ctx, flow } = setup();
        harness.google.grant('cloudReadOnly');
        harness.cloud.disabledApis.mockResolvedValue(['billingbudgets.googleapis.com']);
        harness.cloud.observeBilling.mockResolvedValue({ linkedAccount: null, accounts: [USD] });

        await flow.detectApis();
        expect(ctx.state().steps.billing.scope).toBe('cloudPlatform');
        await flow.link();

        expect(harness.google.requests).toEqual(['cloudPlatform']);
        expect(harness.cloud.enableApis).toHaveBeenCalledWith(harness.google.current, BILLING_APIS);
        expect(ctx.state().billing.needsPlatform).toBe(false);
        expect(ctx.state().steps.billing.state).toBe('ok');
    });

    it('badPath_anApiThatCannotBeEnabledStopsTheStep', async () => {
        const { harness, ctx, flow } = setup();
        harness.google.grant('cloudReadOnly');
        harness.cloud.disabledApis.mockResolvedValue(['cloudbilling.googleapis.com']);
        harness.cloud.enableApis.mockRejectedValue(googleError('forbidden', { role: 'roles/serviceusage.serviceUsageAdmin' }));

        await flow.detectApis();
        await flow.link();

        expect(harness.cloud.observeBilling).not.toHaveBeenCalled();
        expect(ctx.state().billing.needsPlatform).toBe(true);
        expect(ctx.state().steps.billing.error).toEqual({
            key: 'apiError.cloud.permission',
            params: { role: 'roles/serviceusage.serviceUsageAdmin' },
        });
    });

    it('happyPath_enabledApisKeepTheBillingScope', async () => {
        const { harness, ctx, flow } = setup();
        harness.google.grant('cloudReadOnly');

        const detecting = flow.detectApis();
        expect(ctx.state().steps.billing.busy).toBe(true);
        await detecting;

        expect(ctx.state().steps.billing.scope).toBe('cloudBilling');
        expect(ctx.state().steps.billing.busy).toBe(false);
    });

    it('badPath_withoutATokenOrWithAFailureTheScopeStaysAndAWarningIsLogged', async () => {
        const { harness, ctx, flow } = setup();

        await flow.detectApis();
        expect(harness.cloud.disabledApis).not.toHaveBeenCalled();

        harness.google.grant('cloudReadOnly');
        harness.cloud.disabledApis.mockRejectedValue(googleError('unavailable'));
        await flow.detectApis();
        await flush();

        expect(ctx.state().billing.needsPlatform).toBe(false);
        expect(ctx.state().steps.billing.busy).toBe(false);
        expect(harness.logs.records.at(-1)).toMatchObject({ level: 'warn', message: 'billing APIs not checked' });
    });
});

describe('billing: This account is a free trial (finding 6 of the M6 review)', () => {
    it('happyPath_inAnAdminSessionTheTrialIsRecordedFromTodayWithOneInput', async () => {
        const { harness, ctx, flow } = setup('normal');
        const since = new Date(harness.clock.now()).toISOString();
        harness.backend.recordCloud.mockResolvedValue({
            status: statusView({ billing: { state: 'ok', checkedAt: null, budgetId: BUDGET, trialSince: since } }),
        });

        await flow.markTrial();

        expect(harness.backend.recordCloud).toHaveBeenCalledWith({ trial: { since } });
        expect(ctx.state().billing.trialSince).toBe(since);
        expect(ctx.state().steps.billing.used).toEqual({ inputs: 1, consents: 0 });
        expect(harness.google.requests).toEqual([]);
    });

    it('happyPath_inStartUpModeItWaitsInTheBootstrapRecordForTheClaim', async () => {
        const { harness, ctx, flow } = setup('bootstrap');

        await flow.markTrial();

        expect(ctx.state().billing.trialSince).toBe(new Date(harness.clock.now()).toISOString());
        expect(harness.backend.recordCloud).not.toHaveBeenCalled();
    });

    it('badPath_aKnownTrialKeepsItsDay_andARecordThatFailsIsShown', async () => {
        const { harness, ctx, flow } = setup('normal');
        ctx.update((state) => ({ ...state, billing: { ...state.billing, trialSince: '2026-10-01T09:00:00.000Z' } }));
        harness.backend.recordCloud.mockRejectedValue(functionsError('apiError.unavailable'));

        await flow.markTrial();

        expect(harness.backend.recordCloud).toHaveBeenCalledWith({ trial: { since: '2026-10-01T09:00:00.000Z' } });
        expect(ctx.state().steps.billing.error).toEqual({ key: 'apiError.unavailable' });
    });
});
