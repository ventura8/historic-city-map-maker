/**
 * Home's Visitors card (the owner, 2026-11-16): the Statistics page's last numbers of this session (`DECISIONS-for-review.md`
 * §203: read from Google Analytics in this browser after the owner's read-only consent; Home never asks Google itself).
 * The period's visitors and sessions with the trend against the period before, the last day's visitors, new against
 * returning, and the top countries, languages, devices, years, layers and photos, then All the numbers. Before any read, it
 * says why there is nothing yet and opens Statistics, where the consent is asked. Defined by the admin's lazy `visitors` chunk.
 */
import { DEFAULT_LOCALE, type UiLocale } from '@hcm/shared';
import { css, html, LitElement, type TemplateResult } from 'lit';

import { editingStyles } from '../editing/editing-styles.js';
import { shellText } from '../shell/text.js';
import type { VisitorsPort } from './home-port.js';

const STATISTICS = '#/crashes/statistics';
const TOP = 3;

type Numbers = VisitorsPort['numbers'];
type Named = Numbers['devices'];
type ListKey = 'countries' | 'languages' | 'devices' | 'years' | 'layers' | 'photos';

function count(locale: UiLocale, value: number): string {
    return new Intl.NumberFormat(locale).format(value);
}

/** The change against the period before, as a signed percentage; null when there was nothing before. */
function trend(locale: UiLocale, now: number, before: number): string | null {
    if (before === 0) {
        return null;
    }
    return new Intl.NumberFormat(locale, { style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: 0 }).format(
        (now - before) / before,
    );
}

const NO_SUMMARY: NonNullable<Numbers['summary']> = {
    daily: [],
    previous: { visitors: 0, sessions: 0 },
    newVsReturning: [],
    languages: [],
    years: [],
    layers: [],
    photos: [],
};

/** "+50% against the 28 days before", or nothing when there was nothing before. */
function trendText(locale: UiLocale, now: number, before: number, days: number): string {
    const change = trend(locale, now, before);
    return change === null ? '' : shellText(locale, 'adminShell.home.visitors.trend', { change, days: String(days) });
}

function lists(numbers: Numbers): Readonly<Record<ListKey, Named>> {
    const { languages, years, layers, photos } = numbers.summary ?? NO_SUMMARY;
    return { countries: numbers.countries, languages, devices: numbers.devices, years, layers, photos };
}

function topList(locale: UiLocale, key: ListKey, items: Named): TemplateResult {
    const text =
        items.length === 0
            ? shellText(locale, 'adminShell.home.visitors.none')
            : items
                  .slice(0, TOP)
                  .map((item) => `${item.name} (${count(locale, item.count)})`)
                  .join(', ');
    return html`<div data-top=${key}>
        <dt>${shellText(locale, `adminShell.home.visitors.top.${key}`)}</dt>
        <dd>${text}</dd>
    </div>`;
}

function newVsReturning(locale: UiLocale, numbers: Numbers): string {
    const kinds = (numbers.summary ?? NO_SUMMARY).newVsReturning;
    const of = (name: string): number => kinds.find((item) => item.name === name)?.count ?? 0;
    return shellText(locale, 'adminShell.home.visitors.newReturning', {
        new: count(locale, of('new')),
        returning: count(locale, of('returning')),
    });
}

function totals(locale: UiLocale, statistics: VisitorsPort): TemplateResult {
    const { numbers, days } = statistics;
    const { previous, daily } = numbers.summary ?? NO_SUMMARY;
    const lastDay = daily.at(-1)?.visitors ?? 0;
    return html`<p data-totals>
            ${shellText(locale, 'adminShell.home.visitors.period', {
                days: String(days),
                visitors: count(locale, numbers.visitors),
                sessions: count(locale, numbers.sessions),
            })}
            ${trendText(locale, numbers.visitors, previous.visitors, days)}
        </p>
        <p>
            ${shellText(locale, 'adminShell.home.visitors.lastDay', { visitors: count(locale, lastDay) })}
            ${newVsReturning(locale, numbers)}
        </p>`;
}

function card(locale: UiLocale, statistics: VisitorsPort | null): TemplateResult {
    if (statistics === null) {
        return html`<p>${shellText(locale, 'adminShell.home.visitors.notRead')}</p>
            <a class="action" href=${STATISTICS}>${shellText(locale, 'adminShell.home.visitors.open')}</a>`;
    }
    const all = lists(statistics.numbers);
    return html`${totals(locale, statistics)}
        <dl class="top">${(Object.keys(all) as ListKey[]).map((key) => topList(locale, key, all[key]))}</dl>
        <a class="action" href=${STATISTICS}>${shellText(locale, 'adminShell.home.visitors.all')}</a>`;
}

const visitorsStyles = css`
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

    dl.top {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
        gap: 8px 24px;
        margin: 0;
    }

    dl.top dd {
        margin: 0;
    }

    a.action {
        display: inline-flex;
        align-items: center;
        align-self: start;
        min-block-size: 48px;
        color: inherit;
        font-weight: var(--md-sys-typescale-label-large-weight, 500);
    }
`;

export const HCM_HOME_VISITORS_TAG = 'hcm-home-visitors';

export class HcmHomeVisitors extends LitElement {
    static override readonly properties = { statistics: { attribute: false }, locale: { type: String } };

    static override readonly styles = [...editingStyles, visitorsStyles];

    declare statistics: VisitorsPort | null;
    declare locale: UiLocale;

    constructor() {
        super();
        this.statistics = null;
        this.locale = DEFAULT_LOCALE;
    }

    override render(): TemplateResult {
        const locale = this.locale;
        return html`<section aria-labelledby="visitors" data-visitors=${this.statistics === null ? 'none' : 'read'}>
            <h2 id="visitors">${shellText(locale, 'adminShell.home.visitors.title')}</h2>
            ${card(locale, this.statistics)}
        </section>`;
    }
}

export function defineHcmHomeVisitors(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_HOME_VISITORS_TAG) === undefined) {
        registry.define(HCM_HOME_VISITORS_TAG, HcmHomeVisitors);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-home-visitors': HcmHomeVisitors;
    }
}
