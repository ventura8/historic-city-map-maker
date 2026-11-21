/**
 * The Statistics view's wizards (§203, the owner's "prettify" of 2026-11-13): each wizard someone used is a card with its
 * steps in order as a step bar chart (the bar is the share of the people who saw the first step), and under each step its
 * people, who left before it, the average time and its most frequent errors as chips. The wizards nobody used in the
 * period are one quiet line, and a period without any is one line too. The bars are decoration (`aria-hidden`): the
 * numbers are the steps' own text.
 */
import type { UiLocale } from '@hcm/shared';
import { WIZARD_IDS, type WizardId } from '@hcm/shared/funnels';
import { html, type TemplateResult } from 'lit';

import { cssProperties } from '../../components/css-properties.js';
import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import type { StatisticsNumbersPort, StepNumbersPort } from './crashes-port.js';
import { errorName, formatCount, formatDuration } from './statistics-format.js';

/** The errors shown per step. */
const TOP_ERRORS = 3;

export interface FunnelNames {
    readonly locale: UiLocale;
    /** The period in words (`28 days`). */
    readonly period: string;
    /** A wizard's steps in order (the view's table); a step not listed follows by its people. */
    readonly order: (wizard: WizardId) => readonly string[];
    readonly stepName: (step: string) => string;
    readonly wizardName: (wizard: WizardId) => string;
}

/** The steps of one wizard in the page's order, then any other step by its people. */
function ordered(names: FunnelNames, numbers: StatisticsNumbersPort, wizard: WizardId): readonly StepNumbersPort[] {
    const own = numbers.steps.filter((step) => step.wizard === wizard);
    const order = names.order(wizard);
    const rank = (step: StepNumbersPort): number => {
        const index = order.indexOf(step.step);
        return index === -1 ? order.length : index;
    };
    return [...own].sort((left, right) => rank(left) - rank(right) || right.visitors - left.visitors);
}

/** Who left between the step before and this one: the count and its share; a dash for the first step. */
function leftText(locale: UiLocale, before: StepNumbersPort | undefined, step: StepNumbersPort): string {
    if (before === undefined || before.visitors === 0) {
        return '—';
    }
    const left = Math.max(0, before.visitors - step.visitors);
    return contentText(locale, 'adminContent.statistics.numbers.percent', {
        count: formatCount(locale, left),
        percent: formatCount(locale, (left / before.visitors) * 100),
    });
}

function errorChips(locale: UiLocale, step: StepNumbersPort): TemplateResult {
    const errors = step.errors.slice(0, TOP_ERRORS);
    if (errors.length === 0) {
        return EMPTY;
    }
    return html`<ul class="chips step-errors" aria-label=${contentText(locale, 'adminContent.statistics.numbers.errors')}>
        ${errors.map(
            (error) =>
                html`<li class="tag" data-tone="error">
                    <span class="error-name">${errorName(locale, error.name)}</span>
                    <span class="badge">${formatCount(locale, error.count)}</span>
                </li>`,
        )}
    </ul>`;
}

function fact(label: string, value: string): TemplateResult {
    return html`<div>
        <dt>${label}</dt>
        <dd>${value}</dd>
    </div>`;
}

/** A step's name and its code after it; a step without a name is its code alone. */
function stepLabel(names: FunnelNames, step: string): TemplateResult {
    const name = names.stepName(step);
    return name === step ? html`<code>${step}</code>` : html`${name} <code>${step}</code>`;
}

function stepItem(names: FunnelNames, step: StepNumbersPort, before: StepNumbersPort | undefined, first: number): TemplateResult {
    const { locale } = names;
    const width = `${String(first === 0 ? 0 : Math.min(100, (step.visitors / first) * 100))}%`;
    return html`<li class="step">
        <span class="step-name">${stepLabel(names, step.step)}</span>
        <span class="bar-track" aria-hidden="true"><span class="bar-fill" ${cssProperties({ '--hcm-bar': width })}></span></span>
        <dl class="step-facts">
            ${fact(contentText(locale, 'adminContent.statistics.numbers.people'), formatCount(locale, step.visitors))}
            ${fact(contentText(locale, 'adminContent.statistics.numbers.left'), leftText(locale, before, step))}
            ${fact(contentText(locale, 'adminContent.statistics.numbers.time'), formatDuration(locale, step.averageMs))}
        </dl>
        ${errorChips(locale, step)}
    </li>`;
}

function funnelCard(names: FunnelNames, wizard: WizardId, steps: readonly StepNumbersPort[]): TemplateResult {
    const name = names.wizardName(wizard);
    const first = Math.max(0, ...steps.map((step) => step.visitors));
    const label = contentText(names.locale, 'adminContent.statistics.numbers.tableLabel', { name });
    return html`<section class="card funnel" data-funnel=${wizard}>
        <h5>${name}</h5>
        <ol class="steps" aria-label=${label}>
            ${steps.map((step, index) => stepItem(names, step, steps[index - 1], first))}
        </ol>
    </section>`;
}

/** The wizards' section: a card per wizard used, one line for the others (or for the whole period). */
export function funnelsSection(names: FunnelNames, numbers: StatisticsNumbersPort): TemplateResult {
    const { locale } = names;
    const used = WIZARD_IDS.map((wizard) => ({ wizard, steps: ordered(names, numbers, wizard) }));
    const withSteps = used.filter((item) => item.steps.length > 0);
    const unused = used.filter((item) => item.steps.length === 0).map((item) => names.wizardName(item.wizard));
    const period = names.period;
    const quiet =
        withSteps.length === 0
            ? html`<p class="note" data-statistics-no-wizard>
                  ${contentText(locale, 'adminContent.statistics.numbers.noWizardAll', { period })}
              </p>`
            : html`<p class="note" data-statistics-unused>
                  ${contentText(locale, 'adminContent.statistics.numbers.unused', { period, names: unused.join(', ') })}
              </p>`;
    return html`<section class="block" data-statistics-wizards>
        <h4>${contentText(locale, 'adminContent.statistics.numbers.wizards')}</h4>
        <div class="grid">${withSteps.map((item) => funnelCard(names, item.wizard, item.steps))}</div>
        ${withSteps.length > 0 && unused.length === 0 ? EMPTY : quiet}
    </section>`;
}
