/**
 * The Statistics view's charts as Material 3 cards (the owner's request of 2026-11-13: "prettify"): the key numbers as stat
 * cards, and each ranked list (pages, admin screens, key actions, devices, countries) as a horizontal bar list. Every bar
 * is decoration only (`aria-hidden`): its name, its number and its share are the list's own text, so a screen reader reads
 * the chart as a plain ordered list. The first five rows show; the rest open under **Show all** (a native `<details>`).
 * The bars' widths go through the CSSOM (`cssProperties`), never a `style` attribute, for the admin's strict CSP.
 */
import type { UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { cssProperties } from '../../components/css-properties.js';
import { EMPTY } from '../shell/empty.js';
import { contentText, shellText } from '../shell/text.js';
import type { NamedCountPort } from './crashes-port.js';
import { formatCount } from './statistics-format.js';

/** The rows a list shows before **Show all**. */
const FIRST = 5;

/** A share as the language writes a percentage (`62 %`, `62%`). */
export function formatShare(locale: UiLocale, share: number): string {
    return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(share);
}

/** One key number: its label and the number. */
export interface StatCard {
    readonly label: string;
    readonly value: string;
    /** A test hook on the number (`data-statistics-visitors`). */
    readonly hook?: string;
}

function statCard(card: StatCard): TemplateResult {
    return html`<li class="stat">
        <span class="stat-label">${card.label}</span>
        <span class="stat-value" ?data-statistics-visitors=${card.hook === 'visitors'}>${card.value}</span>
    </li>`;
}

/** The key numbers as a row of stat cards (a list: each card its label and number). */
export function statCards(label: string, cards: readonly StatCard[]): TemplateResult {
    return html`<ul class="stats" aria-label=${label}>
        ${cards.map(statCard)}
    </ul>`;
}

/** The pages GA4 names by their path: the public map's root and the admin's. */
const PAGE_KEYS: Readonly<Record<string, 'adminContent.statistics.numbers.surface.viewer' | 'adminContent.statistics.numbers.page.admin'>> =
    {
        '/': 'adminContent.statistics.numbers.surface.viewer',
        '/index.html': 'adminContent.statistics.numbers.surface.viewer',
        '/admin/': 'adminContent.statistics.numbers.page.admin',
        '/admin/index.html': 'adminContent.statistics.numbers.page.admin',
    };

/** A page path in words (`/` is the public map, `/admin/` the admin); any other path stays as it is. */
export function pageName(locale: UiLocale, path: string): string {
    const key = PAGE_KEYS[path];
    return key === undefined ? path : contentText(locale, key);
}

/** The admin's routes (`packages/admin/src/routing/routes.ts`), each named as the navigation names it. */
const SCREENS: ReadonlySet<string> = new Set([
    ...['home', 'setup', 'photos', 'pois', 'stories', 'layers', 'imagery', 'jobs', 'inbox', 'settings', 'admins'],
    ...['history', 'crashes', 'georef', 'help', 'cities', 'review', 'contribute'],
]);

/** An admin screen (`route`) by its name in the navigation; anything else stays as GA4 names it. */
export function screenName(locale: UiLocale, route: string): string {
    return SCREENS.has(route) ? shellText(locale, `adminShell.nav.${route as 'home'}`) : route;
}

/** What a bar list shows of a row: its name in words and, with `raw`, the value as GA4 names it under it (a path). */
export interface BarNames {
    readonly name: (value: string) => string;
    readonly raw?: boolean;
}

/** What every row of one list shares: the language, the list's largest number and its sum, and the rows' names. */
interface BarScale extends BarNames {
    readonly locale: UiLocale;
    readonly max: number;
    readonly total: number;
}

function barItem(item: NamedCountPort, scale: BarScale): TemplateResult {
    const { locale, max, total } = scale;
    const name = scale.name(item.name);
    const raw = scale.raw !== true || name === item.name ? EMPTY : html`<code class="bar-raw">${item.name}</code>`;
    const width = `${String(max === 0 ? 0 : (item.count / max) * 100)}%`;
    return html`<li class="bar-row">
        <span class="bar-name">${name}${raw}</span>
        <span class="bar-value">${formatCount(locale, item.count)}</span>
        <span class="bar-share">${formatShare(locale, total === 0 ? 0 : item.count / total)}</span>
        <span class="bar-track" aria-hidden="true"><span class="bar-fill" ${cssProperties({ '--hcm-bar': width })}></span></span>
    </li>`;
}

/** The rows past the first five, under **Show all (n)**. */
function rest(items: readonly NamedCountPort[], scale: BarScale): TemplateResult {
    const { locale } = scale;
    if (items.length <= FIRST) {
        return EMPTY;
    }
    return html`<details class="more">
        <summary>${contentText(locale, 'adminContent.statistics.numbers.showAll', { count: formatCount(locale, items.length) })}</summary>
        <ol class="bars" start=${FIRST + 1}>
            ${items.slice(FIRST).map((item) => barItem(item, scale))}
        </ol>
    </details>`;
}

/** A ranked list as a card: its title, then a bar per row (the most first) with the number and its share of the list. */
export function barCard(locale: UiLocale, title: string, items: readonly NamedCountPort[], names: BarNames): TemplateResult {
    const max = Math.max(0, ...items.map((item) => item.count));
    const scale: BarScale = {
        locale,
        max,
        total: items.reduce((sum, item) => sum + item.count, 0),
        name: names.name,
        raw: names.raw === true,
    };
    const body =
        items.length === 0
            ? html`<p class="note">${contentText(locale, 'adminContent.statistics.numbers.none')}</p>`
            : html`<ol class="bars" aria-label=${title}>
                      ${items.slice(0, FIRST).map((item) => barItem(item, scale))}
                  </ol>
                  ${rest(items, scale)}`;
    return html`<section class="card">
        <h4>${title}</h4>
        ${body}
    </section>`;
}
