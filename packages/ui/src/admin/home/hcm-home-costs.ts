/**
 * Home's Monthly costs card (`packages/admin/src/home/costs.ts`): one row per paid service the map uses, this month's spend so
 * far and the month's forecast, whether the number is measured by the map or an estimate (and why), the share of the free
 * tier used, and the service's console (a new tab); then the total against the budget, and when the forecast passes it, what
 * happens and where to act (Jobs, Google Cloud billing). Text only. `<hcm-home-costs>`, defined by the admin's lazy `costs`
 * chunk (`packages/admin/src/home/costs.ts`), so the dashboard's own chunk stays within its budget.
 */
import { DEFAULT_LOCALE, type UiLocale } from '@hcm/shared';
import { ONE_SCAN_USD } from '@hcm/shared/sources';
import { css, html, LitElement, type TemplateResult } from 'lit';

import { visuallyHidden } from '../../components/styles.js';
import { editingStyles } from '../editing/editing-styles.js';

import { EMPTY } from '../shell/empty.js';
import { setupLabel } from '../setup/setup-text.js';
import { shellText } from '../shell/text.js';
import type { CostRowPort, MonthlyCostsPort, UsdRangePort } from './home-port.js';

/** The Google Cloud billing reports (`packages/admin/src/home/costs.ts` `BILLING_CONSOLE`). */
const BILLING = 'https://console.cloud.google.com/billing/reports';

function money(locale: UiLocale, amount: number, currency = 'USD'): string {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
}

/** A range as text: one amount when both ends agree, else "low – high". */
function rangeText(locale: UiLocale, value: UsdRangePort): string {
    return value.low === value.high ? money(locale, value.low) : `${money(locale, value.low)} – ${money(locale, value.high)}`;
}

function percent(locale: UiLocale, share: number): string {
    return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(share);
}

function newTab(locale: UiLocale, href: string, label: string): TemplateResult {
    return html`<a class="action" href=${href} target="_blank" rel="noopener noreferrer"
        >${label}<hcm-icon name="open_in_new"></hcm-icon><span class="visually-hidden">${setupLabel(locale, 'adminSetup.newTab')}</span></a
    >`;
}

function note(locale: UiLocale, row: CostRowPort): string {
    if (row.basis === 'unread') {
        return shellText(locale, 'adminShell.home.costs.basis.unread');
    }
    return shellText(locale, `adminShell.home.costs.note.${row.service}`, { scan: money(locale, ONE_SCAN_USD) });
}

function costRow(locale: UiLocale, row: CostRowPort): TemplateResult {
    const free =
        row.freeUsed === null
            ? EMPTY
            : html`<span>${shellText(locale, 'adminShell.home.costs.freeUsed', { percent: percent(locale, row.freeUsed) })}</span>`;
    const basis = row.basis === 'measured' ? 'measured' : 'estimate';
    return html`<li class="cost" data-cost=${row.service} data-basis=${row.basis}>
        <div class="head">
            <strong>${shellText(locale, `adminShell.home.costs.service.${row.service}`)}</strong>
            <span class="tag" data-tone=${basis === 'measured' ? 'good' : 'none'}
                >${shellText(locale, `adminShell.home.costs.basis.${basis}`)}</span
            >
        </div>
        <dl>
            <div>
                <dt>${shellText(locale, 'adminShell.home.costs.soFar')}</dt>
                <dd>${rangeText(locale, row.usd)}</dd>
            </div>
            <div>
                <dt>${shellText(locale, 'adminShell.home.costs.forecast')}</dt>
                <dd>${rangeText(locale, row.forecastUsd)}</dd>
            </div>
        </dl>
        ${free}
        <p class="note">${note(locale, row)}</p>
        ${newTab(locale, row.console, shellText(locale, 'adminShell.home.costs.open'))}
    </li>`;
}

function budgetText(locale: UiLocale, costs: MonthlyCostsPort): string {
    const { amount, currency, spent } = costs.budget;
    if (spent === null) {
        return shellText(locale, 'adminShell.home.costs.budget', { amount: money(locale, amount, currency) });
    }
    return shellText(locale, 'adminShell.home.costs.budgetSpent', {
        spent: money(locale, spent, currency),
        amount: money(locale, amount, currency),
    });
}

function overBudget(locale: UiLocale, costs: MonthlyCostsPort): TemplateResult {
    if (!costs.overBudget) {
        return EMPTY;
    }
    return html`<div class="over" role="status">
        <p>${shellText(locale, 'adminShell.home.costs.overBudget')} ${shellText(locale, 'adminShell.home.costs.overBudget2')}</p>
        <a class="action" href="#/jobs">${shellText(locale, 'adminShell.home.costs.jobs')}</a>
    </div>`;
}

/** The Monthly costs section. */
function costsSection(locale: UiLocale, costs: MonthlyCostsPort): TemplateResult {
    const body = costs.loading
        ? html`<p>${shellText(locale, 'adminShell.home.costs.loading')}</p>`
        : html`<ul class="costs">
                  ${costs.rows.map((row) => costRow(locale, row))}
              </ul>
              <dl class="total">
                  <div>
                      <dt>${shellText(locale, 'adminShell.home.costs.total')}</dt>
                      <dd>${rangeText(locale, costs.total)}</dd>
                  </div>
                  <div>
                      <dt>${shellText(locale, 'adminShell.home.costs.forecast')}</dt>
                      <dd>${rangeText(locale, costs.forecast)}</dd>
                  </div>
              </dl>
              <p>${budgetText(locale, costs)}</p>
              ${overBudget(locale, costs)} ${newTab(locale, BILLING, shellText(locale, 'adminShell.home.costs.billing'))}`;
    return html`<section aria-labelledby="monthly-costs" data-costs>
        <h2 id="monthly-costs">${shellText(locale, 'adminShell.home.costs.title')}</h2>
        <p>
            ${shellText(locale, 'adminShell.home.costs.intro', { month: costs.month })} ${shellText(locale, 'adminShell.home.costs.intro2')}
        </p>
        ${body}
    </section>`;
}

const costsStyles = css`
    :host {
        display: block;
    }

    section {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    p {
        margin: 0;
    }

    ul.costs {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .cost {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 16px;
        border-radius: var(--md-sys-shape-corner-large, 16px);
        background: var(--md-sys-color-surface-container-low, Canvas);
    }

    .cost .head {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        justify-content: space-between;
    }

    .cost dl,
    dl.total {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 24px;
        margin: 0;
    }

    .cost dd,
    dl.total dd {
        margin: 0;
        font-weight: var(--md-sys-typescale-title-medium-weight, 500);
    }

    .over {
        padding: 16px;
        border-radius: var(--md-sys-shape-corner-large, 16px);
        background: var(--md-sys-color-error-container, Canvas);
        color: var(--md-sys-color-on-error-container, CanvasText);
    }

    /* On the error container the theme's focus colour is too faint (2.4:1): the ring takes the text's colour. */
    .over a.action:focus-visible {
        outline: 2px solid currentcolor;
        outline-offset: 2px;
    }

    [data-costs] a.action {
        display: inline-flex;
        gap: 4px;
        align-items: center;
        min-block-size: 48px;
        color: inherit;
        font-weight: var(--md-sys-typescale-label-large-weight, 500);

        --hcm-icon-size: 18px;
    }
`;

export const HCM_HOME_COSTS_TAG = 'hcm-home-costs';

export class HcmHomeCosts extends LitElement {
    static override readonly properties = { costs: { attribute: false }, locale: { type: String } };

    static override readonly styles = [...editingStyles, costsStyles, visuallyHidden];

    declare costs: MonthlyCostsPort | null;
    declare locale: UiLocale;

    constructor() {
        super();
        this.costs = null;
        this.locale = DEFAULT_LOCALE;
    }

    override render(): TemplateResult {
        return this.costs === null ? EMPTY : costsSection(this.locale, this.costs);
    }
}

export function defineHcmHomeCosts(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_HOME_COSTS_TAG) === undefined) {
        registry.define(HCM_HOME_COSTS_TAG, HcmHomeCosts);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-home-costs': HcmHomeCosts;
    }
}
