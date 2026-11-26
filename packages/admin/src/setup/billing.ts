/**
 * Step (b), billing and the budget (`docs/research/M2b-interfaces.md` §3.3 b): one click and one consent link the
 * project to an open billing account (the Blaze plan) and create the monthly budget in the account's currency. With
 * no open account the card offers Google's page that creates one and lists the accounts every 10 s for 30 minutes (the
 * click that started the step named the action, so the link proceeds by itself), saying when it last looked (M6,
 * finding 3); several accounts are a choice with the first preselected (one more input). An account that appears while
 * the card waits is a new one, which Google opens as a free trial for a new customer: it is remembered as a likely trial
 * from that day (M6, A60; no Google API says so, `DECISIONS-for-review.md` §67f). Retry after a refusal repeats only what
 * is missing. In normal mode the result is recorded at once with `setup.recordCloud`.
 */
import { budgetAmountFor } from './budget.js';
import type { SetupContext } from './context.js';
import { googleAccess, liveAccess } from './google-access.js';
import { apiFailure, googleFailure, setupMessage, type SetupMessageKey, type StepFailure } from './messages.js';
import { createPoller, type PollOutcome, type Poller } from './poll.js';
import type { BillingAccount, BillingObservation, GoogleAccess } from './ports.js';

/** Both can be enabled on Spark; when either is off, the popup asks `cloudPlatform` and enables them first. */
export const BILLING_APIS = ['cloudbilling.googleapis.com', 'billingbudgets.googleapis.com'] as const;

const NEW_ACCOUNT_POLL = { intervalMs: 10_000, stopAfterMs: 30 * 60_000 };

export interface BillingFlow {
    /** With the sign-in's read-only token: are the billing APIs enabled? (decides the scope of the popup) */
    detectApis(): Promise<void>;
    /** "Link billing and create the budget", Retry and Check again: one click, one consent. */
    link(): Promise<void>;
    choose(accountName: string): void;
    /** Links the chosen account (several were open). */
    confirm(): Promise<void>;
    /**
     * "This account is a free trial": one click, no consent. The owner says what the card could not infer (an account that
     * existed before Setup, finding 18 of 2026-10-25 and finding 6 of the M6 review): a trial from today, whose end Home
     * announces (A60).
     */
    markTrial(): Promise<void>;
    dispose(): void;
}

/** The role Google wants at each phase when it answers 403 (S-A04-BAD-API-PERMISSION, S-A04-BAD-BUDGET-PERMISSION). */
const PHASE_ROLES = {
    enable: 'roles/serviceusage.serviceUsageAdmin',
    observe: 'roles/billing.viewer',
    link: 'roles/billing.user',
    budget: 'roles/billing.costsManager',
} as const;

type Phase = keyof typeof PHASE_ROLES;

function phaseFailure(error: unknown, phase: Phase): StepFailure {
    const failure = googleFailure(error);
    if (phase === 'link' && failure.message.key === 'adminSetup.error.googleRefused') {
        return { ...failure, message: setupMessage('adminSetup.billing.quota') };
    }
    const permission = failure.message.key === 'apiError.cloud.permission';
    return permission ? { ...failure, message: setupMessage('apiError.cloud.permission', { role: PHASE_ROLES[phase] }) } : failure;
}

function linkedAccount(observed: BillingObservation, name: string): BillingAccount {
    const open = observed.accounts.find((account) => account.name === name);
    return { name, displayName: '', currency: open?.currency ?? 'USD' };
}

class Billing implements BillingFlow {
    private readonly poller: Poller;

    constructor(private readonly ctx: SetupContext) {
        this.poller = createPoller(
            ctx.deps,
            NEW_ACCOUNT_POLL,
            () => this.pollAccounts(),
            () => {
                this.waitExpired();
            },
        );
    }

    /** The card's button waits (busy) meanwhile: a click before the answer would ask Google for the wrong scope. */
    async detectApis(): Promise<void> {
        const access = liveAccess(this.ctx, 'cloudReadOnly');
        if (access === null) {
            return;
        }
        this.ctx.patchStep('billing', { busy: true });
        try {
            const disabled = await this.ctx.deps.cloud.disabledApis(access, BILLING_APIS);
            this.setNeedsPlatform(disabled.length > 0);
        } catch (error) {
            this.ctx.deps.log.warn('billing APIs not checked', { reason: googleFailure(error).message.key });
        } finally {
            this.ctx.patchStep('billing', { busy: false });
        }
    }

    async link(): Promise<void> {
        const scope = this.scope();
        this.ctx.count('billing', 'inputs');
        this.ctx.patchStep('billing', { busy: true, error: null });
        const access = await googleAccess(this.ctx, 'billing', scope, true);
        if (access !== null) {
            await this.run(access);
        }
    }

    choose(accountName: string): void {
        this.ctx.count('billing', 'inputs');
        this.ctx.update((state) => ({ ...state, billing: { ...state.billing, chosen: accountName } }));
    }

    async confirm(): Promise<void> {
        const { chosen, accounts } = this.ctx.state().billing;
        const account = accounts.find((candidate) => candidate.name === chosen);
        this.ctx.count('billing', 'inputs');
        const access = await googleAccess(this.ctx, 'billing', this.scope(), true);
        if (access !== null && account !== undefined) {
            await this.finish(access, account, false);
        }
    }

    dispose(): void {
        this.poller.stop();
    }

    private scope(): 'cloudBilling' | 'cloudPlatform' {
        const state = this.ctx.state();
        return state.mode === 'normal' || state.billing.needsPlatform ? 'cloudPlatform' : 'cloudBilling';
    }

    private setNeedsPlatform(needsPlatform: boolean): void {
        this.ctx.update((state) => ({ ...state, billing: { ...state.billing, needsPlatform } }));
        this.ctx.patchStep('billing', { scope: needsPlatform ? 'cloudPlatform' : 'cloudBilling' });
    }

    private async run(access: GoogleAccess): Promise<void> {
        if (this.ctx.state().billing.needsPlatform) {
            const enabled = await this.guard('enable', () => this.ctx.deps.cloud.enableApis(access, BILLING_APIS));
            if (!enabled) {
                return;
            }
            this.setNeedsPlatform(false);
        }
        const observed = await this.observe(access);
        if (observed !== null) {
            await this.decide(access, observed);
        }
    }

    private async observe(access: GoogleAccess): Promise<BillingObservation | null> {
        try {
            return await this.ctx.deps.cloud.observeBilling(access);
        } catch (error) {
            this.failed(phaseFailure(error, 'observe'), 'observe');
            return null;
        }
    }

    /** Runs `action`; a failure is shown on the card. True when it succeeded. */
    private async guard(phase: Phase, action: () => Promise<void>): Promise<boolean> {
        try {
            await action();
            return true;
        } catch (error) {
            this.failed(phaseFailure(error, phase), phase);
            return false;
        }
    }

    private failed(failure: StepFailure, phase: Phase): void {
        if (phase === 'budget') {
            this.ctx.patchStep('billing', { state: 'invalid', detail: failure.message, checkedAt: this.ctx.nowIso() });
        }
        this.ctx.fail('billing', failure);
    }

    private async decide(access: GoogleAccess, observed: BillingObservation): Promise<void> {
        const [first] = observed.accounts;
        if (observed.linkedAccount !== null) {
            await this.finish(access, linkedAccount(observed, observed.linkedAccount), true);
            return;
        }
        if (first === undefined) {
            this.waitForAccount();
            return;
        }
        if (observed.accounts.length > 1) {
            this.offerChoice(observed.accounts, first);
            return;
        }
        await this.finish(access, first, false);
    }

    private setWaiting(waitingForAccount: boolean): void {
        this.ctx.update((state) => ({ ...state, billing: { ...state.billing, waitingForAccount } }));
    }

    private waitForAccount(): void {
        this.setWaiting(true);
        this.pending('adminSetup.billing.noAccount');
        this.poller.start(false);
    }

    private offerChoice(accounts: readonly BillingAccount[], first: BillingAccount): void {
        this.ctx.update((state) => ({ ...state, billing: { ...state.billing, accounts, chosen: first.name } }));
        this.pending('adminSetup.billing.chooseAccount');
    }

    private pending(key: SetupMessageKey): void {
        this.ctx.patchStep('billing', { state: 'missing', detail: setupMessage(key), busy: false, checkedAt: this.ctx.nowIso() });
    }

    private async pollAccounts(): Promise<PollOutcome> {
        const access = await googleAccess(this.ctx, 'billing', this.scope(), false);
        if (access === null) {
            this.setWaiting(false);
            return 'stop';
        }
        const observed = await this.ctx.deps.cloud.observeBilling(access);
        if (observed.accounts.length === 0 && observed.linkedAccount === null) {
            this.ctx.patchStep('billing', { checkedAt: this.ctx.nowIso() });
            return 'next';
        }
        this.setWaiting(false);
        this.likelyTrial();
        await this.decide(access, observed);
        return 'stop';
    }

    async markTrial(): Promise<void> {
        this.ctx.count('billing', 'inputs');
        const trialSince = this.ctx.state().billing.trialSince ?? this.ctx.nowIso();
        this.ctx.update((state) => ({ ...state, billing: { ...state.billing, trialSince } }));
        // Start-up mode keeps it in the bootstrap record, sent with the claim; an admin session records it at once.
        if (this.ctx.state().mode !== 'normal') {
            return;
        }
        try {
            this.ctx.applyStatus((await this.ctx.deps.backend.recordCloud({ trial: { since: trialSince } })).status);
        } catch (error) {
            this.ctx.fail('billing', apiFailure(error));
        }
    }

    /** An account appeared while the card waited: a new customer's, so a likely free trial from today (A60). */
    private likelyTrial(): void {
        const trialSince = this.ctx.state().billing.trialSince ?? this.ctx.nowIso();
        this.ctx.update((state) => ({ ...state, billing: { ...state.billing, trialSince } }));
    }

    private waitExpired(): void {
        this.setWaiting(false);
        this.pending('adminSetup.billing.waitTimeout');
    }

    private async finish(access: GoogleAccess, account: BillingAccount, linked: boolean): Promise<void> {
        this.ctx.patchStep('billing', { busy: true, error: null });
        const ready = linked || (await this.guard('link', () => this.ctx.deps.cloud.linkBilling(access, account.name)));
        if (!ready) {
            return;
        }
        this.ctx.update((state) => ({ ...state, billing: { ...state.billing, accountName: account.name, accounts: [], chosen: null } }));
        if (await this.guard('budget', () => this.budget(access, account))) {
            await this.record();
        }
    }

    private async budget(access: GoogleAccess, account: BillingAccount): Promise<void> {
        const amount = budgetAmountFor(account.currency);
        const budget = { accountName: account.name, amount, currency: account.currency };
        const { budgetId } = await this.ctx.deps.cloud.ensureBudget(access, budget);
        this.ctx.update((state) => ({ ...state, billing: { ...state.billing, budgetId, amount, currency: account.currency } }));
        this.ctx.patchStep('billing', { state: 'ok', detail: null, error: null, busy: false, checkedAt: this.ctx.nowIso() });
    }

    /** Normal mode: `setup/status` is the record, so the result is stored at once. */
    private async record(): Promise<void> {
        const state = this.ctx.state();
        const { budgetId, amount, currency, trialSince } = state.billing;
        if (state.mode !== 'normal' || budgetId === null) {
            return;
        }
        try {
            const { status } = await this.ctx.deps.backend.recordCloud({
                billing: { state: 'ok', budgetId, budgetAmount: amount, currency },
                ...(trialSince === null ? {} : { trial: { since: trialSince } }),
            });
            this.ctx.applyStatus(status);
        } catch (error) {
            this.ctx.fail('billing', apiFailure(error));
        }
    }
}

export function createBillingFlow(ctx: SetupContext): BillingFlow {
    return new Billing(ctx);
}
