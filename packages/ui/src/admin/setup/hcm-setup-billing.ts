/**
 * The billing card's body (step b, `docs/research/M2b-interfaces.md` §3.3 b): the budget it creates, then one button
 * that links billing and creates the budget (one click, one Google consent). While no open account exists it waits for
 * the one the owner creates on Google's page; with several it offers the choice, the first preselected. M6 (setup-ux,
 * finding 3 of 2026-10-25, "stuck at step b"): with no account the card's primary action is **Create a billing account**
 * (Google's page, a new tab), the wait is said in words with its last check, and nothing else offers a click while it
 * waits; a new account found while it waited is said to be a likely free trial (A60).
 */
import { html, type TemplateResult } from 'lit';

import { defineHcmButton } from '../../components/button.js';
import { defineHcmIcon } from '../../components/icon.js';
import { defineOnce } from '../../components/internal.js';
import { defineHcmProgress } from '../../components/progress.js';
import { visuallyHidden } from '../../components/styles.js';
import { EMPTY } from '../shell/empty.js';
import { fieldStyles, linkButtonStyles, setupTextStyles } from './setup-styles.js';
import { SetupBody, defineSetupBodyParts } from './setup-body.js';
import type { SetupViewState } from './setup-port.js';
import { formatDateTime, formatMoney } from './setup-text.js';

const HCM_SETUP_BILLING_TAG = 'hcm-setup-billing';

/** The reasons that say no open account exists: the card offers Google's page that creates one. */
const NO_ACCOUNT: ReadonlySet<string> = new Set(['adminSetup.billing.noAccount', 'adminSetup.billing.waitTimeout']);

export class HcmSetupBilling extends SetupBody {
    static override readonly styles = [setupTextStyles, fieldStyles, linkButtonStyles, visuallyHidden];

    protected override renderBody(state: SetupViewState): TemplateResult {
        const amount = formatMoney(this.locale, state.billing.amount, state.billing.currency);
        return html`<div class="body">
            <p>${this.t('adminSetup.billing.budget', { amount })}</p>
            ${this.renderCreate(state)} ${state.billing.waitingForAccount ? this.renderWaiting(state) : this.renderAction(state, amount)}
            ${state.billing.trialSince === null ? this.renderMarkTrial(state) : html`<p class="note trial">${this.t('adminSetup.billing.trial')}</p>`}
        </div>`;
    }

    /**
     * Once billing is linked and no trial is known: "This account is a free trial" (one input). The card infers a trial
     * only from an account made while it waited; an account that existed before Setup can be one too (finding 6 of the
     * M6 review), and only the owner knows.
     */
    private renderMarkTrial(state: SetupViewState): TemplateResult {
        const step = this.step(state, 'billing');
        if (step.state !== 'ok') {
            return EMPTY;
        }
        return html`<div class="mark-trial">
            <p class="note">${this.t('adminSetup.billing.markTrialWhy')}</p>
            <div class="actions">
                <hcm-button
                    variant="outlined"
                    icon="schedule"
                    ?disabled=${step.busy}
                    @click=${() => {
                        this.act((intents) => {
                            intents.markTrial();
                        });
                    }}
                    >${this.t('adminSetup.billing.markTrial')}</hcm-button
                >
            </div>
        </div>`;
    }

    /** No open account: Google's page that creates one is the card's primary action (a new tab, not counted). */
    private renderCreate(state: SetupViewState): TemplateResult {
        const detail = this.step(state, 'billing').detail?.key ?? '';
        if (!state.billing.waitingForAccount && !NO_ACCOUNT.has(detail)) {
            return EMPTY;
        }
        return html`<div class="actions">
            <a
                class="link-button"
                href=${state.billing.createUrl}
                target="_blank"
                rel="noopener noreferrer"
                @click=${() => {
                    this.act((intents) => {
                        intents.followLink('billing');
                    });
                }}
                ><hcm-icon name="credit_card"></hcm-icon>${this.t('adminSetup.billing.create')}<span class="visually-hidden">
                    ${this.t('adminSetup.newTab')}</span
                ></a
            >
        </div>`;
    }

    /**
     * The wait in words: what the page does by itself and when it last looked (nothing else to click meanwhile). The
     * status region says the wait once; the time of the last check, which changes every 10 s, is outside it.
     */
    private renderWaiting(state: SetupViewState): TemplateResult {
        const checkedAt = this.step(state, 'billing').checkedAt;
        const lastCheck =
            checkedAt === null ? '' : this.t('adminSetup.billing.lastCheck', { time: formatDateTime(this.locale, checkedAt) });
        return html`<div class="waiting">
            <div role="status">
                <hcm-progress indeterminate label=${this.t('adminSetup.billing.waiting')}></hcm-progress>
                <p>${this.t('adminSetup.billing.waiting')}</p>
            </div>
            <p class="note">${this.t('adminSetup.billing.waitingHow')}</p>
            <p class="note last-check">${lastCheck}</p>
        </div>`;
    }

    private renderAction(state: SetupViewState, amount: string): TemplateResult {
        const step = this.step(state, 'billing');
        return state.billing.accounts.length > 1 ? this.renderChoice(state) : this.renderMain(step.state === 'ok', step.busy, amount);
    }

    private renderMain(done: boolean, busy: boolean, amount: string): TemplateResult {
        if (done) {
            return html`<p class="success">${this.t('adminSetup.billing.done', { amount })}</p>`;
        }
        return html`<div class="actions">
            <hcm-button
                variant="filled"
                icon="credit_card"
                ?disabled=${busy}
                @click=${() => {
                    this.act((intents) => {
                        intents.linkBilling();
                    });
                }}
                >${this.t('adminSetup.billing.link', { amount })}</hcm-button
            >
        </div>`;
    }

    private renderChoice(state: SetupViewState): TemplateResult {
        return html`<fieldset class="choice">
            <legend>${this.t('adminSetup.billing.chooseAccount')}</legend>
            ${state.billing.accounts.map(
                (account) =>
                    html`<label class="option"
                        ><input
                            class="radio"
                            type="radio"
                            name="account"
                            .value=${account.name}
                            .checked=${account.name === state.billing.chosen}
                            @change=${() => {
                                this.act((intents) => {
                                    intents.chooseBillingAccount(account.name);
                                });
                            }}
                        />${account.displayName} (${account.currency})</label
                    >`,
            )}
            <div class="actions">
                <hcm-button
                    variant="filled"
                    ?disabled=${this.step(state, 'billing').busy}
                    @click=${() => {
                        this.act((intents) => {
                            intents.confirmBillingAccount();
                        });
                    }}
                    >${this.t('adminSetup.billing.useAccount')}</hcm-button
                >
            </div>
        </fieldset>`;
    }
}

/** Registers `<hcm-setup-billing>` and what it renders. */
export function defineHcmSetupBilling(registry: CustomElementRegistry = customElements): void {
    defineSetupBodyParts(registry);
    defineHcmButton(registry);
    defineHcmIcon(registry);
    defineHcmProgress(registry);
    defineOnce(registry, HCM_SETUP_BILLING_TAG, HcmSetupBilling);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-setup-billing': HcmSetupBilling;
    }
}
