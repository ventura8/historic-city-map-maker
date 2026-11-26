/**
 * Settings → The city's budget (M5, `docs/research/M5-interfaces.md` §1.8; behaviour A52), in a chunk of its own
 * (`city-budget`, fetched when the section first opens): the five limits of the city's share of the project's budgets,
 * each with what the city used where it is counted. The project's owner changes them (one input per field moved, then
 * Save); every other admin reads them with why not (`adminContent.budgets.ownerOnly`). A city without limits says the
 * project's caps alone hold it and shows its fields empty: a field left empty saves at its maximum, so the one an owner
 * types is the only limit set (the M5 UX review; `docs/LESSONS.md` 256).
 */
import type { UiLocale } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import { errorTemplate, loadingTemplate } from '../editing/states.js';
import { EMPTY } from '../shell/empty.js';
import { contentText, noticeOf } from '../shell/text.js';
import type { BudgetIntentsPort, BudgetSectionPort, LimitFieldPort } from './budget-port.js';

const FIELDS: readonly LimitFieldPort[] = [
    'computeUnitsPerMonth',
    'rasterJobsPerDay',
    'aiRequestsPerMonth',
    'geocodeCellsPerDay',
    'exportsPerDay',
];

const LABELS = {
    computeUnitsPerMonth: 'adminContent.budgets.computeUnits',
    rasterJobsPerDay: 'adminContent.budgets.rasterJobs',
    aiRequestsPerMonth: 'adminContent.budgets.aiRequests',
    geocodeCellsPerDay: 'adminContent.budgets.geocodeCells',
    exportsPerDay: 'adminContent.budgets.exports',
} as const;

export interface BudgetCardContext {
    readonly locale: UiLocale;
    readonly view: BudgetSectionPort;
    readonly intents: BudgetIntentsPort | null;
    readonly readOnly: boolean;
}

function heading(locale: UiLocale): TemplateResult {
    return html`<h2 tabindex="-1" data-detail-heading>${contentText(locale, 'adminContent.budgets.title')}</h2>`;
}

/** The saved limit, or undefined for a city without limits (the project's caps alone hold it). */
function savedLimit(view: BudgetSectionPort, name: LimitFieldPort): number | undefined {
    return view.limits?.[name];
}

function limitId(name: LimitFieldPort): string {
    return `limit-${name}`;
}

function usedId(name: LimitFieldPort): string {
    return `used-${name}`;
}

/** What the city used of the limit, where it is counted (nothing for jobs and exports, counted by their records). */
function usedNote(locale: UiLocale, name: LimitFieldPort, used: number | undefined, saved: number | undefined): TemplateResult {
    if (used === undefined) {
        return EMPTY;
    }
    const text =
        saved === undefined
            ? contentText(locale, 'adminContent.budgets.usedNoLimit', { used: String(used) })
            : contentText(locale, 'adminContent.budgets.used', { used: String(used), limit: String(saved) });
    return html`<p class="note" id=${usedId(name)}>${text}</p>`;
}

function field(context: BudgetCardContext, name: LimitFieldPort): TemplateResult {
    const { locale, view } = context;
    const saved = savedLimit(view, name);
    const used = view.used[name];
    const input = (event: Event): void => {
        context.intents?.setLimit(name, (event.currentTarget as HTMLInputElement).value);
    };
    return html`<div class="field">
        <label for=${limitId(name)}>${contentText(locale, LABELS[name])}</label>
        <input
            id=${limitId(name)}
            type="number"
            min="0"
            inputmode="decimal"
            .value=${view.draft[name] ?? (saved === undefined ? '' : String(saved))}
            ?readonly=${!view.owner || context.readOnly}
            aria-describedby=${used === undefined ? nothing : usedId(name)}
            @input=${input}
        />
        ${usedNote(locale, name, used, saved)}
    </div>`;
}

function actions(context: BudgetCardContext): TemplateResult {
    const { locale, view } = context;
    if (!view.owner) {
        return html`<p class="note" data-budget-readonly>${contentText(locale, 'adminContent.budgets.ownerOnly')}</p>`;
    }
    const save = (): void => {
        void context.intents?.saveLimits();
    };
    const discard = (): void => {
        context.intents?.discardLimits();
    };
    const changed = Object.keys(view.draft).length > 0;
    return html`<div class="actions">
        <hcm-button variant="filled" icon="check" ?disabled=${!changed || view.saving || context.readOnly} @click=${save}
            >${contentText(locale, 'adminContent.common.save')}</hcm-button
        >
        <hcm-button variant="text" ?disabled=${!changed || view.saving} @click=${discard}
            >${contentText(locale, 'adminContent.common.discard')}</hcm-button
        >
    </div>`;
}

/** Why the limits were not saved, beside them. */
function errorNote(locale: UiLocale, view: BudgetSectionPort): TemplateResult {
    return view.error === null ? EMPTY : html`<p class="alert" role="alert">${noticeOf(locale, view.error)}</p>`;
}

export function budgetCard(context: BudgetCardContext): TemplateResult {
    const { locale, view } = context;
    if (view.status === 'error') {
        return html`${heading(locale)}${errorTemplate(locale, view.failure, () => {
            context.intents?.retryBudget();
        })}`;
    }
    if (view.status === 'loading') {
        return html`${heading(locale)}${loadingTemplate(locale)}`;
    }
    return html`${heading(locale)}
        <p class="note">${contentText(locale, 'adminContent.budgets.intro')}</p>
        ${view.limits === null ? html`<p class="note" data-budget-caps-only>${contentText(locale, 'adminContent.budgets.projectCapsOnly')}</p>` : EMPTY}
        <section class="group budget" data-section="budget">
            <div class="budget" data-city-budget>${FIELDS.map((name) => field(context, name))}</div>
            ${errorNote(locale, view)} ${actions(context)}
        </section>`;
}
